# Archive navigation and game UI refinement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fulfil the six requested improvements: smooth module switching, verified Traveler artwork, elemental card backgrounds, lighter game stars, original stat icons, and closer game-style type.

**Architecture:** Keep one active archive workspace and stable Terminal shell. Preserve bounded public response state during a Terminal session; animate visual snapshots rather than leaving old live components mounted. Use provenance-verified same-site game sprites and a narrowly keyed Traveler presentation supplement. Use self-hosted, licensed Noto Sans SC variable fonts for archive UI.

**Stack:** Next/React, existing CSS tokens, TypeScript/Vitest/Playwright; no corpus migration or account changes.

## Global constraints

- Preserve chat drafts, account isolation, history, snapshot binding, URL/back-forward navigation, audio teardown, themes, bilingual copy and mobile layouts.
- Do not retain hidden active workspaces or delay unmount effects for animation. Reduced-motion switches immediately. Fast navigation and stale requests may not restore an old URL.
- No invented game art or approximate icon drawing. Original assets retain byte hashes and pinned source provenance. Unknown elements/stat types do not get invented identities.
- Existing snapshot portrait coverage stays unchanged. Traveler visual supplement requires exact avatar ID AND icon identifier; verified snapshot portrait remains preferred. Local artwork can also recover a failed portrait URL. Explain the separate visual source in Sources & coverage.
- Open-source/self-hosted behavior remains unchanged. No push, merge, live deployment, data activation, payment or live model call in this scope.
- Keep real operator sponsor assets/config ignored and preserve earlier reviewed work. Work in this existing isolated clean worktree, base 2a2a5fa.

## Review focus

Warm reentry without skeleton/refetch; fast/back navigation and draft preservation; leaving voices stops playback; exact Traveler gender and truthful missing-data coverage; neutral unknown-element cards; stat value formatting unchanged; actual glyph availability and font loading; light/dark/mobile original sprites.

### Task 1: Smooth in-session navigation

**Files:** Terminal, CharacterWorkspace, MuseumWorkspace, LibraryWorkspace, globals CSS, a small archive-session helper as needed, related unit/e2e tests.

**Interfaces:** Terminal owns bounded public list/detail caches passed to the archive workspaces as optional props. Keys include complete request identity (source language, snapshot, filters/page or selected ID). Module-local queries/scroll are restored only to their corresponding URL. No cache persists account/private chat content or survives the Terminal session. Existing direct entry remains supported without cache.

- [x] Reproduce/record existing unmount → null query/list → loading skeleton on module reentry; add meaningful browser regressions for warm module return, detail/query/scroll/back, shell/draft preservation, stale response and audio stop.
- [x] Implement bounded successful-response reuse and synchronous warm query seeding. Cache at most eight list and eight detail results per archive; alias resolved-snapshot keys when necessary. Keep the library's matching prior result visible on same-query reentry and preserve its scroll position.
- [x] Apply approximately 180 ms main-content crossfade using the View Transition API when available, with a simple nonblocking CSS fade fallback. Sidebar and Terminal instance remain stable. No live outgoing subtree waits for animation. Handle overlapping switches and reduced-motion.
- [x] Run focused navigation tests plus typecheck; record RED/GREEN and any boundary not exercised. Commit only Task 1 files and provide report for independent scoped review.

### Task 2: Game-style archive visuals and Traveler supplement

**Files:** game-icons, character UI/detail/workspace and CSS, museum rarity rendering/CSS, self-hosted archive font CSS, public assets+manifests/notices, character unit/e2e tests, docs/agent note+index and operations evidence.

**Inputs:** Parent prepares verified asset candidates under artifacts/archive-polish. Traveler files are pinned Rollphes/genshin-manager commit cfea64f3f4afbfb8cf6fd3c35088c78528515ca8 initImages. Source mapping requires (10000005, UI_AvatarIcon_PlayerBoy) or (10000007, UI_AvatarIcon_PlayerGirl). Original stat/star sprites use existing PathOfGenshin/resources commit 015a2493b5672b28576ab78ffbcffde2ea0c9844. Exact selected files and hashes are in the supplied manifest.

- [x] Add behavioral tests for Traveler exact identity, verified portrait precedence, unavailable/failed portrait fallback, and separate visual provenance; no generic URL allowlist or snapshot mutation.
- [x] Vendor the two verified original portraits and show them through a narrow presentation resolver. Preserve source-record coverage and add an explicit supplemental-art source in Sources & coverage.
- [x] Change character portrait card backgrounds to seven element tokens. Unknown/no-element Traveler records use a neutral tint; no assumed default element. Preserve rarity as stars.
- [x] Replace shared rarity stars with verified original star sprite and a light warm gold matching the game reference; remove the dark muddy character-specific overrides. Both character and item stars stay legible in light/dark mode without heavy shadows.
- [x] Add original icons before character property labels via explicit stat-key mapping. Cover HP/ATK/DEF, elemental mastery, crit rate/damage, recharge and additional recognized stats; unknown keys remain text only. Labels and formatted numeric values are unchanged and decorative icons stay aria-hidden.
- [x] Self-host Noto Sans SC variable archive typography with unicode-range loading, retained license/provenance, and no runtime external font requests. Apply to archive body/controls/property headings and numerals; retain brand/module title identity. Use suitable medium weights and tabular numerals without clipping translated labels.
- [x] Verify real Traveler male/female, multiple elements, actual stats, original star/icon load and font readiness on desktop/mobile and light/dark. Run full Web tests/typecheck/build and focused browser regressions; retain failure evidence honestly. Update docs/agent note+index, commit scoped code, and obtain independent review.

### Final acceptance

- [x] Inspect combined diff and real-data browser proof; complete whole-change review and resolve material findings.
- [x] Refresh the running localhost preview to the final build with real read-only corpus access where available. Keep auth/model disabled; no production credentials copied. Provide URL and concise six-item result, explicitly distinguishing local completion from release.

## Acceptance receipt

Implementation commits: `1b1d8b3`, `aedfdcf`, `207efaf`. Both task gates and final whole-change review passed. Full Web unit suite 485/485; typecheck/build passed; final navigation correction run20/20; focused visual browser9passed/1existing skip. Six actual-corpus visual samples inspected, with local fonts and no horizontal overflow. Review evidence archived locally in `artifacts/archive-polish/review-evidence/`; real browser evidence in `artifacts/archive-polish/real-ui/`.

Final localhost preview3205 serves an isolated copy of the production build using read-only corpus8105. Auth/model remain disabled; no push, merge, deploy or corpus activation. Browser proof is Chromium-scoped; unchanged cultivation child-material requests and dev StrictMode account lifecycle remain documented boundaries.
