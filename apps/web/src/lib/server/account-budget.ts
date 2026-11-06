import { AppError } from "./errors";
import { knowledge } from "./knowledge";
import { record } from "./validation";

export type AccountReservation = { accountId: string; reservationId: string };
export async function reserveAccount(
  accountId: string,
  requestId: string | null,
  depth: "standard" | "deep",
  model: string,
  signal: AbortSignal,
): Promise<AccountReservation> {
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    throw new AppError("REQUEST_ID_REQUIRED", "A valid request identifier is required.", 400);
  const result = await knowledge<unknown>("/v1/accounts/reserve", {
    body: { accountId, requestId, depth, model }, signal,
  });
  if (!record(result) || typeof result.allowed !== "boolean")
    throw new AppError("ACCOUNT_UNAVAILABLE", "Your trial credits are temporarily unavailable.");
  if (!result.allowed) {
    if (result.reason === "insufficient_credits")
      throw new AppError("CREDITS_EXHAUSTED", "You do not have enough trial credits for this request.", 402);
    if (result.reason === "in_progress")
      throw new AppError("ACCOUNT_BUSY", "Another request is still using this account. Please wait for it to finish.", 409);
    if (result.reason === "duplicate_request")
      throw new AppError("REQUEST_REPLAY", "This request has already been submitted. Start a new request to try again.", 409);
    throw new AppError("ACCOUNT_UNAVAILABLE", "Your trial credits are temporarily unavailable.");
  }
  if (typeof result.reservationId !== "string" || !result.reservationId)
    throw new AppError("ACCOUNT_UNAVAILABLE", "Your trial credits are temporarily unavailable.");
  return { accountId, reservationId: result.reservationId };
}

/** Settlement is idempotent; retries survive client cancellation. Expiry recovers outages/crashes. */
export async function settleAccount(
  reservation: AccountReservation,
  outcome: "completed" | "released",
  usedTokens: number | null,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await knowledge<unknown>("/v1/accounts/settle", {
        body: { ...reservation, outcome, usedTokens }, timeout: 5000,
      });
      if (record(result) && typeof result.settled === "boolean") return;
    } catch { /* Retry once, then allow durable lease expiry to release the hold. */ }
  }
  console.warn("ACCOUNT_SETTLEMENT_DEFERRED");
}
