> **Date / Revised**: 2026-10-28

# Lore agent: explanation before corpus audits

## 1. Background & Problem

The user reported mechanical answers dominated by gaps. The actual open browser question was “请根据任务原文梳理须弥魔神任务的主要脉络。” Its original answer used reunion reward prerequisites and UI strings, then claimed the corpus lacked the plot. This was not evidence of actual corpus absence.

## 2. Root Cause / Approach

Read the requested reference `/Users/sorayama/projects/genshin-lore-rag` (README, DESIGN, lore/store.py, lore/cli.py) and `/Users/sorayama/.codex/skills/genshin-lore/SKILL.md`. That project is a local evidence retriever, not an answer-generating service. Its useful pattern is reviewed aliases, typed retrieval, explicit neighboring context, and “answer the supported portion first”. Its gap metadata belongs to evidence handling, not a mandatory answer template. Verified 18 character-story refs against source hashes and JSON pointers without changing that corpus.

Four live retrieval comparisons are retained in ignored `artifacts/reports/lore-preparation-before.json`. In particular, 魔女套 and 雷神/阿影 did not reliably retrieve their named subjects without alias expansion. The original agent also returned empty tool sources after its evidence budget filled, which could be mistaken for an empty corpus.

## 3. Key Changes

- `lore-policy.ts`: answer first, explain concepts and meaningful relationships, adapt depth, use short selective quotations, avoid fixed audit headings. Keep source-only factual grounding; scope related stories by quest/period and require evidence for causal bridges. Nickname mappings are search hints, not identity equivalence.
- `agent.ts`: inferred narrative filters exclude generic UI records; explicit user filters win. If inferred filters return zero results, retry inside the same pinned snapshot without that inferred filter. Admit at most 6 initial narrative sources / 8000 characters, then pre-read at most 2 mapped documents, at most 3 new sources / 3000 chars each. Retain headroom for focused research.
- `search_corpus` may narrow types without widening user scope. `find_documents` uses the existing knowledge endpoint **`/v1/documents`** for literal phrase discovery, up to 8 summaries; summaries are not citations. Register those IDs as leads for `read_document`. Multiple selected categories require one permitted type before pagination.
- Search/read responses distinguish omitted matches and clipped text from no matches. Carry per-query scope and per-read selection metadata into final synthesis.
- Tool-enabled round text is held until the round is known to be an answer; discard tool-round narration. The forced final call uses current evidence and original conversation without the tool transcript or definitions, avoiding raw tool syntax. The existing 5-provider-request maximum, billing accounting, aborts, snapshot/language/type validation, and evidence caps remain.
- `stream.ts` and server citation checking accept full-width numeric references as well as ASCII references; code and existing links remain untouched.

## 4. Validation & Limits

- Web unit tests: 121 passed, including aliases, automatic reads, snapshot rejection, filter boundaries, evidence headroom, clipped text, final metadata, tool narration suppression, exact document discovery and full-width citation links.
- Typecheck and production build passed; 20 desktop/mobile Playwright tests passed. The final regional routing is covered by unit tests and typecheck.
- Real HTTP exact lookup for 花神诞祭 with quest/zh-CN returned 9 matches, 8 on page 1, with matching snapshot/language/type. An exact 千朵玫瑰 phrase query within quest returned zero; do not turn this into a global absence claim.
- Live model sampling used the existing browser connection and the same Sumeru question. Intermediate samples exposed tool-protocol text, a bad discovery route, and overextended background/causality. These were treated as failures and led to the changes above. Automated mocks prove orchestration, not factual answer quality; do not claim a general model-quality benchmark from this sample.

## 5. Final synthesis follow-up

The original implementation disabled thinking for every call. Complex narrative questions and deep research now use a separate final synthesis within the same five-request cap even when research stops early. On the official DeepSeek origin, this tool-free final call enables thinking (low effort for standard narrative, high for deep). Other compatible providers retain disabled thinking. Reasoning deltas are ignored, never displayed, logged or replayed. This avoids the tool-enabled mode requirement to replay reasoning. Protocol was checked against [DeepSeek thinking mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/).

A real model also requested more than four tools at once. Parse at most 16 bounded call records but execute only four per response, returning a budget result for the rest so a valid oversized research batch does not abort the answer. The global request/evidence/token accounting limits remain.

## 6. Delivery self-check

| Axis | Score | Evidence and remaining improvement |
| --- | --- | --- |
| Accuracy | 4/5 | Source boundaries and protocol have regressions; a broad main-quest answer is a sample, not a factual benchmark. Keep human review of quest scope and identity. |
| Completeness | 4/5 | Addressed presentation, retrieval, tool-loop failures and synthesis; no corpus rebuild or universal lore coverage claimed. |
| Clarity | 4/5 | Research narration is separated from explanations; the policy still depends on the configured model following scope constraints. |
| Actionability | 5/5 | Changes are copied to the running local checkout for immediate browser validation; prior UI work remains. |
| Conciseness | 4/5 | Focused policy module and boundary tests; further corpus-adapter work is outside this iteration. |

Overall: 4.2/5. The user should assess the actual answer, not these test counts; the live sample is retained for that purpose.

## 7. Whole-arc retrieval repair and actual browser result

The decisive remaining cause was structural: `Chapter` rows live under type=other and MainQuest summaries refer to them through `metadata.raw.chapterId`. Ranked text search did not follow that membership. Added authenticated, readonly `/v1/quest-outline`: exact region title + Chapter table, then MainQuest membership joins, selected source language/snapshot. It returns up to 8 chapter groups and 24 physically cited spans. Chapter title and act-number fields retain separate spans; at most two task summaries per chapter are sampled. No data update, schema migration or reimport.

The fast path requires an explicit single-region whole-arc overview. Specific acts, why-questions, comparisons and spoiler/period limits use focused research. Follow-ups are classified from the latest question, not the old overview question. Outline admission divides its 8K character allowance across all sources to preserve later chapters.

Real localhost query for 须弥 returned all five acts plus the second-act epilogue, with actual task summaries including the festival loop, desert allies, missing village keepers, rescue of Nahida and saving Irminsul. The browser's same question then completed as five explanatory sections with valid linked citations, without tool narration or a gap-audit section. This is a useful sample, not a claim that every generated interpretation is factually certified. The original answer and generated comparison branches remain in browser history.

Final validation: 121 web unit tests; 79 Python tests passed, 1 PostgreSQL integration test skipped because TEST_POSTGRES_URL is not configured; typecheck and production build passed; 20 desktop/mobile browser mock tests passed earlier in this iteration. PostgreSQL execution of the new JSON expressions is not live-verified. Existing upstream Vite config warning and Starlette/httpx deprecation remain.

Empty thinking-only completions now return retryable EMPTY_MODEL_ANSWER instead of blank success. Default final synthesis allowance is 8192 tokens; explicit per-depth caps remain honored, and shared worst-case reservation includes the larger possible final round.
