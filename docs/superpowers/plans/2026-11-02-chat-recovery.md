# Chat recovery and bounded synthesis

User-authorized implementation, commit/push and production deployment. Spec and incident evidence: `docs/agent/bugfix/2026-11-02-chat-failures.md`. Execute inline on the existing dedicated `codex/void-terminal` branch. Retain unrelated files, production secrets and corpus. No new services/dependencies or paid keys are required.

## Task 1: Recover conversations after failures

Files: `src/lib/history.ts`, `src/lib/server/validation.ts`, `src/components/terminal.tsx`, `tests/api.test.ts`, `tests/frontend.test.ts` (all under `apps/web`).

- Add failing API tests: blank failed/cancelled assistant records are skipped, current user text remains mandatory, valid partial answers persist, limits still apply.
- Add `chatMessages(messages)` returning role/content-only nonblank assistant history; use it for frontend request limits/payload and backend validated history. Visible local messages, errors, citations and snapshot stay intact. Reject invalid user messages and malformed records.
- Add failing export/localization tests. Export errors as localized text with safe error codes; map `INVALID_REQUEST` in both languages. Use `conversationMarkdown(conversation, locale)` from the UI.
- Verify unit tests, then browser failure → follow-up, restored history, cancellation, regeneration and export on desktop/mobile.

## Task 2: Continue from long research into an answer

Files: `src/lib/server/agent.ts`, `tests/agent.test.ts` (under `apps/web`).

- First add a test with realistic large provenance metadata and repeated research; assert completed streaming answer, stable citation numbers, request sizes inside the unchanged byte budget, and no raw/duplicate provenance in model evidence.
- Project model evidence separately from browser evidence: preserve exact admitted text, source identities, language/snapshot, speaker and critical uncertainty/branch/book/chapter metadata. Omit incidental raw/provenance payloads from the model, retain them for original-source viewing.
- If the next research request is too large, use the existing tool-free synthesis inside the five-request maximum. Fit final evidence by bounded excerpts, then a bounded subset if necessary; explicitly report clipped/omitted evidence as request limits, never corpus absence. Keep all critical context for included sources.
- Add overflow-specific tests, including large critical metadata, all supplied history, aborts and billing. Preserve shared reservation, provider privacy, source validation and model protocol.

## Task 3: Verify, review, publish and deploy

- Run full web unit suite, typecheck and production build. Run relevant browser regressions on desktop/mobile (controlled provider responses; no paid generation).
- Re-run the same-snapshot incident replay against real captured corpus records with controlled provider streaming, expecting answer/done instead of CONTEXT_LIMIT.
- Fresh-context read-only review before commit. Address material findings with failing regressions first.
- Update incident note/index with exact validation limits, commit with `SoraYama <sorayamahou@gmail.com>`, push `codex/void-terminal`.
- Verify server checkout clean, fast-forward to exact commit, build web image before replacement, preserve rollback image, deploy web only. Keep Caddy, knowledge service, .env and database intact.
- Public HTTPS verification: ready snapshot/counts, homepage/assets, old-client failed-history now passes schema and reaches dummy-key auth, malformed current input still rejected. A dummy key is not a real generation test; record this boundary explicitly.

## Review focus

Blank assistants with whitespace; malformed users; partial answers/citations/snapshot across failures and reload; invalid-request localization; safe diagnostic export; multi-byte serialized payload budgets; preserved unknown context and branch conditions; oversized initial versus repeated tool context; five-call maximum, shared billing reservation, abort propagation; no secrets in artifacts or logs.
