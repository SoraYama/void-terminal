> **Date / Revised**: 2026-10-28

# void-terminal implementation and validation

## Approved direction

The user approved the official Sumeru scenery / Genshin logo v2 design and authorized implementation. The site uses original assets and React components, with cream/slate themes, Chinese/English interface, mobile navigation and source sheets. Generated design boards remain references only.

## Delivered implementation

- Next.js web app: home, streaming chat, source drawer, searchable original-text library, reading, settings and corpus status. Local IndexedDB conversations preserve edited branches and snapshot identity. The API key stays in page memory; refreshing clears it.
- Source language is independent from interface/answer language. Original quotations keep their language; model translations must be identified as unofficial translations.
- Agent: required initial retrieval, bounded read-only tool rounds, cumulative citations, cancellation, explicit errors and two separate payer modes. Default BYOK never silently falls back to the optional shared key.
- Internal Python service: versioned documents/chunks, lexical/entity retrieval, optional local E5 vectors, exact source spans and transactionally reserved global shared budgets. Unknown-context text is marked in the source UI and model instructions.
- Docker/Compose, runtime-only secrets, TLS/SSE proxy example, CI and source update/activation/rollback/backup/restore commands. Semantic dependencies are an explicit optional image build; default lexical operation does not download Torch or model weights.

## Source coverage and provenance

Primary commit: `DimbreathBot/AnimeGameData@792978e5503ecfba73dcb3562ed44a0d35a2abe2`; supplementary commit: `theBowja/genshin-db@49a6544a6c6ae36089cb42fa591fc46f01de8bcf`.

Final normalized snapshot `agd-792978e5503e-1ac83cf28961` contains **1,548,672 localized documents**. This count is not a count of unique in-game entities. It includes **360,206** otherwise unlinked TextMap entries, explicitly labelled `contextUnknown`, `schemaState=unmapped` and unknown release/test status. No speaker, task or chronology is invented for these texts.

The primary target inventory is completely acquired: 2,234 Excel tables, 55,891 Talk files, 28,785 Readable files across available locales, 4,779 Subtitle files, and complete CHS/EN standard/Medium TextMaps. The first index covers Chinese and English. The supplementary inventory deliberately covers five of thirty categories (weapons, artifacts, characters, voiceovers and materials), 2,944 files; it is not presented as a full supplementary clone.

The final audit matched **1,677,433 quoted spans**, **1,691,908 contextual pointers** and **3,953** complete physical Readable documents to actual source fields/lines. Multi-file books were split into related physical parts; composite entity descriptions keep per-field TextMap provenance. Of the 1,188,466 pre-orphan records, 1,188,313 remain hash-identical; 153 conventional dialogue records received a checked locator-only correction before the service was exposed. Text, quotation spans, relations and chunk identities were unchanged. The final normalized corpus SHA-256 is `ec83ef7273b4a4875048940ec42f1095963ea0399777a7e5b6d616c9dbc0b33c`; the explicitly chosen snapshot ID above is retained and is not a claim about this final hash.

Remaining upstream/parser gaps are explicit: 721,796 unresolved hash occurrences (not unique missing documents), 64 unjoined Readable title mappings, opaque dialogue containers and unresolved graph edges. Exact category counts and reasons are in the generated coverage/report files and the live corpus-status endpoint. See [source reproduction instructions](../../../sources/README.md).

## Verification boundaries

Tests and browser scenarios use explicitly identified fixtures where needed. They are separate from the full-corpus import, source audit and retrieval benchmark. The frozen benchmark contains 84 manually authored natural questions, 16 title lookups and 8 negative diagnostics; negative lexical hits are not misreported as answer/refusal accuracy. See [evaluation method](../../../eval/README.md).

A temporary native PostgreSQL 17.10 / pgvector 0.8.1 instance has executed real schema/import/search/source-read tests plus quota races, settlement persistence and failed-import rollback. This is synthetic functional evidence, not full-corpus PostgreSQL throughput or Docker deployment proof.

No real DeepSeek credential was supplied. Controlled-provider streaming tests can validate the HTTP pipeline but cannot establish actual model answer quality or billing. Optional semantic model weights/indexes, Docker runtime, production TLS, remote GitHub CI and backup/restore deployment drills remain separately verifiable operations. No public site has been deployed.

## Runtime and measured results

The full SQLite import completed and the snapshot is active: **1,548,672 documents / 1,688,671 chunks**. The import took 3,287.365 seconds (54.8 minutes), with peak process RSS 249,004,032 bytes; the indexed database occupies approximately 18 GB. These measurements describe this local import, not production PostgreSQL sizing or throughput.

Real-corpus browser checks passed at widths 360, 390, 768 and 1440 with no horizontal overflow or page errors. The reading page rendered the full physical text of `Readable/CHS/Book1.txt`; an unmapped TextMap source displayed its unknown-context warning. Actual screenshots are in [docs/screenshots](../../screenshots).

The controlled HTTPS provider smoke exercised real corpus retrieval, a read-source tool round, cited browser SSE, original Chinese quotations with English answer instructions, source proxy identity, masked provider errors and upstream cancellation. No paid generation was performed. Detailed final verification and retrieval results are in [the validation record](../../validation/2026-10-28.md).
