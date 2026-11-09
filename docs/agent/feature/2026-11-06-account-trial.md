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

See [account trial setup](../../operations/account-trial.md). Supply a Supabase project/publishable key, SMTP sender with a six-digit `{{ .Token }}` email template, invitation allowlist, exact origin, server model key and finite global budget before enabling. Single knowledge instance/local filesystem only in this version. The local machine has no Docker executable; subsequent isolated server verification passed fresh-volume ownership, persistence and packaged Web startup checks (see preparation record below). Real email delivery, live authenticated provider calls and deployment require configured external services and remain unverified.

Browser history partitioning is interface isolation, not encryption against someone with access to that browser profile. Questions still pass through the application and model provider. Trial credits are fixed service units without monetary value; token metadata is not a bill. No payment functionality is included.


## Subsequent hosted setup preparation (historical, before activation)

On 2026-11-06 the user confirmed there is no Supabase/SMTP setup yet and accepted preparing the recommended services. Chosen initial path: Supabase Auth Free + Resend Free, invitation-only, sending subdomain `auth.sorayama.moe`. The six-digit code template is `deploy/auth/email-otp.html`; account creation, DNS verification and actual mail delivery still require the user's external accounts. Follow [first setup instructions](../../operations/account-trial-onboarding.md).

Server candidate directory: `/opt/void-terminal/releases/account-trial-7193f3e`. Candidate source was reconstructed from the deployed Git baseline plus the exact commit patch, then all 347 file blob hashes were checked against `7193f3eacae5e41803b75f336302bc2bbf967911`. This replaced a slow full-archive upload; the partial upload was removed.

- Knowledge candidate: `sha256:55d19c885e8da84d36a330ff37b2612d3e0a8330aed2d263bcc5c1229b96ea99`.
- Web candidate: `sha256:7ec9ff5ede4ada64a7fe3dc71c6515dd9eed6788a2d5f4bb14457980ee05b35d`.
- Fresh disposable Docker volume, default UID 10001, network disabled: first process reserved 3 from the initial 20; second process preserved that account grant despite new configured gift 99, refused cross-account settlement, settled once, refused repeat settlement, and ended at 17 available / 0 held. Volume was removed after the check.
- Actual packaged Web ran with fake credentials in a separate network-disabled container: home and account discovery returned 200; unauthenticated shared chat and model-test both returned 401. No mail/model call was possible. Temporary container was removed.
- Running production container IDs/images/health and registry checksum were identical before and after preparation. Active corpus remained `agd-d7f2135c7eb0-26ae8d6dbac3`; no Compose up, tag replacement, timer change or registry promotion occurred.
- Staged `account-trial.env` is mode 0600 inside the mode 0700 release directory. A fresh signing secret was generated only on the server. Account/shared toggles remain false. Supabase URL/publishable key, invited email list and server model key remain blank. SMTP Key belongs in Supabase, not this env file.

Read-only deployment review found that the next real rollout must use the new base Compose, keep legacy `/data` RW for global budget, preserve both archive mounts, and atomically synchronize `state/settings.json.knowledgeImage` under `refresh.lock`. Rollback must disable shared mode before returning to the old anonymous-capable Web. These requirements are included in the setup guide. Candidate images are ready; live accounts, DNS/SMTP and activation are not complete. Evidence is in the server release's `preparation.json` and local `artifacts/deploy/account-trial-7193f3e/`.


## Hosted activation (2026-11-06)

Supabase/Resend were configured through the user's logged-in Chrome sessions. Only the `auth.sorayama.moe` DKIM TXT and two generated sending CNAME records were added in Namecheap; the website A record and existing root SPF/mail forwarding were read back unchanged. Resend domain is Verified, TLS is enforced, tracking/receiving are not enabled, and its dedicated key is sending-only and scoped to the one domain. SMTP is stored in Supabase, not the application env. Both Confirm sign up and Magic Link / OTP templates contain the six-digit `{{ .Token }}`; first-registration and returning-login templates were reloaded to verify persistence. Provider settings are six digits, 600-second expiry, 60-second resend interval, and 10 auth emails/hour.

A disposable candidate Web container called the actual `/api/auth/send-code` route once with the configured invite email. The response was 200 / ok; the container was removed. The resulting message arrived in the intended Gmail INBOX with SPF/DKIM pass, correct sender and subject. Gmail intentionally withholds one-time authentication codes; the user completes authentication directly on the live website. No OTP, provider key or session token was written into artifacts or chat.

A dedicated DeepSeek server key was created and transferred directly to the mode-0600 staged env. A first SSH transfer timed out; a separate read confirmed no key was written, then the retry succeeded. Official `/user/balance` and `/models` checks returned available=true and confirmed `deepseek-flash`. No recharge or subscription purchase occurred.

The reviewed release/rollback artifacts were uploaded with verified hashes; `release.py --execute --shared` completed. The release atomically swapped a verified source archive into `/opt/void-terminal/app`, preserving the original complete app directory including Git metadata and configuration in the release backup. The new deployment is explicitly an archive with a provenance marker. New base Compose and merged protected env persist for future controller operations. The script held `refresh.lock`, updated `settings.knowledgeImage`, preserved `/data` RW and the catalog read-only mounts, and restored the timer. Both production images match the candidates above and are healthy. Public items, characters and a legacy pinned citation matched pre-release responses; Caddy, registry, controller and original DB file identity were unchanged. Anonymous shared model tests return 401 LOGIN_REQUIRED.

Live anonymous browser acceptance passed at 1440×900 and 390×844: homepage title renders normally, the account entry opens the email form, page/dialog have no horizontal overflow, and there are no page/console errors, failed requests or alert messages. Four `production-*.png` screenshots and `production-ui-metrics.json` are in `artifacts/account-trial/`. The isolated browser made no non-read-only API requests and was closed.

The user completed the real browser OTP login. The account initially showed 20 available / 0 held / 20 total granted and no usage. One standard shared query about Nahida completed using `deepseek-flash`: the UI showed 13,163 tokens and one completed 1-credit usage record. Final balance was 19 available / 0 held / 20 granted. After a full page reload, authentication and the same balance/usage remained; the saved conversation reopened and citation [21] loaded its original text and upstream pinned source link without errors. This establishes actual login, model generation, settlement, history persistence and no repeated grant on summary refresh. Logout followed by another OTP login was not repeated live; those paths remain covered by automated tests. The account was left logged in with its completed answer visible. Evidence is in `artifacts/account-trial/production-{login-before,answer,live-reservation,after-reload,citation}.json` and the release `live-acceptance.json`.


Independent production ledger readback also passed: one account, one completed standard request, 1 credit, 13,163 tokens; 19 available / 0 held / 20 granted. The dedicated `void-terminal_accounts` local volume is mounted RW at `/accounts`, separate from corpus mounts. Process and ledger ownership are UID/GID 10001, directory 0755 / database 0644; WAL and uniqueness constraints are present, with no duplicate request or foreign-key anomalies. The first readback SSH attempt timed out and the bounded retry succeeded; no service restart or ledger writes were used. Evidence: `artifacts/account-trial/production-ledger-check.json`.
