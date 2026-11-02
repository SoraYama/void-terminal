> **Date / Revised**: 2026-11-02

# PostgreSQL library prefix lookup under locale collation

## 1. Background & Problem

The v1.0 release check found `test_live_postgres_snapshot_and_read` failing in GitHub Actions: library query `Nahi` returned no `Nahida` document. Eighty other Python tests passed. SQLite production acceptance did not exercise this PostgreSQL-specific behavior.

## 2. Root Cause / Approach

`CatalogStore.list_documents` bounded prefix candidates using `token >= prefix AND token < prefix + U+FFFF`. This assumes character ordering. PostgreSQL 17.11 with `en_US.utf8` reproduced `nahida >= nahi` as true but `nahida < nahi+U+FFFF` as false. The same upper bound with `COLLATE "C"` was true.

Use PostgreSQL `LIKE` with an escaped literal prefix and a `text_pattern_ops` covering index instead. This supports prefix indexing with locale collation; see the [PostgreSQL operator-class documentation](https://www.postgresql.org/docs/17/indexes-opclass.html). Keep SQLite's existing indexed range query and final literal title/body/alias verification unchanged. Technical metadata remains excluded.

## 3. Key Changes

- `knowledge/store.py`: create `tokens_prefix_lookup(snapshot_id, token text_pattern_ops, chunk_id)` under the existing startup advisory transaction lock; use `LIKE` only for PostgreSQL prefix candidates. Escape `_` because it is a valid tokenizer character and a SQL wildcard.
- `migrations/001_catalog.postgresql.sql`: keep the declarative schema consistent with startup initialization. Preserve existing indexes and corpus snapshots.
- Live PostgreSQL regressions cover upper/lower case, multiword queries, literal underscores and metadata-only distractors. An actual application-query `EXPLAIN ANALYZE` with 20,000 unrelated postings requires indexed token access and bounded visited rows.
- README explains first-upgrade index creation: PostgreSQL operators must budget disk and a maintenance window for a large existing token table. SQLite creates no extra index.

## 4. Verification / Lessons

- Before the fix, the live PostgreSQL module had 6 failed / 1 passed, including the original failure.
- After the fix, the entire knowledge-service suite had 87 passed / 0 skipped on the isolated PostgreSQL 17 container. The database already contained the old schema from the failing run, so the successful rerun also exercised upgrade initialization.
- One upstream Starlette/httpx deprecation warning remains; it is unrelated to prefix lookup.
- Independent review caught an initial plan-assertion blind spot: `Actual Rows` counts emitted rows after filtering. Include `Rows Removed by Filter` and `Rows Removed by Index Recheck` when counting work. A negative control removed only the new index after fixture initialization: the query still returned the correct document, but the test failed at 20,012 visited rows. Normal startup rebuilds the missing index on the next run.
- Evidence: ignored `artifacts/diagnostics/postgres-prefix-20261102/{red,green,without-index}.log`. GitHub CI must pass on the pushed commit before promotion to main; do not infer browser/build success from Python tests.
- Test services use a dedicated Docker network, no published ports, separate temporary storage and no production corpus mounts. Remove the temporary containers/network after acceptance.

The previously published `v1.0.0` initially points at `904e12b`. Do not silently move an already public tag when completing the later user-selected fix-first release path.
