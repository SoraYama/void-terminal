> **Date / Revised**: 2026-11-07

# Hosted sponsorship and Turnstile activation preparation

Current status: deployed on 2026-11-07; public Alipay/BSC bytes and the configured UI were verified. The operator completed real device verification; the browser showed 3 daily credits and preserved reserve. This page preserves preparation evidence; see the [production release receipt](../misc/2026-11-07-hosted-release.md).

## Background

The operator supplied a public BSC recipient, chose USDT/USDC/BNB, authorized a public contact mailbox, selected Alipay and provided an authenticated Cloudflare browser session. This continues the reviewed free-credit feature; it does not deploy the new ledger or enable paid checkout.

## Implementation and validation

- Commit `19d22dd` extends the shared finite BSC asset list/type to include USDC. The parser preserves address case and configured label order, removes duplicates and continues rejecting unsupported labels. It does not assert native issuance, token contract identity or bridging guarantees.
- Meaningful RED: the new three-asset case hid BSC under the old parser. GREEN: support-config tests 16/16, typecheck and production build passed. Hosted desktop and 375 px BSC browser cases passed 2/2; scoped independent review found no defects. The previously reviewed feature suites are not claimed as rerun for this narrow addition.
- Actual operator configuration is in an ignored mode 0600 `.env.hosted-activation.local`, not in source defaults or test fixtures. Local production-build UI displayed the full recipient, BSC mainnet 56 and all three labels. Native Chrome copy/paste matched the complete approved address. The browser-session clipboard API was empty, so the actual OS-backed paste was checked separately. No transfer was made.
- Cloudflare now has a dedicated Managed widget restricted to the exact official hostname, with pre-clearance disabled. Its site/secret pair and a distinct stable random risk HMAC secret were captured without displaying secrets. A one-time localhost receiver wrote the private file and closed; desktop Terminal control was blocked by the computer-use tool, so no Terminal automation was used.
- The protected activation overlay is staged at `/opt/void-terminal/releases/hosted-free-credits-19d22dd/activation.env`, directory 0700 / file 0600. Remote bytes matched the local hash. An initial SSH timeout was followed by an explicit absent-file readback; retry through the existing local SOCKS route succeeded. The live `/opt/void-terminal/app/.env` was not changed.
- The active daily token cap was 2000000 with no monthly setting. The staged monthly cap 62000000 preserves the finite 31-day upper bound implied by that existing daily cap. This is a token budget, not a currency-bill guarantee; no generation was triggered.

## Alipay QR continuation

- The operator supplied the original 742 × 738 PNG. Local QR detection returned one HTTPS destination on `qr.alipay.com`; no payment URL was opened and no transfer was initiated. The first detector attempt could not access macOS Vision under the sandbox; a permitted local detector run succeeded. The rendered mobile screenshot decoded to the same payload.
- The original bytes are preserved as `alipay-33895f3bec51.png` (SHA-256 `33895f3bec513c40929618de00e9996b54f934ea2a6c1b15a7af1c80fdb16880`). Operator assets and environment remain ignored, outside tracked defaults and fixtures. A temporary public copy was used for local acceptance and removed afterwards; the retained operator copy is under `artifacts/hosted-free-credits/alipay/operator-support/`.
- A production-build preview passed independent Chromium checks at 375 px and 1280 px: expand Alipay, load the original image, show same-phone instructions, download an exact-byte copy, and avoid horizontal dialog overflow. Both screenshots were visually inspected. The user’s Chrome connection timed out, so this does not claim acceptance in that logged-in browser, physical iPhone or the Alipay app.
- The original PNG and `compose.support.yaml` are staged in the existing protected release directory. The override mounts its `support` directory read-only at `/app/apps/web/public/support`; directory 0755 / asset 0644 permit the container user to read the mount. The active deployment has not applied the mount.
- Automatic approval rejected retransferring the full secret-bearing activation overlay. The successful narrower operation transferred only the public QR, public path and mount configuration. It changed only `SUPPORT_ALIPAY_QR_URL` in the remote staged file, verified expected before/after hashes, retained an on-server prior version, and transferred no secrets. Staged file remains 0600; live `.env` hash was unchanged.
- New evidence: `artifacts/hosted-free-credits/alipay/receipt.json`, `ui-verification.json`, `server-stage.json`, `mobile.png` and `desktop.png`. This was an asset/configuration follow-up, with no application-code change or claim that full feature suites were rerun.

## BSC address QR continuation

- Added a hosted-only `/api/support/bsc-qr?address=...` PNG route using pinned `qrcode` 1.5.4 on the server. It encodes the exact runtime-configured address, preserving case. It accepts no arbitrary recipient: missing/mismatched/stale address, missing/invalid BSC configuration and self-hosted mode are denied. All responses are uncached; invalid deployment mode fails closed.
- The existing BSC section now offers an expandable QR and PNG download from the same endpoint. Chinese/English copy explains manual BSC network and asset selection, plus same-phone save-and-scan. Load failure leaves the complete text address and copy action available. QR generation uses no third-party service and adds no operator address to source defaults; no additional production QR mount is needed.
- The plain-address format supports the configured multiple assets without pretending to specify a particular payment. ERC-681 transaction URLs have distinct native-token versus token-contract semantics; see [the standard](https://eips.ethereum.org/EIPS/eip-681). This feature intentionally does not create transaction requests, connect wallets or promise a scanner selects the network.
- Browser RED confirmed the previous build lacked the QR disclosure. GREEN: focused route/config tests 24 passed; complete Web suite 478 passed; typecheck and production build passed. The first full test attempt hit sandbox loopback `listen EPERM`; it was stopped, diagnosed on the existing runtime tests and rerun successfully with local-listener permission. No product change was made to accommodate that environment restriction.
- Browser regression 6/6 covers desktop/mobile display/download, image failure with copy fallback and existing BSC copy/network labels. Actual operator-address checks passed on 375 px light mobile and 1280 px dark desktop; saved PNG bytes equal the endpoint image. Both captures were visually inspected. Independent macOS Vision decoding of the actual PNG and both screenshots returned exactly the approved address. This is decoding evidence, not an executed wallet transfer.
- Scoped independent code review approved with no actionable findings; its pending decode-evidence limitation is now closed. Evidence and standalone image: `artifacts/hosted-free-credits/bsc-qr/receipt.json`, `ui-verification.json`, `web-tests.log`, `bsc-receiving-address.png`, `mobile.png` and `desktop.png`. Production remains unchanged.

## Remaining activation work

Owner-provided Alipay, BSC and contact configuration is now prepared and verified locally and in server staging. Ko-fi remains unconfigured by choice. The branch still needs merge/release, protected account-ledger migration and real Turnstile/email/chat acceptance. Existing enrollment policy is unchanged. Successful widget creation and configuration staging do not establish real user challenge completion, sponsor receipt or production rollout.

Local evidence is under `artifacts/hosted-free-credits/`: `activation-stage.json`, `cloudflare-turnstile.jpg` and `sponsorship-configured.jpg`. The local preview had account/model calls disabled, so it establishes sponsor display/copy only, not live login.
