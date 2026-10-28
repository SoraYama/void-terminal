import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { AppError } from "./errors";
import { configuredAppOrigin } from "./config";
const buckets = new Map<string, { count: number; expires: number }>();
export function resetRateLimits() {
  buckets.clear();
}
function rateLimit(key: string, max: number, now: number) {
  for (const [id, bucket] of buckets)
    if (bucket.expires <= now) buckets.delete(id);
  if (buckets.size >= 10000 && !buckets.has(key))
    throw new AppError(
      "RATE_LIMIT",
      "Shared request rate limit reached.",
      429,
      true,
    );
  const bucket = buckets.get(key) ?? { count: 0, expires: now + 60_000 };
  if (bucket.count >= max)
    throw new AppError(
      "RATE_LIMIT",
      "Shared request rate limit reached.",
      429,
      true,
    );
  bucket.count++;
  buckets.set(key, bucket);
}
/** Forwarded IP is used only behind an explicitly trusted, header-sanitizing proxy. */
export function issueIdentity(request: Request): {
  identity: string;
  cookie?: string;
} {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError(
      "SHARED_DISABLED",
      "Shared mode requires a configured session secret.",
    );
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("base64url");
  const origin = request.headers.get("origin");
  const expectedOrigin = configuredAppOrigin() ?? new URL(request.url).origin;
  if (origin && origin !== expectedOrigin)
    throw new AppError(
      "INVALID_ORIGIN",
      "This request origin is not allowed.",
      403,
    );
  const raw = (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("void-session="))
    ?.slice(13);
  const now = Date.now();
  let session: string | undefined;
  if (raw && raw.length < 256) {
    const [id, expiry, signature, ...extra] = raw.split(".");
    const payload = `${id}.${expiry}`;
    const expected = sign(payload);
    if (
      !extra.length &&
      /^[a-f0-9-]{36}$/.test(id) &&
      /^\d+$/.test(expiry) &&
      Number(expiry) > now &&
      Number(expiry) < now + 86400_000 + 1000 &&
      signature?.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      session = payload;
  }
  const fresh = !session;
  if (!session) session = `${randomUUID()}.${now + 86400_000}`;
  let ip = "direct";
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (forwarded && isIP(forwarded)) ip = forwarded;
  }
  rateLimit(`ip:${sign(ip)}`, 10, now);
  rateLimit(`session:${sign(session)}`, 6, now);
  const cookie = fresh
    ? `void-session=${session}.${sign(session)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    : undefined;
  return { identity: sign(`${session}:${ip}`), ...(cookie ? { cookie } : {}) };
}
