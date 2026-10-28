# void-terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Genshin encyclopedia Agent with authentic visual assets, traceable real-source retrieval, streaming DeepSeek chat, and reproducible Docker deployment.

**Architecture:** Next.js owns the browser and streaming Agent API; a Python knowledge service owns normalized source documents, retrieval and ingestion. PostgreSQL/pgvector is production storage. A clearly identified SQLite local-development adapter allows this host (no Docker/PostgreSQL installed) to run the same source and search APIs; it is not evidence of production database verification.

**Tech Stack:** Next.js 16.4.3, React 19.3.1, TypeScript, native semantic CSS, Radix accessible primitives and Phosphor icons; Python 3.11+, FastAPI, psycopg, jieba, optional sentence-transformers; PostgreSQL 17 + pgvector; Playwright.

**Spec:** ../specs/2026-10-28-void-terminal-design.md. Approved visual references: ../../design/genshin-v2/README.md. Shared interfaces: ./2026-10-28-contracts.md.

## Global Constraints

- User approved v2 and explicitly asked to continue implementation; no further design approval required.
- Use original official scene/logo assets, not full-page generated screenshots; no generic western castle art.
- UI zh-CN/en, light/dark/system, mobile from 360px, source drawers, actual streaming and cancellation.
- Default BYOK, optional explicitly selected server shared quota. Never persist, log, export, trace or embed model keys; never silently switch payment mode.
- DeepSeek model ID deepseek-flash, upstream base fixed to https://api.deepseek.com by default; deployment-controlled overrides only.
- All claims about corpus coverage must derive from real import counts and report gaps; fixtures/samples never masquerade as complete data.
- Preserve provenance, dialogue branches/conditions, immutable snapshot references and missing translation states.
- No production deployment without a supplied target; provide and verify the deliverable locally as far as available tools permit, report external verification limits.
- Tasks have non-overlapping file ownership; workers do not modify others' files, revert concurrent work, or commit independently. Root integrates.

## Review Focus

1. Multi-line/split UTF-8 SSE events, disconnects and stops: no lost tokens, no continued unbounded upstream work.
2. Malformed or hostile imported text: sanitization and prompt boundaries, stable citations, no HTML/script execution.
3. Same-name entities, mixed languages, missing TextMaps and branching dialogue: preserve IDs/context and expose gaps.
4. Shared quota races and BYOK errors: transactional reservations, no silent payer switch or key exposure.
5. Local persisted conversations from an older snapshot: sources remain resolvable and edits preserve branches.

## Task 1: Source acquisition and normalization

**Ownership:** services/knowledge/knowledge/ingest/**, services/knowledge/tests/test_ingest*.py, source manifests under sources/, ingestion/coverage documentation, eval/source fixtures. Do not modify database/API/package files.

**Interfaces:** produce normalized JSONL and Snapshot/Coverage dictionaries specified in contracts; call CatalogStore.import_snapshot(snapshot, documents, coverage, activate=True) if importing directly. CLI: python -m knowledge.ingest --help, fetch, normalize, import, update subcommands; local input and pinned remote checkout supported.

- [x] Write tests for CHS+EN TextMap shards; exact book title/body mapping; NPC speaker and branching edges; weapon/artifact lore; furniture; material classification; unresolved fields report.
- [x] Run tests to establish missing behavior, then implement source manifest, streaming/cached acquisition, normalizers and coverage accounting.
- [x] Include main/quest/dialogue, Readable books/documents, weapons/artifacts/furniture/materials, characters/voice and generic text-bearing table inventory. Preserve opaque structures rather than invent mappings.
- [x] Download real pinned sources to ignored data/ using public source URLs; run normalized import and report all actual counts and gaps. Full target-category processing must not be replaced by tiny samples.
- [x] Verify deterministic IDs, relation integrity, incrementality/deletion semantics and fixed-commit source links. Write report to artifacts/reports/ingestion.md.

## Task 2: Knowledge storage, retrieval and HTTP service

**Ownership:** services/knowledge/pyproject.toml, knowledge/{__init__,models,config,store,chunking,embeddings,retrieval,app}.py, migrations/, tests/test_{store,retrieval,api,chunking}*.py. Excludes ingest/.

**Interfaces:** CatalogStore(database_url=None), import_snapshot(snapshot:dict, documents:Iterable[dict], coverage:list[dict], activate:bool=True)->dict; status()->dict, search(query,language,types,snapshot_id,limit)->dict; list_documents(q,type,language,page,page_size,snapshot_id)->dict; read_source(id,snapshot_id)->dict; get_document(id,snapshot_id)->dict. HTTP contracts are authoritative.

- [x] Tests first: atomically promote validated snapshot; previous source remains readable; unavailable snapshot doesn't silently query newer data; Chinese exact/alias retrieval; language/type filters; context expansion respects edges; no-data readiness.
- [x] Implement PostgreSQL + pgvector schema and SQLite dev adapter with real persisted documents/chunks. Application-side Chinese tokenization, parameterized queries, RRF lexical/entity/vector merge.
- [x] Implement optional local multilingual-e5-small embedding provider, matching model revision/preprocessing at ingestion/query; clearly expose semantic unavailable state. No fake/random vectors.
- [x] FastAPI endpoints /v1/status,/v1/search,/v1/documents,/v1/documents/{id},/v1/sources/{id}; internal read-token auth if configured; request bounds and safe errors.
- [x] Provide persistent transactional shared-budget reserve/settle operations internally, or clearly coordinate with Task 3 if moved. Budget amounts use integer tokens, default maximum reservation, no memory-only multiworker budget.
- [x] Run pytest and report tested adapters, no-data states, model availability and limits in artifacts/reports/knowledge.md.

## Task 3: Streaming Agent and web API

**Ownership:** apps/web/src/app/api/**, apps/web/src/lib/server/**, apps/web/tests/{agent,sse,quota,api}*.test.ts. Shared src/lib/contracts.ts owned by root.

**Interfaces:** API and SSE contracts in contracts.md. Frontend consumes POST /api/chat, POST /api/models/test, GET /api/status and knowledge proxy routes. Model Key only X-Model-Api-Key request header. Built-in fetch streaming, no browser upstream direct calls.

- [x] Tests first for split SSE UTF-8/tool-call deltas; cancellation; invalid key; unknown source; bounded tool loop; request bounds; explicit payer selection and shared quota denial.
- [x] Force first retrieval, route model tool calls through bounded readonly functions, serialize immutable citation indices; preserve source/language/snapshot boundaries and distinguish missing evidence.
- [x] Stream status/sources/text_delta/done/error, stable source append semantics, heartbeat and no buffering. No exposed chain-of-thought or raw upstream error bodies/keys.
- [x] Implement shared mode via transactional knowledge budget API with trusted request identity; fixed or operator-allowlisted upstream, server-only key env, explicit shared enable switch.
- [x] Test connection via provider model listing; return masked non-sensitive outcomes. Add config/status and library/source proxies with timeouts.
- [x] Run targeted Vitest tests and report to artifacts/reports/agent.md. Real DeepSeek success testing requires user-entered key; do not invent evidence.

## Task 4: Visual frontend and browser workflows

**Ownership:** apps/web/src/app/{page,layout,globals}.*, apps/web/src/components/**, apps/web/src/lib/{i18n,preferences,history,client,stream}.*, frontend tests only, apps/web/public/**. Excludes api/,lib/server/,lib/contracts.ts and package configs.

**Interfaces:** Shared contracts and HTTP endpoints; no fake canned assistant answers in production. Root provides package.json/build config.

- [x] View all four approved v2 images and original source assets. Build semantic CSS tokens, original scene/logo assets, accessible sidebar/composer and responsive page shell.
- [x] Implement home, chat, sources, library filters/detail/reading, settings, corpus status; genuine loading/error/no-data states. No static screenshot as app.
- [x] Tests first for SSE parser split boundaries, local history branch edits, theme/i18n persistence without keys. Implement abort, regenerate, copy/export/delete, manual scroll respect, source opening and focus restoration.
- [x] Key only React memory; settings connection test, explicit shared mode and clearing. Persist preferences and IndexedDB conversations, never key. Source and UI language separated.
- [x] Keyboard, reduced motion, theme, soft-keyboard safe area, >=44px touch, citation source mapping and markdown sanitization.
- [x] Verify real browser desktop/mobile light/dark/en, record screenshots and scenario evidence under artifacts/screenshots/ and artifacts/live-ui/; report artifacts/reports/frontend.md.

## Task 5: Packaging, CI and operations

**Ownership:** compose.yaml, Dockerfiles, deploy/**, .github/**, scripts/{dev,backup,restore,update}*, README.md, .env.example, LICENSE, THIRD_PARTY_NOTICES.md. Root owns root package/config/.gitignore.

- [x] Docker web standalone + Python knowledge + PostgreSQL pgvector, ingestion as job/profile, volumes for source/model/db, read-only internal API/token, health checks.
- [x] Configure proxy SSE (buffer off), TLS operator settings, model key secret via runtime env not build arguments. Compose env defaults safe, shared disabled.
- [x] GitHub CI Python tests/TypeScript/build/browser checks; reproducible lockfiles and no automatic external production mutation.
- [x] Document first import, update/activate/rollback, backups/restores, local SQLite limitations, embedding costs, true data status and official art attribution.
- [x] Validate available tooling; explicitly report Docker runtime unavailable instead of claiming a successful Docker deployment.

## Task 6: Integration, eval and delivery (root)

- [x] Freeze contracts, create package/config and locks; integrate task outputs and resolve interface mismatches.
- [x] Run actual local ingestion, bootstrap service and site, demonstrate corpus search/source reading and runtime source-backed pipeline.
- [x] Build >=80 real-source eval cases with provenance and types, measure lexical/hybrid evidence recall if embedding available, record honest results rather than fabricated targets.
- [x] Browser actual scenarios for configuration, language/theme, library/search/source and streaming via controlled upstream test; no fixture presented as production service.
- [x] Independent code/security and visual fidelity reviews; resolve findings; run focused regression + production build.
- [x] Update docs/agent notes and ledger with counts, screenshots, tests, limitations and run commands. No production readiness claim based only on local or mocked checks.

## Execution rulings

- Work in this dedicated empty checkout on codex/void-terminal. There is no HEAD to branch a linked worktree from, and all existing untracked docs were created in this chat; no existing application changes to isolate.
- Parallel workers use explicit disjoint ownership, overriding the generic skill preference for sequential implementers in favor of the active collaboration instruction.
- Local SQLite is a development adapter only; production remains PostgreSQL+pgvector. Lack of Docker is recorded, not disguised.
- The user's approval authorizes implementation directly; do not add another plan approval gate.

## Delivery evidence and external gates

Implementation checklist above is complete within the local, source-backed and controlled-provider scope. See [validation record](../../validation/2026-10-28.md) for exact data, tests and limitations. The optional semantic provider is implemented but its real weights/full-corpus index were not prepared. Native PostgreSQL/pgvector functional checks passed; Docker is absent.

- [ ] User-supplied real DeepSeek credential: paid streaming generation, answer quality and account model access.
- [ ] Target server with Docker, domain and TLS: Compose startup, production routing and restore drill.
- [ ] Push reviewed source to GitHub and observe the first remote CI run.

These are explicit external validation gates, not results inferred from local tests.
