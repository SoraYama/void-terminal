import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { serializeCookieHeader } from "@supabase/ssr";
import type { AccountRisk } from "../account-contracts";
import { configuredAppOrigin } from "./app-origin";
import { deploymentMode } from "./deployment";
import { AppError } from "./errors";
import { boundedJson, knowledge } from "./knowledge";
import { invalid, record } from "./validation";

const DAY = 86_400;
const DEVICE_AGE = 180 * DAY;
const ANONYMOUS_PROOF_AGE = 15 * 60;
const ACCOUNT_PROOF_AGE = 12 * 60 * 60;
const DEVICE_COOKIE = "__Host-void-device";
const PROOF_COOKIE = "__Host-void-device-proof";
const COOKIE_OPTIONS = { path: "/", secure: true, httpOnly: true, sameSite: "strict" } as const;
const CHALLENGE_ACTION = "account_device";
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const CHALLENGE_AGE_MS = 300_000;
const HEX_HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{32}$/;

type RiskConfig = { signingKey: string; siteKey: string; challengeKey: string; hostname: string };
type Device = { id: string; expires: number; fingerprintHash?: string };
type RiskAction = "send" | "verify" | "request";
export type AccountRiskContext = {
  deviceHash: string;
  networkHash?: string;
  fingerprintHash?: string;
  verified: boolean;
};

export function riskUnavailable(): AppError {
  return new AppError("ACCOUNT_RISK_UNAVAILABLE", "Device verification is temporarily unavailable.", 503, true);
}
export function verificationRequired(): AppError {
  return new AppError("DEVICE_VERIFICATION_REQUIRED", "Verify this device before continuing.", 403);
}
function challengeFailed(): AppError {
  return new AppError("DEVICE_CHALLENGE_FAILED", "The verification was not accepted. Solve a fresh challenge and try again.", 403, true);
}

function config(): RiskConfig | undefined {
  if (deploymentMode() !== "hosted") return;
  const signingKey = process.env.ACCOUNT_RISK_SECRET?.trim();
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const challengeKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!signingKey || Buffer.byteLength(signingKey) < 32 || !siteKey || !challengeKey ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(siteKey) || !/^[A-Za-z0-9_-]{1,256}$/.test(challengeKey)) return;
  const origin = configuredAppOrigin();
  if (!origin) return;
  return { signingKey, siteKey, challengeKey, hostname: new URL(origin).hostname };
}

function digest(key: string, purpose: string, value: string): string {
  return createHmac("sha256", key).update(purpose).update("\0").update(value).digest("hex");
}
function seal(key: string, purpose: string, payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return data + "." + digest(key, purpose, data);
}
function unseal(key: string, purpose: string, token?: string): Record<string, unknown> | undefined {
  if (!token || token.length > 1024) return;
  const [data, signature, extra] = token.split(".");
  if (!data || !/^[A-Za-z0-9_-]+$/.test(data) || !signature || !HEX_HASH.test(signature) || extra !== undefined) return;
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(digest(key, purpose, data), "hex"))) return;
  try {
    const value: unknown = JSON.parse(Buffer.from(data, "base64url").toString());
    if (record(value) && typeof value.expires === "number" && Number.isSafeInteger(value.expires) &&
        value.expires > Math.floor(Date.now() / 1000)) return value;
  } catch { /* A malformed cookie cannot authenticate a device or proof. */ }
}

function networkHash(request: Request, key: string): string | undefined {
  if (process.env.TRUST_PROXY !== "true") return;
  // Our edge overwrites X-Forwarded-For with one address. Chains, zones, ports and
  // alternate client-supplied headers do not satisfy that deployment contract.
  const candidate = request.headers.get("x-forwarded-for")?.trim();
  if (!candidate || candidate.length > 45 || candidate.includes("%") || !isIP(candidate)) return;
  const ip = ipaddr.process(candidate);
  const address = ip.toString();
  // IPv6 privacy addresses rotate within the prefix. The network is only a
  // soft signal, so visitors sharing one prefix never share a hard limit.
  const canonical = ip.kind() === "ipv6" ? ipaddr.IPv6.networkAddressFromCIDR(address + "/64").toString() + "/64" : address;
  return digest(key, "network", canonical);
}

function fingerprint(key: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (!record(value) || Object.keys(value).length !== 5) throw invalid();
  const { browser, system, locale, timezone, screen } = value;
  if (typeof browser !== "string" || !["chromium", "firefox", "safari", "other"].includes(browser) ||
      typeof system !== "string" || !["android", "ios", "windows", "macos", "linux", "other"].includes(system) ||
      typeof locale !== "string" || !/^[a-z]{2,3}$/.test(locale) ||
      typeof timezone !== "number" || !Number.isInteger(timezone) || timezone < -12 || timezone > 14 ||
      typeof screen !== "string" || !["small", "medium", "large", "unknown"].includes(screen)) throw invalid();
  return digest(key, "features", JSON.stringify([browser, system, locale, timezone, screen]));
}

export function accountRisk(request: Request, signals?: unknown) {
  const settings = config();
  if (!settings) return;
  const key = settings.signingKey;
  const pending: string[] = [];
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 32_768) throw invalid();
  const cookies = header.split(";").map(value => value.trim());
  const cookie = (name: string) => {
    const prefix = name + "=";
    const matches = cookies.filter(value => value.startsWith(prefix));
    return matches.length === 1 ? matches[0].slice(prefix.length) : undefined;
  };
  const storedDevice = unseal(key, DEVICE_COOKIE, cookie(DEVICE_COOKIE));
  let device = storedDevice && typeof storedDevice.id === "string" && ID.test(storedDevice.id)
    ? storedDevice as Device : undefined;
  let proof = unseal(key, PROOF_COOKIE, cookie(PROOF_COOKIE));
  const network = networkHash(request, key);
  const features = fingerprint(key, signals);
  const subject = (accountId: string | null) => accountId === null ? "anonymous" : digest(key, "account", accountId);
  const verifiedFor = (accountId: string | null) =>
    !!device && device.expires > Math.floor(Date.now() / 1000) && proof?.device === device.id &&
    proof.subject === subject(accountId) && typeof proof.expires === "number" && proof.expires > Math.floor(Date.now() / 1000);

  function issueProof(accountId: string | null) {
    // This function is called only after Siteverify or after an email OTP
    // confirmed by Supabase on an already verified anonymous device.
    if (!device) throw verificationRequired();
    const maxAge = accountId === null ? ANONYMOUS_PROOF_AGE : ACCOUNT_PROOF_AGE;
    const expires = Math.floor(Date.now() / 1000) + maxAge;
    proof = { device: device.id, subject: subject(accountId), expires };
    pending.push(serializeCookieHeader(PROOF_COOKIE, seal(key, PROOF_COOKIE, proof), { ...COOKIE_OPTIONS, maxAge }));
  }

  function riskContext(verified: boolean): AccountRiskContext | undefined {
    if (!device) return;
    const fingerprintHash = features ?? device.fingerprintHash;
    return {
      deviceHash: digest(key, "device", device.id),
      ...(network ? { networkHash: network } : {}),
      ...(fingerprintHash ? { fingerprintHash } : {}),
      verified,
    };
  }

  return {
    publicState(accountId: string | null): AccountRisk {
      if (verifiedFor(accountId)) return { status: "verified" };
      return { status: "verification_required", siteKey: settings.siteKey, challengeAction: CHALLENGE_ACTION };
    },
    applyCookies(response: Response): Response {
      for (const value of pending) response.headers.append("Set-Cookie", value);
      return response;
    },
    contextFor(accountId: string | null) {
      return riskContext(verifiedFor(accountId));
    },
    promoteOtpProof(accountId: string) {
      if (!verifiedFor(null)) throw verificationRequired();
      issueProof(accountId);
    },
    async verifyChallenge(token: string, accountId: string | null) {
      const now = Math.floor(Date.now() / 1000);
      if (!device || (features && !device.fingerprintHash)) {
        device = { id: device?.id ?? randomBytes(24).toString("base64url"),
          expires: device?.expires ?? now + DEVICE_AGE, ...(features ? { fingerprintHash: features } : {}) };
        // Keep the device through a failed challenge so a fresh widget token retries
        // on the same device. This cookie alone never authorizes a gift or request.
        pending.push(serializeCookieHeader(DEVICE_COOKIE, seal(key, DEVICE_COOKIE, device), {
          ...COOKIE_OPTIONS, maxAge: device.expires - now,
        }));
      }
      let result: unknown;
      try {
        const response = await fetch(TURNSTILE_VERIFY, {
          method: "POST", cache: "no-store", redirect: "error",
          body: new URLSearchParams({ secret: settings.challengeKey, response: token }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw riskUnavailable();
        }
        result = await boundedJson(response, 8192);
      } catch { throw riskUnavailable(); }
      if (!record(result) || typeof result.success !== "boolean") throw riskUnavailable();
      if (!result.success && Array.isArray(result["error-codes"]) && result["error-codes"].some(
        code => code === "invalid-input-secret" || code === "missing-input-secret" || code === "internal-error",
      )) throw riskUnavailable();
      const timestamp = typeof result.challenge_ts === "string" ? Date.parse(result.challenge_ts) : NaN;
      const age = Date.now() - timestamp;
      // Siteverify consumes each token once. Never retry the call or accept a
      // provider timeout/duplicate as proof. A failed user must solve again.
      if (!result.success || result.hostname !== settings.hostname ||
          result.action !== CHALLENGE_ACTION || !Number.isFinite(age) || age > CHALLENGE_AGE_MS || age < -30_000)
        throw challengeFailed();
      issueProof(accountId);
    },
    async admit(action: RiskAction, accountId: string | null, email?: string): Promise<AccountRiskContext> {
      const context = riskContext(verifiedFor(accountId));
      // A browser without proof cannot consume an OTP cooldown, enroll for
      // automatic credits or get as far as public model work.
      if (!context?.verified) throw verificationRequired();
      let result: unknown;
      try {
        result = await knowledge("/v1/accounts/risk/check", {
          body: { action, ...context, ...(email ? { emailHash: digest(key, "email", email) } : {}) },
          signal: request.signal, timeout: 5000,
        });
      } catch { throw riskUnavailable(); }
      if (!record(result) || typeof result.allowed !== "boolean" || typeof result.challengeRequired !== "boolean" ||
          typeof result.retryAfter !== "number" || !Number.isSafeInteger(result.retryAfter) || result.retryAfter < 0)
        throw riskUnavailable();
      if (!result.allowed) throw new AppError(action === "request" ? "ACCOUNT_RISK_LIMIT" : "AUTH_RATE_LIMIT",
        "Too many attempts. Try again later.", 429, true, result.retryAfter || undefined);
      if (result.challengeRequired) throw verificationRequired();
      return context;
    },
  };
}

export function clearDeviceProof(response: Response): Response {
  response.headers.append("Set-Cookie", serializeCookieHeader(PROOF_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 }));
  return response;
}

export function challengeToken(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,2048}$/.test(value)) throw invalid();
  return value;
}
