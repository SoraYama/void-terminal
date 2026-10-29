import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as pinnedFetch } from "undici";
import type { ModelProvider } from "../contracts";
import { providerConfig } from "./config";
import { AppError } from "./errors";
import { parseProvider } from "./validation";

type Address = { address: string; family: number };
export type ResolvedProvider = {
  base: string;
  model: string;
  deepseekExtensions: boolean;
  /** Present only for visitor-controlled endpoints. Never resolved again by the socket. */
  pinned?: { hostname: string; addresses: readonly Address[] };
};
export type ProviderTransport = {
  fetch: (path: "/models" | "/chat/completions", init: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
};
const invalidProvider = () => new AppError("INVALID_PROVIDER", "Enter a valid model name and HTTPS Base URL.", 400);
const blockedAddress = () => new AppError("PROVIDER_ADDRESS_BLOCKED", "The model Base URL must use public HTTPS. Local and private network addresses are unavailable.", 400);
const unavailable = () => new AppError("MODEL_UNAVAILABLE", "The model provider is unavailable.", 503, true);

/** Fail closed for special-use, mapped, transitional and non-global address ranges. */
export function isPublicAddress(address: string): boolean {
  try {
    if (!isIP(address) || address === "168.63.129.16") return false;
    const parsed = ipaddr.parse(address);
    if (parsed.range() !== "unicast") return false;
    if (parsed.kind() === "ipv6" && !parsed.match(ipaddr.parse("2000::"), 3)) return false;
    return true;
  } catch { return false; }
}

function providerUrl(base: string): URL {
  if (base.length > 2048 || /[\s\x00-\x1f\x7f\\?#]/u.test(base)) throw invalidProvider();
  let url: URL;
  try { url = new URL(base); } catch { throw invalidProvider(); }
  if (url.protocol !== "https:") throw blockedAddress();
  if (url.username || url.password || base.split("/")[2]?.includes("@") || url.search || url.hash || !url.hostname) throw invalidProvider();
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || /\.(?:localhost|local|internal|home\.arpa)\.?$/i.test(hostname) || (!isIP(hostname) && !hostname.includes("."))) throw blockedAddress();
  if (isIP(hostname) && !isPublicAddress(hostname)) throw blockedAddress();
  return url;
}

async function publicAddresses(hostname: string, signal?: AbortSignal): Promise<Address[]> {
  if (signal?.aborted) throw unavailable();
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]);
  let onAbort: () => void = () => {};
  try {
    const answers = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(unavailable());
        deadline.addEventListener("abort", onAbort, { once: true });
        if (deadline.aborted) onAbort();
      }),
    ]);
    if (!answers.length) throw unavailable();
    if (answers.some(answer => ![4, 6].includes(answer.family) || isIP(answer.address) !== answer.family || !isPublicAddress(answer.address))) throw blockedAddress();
    return answers;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable();
  } finally { deadline.removeEventListener("abort", onAbort); }
}

export async function resolveProvider(mode: "byok" | "shared", provider?: ModelProvider, signal?: AbortSignal): Promise<ResolvedProvider> {
  const custom = parseProvider(provider, mode);
  const defaults = providerConfig();
  const model = custom?.model || defaults.model;
  if (!model || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw invalidProvider();
  if (!custom?.baseUrl) return { ...defaults, model, deepseekExtensions: new URL(defaults.base).origin === "https://api.deepseek.com" };
  const url = providerUrl(custom.baseUrl);
  const base = url.href.replace(/\/+$/, "");
  // Explicitly reusing the operator's endpoint retains the operator trust boundary.
  if (base === defaults.base) return { base, model, deepseekExtensions: url.origin === "https://api.deepseek.com" };
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return {
    base, model, deepseekExtensions: url.origin === "https://api.deepseek.com",
    pinned: { hostname, addresses: await publicAddresses(hostname, signal) },
  };
}

/** Node's TLS connector receives only this immutable validated DNS snapshot. */
export function createPinnedLookup(hostname: string, addresses: readonly Address[]): LookupFunction {
  const pinned = addresses.map(answer => ({ ...answer }));
  return ((requestedHost: string, options: { all?: boolean; family?: number } | number, callback: (...args: unknown[]) => void) => {
    if (requestedHost.toLowerCase() !== hostname.toLowerCase()) {
      callback(blockedAddress());
      return;
    }
    const family = typeof options === "number" ? options : options?.family;
    const candidates = pinned.filter(answer => !family || answer.family === family);
    if (!candidates.length) { callback(unavailable()); return; }
    if (typeof options === "object" && options?.all) callback(null, candidates.map(answer => ({ ...answer })));
    else callback(null, candidates[0].address, candidates[0].family);
  }) as LookupFunction;
}

export function openProviderTransport(provider: ResolvedProvider, signal?: AbortSignal): ProviderTransport {
  signal?.throwIfAborted();
  // An explicit Agent ignores HTTP(S)_PROXY and never delegates to a global proxy dispatcher.
  const agent = provider.pinned ? new Agent({
    connections: 1,
    pipelining: 1,
    // Node may try every pinned A/AAAA answer, including same-family fallbacks.
    // The custom lookup below supplies the snapshot for all connection attempts.
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
    connect: { lookup: createPinnedLookup(provider.pinned.hostname, provider.pinned.addresses), timeout: 10_000 },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
    maxResponseSize: 4_000_000,
  }) : undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    signal?.removeEventListener("abort", onAbort);
    return closing ??= agent ? agent.destroy().then(() => {}) : Promise.resolve();
  };
  const onAbort = () => { void close().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    async fetch(path, init) {
      if (closing || signal?.aborted) throw unavailable();
      const url = `${provider.base}${path}`;
      if (!agent) return fetch(url, { ...init, redirect: "error", cache: "no-store" });
      return await pinnedFetch(url, {
        ...init, dispatcher: agent, redirect: "error", cache: "no-store",
      } as Parameters<typeof pinnedFetch>[1]) as unknown as Response;
    },
    close,
  };
}
