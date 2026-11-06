> **Date / Revised**: 2026-11-07

# Hosted sponsorship and Turnstile activation preparation

## Background

The operator supplied a public BSC recipient, chose USDT/USDC/BNB, authorized a public contact mailbox, selected Alipay and provided an authenticated Cloudflare browser session. This continues the reviewed free-credit feature; it does not deploy the new ledger or enable paid checkout.

## Implementation and validation

- Commit `19d22dd` extends the shared finite BSC asset list/type to include USDC. The parser preserves address case and configured label order, removes duplicates and continues rejecting unsupported labels. It does not assert native issuance, token contract identity or bridging guarantees.
- Meaningful RED: the new three-asset case hid BSC under the old parser. GREEN: support-config tests 16/16, typecheck and production build passed. Hosted desktop and 375 px BSC browser cases passed 2/2; scoped independent review found no defects. The previously reviewed feature suites are not claimed as rerun for this narrow addition.
- Actual operator configuration is in an ignored mode 0600 `.env.hosted-activation.local`, not in source defaults or test fixtures. Local production-build UI displayed the full recipient, BSC mainnet 56 and all three labels. Native Chrome copy/paste matched the complete approved address. The browser-session clipboard API was empty, so the actual OS-backed paste was checked separately. No transfer was made.
- Cloudflare now has a dedicated Managed widget restricted to the exact official hostname, with pre-clearance disabled. Its site/secret pair and a distinct stable random risk HMAC secret were captured without displaying secrets. A one-time localhost receiver wrote the private file and closed; desktop Terminal control was blocked by the computer-use tool, so no Terminal automation was used.
- The protected activation overlay is staged at `/opt/void-terminal/releases/hosted-free-credits-19d22dd/activation.env`, directory 0700 / file 0600. Remote bytes matched the local hash. An initial SSH timeout was followed by an explicit absent-file readback; retry through the existing local SOCKS route succeeded. The live `/opt/void-terminal/app/.env` was not changed.
- The active daily token cap was 2000000 with no monthly setting. The staged monthly cap 62000000 preserves the finite 31-day upper bound implied by that existing daily cap. This is a token budget, not a currency-bill guarantee; no generation was triggered.

## Remaining activation work

Alipay is hidden until an actual operator-approved QR image is supplied and checked. Ko-fi remains unconfigured by choice. The branch still needs merge/release, protected account-ledger migration and real Turnstile/email/chat acceptance. Existing enrollment policy is unchanged. Successful widget creation and configuration staging do not establish real user challenge completion, sponsor receipt or production rollout.

Local evidence is under `artifacts/hosted-free-credits/`: `activation-stage.json`, `cloudflare-turnstile.jpg` and `sponsorship-configured.jpg`. The local preview had account/model calls disabled, so it establishes sponsor display/copy only, not live login.
