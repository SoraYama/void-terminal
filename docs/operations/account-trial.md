# Hosted email login, device verification and free credits

The official site runs with `DEPLOYMENT_MODE=hosted`: email-code login and account credits are its only model-access path. It has no BYOK settings, custom provider/model controls or mode switch. Operator-owned model calls require a verified email account and current device proof. Missing authentication, model or budget configuration denies generation; it never falls back to BYOK. Credit purchases, checkout, subscriptions and cash balances are disabled. Optional sponsorship is independent of credits.

The same open-source codebase and Web image default to `DEPLOYMENT_MODE=self-hosted`, which uses browser-supplied model keys without account UI or any Supabase/SMTP dependency. Self-hosted ignores the server model key and account/shared flags. The variable is read at runtime: only an absent variable defaults to `self-hosted`; an empty or unknown value is a configuration error and fails closed. Recreate the Web container after changing it; a separate mode-specific image build is unnecessary.

For the first hosted setup, follow the [Supabase + Resend onboarding guide](account-trial-onboarding.md) for provider setup, together with the current runtime configuration below. That guide also records the earlier onboarding acceptance; it is not proof that a new deployment is configured or healthy.

## Enable after local acceptance

1. Create a Supabase project and configure email authentication with a production SMTP sender. In both the **Confirm sign up** and **Magic Link / OTP** email templates, include `{{ .Token }}` as the code instead of requiring the user to follow a link. Keep the email OTP length at six digits (matching this UI) and set an appropriate short OTP expiry and provider email/verification rate limits. The site uses the official Supabase server SDK; no browser auth SDK or token storage is used.
2. Set `DEPLOYMENT_MODE=hosted` on Web. Configure `SUPABASE_URL` (HTTPS project origin), `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`, never secret/service-role), `PUBLIC_APP_ORIGIN` (exact public HTTPS origin), and `TRIAL_ALLOWED_EMAILS` (comma-separated invited emails). Use `*` only when intentionally opening public trials. Allowlisting is rechecked on every server session verification, including existing sessions. Local `npm dev` also requires an explicit browser origin, such as `http://127.0.0.1:3000`; a production Docker container requires HTTPS.
3. Set `ACCOUNT_TRIAL_ENABLED=true` on Web and knowledge, `ACCOUNT_TRIAL_CREDITS=20` on knowledge, and `SHARED_MODE_ENABLED=true` on Web. Set `DEEPSEEK_API_KEY`, a random `SESSION_SECRET` of at least 32 characters, and `KNOWLEDGE_API_TOKEN`. Keep credentials server-side. Set finite positive `SHARED_DAILY_TOKEN_BUDGET` and `SHARED_MONTHLY_TOKEN_BUDGET` on knowledge. Hosted Compose refuses to start knowledge without an explicit positive monthly cap. With a direct knowledge service, an unset monthly cap derives `31 × daily`; an explicit zero for either cap denies generation. Both token windows use UTC boundaries, independently of the user allowance at Shanghai midnight. Limits reserve worst-case tokens for up to five model calls, so very small caps can reject all questions.
4. Configure a managed [Cloudflare Turnstile widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) for the exact public hostname. Set `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and a stable random `ACCOUNT_RISK_SECRET` of at least 32 bytes on Web only. Use a separate risk secret from `SESSION_SECRET`. The site key is public; the challenge secret, risk secret and provider token stay server-side. The application validates the challenge token, hostname and `account_device` action server-side. Supabase must not attempt to redeem the same challenge token. If an upstream policy blocks the widget script or iframe, review Cloudflare's [CSP instructions](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
5. Compose stores the ledger in the independent named `accounts` volume at `/accounts/accounts.sqlite`. For local knowledge processes, set `ACCOUNT_DATABASE_PATH` to an absolute writable file outside corpus and snapshot directories. Use one knowledge instance and a local filesystem. If the site is entirely behind a controlled proxy, set `TRUST_PROXY=true` and overwrite client-supplied `X-Forwarded-For` with a single validated client address at the edge. The site omits the network signal if the header is absent or ambiguous.
6. Deploy Web and knowledge together, then verify `/api/status.deployment.mode`, the actual device challenge, email delivery, login, balance, one standard/deep query, cancellation and account isolation. Repeat on mobile and an eligible new device. Check the device-limit appeal path and all configured sponsor channels separately. Hosted chat/model-test routes must reject BYOK. Automated fixtures cannot establish email delivery, real challenge acceptance, model billing or sponsorship receipt.

Both Compose files pass these variables at runtime and mount the same independent ledger path. SQLite and PostgreSQL are choices for the corpus; neither changes the ledger backend or removes the single-knowledge-instance constraint. SMTP credentials are configured in Supabase's auth sender settings, not as browser variables or model-provider credentials.

Official setup references: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [server client and session verification](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Upgrade an existing hosted deployment

Before starting the new image, add **`DEPLOYMENT_MODE=hosted`** to the existing production environment. Do not overwrite `.env` with the example file: deployments without the explicit mode now default to self-hosted. Retain the existing authentication/model configuration, Compose project name, `accounts` volume and `/accounts/accounts.sqlite` path.

Record the previous commit/image and back up the account ledger separately from the corpus. This release upgrades recognized v0 and v2 ledgers to schema v3 when the knowledge service opens them. Stop all account writers and follow the [ledger migration and recovery procedure](credit-ledger.md) before starting that image; old binaries reject the v3 tables. Recreate Web with the runtime variable, verify mode and UI, then check the existing account balance and history metadata. Retain the original account volume and migration backup; a code rollback across this schema boundary requires a separately verified recovery decision, not an in-place database overwrite. Changing the deployment mode itself does not migrate or erase balances or browser histories. An invalid mode must fail closed, while a hosted dependency outage must stay hosted and report unavailable.

## Credit semantics

- Standard research consumes 1 point and deep research consumes 3. Eligible accounts receive 3 daily points at 00:00 Asia/Shanghai, with no carryover. Eligible new accounts receive a one-time reserve gift (20 by default). Daily points are used first; a hold may use both daily and reserve. An old day's daily allocation never comes back as points in the new day.
- Migration preserves existing available credits as reserve, existing holds and grants, and order/payment replay history. A legacy account does not receive another welcome gift. A manual gift to reserve uses the operator CLI and a stable UUID reference; retries of the same grant do not issue credits twice.
- Admission allows one active research request per account and reserves credits and site tokens before generation. Request IDs are never replayed. Successful research consumes the hold; failed, cancelled and no-evidence requests release their allocations. Abandoned holds expire after 10 minutes and are released on the next ledger operation. Account settlement retries once; the agent has a 180-second deadline.
- The site token budget is separate. Unknown provider usage conservatively retains its reservation. Credits are fixed research units, not money or a model-cost invoice. A failed request can still incur operator model cost.
- Usage displays the latest 20 research metadata records. It does not store prompts, answers, email addresses or provider keys. Aggregate provider tokens do not establish provider cost.

## Device controls and privacy

Supabase processes sign-in email and authentication data. The application verifies sessions server-side and uses secure, HttpOnly cookies. Device checks use a signed first-party random device identifier, plus HMACs of limited browser/system family, language, coarse timezone and screen category. If available from a trusted proxy, a HMAC of the network signal contributes to challenge decisions. Similar fingerprints or shared networks do not independently hard-block users. Cookies are not a guarantee of unique hardware.

The device cookie lasts up to 180 days; proof lasts 15 minutes before email login and 12 hours for a confirmed account. Keep the risk secret stable across deployments. Rotating it changes hashes and invalidates device/proof cookies; plan the rotation as a reset of device signals. The ledger prunes risk events after 30 days and device claims after 180 days. Pruning happens with account operations and is available with `python -m knowledge.account_admin purge-risk`; lifetime welcome grant history is retained. Account backups follow the operator's separate backup retention policy.

The knowledge service controls thresholds through the nine `ACCOUNT_RISK_{SEND,VERIFY,REQUEST}_{DEVICE,NETWORK,FINGERPRINT}_LIMIT` variables listed in [.env.example](../../.env.example). Defaults are suitable as a starting point; review traffic and support cases before changing them. `TRIAL_ALLOWED_EMAILS=*` explicitly opens public enrollment. Supabase authentication and provider limits remain necessary.

A shared device may already have used its automatic allowance on a different account. Existing reserve stays available after verification. Review appeals through the configured public contact. Use the operator CLI's `exempt` command with a stable reference and non-personal reason if a reviewed account should bypass the device-claim limit. It does not bypass device proof or request limits and is separate from a manual gift. See [ledger operations](credit-ledger.md).

The application and selected model provider process questions and evidence. The browser stores chat history per account on that device, separately from self-hosted guest history. An identity outage hides private state; login does not sync history between devices. This is UI isolation, not encryption against someone with access to the browser profile.

Use the [dedicated ledger CLI](credit-ledger.md) for backups and restore rehearsals. The corpus backup scripts omit the `accounts` volume. Stop account writers for migration or live recovery; retain the original volume. Do not use `docker compose down -v` as routine deployment.

## Optional sponsorship and contact

Only valid configured channels appear on the hosted site. Leave anything unverified empty. Recreate the Web container after changing runtime values. Keep operator configuration and QR images out of source control unless they are deliberately published.

| Web setting | Public value and acceptance |
| --- | --- |
| `SUPPORT_CONTACT_EMAIL` | Public mailbox for point requests and shared-device appeals. The reader opens an email draft or copies the address and template; the site never sends it. |
| `SUPPORT_WECHAT_QR_URL`, `SUPPORT_ALIPAY_QR_URL` | Same-site path under `/support/` pointing to an existing PNG, WebP or JPEG file. Verify QR contents, supported use, recipient, and the same-phone save-and-scan workflow. |
| `SUPPORT_AFDIAN_URL` | HTTPS Afdian creator link at `afdian.com/a/…` or `afdian.net/a/…`. Confirm the creator and actual receiving/withdrawal support. |
| `SUPPORT_KOFI_URL` | HTTPS Ko-fi creator link at `ko-fi.com/…`. Confirm the receiving account and withdrawal support in its region. |
| `SUPPORT_BSC_ADDRESS`, `SUPPORT_BSC_ASSETS` | Operator-provided public receiving address on BNB Smart Chain mainnet, chain ID 56, plus a comma-separated list from `BNB`, `USDT` and `USDC`. These are operator-selected labels. Verify the exact asset, network, receiving address and ownership out of band. The site checks address shape, not checksum or control. Never supply a private key or seed phrase. |

For a non-container setup, put the images under `apps/web/public/support/` before starting Web. For Docker, put only the public QR files in a read-only operator directory, then mount it via a local Compose override. For example:

```yaml
services:
  web:
    volumes:
      - type: bind
        source: /absolute/operator/qr-directory
        target: /app/apps/web/public/support
        read_only: true
        bind:
          create_host_path: false
```

Use `docker compose -f compose.yaml -f /path/to/local-support.override.yaml` (or replace the first file with `compose.sqlite.yaml`). Set the public QR paths to match the mounted filenames. Confirm each image returns 200 after the container is recreated and opens in its intended scanner. For BSC, compare the displayed and copied address and the BscScan destination against the operator-approved public address. The site has no wallet connection, payment listener, checkout, credit exchange or automatic gift for sponsorship. Missing contact hides email requests; missing sponsorship hides the sponsorship entry entirely.
