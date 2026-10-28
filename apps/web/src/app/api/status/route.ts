import type { KnowledgeStatus } from "../../../lib/contracts";
import { providerConfig, sharedEnabled } from "../../../lib/server/config";
import { safeError } from "../../../lib/server/errors";
import { knowledge } from "../../../lib/server/knowledge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const provider = {
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    sharedEnabled: sharedEnabled(),
    byok: true,
  };
  try {
    providerConfig();
  } catch {
    provider.sharedEnabled = false;
  }
  try {
    const result = await knowledge<KnowledgeStatus>("/v1/status");
    return Response.json(
      { ...result, provider },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const e = safeError(error);
    return Response.json(
      { ready: false, provider, error: { code: e.code, message: e.message } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
