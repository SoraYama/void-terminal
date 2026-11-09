import type { KnowledgeStatus } from "../../../lib/contracts";
import type { DeploymentMode } from "../../../lib/deployment";
import { providerConfig, sharedEnabled } from "../../../lib/server/config";
import { errorResponse, safeError } from "../../../lib/server/errors";
import { deploymentMode } from "../../../lib/server/deployment";
import { knowledge } from "../../../lib/server/knowledge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  let mode: DeploymentMode;
  try {
    mode = deploymentMode();
  } catch (error) {
    return errorResponse(error);
  }
  const deployment = { mode };
  const provider = {
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    sharedEnabled: sharedEnabled(),
    byok: mode === "self-hosted",
  };
  try {
    providerConfig();
  } catch {
    provider.sharedEnabled = false;
  }
  try {
    const result = await knowledge<KnowledgeStatus>("/v1/status");
    return Response.json(
      { ...result, deployment, provider },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const e = safeError(error);
    return Response.json(
      { ready: false, deployment, provider, error: { code: e.code, message: e.message } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
