import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieOptions } from "@supabase/ssr";

const provider = vi.hoisted(() => ({
  getUser: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signOut: vi.fn(),
  options: undefined as undefined | {
    cookies: { getAll(): { name: string; value: string }[]; setAll(cookies: { name: string; value: string; options: CookieOptions }[], headers: Record<string, string>): void };
    global: { fetch: typeof fetch };
    cookieOptions: { name: string };
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", async (original) => ({
  ...await original<typeof import("@supabase/ssr")>(),
  createServerClient: (_url: string, _key: string, options: typeof provider.options) => {
    provider.options = options;
    return { auth: provider };
  },
}));

const verifiedUser = { id: "aa000000-0000-4000-8000-000000000001", email: "invited@example.com", email_confirmed_at: "2026-11-01T00:00:00Z", is_anonymous: false };
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://app.example.com/api/auth/${path}`, {
  method: "POST", headers: { origin: "https://app.example.com", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let auth: typeof import("../src/lib/server/account-auth");
let send: typeof import("../src/app/api/auth/send-code/route").POST;
let verify: typeof import("../src/app/api/auth/verify-code/route").POST;
let logout: typeof import("../src/app/api/auth/logout/route").POST;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_public_key");
  vi.stubEnv("TRIAL_ALLOWED_EMAILS", "invited@example.com");
  vi.stubEnv("PUBLIC_APP_ORIGIN", "https://app.example.com");
  vi.stubEnv("TRUST_PROXY", "false");
  provider.options = undefined;
  provider.getUser.mockResolvedValue({ data: { user: verifiedUser }, error: null });
  provider.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  provider.verifyOtp.mockImplementation(async () => {
    provider.options!.cookies.setAll([{ name: provider.options!.cookieOptions.name, value: "private-session", options: { path: "/", maxAge: 86400 } }], {});
    return { data: { user: verifiedUser, session: { access_token: "must-not-return", refresh_token: "must-not-return" } }, error: null };
  });
  provider.signOut.mockResolvedValue({ error: null });
  auth = await import("../src/lib/server/account-auth");
  send = (await import("../src/app/api/auth/send-code/route")).POST;
  verify = (await import("../src/app/api/auth/verify-code/route")).POST;
  logout = (await import("../src/app/api/auth/logout/route")).POST;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("account auth configuration and origin", () => {
  it.each([
    ["ACCOUNT_TRIAL_ENABLED", "false"], ["SUPABASE_URL", "http://project.supabase.co"],
    ["SUPABASE_URL", "https://user:secret@project.supabase.co"], ["SUPABASE_URL", "https://project.supabase.co/path"],
    ["SUPABASE_PUBLISHABLE_KEY", ""], ["SUPABASE_PUBLISHABLE_KEY", "sb_secret_do_not_accept"],
    ["TRIAL_ALLOWED_EMAILS", ""], ["TRIAL_ALLOWED_EMAILS", "*,invited@example.com"],
    ["TRIAL_ALLOWED_EMAILS", "not-an-email"], ["PUBLIC_APP_ORIGIN", ""],
  ])("fails closed for invalid %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    expect(auth.accountAuthEnabled()).toBe(false);
    const response = await send(request("send-code", { email: verifiedUser.email }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(provider.signInWithOtp).not.toHaveBeenCalled();
  });
  it("allows an explicit public allowlist", () => { vi.stubEnv("TRIAL_ALLOWED_EMAILS", "*"); expect(auth.accountAuthEnabled()).toBe(true); });
  it.each(["", "null", "https://evil.example", "https://app.example.com/"])("rejects absent or nonexact Origin %s", async (origin) => {
    for (const handler of [send, verify, logout]) {
      const response = await handler(request("any", { email: verifiedUser.email, code: "123456" }, { origin }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_ORIGIN" } });
    }
    expect(provider.getUser).not.toHaveBeenCalled();
  });
});

describe("email OTP", () => {
  it("normalizes an invited address and returns no provider data", async () => {
    const response = await send(request("send-code", { email: " Invited@Example.com " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(provider.signInWithOtp).toHaveBeenCalledWith({ email: verifiedUser.email, options: { shouldCreateUser: true } });
  });
  it("acknowledges disallowed addresses without contacting the provider", async () => {
    const response = await send(request("send-code", { email: "outside@example.com" }));
    expect(await response.json()).toEqual({ ok: true });
    expect(provider.signInWithOtp).not.toHaveBeenCalled();
  });
  it.each([{ email: "bad" }, { email: verifiedUser.email, extra: true }, { email: "x".repeat(400) }])("rejects invalid send input %j", async (body) => {
    expect((await send(request("send-code", body))).status).toBe(400);
  });
  it("sets server-only secure session cookies and never returns tokens", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await verify(request("verify-code", { email: verifiedUser.email, code: "123456" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(provider.getUser).toHaveBeenCalledOnce();
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("__Host-void-account=");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Strict");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["12345", "abcdef", "1234567", "123 45"])("rejects invalid OTP %s without provider access", async (code) => {
    expect((await verify(request("verify-code", { email: verifiedUser.email, code }))).status).toBe(400);
    expect(provider.verifyOtp).not.toHaveBeenCalled();
  });
  it("does not verify disallowed accounts", async () => {
    expect((await verify(request("verify-code", { email: "outside@example.com", code: "123456" }))).status).toBe(401);
    expect(provider.verifyOtp).not.toHaveBeenCalled();
  });
  it("discards newly issued cookies if the verified user does not match the email", async () => {
    provider.getUser.mockResolvedValue({ data: { user: { ...verifiedUser, email: "other@example.com" } }, error: null });
    const response = await verify(request("verify-code", { email: verifiedUser.email, code: "123456" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).not.toContain("private-session");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("sanitizes provider failures", async () => {
    provider.signInWithOtp.mockRejectedValue(new Error("private-key-and-provider-response"));
    const response = await send(request("send-code", { email: verifiedUser.email }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-key");
  });
  it("bounds a hung provider operation", async () => {
    vi.useFakeTimers();
    provider.signInWithOtp.mockReturnValue(new Promise(() => {}));
    const pending = send(request("send-code", { email: verifiedUser.email }));
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await pending).status).toBe(503);
  });
});

describe("verified account sessions and logout", () => {
  it("refreshes all cookie chunks on the caller response", async () => {
    provider.getUser.mockImplementation(async () => {
      provider.options!.cookies.setAll([
        { name: "void-account.0", value: "new-part-0", options: {} },
        { name: "void-account.1", value: "new-part-1", options: {} },
      ], { "Cache-Control": "private, no-store", Pragma: "no-cache" });
      return { data: { user: verifiedUser }, error: null };
    });
    const session = await auth.getAccountSession(request("account", undefined, { cookie: "void-account.0=old; void-account.1=old2; unrelated=preserve" }));
    expect(session.user).toEqual({ id: verifiedUser.id, email: verifiedUser.email });
    const response = session.applyCookies(Response.json({ ok: true }));
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get("set-cookie")).toContain("new-part-1");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("set-cookie")).not.toContain("unrelated");
  });
  it.each([
    { ...verifiedUser, email_confirmed_at: undefined }, { ...verifiedUser, email: "outside@example.com" },
    { ...verifiedUser, is_anonymous: true }, null,
  ])("rejects an unverified or ineligible user %j", async (user) => {
    provider.getUser.mockResolvedValue({ data: { user }, error: null });
    const session = await auth.getAccountSession(request("account", undefined, { cookie: "void-account=forged" }));
    expect(session.user).toBeNull();
    expect(session.applyCookies(Response.json({})).headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("rejects a forged session even when its cookie exists", async () => {
    provider.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, message: "forged-token" } });
    const session = await auth.getAccountSession(request("account", undefined, { cookie: "void-account=forged" }));
    expect(session.user).toBeNull();
    expect(provider.getUser).toHaveBeenCalledOnce();
  });
  it("ignores non-host-prefixed injected session cookies in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const account = await auth.getAccountSession(request("account", undefined, { cookie: "void-account=injected" }));
    expect(account.user).toBeNull();
    expect(provider.getUser).not.toHaveBeenCalled();
  });
  it("reports provider outage instead of manufacturing a logged-out session", async () => {
    provider.getUser.mockRejectedValue(new Error("private-provider-error"));
    await expect(auth.getAccountSession(request("account", undefined, { cookie: "void-account=existing" }))).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE", status: 503 });
  });
  it("revokes the current session and clears every owned cookie chunk", async () => {
    const response = await logout(request("logout", undefined, { cookie: "void-account.0=one; void-account.1=two; unrelated=keep" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(provider.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.getSetCookie().filter((value) => value.includes("Max-Age=0")).length).toBeGreaterThanOrEqual(2);
    expect(response.headers.get("set-cookie")).not.toContain("unrelated");
  });
  it("clears local cookies even if remote logout fails", async () => {
    provider.signOut.mockRejectedValue(new Error("private logout failure"));
    const response = await logout(request("logout", undefined, { cookie: "void-account=existing" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("independent bounded OTP limits", () => {
  it("limits sends by normalized email even across different trusted IPs", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const responses = [];
    for (let i = 1; i <= 4; i++) responses.push(await send(request("send-code", { email: "INVITED@example.com" }, { "x-forwarded-for": `192.0.2.${i}` })));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 429]);
  });
  it("limits sends by IP even across different disallowed emails", async () => {
    const responses = [];
    for (let i = 0; i < 11; i++) responses.push(await send(request("send-code", { email: `outside${i}@example.com` }, { "x-forwarded-for": `192.0.2.${i + 1}` })));
    expect(responses.at(-1)!.status).toBe(429);
    expect(provider.signInWithOtp).not.toHaveBeenCalled();
  });
  it("limits OTP guesses by email independently from send limits", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    provider.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { status: 403, message: "invalid" } });
    const responses = [];
    for (let i = 1; i <= 9; i++) responses.push(await verify(request("verify-code", { email: verifiedUser.email, code: "000000" }, { "x-forwarded-for": `192.0.2.${i}` })));
    expect(responses.at(-1)!.status).toBe(429);
  });
  it("expires rate limit windows", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) await send(request("send-code", { email: verifiedUser.email }));
    expect((await send(request("send-code", { email: verifiedUser.email }))).status).toBe(429);
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1);
    expect((await send(request("send-code", { email: verifiedUser.email }))).status).toBe(200);
  });
});
