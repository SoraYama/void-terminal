> **Last updated**: 2026-10-29 (custom BYOK model endpoints, privacy boundaries and single-server deployment)

# Agent Notes

## Research

| Note | Summary |
| --- | --- |
| [2026-10-28-void-terminal-plan](research/2026-10-28-void-terminal-plan.md) | 原神百科 Agent：数据/RAG/deepseek-flash/双 Key；已选星海旅志 C 与 Docker，总体方案获同意；强视觉诉求要求高保真页面稿先于编码 |

## Features

| Note | Summary |
| --- | --- |
| [2026-10-28-void-terminal](feature/2026-10-28-void-terminal.md) | 经批准的须弥视觉站点、流式 Agent、真实全量来源、双 Key、快照与 Docker；实施与验证边界 |
| [2026-10-28-knowledge-service](feature/2026-10-28-knowledge-service.md) | 知识库、快照、中文检索、引用定位和共享额度事务；记录本地与生产验证边界 |
| [2026-10-29-model-provider](feature/2026-10-29-model-provider.md) | Settings Base URL/model, BYOK-only overrides, pinned public DNS transport, shared-key isolation, memory-only Key, stale test protection and Caddy runtime-log filtering |

## Bug Fixes

| Note | Summary |
| --- | --- |
| [2026-10-28-chat-errors](bugfix/2026-10-28-chat-errors.md) | terminal.tsx duplicates HTTP/SSE failures in message and composer; retain errorCode, localize at render time and restore old history in one bottom alert |
| [2026-10-29-depth-toggle](bugfix/2026-10-29-depth-toggle.md) | `.depth:hover,.depth.chosen` share colors: use aria-pressed filled blue/check icon so enabled state persists after hover |

## Optimizations

| Note | Summary |
| --- | --- |
| [2026-10-28-lore-answers](optimize/2026-10-28-lore-answers.md) | agent.ts / lore-policy.ts: mechanical gap-heavy answers, alias and typed retrieval, exact document discovery, context headroom, research/answer separation and citation compatibility |
| [2026-10-29-reading-story](optimize/2026-10-29-reading-story.md) | agent.ts outline skips turning-point research; library TextMap body becomes huge title: narrative paragraphs, display-only title/excerpt cleanup, exact raw-text switch, separate book/chat filters and tablet layout |
| [2026-10-29-dropdowns](optimize/2026-10-29-dropdowns.md) | Native select popup ignores theme: themed-select.tsx uses shared Radix Select with theme tokens, keyboard/touch, collision handling and settings portals |

## Misc
