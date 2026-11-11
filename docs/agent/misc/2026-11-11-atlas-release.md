> **Date / Revised**: 2026-11-11

# Atlas production handoff and release

## 1. Background & Problem

Continue the verified offline `void-terminal-atlas-20261111` handoff, pull current upstream, and publish Teyvat Atlas, chat map cards, and locale-correct archive content together. The payload contains feature commit `df1251a`, handoff commit `3ada92a`, and map snapshot `map-7.2-4b27a05e0004aab7` (89,091 markers, 597 regions, 759 resources, 1,769 assets). Source time is 2026-11-09T20:39:02.715Z; this does not assert current official spawn completeness.

## 2. Root Cause / Approach

Restore the bundle in an isolated receiving checkout and compare against freshly fetched `origin/main` (`331fc0d` at handoff). Verify every archive hash and map asset. Production `/opt/void-terminal/app` is deployment configuration, not a Git checkout. Retain its SQLite/catalog-refresh/support Compose layers, account volume, knowledge service, Caddy, environment, and sponsor mount. Only the Web image, `MAP_DATA_DIR=/data/maps`, and read-only map mount may change.

Two initial CI jobs failed because the runner could not resolve its Ubuntu apt mirror. Native Chromium libraries were already installed; optional font installation was the blocker. Downloading Chromium without apt exposed missing CJK fonts in both Linux screenshots (tofu glyphs changed line wrapping and failed `answer-cards.spec.ts`). CI now installs a fixed official Noto CJK font commit with a verified SHA-256, keeps browser dependency validation and every assertion, and stops early on failure. No application build input changed in these CI fixes.

## 3. Key Changes and Evidence

- User-authorized SSH alias `void-terminal` saved in local `~/.ssh/config`; server authorization was installed by the user, never bundled or committed.
- Local handoff payload: 19 files and every map asset verified. Runtime maps restored into the main local workspace without replacing an existing pointer.
- Receiving checkout: 567 unit tests, typecheck and production build passed. Real-map/language browser subset: 23 passed, 1 existing skip.
- Local full browser run: 275 passed, 14 skipped, 1 mobile museum focus failure. The same focus case passed three consecutive isolated reruns. Keep the original result distinct from a full successful run.
- Production image built from audited Web build inputs. Network-isolated container verified catalog 597/759, Ormos count 2, resource icon HTTP 200, and a packaged zoom-15 tile HTTP 200; temporary container removed.
- Structural Compose preflight passed: only map env/read-only mount added. Private baseline config/container snapshots remain only in the root-private server release directory.
- PR: [#3](https://github.com/SoraYama/void-terminal/pull/3)
- Final application/CI commit: `9b77c4d1297b7cea4f260e2769b2e49cdb5cbb1f`; PR #3 merged as `fd8f2c47a83d1d12b4f40a28a22bb5fbf3bad0ce`.
- CI: [PR verification](https://github.com/SoraYama/void-terminal/actions/runs/43055859044) and [push verification](https://github.com/SoraYama/void-terminal/actions/runs/43055848094) (both succeeded: Web 565 passed / 2 map-data skips; Python 552 passed / 1 skip; evaluation 10 tests; catalog controller 36 tests; Chromium 270 passed / 20 existing or missing-real-map skips).

## 4. Production Outcome

Published at **2026-11-11 08:23:45 PST** (2026-11-11T16:23:45.751759+00:00) to [Teyvat Atlas](https://void-terminal.sorayama.moe/map).

- Image revision: `9b77c4d1297b7cea4f260e2769b2e49cdb5cbb1f`; image ID: `sha256:3c228197228a2d795554289fb0dd81ead488d83dcccfd53c3ad3a6ac59f0588c`.
- The live account ledger was backed up consistently and passed SQLite quick_check. No account/knowledge schema migration, volume replacement, or knowledge/Caddy recreation occurred. Original sponsor mount and resolved configuration were preserved; only the map env and read-only mount changed.
- Public before/after status exactly matched for active corpus `agd-d7f2135c7eb0-26ae8d6dbac3`, 1,560,947 documents, 1,697,353 chunks, hosted mode, and provider configuration.
- Live catalog: 597 regions / 759 resources. Ormos count 2, included IDs 33876/33877, status crosschecked. Windrise count 6, status requires-review. The container node user (UID 1000) can read all 1,769 persisted assets.
- Public desktop/mobile map checks: **4/4 passed**, using real APIs/tiles with no mocked map endpoints. Covered home navigation, English/Chinese labels, country/region/resource selection, URL reload/back/forward, unsupported-scene limitation, tile completion and no horizontal overflow.
- Public real-knowledge checks passed for Ayaka profile, stories, talents, constellations and cultivation materials; Staff of Homa, Gladiator's Nostalgia and Shivada Jade Sliver; original English and Chinese documents; locale switching and repair of old Chinese region URLs. Research source language remained Chinese. A private preview was also checked against the live knowledge service and then removed.
- Public chat component check used real map results/assets with **browser-only account and controlled SSE fixtures**. Selection/zoom survived streamed updates; desktop/mobile layouts, IndexedDB history and follow-up `mapSnapshotId` passed. No real account was authenticated and no paid model call was made.
- Local main was pulled to the merged revision, dependencies installed from its lockfile, and the verified ignored map runtime snapshot restored.

Rollback command (root-private backup/config/state remain on the server):

```sh
ssh void-terminal 'python3 /opt/void-terminal/releases/atlas-3ada92ab4199/activate.py rollback'
```

Rollback restores the old Web image/config/map pointer while keeping current account writes and all historical map snapshots. Old Web tag: `void-terminal-web:before-9b77c4d1297b` (revision `2ce87db4c526163a2044d4708e4fe84d24111ef6`).

Release workspace: `/opt/void-terminal/releases/atlas-3ada92ab4199` (named for the original handoff; final revision/tag follows the CI-fixed commit). `activate.py` serializes Web releases, backs up live accounts through SQLite backup/quick_check, installs immutable map data, atomically switches current.json and the targeted Compose update, recreates only Web, checks service/container/mount invariants, status and exact map counts, and restores the prior image/config if activation fails. The knowledge and account schemas are not migrated.

## 5. Boundaries / Next Maintenance

Retain map history snapshots. Windrise has 6 Anemoculi and a boundary review item; unsupported independent scenes return an explicit limitation. Chat UI acceptance must disclose a controlled SSE/account fixture if no real paid model call is made. Real production English document checks must use the live knowledge service, not bilingual subset fixtures.

Local evidence is under ignored `artifacts/atlas-production/`; server account backups and full resolved configs are private and must not be copied into Git or public logs.
