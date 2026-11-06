import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieOptions,
} from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { configuredAppOrigin } from "./app-origin";
import { AppError, errorResponse } from "./errors";
import { deploymentMode } from "./deployment";
import { exactKeys, invalid, readJson, record } from "./validation";

const AUTH_TIMEOUT_MS = 10_000;
const RATE_WINDOW_MS = 15 * 60_000;
const MAX_RATE_BUCKETS = 10_000;
const rateBuckets = new Map<string, { count: number; expires: number }>();
const emailSchema = z.email().max(254);

type AuthConfig = { url: string; key: string; allowed: Set<string> | "*" };
type AccountUser = { id: string; email: string };
export type AccountSession = {
  user: AccountUser | null;
  applyCookies(response: Response): Response;
};

const disabled = () => new AppError("AUTH_DISABLED", "Account access is not available.", 503);
const unavailable = () => new AppError("AUTH_UNAVAILABLE", "Account access is temporarily unavailable. Try again.", 503, true);
const invalidCode = () => new AppError("INVALID_OTP", "The email or verification code was not accepted.", 401);
const rateLimited = () => new AppError("AUTH_RATE_LIMIT", "Too many attempts. Try again later.", 429, true);

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  const email = value.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

function authConfig(): AuthConfig {
  if (deploymentMode() !== "hosted") throw disabled();
  if (process.env.ACCOUNT_TRIAL_ENABLED !== "true") throw disabled();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  // Accept current publishable keys only; a service-role/secret key must never power user login.
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key) || key.length > 512) throw disabled();
  let url: URL;
  try {
    url = new URL(process.env.SUPABASE_URL?.trim() ?? "");
    if (!configuredAppOrigin()) throw disabled();
  } catch { throw disabled(); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw disabled();
  const entries = (process.env.TRIAL_ALLOWED_EMAILS ?? "").split(",").map((email) => email.trim());
  if (entries.length === 1 && entries[0] === "*") return { url: url.origin, key, allowed: "*" };
  if (!entries.length || entries.some((email) => !normalizeEmail(email))) throw disabled();
  return { url: url.origin, key, allowed: new Set(entries.map((email) => normalizeEmail(email)!)) };
}

export function accountAuthEnabled(): boolean {
  // Invalid deployment configuration must propagate instead of becoming a guest fallback.
  if (deploymentMode() !== "hosted") return false;
  try { authConfig(); return true; } catch { return false; }
}

/** Authentication and shared POSTs require an explicit, configured origin, including in development. */
export function assertAccountOrigin(request: Request): void {
  let expected: string | undefined;
  try { expected = configuredAppOrigin(); } catch { throw disabled(); }
  if (!expected) throw disabled();
  if (request.headers.get("origin") !== expected)
    throw new AppError("INVALID_ORIGIN", "This request origin is not allowed.", 403);
}

function allowedEmail(config: AuthConfig, email: string): boolean {
  return config.allowed === "*" || config.allowed.has(email);
}

function verifiedAccount(config: AuthConfig, user: User | null): AccountUser | null {
  const email = normalizeEmail(user?.email);
  if (!user?.id || !user.email_confirmed_at || user.is_anonymous || !email || !allowedEmail(config, email)) return null;
  return { id: user.id, email };
}

function limitAttempts(request: Request, email: string, action: "send" | "verify"): void {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.expires <= now) rateBuckets.delete(key);
  // Forwarding headers have authority only behind a configured, header-sanitizing reverse proxy.
  const forwarded = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const ip = forwarded && isIP(forwarded) ? forwarded : "direct";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const limits: [string, number][] = [
    [`${action}:ip:${hash(ip)}`, action === "send" ? 10 : 30],
    [`${action}:email:${hash(email)}`, action === "send" ? 3 : 8],
  ];
  for (const [key, limit] of limits) {
    if ((rateBuckets.get(key)?.count ?? 0) >= limit) throw rateLimited();
  }
  const newBuckets = limits.filter(([key]) => !rateBuckets.has(key)).length;
  if (rateBuckets.size + newBuckets > MAX_RATE_BUCKETS) throw rateLimited();
  for (const [key] of limits) {
    const bucket = rateBuckets.get(key) ?? { count: 0, expires: now + RATE_WINDOW_MS };
    bucket.count++;
    rateBuckets.set(key, bucket);
  }
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-cache, no-store, no-transform, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function cookieJar(request: Request) {
  const cookieName = process.env.NODE_ENV === "production" ? "__Host-void-account" : "void-account";
  const cookiePattern = new RegExp(`^${cookieName}(?:-code-verifier)?(?:\\.\\d+)?$`);
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 32_768) throw invalid();
  const values = new Map(parseCookieHeader(header).filter(({ name }) => cookiePattern.test(name)).map(({ name, value }) => [name, value]));
  const pending = new Map<string, { value: string; options: CookieOptions }>();
  const secure = process.env.NODE_ENV === "production";
  const defaults: CookieOptions = { path: "/", httpOnly: true, sameSite: "strict", secure, maxAge: 30 * 86400 };
  const clear = () => {
    for (const name of new Set([cookieName, ...values.keys(), ...pending.keys()])) {
      pending.set(name, { value: "", options: { ...defaults, maxAge: 0, expires: new Date(0) } });
      values.delete(name);
    }
  };
  return {
    values, defaults, clear, cookieName,
    setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
      for (const { name, value, options } of cookies) {
        if (!cookiePattern.test(name)) continue;
        values.set(name, value);
        // Security attributes are application policy, never downgraded by library defaults.
        pending.set(name, { value, options: { ...defaults, ...options, domain: undefined, path: "/", httpOnly: true, sameSite: "strict", secure } });
      }
    },
    applyCookies(response: Response): Response {
      noStore(response);
      for (const [name, { value, options }] of pending)
        response.headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
      return response;
    },
  };
}

function authContext(request: Request, config: AuthConfig) {
  const jar = cookieJar(request);
  const controller = new AbortController();
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { name: jar.cookieName, ...jar.defaults },
    auth: { debug: false },
    cookies: {
      getAll: () => [...jar.values].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => { if (!controller.signal.aborted) jar.setAll(cookies); },
    },
    global: {
      fetch: async (input, init) => {
        try {
          const response = await fetch(input, {
            ...init, cache: "no-store", redirect: "error",
            signal: AbortSignal.any([controller.signal, request.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(AUTH_TIMEOUT_MS)]),
          });
          if (response.ok) return response;
          await response.body?.cancel();
          // The SDK can log some errors internally. Never let provider error text reach it.
          return Response.json({ message: "Authentication request failed." }, { status: response.status });
        } catch { throw new Error("Authentication provider unavailable."); }
      },
    },
  });
  return {
    client, ...jar,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, AUTH_TIMEOUT_MS);
          }),
        ]);
      } catch (error) { throw error instanceof AppError ? error : unavailable(); }
      finally { if (timer) clearTimeout(timer); }
    },
  };
}

type AuthContext = ReturnType<typeof authContext>;
class AccountAuthFailure extends AppError {
  constructor(public applyCookies: AccountSession["applyCookies"]) {
    const error = unavailable();
    super(error.code, error.message, error.status, error.retryable);
  }
}

/** A refresh may succeed before getUser fails; preserve its rotated cookies on the error response. */
export function applyAccountAuthCookies(error: unknown, response: Response): Response {
  return error instanceof AccountAuthFailure ? error.applyCookies(response) : response;
}
function isInvalidSession(error: { status?: number; name?: string }): boolean {
  return error.name === "AuthSessionMissingError" || [400, 401, 403].includes(error.status ?? 0);
}

export async function getAccountSession(request: Request): Promise<AccountSession> {
  if (!accountAuthEnabled()) {
    const jar = cookieJar(request);
    jar.clear();
    return { user: null, applyCookies: jar.applyCookies };
  }
  const config = authConfig();
  const context = authContext(request, config);
  if (![...context.values.keys()].some((name) => name === context.cookieName || name.startsWith(`${context.cookieName}.`)))
    return { user: null, applyCookies: context.applyCookies };
  try {
    const { data, error } = await context.run(() => context.client.auth.getUser());
    if (error && !isInvalidSession(error)) throw unavailable();
    const user = error ? null : verifiedAccount(config, data.user);
    if (!user) context.clear();
    return { user, applyCookies: context.applyCookies };
  } catch { throw new AccountAuthFailure(context.applyCookies); }
}

/** Kept behind route handlers so the SDK and credentials never enter a browser bundle. */
export async function handleAccountAuth(request: Request, action: "send" | "verify" | "logout"): Promise<Response> {
  let context: AuthContext | undefined;
  try {
    const config = authConfig();
    assertAccountOrigin(request);
    if (action === "logout") {
      context = authContext(request, config);
      try {
        const { error } = await context.run(() => context!.client.auth.signOut({ scope: "local" }));
        if (error) throw unavailable();
      } finally { context.clear(); }
      return context.applyCookies(Response.json({ ok: true }));
    }
    const body = await readJson(request);
    if (!record(body)) throw invalid();
    exactKeys(body, action === "send" ? ["email"] : ["email", "code"]);
    const email = normalizeEmail(body.email);
    if (!email || (action === "verify" && (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)))) throw invalid();
    limitAttempts(request, email, action);
    if (!allowedEmail(config, email)) {
      if (action === "verify") throw invalidCode();
      return noStore(Response.json({ ok: true }));
    }
    context = authContext(request, config);
    if (action === "send") {
      const { error } = await context.run(() => context!.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
      if (error) {
        if (error.status === 429) throw rateLimited();
        throw unavailable();
      }
    } else {
      const { error } = await context.run(() => context!.client.auth.verifyOtp({ email, token: body.code as string, type: "email" }));
      if (error) {
        if (error.status === 429) throw rateLimited();
        if (isInvalidSession(error)) throw invalidCode();
        throw unavailable();
      }
      const result = await context.run(() => context!.client.auth.getUser());
      if (result.error && !isInvalidSession(result.error)) throw unavailable();
      const user = result.error ? null : verifiedAccount(config, result.data.user);
      if (!user || user.email !== email) throw invalidCode();
    }
    return context.applyCookies(Response.json({ ok: true }));
  } catch (error) {
    if (action === "verify") context?.clear();
    return context ? context.applyCookies(errorResponse(error)) : noStore(errorResponse(error));
  }
}
