# Character Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The user approved the design and explicitly requested direct implementation; no further plan approval is needed.

**Goal:** Build 群星图鉴 / Character Archive with original portraits, game-style attributes, talents, constellations, stories, playable voiceovers and cultivation links.

**Architecture:** Build a snapshot-bound character catalog from exact game IDs and verified media. Persist it alongside documents/items, expose authenticated service endpoints and Next.js proxies, then render a dedicated game-style character workspace in the existing shell.

**Tech Stack:** Python, SQLite/PostgreSQL, FastAPI, Next.js 16, React, TypeScript, existing CSS tokens, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-character-archive-design.md` (approved).

## Global Constraints

- Visible module name: 群星图鉴 / Character Archive; route `/characters`.
- Original verified images and original playable audio only; unknown fields remain missing.
- Stable Avatar IDs and explicit form/skill-depot identity; no name-based fuzzy joins.
- Character, item and document links remain bound to one immutable snapshotId.
- Do not mutate production, refresh schedules, existing raw data or historical citations during implementation.
- Preserve existing bilingual shell, themes, source reading, and unsent question drafts.
- All project text edits use apply_patch. Workers do not revert others' edits or dispatch subagents.

## Review Focus

- Traveler form changes must never leak skills/constellations from another depot (Task 1).
- Incomplete curves/opaque skill fields must not emit invented zero values or complete coverage (Task 1).
- Old read-only archives with no character tables return unbuilt state without schema writes (Task 2).
- Rapid character/locale/snapshot switches must not display stale details or continue old audio (Task 3).
- Media errors, long story text, mobile back navigation and deep links must remain usable (Tasks 3–4).

### Task 1: Character aggregation and canonical contract

**Ownership:** Create `services/knowledge/knowledge/characters/{__init__,build,stats}.py`, focused tests `services/knowledge/tests/test_characters.py`, and `docs/characters-contract.md`. Do not edit storage, source acquisition, CLI, frontend or media verifier.

**Interfaces:** `build_characters(root, supplementary=None, *, main_commit, supplement_commit) -> (list[dict], dict)`; `character_summary(character) -> dict`; `coverage_report(characters) -> dict`. Localized record identity is `id='avatar:<numeric id>'`, `language='zh-CN'|'en'`. Required summary: id, avatarId, language, name, title, description, rarity, element, elementName, weaponType, weaponName, region, state, icon. Media object: identifier, url (nullable), provider, status (`verified|unverified|missing|unreachable`), optional sha256. Detail includes portrait, birthday, affiliation, constellationName, cv, sources, documentIds, forms, stories, voices, ascensions, coverage. Form includes id (string depot ID), name, element, levels (level, ascension, stats), talents, constellations; exact nested contract must be documented before handoff. Voices include id, title, text, category, conditions, resource, audio map keyed by zh-CN/en/ja/ko. No unverified candidate URL becomes playable.

- [x] Write tests for source-backed level 1/max/ascension boundaries, skill/depot joins, numeric formatting, six real constellation nodes, story ordering/conditions, traveler forms, missing fields and stable bilingual identity.
- [x] Run focused tests and confirm missing-feature failure.
- [x] Implement primary-table aggregation, targeted TextMap reads, strict finite numerical calculations, support exact supplementary metadata fallback, original document links and coverage. Candidate icons use source identifiers; verification is separate.
- [x] Run focused and existing item/ingest regression tests; document resulting contract and actual representative local data output.

### Task 2: Verified media, persistence and snapshot integration

**Ownership:** `characters/media.py`, `characters/store.py`, service models/app/store, SQLite/PostgreSQL migrations, ingest CLI/source_plan, refresh validation and focused tests. Coordinator handles media-source reconnaissance before handing off.

**Interfaces:** `verify_character_media(characters, cache, workers=8) -> list[dict]`; store `list_characters`, `get_character`, `character_coverage`; `/v1/characters`, `/v1/characters/coverage`, `/v1/characters/{id}`. Query fields: q, language, element, weaponType, rarity, region, includeInternal, sort, page, pageSize, snapshotId. Detail query: language/snapshotId. Response envelopes mirror item APIs, using characters/character instead of items/item.

- [x] Verify real source portrait and audio sample bytes, exact identity mapping, browser format, source versions and bounded loading; no whole game download.
- [x] Write failure tests for invalid media, query validation, duplicate identity, old read-only snapshot fallback, character corpus hashing, atomic rollback and current/history routing.
- [x] Add catalog tables and atomic import; bind characters/coverage/media manifests to corpus hash and candidate validation. Preserve snapshots without characters.
- [x] Expand acquisition with audited fixed-commit files where needed; update markers without pretending old five-category imports contain new scope.
- [x] Run service/pipeline tests; build a real local character dataset and catalog with all source records and measured coverage.

### Task 3: Game-style frontend

**Ownership:** `apps/web/src/lib/characters.ts`, `lib/server/character-validation.ts`, `app/api/characters/**`, `app/characters/page.tsx`, `components/characters/**`, terminal shell integration, focused Web tests. Read `apps/web/AGENTS.md` and installed Next.js guides before editing.

**Interfaces:** Use Task 1 contract and Task 2 endpoint envelopes. `CharacterWorkspace({locale,language,onOpenDocument,onAsk})`. `onAsk` receives character identity and snapshot; prepare unsent draft as existing item behavior does. Material links go to `/museum` at same snapshot.

- [x] Write unit tests for query/deep-link validation, media URL allowlist, level selection and voice locale; run to missing-feature failure.
- [x] Implement validated proxy routes and catalog contracts.
- [x] Implement searchable/filterable portrait grid, detail avatar strip, left menu, central original art, right stats, constellation nodes, talent levels, biography/story/voice tabs and material links.
- [x] Implement one-at-a-time audio with explicit loading/error states and stop on character/tab/locale/unmount, cancelled stale fetches, back/forward URL state, mobile composition, themes, keyboard and reduced-motion.
- [x] Typecheck, Web unit tests, production build and focused browser tests.

### Task 4: Real-data browser validation and review

**Ownership:** Character E2E scenarios, validation artifacts and docs/agent note/index; repair scoped findings in owning modules.

- [x] Start local knowledge and web services against the real local catalog, without invoking a paid model.
- [x] Inspect desktop/mobile, light/dark, portrait switching, talent numbers, constellation descriptions, stories, actual audio playback, deep-link/back restoration, network failures and old-snapshot behavior.
- [x] Run relevant full Python/Web suites and build; retain screenshots and measured coverage.
- [x] Fresh code/spec review and fresh visual review with captured evidence; resolve material findings.
- [x] Update PRODUCT.md, source notices, operations instructions, spec status and docs/agent. Report local completion and any measured upstream gaps separately from production publication.

## Execution Record

- Ruling: user explicitly approved the design and requested direct implementation; proceed without another plan confirmation.
- Ruling: work on `codex/character-archive` in the current checkout to reuse the sizeable existing raw corpus and installed dependencies; no main-branch mutation or production operations.

- Completed locally: Tasks 1–4. Evidence: docs/agent/feature/2026-11-05-character-archive.md and .superpowers/sdd/2026-11-05-character-archive/task-4-report.md. Production publication remains outside this implementation run.
