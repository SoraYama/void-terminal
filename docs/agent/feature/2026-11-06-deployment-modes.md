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

Release must update Web only, persist `DEPLOYMENT_MODE=hosted`, preserve knowledge/Caddy container identities, corpus/controller mounts and ledger volume, and retain the previous source/config/image for rollback. No new real model request or login email is necessary for mode/UI acceptance.


## Production acceptance

The hosted application has been deployed. Isolated desktop and mobile checks passed for the hosted interface, sign-in entry, settings and layout. Existing authenticated access and saved conversations were also checked without issuing a new model-generation request or login email.

Detailed operational receipts are retained locally under the ignored `artifacts/deploy/deployment-modes/` directory. Public documentation intentionally omits live account balances, individual usage and server recovery metadata. The feature branch is available in [PR #1](https://github.com/SoraYama/void-terminal/pull/1), currently a draft; main has not been merged by this work.
