import { errorResponse } from "../../../../lib/server/errors";
import { knowledge } from "../../../../lib/server/knowledge";
import { invalid, snapshotQuery } from "../../../../lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!id || id.length > 512) throw invalid();
    const query = snapshotQuery(request);
    const result = await knowledge(
      `/v1/documents/${encodeURIComponent(id)}${query ? `?${query}` : ""}`,
      { signal: request.signal },
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
