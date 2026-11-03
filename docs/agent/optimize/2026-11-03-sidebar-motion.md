> **Date / Revised**: 2026-11-03

# Sidebar footer toggle, restored wordmark and motion

## 1. Background & Problem

The collapse button squeezed the sidebar header and reduced the brand size. The user requested moving it beside the bottom status control, restoring the original brand size, increasing the wordmark's English/Chinese line spacing, and animating collapse/expand. The user clarified that the title image means the sidebar wordmark, not the homepage headline.

## 2. Root Cause / Approach

Keep one persistent toggle in `sidebar-status-row`, outside the header. Restore the 145px desktop wordmark and original responsive emblem sizing. Regenerate only the wordmark with built-in imagegen; v4 uses a whole-image alpha mask instead of v3's cropping coordinates. See [asset and prompt](../../design/typography-v4/README.md).

The 280ms ease-out transition intentionally changes the sidebar's bounded width so the adjacent reading canvas reflows without scaling or distorting text. Footer tool heights and the theme control's transform keep controls together during the transition. It can reverse immediately. System reduced motion disables movement. The mobile drawer has separate 280ms entry / 200ms exit animations and a matching backdrop exit; desktop collapsed preferences do not collapse the mobile drawer.

## 3. Key Changes

- `terminal.tsx`: bottom status/toggle row and a mobile-specific overlay class; existing labels, focus, persistence and actions are retained.
- `globals.css`: restores header proportions, uses `brand-wordmark-v4.png`, animates bounded sidebar/footer geometry, keeps native touch targets, and removes the former tablet toggle header row.
- `library-reading.spec.ts`: waits for the final layout, verifies bottom placement and restored brand size, samples intermediate animation widths, checks interruption, reduced motion and keyboard focus. Desktop-only scenarios remain skipped in the mobile project.

## 4. Verification & Boundaries

Production build and TypeScript checking passed. The navigation/reading suite passed 13 scenarios with three intentional desktop-only skips. Local Chromium screenshots were inspected at 320/390/651/768/1024/1440px, light/dark, short-screen, expanded, collapsed and paused intermediate states. Artifacts and deployment receipts live in ignored `artifacts/deploy/sidebar-polish-20261103/`; local status data and screenshot history are explicit fixtures. No model request was made.
