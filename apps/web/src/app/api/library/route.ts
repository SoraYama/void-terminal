import { errorResponse } from "../../../lib/server/errors";
import { knowledge } from "../../../lib/server/knowledge";
import { libraryQuery } from "../../../lib/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try {
    const query = libraryQuery(request);
    const result = await knowledge(`/v1/documents${query ? `?${query}` : ""}`, {
      signal: request.signal,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
