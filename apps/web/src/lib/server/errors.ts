/** Public error messages are constants. Never forward provider response bodies or exception strings. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
    public retryable = false,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function safeError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError(
        "SERVICE_UNAVAILABLE",
        "The service is temporarily unavailable.",
        503,
        true,
      );
}
export function errorResponse(error: unknown): Response {
  const e = safeError(error);
  return Response.json(
    { error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } },
    { status: e.status, headers: { "Cache-Control": "no-store", ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } },
  );
}
