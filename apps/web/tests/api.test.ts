import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chat } from "../src/app/api/chat/route";
import { POST as testModel } from "../src/app/api/models/test/route";
import { GET as status } from "../src/app/api/status/route";
import { GET as library } from "../src/app/api/library/route";
import { resetRateLimits } from "../src/lib/server/identity";

const body = {
  messages: [{ role: "user", content: "test" }],
  language: "en",
  mode: "byok",
  depth: "standard",
};
const req = (data: unknown = body, key: string | null = "test-user-key") =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-Model-Api-Key": key } : {}),
    },
    body: JSON.stringify(data),
  });
describe("public API bounds and credential handling", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    { ...body, messages: Array(25).fill({ role: "user", content: "x" }) },
    { ...body, messages: [{ role: "user", content: "x".repeat(12001) }] },
    {
      ...body,
      messages: Array(5).fill({ role: "user", content: "x".repeat(10000) }),
    },
    { ...body, messages: [{ role: "assistant", content: "x" }] },
    { ...body, messages: [{ role: "user", content: "  " }] },
    { ...body, baseUrl: "https://evil.test" },
    { ...body, mode: "auto" },
  ])("rejects invalid chat input before any upstream fetch", async (data) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await chat(req(data))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { field: "language", value: ["en"] },
    { field: "language", value: { value: "en" } },
    { field: "language", value: null },
    { field: "language", value: 1 },
    { field: "depth", value: ["deep"] },
    { field: "depth", value: { value: "deep" } },
    { field: "depth", value: null },
    { field: "depth", value: 1 },
  ])(
    "rejects non-string $field before shared quota reservation",
    async ({ field, value }) => {
      vi.stubEnv("SHARED_MODE_ENABLED", "true");
      vi.stubEnv("DEEPSEEK_API_KEY", "server-secret");
      vi.stubEnv("SESSION_SECRET", "long-random-secret-for-enum-regression");
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      expect(
        (await chat(req({ ...body, mode: "shared", [field]: value }, null)))
          .status,
      ).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    { value: ["en"] },
    { value: { locale: "en" } },
    { value: null },
    { value: 1 },
    { value: "fr" },
  ])(
    "rejects invalid answer-language values before upstream work",
    async ({ value }) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      expect((await chat(req({ ...body, answerLanguage: value }))).status).toBe(
        400,
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("accepts an explicit answer language without changing source-language validation", async () => {
    let queryLanguage = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        queryLanguage = JSON.parse(String(init?.body)).language;
        return Response.json({
          sources: [],
          snapshotId: "s",
          mode: "lexical",
          total: 0,
        });
      }),
    );
    const response = await chat(
      req({ ...body, language: "zh-CN", answerLanguage: "en" }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("No matching evidence");
    expect(queryLanguage).toBe("zh-CN");
  });
  it("requires explicit BYOK key and never falls back to shared env", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "server-secret");
    vi.stubEnv("SHARED_MODE_ENABLED", "true");
    expect((await chat(req(body, null))).status).toBe(401);
  });
  it("does not activate shared mode merely because a shared key exists", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "server-secret");
    expect((await chat(req({ ...body, mode: "shared" }, null))).status).toBe(
      503,
    );
  });
  it("tests via model listing without generation and masks upstream authentication failure", async () => {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL) =>
        new Response("test-user-key SECRET stack", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await testModel(req({ mode: "byok" }));
    const data = await response.json();
    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(JSON.stringify(data)).not.toContain("SECRET");
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.deepseek.com/models",
    );
  });
  it("confirms the configured model through GET models without generating a completion", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        calls.push(String(url));
        return Response.json({ data: [{ id: "deepseek-flash" }] });
      }),
    );
    const response = await testModel(req({ mode: "byok" }));
    expect(await response.json()).toMatchObject({
      ok: true,
      model: "deepseek-flash",
    });
    expect(calls).toEqual(["https://api.deepseek.com/models"]);
  });
  it("tests a BYOK model override at the configured endpoint without generation", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: "my-model" }] }));
    vi.stubGlobal("fetch", fetcher);
    const response = await testModel(req({ mode: "byok", provider: { model: "my-model" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, model: "my-model" });
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it.each([{}, { model: "my-model" }, { baseUrl: "https://public.example/v1" }])(
    "rejects shared provider overrides before keys, quota or network: %j", async provider => {
      vi.stubEnv("DEEPSEEK_API_KEY", "server-secret");
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const response = await chat(req({ ...body, mode: "shared", provider }, null));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "PROVIDER_BYOK_ONLY" } });
      const testResponse = await testModel(req({ mode: "shared", provider }, null));
      expect(testResponse.status).toBe(400);
      expect(await testResponse.json()).toMatchObject({ code: "PROVIDER_BYOK_ONLY" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("refuses an unallowlisted provider origin before sending a key", async () => {
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://evil.example");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await chat(req())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns provider configuration and explicit knowledge outage without invented corpus counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("SECRET");
      }),
    );
    const response = await status();
    const data = await response.json();
    expect(data).toMatchObject({
      ready: false,
      provider: { model: "deepseek-flash", byok: true, sharedEnabled: false },
      error: { code: "KNOWLEDGE_UNAVAILABLE" },
    });
    expect(data.documentCount).toBeUndefined();
    expect(data.chunkCount).toBeUndefined();
  });
  it("rejects proxy query injection and out-of-range pages", async () => {
    expect(
      (await library(new Request("http://localhost/api/library?page=-1")))
        .status,
    ).toBe(400);
    expect(
      (
        await library(
          new Request("http://localhost/api/library?baseUrl=https://evil.test"),
        )
      ).status,
    ).toBe(400);
  });
  it("sends BYOK credentials only to fixed upstream and never writes a cookie in BYOK", async () => {
    const calls: { url: string; key: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({
          url: String(url),
          key: new Headers(init?.headers).get("authorization"),
        });
        return String(url).includes("/v1/search")
          ? Response.json({
              sources: [],
              snapshotId: "s",
              mode: "lexical",
              total: 0,
            })
          : Response.json({ data: [{ id: "deepseek-flash" }] });
      }),
    );
    const response = await chat(req());
    await response.text();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls[0].key).toBeNull();
  });
});
