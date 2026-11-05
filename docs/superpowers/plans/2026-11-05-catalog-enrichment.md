# Catalog enrichment implementation plan

> Use supervised task implementation and review. Read the approved ETL design before working.

**Goal:** Add exact-ID Genius Invokation data and verified missing images to the existing two-source catalog; exercise the new ETL privately on the existing host before production publication.

**Architecture:** Independently pin and validate additive inputs. Merge only into existing item identities before SQLite import, and seal data, evidence and validation in an immutable candidate. The host keeps one writer and the existing atomic registry/recovery contract.

**Tech stack:** Python, SQLite, systemd, SquashFS, TypeScript.

**Spec:** The approved `void-terminal-etl-design.md` from this conversation.

## Constraints and tasks

- [x] TCG adapter in `knowledge/ingest/tcg.py` with exact raw material itemId → cardId/face mapping; acquire CHS/EN card directories at the pinned genshin-db commit via verified Git blobs; candidate only, no impact on acquisition of the existing required inputs. Tests for collisions, variants, locale, and existing text. Adapter returns coverage and adds separate card fields with provenance.
- [x] Image adapter in `knowledge/items/asset_fallback.py` with a pinned PathOfGenshin Git tree and exact original PNG stems; acquire a bounded set only for missing icons after standard checks. Validate full bytes and decoded image, record content SHA-256, use versioned exact link without rehosting. Test type/size/invalid PNG, priority, deduplication, cache and failures. Extend the frontend allowlist only for this exact pinned URL shape.
- [x] Integrate adapters in normalization/image verification/build, preserve existing search/item linkage and stable IDs, bind deterministic enriched output and inputs to the candidate; produce measured delta by language and category, failures, rejected regressions and actual assets used. Test same-pair update and optional failure.
- [x] Add isolated, non-public rehearsal using the host lock and resource limits; generate candidate/archive and disk samples without modifying production registry, timer or public routes. Test failure rollback in a separate registry while preserving real historical references. Reuse the exact candidate only after revalidating complete build and archive identity.
- [ ] Run relevant automated tests and review, then run the rehearsal on the original server. Confirm pinned inputs, real image counts, peak disk usage, current/history read-back, failure/recovery. Only after successful checks, deploy and verify the accepted candidate and timer.

Preflight: adapter files and tests are independent. The coordinator exclusively owns source-plan, normalize, build and host controller integration. TCG runs before indexing; image fallback runs after primary image checks before final corpus hashing. UI only accepts verified fixed-commit paths. No ambiguous candidate overwrites a primary field. A report-only run cannot write a production publication intent.
