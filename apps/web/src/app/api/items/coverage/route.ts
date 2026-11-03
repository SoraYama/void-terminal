import { errorResponse } from "../../../../lib/server/errors";
import { knowledge } from "../../../../lib/server/knowledge";
import { itemQuery } from "../../../../lib/server/item-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try {
    const query = itemQuery(request, "coverage");
    const result = await knowledge(`/v1/items/coverage${query ? `?${query}` : ""}`, { signal: request.signal });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
