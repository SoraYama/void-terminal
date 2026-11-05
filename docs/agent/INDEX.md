> **Last updated**: 2026-11-05 (Character Archive; approved navigation and elemental identity refinement)

# Agent Notes

## Research

| Note | Summary |
| --- | --- |
| [2026-11-05-navigation-names-icons](research/2026-11-05-navigation-names-icons.md) | 原文库更名候选、9 个原版 UI PNG 哈希核验与对比稿；用户后续选定尘世文卷及首选图标，实施见 feature |
| [2026-11-05-characters](research/2026-11-05-characters.md) | 实施前审计与用户确认的群星图鉴游戏菜单式方案；后续实现见 feature 记录 |
| [2026-11-03-data-audit](research/2026-11-03-data-audit.md) | AnimeGameData main ahead by 2 commits; genshin-db pin current but five-category import omits image/stats/curve; production SQLite item coverage, quest missing descriptions, unexpanded weapon templates and absent inventory UI |
| [2026-11-02-cloud-cost](research/2026-11-02-cloud-cost.md) | Azure B1ms + disk/IPv4 ~$28.31; OVH FR monthly ~€4.84 with mandatory backup; Hetzner CX23 €5.99 including IPv4; Vultr $10; SQLite 16.736 GiB and missing small-server Compose |
| [2026-10-28-void-terminal-plan](research/2026-10-28-void-terminal-plan.md) | 原神百科 Agent：数据/RAG/deepseek-flash/双 Key；已选星海旅志 C 与 Docker，总体方案获同意；强视觉诉求要求高保真页面稿先于编码 |

## Features

| Note | Summary |
| --- | --- |
| [2026-11-05-navigation-elements](feature/2026-11-05-navigation-elements.md) | 尘世文卷 / Teyvat Archive、书籍/背包/角色图鉴原版导航图标、七元素符号与头像条下方角色身份区 |
| [2026-11-05-character-archive](feature/2026-11-05-character-archive.md) | 群星图鉴：角色聚合、原图/四语原声、快照 API、游戏菜单 UI；真实本地 169 个源 ID、134 个正式来源记录，媒体覆盖与发布边界单独记录 |
| [2026-11-05-compendium-rename](feature/2026-11-05-compendium-rename.md) | 万象集录 / Compendium replaces the item museum display name; navigation/title/ARIA/E2E, complete Noto Serif SC 600 heading subset, stable /museum links and web-only release |
| [2026-11-04-catalog-refresh](feature/2026-11-04-catalog-refresh.md) | 生产服务器固定两源提交、验证官方树与完整性、只读快照切换、失败恢复；首次接入与定时器验收证据位置 |
| [2026-11-03-item-museum](feature/2026-11-03-item-museum.md) | Published game inventory museum at 94d9881 / snapshot9f534ea4c12d; 13,825 source IDs, 22,984 localized verified images; Python130/Web268, public API/SSE and 13 real desktop/mobile checks passed; old SQLite/citations retained |
| [2026-11-03-favicon](feature/2026-11-03-favicon.md) | Next.js icon.svg, 16/32/48px favicon.ico and opaque 180px apple-icon.png; simplified existing leaf emblem, reproducible sharp encoder and browser metadata/hash verification |
| [2026-11-02-public-deploy](feature/2026-11-02-public-deploy.md) | Vultr SSH alias, Namecheap subdomain, Caddy HTTPS, private services, SQLite full snapshot and official PyPI lock URLs; runtime verification boundaries |
| [2026-10-28-void-terminal](feature/2026-10-28-void-terminal.md) | 经批准的须弥视觉站点、流式 Agent、真实全量来源、双 Key、快照与 Docker；实施与验证边界 |
| [2026-10-28-knowledge-service](feature/2026-10-28-knowledge-service.md) | 知识库、快照、中文检索、引用定位和共享额度事务；记录本地与生产验证边界 |
| [2026-10-29-model-provider](feature/2026-10-29-model-provider.md) | Settings Base URL/model, BYOK-only overrides, pinned public DNS transport, shared-key isolation, memory-only Key, stale test protection and Caddy runtime-log filtering |

## Bug Fixes

| Note | Summary |
| --- | --- |
| [2026-11-05-sidebar-history](bugfix/2026-11-05-sidebar-history.md) | 第四个导航入口导致手机历史列表 flex 压缩为 0px；保留 88px 可点击空间，由侧栏外层滚动 |
| [2026-11-03-scroll-anchor](bugfix/2026-11-03-scroll-anchor.md) | use-conversation-scroll derives button visibility from paused follow and absolute tail distance: separate downward answer geometry from follow intent; hide at bottom/visible tail/references, refresh on streaming and resize |
| [2026-11-02-postgres-prefix](bugfix/2026-11-02-postgres-prefix.md) | PostgreSQL en_US.utf8 Nahi misses Nahida: prefix+U+FFFF collation bound is invalid; escaped LIKE + text_pattern_ops index, live 87-test suite and 20k-posting query-plan regression |
| [2026-11-02-chat-failures](bugfix/2026-11-02-chat-failures.md) | Empty failed assistants cause INVALID_REQUEST: normalize history; metadata/tool context exceeds 128KB: compact and synthesize within budget; preserve normalized chapter/node/part metadata and export error codes; 222 unit / 38 browser tests |
| [2026-10-28-chat-errors](bugfix/2026-10-28-chat-errors.md) | terminal.tsx duplicates HTTP/SSE failures in message and composer; retain errorCode, localize at render time and restore old history in one bottom alert |
| [2026-10-29-depth-toggle](bugfix/2026-10-29-depth-toggle.md) | `.depth:hover,.depth.chosen` share colors: use aria-pressed filled blue/check icon so enabled state persists after hover |

## Optimizations

| Note | Summary |
| --- | --- |
| [2026-11-03-sidebar-motion](optimize/2026-11-03-sidebar-motion.md) | Sidebar bottom status/toggle row, restored 145px v4 wordmark with English/Chinese line gap; reversible 280ms width/footer motion, mobile drawer/backdrop exit and reduced-motion checks |
| [2026-11-03-library-ui](optimize/2026-11-03-library-ui.md) | library-workspace full-height reader and compact header; global native thumb fade including Radix portals; persistent 76px sidebar rail, mobile drawer and short-screen selected-passage actions |
| [2026-11-02-chat-reading](optimize/2026-11-02-chat-reading.md) | Streaming follows answer-tail instead of citation tags; full-height scenery/title scroll, Motion compact header, dark/mobile composer; public real DeepSeek 41k-history and failed-placeholder follow-ups |
| [2026-11-02-dsh-runtime](optimize/2026-11-02-dsh-runtime.md) | Official DSH loop/session/pi-ai/compaction, request-scoped Key isolation, five-call cap, Zod override and standalone packaging; 239 unit regressions |
| [2026-10-28-lore-answers](optimize/2026-10-28-lore-answers.md) | agent.ts / lore-policy.ts: mechanical gap-heavy answers, alias and typed retrieval, exact document discovery, context headroom, research/answer separation and citation compatibility |
| [2026-10-29-reading-story](optimize/2026-10-29-reading-story.md) | agent.ts outline skips turning-point research; library TextMap body becomes huge title: narrative paragraphs, display-only title/excerpt cleanup, exact raw-text switch, separate book/chat filters and tablet layout |
| [2026-10-29-dropdowns](optimize/2026-10-29-dropdowns.md) | Native select popup ignores theme: themed-select.tsx uses shared Radix Select with theme tokens, keyboard/touch, collision handling and settings portals |

## Misc
