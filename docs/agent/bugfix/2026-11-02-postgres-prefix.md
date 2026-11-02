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

## 5. Full CI browser follow-up

The first fix commit passed Python, evaluation and build, then exposed a previously blocked E2E failure: dark desktop small-wheel scrolling compared the eventual position against a baseline captured before Playwright's hover action. The CI trace showed the baseline at 2,841 and the final position stable at 2,847 for the entire polling timeout, with the return-to-latest control visible. A 41px streamed paragraph and the 35px upward gesture overlapped; comparing across streaming updates produced a false failure despite following being suspended.

The simulated provider now holds chunk delivery only during native-gesture measurement while keeping SSE open. After pending layout frames complete, a real 35px upward wheel gesture must reveal return-to-latest and decrease absolute `scrollTop`. The fixture then resumes text delivery, and more paragraphs must arrive without changing the user's reading position. This controls the mock provider's scheduling, adds no wheel listeners, calls no production handlers, and does not increase timeouts, add retries or change product code. CI trace and failure artifacts are retained locally under `ci-browser-failure/`.

Intermediate measurements were rejected during review: non-passive observation changes browser scheduling; passive observation can run after default scrolling; answer-tail distance can grow from incoming paragraphs without native scrolling. An independent `preventDefault` negative control reproduced the last blind spot. Preserve an absolute-position decrease during the controlled gesture plus stability after text resumes.

The final controlled fixture passed 12 repetitions across desktop/mobile and light/dark themes. With only native wheel scrolling cancelled in a temporary test variant, the final absolute-position assertion failed as expected. The temporary variant was removed; logs are `controlled-reading.log` and `cancelled-wheel.log`.
