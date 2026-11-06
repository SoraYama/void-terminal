import { accountAuthEnabled, applyAccountAuthCookies, assertAccountOrigin, getAccountSession } from "../../../../lib/server/account-auth";
import { readAccountSummary } from "../../../../lib/server/account-budget";
import { accountRisk, challengeToken, riskUnavailable } from "../../../../lib/server/account-risk";
import { AppError, errorResponse } from "../../../../lib/server/errors";
import { exactKeys, invalid, readJson, record } from "../../../../lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let applySessionCookies = (response: Response) => response;
  let risk: ReturnType<typeof accountRisk>;
  try {
    if (!accountAuthEnabled()) throw new AppError("AUTH_DISABLED", "Account access is not available.", 503);
    assertAccountOrigin(request);
    const body = await readJson(request);
    if (!record(body)) throw invalid();
    exactKeys(body, ["token", "signals"]);
    const token = challengeToken(body.token);
    risk = accountRisk(request, body.signals);
    if (!risk) throw riskUnavailable();
    const session = await getAccountSession(request);
    applySessionCookies = session.applyCookies;
    await risk.verifyChallenge(token, session.user?.id ?? null);
    const summary = await readAccountSummary(request, session.user, risk);
    return risk.applyCookies(applySessionCookies(Response.json(summary)));
  } catch (error) {
    const response = applyAccountAuthCookies(error, applySessionCookies(errorResponse(error)));
    return risk?.applyCookies(response) ?? response;
  }
}
