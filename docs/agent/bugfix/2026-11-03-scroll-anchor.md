> **Date / Revised**: 2026-11-03

# Latest-answer button remains visible at the bottom

## 1. Background & Problem

The “回到最新回答 ↓” button stayed visible at the physical bottom of a completed answer, and only disappeared in a narrow scroll range. The answer and collapsed source disclosure were already on screen. The user requested investigation, verification and direct production deployment.

## 2. Root Cause / Approach

`use-conversation-scroll.ts` derived `awayFromBottom` from the auto-follow flag. Its absolute 90px answer-tail distance treated both unseen text below the viewport and already-read text above its bottom edge as away. Upward wheel input and expanding citations also unconditionally showed the button, even when the answer remained visible or the viewport could not scroll.

Keep auto-follow intent separate from navigation visibility. The downward button is available only when the answer-tail is below the viewport and more than 2px of scroll range remains. This tolerance covers fractional geometry and bottom clamping. Reading references below the answer does not offer a downward jump back to text above.

This current requirement supersedes the earlier expanded-reference return-upward expectation in `2026-11-02-chat-reading.md`. Explicit latest navigation still follows the answer rather than the reference list.

## 3. Key Changes

- Recalculate button visibility on native scroll, streaming revisions/status, explicit follow/pause and viewport/content resize. Observe `.conversation-messages` as well as the viewport so paused content reflow does not leave stale state.
- Preserve small upward gestures suspending stream follow, answer-tail targeting, compact-header geometry and equal-height history restoration.
- `scroll-anchor.spec.ts` restores isolated completed history with 40 references and covers actual bottom, the full visible-tail range, earlier-text return, expanded references, short answers and resize while paused in desktop/mobile Chromium.
- `chat-reading.spec.ts` now checks that a small pause leaves the button hidden while the tail remains visible, then reveals it as streamed text moves below the viewport. Its reference test follows the new downward-navigation rule.
- The existing mobile history-switch test and mock connection helper must wait for the closing drawer to unmount before checking whether to reopen Menu. During its exit animation Radix keeps the header inert, so a role-based visibility check can otherwise skip reopening and wait forever for the next history button. This is test synchronization, with no navigation implementation change.

## 4. Verification & Release Evidence

Observed RED before implementation: the completed-answer test failed because `.back-to-bottom` was visible at the actual bottom while `.answer-tail` was in the viewport. Final full browser suite: 69 passed, with three desktop-only scenarios intentionally skipped in the mobile project. This includes the previously timing-sensitive mobile scenarios after their explicit drawer-exit waits. Web unit suite: 239 passed; TypeScript checking and the production build passed. Production acceptance repeats the focused scroll scenarios against the released bundle.

Release receipts, candidate/public asset hashes and browser evidence live in ignored `artifacts/deploy/scroll-anchor-20261103/` and the Playwright artifact directories. Use the receipts for deployment outcome rather than inferring release success from source changes. Deploy only the Web image through the existing Compose flow, retain its rollback image and verify the knowledge container, active snapshot and catalog counts remain intact. Browser histories and stream responses are isolated fixtures; no paid model generation is needed to verify scroll behavior.
