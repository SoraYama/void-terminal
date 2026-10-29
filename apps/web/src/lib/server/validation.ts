import {
  CONTENT_TYPES,
  type ChatRequest,
  type ContentType,
  type ModelProvider,
} from "../contracts";
import { AppError } from "./errors";
export const invalid = () =>
  new AppError(
    "INVALID_REQUEST",
    "The request is invalid or exceeds the allowed limits.",
    400,
  );
export async function readJson(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw invalid();
  if (Number(request.headers.get("content-length")) > 200_000 || !request.body)
    throw invalid();
  const reader = request.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 200_000) throw invalid();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalid();
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw invalid();
}
export function parseMode(value: unknown): "byok" | "shared" {
  if (value !== "byok" && value !== "shared") throw invalid();
  return value;
}
export function parseProvider(value: unknown, mode: "byok" | "shared"): ModelProvider | undefined {
  if (value === undefined) return undefined;
  if (mode !== "byok")
    throw new AppError("PROVIDER_BYOK_ONLY", "Custom model settings require your own API key.", 400);
  const invalidProvider = () => new AppError("INVALID_PROVIDER", "Enter a valid model name and HTTPS Base URL.", 400);
  if (!record(value) || Object.keys(value).some(key => !["baseUrl", "model"].includes(key))) throw invalidProvider();
  for (const [field, limit] of [["baseUrl", 2048], ["model", 200]] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > limit || /[\x00-\x1f\x7f]/.test(value[field]))) throw invalidProvider();
  }
  return {
    ...(typeof value.baseUrl === "string" && value.baseUrl.trim() ? { baseUrl: value.baseUrl.trim() } : {}),
    ...(typeof value.model === "string" && value.model.trim() ? { model: value.model.trim() } : {}),
  };
}
export function parseChat(value: unknown): ChatRequest {
  if (!record(value)) throw invalid();
  exactKeys(value, [
    "messages",
    "language",
    "answerLanguage",
    "mode",
    "depth",
    "snapshotId",
    "types",
    "provider",
  ]);
  const mode = parseMode(value.mode);
  const provider = parseProvider(value.provider, mode);
  if (
    !Array.isArray(value.messages) ||
    value.messages.length < 1 ||
    value.messages.length > 24
  )
    throw invalid();
  let total = 0;
  const messages = value.messages.map((item) => {
    if (!record(item)) throw invalid();
    exactKeys(item, ["role", "content"]);
    if (
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      !item.content.trim() ||
      item.content.length > 12000
    )
      throw invalid();
    total += item.content.length;
    return {
      role: item.role,
      content: item.content,
    } as ChatRequest["messages"][number];
  });
  if (
    total > 48000 ||
    messages.at(-1)!.role !== "user" ||
    typeof value.language !== "string" ||
    !["zh-CN", "en"].includes(value.language) ||
    typeof value.depth !== "string" ||
    !["standard", "deep"].includes(value.depth)
  )
    throw invalid();
  if (
    value.answerLanguage !== undefined &&
    (typeof value.answerLanguage !== "string" ||
      !["zh-CN", "en"].includes(value.answerLanguage))
  )
    throw invalid();
  if (
    value.snapshotId !== undefined &&
    (typeof value.snapshotId !== "string" ||
      !value.snapshotId ||
      value.snapshotId.length > 512)
  )
    throw invalid();
  if (
    value.types !== undefined &&
    (!Array.isArray(value.types) ||
      value.types.length > CONTENT_TYPES.length ||
      value.types.some((type) => !CONTENT_TYPES.includes(type as ContentType)))
  )
    throw invalid();
  return {
    messages,
    mode,
    ...(provider ? { provider } : {}),
    language: value.language as ChatRequest["language"],
    ...(value.answerLanguage !== undefined
      ? { answerLanguage: value.answerLanguage as ChatRequest["language"] }
      : {}),
    depth: value.depth as ChatRequest["depth"],
    ...(value.snapshotId ? { snapshotId: value.snapshotId as string } : {}),
    ...(value.types ? { types: value.types as ContentType[] } : {}),
  };
}
export function libraryQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  const keys = ["q", "type", "language", "page", "pageSize", "snapshotId"];
  for (const key of query.keys())
    if (!keys.includes(key) || query.getAll(key).length > 1) throw invalid();
  if (query.get("q") && query.get("q")!.length > 2000) throw invalid();
  if (
    query.has("type") &&
    !CONTENT_TYPES.includes(query.get("type") as ContentType)
  )
    throw invalid();
  if (
    query.has("language") &&
    !["zh-CN", "en"].includes(query.get("language")!)
  )
    throw invalid();
  for (const [key, max] of [
    ["page", 100_000],
    ["pageSize", 100],
  ] as const)
    if (
      query.has(key) &&
      (!/^\d+$/.test(query.get(key)!) ||
        Number(query.get(key)) < 1 ||
        Number(query.get(key)) > max)
    )
      throw invalid();
  if (
    query.has("snapshotId") &&
    (!query.get("snapshotId") || query.get("snapshotId")!.length > 512)
  )
    throw invalid();
  return query.toString();
}
export function snapshotQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) if (key !== "snapshotId") throw invalid();
  if (
    query.getAll("snapshotId").length > 1 ||
    (query.has("snapshotId") &&
      (!query.get("snapshotId") || query.get("snapshotId")!.length > 512))
  )
    throw invalid();
  return query.toString();
}
