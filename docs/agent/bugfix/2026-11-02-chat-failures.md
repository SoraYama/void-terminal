> **Date / Revised**: 2026-11-02

# Context growth and failed-history follow-ups

## 1. Background & Problem

The user supplied an exported conversation (`d09d1db5-195d-4cbf-9683-6bafdab0d67d`): “请根据任务原文梳理至冬魔神任务的主要脉络。” produced 40 source references but no answer, with a reported context-size warning. Follow-ups “告诉我安娜斯塔夏是谁” and “分” both displayed “请求失败，请稍后重试。” The Markdown export contains the empty assistant messages and citations, but omits stored `error` and `errorCode` fields.

The initial investigation was read-only. The user subsequently authorized implementation, tests, commit/push and deployment; the repair and verification are recorded below. No real model API key was accessed and no paid generation was performed.

## 2. Root Cause / Approach

### Failed assistant placeholders poison later requests — confirmed

`terminal.tsx` appends an empty assistant placeholder before fetching `/api/chat`. On failure, it saves the placeholder with its error metadata. The next `send()` serializes every historical message using only `role` and `content`, including the empty placeholder.

`server/validation.ts:parseChat` rejects any message with empty/whitespace content. Consequently both follow-ups fail with HTTP 400 `INVALID_REQUEST`, before credentials, retrieval, quota, or any model call. `chat-errors.ts` has no mapping for `INVALID_REQUEST`, so the UI uses generic `REQUEST_FAILED` wording. This is deterministic with the supplied history and was reproduced against the public HTTPS API:

| Probe | Result |
| --- | --- |
| Second turn including the first empty assistant | 400 `INVALID_REQUEST`, 47 ms |
| Third turn including both empty assistants | 400 `INVALID_REQUEST`, 9 ms |
| Same second-turn history with empty placeholders removed, intentionally no key | 401 `MODEL_KEY_REQUIRED`, 6 ms; schema validation passed |

An isolated local route replay also confirmed **zero upstream fetches** for the rejected second turn and the exact Chinese generic error message. The public probes used a clearly invalid dummy key, never the user's key.

### First-turn context budget exhaustion — reproduced; historical payload not retained

Production is still commit `01e0f1e7b9955ac6d0fc9e57dbc39ee62d13a18c`, matching the local checkout. The knowledge service log for 2026-11-02 07:00:53–07:00:59 UTC shows:

1. Successful `quest-outline` for 至冬 and two successful contextual source reads.
2. Four successful searches.
3. Two successful document discoveries for 影域 / 彩冰镇, followed by two more successful searches.

The application sends a complete source object, including provenance/metadata, in both the initial system context and tool results. Repeated searches return already registered citations again. `MAX_CONTEXT_CHARS=24000` counts only source text; it does **not** bound JSON metadata or repeated tool transcripts. Separately, `requestByteLimit()` allows only serialized user-history bytes + 128,000 bytes (128,093 for this question), capped at 400,000. `agent.ts` throws `CONTEXT_LIMIT` when a research request exceeds that byte budget, before reaching the existing tool-free final synthesis.

A read-only replay used source records from the same production snapshot and matched **all 40 exported citation titles in order**. Its reconstructed research batches followed the observed four-search / two-discovery / two-search pattern. Actual original search arguments, returned duplicates, model preambles, and provider payloads were not logged; do not label the replay as a captured historical model session.

| Replay measurement | Value |
| --- | --- |
| Admitted sources | 40 |
| Source text | 970 JavaScript characters |
| Serialized source objects | 80,539 UTF-8 bytes |
| Metadata arrays alone | 60,694 UTF-8 bytes |
| Initial provider payload | 56,983 bytes |
| Payload after first research batch | 100,682 bytes |
| Payload after second research batch | 142,192 bytes |
| Application request budget | 128,093 bytes |
| Final event | `CONTEXT_LIMIT`; two provider requests dispatched, third rejected locally |

Thus an application-level context overflow is reproducible with the same reference list and consistent with the reported warning and observed request sequence. The exact historical error code/byte count cannot be recovered from this export or existing server logs. `SERVICE_RESPONSE_LIMIT` and `OUTPUT_LIMIT` also alias to the same UI warning, so the original code would be needed to eliminate those alternatives conclusively. This evidence does **not** demonstrate that the provider exhausted its token context window.

As a separate live check, replaying just the first question with an invalid dummy key returned 19 initial references and then `MODEL_AUTH` in 335 ms. It confirmed that initial outline/context retrieval works; it did not exercise paid model research or verify answer quality.

## 3. Evidence & Recommended Fixes

Ignored investigation artifacts: `artifacts/diagnostics/chat-failure-20261102/`.

- `live-probes.jsonl`: public HTTPS probe results.
- `history-replay.json`: exact schema/localization failure with zero upstream requests.
- `corpus-evidence.json`: read-only source candidates from the production snapshot, without credentials.
- `context-replay.json`: measured reconstructed context growth and evidence limits.
- `collect.py`, `probe.py`, `replay.test.ts`, `vitest.config.ts`: reproducible investigation scripts; two replay tests passed.

The investigation recommended the following narrowly scoped implementation (now applied; see verification below):

1. Build request history without empty assistant placeholders, while retaining visible errors/citations in local history. Cover failure → follow-up, cancellation → follow-up, history reopening, and regenerated branches.
2. Budget serialized model context, avoid repeated full evidence/provenance in tool transcripts, and enter a bounded tool-free synthesis when research transcript space is exhausted. Preserve citation IDs, snapshot/language/type checks, uncertainty metadata, request/billing limits, and caller cancellation. Raising the byte cap alone leaves the duplication defect.
3. Add a specific localized invalid-request message and include safe error codes in exports. If adding diagnostics, use safe stage/code/byte-count/request-ID metadata; never log keys, provider bodies, or full conversations.

## 4. Conclusions / Lessons

Distinguish source text length, serialized JSON bytes, and provider token context. A generic user-visible failure may occur before any retrieval/model work. Failed blank assistant records must not become invalid request history. Preserve original error codes in diagnostic exports so reconstructed evidence need not be mistaken for an exact historical trace.

## 5. Repair and verification

- `history.ts:chatMessages()` removes only blank assistant placeholders from model requests. The frontend uses the result for request length checks and serialization, retaining local errors/citations/partial text. Server validation also tolerates these placeholders so an already-open older page can recover without a frontend refresh. Malformed messages, blank users, a non-user final message, and request limits remain rejected.
- `conversationMarkdown()` exports localized errors and safe error codes alongside text and references. `INVALID_REQUEST` now has an explicit Chinese/English explanation.
- `agent.ts` projects model evidence separately from browser citations: incidental raw config, resolved fields, text spans and provenance URLs stay out of prompts. Critical uncertainty, quest membership, dialogue nodes, branch conditions and book grouping remain. The independent review caught actual normalizer-shaped IDs missing from the initial projection; regressions now cover `raw.chapterId/mainId`, `talkId/nodeId/speakerRole`, and `documentGroupId/partIndex/partCount`.
- When the next research request exceeds the unchanged serialized byte budget, it becomes a tool-free synthesis using current validated evidence. Final synthesis fits excerpts, then a source subset if critical metadata itself is too large. Truncation/omission is explicit, included conditions remain whole, citation numbers stay stable, and citations to omitted sources receive warnings. This replaces a call within the existing five-call/token reservation and preserves cancellation/unknown billing.

Validation on the final source:

- **222 web unit tests passed**, including regression tests observed failing first, then passing. Typecheck and production build passed.
- **38 desktop/mobile browser tests passed**, including blank failure → follow-up → restored history → regeneration → diagnostic export; cancellation followed by another request; partial text, source viewing, pinned snapshots and English/Chinese feedback. The first sandboxed browser run could not bind a local port (`EPERM`); the unchanged tests passed with the needed execution permission.
- The captured-corpus incident replay still retains all **40** citation titles and **970** source-text characters, now emits streamed text and `done`, and sends payloads of **21,904 / 32,317 / 42,323 / 46,924 / 30,423 bytes**, all below **128,093 bytes**. The original rejected replay was 142,192 bytes. Provider streams and historical tool arguments are controlled/reconstructed, not a new paid model session.
- One fresh-context read-only review identified the semantic metadata regression above; it was fixed with RED→GREEN tests and a green full suite. No other introduced actionable findings were reported.

Release procedure: fast-forward the existing server checkout to the pushed commit, build before replacement, preserve the old web image for rollback, and replace **web only**. Keep Caddy, knowledge service, `.env` and SQLite data unchanged. Public HTTPS checks must verify readiness/counts, assets, malformed-input rejection, and that both old-client follow-ups reach retrieval/dummy-key `MODEL_AUTH` rather than `INVALID_REQUEST`. Runtime evidence is retained separately in ignored `artifacts/diagnostics/chat-failure-20261102/` so release-specific state is not confused with test/source evidence.
