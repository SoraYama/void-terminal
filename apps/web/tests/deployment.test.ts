import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentMode } from "../src/lib/server/deployment";
import { credentials, sharedEnabled } from "../src/lib/server/config";
import { accountAuthEnabled } from "../src/lib/server/account-auth";
import { POST as chat } from "../src/app/api/chat/route";
import { POST as testModel } from "../src/app/api/models/test/route";
import { GET as status } from "../src/app/api/status/route";
import { GET as account } from "../src/app/api/account/route";
import { POST as sendCode } from "../src/app/api/auth/send-code/route";
import { POST as verifyCode } from "../src/app/api/auth/verify-code/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { openProviderTransport, resolveProvider } from "../src/lib/server/provider";

const mocked = vi.hoisted(() => ({ getSession: vi.fn(), runAgent: vi.fn() }));
vi.mock("../src/lib/server/account-auth", async (original) => ({
  ...await original<typeof import("../src/lib/server/account-auth")>(),
  getAccountSession: mocked.getSession,
}));
vi.mock("../src/lib/server/agent", () => ({ runAgent: mocked.runAgent }));
vi.mock("../src/lib/server/provider", async (original) => {
  const actual = await original<typeof import("../src/lib/server/provider")>();
  return { ...actual, resolveProvider: vi.fn(actual.resolveProvider), openProviderTransport: vi.fn(actual.openProviderTransport) };
});

const origin = "https://app.example.com";
const chatBody = { messages: [{ role: "user", content: "Question" }], language: "en", depth: "standard" };
const routes = [
  { name: "chat", handler: chat, path: "/api/chat", body: chatBody },
  { name: "models/test", handler: testModel, path: "/api/models/test", body: {} },
];
const authRoutes = [
  { name: "send-code", handler: sendCode },
  { name: "verify-code", handler: verifyCode },
  { name: "logout", handler: logout },
];
function request(path: string, body: unknown, key = "visitor-secret") {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "X-Model-Api-Key": key, cookie: "void-account=stale-account-cookie" },
    body: JSON.stringify(body),
  });
}
function assertNoDispatch() {
  expect(mocked.getSession).not.toHaveBeenCalled();
  expect(mocked.runAgent).not.toHaveBeenCalled();
  expect(resolveProvider).not.toHaveBeenCalled();
  expect(openProviderTransport).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}
async function expectError(response: Response, code: string, statusCode: number) {
  expect(response.status).toBe(statusCode);
  const result = await response.json();
  expect(result.error?.code ?? result.code).toBe(code);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(JSON.stringify(result)).not.toMatch(/visitor-secret|server-secret|stale-account-cookie|publishable_fixture/);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    NODE_ENV: "test", DEPLOYMENT_MODE: "self-hosted",
    ACCOUNT_TRIAL_ENABLED: "true", SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_public_key", TRIAL_ALLOWED_EMAILS: "invited@example.com",
    PUBLIC_APP_ORIGIN: origin, SHARED_MODE_ENABLED: "true", DEEPSEEK_API_KEY: "server-secret",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com", DEEPSEEK_ALLOWED_BASE_URLS: "", DEEPSEEK_MODEL: "deepseek-flash",
    SESSION_SECRET: "a-long-random-secret-for-testing-session", KNOWLEDGE_API_TOKEN: "knowledge-secret",
    KNOWLEDGE_URL: "http://knowledge.test", TRUST_PROXY: "false",
  })) vi.stubEnv(name, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected upstream request"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("runtime deployment profile", () => {
  it("defaults only an absent environment variable to self-hosted", () => {
    vi.stubEnv("DEPLOYMENT_MODE", undefined);
    expect(deploymentMode()).toBe("self-hosted");
    expect(sharedEnabled()).toBe(false);
    expect(accountAuthEnabled()).toBe(false);
    expect(credentials("byok", request("/api/chat", {}))).toBe("visitor-secret");
  });
  it("reads the runtime value again without module reload or build-time caching", () => {
    expect(deploymentMode()).toBe("self-hosted");
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    expect(deploymentMode()).toBe("hosted");
    expect(sharedEnabled()).toBe(true);
    expect(accountAuthEnabled()).toBe(true);
    vi.stubEnv("DEPLOYMENT_MODE", "self-hosted");
    expect(deploymentMode()).toBe("self-hosted");
    expect(sharedEnabled()).toBe(false);
    expect(accountAuthEnabled()).toBe(false);
  });
  it.each(["", "HOSTED", "self_hosted", "hosted ", " hosted", "unknown"])("fails closed for explicit profile %j", (value) => {
    vi.stubEnv("DEPLOYMENT_MODE", value);
    for (const operation of [deploymentMode, sharedEnabled, accountAuthEnabled])
      expect(operation).toThrowError(expect.objectContaining({ code: "DEPLOYMENT_CONFIG", status: 503 }));
    const incoming = request("/api/chat", {});
    const readHeader = vi.spyOn(incoming.headers, "get");
    expect(() => credentials("byok", incoming)).toThrowError(expect.objectContaining({ code: "DEPLOYMENT_CONFIG", status: 503 }));
    expect(readHeader).not.toHaveBeenCalled();
    assertNoDispatch();
  });
  it.each([
    { profile: "self-hosted", mode: "shared" as const },
    { profile: "hosted", mode: "byok" as const },
  ])("rejects $mode credentials in $profile before reading any request header", ({ profile, mode }) => {
    vi.stubEnv("DEPLOYMENT_MODE", profile);
    const incoming = request("/api/chat", {}, "malformed key with spaces");
    const readHeader = vi.spyOn(incoming.headers, "get");
    expect(() => credentials(mode, incoming)).toThrowError(expect.objectContaining({ code: "MODE_NOT_ALLOWED", status: 403 }));
    expect(readHeader).not.toHaveBeenCalled();
    assertNoDispatch();
  });
  it("uses the configured hosted key and ignores an injected visitor key", () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    const incoming = request("/api/chat", {});
    const readHeader = vi.spyOn(incoming.headers, "get");
    expect(credentials("shared", incoming)).toBe("server-secret");
    expect(readHeader).not.toHaveBeenCalled();
  });
});

describe.each(routes)("$name deployment admission", ({ handler, path, body }) => {
  it.each([undefined, "self-hosted"])("rejects shared mode with profile %j despite complete stray account and server-key configuration", async (profile) => {
    vi.stubEnv("DEPLOYMENT_MODE", profile);
    await expectError(await handler(request(path, { ...body, mode: "shared" })), "MODE_NOT_ALLOWED", 403);
    assertNoDispatch();
  });
  it.each([undefined, { model: "forged-model", baseUrl: "https://attacker.example/v1" }, { baseUrl: 123 }])("rejects hosted BYOK and forged provider %j before provider validation or dispatch", async (provider) => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    await expectError(await handler(request(path, { ...body, mode: "byok", ...(provider ? { provider } : {}) })), "MODE_NOT_ALLOWED", 403);
    assertNoDispatch();
  });
  it("rejects a self-hosted shared provider override with the same mode denial", async () => {
    await expectError(await handler(request(path, { ...body, mode: "shared", provider: { model: "forged-model" } })), "MODE_NOT_ALLOWED", 403);
    assertNoDispatch();
  });
  it.each(["byok", "shared"])("rejects %s for malformed deployment configuration before all upstream work", async (mode) => {
    vi.stubEnv("DEPLOYMENT_MODE", "malformed");
    await expectError(await handler(request(path, { ...body, mode })), "DEPLOYMENT_CONFIG", 503);
    assertNoDispatch();
  });
  it.each([
    ["ACCOUNT_TRIAL_ENABLED", "false"], ["SUPABASE_PUBLISHABLE_KEY", ""],
    ["SHARED_MODE_ENABLED", "false"], ["DEEPSEEK_API_KEY", ""], ["SESSION_SECRET", ""],
    ["PUBLIC_APP_ORIGIN", ""],
  ])("keeps hosted unavailable when %s is missing and refuses a BYOK fallback", async (name, value) => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv(name, value);
    const result = await expectError(await handler(request(path, { ...body, mode: "shared" })), "SHARED_DISABLED", 503);
    expect(JSON.stringify(result)).not.toMatch(/use your own|own api key/i);
    await expectError(await handler(request(path, { ...body, mode: "byok" })), "MODE_NOT_ALLOWED", 403);
    assertNoDispatch();
  });
  it("fails closed in hosted production without the knowledge service token", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KNOWLEDGE_API_TOKEN", "");
    await expectError(await handler(request(path, { ...body, mode: "shared" })), "SHARED_DISABLED", 503);
    assertNoDispatch();
  });
});

describe("profile metadata and self-hosted account independence", () => {
  it.each(["self-hosted", "hosted"])("reports %s mode during a knowledge outage without secrets or fabricated corpus data", async (profile) => {
    vi.stubEnv("DEPLOYMENT_MODE", profile);
    const response = await status();
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({
      ready: false, deployment: { mode: profile },
      provider: { model: "deepseek-flash", byok: profile === "self-hosted", sharedEnabled: profile === "hosted" },
      error: { code: "KNOWLEDGE_UNAVAILABLE" },
    });
    expect(result.documentCount).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/server-secret|knowledge-secret|publishable_fixture/);
  });
  it("keeps hosted metadata when auth is not configured", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "false");
    expect(await (await status()).json()).toMatchObject({ deployment: { mode: "hosted" }, provider: { byok: false, sharedEnabled: false } });
  });
  it.each([undefined, "self-hosted"])("returns disabled account state for %j without touching sessions or the ledger", async (profile) => {
    vi.stubEnv("DEPLOYMENT_MODE", profile);
    const response = await account(new Request(`${origin}/api/account`, { headers: { cookie: "void-account=stale-account-cookie" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, authenticated: false });
    expect(response.headers.get("cache-control")).toContain("no-store");
    assertNoDispatch();
  });
  it.each(authRoutes)("disables self-hosted $name even with account flags and a stale session", async ({ handler }) => {
    const incoming = request("/api/auth/any", { email: "invited@example.com", code: "123456" });
    incoming.headers.delete("origin");
    await expectError(await handler(incoming), "AUTH_DISABLED", 503);
    assertNoDispatch();
  });
  it("rejects invalid profile metadata and account lookup before the knowledge service", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "malformed");
    await expectError(await status(), "DEPLOYMENT_CONFIG", 503);
    await expectError(await account(new Request(`${origin}/api/account`)), "DEPLOYMENT_CONFIG", 503);
    assertNoDispatch();
  });
  it.each(authRoutes)("rejects malformed profile for $name before authentication", async ({ handler }) => {
    vi.stubEnv("DEPLOYMENT_MODE", "malformed");
    await expectError(await handler(request("/api/auth/any", { email: "invited@example.com", code: "123456" })), "DEPLOYMENT_CONFIG", 503);
    assertNoDispatch();
  });
});
