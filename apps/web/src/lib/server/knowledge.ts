import { AppError } from "./errors";
const errorCodes: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "KNOWLEDGE_AUTH",
  404: "NOT_FOUND",
  409: "SNAPSHOT_UNAVAILABLE",
  429: "QUOTA_EXCEEDED",
  503: "KNOWLEDGE_UNAVAILABLE",
};
export async function boundedJson(
  response: Response,
  maxBytes = 2_000_000,
): Promise<unknown> {
  if (!response.body)
    throw new AppError(
      "INVALID_SERVICE_RESPONSE",
      "The service returned an invalid response.",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        throw new AppError(
          "SERVICE_RESPONSE_LIMIT",
          "The service response exceeded the safe limit.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError(
      "INVALID_SERVICE_RESPONSE",
      "The service returned an invalid response.",
    );
  }
}
export async function knowledge<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal; timeout?: number } = {},
): Promise<T> {
  const base = (process.env.KNOWLEDGE_URL || "http://127.0.0.1:8000").replace(
    /\/+$/,
    "",
  );
  const timeout = AbortSignal.timeout(options.timeout ?? 12000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  try {
    const response = await fetch(`${base}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.KNOWLEDGE_API_TOKEN
          ? { "X-Knowledge-Token": process.env.KNOWLEDGE_API_TOKEN }
          : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = errorCodes[response.status] ? response.status : 503;
      throw new AppError(
        errorCodes[status] || "KNOWLEDGE_UNAVAILABLE",
        status === 404
          ? "The requested evidence was not found."
          : status === 409
            ? "The requested snapshot is unavailable."
            : status === 429
              ? "The shared usage budget has been reached."
              : "The knowledge service is unavailable.",
        status,
        status === 503,
      );
    }
    return (await boundedJson(response)) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (options.signal?.aborted) throw error;
    throw new AppError(
      "KNOWLEDGE_UNAVAILABLE",
      "The knowledge service is unavailable.",
      503,
      true,
    );
  }
}
