> **Date / Revised**: 2026-10-28

# Versioned knowledge catalog and shared budget

## 1. Background & Problem

The knowledge service owns durable corpus snapshots, citation reads and global shared-mode token reservations. Source truth and retrieval availability must remain visible when corpus data or optional model weights are absent.

## 2. Root Cause / Approach

`knowledge.store.CatalogStore` uses one transaction for complete import and active-snapshot promotion. Failed imports roll back the snapshot, documents, chunks and lexical indexes. Source IDs include snapshot identity; historical citations remain readable after promotion. Explicit unavailable snapshots always error.

## 3. Key Changes

- SQLite is a development adapter; PostgreSQL production schema uses pgvector and an HNSW cosine index. `status.storage.adapter` names the adapter.
- Chinese unigram/bigram lexical tokens, independent normalized entity/alias names and optional true E5 vectors use weighted RRF.
- E5 is disabled by default. Semantic mode requires local weights, a pinned 40-character revision and an exact preprocessing/dimensions manifest shared by ingestion and queries. Missing/mismatched models stay lexical with an explicit reason.
- Budget reserves serialize on a global UTC-day database row (SQLite BEGIN IMMEDIATE; PostgreSQL FOR UPDATE). Request IDs are idempotent; settlement refunds unused reservations once, while null usage retains the worst-case reservation permanently.
- HTTP uses camelCase contracts and safe structured errors. All catalog/budget routes enforce `X-Knowledge-Token` when configured. `ENVIRONMENT=production` requires that token.

## 4. Conclusions / Lessons

Run the complete service pytest suite. Live PostgreSQL checks require `TEST_POSTGRES_URL`; SQLite tests cannot prove pgvector runtime correctness. Build a new immutable snapshot after enabling/changing embeddings instead of mixing vector revisions. Default shared budget is zero, so a shared provider key alone never enables spending.

## 5. Reviewed scale and provenance follow-up

- Sparse token and exact-name retrieval use covering indexes. SQLite forces token/name indexes and CROSS JOIN loop order; otherwise its planner can scan every snapshot posting/chunk despite a selective term. EXPLAIN and VM-step regression tests guard both paths.
- Per-field textSpans are mandatory for composite quoted fields; chunks never cross source boundaries. Unmapped non-whitespace text and stale multi-file Readable composites fail import. Readable source links carry actual chunk line ranges; sourceStart/sourceEnd offsets address exact source-field codepoints.
- Import uniqueness uses the database primary key instead of an O(corpus-size) Python ID set. Final corpus benchmark artifacts are separate from the early10k sample.
- Hatch wheel targets explicitly include knowledge despite project distribution name void-knowledge. Native uv sync used the Tsinghua public PyPI mirror after official wheel-download stalls.

## 6. Measured retrieval acceptance and final safeguards

The first frozen108-case run measured only35/84 natural document hits@10. Entity weight2 lets ~60 entity-only rows outrank lexical rank1, so generic UI captions and speaker labels crowded supporting passages out. Keep weight2 only for exact whole-query structured title/alias intent; natural questions use0.05 and ignore UI/other or speaker-only entity cues. This general change recovered77/84 without changing source data or questions. Contraction fragments s/t/d/m/ll/re/ve are query grammar, not concepts; filtering them improved the Jean's-review full-run case20.37s→5.75s while exact structured-symbol lookup remains available.

Exact lookup and candidate generation must share quote unwrapping: insert exact_entity_name(query) before candidate dedup/512cap, otherwise singlequoted aliases longer than6words can be found by lookup but absent from actual entity candidates. Regression uses240 short lexical distractors. Never claim lexical/semantic quality from fixture success; final108-case artifacts record exact hashes, remaining misses and observed latency.

Initial-build provenance repair was a separately authorized unpublished-only exception:153 conventional dialogList locators were corrected with before/after document hashes and unchanged affected chunk digests before8000 exposure. Final corrected normalized corpus SHA differs from the retained explicitly chosen build ID. Published snapshot content remains immutable; no update API or reusable published-data repair path was added.

## 7. Final verified state

Final unchanged108-case evaluation under store4d589673 /retrieval03a3d358: natural document hit@10 76/84 (90.48%), exact-support-excerpt hit74/84 (88.10%), title15/16; natural p50/p95 1.081s/6.659s, maximum acrossallcases9.286s. Preserve the initial35/84 baseline, intermediate77/84 and the disclosed contraction-stage regression; this is retrieval acceptance, not real-model answer accuracy. Root final native/livePG suite78passed, zero skips, one upstreamdeprecation; temporary PG was stopped afterward. Local read services8000/3000 remain running, no public deployment implied.

The frozen full corpus contains1,548,672 documents/1,688,671 chunks, explicitlychosen snapshot agd-792978e5503e-1ac83cf28961, corrected corpusSHA ec83ef7273b4a4875048940ec42f1095963ea0399777a7e5b6d616c9dbc0b33c. Source repair and all span/context/fingerprint audits are complete; semantic weights remain disabled/unverified. Final evidence is artifacts/reports/knowledge.md and retrieval-eval/comparison artifacts. Final wheel contents match the frozen code and include the bundled530,392-byte acquisition inventory. Do not repeat a full import merely to repair unpublished metadata without checking the documented initial-build authorization boundary; published snapshots remain immutable.
