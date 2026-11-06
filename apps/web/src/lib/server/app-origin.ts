import { AppError } from "./errors";
/** Public browser origin is deployment configuration, never derived from forwarding headers. */
export function configuredAppOrigin(): string | undefined {
  const value = process.env.PUBLIC_APP_ORIGIN?.trim();
  if (!value) {
    if (process.env.NODE_ENV === "production")
      throw new AppError(
        "SHARED_DISABLED",
        "Shared mode requires a configured public application origin.",
      );
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "APP_ORIGIN_CONFIG",
      "The public application origin is not configured safely.",
    );
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !localDevelopment) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AppError(
      "APP_ORIGIN_CONFIG",
      "The public application origin is not configured safely.",
    );
  return url.origin;
}
