import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCookieHeader } from "@supabase/ssr";
import { applyAccountAuthCookies, getAccountSession } from "../src/lib/server/account-auth";
import { POST as verify } from "../src/app/api/auth/verify-code/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
vi.mock("server-only", () => ({}));

const user = {
  id: "aa000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated",
  email: "invited@example.com", email_confirmed_at: "2026-11-01T00:00:00Z",
  phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  identities: [], created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", is_anonymous: false,
};
function session(expired = false) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -120 : 3600);
  const jwt = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: user.id, exp, role: "authenticated" })).toString("base64url"),
    "fixture-signature",
  ].join(".");
  return { access_token: jwt, refresh_token: expired ? "expired-fixture-refresh" : "fresh-fixture-refresh", expires_in: 3600, expires_at: exp, token_type: "bearer", user };
}
const req = (cookie = "", body?: unknown) => new Request("https://app.example.com/api/auth/verify-code", {
  method: "POST", headers: { origin: "https://app.example.com", cookie, "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const cookiesFromResponse = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");

beforeEach(() => {
  vi.stubEnv("DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("ACCOUNT_TRIAL_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_public_key");
  vi.stubEnv("TRIAL_ALLOWED_EMAILS", "invited@example.com");
  vi.stubEnv("PUBLIC_APP_ORIGIN", "https://app.example.com");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Supabase SDK integration with a simulated provider", () => {
  it("exchanges an email code, validates the user, reads the resulting cookie and logs out", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
      if (url.pathname === "/auth/v1/verify") return Response.json(session());
      if (url.pathname === "/auth/v1/user") return Response.json(user);
      if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
      throw new Error("Unexpected provider request");
    }));
    const verified = await verify(req("", { email: user.email, code: "123456" }));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ ok: true });
    const cookie = cookiesFromResponse(verified);
    expect(cookie).toContain("void-account=");
    const account = await getAccountSession(req(cookie));
    expect(account.user).toEqual({ id: user.id, email: user.email });
    const loggedOut = await logout(req(cookie));
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(calls).toEqual(["/auth/v1/verify", "/auth/v1/user", "/auth/v1/user", "/auth/v1/logout"]);
  });

  it("refreshes an expired SDK session before accepting its server-confirmed identity", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input)); calls.push(url.pathname);
      if (url.pathname === "/auth/v1/token") {
        expect(JSON.parse(init!.body as string)).toEqual({ refresh_token: "expired-fixture-refresh" });
        return Response.json(session());
      }
      if (url.pathname === "/auth/v1/user") return Response.json(user);
      throw new Error("Unexpected provider request");
    }));
    const cookie = `void-account=base64-${Buffer.from(JSON.stringify(session(true))).toString("base64url")}`;
    const account = await getAccountSession(req(cookie));
    expect(account.user).toEqual({ id: user.id, email: user.email });
    const response = account.applyCookies(Response.json({ ok: true }));
    const authCookie = parseCookieHeader(cookiesFromResponse(response)).find((item) => item.name === "void-account")!;
    expect(authCookie.value).toMatch(/^base64-/);
    const stored = JSON.parse(Buffer.from(authCookie.value.slice(7), "base64url").toString());
    expect(stored.refresh_token).toBe("fresh-fixture-refresh");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(calls).toEqual(["/auth/v1/token", "/auth/v1/user"]);
  });

  it("preserves rotated refresh cookies on a subsequent user lookup outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/token") return Response.json(session());
      return Response.json({ message: "private-provider-details" }, { status: 503 });
    }));
    const cookie = `void-account=base64-${Buffer.from(JSON.stringify(session(true))).toString("base64url")}`;
    let failure: unknown;
    try { await getAccountSession(req(cookie)); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "AUTH_UNAVAILABLE", status: 503 });
    const response = applyAccountAuthCookies(failure, Response.json({ error: "unavailable" }, { status: 503 }));
    const authCookie = parseCookieHeader(cookiesFromResponse(response)).find((item) => item.name === "void-account")!;
    expect(authCookie).toBeDefined();
    const stored = JSON.parse(Buffer.from(authCookie.value.slice(7), "base64url").toString());
    expect(stored.refresh_token).toBe("fresh-fixture-refresh");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("private-provider-details");
  });

  it("never accepts forged cookie user data when the provider rejects its token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "private-provider-details" }, { status: 401 })));
    const cookie = `void-account=base64-${Buffer.from(JSON.stringify(session())).toString("base64url")}`;
    const account = await getAccountSession(req(cookie));
    expect(account.user).toBeNull();
    expect(account.applyCookies(Response.json({})).headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
