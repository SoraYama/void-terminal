# Approved navigation and character identity refinement

The user approved 尘世文卷 and the three original game navigation icons, then requested seven-element icons and moving the character name/element below the avatar strip. The attached annotated Nahida screenshot is the visual authority: the arrow ends at the upper-left of the portrait region, to the right of the section menu.

## Global constraints

- Preserve the existing uncommitted Character Archive implementation and data contracts. No backend, source, deployment or commit changes.
- Original asset paths are verified and supplied by the controller in `/assets/genshin-ui/`. Preserve source identity, accessible labels, light/dark themes, mobile operation, and reduced motion.
- Text edits use apply_patch. Read apps/web/AGENTS.md and the applicable installed Next docs before editing.

### Task 1: Implement the approved naming, icons and identity placement

Own frontend component/style/i18n/test changes only. You are not alone: the controller owns assets and documentation. Do not revert other changes or edit backend files.

1. Rename all live Chinese 原文库 labels to 尘世文卷 and the corresponding English module label to Teyvat Archive. Preserve 原文阅读 and other source-reading language that is not a module name. Update dependent browser selectors.
2. Replace the three sidebar module glyphs with original game icons: 尘世文卷 → `/assets/genshin-ui/UI_BtnIcon_CodexBooks.png`; 万象集录 → `UI_BtnIcon_Bag.png`; 群星图鉴 → `UI_BtnIcon_AvatarList.png`. Use a shared small component if useful, preserving the original silhouettes. Check normal/active/collapsed/dark states; decorative images must not duplicate button accessible names.
3. Replace generic element dots and textual-only element identity with original icon images for Fire, Water, Wind, Electric, Ice, Rock, Grass at `/assets/genshin-ui/UI_Icon_Element_<token>.png`. These are white transparent PNGs; tint using current element colors through masks or filters, with sufficient contrast against both themes. Keep localized text labels or accessible names. Apply consistently to filters, character cards, and detail identity. Unknown or absent elements must not get a guessed icon. Traveler's selected form controls the detail element icon.
4. Move name, title and element into one identity group below the avatar-strip divider, at the upper-left of the portrait/content region (the screenshot arrow points here). The top header contains back and the avatar strip only. Keep the identity visible in all sections; give it its own content-row space so it does not overlap artwork or stats. Desktop tabs remain left, attributes remain artwork+stats. Mobile identity is below the avatar strip and section navigation, before the content. Preserve all existing browsing/form-switch and keyboard interactions, avatar auto-scroll, and scroll restoration. Remove the old plain element marker from left metadata to avoid duplication. Rarity/weapon can stay there.
5. Add only meaningful behavior coverage (identity placement and form-specific icon switch, seven icon filters / fallback if needed) to existing character E2E scenarios; do not write tests that only mirror a class string or mock implementation. Run web unit/type checks as useful, but the controller owns final browser visual QA, final build and review. Do not run builds while the local dev server is active.

Reference: `/var/folders/_b/8wpwl1d119v9_gz8_tlf_nxm0000gn/T/codex-clipboard-0ed212d5-22e8-4448-b1b4-8910d1013896.png`.

## Controller validation

Review exact incremental diff against the captured pre-task tree; run web tests/typecheck/build and affected browser suites; inspect actual-data desktop/mobile and light/dark screenshots, sidebar collapse/drawer, seven assets and Traveler form switching. Record source attribution and outcomes; leave changes local for review.
