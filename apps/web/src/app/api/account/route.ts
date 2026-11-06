import { accountAuthEnabled, getAccountSession, applyAccountAuthCookies } from "../../../lib/server/account-auth";
import { errorResponse } from "../../../lib/server/errors";
import { knowledge } from "../../../lib/server/knowledge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  let applyCookies = (response: Response) => response;
  try {
    if (!accountAuthEnabled())
      return Response.json({ enabled: false, authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    const session = await getAccountSession(request);
    applyCookies = session.applyCookies;
    if (!session.user)
      return applyCookies(Response.json({ enabled: true, authenticated: false }));
    const summary = await knowledge<Record<string, unknown>>("/v1/accounts/summary", {
      body: { accountId: session.user.id }, signal: request.signal,
    });
    return applyCookies(Response.json({ ...summary, enabled: true, authenticated: true, user: session.user }));
  } catch (error) {
    return applyAccountAuthCookies(error, applyCookies(errorResponse(error)));
  }
}
