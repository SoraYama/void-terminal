# Server Catalog Refresh Implementation Plan

> **For agentic workers:** implement independent source, catalog and build units with tests first; the controller integrates, reviews and operates production.

**Goal:** Run verified, recoverable data-only updates daily at 04:30 Asia/Shanghai on the existing server, independently of the Mac.

**Architecture:** A resource-limited existing knowledge image constructs one new SQLite database from a frozen pair of upstream commits. The host publishes a verified read-only SquashFS shard through a durable registry pointer; the old SQLite stays available for historical reads and budgets.

**Tech Stack:** Python 3.11+, SQLite, Docker Compose, SquashFS, systemd. **Spec:** `docs/superpowers/specs/2026-11-04-catalog-refresh-design.md`.

## Global constraints

- No Mac at runtime, new public endpoint, paid dependency, application auto-upgrade, historical snapshot deletion, or modification of the legacy live database during builds.
- Verify both source identities and scope, database integrity and coverage, mounted candidate, then public activation; interruption or failed acceptance restores the old pointer. Preserve 5 GiB free by preflight and live space monitoring.
- Filesystem contract: `/opt/void-terminal/catalog-refresh/{state,images,mounted,work}`. Registry in `state/registry.json`, `images/<sid>.squashfs` mounts as `mounted/<sid>/catalog.sqlite`. In the knowledge container, `/catalog-state/registry.json` and `/catalog-archives/<sid>/catalog.sqlite` are read-only bind mounts.
- Registry schema: `{"version":1,"active":sid,"legacy":{"snapshotId":sid,"sources":{"main":sha,"supplement":sha}},"snapshots":{sid:{"sources":{"main":sha,"supplement":sha},"databaseSha256":sha256,"imageSha256":sha256,"bytes":positive_int,"documentCount":positive_int,"chunkCount":positive_int,"sequence":positive_int}}}`. Archive sequence numbers are unique and assigned in publication order. Legacy retains its original default and all earlier pinned IDs. `sid` is `agd-` plus 12 lowercase hex characters, `-`, and 12 lowercase hex characters. Registry paths are derived only from validated registry keys.

## Review focus

- A newer upstream commit without a mirror or with invalid Git trees must fail closed, without modifying default fixed pins.
- Old and new source IDs can coincide; explicit requests must open the matching shard, including research and item/document detail.
- A registry write or process death between activation and acceptance must restore the exact previous registry, with mounted files preserved.
- Boot failures of historical or active mounts must not prevent unrelated Docker services from starting. Archive path/symlink, unexpected mount, resource/capacity failures must not publish.
- The worker image identity must stay fixed after setup; accepted source data is never executable build configuration.

## 1. Dynamic, verified source acquisition

**Ownership:** `knowledge/ingest/{source_plan,acquire,normalize,__main__}.py`, `knowledge/items/build.py` and source/ingest tests. Produce stdlib-only `knowledge.ingest.source_plan.latest_commits() -> dict[str,str]` (`main`, `supplement`). CLI `python -m knowledge.ingest plan --main-commit SHA --supplement-commit SHA --output PATH` writes a verified plan; existing `fetch` and `normalize` accept `--source-plan PATH`. Marker pins and source provenance must match; preserve existing fixed-pin commands.

- [x] RED/GREEN official tree hash verification, incomplete/truncated/unsafe objects, changed TextMap hashes, supplement scope, marker mismatch, main and supplement provenance and snapshot ID changes.
- [x] Reuse GitLab mirror/fixed GitHub acquisition and scoped digest validation; isolate plan data from application pins. Run ingest and item tests.

## 2. Snapshot read routing and disposable SQLite mode

**Ownership:** `knowledge/{catalog_registry,catalog_router,store,app}.py` and routing tests. `catalog_registry.load_registry(path)` returns the validated dictionary, stdlib only; `validate_registry(value)` returns it or raises `ValueError`. `CatalogStore(database_url, *, readonly=False, offline=False, verified_counts=None, ...)` opens immutable SQLite archives read-only, optionally caches verified `(document_count, chunk_count)` tuple; new offline SQLite uses DELETE journal, normal production still uses WAL. API runtime selects routing when `CATALOG_REGISTRY` and `CATALOG_ARCHIVES` are configured.

- [x] RED/GREEN default switches without restart, explicit old and new items/docs/source/search reads, unknown ID, readonly archives, legacy budgets, no registry backwards compatibility and offline DELETE journal.
- [x] Run routing and existing service API tests.

## 3. Reusable candidate build and coverage checks

**Ownership:** `knowledge/refresh_build.py` and its tests. `python -m knowledge.refresh_build build --workspace /work --cache /cache --main-commit SHA --supplement-commit SHA --baseline /work/baseline.json` calls Task 1 CLI, builds `catalog.sqlite` and writes `result.json`. `python -m knowledge.refresh_build inspect --database PATH --snapshot SID [--quick-check]` prints metrics including `snapshotId`, `sourceCommit`, `documentCount`, `chunkCount`, `documentsByLanguage`, `itemsByCategory`, `verifiedImages`, `itemCount`, and stable `samples` IDs/strings for public checks. `result.json` includes those metrics plus `sources`, `databaseSha256`, `bytes`. Use read-only inspect on existing/mounted DB, and Task 2's offline mode for disposable import.

- [x] RED/GREEN empty/corrupt candidate, coverage regressions above five percent, images drop above five points, missing both languages, pinned identity, no activation of legacy SQLite.
- [x] Release intermediate raw/normalized work after successful phase, preserve only small reports and candidate. Run focused tests.

## 4. Host orchestration, tests and actual release

**Ownership:** `scripts/catalog_refresh.py`, `deploy/compose.catalog-refresh.yaml`, `deploy/systemd/void-catalog-*.{service,timer}`, host tests, docs and operation evidence.

- [x] RED/GREEN one-run lock, no-update short circuit, resource/freespace cutoff, durable rollback on negative acceptance or process interruption; pinned version routes persist across successful activation and failed new route is removed.
- [x] Implement build container restriction, filesystem staging, mount verification, startup recovery and timer; validate unit files on target Ubuntu and run whole-branch review. Build/rehearse in isolated paths; enable archive-aware knowledge with legacy active after private/public checks.
- [x] Complete genuine `d54f6f0` update (or newer verified heads) through actual `run` workflow; verify old references, current pins and no-update rerun. Then enable daily timer and record next execution; no Mac/Codex schedule.
- [x] Save actual evidence and operating/recovery instructions in `docs/data-updates.md`, dated `docs/agent/feature/` note and index. Preserve existing backups.
