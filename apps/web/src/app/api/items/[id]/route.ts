import { errorResponse } from "../../../../lib/server/errors";
import { knowledge } from "../../../../lib/server/knowledge";
import { itemIdentity, itemQuery } from "../../../../lib/server/item-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = itemIdentity((await context.params).id);
    const query = itemQuery(request, "detail");
    const result = await knowledge(`/v1/items/${id}${query ? `?${query}` : ""}`, { signal: request.signal });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
