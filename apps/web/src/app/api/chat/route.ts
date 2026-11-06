import type { ChatEvent } from "../../../lib/contracts";
import { createHash, randomUUID } from "node:crypto";
import { assertAccountOrigin, getAccountSession, applyAccountAuthCookies } from "../../../lib/server/account-auth";
import { reserveAccount, settleAccount, type AccountReservation } from "../../../lib/server/account-budget";
import { runAgent } from "../../../lib/server/agent";
import {
  credentials,
  worstCaseTokens,
} from "../../../lib/server/config";
import { AppError, errorResponse } from "../../../lib/server/errors";
import { issueIdentity } from "../../../lib/server/identity";
import { knowledge } from "../../../lib/server/knowledge";
import { parseChat, readJson, record } from "../../../lib/server/validation";
import { resolveProvider } from "../../../lib/server/provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function POST(request: Request): Promise<Response> {
  let applyCookies = (response: Response) => response;
  let accountReservation: AccountReservation | undefined;
  let streamOwnsReservation = false;
  try {
    const input = parseChat(await readJson(request));
    const key = credentials(input.mode, request);
    let accountId: string | undefined;
    if (input.mode === "shared") {
      assertAccountOrigin(request);
      const session = await getAccountSession(request);
      applyCookies = session.applyCookies;
      if (!session.user) throw new AppError("LOGIN_REQUIRED", "Sign in to use trial credits.", 401);
      accountId = session.user.id;
    }
    const provider = await resolveProvider(input.mode, input.provider, request.signal);
    const identity =
      input.mode === "shared" ? issueIdentity(request) : undefined;
    let reservationId: string | undefined;
    if (accountId) {
      accountReservation = await reserveAccount(accountId, request.headers.get("X-Request-Id"), input.depth, provider.model, request.signal);
    }
    if (identity) {
      const reserved = await knowledge<unknown>("/v1/budget/reserve", {
        body: {
          requestId: randomUUID(),
          identity: createHash("sha256").update(accountId!).digest("hex"),
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
    streamOwnsReservation = true;
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
          let outcome: "completed" | "released" = "released";
          let completion: ChatEvent | undefined;
          try {
            const result = await runAgent(input, {
              key,
              provider,
              signal,
              emit: (event) => {
                // parseSSE cancels on terminal events. Expose them only after accounting.
                if (event.event === "done" || event.event === "error") completion = event;
                else send(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
              },
            });
            usedTokens = result.usedTokens;
            outcome = signal.aborted ? "released" : result.outcome;
          } finally {
            clearInterval(heartbeat);
            // Settlement intentionally has its own timeout and survives browser cancellation.
            // Global unknown token usage retains its conservative hold; account holds expire if settlement fails.
            await Promise.all([
              accountReservation ? settleAccount(accountReservation, outcome, usedTokens) : undefined,
              reservationId ? knowledge("/v1/budget/settle", {
                body: { reservationId, usedTokens }, timeout: 5000,
              }).catch(() => {}) : undefined,
            ]);
            if (completion)
              send(`event: ${completion.event}\ndata: ${JSON.stringify(completion.data)}\n\n`);
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
    return applyCookies(new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(identity?.cookie ? { "Set-Cookie": identity.cookie } : {}),
      },
    }));
  } catch (error) {
    if (accountReservation && !streamOwnsReservation)
      await settleAccount(accountReservation, "released", 0);
    return applyAccountAuthCookies(error, applyCookies(errorResponse(error)));
  }
}
