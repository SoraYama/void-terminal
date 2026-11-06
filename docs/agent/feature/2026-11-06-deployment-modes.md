# Runtime deployment modes and compact conversation controls

## Request and decisions

The user requested smaller controls below a conversation and two supported product paths: open-source self-hosting with a personal model key, and the official site with login and credit consumption. They explicitly selected **official site login/credits only**, with no BYOK entry.

One repository and one runtime image now support `DEPLOYMENT_MODE=self-hosted|hosted`. Only an absent variable defaults to self-hosted; empty/invalid values fail closed. No payment implementation or account-ledger migration is included.

## Implementation

- Dynamic `/`, `/museum` and `/characters` wrappers pass the server mode to Terminal. Mode is independent of knowledge readiness and saved browser preferences. Both Compose manifests pass it at runtime.
- Chat and model-test endpoints reject the opposite mode before provider parsing, credentials, account admission or model work. Hosted missing configuration stays unavailable; self-hosted never consumes an operator key or initializes account auth.
- Self-hosted displays provider/Key settings without account UI, account fetches or auth listeners. Hosted displays account/credit controls without Key, provider overrides, clear-Key actions or a mode selector. Each question shows its configured fixed-unit cost.
- Hosted accesses only verified account history; self-hosted retains guest history. Signed-out drafts survive login, including a new draft after logout, while authenticated identity changes clear previous private state. Unknown identity never falls back to guest history.
- Chat composer controls are 32px on desktop, with 14–20px icons. The measured desktop composer is 85px instead of the previous approximately 97px. Coarse-pointer controls retain 44px hit areas and a 16px textarea; homepage/navigation dimensions remain unchanged.
- README, deployment guidance, product contract and account operations distinguish the two modes, Key trust boundaries and the separate SQLite account ledger. Existing hosted deployments must explicitly set the mode before upgrading and retain their `accounts` volume.

## Verification and release evidence

- Web unit/API regression: 432 passed. Runtime guard suite includes 53 cases. TypeScript and production build passed; all three entrypoints are dynamic.
- Independent source review checked mode enforcement, payloads, invalid configuration, identity isolation and unchanged credit admission/settlement. Its signed-out draft finding and environment-documentation finding were fixed.
- Browser matrix: initial full run 155 passed / 11 mode-inapplicable skips / 8 failures in outdated fixtures or navigation timing. After correcting those fixtures and adding the repeat-login draft regression, the final production build passed all 52 applicable mode/account cases (4 skips) plus both corrected self-hosted cases and a two-case rerun using the actual account BroadcastChannel name. Desktop/mobile, all three entrypoints, knowledge/auth outages, stale preferences, identity isolation and 320px Chinese/English cost layouts were covered. Runtime mode and denied requests hit real local servers; successful login/model flows use deterministic fixtures.
- Measured composer: desktop 85px, self-hosted mobile 93px, hosted mobile 110px including its separate cost line. No horizontal overflow at 320px; coarse-pointer hit targets remain 44px. Screenshots were visually inspected. Artifacts live under ignored `artifacts/deployment-modes/` and `artifacts/deploy/deployment-modes/`.
- Production release and authenticated readback completed; details below.
- Read-only production preflight on 2026-11-06 found source archive `7193f3e`, healthy Web/knowledge, active refresh timer, 16 available / 0 held / 20 granted credits and two completed uses. This is a point-in-time baseline; reread before/after release rather than assuming the earlier onboarding balance of 19.

Release must update Web only, persist `DEPLOYMENT_MODE=hosted`, preserve knowledge/Caddy container identities, corpus/controller mounts and ledger volume, and retain the previous source/config/image for rollback. No new real model request or login email is necessary for mode/UI acceptance.


## Production release and acceptance

Application commit `67781a6ab1b1a37ddcd7f758e25b0687bd617ba9` is live. Web image: `sha256:80bf630ebfe68685c53e969ed10900c782531dd1ccf5f00fac20db50330b3e66`. The branch is published for review in [PR #1](https://github.com/SoraYama/void-terminal/pull/1); the PR is a draft and main has not been merged by this rollout.

Release directory: `/opt/void-terminal/releases/deployment-modes-67781a6ab1b1a37ddcd7f758e25b0687bd617ba9`. SSH/full-archive transfer was slow; a 260,338-byte patch against the retained clean `7193f3e` source reconstructed the candidate on the server. All 356 target file hashes and modes were verified before building. The build context contained no live `.env`. The same packaged image passed both runtime modes in separate network-disabled containers, including three page props, unavailable-knowledge status metadata and opposite-mode denials. Production stayed unchanged during preparation.

The release held the existing catalog refresh lock, preserved the exact original environment in protected backup, added only `DEPLOYMENT_MODE=hosted`, and recreated only Web. Both knowledge and Caddy kept their container IDs/images. The catalog controller, registry, mounts, database inodes and timer state were unchanged. Public mode is hosted with BYOK false and shared enabled; direct BYOK calls to chat and model test return 403 `MODE_NOT_ALLOWED`. The active snapshot remains `agd-d7f2135c7eb0-26ae8d6dbac3`.

The ledger was identical immediately before and after release: one account, 20 granted, 16 available, 0 held, two completed requests consuming 4 credits. Normal authenticated account readback in the user's existing Chrome session confirmed the same balance and two usage records. An isolated verification tab reopened the existing local conversation, including two answers and two citation groups; actual select/deep/send heights are 32px, action height 28px, and the cost hint shows the current research cost. Hosted settings have no Key/provider/mode fields. The verification tab was closed and the original conversation tab retained.

Independent live anonymous browser checks passed at 1440×900, 390×844 and 320×640: correct mode, stale preference normalization, no BYOK controls, sign-in entry preserving draft, readable transparent homepage title, no horizontal overflow or browser/network errors. Nine screenshots were visually reviewed. Every write request was blocked defensively by the test browser, and there were zero attempted writes. No real email or model generation was performed in this release verification.

Sanitized local evidence: `artifacts/deploy/deployment-modes/{preparation.json,release-receipt.json,recovery.json,production-authenticated.json}` and `public-ui/{report.json,visual-review.md}`. The server release retains the reviewed scripts and complete original app/config under `backup/app.before`. The live app remains a verified source archive, now marked by `.deployment-modes-release.json`; it is not a Git checkout. Its recovery command is `python3 release.py --revision 67781a6ab1b1a37ddcd7f758e25b0687bd617ba9 --rollback --execute` from that release directory. It restores the original app, exact environment and Web image only; it does not restore or overwrite account/corpus data. Do not reuse the earlier account-trial rollback for this release.
