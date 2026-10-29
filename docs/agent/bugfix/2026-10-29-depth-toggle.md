> **Date / Revised**: 2026-10-29

# Deep research: hover and enabled must look different

The composer used the same `.depth:hover,.depth.chosen` background and text colors, so clicking the toggle gave no persistent visual confirmation.

The enabled style now follows `aria-pressed=true`: solid composer-primary blue with light text and a check icon replacing the sparkle. Hover on an inactive control remains a light hint; hovering an enabled control keeps its filled appearance. Replacing the icon in the same slot avoids expanding the mobile toolbar. The label, depth request value and toggle semantics are unchanged.

Verified with TypeScript and two browser scenarios: the reported 948×1314 viewport and mobile. They compare hover/enabled appearance, verify the check persists after the pointer leaves, toggle off with Space and confirm the action does not submit the composer. Screenshots: `artifacts/screenshots/*-deep-research-{hover,enabled}.png`.
