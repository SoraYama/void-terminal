> **Date / Revised**: 2026-11-06

# Email OTP accounts and trial model proxy

## Request and boundary

User approved continuing with email-code login, a one-time free allowance, server-owned model invocation and usage history. No checkout, payment, top-up or deployment was performed. BYOK remains available. Both web and knowledge default to disabled account trials, and shared mode can no longer run anonymously.

## Design and implementation

- `account-auth.ts` uses pinned official Supabase JS/SSR clients exclusively server-side. POST send-code, verify-code and logout require an exact configured Origin. Sessions are verified with `getUser`, confirmed email and the current invitation allowlist. Production cookies are host-prefixed, Secure, HttpOnly, SameSite=Strict; refresh tokens never appear in public JSON or browser storage. Failed user verification after successful refresh preserves rotated cookies on the error response.
- `account_store.py` provides a separate persistent WAL SQLite ledger. `BEGIN IMMEDIATE`, per-account request uniqueness and a unique active-reservation index prevent repeated grants, replay and concurrent overspend. Internal endpoints require the knowledge token. IDs are derived from verified auth, not browser JSON. No prompts, answers or email addresses enter the ledger.
- Each new account receives 20 configurable trial credits once; standard research uses 1, deep uses 3. User credits reserve before global provider-token budget admission. Failed global admission, failed/cancelled agent runs and no-evidence responses release credits. Idempotent settlement retries once without the browser's aborted signal; crash/outage holds expire after 10 minutes on subsequent ledger access. Operator unknown-token reservations remain conservative and independent.
- `runAgent` returns an explicit completion outcome. The chat route buffers terminal SSE events until accounting finishes: the real browser parser cancels its reader as soon as it sees done/error, so sending those events earlier races balance refresh and retry admission.
- Account modal covers email/code, balance, recent usage (model, known tokens, completed/held/released/expired units), logout and recoverable errors. History keeps the original guest database and separate per-account IndexedDB namespaces. Identity transitions clear key/current state, abort ongoing chat/model/source/document work and guard delayed writes. Initial guest discovery preserves drafts typed while account lookup was pending.
- Both Compose variants mount a dedicated account volume. The knowledge image creates/chowns `/accounts` before switching to its non-root user. The ledger never belongs in a corpus archive and must be backed up independently.

## Verification

Results and exact commands are recorded in ignored `artifacts/account-trial/` reports/logs. Production build (including TypeScript) and 374 web unit/integration tests passed. Knowledge tests: 291 passed, 8 skipped, 19 subtests passed, including 41 account tests. Auth coverage includes 47 tests, of which four use the real SDK against simulated network responses. Route tests exercise actual SSE client completion ordering with delayed ledger settlement.

Browser acceptance: 22 account scenarios passed on desktop/mobile, including light/dark, account switching, usage states, cancellation, logout failure and delayed initial guest lookup. Existing chat/history/scroll regression ran 56 scenarios: 53 passed on the initial run; two shared-provider scenarios needed an authenticated fixture, and one failed because simultaneous test runs used the same trace directory. Isolated rechecks on the production build passed all 26 selected scenarios (22 account + 4 provider/snapshot scenarios), resolving those three failures. Focus restoration passed four follow-up cases after its last UI fix, and expired shared model-test sessions passed two additional desktop/mobile cases.

Independent security/code review found and fixed terminal SSE/accounting order and fresh account-volume ownership. The final report has no open actionable defect. A final focused 86-test auth/API rerun passed after preserving no-transform caching for authenticated streams. Fixtures do not establish live email or model-provider acceptance.

## Operation and limits

See [account trial setup](../../operations/account-trial.md). Supply a Supabase project/publishable key, SMTP sender with a six-digit `{{ .Token }}` email template, invitation allowlist, exact origin, server model key and finite global budget before enabling. Single knowledge instance/local filesystem only in this version. The machine has no Docker executable; actual fresh-volume runtime validation remains unperformed. Real email delivery, live authenticated provider calls and deployment require configured external services and remain unverified.

Browser history partitioning is interface isolation, not encryption against someone with access to that browser profile. Questions still pass through the application and model provider. Trial credits are fixed service units without monetary value; token metadata is not a bill. No payment functionality is included.
