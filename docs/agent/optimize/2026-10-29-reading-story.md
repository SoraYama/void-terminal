> **Date / Revised**: 2026-10-29

# Narrative answers and a readable source library

## 1. Background & Problem

The user wanted Agent answers to unfold as a story rather than compressed summaries. Their library screenshot also showed TextMap bodies used as enormous titles, literal `\\n` and `<color>` tags, and horizontal overflow.

## 2. Root Cause / Approach

`agent.ts` immediately entered final synthesis for standard regional overviews once a chapter outline loaded. That established coverage but prevented focused research on important turns. The bounded research phase is now available for these overviews too. `lore-policy.ts` asks for connected paragraphs explaining the situation, events, characters' knowledge/motivations, turning points and consequences; it still prohibits invented dialogue, thoughts and causal links. Short factual questions remain short.

The library rendered `DocumentSummary.title` directly even when ingestion had to use a long TextMap passage as its only available label. Presentation is now separate from source identity. Stored documents, text offsets, provenance and citation IDs are untouched.

## 3. Key Changes

- `source-presentation.ts` removes known game formatting and decodes literal line breaks for display. Long/unlinked/filename-only titles use a bounded excerpt or an explicit bracketed heading from the text; derived titles are labelled. Image-only records have an honest untitled-image label. Unknown tags and placeholders remain text and never execute as HTML.
- `library-record.tsx` owns bounded title/summary cards and a reader with **Reading view / Raw text** controls. The raw view retains the exact stored string. Source paths, original title and snapshot live in an expandable provenance section; unknown-context warnings remain visible.
- `terminal.tsx` separates `libraryType` from the chat filter and opens the library on books. The category strip and result count state that scope. No browsing action silently changes later chat retrieval types.
- CSS constrains card titles to two lines, summaries to three lines and reading width. At tablet widths the reading assistant moves below the text; mobile keeps the category strip and controls usable.
- `CatalogStore.list_documents` places records marked `titleUnresolved`, known `book Document:...` fallback labels, and explicitly `test`/`(Test)`-prefixed book titles after titled books, without removing them from counts, browsing or search. The book-only sort uses adapter-specific JSON boolean extraction and percent-free `SUBSTR` for psycopg compatibility; other categories retain index ordering.
- `scripts/smoke-ui.mjs` checks exact raw text, explicitly selects `other` for the unknown-context probe, and saves a real library screenshot.

## 4. Verification & Limits

- 132 web unit tests pass, including an outline → focused lookup → final synthesis regression and display cleanup/raw-preservation cases.
- Typecheck and production build pass. 26 desktop/mobile scenarios pass; an additional focused run covers the long-string reader at widths 651, 768 and 1024.
- Python suite: 80 passed, 1 PostgreSQL integration test skipped because no live PostgreSQL URL is configured. The final percent-free sort passes all 20 store tests and independent psycopg parameter conversion review; no new full-corpus PostgreSQL throughput claim.
- Real-corpus browser smoke verifies book reading, exact raw text, retained unknown-context warnings and no page errors. Screenshots are saved under ignored `artifacts/live-ui/`; the final library screenshot is copied to `docs/screenshots/library.png`.
- An independent review found and closed tablet overflow and a PostgreSQL literal-percent issue. Existing Vite configuration and Starlette/httpx warnings remain unrelated.
- No real provider generation was performed during this iteration. Orchestration tests prove the extra research opportunity and evidence flow, not narrative quality or factuality of future model answers. The user should regenerate their question to assess that result; saved answers are not rewritten.
