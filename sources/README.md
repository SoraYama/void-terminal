# Pinned source acquisition and coverage

The runtime corpus uses actual upstream files. Raw downloads, normalized JSONL, downloaded weights and catalogs live under ignored `data/` and `models/`; they are not part of the public source repository.

Primary source: `DimbreathBot/AnimeGameData` at `792978e5503ecfba73dcb3562ed44a0d35a2abe2`. The default fetch verifies that the public GitLab upstream mirror `Dimbreath/animegamedata2` contains that identical Git commit, then downloads path-filtered archives through its repository API. This avoids downloading Git history and avoids the incomplete 1000-item GitHub Contents directory listing. Each archive cache is scoped by commit and has persisted versioned metadata binding its exact URL, repository, commit, path, byte count and SHA-256 to a completed download and validated extraction. Unverified legacy caches and mismatched bytes are redownloaded. Complete source scopes are staged and replaced together, removing stale deleted files while preserving the previous scopes if acquisition fails. The four default Chinese/English TextMaps are additionally verified against pinned Git blob SHA-1 and byte counts. Citations retain the canonical fixed-commit GitHub URLs.

Supplementary source: `theBowja/genshin-db` at `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`. The bundled metadata inventory contains **all 2944 files in five categories for ChineseSimplified and English**: weapons, artifacts, characters, voiceovers and materials. Each downloaded file is verified against its upstream Git blob hash. This is five of the upstream's 30 curated categories; the acquisition marker explicitly says `complete: false`, `scopeComplete: true`. A complete recursive Git tree may be supplied with `--tree-file` to import additional categories. Its Git root and every directory digest must match the tree pinned to the requested source commit; empty, truncated, incomplete or escaping-path inventories are rejected. Cached range pieces are scoped by download identity and discarded after a full Git hash mismatch.

From the repository root, with the knowledge package installed:

```sh
python -m knowledge.ingest fetch --source main --destination data/sources/AnimeGameData
python -m knowledge.ingest fetch --source supplement --destination data/sources/genshin-db --workers 32
python -m knowledge.ingest normalize --input data/sources/AnimeGameData --supplementary data/sources/genshin-db --output data/sources/normalized
python -m knowledge.ingest import --normalized data/sources/normalized --no-activate
python -m knowledge.ingest snapshots
python -m knowledge.ingest activate SNAPSHOT_ID
```

Docker equivalents and persistent-volume paths are in the root README. `update` normalizes local sources and imports a new immutable snapshot. It reports hash deltas and writes `deletions.jsonl`; omitted documents disappear from the new snapshot, while earlier snapshots remain available for rollback. Normalization currently rebuilds the full selected corpus rather than selectively reparsing changed dependencies. An unchanged corpus produces the same snapshot ID; an existing immutable snapshot cannot be overwritten. Use `--snapshot-id` for a deliberate new embedding build.

## Quote provenance

- Config-backed descriptions and dialogue retain `metadata.entitySource` for the source record and `metadata.textSpans` for each exact TextMap shard/hash containing the quoted text. Span offsets are Unicode codepoints. Repeated hashes retain the actual chosen shard path.
- A readable source document contains the decoded text of exactly one physical file. Multi-file books retain a shared document group, series metadata and adjacent-part relations. They never cite one file for another file's paragraphs.
- Supplementary prose owns its exact JSON pointer, including nested artifact piece stories. Subtitles own the exact physical SRT line; they are not merged into the dialogue chronology.
- Every otherwise unreferenced default-locale TextMap value is indexed as explicitly unmapped text, with unknown context and test/publication state; this makes the source available without inventing an entity or plot association.
- Unknown graph conditions, opaque table fields and role identifiers remain in raw metadata. Missing targets are counted and omitted from public relations; they are not invented.

## Observed build on 2026-10-28

The primary selected scope contains 91,693 files: all 2234 Excel tables, 55,891 Talk files, 28,785 Readable files across 15 source locales, 4779 subtitle files, and the four complete default TextMaps. Searchable normalized output defaults to `zh-CN` and `en`; other readable locales are retained locally rather than silently translated.

Final snapshot `agd-792978e5503e-1ac83cf28961` contains 1,548,672 normalized documents. This build retained that explicitly chosen snapshot ID during a one-off correction of 153 dialogue context locators before its first publication. Only the record pointers changed; document IDs, quote bodies, quote spans, relations and chunk ordering stayed unchanged. The corrected normalized corpus SHA-256 is `ec83ef7273b4a4875048940ec42f1095963ea0399777a7e5b6d616c9dbc0b33c`. The ID suffix is therefore a chosen build identity, not the current content digest. A fresh normalization without an explicit ID derives its ID from the corrected hash.

To reproduce the chosen local benchmark identity with the corrected parser:

```sh
python -m knowledge.ingest normalize --input data/sources/AnimeGameData --supplementary data/sources/genshin-db --output data/sources/normalized --snapshot-id agd-792978e5503e-1ac83cf28961
```

 Whole-source validation matched 1,677,433 quote spans to the exact source JSON pointer/hash or subtitle line, and matched 3953 readable documents to their physical source file text. These are acquisition and provenance results, not a claim that every upstream field has been semantically interpreted or that every game text is available.

The machine report records 64 readable files whose titles/series could not be joined, 6877 empty or opaque Talk containers requiring further context adapters, 721,796 missing hash lookup occurrences, and all previously unreferenced TextMap hashes. Those 360,206 standalone Chinese/English values are now indexed as `other` with `kind=orphan_textmap`, `contextUnknown=true` and `testState=unknown`, using their exact source hash. No scene, speaker, quest, chronology or canon status is inferred. The sample review found meaningful narrative mixed with UI, stat templates and explicit test strings, so retaining only a missing-hash report would omit actual user-requested text. Missing text and translation counts remain visible per type. Remaining config tables with recognizable text hashes are preserved as verbatim `other` records with their raw structure; no gameplay meaning is inferred for an unknown table.

The root third-party notices distinguish repository code licensing, raw-source status and game content attribution. No game version is inferred from the snapshot label.
