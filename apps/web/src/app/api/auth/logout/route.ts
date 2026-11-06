import { handleAccountAuth } from "../../../../lib/server/account-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request): Promise<Response> {
  return handleAccountAuth(request, "logout");
}
