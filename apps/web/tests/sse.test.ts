import { describe, expect, it } from "vitest";
import { parseSSE } from "../src/lib/server/sse";

describe("upstream SSE parser", () => {
  it("preserves split UTF-8, CRLF, multiline data, and ignores keepalive comments", async () => {
    const bytes = new TextEncoder().encode(
      ': ping\r\ndata: {"text":\r\ndata: "旅行者"}\r\n\r\ndata: [DONE]\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
        c.close();
      },
    });
    const received = [];
    for await (const value of parseSSE(stream)) received.push(value);
    expect(received).toEqual(['{"text":\n"旅行者"}', "[DONE]"]);
  });
  it("cancels its reader when a consumer stops early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: a\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const value of parseSSE(stream)) {
      expect(value).toBe("a");
      break;
    }
    expect(cancelled).toBe(true);
  });
  it("accepts a large network chunk composed of small valid SSE frames", async () => {
    const bytes = new TextEncoder().encode("data: small\n\n".repeat(30000));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
    let count = 0;
    for await (const frame of parseSSE(stream)) {
      expect(frame).toBe("small");
      count++;
    }
    expect(count).toBe(30000);
  });
  it("rejects oversized unframed upstream data", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(300_000).fill(65));
        c.close();
      },
    });
    await expect(async () => {
      for await (const _ of parseSSE(stream)) void _;
    }).rejects.toThrow();
  });
});
