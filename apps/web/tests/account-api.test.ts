import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chat } from "../src/app/api/chat/route";
import { POST as testModel } from "../src/app/api/models/test/route";
import { GET as account } from "../src/app/api/account/route";
import { resetRateLimits } from "../src/lib/server/identity";
import { parseSSE } from "../src/lib/stream";
import type { ChatEvent, ChatRequest } from "../src/lib/contracts";
import type { runAgent } from "../src/lib/server/agent";

const mocked = vi.hoisted(() => ({ getSession: vi.fn(), runAgent: vi.fn() }));
vi.mock("../src/lib/server/account-auth", async (original) => ({
  ...await original<typeof import("../src/lib/server/account-auth")>(),
  getAccountSession: mocked.getSession,
}));
vi.mock("../src/lib/server/agent", () => ({ runAgent: mocked.runAgent }));

const origin = "https://app.example.com";
const user = { id: "aa000000-0000-4000-8000-000000000001", email: "invited@example.com" };
const requestId = "aa000000-0000-4000-8000-000000000002";
const input: ChatRequest = {
  messages: [{ role: "user", content: "Explain this source" }],
  language: "en", mode: "shared", depth: "standard",
};
const summary = {
  credits: { available: 17, held: 0, totalGranted: 20 }, trialCredits: 20,
  costs: { standard: 1, deep: 3 },
  usage: [{ requestId, createdAt: "2026-11-06T00:00:00Z", depth: "deep", units: 3, status: "completed", usedTokens: 85, model: "deepseek-flash" }],
};
function sessionFor(accountUser: typeof user | null = user) {
  return {
    user: accountUser,
    applyCookies(response: Response) {
      response.headers.set("Cache-Control", "no-store");
      response.headers.append("Set-Cookie", "void-account=refreshed-session; Path=/; HttpOnly; Secure; SameSite=Strict");
      return response;
    },
  };
}
function request(path = "/api/chat", body: unknown = input, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(`${origin}${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin, "X-Request-Id": requestId, ...headers },
    body: JSON.stringify(body), ...(signal ? { signal } : {}),
  });
}
type Call = { path: string; body: Record<string, unknown>; init?: RequestInit };
let calls: Call[];
let fixture: (call: Call) => Response | Promise<Response>;
function callsFor(path: string) { return calls.filter(call => call.path === path); }
function settledAccount() { return callsFor("/v1/accounts/settle").map(call => call.body); }
function assertRefreshed(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("set-cookie")).toContain("void-account=refreshed-session");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries({
    DEPLOYMENT_MODE: "hosted",
    ACCOUNT_TRIAL_ENABLED: "true", SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_public_key", TRIAL_ALLOWED_EMAILS: "invited@example.com",
    PUBLIC_APP_ORIGIN: origin, SHARED_MODE_ENABLED: "true", DEEPSEEK_API_KEY: "server-secret",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com", DEEPSEEK_MODEL: "deepseek-flash",
    SESSION_SECRET: "a-long-random-secret-for-testing-session", KNOWLEDGE_API_TOKEN: "knowledge-secret",
    KNOWLEDGE_URL: "http://knowledge.test", TRUST_PROXY: "false",
  })) vi.stubEnv(name, value);
  resetRateLimits();
  mocked.getSession.mockResolvedValue(sessionFor());
  mocked.runAgent.mockResolvedValue({ usedTokens: 85, outcome: "completed" });
  calls = [];
  fixture = ({ path }) => {
    if (path === "/v1/accounts/reserve") return Response.json({ allowed: true, reservationId: "account-hold" });
    if (path === "/v1/budget/reserve") return Response.json({ allowed: true, reservationId: "global-hold", remaining: 1000000 });
    if (path.endsWith("/settle")) return Response.json({ settled: true });
    if (path === "/v1/accounts/summary") return Response.json(summary);
    if (path === "/models") return Response.json({ data: [{ id: "deepseek-flash" }] });
    throw new Error(`Unexpected fixture URL ${path}`);
  };
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : {}, init };
    calls.push(call);
    return fixture(call);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sharedRoutes = [
  { name: "chat", handler: chat, path: "/api/chat", body: input },
  { name: "models/test", handler: testModel, path: "/api/models/test", body: { mode: "shared" } },
];

describe("shared route account admission", () => {
  it.each(sharedRoutes)("requires a verified session before $name upstream access", async ({ handler, path, body }) => {
    mocked.getSession.mockResolvedValue(sessionFor(null));
    const response = await handler(request(path, body));
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("LOGIN_REQUIRED");
    expect(calls).toEqual([]);
    expect(mocked.runAgent).not.toHaveBeenCalled();
    assertRefreshed(response);
  });
  it.each(sharedRoutes)("requires an exact configured Origin for $name", async ({ handler, path, body }) => {
    for (const untrusted of [undefined, "null", "https://evil.example", `${origin}/`]) {
      const incoming = request(path, body);
      if (untrusted === undefined) incoming.headers.delete("origin");
      else incoming.headers.set("origin", untrusted);
      incoming.headers.set("host", "evil.example");
      incoming.headers.set("x-forwarded-host", "evil.example");
      expect((await handler(incoming)).status).toBe(403);
    }
    expect(mocked.getSession).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(mocked.runAgent).not.toHaveBeenCalled();
  });
  it.each(sharedRoutes)("fails closed when trial auth is disabled for $name", async ({ handler, path, body }) => {
    vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "false");
    expect((await handler(request(path, body))).status).toBe(503);
    expect(mocked.getSession).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it.each([
    ["insufficient_credits", 402, "CREDITS_EXHAUSTED"],
    ["in_progress", 409, "ACCOUNT_BUSY"],
    ["duplicate_request", 409, "REQUEST_REPLAY"],
  ])("rejects %s before global reservation or model dispatch", async (reason, status, code) => {
    fixture = () => Response.json({ allowed: false, reason });
    const response = await chat(request());
    expect(response.status).toBe(status);
    expect(await response.text()).toContain(code);
    expect(calls.map(call => call.path)).toEqual(["/v1/accounts/reserve"]);
    expect(mocked.runAgent).not.toHaveBeenCalled();
    assertRefreshed(response);
  });
  it.each([undefined, "", "not-a-uuid"])("requires a valid request UUID (%s)", async id => {
    const incoming = request();
    if (id === undefined) incoming.headers.delete("X-Request-Id");
    else incoming.headers.set("X-Request-Id", id);
    const response = await chat(incoming);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("REQUEST_ID_REQUIRED");
    expect(calls).toEqual([]);
    expect(mocked.runAgent).not.toHaveBeenCalled();
  });
  it("rejects a client-selected account ID in the JSON body", async () => {
    expect((await chat(request("/api/chat", { ...input, accountId: "victim" }))).status).toBe(400);
    expect(calls).toEqual([]);
    expect(mocked.runAgent).not.toHaveBeenCalled();
  });
  it("uses only verified ownership for reservation, settlement, and global identity", async () => {
    const response = await chat(request("/api/chat?accountId=victim", { ...input, depth: "deep" }, {
      "X-Account-Id": "victim", "X-Model-Api-Key": "visitor-secret",
    }));
    expect(response.status).toBe(200);
    await response.text();
    expect(callsFor("/v1/accounts/reserve")[0].body).toEqual({ accountId: user.id, requestId, depth: "deep", model: "deepseek-flash" });
    expect(settledAccount()).toEqual([{ accountId: user.id, reservationId: "account-hold", outcome: "completed", usedTokens: 85 }]);
    expect(callsFor("/v1/budget/reserve")[0].body.identity).toBe(createHash("sha256").update(user.id).digest("hex"));
    expect(mocked.runAgent.mock.calls[0][1].key).toBe("server-secret");
    expect(calls.every(call => new Headers(call.init?.headers).get("X-Knowledge-Token") === "knowledge-secret")).toBe(true);
    assertRefreshed(response);
  });
  it.each(["completed", "released"] as const)("does not run a replay after the first request was %s", async outcome => {
    mocked.runAgent.mockResolvedValue({ usedTokens: 85, outcome });
    const fallback = fixture;
    const seen = new Set<unknown>();
    fixture = call => {
      if (call.path === "/v1/accounts/reserve") {
        if (seen.has(call.body.requestId)) return Response.json({ allowed: false, reason: "duplicate_request" });
        seen.add(call.body.requestId);
      }
      return fallback(call);
    };
    await (await chat(request())).text();
    expect((await chat(request())).status).toBe(409);
    expect(mocked.runAgent).toHaveBeenCalledOnce();
    expect(callsFor("/v1/budget/reserve")).toHaveLength(1);
    expect(settledAccount()).toHaveLength(1);
  });
  it("keeps BYOK available without an account or ledger reservation", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "false");
    const response = await chat(request("/api/chat", { ...input, mode: "byok" }, { "X-Model-Api-Key": "visitor-secret" }));
    expect(response.status).toBe(200);
    await response.text();
    expect(mocked.getSession).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(mocked.runAgent.mock.calls[0][1].key).toBe("visitor-secret");
  });
});

describe("account settlement lifecycle", () => {
  it.each(["completed", "released"] as const)("commits %s credits before the real client consumes a terminal event and refreshes balance", async outcome => {
    const terminal: ChatEvent = outcome === "completed"
      ? { event: "done", data: { snapshotId: "snapshot", finishReason: "stop" } }
      : { event: "error", data: { code: "MODEL_UNAVAILABLE", message: "Try again", retryable: true } };
    let finishAgent!: (result: Awaited<ReturnType<typeof runAgent>>) => void;
    mocked.runAgent.mockImplementation((_input: ChatRequest, options: Parameters<typeof runAgent>[1]) => {
      options.emit({ event: "text_delta", data: { text: "Answer" } });
      options.emit(terminal);
      return new Promise(resolve => { finishAgent = resolve; });
    });
    let commitSettlement!: () => void;
    let committed = false;
    const fallback = fixture;
    fixture = call => {
      if (call.path === "/v1/accounts/settle") return new Promise(resolve => {
        commitSettlement = () => { committed = true; resolve(Response.json({ settled: true })); };
      });
      if (call.path === "/v1/accounts/summary") return Response.json({
        ...summary, credits: { available: committed ? outcome === "completed" ? 19 : 20 : 19, held: committed ? 0 : 1, totalGranted: 20 },
      });
      return fallback(call);
    };
    const response = await chat(request());
    const events: string[] = [];
    let refreshed: { credits: { available: number; held: number } } | undefined;
    const consume = (async () => {
      for await (const event of parseSSE(response.body!)) events.push(event.event);
      // The UI refreshes account state as soon as the SSE consumer returns.
      refreshed = await (await account(new Request(`${origin}/api/account`))).json();
    })();
    await vi.waitFor(() => expect(events).toContain("text_delta"));
    expect(events).toEqual(["text_delta"]);
    expect(callsFor("/v1/accounts/summary")).toEqual([]);
    finishAgent({ outcome, usedTokens: 85 });
    await vi.waitFor(() => expect(callsFor("/v1/accounts/settle")).toHaveLength(1));
    expect(events).toEqual(["text_delta"]);
    commitSettlement();
    await consume;
    expect(events).toEqual(["text_delta", terminal.event]);
    expect(settledAccount()[0]).toMatchObject({ outcome, usedTokens: 85 });
    expect(refreshed?.credits).toMatchObject({ available: outcome === "completed" ? 19 : 20, held: 0 });
  });
  it.each(["denied", "malformed", "unavailable"])("refunds account admission when global budget is %s", async failure => {
    const fallback = fixture;
    fixture = call => call.path !== "/v1/budget/reserve" ? fallback(call) :
      failure === "denied" ? Response.json({ allowed: false }) :
      failure === "malformed" ? Response.json({ allowed: true }) : new Response("internal-service-secret", { status: 503 });
    const response = await chat(request());
    expect(response.status).toBe(failure === "denied" ? 429 : 503);
    expect(await response.text()).not.toContain("internal-service-secret");
    expect(settledAccount()).toEqual([{ accountId: user.id, reservationId: "account-hold", outcome: "released", usedTokens: 0 }]);
    expect(callsFor("/v1/budget/settle")).toEqual([]);
    expect(mocked.runAgent).not.toHaveBeenCalled();
    assertRefreshed(response);
  });
  it.each([
    { outcome: "completed", usedTokens: 85 },
    { outcome: "completed", usedTokens: null },
    { outcome: "released", usedTokens: 85 },
    { outcome: "released", usedTokens: null },
    { outcome: "released", usedTokens: 0 },
  ] as const)("settles $outcome independently of token accounting ($usedTokens)", async result => {
    mocked.runAgent.mockResolvedValue(result);
    const response = await chat(request());
    await response.text();
    expect(settledAccount()).toEqual([{ accountId: user.id, reservationId: "account-hold", ...result }]);
    expect(callsFor("/v1/budget/settle").map(call => call.body)).toEqual([{ reservationId: "global-hold", usedTokens: result.usedTokens }]);
    assertRefreshed(response);
  });
  it("releases the account if the agent unexpectedly throws", async () => {
    mocked.runAgent.mockRejectedValue(new Error("private-agent-detail"));
    const response = await chat(request());
    expect(await response.text()).not.toContain("private-agent-detail");
    expect(settledAccount()).toEqual([{ accountId: user.id, reservationId: "account-hold", outcome: "released", usedTokens: null }]);
  });
  it.each(["request abort", "reader cancel"])("releases after %s with settlement signals independent of the browser", async cancellation => {
    let finish!: (result: Awaited<ReturnType<typeof runAgent>>) => void;
    mocked.runAgent.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const response = await chat(request("/api/chat", input, {}, controller.signal));
    if (cancellation === "request abort") {
      controller.abort();
      await response.text();
    } else await response.body!.cancel();
    expect(mocked.runAgent.mock.calls[0][1].signal.aborted).toBe(true);
    finish({ usedTokens: 85, outcome: "completed" });
    await vi.waitFor(() => expect(settledAccount()).toHaveLength(1));
    expect(settledAccount()[0]).toEqual({ accountId: user.id, reservationId: "account-hold", outcome: "released", usedTokens: 85 });
    const settlements = calls.filter(call => call.path.endsWith("/settle"));
    expect(settlements).toHaveLength(2);
    expect(settlements.every(call => call.init?.signal && !call.init.signal.aborted)).toBe(true);
  });
  it.each(["unavailable", "malformed"])("retries a %s account settlement with the identical payload", async failure => {
    const fallback = fixture;
    let attempts = 0;
    fixture = call => {
      if (call.path === "/v1/accounts/settle" && attempts++ === 0)
        return failure === "unavailable" ? new Response("temporary-outage", { status: 503 }) : Response.json({});
      return fallback(call);
    };
    await (await chat(request())).text();
    expect(settledAccount()).toHaveLength(2);
    expect(settledAccount()[1]).toEqual(settledAccount()[0]);
    expect(callsFor("/v1/budget/settle")).toHaveLength(1);
  });
  it("bounds failed settlement retries and leaves lease recovery explicit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fallback = fixture;
    fixture = call => call.path === "/v1/accounts/settle" ? new Response("private-outage-detail", { status: 503 }) : fallback(call);
    const response = await chat(request());
    await response.text();
    expect(settledAccount()).toHaveLength(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith("ACCOUNT_SETTLEMENT_DEFERRED");
  });
});

describe("private account summary", () => {
  it("returns disabled state without session or ledger access", async () => {
    vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "false");
    const response = await account(new Request(`${origin}/api/account`));
    expect(await response.json()).toEqual({ enabled: false, authenticated: false });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocked.getSession).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
  it("returns signed-out state without granting credits", async () => {
    mocked.getSession.mockResolvedValue(sessionFor(null));
    const response = await account(new Request(`${origin}/api/account`));
    expect(await response.json()).toEqual({ enabled: true, authenticated: false });
    expect(calls).toEqual([]);
    assertRefreshed(response);
  });
  it("reads each verified account independently and ignores attacker account selectors", async () => {
    const second = { id: "bb000000-0000-4000-8000-000000000001", email: "second@example.com" };
    mocked.getSession.mockResolvedValueOnce(sessionFor(user)).mockResolvedValueOnce(sessionFor(second));
    fixture = call => Response.json({ ...summary, usage: [{ ...summary.usage[0], requestId: call.body.accountId }] });
    for (const current of [user, second]) {
      const response = await account(new Request(`${origin}/api/account?accountId=victim`, { headers: { "X-Account-Id": "victim" } }));
      const result = await response.json();
      expect(result).toMatchObject({ enabled: true, authenticated: true, user: current, credits: summary.credits, usage: [{ requestId: current.id }] });
      expect(JSON.stringify(result)).not.toContain("refreshed-session");
      assertRefreshed(response);
    }
    expect(calls.map(call => call.body)).toEqual([{ accountId: user.id }, { accountId: second.id }]);
    expect(calls.every(call => call.path === "/v1/accounts/summary" && call.init?.cache === "no-store")).toBe(true);
  });
  it("reports ledger failure explicitly instead of displaying zero credits", async () => {
    fixture = () => new Response("private-ledger-detail", { status: 503 });
    const response = await account(new Request(`${origin}/api/account`));
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({ error: { code: "KNOWLEDGE_UNAVAILABLE" } });
    expect(result).not.toHaveProperty("credits");
    expect(JSON.stringify(result)).not.toContain("private-ledger-detail");
    assertRefreshed(response);
  });
});

describe("authenticated shared model connectivity", () => {
  it("uses the server key without spending credits or generating content", async () => {
    const response = await testModel(request("/api/models/test", { mode: "shared" }, { "X-Model-Api-Key": "visitor-secret" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, model: "deepseek-flash" });
    expect(calls.map(call => call.path)).toEqual(["/models"]);
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer server-secret");
    expect(mocked.runAgent).not.toHaveBeenCalled();
    assertRefreshed(response);
  });
  it("retains refreshed cookies when the provider rejects the connectivity test", async () => {
    fixture = () => new Response("server-secret", { status: 401 });
    const response = await testModel(request("/api/models/test", { mode: "shared" }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("server-secret");
    assertRefreshed(response);
  });
});
