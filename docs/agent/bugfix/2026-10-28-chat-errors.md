> **Date / Revised**: 2026-10-28

# Chat error placement and localization

## 1. Background & Problem

Browser comments requested keeping the error above the composer with i18n and removing its duplicate in the assistant message. Both UI locations rendered the same failure; server error codes were discarded in HTTP and SSE handlers, leaving English messages in state/history.

## 2. Root Cause / Approach

Keep the original message and optional errorCode in history, but render the latest failure once in chat-bottom. Select display copy from the current interface locale at render time. `chat-errors.ts` maps error codes to Chinese/English and recognizes old message-only records, including the reported “The requested evidence was not found.” Unknown failures use a localized fallback. Partial answers and citations remain available.

## 3. Key Changes

- `terminal.tsx`: preserve HTTP/SSE codes through ChatRequestError, remove assistant inline-error rendering, restore latest saved failure above the composer and translate on language changes.
- `history.ts`: optional errorCode, compatible with the existing IndexedDB schema and old records.
- Unit coverage: code-based messages, legacy history, cancellation, network errors, unknown failures and citation warnings.
- Browser coverage: HTTP and streaming failures, a single app alert, preserved partial text, language changes and history reopening on desktop/mobile.

## 4. Validation & Limits

125 unit tests and typecheck passed. All 24 desktop/mobile browser cases passed. Production build passed in `/Users/sorayama/projects/void-terminal`, the running checkout. An initial worktree build could not resolve the external node_modules symlink under Turbopack's root restriction; the runtime checkout has real dependencies and built successfully. No dependency or build-root configuration was changed.

The actual old failed conversation in the in-app browser was opened: the duplicate assistant error was absent; the composer error displayed Chinese, switched immediately to English, and was restored to Chinese. No model calls or history deletion were used for that check. Test screenshots are in ignored `artifacts/screenshots/*-chat-error-{zh,en}.png`.

Tests count app alerts inside main because Next's development route announcer has an unrelated empty alert outside the app.

Self-check: accuracy 4/5 (unknown codes use generic localized copy); completeness 5/5 (both comments and old history covered); clarity 5/5 (one error location); actionability 5/5 (running checkout updated); conciseness 4/5 (message catalog is separate from rendering). Overall 4.6/5.
