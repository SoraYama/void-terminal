import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinnedLookup, isPublicAddress, openProviderTransport, resolveProvider } from "../src/lib/server/provider";
import { POST as testModel } from "../src/app/api/models/test/route";
import { POST as chat } from "../src/app/api/chat/route";
import { runAgent } from "../src/lib/server/agent";
import { parseChat } from "../src/lib/server/validation";
import type { ChatEvent, ChatRequest } from "../src/lib/contracts";

// DNS and TLS are the external boundary. The actual URL validation, route,
// Agent options, immutable lookup callback and stream lifecycle stay real.
const network = vi.hoisted(() => ({
  lookup: vi.fn(), fetch: vi.fn(), agents: [] as { options: any; destroy: ReturnType<typeof vi.fn> }[],
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
  fetch: network.fetch,
  Agent: class {
    options: any;
    destroy = vi.fn(async () => {});
    constructor(options: any) { this.options = options; network.agents.push(this); }
  },
}));
const base = "https://models.example/vendor/compatible/v1";
const input: ChatRequest = { messages: [{ role: "user", content: "Who is this?" }], language: "en", mode: "byok", depth: "standard" };
const req = (value: unknown, signal?: AbortSignal) => new Request("http://localhost/api/models/test", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Model-Api-Key": "private-test-key" }, body: JSON.stringify(value), signal,
});
const completion = (delta: unknown, finish = "stop") => new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }], usage: { prompt_tokens: 2, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
const evidence = () => Response.json({ snapshotId: "s1", mode: "lexical", total: 1, sources: [{ id: "a", documentId: "d", title: "Person", text: "Known evidence", type: "character", language: "en", path: "data", locator: "1", sourceUrl: "", snapshotId: "s1" }] });

beforeEach(() => {
  vi.unstubAllEnvs();
  network.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
  network.fetch.mockReset().mockResolvedValue(Response.json({ data: [{ id: "custom-model" }] }));
  network.agents.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("visitor endpoint address boundary", () => {
  it("blocks the Azure platform virtual address even though it is globally numbered", async () => {
    expect(isPublicAddress("168.63.129.16")).toBe(false);
    network.lookup.mockResolvedValue([{ address: "168.63.129.16", family: 4 }]);
    await expect(resolveProvider("byok", { baseUrl: base })).rejects.toMatchObject({ code: "PROVIDER_ADDRESS_BLOCKED" });
    expect(network.agents).toHaveLength(0);
  });
  it.each(["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "100.64.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "3fff::1", "64:ff9b::a00:1", "2002:7f00:1::", "2001::1", "100::1", "4000::1"])("blocks private/reserved/non-global address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("recognizes global public address %s", address => expect(isPublicAddress(address)).toBe(true));
  it.each(["http://models.example/v1", "https://localhost/v1", "https://service.local/v1", "https://127.1/v1", "https://2130706433/v1", "https://0x7f000001/v1", "https://[::1]/v1", "https://[::ffff:127.0.0.1]/v1"])("rejects forbidden URL before DNS or transport: %s", async baseUrl => {
    await expect(resolveProvider("byok", { baseUrl })).rejects.toMatchObject({ code: "PROVIDER_ADDRESS_BLOCKED" });
    expect(network.lookup).not.toHaveBeenCalled(); expect(network.fetch).not.toHaveBeenCalled();
  });
  it.each(["https://user:secret@models.example/v1", "https://@models.example/v1", "https://models.example/v1?", "https://models.example/v1#", "https://models.example/v1?key=secret", "https://models.example/v1#secret", "https://models.example\\private", "https://models.example/\nprivate", "file:///etc/passwd"])("rejects unsafe URL syntax: %s", async baseUrl => {
    await expect(resolveProvider("byok", { baseUrl })).rejects.toMatchObject({ status: 400 });
    expect(network.fetch).not.toHaveBeenCalled();
  });
  it.each([{ model: "bad\nmodel" }, { model: "a".repeat(201) }, { baseUrl: "https://models.example/" + "a".repeat(2048) }])("returns a specific safe invalid-provider error", async provider => {
    const response = await testModel(req({ mode: "byok", provider }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "INVALID_PROVIDER" });
  });
  it.each(["10.0.0.2", "::ffff:169.254.169.254", "fe80::1"])("rejects mixed public/private DNS answer %s", async privateAddress => {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: privateAddress, family: privateAddress.includes(":") ? 6 : 4 }]);
    const response = await chat(req({ ...input, provider: { baseUrl: base } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "PROVIDER_ADDRESS_BLOCKED" } });
    expect(network.fetch).not.toHaveBeenCalled(); expect(network.agents).toHaveLength(0);
  });
  it("masks DNS errors and never includes host, exception or key in errors", async () => {
    network.lookup.mockRejectedValue(new Error("secret DNS details private-test-key models.example"));
    const response = await testModel(req({ mode: "byok", provider: { baseUrl: base, model: "custom-model" } }));
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({ code: "MODEL_UNAVAILABLE", model: "custom-model" });
    expect(JSON.stringify(result)).not.toMatch(/private-test-key|models\.example|DNS details/);
  });
  it("aborts while DNS is pending without allocating a socket or dispatching credentials", async () => {
    network.lookup.mockImplementation(() => new Promise(() => {}));
    const abort = new AbortController();
    const pending = resolveProvider("byok", { baseUrl: base }, abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(network.agents).toHaveLength(0); expect(network.fetch).not.toHaveBeenCalled();
  });
});

describe("pinned provider transport", () => {
  it.each([
    [{ address: "2606:4700:4700::1111", family: 6 }, { address: "8.8.8.8", family: 4 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "1.1.1.1", family: 4 }],
  ])("offers every validated address to socket fallback without resolving DNS again: %j", async (...addresses) => {
    network.lookup.mockResolvedValue(addresses);
    const provider = await resolveProvider("byok", { baseUrl: base });
    network.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const transport = openProviderTransport(provider);
    try {
      const options = network.agents[0].options;
      expect(options.autoSelectFamily).toBe(true);
      expect(options.autoSelectFamilyAttemptTimeout).toBeLessThanOrEqual(500);
      const callback = vi.fn();
      options.connect.lookup("models.example", { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, addresses);
      expect(network.lookup).toHaveBeenCalledTimes(1);
    } finally { await transport.close(); }
  });
  it("pins the validated DNS snapshot into the actual TLS Agent even after DNS rebinding", async () => {
    const provider = await resolveProvider("byok", { baseUrl: base, model: "custom-model" });
    network.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const transport = openProviderTransport(provider);
    await transport.fetch("/models", { headers: { Authorization: "Bearer private-test-key" } });
    const [url, init] = network.fetch.mock.calls[0];
    expect(url).toBe("https://models.example/vendor/compatible/v1/models");
    expect(init.dispatcher).toBe(network.agents[0]); expect(init.redirect).toBe("error");
    const callback = vi.fn();
    network.agents[0].options.connect.lookup("models.example", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
    expect(network.lookup).toHaveBeenCalledTimes(1);
    await transport.close(); expect(network.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("refuses a TLS lookup for a different hostname", () => {
    const callback = vi.fn();
    createPinnedLookup("models.example", [{ address: "8.8.8.8", family: 4 }])("metadata.internal", {}, callback);
    expect(callback.mock.calls[0][0]).toMatchObject({ code: "PROVIDER_ADDRESS_BLOCKED" });
    expect(callback.mock.calls[0]).toHaveLength(1);
  });
  it("keeps copied address snapshots immutable across lookup calls", () => {
    const addresses = [{ address: "8.8.8.8", family: 4 }];
    const lookup = createPinnedLookup("models.example", addresses);
    addresses[0].address = "127.0.0.1";
    const callback = vi.fn(); lookup("models.example", { all: true }, callback);
    callback.mock.calls[0][1][0].address = "10.0.0.1";
    lookup("models.example", { family: 4 }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "8.8.8.8", 4);
  });
  it("tests exactly GET models at a custom prefix and sends the key only in Authorization", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://localhost:4444");
    const response = await testModel(req({ mode: "byok", provider: { baseUrl: `${base}///`, model: "custom-model" } }));
    expect(await response.json()).toMatchObject({ ok: true, model: "custom-model" });
    expect(network.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = network.fetch.mock.calls[0];
    expect(url).toBe("https://models.example/vendor/compatible/v1/models");
    expect(init.method ?? "GET").toBe("GET"); expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer private-test-key");
    expect(JSON.stringify({ url, body: init.body })).not.toContain("private-test-key");
    expect(network.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("does not follow redirect responses and cleans the Agent", async () => {
    network.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }));
    const response = await testModel(req({ mode: "byok", provider: { baseUrl: base } }));
    expect(response.status).toBe(503); expect(network.fetch).toHaveBeenCalledTimes(1);
    expect(network.fetch.mock.calls[0][1].redirect).toBe("error"); expect(network.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("cleans the Agent when the provider rejects headers with secret details", async () => {
    network.fetch.mockRejectedValue(new Error("private-test-key models.example SECRET"));
    const response = await testModel(req({ mode: "byok", provider: { baseUrl: base } }));
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/private-test-key|models.example|SECRET/);
    expect(network.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("destroys the Agent once on cancellation and prevents further key dispatch", async () => {
    const abort = new AbortController();
    const transport = openProviderTransport(await resolveProvider("byok", { baseUrl: base }), abort.signal);
    abort.abort();
    await expect(transport.fetch("/models", { headers: { Authorization: "Bearer secret" } })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    await transport.close(); expect(network.agents[0].destroy).toHaveBeenCalledTimes(1); expect(network.fetch).not.toHaveBeenCalled();
  });
  it("uses the selected model and generic payload throughout tool research and final synthesis", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => evidence()));
    network.fetch.mockImplementation(async () => network.fetch.mock.calls.length === 1
      ? completion({ tool_calls: [{ index: 0, id: "c1", function: { name: "search_corpus", arguments: '{"query":"detail"}' } }] }, "tool_calls")
      : completion({ content: "Answer[1]" }));
    const events: ChatEvent[] = [];
    await runAgent({ ...input, depth: "deep", provider: { baseUrl: base, model: "custom-model" } }, { key: "private-test-key", signal: new AbortController().signal, emit: e => events.push(e) });
    expect(network.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [url, init] of network.fetch.mock.calls) {
      expect(url).toBe("https://models.example/vendor/compatible/v1/chat/completions");
      const payload = JSON.parse(init.body);
      expect(payload.model).toBe("custom-model");
      expect(payload.thinking).toBeUndefined(); expect(payload.reasoning_effort).toBeUndefined();
      expect(init.body).not.toContain("private-test-key");
    }
    expect(events.at(-1)).toMatchObject({ event: "done" });
    expect(network.lookup).toHaveBeenCalledTimes(1); expect(network.agents).toHaveLength(1); expect(network.agents[0].destroy).toHaveBeenCalledTimes(1);
  });
  it("closes the Agent and cancels an active completion when the browser cancels chat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => evidence()));
    const cancelled = vi.fn();
    network.fetch.mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: ")); }, cancel: cancelled }), { headers: { "Content-Type": "text/event-stream" } }));
    const response = await chat(req({ ...input, provider: { baseUrl: base, model: "custom-model" } }));
    const reader = response.body!.getReader();
    while (!network.fetch.mock.calls.length) await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(network.agents[0].destroy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
  });
  it("accepts a custom model with blank URL but rejects malformed provider shape", async () => {
    expect(parseChat({ ...input, provider: { baseUrl: "   ", model: " custom-model " } }).provider).toEqual({ model: "custom-model" });
    const provider = await resolveProvider("byok", { model: "custom-model" });
    expect(provider.base).toBe("https://api.deepseek.com"); expect(provider.pinned).toBeUndefined();
    expect(() => parseChat({ ...input, provider: { model: ["bad"] } })).toThrow();
  });
});
