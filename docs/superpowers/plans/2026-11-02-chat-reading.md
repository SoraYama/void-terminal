# Conversation reading and online acceptance

The user's detailed UI brief is the design authority. Keep Sumeru assets, typography,
BYOK, citations and the existing DSH runtime. Execute in the current dedicated branch.

## Design

- One full-height conversation scroll surface includes the scenery, title and messages.
  At the beginning show the existing scenery; once it scrolls away, crossfade a compact
  scenery/title row over the same viewport. Returning to the beginning restores it.
  Use Motion, with reduced-motion support; never resize the scroll container to animate.
- Reading is primary. References become a small, collapsed, keyboard accessible disclosure
  with their count. Expanded references remain available; inline citations still open sources.
- Streaming follows the latest answer text, never the references. Scrolling to older content
  suspends follow; the explicit latest-answer button resumes it.
- A compact bottom composer uses theme-specific surface, border and offset shadow.
  Keep a one-line starting input, allow multiline growth, preserve 44px touch controls,
  mobile safe areas, theme/i18n and source/settings dialogs.

## Implementation / verification

1. Add browser regressions first: forty citations, paced streaming, manual scroll,
   collapse/restore title, source access, compact composer and no horizontal overflow.
   Exercise light/dark on desktop/mobile, narrow/short viewport and reduced motion.
   Confirm failures against baseline before implementation.
2. Implement focused header/reference/scroll components and theme-scoped CSS. Check
   actual rendered screenshots, control bounds and interruption behavior. Run all existing
   browser scenarios plus unit/type/build checks; retain evidence under artifacts/diagnostics.
3. Test the public deployed API with real corpus and a temporary authenticated controlled
   model route: multi-turn, failure -> follow-up, cancellation -> follow-up, near-limit
   history and bounded final synthesis. Do not read visitor credentials; a real paid model
   check requires a separate operator-provided test Key. Remove the temporary route/container
   even on failure. Repeat essential acceptance after release.
4. Independent read-only review, fix material findings, document evidence boundaries;
   commit/push and deploy web only using the previously authorized release procedure.
   Verify exact image/version/health, public assets and browser layout, preserve rollback.

## Review focus

- Scroll anchoring when reference disclosure opens/closes or source/settings dialogs close.
- New and reopened conversations, failure placeholders and edit/regenerate branches.
- Sticky title controls must not become focusable while hidden or overlap first messages.
- Mobile short viewport/keyboard space, dark composer contrast and reduced motion.
- Controlled model output verifies execution, not paid-model narrative quality.
