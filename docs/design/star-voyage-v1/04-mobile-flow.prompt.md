# 04 · 移动端状态板生成提示词

日期：2026-10-28。生成方式：内置 image_gen；使用首页母版作为参考，未指定底层模型版本。仅视觉稿，不是产品实现。

参考：[01-home-dark.png](01-home-dark.png)

输出：[04-mobile-flow.png](04-mobile-flow.png)，1536 × 1024。一次生成；已检查三屏品牌一致、首页背景裁切、生成中停止按钮、原文抽屉关闭按钮及安全区。右屏抽屉实际占约四分之三屏，而非提示词中的 85%，仍能完整展示来源内容且不重叠聊天输入框。个别生成中文字形不精确，最终实现需使用真实字体和文案；示例段落不作为游戏内容。

```text
Use case: ui-mockup.
Asset type: ONE high-fidelity mobile application design review board, landscape approximately 1800 x 1200.
Input image 1 is the DESKTOP BRAND AND ART DIRECTION REFERENCE. Preserve its exact void-terminal lowercase wordmark, thin antique-gold four-point compass/star symbol, midnight navy palette, gold outlines, restrained celestial geometry, and original moonlit fantasy harbor illustration. Adapt its layout to mobile rather than shrinking the desktop. Do not retain the desktop sidebar.

Create a beautifully aligned landscape board on a clean very dark blue background, with THREE equal-size front-facing mobile screen content frames in one row. Each represents roughly a 390 x 844 mobile viewport. Equal frame heights, generous but not excessive gutters, crisp text, no physical phone hardware, no perspective, no hands. Small board headline exactly "void-terminal · 随行的提瓦特知识档案". Label below the three screens exactly "01 探索", "02 对话", "03 原文". Small board footer exactly "视觉设计稿 · 内容示意".

LEFT SCREEN — exploration home:
Compact mobile header with hamburger, the same gold four-point star and "void-terminal", small "中 / EN". Same moonlit harbor panorama from the desktop reference, carefully cropped for portrait, tower silhouette and sea below, some stars above, preserve atmosphere. Large elegant Chinese serif headline split naturally across two or three lines exactly "从一个问题，走进提瓦特". Strong accessible navy composer with thin gold outline, placeholder exactly "向提瓦特发问…", small gold send circle with up arrow. Beneath, three compact icon entries exactly "角色故事", "任务脉络", "书籍考据". Avoid text on busy scenery; use localized navy shading. Strong visual impact without overcrowding.

MIDDLE SCREEN — chat:
Compact header with back/menu control and "void-terminal", same brand. Solid midnight navy readable conversation background; no big scenic illustration under body text. A user bubble exactly "请结合原文解释这段内容。" Assistant reply exactly "我会先定位相关原文，再区分明确记载与综合推论。" Then short readable subheads "明确记载" and "综合推论", with a small number of tasteful neutral text-layout lines, clearly matching the visual sample status, gold citation chips "[1]" and "[2]". Never fabricate game lore paragraphs. Short active streaming status exactly "正在生成回答…". Anchored bottom composer above a complete mobile safe area, placeholder exactly "继续追问…", gold circular button containing a STOP SQUARE, not a send arrow because generation is active. Typography and controls comfortably mobile-readable.

RIGHT SCREEN — source drawer:
This is the middle screen after tapping citation [1]. The upper approximately 15 percent of the screen shows dimmed chat behind a source bottom sheet. The lower 85 percent is a slightly brighter navy source reading panel with a slim drag handle, close X, title exactly "来源原文". Clear gold selected citation and label exactly "[1] 任务对话 · 示例". Subheads exactly "原文节选" and "上下文". Show a few neutral fine text-layout lines and one concise real UI instruction exactly "点击引用，查看原文与上下文。". Bottom full-width understated gold-outline action exactly "查看完整原文". The original chat composer is hidden and non-interactive while this sheet is open; do NOT draw overlapping input bars. Full lower safe area.

All screens must belong to one premium modern Genshin-inspired lore AI application, not a game HUD. Match the desktop reference's typography spirit, thin icon line weights, gold borders and corner shapes; body copy and controls use clean sans-serif for readability, serif only for large atmospheric headings. Use midnight blue #0B1226, elevated navy #141F36, warm light text #E8EDF5, antique gold #D9BD7B, sparing moon-cyan highlights. Touch controls visually at least 44px. No upload, attachment, microphone, download, account avatar, official Genshin logo, character portraits, fake statistics, invented book titles, fake page numbers, oversaturated neon, card dashboard, watercolor paper or warm parchment. No extra screens. Render all specified Chinese text accurately. This is a visual design board with sample content, not a real screenshot.
```
