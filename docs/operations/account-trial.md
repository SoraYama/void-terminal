# Email-code login and trial credits

This release adds an opt-in invitation trial, without checkout, subscriptions or cash balances. Existing BYOK remains available. Operator-owned model calls require a verified email account; the former anonymous shared mode is removed.

For the first hosted setup, follow the [Supabase + Resend onboarding guide](account-trial-onboarding.md).

## Enable after local acceptance

1. Create a Supabase project and configure email authentication with a production SMTP sender. In the **Magic Link** email template, include `{{ .Token }}` as the code instead of requiring the user to follow a link. Keep the email OTP length at six digits (matching this UI) and set an appropriate short OTP expiry and provider email/verification rate limits. The site uses the official Supabase server SDK; no browser auth SDK or token storage is used.
2. Configure web server `SUPABASE_URL` (HTTPS project origin), `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`, never secret/service-role), `PUBLIC_APP_ORIGIN` (exact public HTTPS origin), and `TRIAL_ALLOWED_EMAILS` (comma-separated invited emails). Use `*` only when intentionally opening public trials. Allowlisting is rechecked on every server session verification, including existing sessions.
3. Set `ACCOUNT_TRIAL_ENABLED=true` for web AND knowledge. Set `ACCOUNT_TRIAL_CREDITS=20` on knowledge (new-account grant only). Set `SHARED_MODE_ENABLED=true`, `DEEPSEEK_API_KEY`, a random `SESSION_SECRET` of at least 32 characters, and `KNOWLEDGE_API_TOKEN`. Keep the operator key and internal token server-side. Set a finite `SHARED_DAILY_TOKEN_BUDGET`; zero denies shared generation. This cap reserves worst-case tokens for up to five model calls, so very small limits may reject all questions.
4. Compose stores the ledger in the independent named `accounts` volume at `/accounts/accounts.sqlite`, regardless of corpus backend. For local knowledge processes, explicitly set `ACCOUNT_DATABASE_PATH` to an absolute, writable file outside all corpus/snapshot directories. Do not copy this ledger into immutable corpus archives. This first version requires one knowledge instance and a local filesystem, not replicas with separate ledgers or NFS.
5. Deploy web and knowledge together, then verify: invited login mail, invalid/expired code, logout, repeated login (no new grant), one standard/deep query, cancellation, exhausted credits and account isolation. This requires real SMTP/Supabase credentials and authorized model calls; automated fixtures cannot establish email delivery or real provider acceptance.

Official setup references: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [server client and session verification](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Credit semantics

- Standard research consumes 1 credit; deep research consumes 3. A new account gets the configured gift once. Credits have no cash value and there is no payment flow.
- Admission atomically reserves credits and allows one active request per account. Request IDs are never replayed, including after failure. A fresh explicit retry must use a new UUID.
- Successful model answers consume the hold. Failed, cancelled and no-evidence runs release it. Account settlement retries once independently of browser cancellation. If the process or ledger is unavailable, holds expire after 10 minutes and are released on the next ledger operation; the agent has a 180-second deadline.
- Operator global token budget is separate: unknown provider usage conservatively retains its reservation. User trial credits are fixed units, not a monetary estimate or token invoice. A failed request can still incur operator model cost.
- Usage history keeps the latest 20 request metadata records visible: request ID, timestamp, depth, model, units, status and aggregate provider tokens when known. It does not store prompts, answers, email addresses or provider keys. Aggregate tokens cannot be used as an exact invoice because provider caching and pricing categories differ.

## Privacy and operation

Supabase processes login email and authentication data. The application verifies each session server-side and uses HttpOnly, same-site cookies. The application and configured model provider process questions and evidence needed to answer. Do not claim that the server cannot read user questions. The browser stores chat history per account on that device; this is UI isolation, not encryption against someone with browser-profile access. Clearing site storage deletes local chats. Login does not sync history between devices.

Back up the separate account ledger with SQLite's online backup API (or stop the service before copying the DB with its WAL files). Restore only with the service stopped. Do not reset balances by deleting the volume, and do not run `docker compose down -v` as routine deployment. Keep the original volume on rollback. Disabling the feature denies shared access but preserves credits and history metadata. Existing BYOK remains usable.

Auth endpoint in-memory limits protect a single web instance; Supabase provider limits remain necessary. Public signup also needs abuse controls and a measured operating budget before opening `TRIAL_ALLOWED_EMAILS=*`. Real payment integration will require a separate immutable payment ledger, verified idempotent webhooks, refunds and product terms; none are implemented here.
