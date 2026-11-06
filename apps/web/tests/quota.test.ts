import { allowRisk, verifiedDeviceCookies } from "./helpers/account-risk";
import { stubFetch as stubModelFetch } from "./helpers/model-fetch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as testModel } from "../src/app/api/models/test/route";
import { worstCaseTokens, sharedEnabled } from "../src/lib/server/config";
import type { ChatRequest } from "../src/lib/contracts";
import { POST as chat } from "../src/app/api/chat/route";
import { issueIdentity, resetRateLimits } from "../src/lib/server/identity";

vi.mock("../src/lib/server/account-auth", async (original) => ({
  ...await original<typeof import("../src/lib/server/account-auth")>(),
  getAccountSession: vi.fn(async () => ({
    user: { id: "aa000000-0000-4000-8000-000000000001", email: "invited@example.com" },
    applyCookies: (response: Response) => response,
  })),
}));

// Account admission is independent of the global token-budget assertions below.
// Keep the existing real DSH transport and external model fixtures intact.
function stubFetch(mock: typeof fetch) {
  stubModelFetch((async (url, init) => {
    if (String(url).endsWith("/v1/accounts/risk/check")) return allowRisk();
    if (String(url).endsWith("/v1/accounts/reserve"))
      return Response.json({ allowed: true, reservationId: "account-reservation" });
    if (String(url).endsWith("/v1/accounts/settle"))
      return Response.json({ settled: true });
    return mock(url, init);
  }) as typeof fetch);
}

let proofCookies: string;
const accountId = "aa000000-0000-4000-8000-000000000001";
const requestId = "aa000000-0000-4000-8000-000000000002";
const body = {
  messages: [{ role: "user", content: "test" }],
  language: "en",
  mode: "shared",
  depth: "standard",
};
const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", "X-Request-Id": requestId, cookie: proofCookies, ...headers },
    body: JSON.stringify(body),
  });
describe("request-sized quota bounds", () => {
  it("reserves less for short histories while retaining a bound for all five rounds", () => {
    const short = worstCaseTokens(body as ChatRequest);
    const long = worstCaseTokens({
      ...body,
      messages: [{ role: "user", content: "长".repeat(12000) }],
    } as ChatRequest);
    expect(short).toBeLessThan(800000);
    expect(long).toBeGreaterThan(short + 100000);
  });
});
describe("shared budget and identity", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("SHARED_MODE_ENABLED", "true");
    vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "true");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_public_key");
    vi.stubEnv("TRIAL_ALLOWED_EMAILS", "invited@example.com");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "http://localhost");
    vi.stubEnv("DEEPSEEK_API_KEY", "server-secret");
    vi.stubEnv("SESSION_SECRET", "a-long-random-secret-for-testing-session");
    resetRateLimits();
    proofCookies = await verifiedDeviceCookies("http://localhost", accountId);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("denies quota before any model generation", async () => {
    const calls: string[] = [];
    stubFetch(
      vi.fn(async (url) => {
        calls.push(String(url));
        return Response.json({
          allowed: false,
          reservationId: "",
          remaining: 0,
        });
      }),
    );
    const response = await chat(req());
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/v1/budget/reserve");
  });
  it("settles zero when forced retrieval is empty and uses server key only in shared mode", async () => {
    const bodies: any[] = [];
    stubFetch(
      vi.fn(async (url, init) => {
        bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        if (String(url).endsWith("/reserve"))
          return Response.json({
            allowed: true,
            reservationId: "r1",
            remaining: 100,
          });
        if (String(url).endsWith("/settle"))
          return Response.json({ settled: true });
        return Response.json({
          sources: [],
          snapshotId: "s",
          mode: "lexical",
          total: 0,
        });
      }),
    );
    const response = await chat(req({ "X-Model-Api-Key": "other-user-key" }));
    await response.text();
    expect(bodies.at(-1).body).toEqual({ reservationId: "r1", usedTokens: 0 });
    expect(bodies[0].body.identity).not.toContain("other-user-key");
    expect(bodies[0].body.tokens).toBeGreaterThan(4096);
  });
  it("keeps worst-case quota reserved when provider billing is unknown", async () => {
    let settlement: any;
    stubFetch(
      vi.fn(async (url, init) => {
        if (String(url).endsWith("/reserve"))
          return Response.json({
            allowed: true,
            reservationId: "r1",
            remaining: 100,
          });
        if (String(url).endsWith("/settle")) {
          settlement = JSON.parse(String(init?.body));
          return Response.json({ settled: true });
        }
        if (String(url).includes("/v1/search"))
          return Response.json({
            sources: [
              {
                id: "a",
                documentId: "d",
                title: "T",
                type: "book",
                language: "en",
                text: "Evidence",
                path: "p",
                locator: "l",
                sourceUrl: "https://example.com",
                snapshotId: "s",
              },
            ],
            snapshotId: "s",
            mode: "lexical",
            total: 1,
          });
        return new Response("server-secret", { status: 500 });
      }),
    );
    const response = await chat(req());
    expect(await response.text()).not.toContain("server-secret");
    expect(settlement).toEqual({ reservationId: "r1", usedTokens: null });
  });
  it.each([
    {
      name: "DeepSeek cached input",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 900,
      },
      complete: true,
      expected: 1050,
    },
    {
      name: "OpenAI cached reads and writes",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 850, cache_write_tokens: 100 },
      },
      complete: true,
      expected: 1050,
    },
    {
      name: "positive usage followed by incomplete stream",
      usage: { prompt_tokens: 1000, completion_tokens: 50 },
      complete: false,
      expected: null,
    },
    {
      name: "missing input counter",
      usage: { completion_tokens: 50 },
      complete: true,
      expected: null,
    },
    {
      name: "missing output counter",
      usage: { prompt_tokens: 1000 },
      complete: true,
      expected: null,
    },
    {
      name: "ambiguous zero ordinary input",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 1000,
      },
      complete: true,
      expected: null,
    },
  ])(
    "settles $name conservatively through the real DSH stream",
    async ({ usage, complete, expected }) => {
      let settlement: any;
      stubFetch(
        vi.fn(async (url, init) => {
          if (String(url).endsWith("/reserve"))
            return Response.json({
              allowed: true,
              reservationId: "usage-check",
              remaining: 1000000,
            });
          if (String(url).endsWith("/settle")) {
            settlement = JSON.parse(String(init?.body));
            return Response.json({ settled: true });
          }
          if (String(url).includes("/v1/search"))
            return Response.json({
              snapshotId: "s",
              mode: "lexical",
              total: 1,
              sources: [
                {
                  id: "a",
                  documentId: "d",
                  title: "Evidence",
                  type: "book",
                  language: "en",
                  text: "Original evidence",
                  path: "p",
                  locator: "1",
                  sourceUrl: "https://example.com",
                  snapshotId: "s",
                },
              ],
            });
          const chunk = {
            choices: [
              {
                index: 0,
                delta: { content: "Answer[1]" },
                finish_reason: complete ? "stop" : null,
              },
            ],
            usage,
          };
          return new Response(
            "data: " +
              JSON.stringify(chunk) +
              "\n\n" +
              (complete ? "data: [DONE]\n\n" : ""),
            { headers: { "content-type": "text/event-stream" } },
          );
        }),
      );
      const response = await chat(req());
      const stream = await response.text();
      expect(settlement).toEqual({
        reservationId: "usage-check",
        usedTokens: expected,
      });
      if (complete) {
        expect(stream).toContain("event: done");
        if (expected === null) expect(stream).not.toContain('"usage"');
        else expect(stream).toContain('"inputTokens":1000');
      } else expect(stream).toContain("MODEL_STREAM_INCOMPLETE");
    },
  );
  it("signs and verifies session cookies and ignores forged session ids", () => {
    const one = issueIdentity(req());
    const two = issueIdentity(req({ cookie: one.cookie!.split(";")[0] }));
    expect(two.identity).toBe(one.identity);
    expect(two.cookie).toBeUndefined();
    const forged = issueIdentity(
      req({ cookie: "void-session=forged.invalid" }),
    );
    expect(forged.identity).not.toBe(one.identity);
  });
  it("limits repeated requests by trusted network bucket even with rotating sessions", () => {
    for (let i = 0; i < 10; i++) issueIdentity(req());
    expect(() => issueIdentity(req())).toThrow(/rate/i);
  });
  it("accepts the configured public TLS origin behind a production standalone proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KNOWLEDGE_API_TOKEN", "internal-test-token");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://void.example.com");
    vi.stubEnv("TRUST_PROXY", "true");
    const fetcher = vi.fn(async (_url: RequestInfo | URL) =>
      Response.json({ data: [{ id: "deepseek-flash" }] }),
    );
    stubFetch(fetcher);
    const response = await testModel(
      new Request("https://0.0.0.0:3000/api/models/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Request-Id": requestId,
          cookie: proofCookies,
          host: "void.example.com",
          origin: "https://void.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({ mode: "shared" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reserves and streams shared chat for the public origin through the standalone proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KNOWLEDGE_API_TOKEN", "internal-test-token");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://void.example.com");
    vi.stubEnv("TRUST_PROXY", "true");
    const paths: string[] = [];
    stubFetch(
      vi.fn(async (url) => {
        paths.push(String(url));
        if (String(url).endsWith("/reserve"))
          return Response.json({
            allowed: true,
            reservationId: "public-origin-chat",
            remaining: 100,
          });
        if (String(url).endsWith("/settle"))
          return Response.json({ settled: true });
        return Response.json({
          sources: [],
          snapshotId: "s",
          mode: "lexical",
          total: 0,
        });
      }),
    );
    const response = await chat(
      new Request("https://0.0.0.0:3000/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Request-Id": requestId,
          cookie: proofCookies,
          host: "void.example.com",
          origin: "https://void.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"finishReason":"no_evidence"');
    expect(paths.some((path) => path.endsWith("/reserve"))).toBe(true);
    expect(paths.at(-1)).toContain("/settle");
  });
  it("rejects a foreign origin despite attacker-controlled forwarded host headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KNOWLEDGE_API_TOKEN", "internal-test-token");
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://void.example.com");
    vi.stubEnv("TRUST_PROXY", "true");
    const fetcher = vi.fn();
    stubFetch(fetcher);
    const response = await testModel(
      new Request("https://0.0.0.0:3000/api/models/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          host: "evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ mode: "shared" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "http://void.example.com",
    "https://void.example.com/path",
    "https://user:secret@void.example.com",
    "https://void.example.com?x=1",
  ])(
    "disables production shared mode for unsafe public origin %s",
    async (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("KNOWLEDGE_API_TOKEN", "internal-test-token");
      vi.stubEnv("PUBLIC_APP_ORIGIN", value);
      expect(sharedEnabled()).toBe(false);
      const fetcher = vi.fn();
      stubFetch(fetcher);
      expect((await chat(req())).status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("requires a production session secret and internal knowledge token for shared mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    expect((await chat(req())).status).toBe(503);
  });
});
