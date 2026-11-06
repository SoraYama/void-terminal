# Hosted Free Credits, Device Risk and Sponsorship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver daily-first free credits, durable anti-abuse controls and hosted-only account/support UI, including a configurable BSC donation address.

**Architecture:** Extend the independent SQLite account ledger with expiring daily buckets and persistent device/rate state; trusted Web server constructs risk context, never the browser. Render optional sponsorship configuration server-side in hosted mode, with no payment-to-credit connection. Preserve default self-hosted BYOK and existing corpus architecture.

**Tech Stack:** Python/FastAPI/SQLite, Next.js 16 App Router, React, TypeScript, existing Supabase email OTP, Vitest and Playwright.

**Spec:** docs/superpowers/specs/2026-11-06-hosted-free-credits-sponsorship-design.md (approved); current user additionally requests actual sponsorship integration and a BSC-chain address entry.

## Global Constraints

- Hosted AI requests require verified email login. Self-hosted is the default and has no account, credits, device collection, sponsorship or contact-to-request-credits dependency/UI.
- Daily allowance is 3, resets at Asia/Shanghai midnight and never accumulates. New-user grant is 20, retained until spent; eligible new users start at 23.
- Spend daily then permanent credits. Standard costs 1, deep 3; split reservations across buckets; release only to original buckets and never revive yesterday's expired daily balance.
- Sponsorship never grants credits. Manual gifts are permanent, idempotent and separate from risk exemption.
- Preserve existing available entitlement, held reservations, grants and payment history on migration. Never replay the welcome gift for legacy accounts.
- Device cookie is first-party, server issued and authenticated. Fingerprint resemblance/IP alone cannot hard-ban people. Enforce grant uniqueness and persistent rate checks on the server, including bypass/direct API cases.
- Preserve all original worktree Stripe drafts. This worktree starts at f08710f and must not enable Stripe/Paddle/checkout.
- BSC entry uses only an owner-provided public address and configured supported asset labels; mainnet chain 56. No fabricated address, private key, signing, wallet connection, payment webhook or credit entitlement.
- Announce missing external configuration truthfully. Channels without valid configuration are hidden. Do not publish the user's previously supplied private trial email as the support contact without permission.
- Follow apps/web/AGENTS.md and read matching installed Next docs before editing Web routes/components. Keep current design tokens and bilingual/dark/mobile behavior.

## Review Focus

- A valid Supabase login obtained outside our forms must not bypass device/challenge eligibility or auto-grant through summary/reserve.
- Midnight failure/release of a split daily/permanent hold must not increase the new day's allowance or lose permanent credits.
- Shared devices, privacy browsers, cookie resets and IP spoofing require meaningful handling without an automatic unlimited-credits fallback.
- Migration with pending reservations must preserve both usable credits and later release/settlement exactly once.
- Invalid/missing sponsorship config, clipboard failure, long addresses and mobile layouts must not create a misleading or unusable donation route.

---

### Task 1: Durable free-credit ledger and risk storage

**Files:** Modify services/knowledge/knowledge/account_schema.py, account_store.py, account_routes.py, account_admin.py, account_backup.py and related Python tests. Create focused account_credit_buckets.py/account_risk.py helpers if needed; retain one transaction domain. Update budget implementation only if needed for monthly token limits, without corpus changes.

**Interfaces:**
- AccountStore.summary(account_id, *, risk_context=None) and reserve(account_id, request_id, depth, model, *, risk_context=None) accept a trusted internal risk context. No context means no new free grants, never legacy unrestricted auto-enrollment. Existing permanent balance can be reported, but public request admission must be checked by Task 2.
- Risk context JSON: {deviceHash: 64-lowercase-hex, fingerprintHash?: 64-lowercase-hex, networkHash?: 64-lowercase-hex, verified: boolean}. All hashes and verified status are constructed by trusted Web code; never exposed as public metadata. Invalid input rejected.
- Summary preserves credits.available/held/totalGranted and costs; adds credits.daily {available,held,limit:3,resetsAt}, credits.reserve {available,held}, and eligibility {status:'ready'|'verification_required'|'device_limit', reason?: string}. Public grants/usage remain compatible; daily history may be separate from permanent grants.
- POST /v1/accounts/summary and /reserve accept optional riskContext and retain authentication dependency. Missing context cannot allocate new grants. /settle remains compatible.
- POST /v1/accounts/risk/check accepts {action:'send'|'verify'|'request',deviceHash,networkHash?,emailHash?,fingerprintHash?,verified?:boolean}; returns {allowed:boolean,challengeRequired:boolean,retryAfter:number}. Use atomic persistent counters. Actions require valid hashes and internal API authentication. Soft challenge without verified proof does not consume an admitted send cooldown; a same-second verified retry may proceed, then normal cooldown applies. Hard limits apply even with verified proof.
- New-account entitlement: stable device welcome claim once per 180 days; account welcome once for lifetime. Device/day automatic daily grant unique, account/day unique; manual exemption can authorize shared device accounts and is audited separately from manual gifts.
- Operator CLI adds an auditable exemption command with stable reference and reason; existing grant/backup/verify/restore work with new schema. Purge risk events at 30 days and device claim data at 180 days without deleting lifetime account grant history.

- [ ] Write failing tests for first-day 23, daily-first spend, mixed 1 daily + 2 permanent deep spend, no accumulation, repeated read/login, no-context no gift, device duplicate welcome/daily, exception authorization, risk counters surviving reopen, cleanup and malformed context.
- [ ] Run focused tests and capture meaningful RED evidence.
- [ ] Implement explicit migration from baseline schema, allocation-aware reservation/settlement and risk storage in transactions. Legacy remaining credits become permanent history reserve; preserve held allocation and late-release semantics. Unknown schemas fail closed; update backup verification.
- [ ] Add tests for midnight release/completion, concurrent stores/grants, duplicate settlement, legacy migration with held rows and replayed manual gifts; cover model budget monthly rollover if changed.
- [ ] Run focused tests then Python full suite with .venv/bin/python -m pytest tests -q (covers both pytest functions and unittest classes). Fix only task-related regressions and report all other failures.
- [ ] Self-review, commit only owned files and record exact interface decisions/test evidence in task report.

### Task 2: Trusted Web risk context, auth and API integration

**Files:** apps/web/src/lib/server/account-auth.ts, account-budget.ts, account-contracts.ts, new account-risk.ts, client device-risk.ts; api/account, api/auth and api/chat routes; /api/models/test if it can incur model costs; new /api/account/verify-device route; relevant tests. Own use-account.ts changes needed for device verification; Task 3 consumes its stable contract.

**Interfaces:** Consume Task 1 summary/risk/check contracts. Add public risk verification state to AccountSummary; retain backward-safe optional bucket fields for old response fixtures. Server uses ACCOUNT_RISK_SECRET (>=32 bytes) to authenticate 180-day first-party __Host-void-device cookie and HMAC feature/network/email signals; signed short-lived eligibility proof is bound to device and account where applicable. Generate secure random identifiers server-side, never deterministic public hashes.
- Browser device helper returns only bounded/coarsened browser/system family, locale, timezone and screen size class; hosted auth/risk request bodies carry those signals. Never treat client verified/deviceHash as authoritative.
- /api/account exposes device verification requirement and optional public challenge site key; /api/account/verify-device validates challenge and returns refreshed account summary/proof cookies. For new/unknown devices, require verified challenge before automatic gifts. Existing trusted proof may be reused until its explicit expiry, not each question.
- Turnstile server validation: secret server-only, hostname/action checked, short-lived single-use tokens, bounded timeout and replay-safe failure handling. Auth send/verify performs persistent rate checks; a legitimate direct Supabase session can only become credit-eligible through this same flow.
- Canonical network identity only from TRUST_PROXY-enabled sanitized headers. No real client IP available must not make every visitor share a single hard-limit bucket.
- Self-hosted returns disabled for risk endpoints and does not mint device cookies, contact Supabase/risk service or perform collection.

- [ ] Write failing tests for absent/forged/expired proof, supplied client verified flag, direct identity-session bypass, trusted/untrusted proxy headers, persistent limit rejection, challenge failures and retry cookies.
- [ ] Run focused tests and record RED evidence.
- [ ] Implement shared risk helper and wire account/auth/chat routes to server-derived context; ensure all model-bearing hosted routes require login and budget. Preserve HttpOnly session properties, same-origin validation and public errors with retry metadata.
- [ ] Add use-account challenge completion API and bounded collection helper, with no fingerprint collection in self-hosted or ordinary archive browsing. Supabase SDK usage remains existing version; consult official auth docs as needed.
- [ ] Run Web full unit suite and typecheck; exercise route tests against real risk helper (mock only network boundaries), including self-hosted no-cookie/no-contact assertions.
- [ ] Self-review, commit owned files and report final exact API/Controller interface to Task 3.

### Task 3: Account UI, real configurable sponsorship and BSC entry

**Files:** apps/web/src/components/account-panel.tsx, terminal.tsx, new support-panel.tsx and account-risk-challenge.tsx; app/globals.css; lib/server/support-config.ts and public support-contracts.ts; page wrappers passing hosted-only config; settings-panel.tsx/chat-errors.ts/i18n as needed; config env/compose docs; account/deployment/support unit and e2e tests.

**Interfaces:** Consume Task 2 AccountController and Task 1 bucket/eligibility summaries. Public SupportConfig has contactEmail?:string, channels array of validated outbound/QR methods, bsc?:{address:string,assets:('BNB'|'USDT')[],chainId:56}; only serialize configured values in hosted mode.
- Env names: SUPPORT_CONTACT_EMAIL, SUPPORT_WECHAT_QR_URL, SUPPORT_ALIPAY_QR_URL, SUPPORT_AFDIAN_URL, SUPPORT_KOFI_URL, SUPPORT_BSC_ADDRESS, SUPPORT_BSC_ASSETS. QR paths must be validated same-site static resources; external link hosts allowlisted for their provider. Reject malformed/zero BSC addresses; preserve complete configured address. Optional mixed-case checksum validation may use an already-present trustworthy implementation, otherwise do not claim checksum verification.
- Runtime config only, no real contact/wallet identifiers hardcoded into open source. Invalid channel configuration is hidden with server-side diagnostic; never fail unrelated core browsing or expose secrets.
- BSC panel explicitly labels BNB Smart Chain (BSC/BEP-20), mainnet chain 56 and accepted assets, shows full address, copy feedback/fallback and a verified bscscan.com/address/<address> link. Warn succinctly to use BSC when transferring; do not fabricate token contracts or automatically initiate payments.

- [x] Read current Impeccable context and relevant Next local docs; preserve tokens/layout. Write meaningful tests for daily/reserve display, grant pending, reset time, exhausted draft retention, configured/unconfigured support channels, invalid URLs/address, clipboard rejection and self-hosted absence.
- [x] Run focused failures before implementing behavior.
- [x] Update account UI to daily/reserve hierarchy, compact usage details, email request template/copy fallback, sponsor secondary entry. Keep login-draft isolation and current compact conversation controls; 44px coarse-pointer targets.
- [x] Build actual support panel with domestic QR/outbound methods, overseas outbound support and BSC copy/explorer entry; no paid tiers, automatic grants or fake configured states. Add confirmed owner configuration/assets only when supplied, preserving secret/public boundaries.
- [x] Integrate device challenge UI using Task 2 controller.verifyDevice(token), account.risk.status and action account_device. Anonymous users verify before OTP; authenticated expired proof opens verification before send. Treat server proof/eligibility rejection as admission failure: preserve unsent/edit/regenerate draft and branch instead of saving a fake failed answer. Show retry/appeal states; refresh on visibility/reset without trusting client clock for admission.
- [x] Run Web unit/typecheck/build and focused real-browser hosted desktop/mobile plus self-hosted cases; capture screenshots and visually inspect daily/reserve, verification, exhausted and support/BSC states. Mocked recipient is labelled fixture-only in test artifacts, never published config.
- [x] Update PRODUCT.md, README/.env.example/compose and operational guide with real variable names, schema v3 migration, risk retention, sponsor prerequisites and disabled payment status. Pass ACCOUNT_RISK_SECRET, TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY only to Web; account risk threshold config to knowledge as applicable. Pass SHARED_MONTHLY_TOKEN_BUDGET to knowledge: explicit 0 denies generation, absent direct-service setting derives 31*daily; account points reset UTC+8 while public token budgets retain existing UTC calendar. Require a positive configured monthly cap for hosted Compose deployment and document it. Self-review and commit.

### Task 4: Integration, operational readiness and final verification

**Files:** only integration fixes/tests/config/docs justified by prior tasks; docs/agent feature note + INDEX.md; local artifacts.

- [ ] Run final complete Python and Web suites, typecheck/build; perform migration/backup/restore rehearsal on synthetic legacy accounts including held reservations.
- [ ] Run focused browser matrix and inspect actual screenshots; verify route-level API calls cannot bypass risk or cross modes. Verify same-device collisions show useful UI and manual exemption remains distinct from gift.
- [ ] Configure owner-provided sponsor contact/links/BSC address in an appropriate ignored runtime config; validate exact address readback and network label. Do not publish placeholders, invent private data, send money or contact others.
- [ ] Assess deployment requirements: ledger schema backup/migration, risk secret, challenge credentials, trusted proxy, day/month budgets. Complete authorized reversible setup; missing external credentials/recipient info remain explicit, never silently bypassed.
- [ ] Independent whole-branch security/spec review, fix material findings, record validations and remaining external readiness separately. No unsupported claim of production deployment.
- [ ] Update docs/agent/feature/2026-11-06-hosted-free.md and INDEX.md. Final user report states code changes, tests, sponsorship setup and any genuine blocked external step.
