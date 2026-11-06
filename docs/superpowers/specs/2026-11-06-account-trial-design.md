# Account trial design

User accepted implementation of email-code login, free credits, server-owned model calls and usage history. No payments or production deployment in this change.

- Supabase Auth handles email OTP and verified user identity. Use server-only auth endpoints and HttpOnly same-site cookies; no model key or auth token returned in JSON/browser storage. All auth/account responses are no-store. State-changing account/shared endpoints require an exact configured Origin. Invalid/missing configuration fails closed.
- ACCOUNT_TRIAL_ENABLED opt-in. SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are server configuration. TRIAL_ALLOWED_EMAILS is mandatory: comma separated invited emails, or explicit * for public access. Never grant credits to disallowed/unverified accounts. No credentials supplied: local automated fixtures only, real email delivery remains deployment setup.
- SQLite account ledger is independent from corpus DB/snapshots: ACCOUNT_DATABASE_PATH points to a separately persisted file. Single knowledge service instance in v1. Internal routes require knowledge service token in production. Account ID comes only from verified Supabase user. Do not store prompts or email addresses in ledger.
- First account use grants configurable ACCOUNT_TRIAL_CREDITS (default 20) exactly once. Standard successful research costs 1 credit, deep costs 3. Reserve atomically before model dispatch; insufficient balance and concurrent runs per account reject. Completed requests consume reservation; error/cancellation releases. Reserved entries expire after 10 minutes to recover process crashes; whole Agent run limited to 180 seconds. Repeated request IDs never run again, including after release. User credits are separate from conservative global token budget.
- Metadata: request UUID, depth, model, units, creation time, status, aggregate provider token usage if known. No monetary conversion or advertised real pricing.
- BYOK remains available and retains current secure transport. Shared mode always requires authenticated account, never falls back to anonymous. Models/test shared also requires authentication. Browser history stays local and is namespaced per account; switching identity must abort active work, clear key and current conversation state, and not reveal another account's history.
- Account UI: email -> code -> balance + recent usage + logout, loading/error/retry/disabled states, accessible modal and mobile fit, current visual system. No paid controls.

## Interfaces

Auth helper apps/web/src/lib/server/account-auth.ts exports:
`accountAuthEnabled(): boolean`, `assertAccountOrigin(request: Request): void`, `getAccountSession(request: Request): Promise<{ user: { id: string; email: string } | null; applyCookies(response: Response): Response }>`.
Auth routes POST /api/auth/send-code {email}, /api/auth/verify-code {email,code}, /api/auth/logout. Success {ok:true}; errors existing AppError envelope. Missing/unallowed users return no session. SUPABASE provider access only server-side and bounded by timeouts; no response tokens in logs.

Internal POST /v1/accounts/summary {accountId} -> {credits:{available,held,totalGranted},trialCredits,costs:{standard:1,deep:3},usage:[{requestId,createdAt,depth,units,status,usedTokens,model}]} (newest 20). Summary ensures one-time grant.
Internal POST /v1/accounts/reserve {accountId,requestId,depth,model} -> {allowed:boolean,reason?:insufficient_credits|in_progress|duplicate_request,reservationId?:string}.
Internal POST /v1/accounts/settle {accountId,reservationId,outcome:completed|released,usedTokens:number|null} -> {settled:boolean}. Idempotent and ownership enforced. No client-specified credit amounts.
Public GET /api/account -> {enabled,authenticated,user?:{id,email},credits?,trialCredits?,costs?,usage?}; unavailable ledger returns explicit error rather than zero balance.
Shared chat header X-Request-Id UUID, account resolved server-side. Public client cannot select accountId. Failed global-budget admission releases user reservation. Account refresh after stream finishes.
