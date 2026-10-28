# Passage-grounded retrieval evaluation

This is a reproducible source-retrieval regression set for the pinned imported Genshin corpus. It does **not** measure generated-answer accuracy. All natural-language questions were authored manually after inspecting actual source passages, then bound to actual passages in the normalized snapshot. The evaluator validates every target again against the imported catalog before it accepts any measured results.

The frozen suite has 108 cases: **84 manually authored natural questions**, 16 mechanical title lookups, and eight negative diagnostics. Natural questions include 62 Chinese and 22 English cases. Positive cases span 13 content types; generic `other` orphan text is checked separately because its speaker/task context is explicitly unknown.

| Stratum | Chinese | English | Total |
|---|---:|---:|---:|
| Manual lore | 30 | 10 | 40 |
| Manual context | 32 | 12 | 44 |
| Mechanical title lookup | 8 | 8 | 16 |
| Negative diagnostic | 4 | 4 | 8 |

## Files and reproducibility

- `retrieval-cases.jsonl`: final evaluable cases with exact expected document IDs, content type, language, title, source commit/path/locator, and a short supporting excerpt with its own passage provenance.
- `corpus.json`: pinned final snapshot, full normalized document count, source commits, case hash, case distribution, and negative-anchor presence audit.
- `manual-lore-candidates.jsonl`, `manual-context-candidates.jsonl`: authoring records from the preliminary v3 corpus. These are **not** the executable case set. The executable cases bind every expected target and provenance to the final corpus; records that fail grounding are not accepted. Historical authoring notes embedded in cases still mention v3 refresh; those notes describe the authoring stage, while the expected-document fields and corpus metadata define the executable ground truth. The same frozen queries are retained when a later complete snapshot preserves these documents.
- `test_evaluate_retrieval.py`: evaluator tests for negative-control separation, duplicate-chunk ranking, multi-target recall, missing excerpts, stale commits, and wrong source spans.
- `unlinked-source-probe.json`: separate check for an actual orphan TextMap passage and its required uncertainty metadata; excluded from the frozen benchmark.
- `../scripts/evaluate-retrieval.py`: evaluator. It refuses a different snapshot, a partial-corpus document count, a changed case-file hash, missing expected documents, stale source metadata, or ungrounded excerpts.
- `../artifacts/reports/retrieval-eval.json` and `.md`: actual measured report; reports are local ignored artifacts, not embedded benchmark constants.

Run from the repository root after the full final snapshot has been imported:

```sh
services/knowledge/.venv/bin/python scripts/evaluate-retrieval.py \
  --database-url sqlite:///data/catalog.sqlite
```

Alternatively measure the live knowledge HTTP service:

```sh
services/knowledge/.venv/bin/python scripts/evaluate-retrieval.py \
  --url http://127.0.0.1:8000 \
  --output artifacts/reports/retrieval-eval-http.json
```

Use `KNOWLEDGE_API_TOKEN` in the environment if the service requires authentication. Credentials and database URLs are not written to the report. Run the evaluator checks with `python3 -m unittest discover -s eval -p 'test_*.py' -v`.

## Reproducing the frozen snapshot identity

The benchmark pins snapshot `agd-792978e5503e-1ac83cf28961`. This identity was selected for the unpublished build before a narrow source-locator metadata correction. With corrected normalization code, the automatic content-hash-derived ID differs. For a fresh reproduction, use the supported `--snapshot-id` option and a separate output/catalog path:

```sh
PYTHONPATH=services/knowledge services/knowledge/.venv/bin/python -m knowledge.ingest normalize \
  --input data/upstream/AnimeGameData \
  --supplementary data/upstream/genshin-db \
  --output data/normalized-eval-reproduction \
  --snapshot-id agd-792978e5503e-1ac83cf28961
```

Before importing, confirm that the generated `report.json` field `corpusSha256` equals `normalizedCorpusSha256` in `eval/corpus.json`, and that its count is 1,548,672. Import into a fresh catalog, then evaluate that catalog:

```sh
PYTHONPATH=services/knowledge services/knowledge/.venv/bin/python -m knowledge.ingest import \
  --normalized data/normalized-eval-reproduction \
  --database-url sqlite:///data/catalog-eval-reproduction.sqlite
services/knowledge/.venv/bin/python scripts/evaluate-retrieval.py \
  --database-url sqlite:///data/catalog-eval-reproduction.sqlite
```

These are fresh-build reproduction instructions. Published snapshots remain immutable, and the evaluator retains its strict wrong-snapshot guard. Use the fixed commits in `sources/manifest.json` and the same frozen acquisition scope: the complete selected primary directories plus the supplementary ChineseSimplified/English `weapons`, `artifacts`, `characters`, `voiceovers`, and `materials` categories (2,944 supplementary files). The acquisition records preserve this scope; including additional supplementary categories changes the corpus hash and count. The source directories above are acquired inputs, not bundled fixtures.

## Strata and interpretation

`manual_lore` includes contextual questions about characters, dialogue lines, books, weapons, and artifact histories. `manual_context` adds quests, dialogue, Sumeru/Irminsul/Nahida themes, materials, furnishings and other corpus types. These are source-informed questions, not independently collected user traffic; some ask multiple questions supported by the full target document while the compact saved excerpt anchors only part of it.

`mechanical_title_lookup` uses exact entity titles. These are deliberately easy findability checks, reported separately from natural questions. Repeated titles or related documents may be relevant; target sets are not exhaustive relevance judgments. `negative_control` uses explicitly fabricated premises or identifiers. Negative controls record returned-source counts only. A coincidental or related lexical result does not prove the premise, and an empty result does not prove that a model would refuse correctly.

Hit@1/5/10 asks whether at least one expected document occurs in the first 1/5/10 returned **source chunks**, without collapsing duplicate documents. Document recall additionally reports how many expected documents were found. Strict excerpt hit asks whether a returned chunk contains the exact saved supporting excerpt; it is a narrower signal than document hit, not model-based citation-entailment judgment. MRR is truncated to the requested top-k.

Latency uses a monotonic clock around each `CatalogStore.search` or HTTP search call, serially, excluding grounding validation and report generation. There is no deliberate warmup or load test; other local process load is not controlled, and validation/imports can warm database and OS caches. `--repeats` measures repeated latency and rank stability; first-run ranks determine scores. Percentiles use nearest-rank. The report records actual corpus counts, retrieval mode, snapshot metadata and hashes of retrieval/evaluator code. The JSON report retains returned passage text so excerpt-hit scores can be audited. Results are local-runtime observations, not production throughput claims.

Semantic retrieval is reported only when the service actually returns hybrid mode. No model API is called by this script. Answer correctness, factuality, refusal, citation entailment and end-to-end model latency remain unmeasured without a separate provider-backed evaluation.

## Measured baseline and focused correction

Local reports retain the full initial measurement as `retrieval-eval-baseline-entity2.json`/`.md`, the accepted revised run as `retrieval-eval.json`/`.md`, and a same-case comparison as `retrieval-eval-comparison.json`/`.md`. The revised run follows a bounded diagnosis of failures from this same suite; it is a regression result, not an independent held-out estimate. Questions, accepted IDs, excerpts, case bytes, source snapshot and corpus hash stayed unchanged.

`retrieval-eval-rank-diagnostic.json`/`.md` records once-captured lexical/entity candidates from isolated baseline code and offline fusion-weight replays. `retrieval-eval-baseline-code.zip` preserves that code. Separate measurement-context files disclose cache history and concurrent local activity. The baseline, regressions, remaining misses, negative diagnostics and unmeasured model-answer quality are retained rather than folded into a single headline score.

The subsequent English contraction-fragment fix and complete quoted-title candidate fix were also evaluated with the same 108 cases. `retrieval-eval-pre-possessive.*` preserves the earlier focused-fusion run; `retrieval-eval-prequote.*` preserves the valid contraction-only run. `retrieval-eval-possessive-comparison.json`/`.md` reports the final run against that earlier accepted run, including the `lore-008` latency, unchanged expected source rank, and the additional `lore-023` miss. Only the final `retrieval-eval.json`/`.md` should supply current results; historical files are explicitly labelled.
