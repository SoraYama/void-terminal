import { randomUUID } from "node:crypto";
import { runAgent } from "../../../lib/server/agent";
import {
  credentials,
  providerConfig,
  worstCaseTokens,
} from "../../../lib/server/config";
import { AppError, errorResponse } from "../../../lib/server/errors";
import { issueIdentity } from "../../../lib/server/identity";
import { knowledge } from "../../../lib/server/knowledge";
import { parseChat, readJson, record } from "../../../lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseChat(await readJson(request));
    const key = credentials(input.mode, request);
    providerConfig();
    const identity =
      input.mode === "shared" ? issueIdentity(request) : undefined;
    let reservationId: string | undefined;
    if (identity) {
      const reserved = await knowledge<unknown>("/v1/budget/reserve", {
        body: {
          requestId: randomUUID(),
          identity: identity.identity,
          tokens: worstCaseTokens(input),
        },
        signal: request.signal,
      });
      if (!record(reserved) || typeof reserved.allowed !== "boolean")
        throw new AppError(
          "QUOTA_UNAVAILABLE",
          "The shared usage budget is unavailable.",
        );
      if (!reserved.allowed)
        throw new AppError(
          "QUOTA_EXCEEDED",
          "The shared usage budget has been reached. Use your own API key.",
          429,
        );
      if (typeof reserved.reservationId !== "string" || !reserved.reservationId)
        throw new AppError(
          "QUOTA_UNAVAILABLE",
          "The shared usage budget is unavailable.",
        );
      reservationId = reserved.reservationId;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(sink) {
        const send = (data: string) => {
          if (!closed && !signal.aborted) {
            try {
              sink.enqueue(encoder.encode(data));
            } catch {
              controller.abort();
            }
          }
        };
        const heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
        void (async () => {
          let usedTokens: number | null = null;
          try {
            const result = await runAgent(input, {
              key,
              signal,
              emit: (event) =>
                send(
                  `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
                ),
            });
            usedTokens = result.usedTokens;
          } finally {
            clearInterval(heartbeat);
            // Settlement intentionally has its own timeout and survives browser cancellation.
            // A failed/unknown settlement cannot release quota; the store retains the reservation.
            if (reservationId)
              await knowledge("/v1/budget/settle", {
                body: { reservationId, usedTokens },
                timeout: 5000,
              }).catch(() => {});
            closed = true;
            if (!signal.aborted) {
              try {
                sink.close();
              } catch {
                /* Consumer already cancelled. */
              }
            }
            request.signal.removeEventListener("abort", onAbort);
          }
        })().catch(() => {
          if (!closed) {
            closed = true;
            try {
              sink.close();
            } catch {
              /* Consumer already cancelled. */
            }
          }
        });
        function onAbort() {
          closed = true;
          controller.abort();
          try {
            sink.close();
          } catch {
            /* Consumer already cancelled. */
          }
        }
        request.signal.addEventListener("abort", onAbort, { once: true });
        if (request.signal.aborted) onAbort();
      },
      cancel() {
        closed = true;
        controller.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(identity?.cookie ? { "Set-Cookie": identity.cookie } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
