> **Last updated**: 2026-10-28 (chat errors: one composer alert, runtime i18n and history compatibility)

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

## Bug Fixes

| Note | Summary |
| --- | --- |
| [2026-10-28-chat-errors](bugfix/2026-10-28-chat-errors.md) | terminal.tsx duplicates HTTP/SSE failures in message and composer; retain errorCode, localize at render time and restore old history in one bottom alert |

## Optimizations

| Note | Summary |
| --- | --- |
| [2026-10-28-lore-answers](optimize/2026-10-28-lore-answers.md) | agent.ts / lore-policy.ts: mechanical gap-heavy answers, alias and typed retrieval, exact document discovery, context headroom, research/answer separation and citation compatibility |

## Misc
