import { accountAuthEnabled, getAccountSession, applyAccountAuthCookies } from "../../../lib/server/account-auth";
import { errorResponse } from "../../../lib/server/errors";
import { readAccountSummary } from "../../../lib/server/account-budget";
import { accountRisk } from "../../../lib/server/account-risk";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  let applyCookies = (response: Response) => response;
  try {
    if (!accountAuthEnabled())
      return Response.json({ enabled: false, authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    const session = await getAccountSession(request);
    applyCookies = session.applyCookies;
    return applyCookies(Response.json(await readAccountSummary(request, session.user, accountRisk(request))));
  } catch (error) {
    return applyAccountAuthCookies(error, applyCookies(errorResponse(error)));
  }
}
