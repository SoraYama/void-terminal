import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as account } from "../src/app/api/account/route";
import { POST as chat } from "../src/app/api/chat/route";
import { POST as verifyDevice } from "../src/app/api/account/verify-device/route";
import { POST as send } from "../src/app/api/auth/send-code/route";
import { POST as verify } from "../src/app/api/auth/verify-code/route";

const origin = "https://app.example.com";
const user = {
  id: "aa000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
  email: "invited@example.com", email_confirmed_at: "2026-11-01T00:00:00Z", is_anonymous: false,
};
const accountCookie = "void-account=base64-" + Buffer.from(JSON.stringify({
  access_token: "direct-supabase-access", refresh_token: "direct-supabase-refresh", expires_at: 9_999_999_999, user,
})).toString("base64url");
const signals = { browser: "chromium", system: "macos", locale: "en", timezone: 8, screen: "large" };
const knownCookie = (response: Response, name: string) => response.headers.getSetCookie().find(value => value.startsWith(name + "="))?.split(";")[0];
const responseCookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const request = (path: string, body?: unknown, cookie = "", headers: Record<string, string> = {}) => new Request(origin + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { origin, cookie, "Content-Type": "application/json", "X-Request-Id": "aa000000-0000-4000-8000-000000000002", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const input = { mode: "shared", depth: "standard", language: "en", messages: [{ role: "user", content: "Explain this source" }] };
const riskCalls: Record<string, unknown>[] = [];
const summaryCalls: Record<string, unknown>[] = [];
let calls: string[];
let usedTokens: Set<string>;
let rate: { allowed: boolean; challengeRequired: boolean; retryAfter: number };
let verification: Record<string, unknown>;
let serviceFailure: boolean;
let activeUser: typeof user;
let deviceLimit: boolean;
async function solve(cookie = "", token = "human-widget-token", headers: Record<string, string> = {}) {
  return verifyDevice(request("/api/account/verify-device", { token, signals }, cookie, headers));
}
beforeEach(() => {
  for (const [name, value] of Object.entries({
    DEPLOYMENT_MODE: "hosted", ACCOUNT_TRIAL_ENABLED: "true",
    SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_public_key", TRIAL_ALLOWED_EMAILS: "*",
    PUBLIC_APP_ORIGIN: origin, KNOWLEDGE_URL: "http://knowledge.test", KNOWLEDGE_API_TOKEN: "knowledge-fixture",
    ACCOUNT_RISK_SECRET: "fixture-account-risk-secret-32-bytes-minimum",
    TURNSTILE_SITE_KEY: "fixture-public-site-key", TURNSTILE_SECRET_KEY: "fixture-secret-site-key",
    SHARED_MODE_ENABLED: "true", SESSION_SECRET: "fixture-session-secret-32-bytes-minimum",
    DEEPSEEK_API_KEY: "model-server-key", TRUST_PROXY: "false",
  })) vi.stubEnv(name, value);
  calls = [];
  usedTokens = new Set();
  riskCalls.length = 0;
  summaryCalls.length = 0;
  rate = { allowed: true, challengeRequired: false, retryAfter: 0 };
  verification = { success: true, hostname: "app.example.com", action: "account_device" };
  serviceFailure = false;
  activeUser = user;
  deviceLimit = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith("/siteverify")) {
      const params = new URLSearchParams(String(init?.body));
      const token = params.get("response")!;
      expect(params.get("secret")).toBe("fixture-secret-site-key");
      expect(init?.signal).toBeDefined();
      if (usedTokens.has(token)) return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
      usedTokens.add(token);
      return Response.json({ challenge_ts: new Date().toISOString(), ...verification });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === "/auth/v1/user") return Response.json(activeUser);
    if (url.pathname === "/auth/v1/verify") return Response.json({ user, access_token: "access", refresh_token: "refresh", expires_in: 3600, token_type: "bearer" });
    if (url.pathname === "/auth/v1/otp") {
      expect(JSON.stringify(body)).not.toContain("human-widget-token");
      return Response.json({});
    }
    if (url.pathname === "/v1/accounts/risk/check") {
      riskCalls.push(body);
      return serviceFailure ? new Response("private risk outage", { status: 503 }) : Response.json(rate);
    }
    if (url.pathname === "/v1/accounts/summary") {
      summaryCalls.push(body);
      return Response.json({ eligibility: { status: body.riskContext?.verified ? deviceLimit ? "device_limit" : "ready" : "verification_required" }, credits: { available: body.riskContext?.verified ? 23 : 0, held: 0, totalGranted: 20 } });
    }
    if (url.pathname === "/v1/accounts/reserve") return Response.json({ allowed: false, reason: "insufficient_credits" });
    throw new Error("Unexpected network request: " + url.pathname);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("hosted device admission against real server auth", () => {
  it("does not grant or reserve for a valid direct Supabase session without proof", async () => {
    const summary = await (await account(request("/api/account", undefined, accountCookie))).json();
    expect(summary).toMatchObject({ authenticated: true, risk: { status: "verification_required", siteKey: "fixture-public-site-key", challengeAction: "account_device" }, credits: { available: 0 } });
    expect(summaryCalls[0].riskContext).not.toMatchObject({ verified: true });
    const response = await chat(request("/api/chat", input, accountCookie, { "X-Device-Verified": "true" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "DEVICE_VERIFICATION_REQUIRED" } });
    expect(calls).not.toContain("/v1/accounts/reserve");
  });

  it("rejects client-selected proof fields at OTP ingress", async () => {
    const response = await send(request("/api/auth/send-code", { email: user.email, verified: true, deviceHash: "0".repeat(64) }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("gates OTP send before any attempt can consume the email cooldown", async () => {
    const response = await send(request("/api/auth/send-code", { email: user.email }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "DEVICE_VERIFICATION_REQUIRED" } });
    expect(calls).toEqual([]);
  });

  it("issues private reusable cookies after Siteverify and never lets a forged proof grant or spend", async () => {
    const solved = await solve(accountCookie);
    expect(solved.status).toBe(200);
    expect(await solved.json()).toMatchObject({ risk: { status: "verified" }, credits: { available: 23 } });
    for (const name of ["__Host-void-device", "__Host-void-device-proof"]) {
      const cookie = solved.headers.getSetCookie().find(value => value.startsWith(name + "="));
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).not.toMatch(/Domain=/);
    }
    const valid = accountCookie + "; " + responseCookies(solved);
    expect((await chat(request("/api/chat", input, valid))).status).toBe(402);
    expect(calls.filter(path => path.endsWith("/siteverify"))).toHaveLength(1);
    const forged = valid.replace(/(__Host-void-device-proof=)(.)/, (_, prefix, first) => prefix + (first === "x" ? "y" : "x"));
    expect((await chat(request("/api/chat", input, forged))).status).toBe(403);
    expect((await (await account(request("/api/account", undefined, forged))).json()).risk.status).toBe("verification_required");
  });

  it("rejects a proof presented with a second device, a duplicate cookie or a different account", async () => {
    const first = await solve(accountCookie);
    const second = await solve(accountCookie, "different-widget-token");
    const device = knownCookie(first, "__Host-void-device")!;
    const proof = knownCookie(first, "__Host-void-device-proof")!;
    const other = knownCookie(second, "__Host-void-device")!;
    for (const cookie of [[accountCookie, other, proof], [accountCookie, device, other, proof]]) {
      expect((await chat(request("/api/chat", input, cookie.join("; ")))).status).toBe(403);
    }
    activeUser = { ...user, id: "bb000000-0000-4000-8000-000000000001" };
    expect((await chat(request("/api/chat", input, [accountCookie, device, proof].join("; ")))).status).toBe(403);
    expect(riskCalls).toEqual([]);
  });

  it("does not reject earned-credit admission on a verified shared device", async () => {
    deviceLimit = true;
    const solved = await solve(accountCookie);
    expect(await solved.json()).toMatchObject({ eligibility: { status: "device_limit" }, risk: { status: "verified" } });
    const cookie = [accountCookie, responseCookies(solved)].join("; ");
    // The reserve boundary is reached; its fixture denies balance independently.
    expect((await chat(request("/api/chat", input, cookie))).status).toBe(402);
    expect(calls).toContain("/v1/accounts/reserve");
  });

  it("does not contact either provider for a foreign challenge origin", async () => {
    const response = await solve(accountCookie, "human-widget-token", { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("expires proof independently from the stable device cookie", async () => {
    const response = await solve(accountCookie);
    const cookie = accountCookie + "; " + responseCookies(response);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    expect((await chat(request("/api/chat", input, cookie))).status).toBe(403);
    expect((await (await account(request("/api/account", undefined, cookie))).json()).risk.status).toBe("verification_required");
  });

  it("requires an account-bound proof even after a valid anonymous challenge", async () => {
    const anonymous = responseCookies(await solve());
    const direct = anonymous + "; " + accountCookie;
    expect((await chat(request("/api/chat", input, direct))).status).toBe(403);
    expect((await send(request("/api/auth/send-code", { email: user.email, signals }, anonymous))).status).toBe(200);
    const signedIn = await verify(request("/api/auth/verify-code", { email: user.email, code: "123456", signals }, anonymous));
    expect(signedIn.status).toBe(200);
    const stableDevice = anonymous.split("; ").find(value => value.startsWith("__Host-void-device="));
    const promoted = [responseCookies(signedIn), stableDevice].join("; ");
    expect((await (await account(request("/api/account", undefined, promoted))).json()).risk.status).toBe("verified");
    expect(calls.filter(path => path.endsWith("/siteverify"))).toHaveLength(1);
    expect(riskCalls.map(call => call.action)).toEqual(["send", "verify"]);
    expect(riskCalls.every(call => call.verified === true && /^[a-f0-9]{64}$/.test(String(call.emailHash)))).toBe(true);
  });

  it("rejects persistent OTP hard limits even with a valid proof and preserves retry metadata", async () => {
    const cookie = responseCookies(await solve());
    rate = { allowed: false, challengeRequired: false, retryAfter: 47 };
    const response = await send(request("/api/auth/send-code", { email: user.email, signals }, cookie));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("47");
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_RATE_LIMIT", retryAfter: 47 } });
    expect(calls).not.toContain("/auth/v1/otp");
  });

  it("fails closed when the persistent admission service is unavailable", async () => {
    const cookie = responseCookies(await solve());
    serviceFailure = true;
    const response = await send(request("/api/auth/send-code", { email: user.email }, cookie));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private risk outage");
    expect(calls).not.toContain("/auth/v1/otp");
  });

  it.each([
    { hostname: "evil.example" }, { action: "other" }, { success: false }, { challenge_ts: "2020-01-01T00:00:00Z" },
  ])("cannot mint proof from an invalid provider response %j", async failure => {
    Object.assign(verification, failure);
    const response = await solve(accountCookie);
    expect(response.status).toBe(403);
    expect(knownCookie(response, "__Host-void-device-proof")).toBeUndefined();
    expect(summaryCalls).toEqual([]);
  });

  it("reports a Turnstile secret error as unavailable without leaking provider details", async () => {
    verification = { success: false, "error-codes": ["invalid-input-secret"] };
    const response = await solve();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("invalid-input-secret");
    expect(knownCookie(response, "__Host-void-device-proof")).toBeUndefined();
  });

  it("does not mint proof on a repeated token and reuses the same device on retry", async () => {
    verification.success = false;
    const failed = await solve();
    const cookie = knownCookie(failed, "__Host-void-device")!;
    expect(cookie).toBeDefined();
    verification.success = true;
    expect((await solve(cookie)).status).toBe(403);
    const good = await solve(cookie, "fresh-token");
    expect(good.status).toBe(200);
    expect(knownCookie(good, "__Host-void-device")).toBeUndefined();
    expect(knownCookie(good, "__Host-void-device-proof")).toBeDefined();
  });

  it("omits an untrusted or ambiguous IP and canonicalizes equivalent trusted addresses", async () => {
    const cookie = responseCookies(await solve());
    for (const [trust, ip] of [["false", "192.0.2.1"], ["true", "192.0.2.1, 192.0.2.2"], ["true", "::ffff:192.0.2.1"], ["true", "192.0.2.1"]]) {
      vi.stubEnv("TRUST_PROXY", trust);
      await send(request("/api/auth/send-code", { email: user.email, signals }, cookie, { "x-forwarded-for": ip }));
    }
    expect(riskCalls).toHaveLength(4);
    expect(riskCalls[0]).not.toHaveProperty("networkHash");
    expect(riskCalls[1]).not.toHaveProperty("networkHash");
    expect(riskCalls[2].networkHash).toMatch(/^[a-f0-9]{64}$/);
    expect(riskCalls[3].networkHash).toBe(riskCalls[2].networkHash);
    expect(riskCalls[0].fingerprintHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(riskCalls)).not.toMatch(/Asia\/Shanghai|192\.0\.2\.|invited@example.com/);
  });

  it("coalesces rotating IPv6 host addresses within a trusted network", async () => {
    const cookie = responseCookies(await solve());
    vi.stubEnv("TRUST_PROXY", "true");
    for (const ip of ["2001:db8:abcd:1::1", "2001:0db8:abcd:1:ffff::", "2001:db8:abcd:2::1"]) {
      await send(request("/api/auth/send-code", { email: user.email, signals }, cookie, { "x-forwarded-for": ip }));
    }
    expect(riskCalls[0].networkHash).toMatch(/^[a-f0-9]{64}$/);
    expect(riskCalls[1].networkHash).toBe(riskCalls[0].networkHash);
    expect(riskCalls[2].networkHash).not.toBe(riskCalls[0].networkHash);
  });

  it("reports unavailable risk when config is missing without giving away or spending credits", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const summary = await (await account(request("/api/account", undefined, accountCookie))).json();
    expect(summary).toMatchObject({ risk: { status: "unavailable" }, credits: { available: 0 } });
    expect(summary.risk).not.toHaveProperty("siteKey");
    expect((await solve(accountCookie)).status).toBe(503);
    expect((await chat(request("/api/chat", input, accountCookie))).status).toBe(503);
    expect(calls).not.toContain("/v1/accounts/reserve");
    expect(usedTokens.size).toBe(0);
  });

  it("disables self-hosted account and device surfaces without cookies or provider contact", async () => {
    vi.stubEnv("DEPLOYMENT_MODE", "self-hosted");
    for (const response of [await account(request("/api/account", undefined, accountCookie)), await solve(accountCookie), await send(request("/api/auth/send-code", { email: user.email, signals }))]) {
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(calls).toEqual([]);
  });
});
