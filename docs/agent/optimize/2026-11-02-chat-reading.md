> **Date / Revised**: 2026-11-02 (created) / 2026-11-03 (latest-answer visibility follow-up)

# Conversation scroll, references and online multi-turn acceptance

## Background and approach

The user reported that large citation chips dominated the viewport during streaming,
that fixed scenery/title/composer regions left too little reading space, and that
the bottom composer merged into the background. Verify long conversations and
failed-request follow-ups on the actual public deployment with a dedicated test Key.

`terminal.tsx` previously scrolled to the whole message container's `scrollHeight`
on every message/status update. Since references followed the answer, references
became the scroll target. The banner and heading lived outside that viewport.

## Changes

- `use-conversation-scroll.ts` follows an anchor immediately after answer text.
  Manual upward scrolling (including small wheel gestures) suspends follow; explicit
  latest-answer navigation can position in either direction from expanded footnotes.
  Restore compact-header state from actual geometry on conversation switches and resize.
  The [2026-11-03 visibility fix](../bugfix/2026-11-03-scroll-anchor.md) supersedes
  the upward-reference button behavior: the downward button now appears only when
  the latest answer remains below the viewport, and hides at the physical bottom.
- The chat scroll surface now includes the landscape, heading and conversation.
  `conversation-header.tsx` uses pinned Motion14.9.0 for an interruptible240ms
  transition into a compact landscape/title row. The scroll viewport never resizes
  for this effect. Hidden controls are inert and excluded from accessibility APIs;
  system reduced-motion preference removes the spatial transition.
- `citation-list.tsx` provides a collapsed source-count disclosure and compact,
  truncated titles. All references and inline citations still open the original
  source drawer. Expanding references suspends streaming follow.
- Scoped chat CSS retains the approved Sumeru assets and limits the reading measure.
  A one-line starting composer grows for multiline input; border, offset shadow,
  dark/light colors, mobile safe area and coarse-pointer targets remain distinct.

## Verification and boundaries

Ignored evidence: `artifacts/diagnostics/chat-reading-20261102/`.

The user supplied `/root/void-terminal-test.key` for real paid DeepSeek acceptance;
its contents were never printed or included in reports/code. No visitor Key or
existing visitor conversation was accessed. The real public HTTPS API, DSH and full
corpus passed six checks before the UI release:

| Scenario | Input history | Result |
| --- | --- | --- |
| Original broad 至冬 quest question |1message|1,601characters,40sources,done|
| Follow-up about 安娜斯塔夏 |3messages|877characters,10sources,done|
| Deliberately invalid Key |5messages|Expected MODEL_AUTH|
| Valid-Key follow-up with old blank failed assistant |7messages|1,051characters,23sources,done|
| Synthetic long reading notes + real source question |19messages /41,706characters|719characters,10sources,done|
| Next turn on that long history |21messages /42,465characters|563characters,8sources,done|

The long-history answer retained the early agreed marker「纸鸢」. Reading notes are
explicitly synthetic, not evidence for game facts. This verifies continuation and
execution, not a comprehensive narrative-accuracy evaluation. Existing24-message /
48,000-character request bounds remain; this is not unlimited persistent history.

Browser regressions cover forty references, paced streaming, small wheel/manual
scroll, expanded-reference return, equal-height history switching, source focus
restoration, short360×420viewport, multiline input, light/dark and reduced motion.
Actual built and released browser results are retained in the artifact reports.

## Review findings

A fresh independent read-only browser review reproduced two P2 edge cases:
explicit latest-answer navigation only moved down from footnotes, and an equal-height
conversation switch could leave the header wrongly expanded. Both receive dedicated
RED-to-GREEN browser regressions before release. Normal incremental follow remains
downward-only; explicit navigation and history restoration recalculate actual geometry.

Do not run concurrent Playwright invocations against the same artifact directory.
DSH unit tests need permission to bind ephemeral loopback listeners; sandbox EPERM
is not an agent-runtime regression.

## Final local checks

- 239unit tests passed on the final tree; typecheck and standalone production build passed.
- 48desktop/mobile browser tests passed before production packaging.
-Production dependency audit reports zero vulnerabilities.
-Independent review findings each have observed RED and GREEN browser results; no
  deferred minor findings. Release-specific version/image and public browser results
  live in ignored diagnostics, not in source-derived success claims.
