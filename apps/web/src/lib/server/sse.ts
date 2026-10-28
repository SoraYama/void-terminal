import { AppError } from "./errors";
/** Incremental SSE decoding preserves UTF-8 codepoints across arbitrary network chunks. */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let frameSize = 0;
  let bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      bytes += value?.byteLength ?? 0;
      if (bytes > 4_000_000)
        throw new AppError(
          "UPSTREAM_LIMIT",
          "The model response exceeded the safe limit.",
        );
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          if (data.length) {
            yield data.join("\n");
            data = [];
            frameSize = 0;
          }
        } else if (line.startsWith("data:")) {
          const text = line.slice(5).replace(/^ /, "");
          frameSize += text.length;
          if (frameSize > 262144)
            throw new AppError(
              "UPSTREAM_LIMIT",
              "The model response exceeded the safe limit.",
            );
          data.push(text);
        }
      }
      if (buffer.length > 262144)
        throw new AppError(
          "UPSTREAM_LIMIT",
          "The model response exceeded the safe limit.",
        );
      if (done) {
        if (buffer || data.length)
          throw new AppError(
            "UPSTREAM_TRUNCATED",
            "The model stream ended unexpectedly.",
            503,
            true,
          );
        break;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
