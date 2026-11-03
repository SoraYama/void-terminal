# Item Museum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Publish the latest verified corpus and a game-style item museum with source-backed equipment numbers, descriptions and images.

**Architecture:** Keep the existing Next.js/Python catalog. Build deduplicated localized item JSONL alongside the document corpus, import both in one snapshot transaction, and serve paginated item summaries plus structured details through the existing private-service proxy. Preserve the previous snapshot in the release database.

**Tech Stack:** Next.js 16.4.3, React 19.3.1, existing Radix/Phosphor/CSS, Python 3.11, FastAPI, SQLite/PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-03-item-museum-design.md` (approved by user).

## Global Constraints

- 沿用 Next.js + Python + SQLite/PostgreSQL，不引入新的外部付费服务。
- 物品与文献分开建模，统一绑定不可变 snapshotId。
- 不把数据仓库配置条数称为玩家可获得道具总数。
- 图片是有出处的原始资源，不使用生成图充当真实道具图片。
- 第一版不提供推测的地区或游戏版本筛选。
- 明确标记的测试、废弃、占位记录默认隐藏。
- 保留现有须弥背景、品牌、日夜主题和侧栏行为。
- All source/text edits use apply_patch; raw data, generated artifacts and local catalogs stay ignored.

## Review Focus

- Old-snapshot deep links must remain readable after promotion; items never come from a different active snapshot.
- At promotion boundaries, the same weapon level can have two correct stat sets; UI must preserve the ascension choice.
- Artifact source level 21 means UI +20; slot main-stat pools and single-piece sets must remain valid.
- Missing and blocked image URLs must not become arbitrary server fetches or broken-image layout; remote image hosts are explicitly allowed.
- Filter changes and rapid detail selection must reject stale responses, retain shareable URLs, and work with mobile Back/Escape.

## Shared item contract

All items have `id` (language-independent stable string, e.g. `weapon:13501`, `artifact:15001:flower`, `material:100003`, `furniture:369101`), `language`, `name`, `category` (`weapon|artifact|material|food|quest|gadget|other`), `subtype` (readable type), `rarity` (1–5 or null), `description`, `story`, `state` (`source-record|internal`), `rawIds` (strings), `documentIds`, `sources` (existing Provenance shape), `icon` (`{identifier,url:string|null,provider,status:verified|unverified|missing|unreachable}`), `attributes` (`{label,value:string}[]`), `acquisition` (string[]), `coverage` (field -> `complete|not-applicable|upstream-missing|unresolved|unreachable`). Optional equipment fields:

- `weapon: {type:string,levels:{level:number,ascension:number,stats:Stat[]}[],refinements:{rank:number,name:string,description:string}[],ascensions:{phase:number,levelCap:number,coin:number,items:{id:string,name:string,count:number}[]}[]}`.
- `artifact: {setId:number,setName:string,slot:string,setEffects:{pieces:number,text:string}[],rarities:number[],rules:{rarity:number,maxLevel:number,mainStats:{key:string,label:string,unit:string,values:{level:number,value:number}[]}[],substats:{key:string,label:string,unit:string,values:number[]}[]}[]}`.
- `Stat = {key:string,label:string,value:number,unit:string}`; percentage values are display percentages (66.1536), unit `%`, not raw fractions. Flat numbers use empty unit. Keep full precision; format only at display.
- Stories and descriptions are plain text, never render source HTML directly. Provenance is retained for derived values and every contributing table.

List response: `{items:ItemSummary[],total,page,pageSize,snapshotId,ready,counts:Record<string,number>}`. ItemSummary retains only id/language/name/category/subtype/rarity/description/icon/state. Detail response: `{item:Item,snapshotId}`. Coverage response: `{snapshotId,ready,coverage:object}`. No-ready legacy items return an empty ready:false list, never silently use another snapshot.

## Task 1: Latest source acquisition and structured item build

**Files:** Own `sources/manifest.json`, `services/knowledge/knowledge/ingest/{acquire.py,normalize.py,__main__.py,supplement-core-files.json}`, new `services/knowledge/knowledge/items/` modules, and ingest/item tests. Do not edit store/app/frontend.

**Interfaces:** Produce `items.jsonl` and `item-coverage.json` next to the existing normalized output. `build_items(root:Path,supplementary:Path|None) -> tuple[list[dict],dict]` implements the shared contract for CHS+EN. `verify_images(items:list[dict],cache_path:Path,workers:int=12) -> list[dict]` verifies and returns updated records with a persistent check cache. CLI normalize hashes documents and items into snapshot identity. CLI `verify-images --normalized PATH --cache PATH --workers N` updates unpublished item output, coverage and snapshot digest. Extend do_import to pass items and item_coverage to CatalogStore.import_snapshot using the optional kwargs Task 2 defines; defer store import execution until Task 2 is merged.

- [x] Write failing representative tests: Homa 1/20-before/20-after/90 stats; no placeholder refinements; newest weapon survives older supplement; artifact +0/+20 and slot pools; single-piece set; task item missing description remains explicit; internal records hidden by state; dedup by physical artifact slot; image check cache and failed PNG response.
- [x] Run targeted tests and confirm missing behavior fails.
- [x] Update all main pins to `bd35e243fa436f141f015cf221a6e19d0c34b7ca`, tree `216b990b921ca71e3ffac08a270747f1f403600f`; use verified TextMap hashes in the feature note. Keep supplemental commit. Extend repeatable acquisition with verified image/stat/curve support (at least the eight already downloaded files) without claiming all 30 categories. Add bounded network retries for observed read timeouts.
- [x] Build typed items from primary numerical tables, join supplement by source IDs, use current main values over old supplement. Resolve primary descriptions/effects, linked Readable stories and material uses/recipes where source relationships are known; mark unresolved rather than guess. Use latest real icon IDs and verified official/Yatta resources. No AI-generated item images.
- [x] Preserve document normalization/citation source spans; expand supplementary weapon effect templates. Put a bounded structured `itemSummary` in equipment/material document metadata for Task 2's model allowlist. Never add massive growth arrays to model metadata.
- [x] Keep missing ID lists and field applicability in coverage. Image verification must GET a bounded PNG/WebP/JPEG header after HEAD and check actual dimensions/type, allow only fixed HTTPS providers, distinguish temporary failures, and never request URLs from browser input.
- [x] Run the knowledge test suite, self-review and commit only owned files. Report test evidence and numerical source decisions.

## Task 2: Atomic item catalog, API and research integration

**Files:** Own `services/knowledge/knowledge/{store.py,app.py,models.py}`, new store/API tests, `apps/web/src/app/api/items/` routes, `apps/web/src/lib/server/{item-validation.ts,research.ts}`, new proxy tests. Do not edit Task 1 modules or UI components.

**Interfaces:** Extend `CatalogStore.import_snapshot(...,activate=True,items=None,item_coverage=None)` without breaking legacy calls. Add `list_items(q='',category=None,language='zh-CN',rarity=None,weapon_type=None,include_internal=False,sort='rarity',page=1,page_size=48,snapshot_id=None)`, `get_item(id,language='zh-CN',snapshot_id=None)`, `item_coverage(snapshot_id=None)`. Add authenticated GET `/v1/items`, `/v1/items/coverage`, `/v1/items/{id:path}`. Web proxies are `/api/items`, `/api/items/coverage`, `/api/items/{id}`. Query names: `q,category,language,rarity,weaponType,includeInternal,sort,page,pageSize,snapshotId`; only language/snapshotId apply to detail. Existing source language enum and error envelopes apply.

- [x] Write and run failing tests for atomic rollback on bad items, old snapshot without items, pinned reads after active pointer changes, literal %/_ search, page bounds, internal filter, valid stats, unauthorized API, duplicate/unknown proxy params.
- [x] Add indexed item and item-coverage tables keyed by snapshot/language/id. Validate incoming items and prevent cross-snapshot references; attach items inside the existing snapshot transaction. Paginate/filter in SQL; summaries exclude growth/story payloads.
- [x] Implement private API plus bounded validating server proxies; do not expose internal credentials or create a server image proxy. Add bounded itemSummary handling to research modelMetadata.
- [x] Run Python suite, frontend relevant proxy/unit suite and typecheck; self-review and commit owned files.

## Task 3: Game inventory interface

**Files:** Own new `apps/web/src/components/museum/` modules, new `apps/web/src/lib/items.ts`, `/app/museum/page.tsx`, museum CSS, integration in `terminal.tsx`/globals and browser tests. Create `PRODUCT.md` from confirmed existing product context. Read `apps/web/AGENTS.md` and relevant installed Next docs before writing.

**Interfaces:** Consume the shared contract and Task 2 APIs. `/museum` loads Terminal with museum view so the exact existing sidebar, preferences, settings, source drawer and history remain available. Add sidebar museum entry and URL-aware navigation without losing drafts. `MuseumWorkspace` receives locale, onOpenDocument(id,snapshotId), onAsk(itemName,itemId,snapshotId) and uses source-language preferences. Query params encode filters and selected `item`; request snapshots remain consistent. Define typed Item/ItemSummary/ItemListResult/ItemResult in lib/items.ts.

- [x] Add failing browser scenarios for entering museum, filtering, weapon boundary and refinement selection, artifact rules, quest item, mobile detail Back/Escape, stale response, image fallback and dark mode.
- [x] Implement paper/slate/gold game-like layout matching approved `docs/design/item-museum-concept.png` while using real item assets. Desktop independently scrolling grid/details; compact no-marketing header; responsive cards and type categories. Default weapon category and real first selection; no fake ownership counts.
- [x] Render type-specific details with legal weapon level/ascension/refinement options, stage and cumulative ascension cost labels, artifact rarity/level/slot pools and possible substat rolls, generic uses, story/source and original document links. Hide inapplicable tabs, show truthful missing states.
- [x] Implement server pagination, search debounce, abort and request identity guards, URL deep links and mobile modal with focus restoration. Reuse existing Radix controls, no new dependency.
- [x] Typecheck, unit suite and browser tests. Visually inspect screenshots at 1440/390 and dark mode, correct hierarchy/spacing/overflow, self-review and commit owned files.

## Task 4: Build, release and evidence (controller operations)

**Files:** Update `docs/agent/feature/2026-11-03-item-museum.md`, INDEX, a repeatable data-update operations guide and release evidence under ignored artifacts. No production write until local verification passes.

- [x] Verify baseline archive and unpack a consistent old SQLite catalog; retain old snapshot for citations. Use old catalog only as an offline build base.
- [x] Normalize the latest complete main plus declared supplement scope, verify all item images into cache, finalize immutable ID/coverage and import into offline DB without activating until all checks pass. Record exact gaps, never claim all game records complete.
- [x] Run full relevant tests and fresh-context branch review; resolve material findings. Build web/knowledge images; exercise local real corpus, document search, item endpoints and browser screenshots.
- [x] Transfer verified compressed SQLite to staging on production. Before replacing, stop services, back up current SQLite including WAL safely, preserve budget state, confirm new database ownership/mode and promote staged ready snapshot. Use compose.sqlite.yaml, never the PostgreSQL default update script.
- [x] Verify public status/latest commit, item list/details and images, representative weapon/artifact/material/quest records, old snapshot references and SSE flow; revert code/database if failed. Save release evidence and exact future update/rollback commands.
- [x] Mark the agent note with actual deployment state and remaining upstream gaps; report shipped URL, coverage and verification.
