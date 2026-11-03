> **Date / Revised**: 2026-11-03

# Full-height source reading, fading scrollbars and collapsible navigation

## 1. Background & Problem

The library reserved vertical space for the scenery, title and search, then placed
the passage between category and assistant columns. Native scrollbar tracks were
conspicuous, and desktop navigation could not collapse. The requested refinement
must preserve the existing Sumeru identity, support mobile and dark mode, and be
checked in rendered screenshots.

## 2. Root Cause / Approach

`library-workspace.tsx` now owns the library UI. The scenery and content share one
full-height scroll viewport, following the conversation layout. Reading uses an
820px maximum measure; categories and search remain in the listing, with a back
control to return. A Motion compact header preserves the title, back action and
assistant shortcut when the document heading scrolls away. ResizeObserver keeps
that state correct on viewport, heading and locale changes.
The list's saved scroll position ignores document-loading frames, whose shorter
placeholder would otherwise overwrite it with the browser's clamped scrollTop.

## 3. Key Changes

- `use-scrollbar-visibility.ts` captures native scroll events at document level,
  including nested surfaces and Radix portals. Each scrolling element reveals its
  own thumb, waits 700ms after the last event, then fades over 400ms. The registered
  color property animates native thumbs with transparent tracks in both themes;
  reduced motion disables transitions and forced colors retains system contrast.
  No custom wheel or touch scrolling replaces native scrolling.
- `terminal.tsx` exposes a desktop sidebar toggle and keeps icon navigation,
  labelled tooltips, settings, theme and language controls available in its 76px
  rail. `preferences.ts` persists only a boolean `sidebarCollapsed` preference.
  The mobile drawer remains expanded and closes when resizing to desktop.
- `library-record.tsx` retains exact raw text, provenance, context warnings and
  related records. Its main heading is now an h1. Selection also works after
  keyboard gestures; a bottom action bar transfers the selected passage to the
  conversation composer. When that bar shrinks a short viewport, the selected
  line is kept visible. The assistant and source links live below the passage.
- `playwright.config.ts` no longer launches Chromium with hidden scrollbars, so
  captures can verify the actual thumb and track. `scripts/smoke-ui.mjs` returns
  from the reader before changing source categories.

## 4. Verification & Boundaries

- 239 unit tests, TypeScript checking and the production build passed.
- The final production-build Chromium run passed 60 browser scenarios; two
  desktop-only scenarios were intentionally skipped in the mobile project.
  Coverage includes existing chat behavior, both themes, native scrollbar fading,
  portal scrolling, raw text, source navigation, persistent collapse, selected-text
  transfer, reduced motion and long-list position restoration. The two desktop-only
  scenarios themselves passed in the desktop project.
- Screenshots live in ignored `artifacts/screenshots/`: desktop/mobile light/dark,
  expanded/compact reading, collapsed navigation, 320/651/768/1024/1920px layouts,
  and a 360×420 selected-passage case with reduced motion.
  Captures were opened and inspected directly for overflow, clipping and overlap.
- These are local Chromium checks with API fixtures. They verify layout and UI
  behavior, not live corpus retrieval, physical iOS/Android devices, or deployment.

## 5. Lessons

Keep only the active header controls in the accessibility and keyboard tree.
Selection should expose one question action, even if the selected text also
appears in the assistant section. Always inspect the short viewport after adding
reserved bottom controls: a button can be visible while its selected passage has
been pushed outside the scroll viewport.
