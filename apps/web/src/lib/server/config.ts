import type { ChatRequest } from "../contracts";
import { AppError } from "./errors";
import { configuredAppOrigin } from "./app-origin";
export { configuredAppOrigin } from "./app-origin";
import { accountAuthEnabled } from "./account-auth";
import { assertRequestMode, deploymentMode } from "./deployment";
export const MAX_TOOL_ROUNDS = 4;
export const MAX_PROVIDER_REQUEST_BYTES = 400_000;
export function providerConfig() {
  const base = (
    process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  ).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new AppError(
      "PROVIDER_CONFIG",
      "The model provider is not configured safely.",
    );
  }
  const allowed = new Set([
    "https://api.deepseek.com",
    ...(process.env.DEEPSEEK_ALLOWED_BASE_URLS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  ]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowed.has(url.origin) ||
    !["/", "/v1"].includes(url.pathname)
  ) {
    throw new AppError(
      "PROVIDER_CONFIG",
      "The model provider is not configured safely.",
    );
  }
  return { base, model: process.env.DEEPSEEK_MODEL || "deepseek-flash" };
}
export function sharedEnabled() {
  if (deploymentMode() !== "hosted") return false;
  try {
    configuredAppOrigin();
  } catch {
    return false;
  }
  return (
    process.env.SHARED_MODE_ENABLED === "true" &&
    accountAuthEnabled() &&
    Boolean(process.env.DEEPSEEK_API_KEY?.trim()) &&
    Boolean(
      process.env.SESSION_SECRET?.length &&
      process.env.SESSION_SECRET.length >= 32,
    ) &&
    (process.env.NODE_ENV !== "production" ||
      Boolean(process.env.KNOWLEDGE_API_TOKEN))
  );
}
export function credentials(mode: "byok" | "shared", request: Request) {
  assertRequestMode(mode);
  if (mode === "shared") {
    if (!sharedEnabled())
      throw new AppError(
        "SHARED_DISABLED",
        "Account chat is temporarily unavailable. Try again later.",
        503,
      );
    return process.env.DEEPSEEK_API_KEY!.trim();
  }
  const key = request.headers.get("X-Model-Api-Key")?.trim();
  if (!key || key.length > 512 || /[\s\x00-\x1f\x7f]/.test(key))
    throw new AppError(
      "MODEL_KEY_REQUIRED",
      "Enter a valid model API key.",
      401,
    );
  return key;
}
export function outputLimit(depth: "standard" | "deep", synthesis = false) {
  const configured = Number(
    process.env[
      depth === "deep" ? "AGENT_DEEP_MAX_TOKENS" : "AGENT_STANDARD_MAX_TOKENS"
    ],
  );
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, depth === "deep" ? 8192 : 4096)
    : depth === "deep" || synthesis
      ? 8192
      : 4096;
}
/** History is measured exactly; the remaining bytes bound evidence, tool transcripts and protocol. */
export function requestByteLimit(input: ChatRequest) {
  return Math.min(
    MAX_PROVIDER_REQUEST_BYTES,
    Buffer.byteLength(JSON.stringify(input.messages), "utf8") + 128000,
  );
}
/** UTF-8 byte count conservatively bounds input tokens; every possible round is reserved. */
export function worstCaseTokens(input: ChatRequest) {
  return (
    MAX_TOOL_ROUNDS * (requestByteLimit(input) + outputLimit(input.depth)) +
    requestByteLimit(input) + outputLimit(input.depth, true)
  );
}
