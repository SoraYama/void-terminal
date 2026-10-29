> **Date / Revised**: 2026-10-29

# Theme the complete dropdown surface

## 1. Background & Problem

The composer and settings styled native select triggers, but the open option menus still used the operating system's white rectangular UI. Trigger-only CSS cannot reliably theme those browser-controlled popups.

## 2. Approach & Changes

`themed-select.tsx` wraps the pinned `@radix-ui/react-select` primitive, consistent with the existing Radix Dialog stack. Composer categories and all four settings fields share it. It preserves controlled values, the empty all-sources selection, disabled shared mode and existing preference handlers. Triggers explicitly use `type="button"` inside the composer form.

The content is portalled above dialogs and uses the app's paper/slate surfaces, gold border, blue-gray selection and Phosphor icons. Collision handling, available-height bounds and scroll buttons keep the options inside the viewport. Keyboard navigation, typeahead, focus restoration and outside dismissal come from the primitive. Highlight outlines use the accent token; existing reduced-motion rules suppress the small opening animation.

Native select wrappers and obsolete CSS were removed. Browser tests now interact with options by their visible localized names and assert the selected trigger text rather than a native select's value. The lockfile includes the new package and its transitive dependencies.

## 3. Verification

Typecheck, 132 web unit tests and production build pass. All 30 browser scenarios pass, covering desktop/mobile, light/dark, ArrowDown/End/Enter, Escape/focus return, outside dismissal, settings-dialog portals and disabled shared mode. Existing preference, conversation, source and library flows are included in the full regression run. Screenshots are under ignored `artifacts/screenshots/*-dropdown-*.png`.

The Impeccable context launcher could not run because its engine was not installed and its cache path was not writable. The refinement followed the existing palette/components and the skill's polish/craft guidance directly; no product/design context was invented. An independent focused implementation review found no important product-code issue.
