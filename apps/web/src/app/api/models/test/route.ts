import { credentials } from "../../../../lib/server/config";
import { AppError, safeError } from "../../../../lib/server/errors";
import { issueIdentity } from "../../../../lib/server/identity";
import { boundedJson } from "../../../../lib/server/knowledge";
import { openProviderTransport, resolveProvider, type ProviderTransport } from "../../../../lib/server/provider";
import {
  exactKeys,
  invalid,
  parseMode,
  parseProvider,
  readJson,
  record,
} from "../../../../lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  let model = "deepseek-flash";
  let transport: ProviderTransport | undefined;
  try {
    const body = await readJson(request);
    if (!record(body)) throw invalid();
    exactKeys(body, ["mode", "provider"]);
    const mode = parseMode(body.mode);
    const provider = parseProvider(body.provider, mode);
    model = provider?.model || model;
    const key = credentials(mode, request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
    const config = await resolveProvider(mode, provider, signal);
    model = config.model;
    transport = openProviderTransport(config, signal);
    const identity = mode === "shared" ? issueIdentity(request) : undefined;
    let response: Response;
    try {
      response = await transport.fetch("/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new AppError(
        "MODEL_UNAVAILABLE",
        "The model provider is unavailable.",
        503,
        true,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "MODEL_TEST_FAILED",
        response.status === 401 || response.status === 403
          ? "The model API key was not accepted."
          : "The model provider is unavailable.",
        response.status === 401 || response.status === 403 ? 401 : 503,
      );
    }
    const result = await boundedJson(response, 100_000);
    if (
      !record(result) ||
      !Array.isArray(result.data) ||
      !result.data.some((item) => record(item) && item.id === model)
    )
      throw new AppError(
        "MODEL_UNAVAILABLE",
        "The configured model is not available for this key.",
        503,
      );
    return Response.json(
      {
        ok: true,
        model,
        message:
          "Connected. The configured model is available; no generation was requested.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
          ...(identity?.cookie ? { "Set-Cookie": identity.cookie } : {}),
        },
      },
    );
  } catch (error) {
    const e = safeError(error);
    return Response.json(
      { ok: false, model, code: e.code, message: e.message },
      { status: e.status, headers: { "Cache-Control": "no-store" } },
    );
  } finally { await transport?.close().catch(() => {}); }
}
