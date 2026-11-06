import { expect, vi } from "vitest";
import { accountRisk } from "../../src/lib/server/account-risk";

export const riskFixtureEnv = {
  ACCOUNT_RISK_SECRET: "fixture-account-risk-secret-32-bytes-minimum",
  TURNSTILE_SITE_KEY: "fixture-public-site-key",
  TURNSTILE_SECRET_KEY: "fixture-secret-site-key",
};

export const allowRisk = () => Response.json({ allowed: true, challengeRequired: false, retryAfter: 0 });

/** Prepare real signed cookies for regressions focused on post-admission behavior. */
export async function verifiedDeviceCookies(origin: string, accountId: string | null): Promise<string> {
  for (const [name, value] of Object.entries(riskFixtureEnv)) vi.stubEnv(name, value);
  const risk = accountRisk(new Request(origin));
  expect(risk).toBeDefined();
  const originalFetch = globalThis.fetch;
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    return Response.json({ success: true, hostname: new URL(origin).hostname, action: "account_device", challenge_ts: new Date().toISOString() });
  });
  globalThis.fetch = fetcher;
  try {
    await risk!.verifyChallenge("test-widget-token", accountId);
    return risk!.applyCookies(new Response()).headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  } finally { globalThis.fetch = originalFetch; }
}
