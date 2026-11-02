import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ModelBody = Record<string, unknown>;
export type ModelDispatch = (
  body: ModelBody,
  signal: AbortSignal,
) => Promise<Response>;
const MAX_BRIDGE_BODY = 2_000_000;

async function bodyOf(request: IncomingMessage): Promise<ModelBody> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BRIDGE_BODY) throw new Error("Model bridge body limit");
    chunks.push(Buffer.from(chunk));
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid model bridge body");
  return value as ModelBody;
}

/** Request-private transport adapter. DSH never receives the visitor's Key. */
export async function openModelBridge(options: {
  signal: AbortSignal;
  dispatch: ModelDispatch;
}) {
  options.signal.throwIfAborted();
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  let error: unknown;
  const server = createServer(async (request, response) => {
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    const connection = new AbortController();
    const requestSignal = AbortSignal.any([signal, connection.signal]);
    response.once("close", () => {
      if (!response.writableEnded) connection.abort();
    });
    try {
      const body = await bodyOf(request);
      requestSignal.throwIfAborted();
      const upstream = await options.dispatch(body, requestSignal);
      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      });
      if (upstream.body)
        await pipeline(
          Readable.fromWeb(
            upstream.body as Parameters<typeof Readable.fromWeb>[0],
          ),
          response,
          { signal: requestSignal },
        );
      else response.end();
    } catch (failure) {
      if (!requestSignal.aborted) error ??= failure;
      if (!response.headersSent)
        response
          .writeHead(502, { "content-type": "application/json" })
          .end('{"error":{"message":"Model request failed"}}');
      else response.destroy();
    }
  });
  server.requestTimeout = 180_000;
  server.headersTimeout = 10_000;
  // The official model SDK adds Stainless/runtime metadata headers. A lower
  // count drops Authorization on older Node and returns 431 on newer Node.
  // Keep the default byte ceiling and a bounded, SDK-compatible header count.
  server.maxHeadersCount = 64;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    options.signal.removeEventListener("abort", onAbort);
    return (closing ??= new Promise<void>((resolve) => {
      lifetime.abort();
      server.close(() => resolve());
      server.closeAllConnections();
    }));
  };
  const onAbort = () => {
    void close();
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) await close();
  const address = server.address();
  if (!address || typeof address === "string") {
    await close();
    throw new Error("Model bridge unavailable");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    token,
    close,
    get error() {
      return error;
    },
  };
}
