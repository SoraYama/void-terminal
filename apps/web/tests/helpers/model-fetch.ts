import { vi } from "vitest";
const nativeFetch = globalThis.fetch.bind(globalThis);
/** Keep the actual DSH loopback transport; only external services are fixtures. */
export function stubFetch(mock: typeof fetch) {
  vi.stubGlobal("fetch", ((
    url: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) =>
    String(url).startsWith("http://127.0.0.1:") &&
    String(url).endsWith("/chat/completions")
      ? nativeFetch(url, init)
      : mock(url, init)) as typeof fetch);
}
