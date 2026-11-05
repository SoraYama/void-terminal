> **Date / Revised**: 2026-11-05

# 万象集录 / Compendium

## 1. Background & Problem

The user selected 万象集录 to replace 道具博览馆 and authorized pushing and publishing the rename. The corresponding English display name is Compendium.

## 2. Root Cause / Approach

Change the visible navigation label, tooltip, accessible name, workspace label and heading together. Keep `/museum`, query parameters, existing item links and snapshot identities stable. Preserve the current subtitle and inventory layout.

The heading font was a self-hosted Noto Serif SC 600 subset containing only the previous title. Replace it with a subset covering every character of 万象集录 and Compendium; use the new `compendium-heading.ttf` URL to avoid stale cached subsets. Preserve the existing SIL OFL license.

## 3. Key Changes

- `terminal.tsx`: navigation text, tooltip and ARIA label.
- `museum-workspace.tsx`: section accessible name and Chinese/English heading.
- `museum.css` and `public/assets/fonts`: new self-hosted heading subset and documented Google Fonts source.
- Existing `museum.spec.ts` selectors and bilingual expectation follow the new display name.
- `PRODUCT.md` uses the new product name. Historical design and release notes retain their original titles.

## 4. Conclusions / Lessons

For a heading rename, verify the subset font's actual cmap and weight in addition to checking text. Existing desktop/mobile navigation, deep links and language-switch tests remain the acceptance surface.

Local validation: TypeScript checks, all 269 Web unit tests, the production build and the existing museum browser suite (22 passed, 4 mobile-only skips) passed. FontTools confirmed every required character and weight 600. Read-only review found no blockers. Browser and local-server tests require network/listen access outside the filesystem sandbox.

Publish the web image using both the production SQLite Compose file and catalog-refresh override. Retain the previous web image for rollback, verify the new font bytes and displayed name, and confirm knowledge container identity, active snapshot, historical citations and the 04:30 Asia/Shanghai timer remain intact. Runtime receipts belong under ignored `artifacts/deploy/compendium-rename-20261105/`.
