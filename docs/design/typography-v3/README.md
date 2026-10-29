# 标题字形修订 · 2026-10-28

用户在浏览器标记了侧栏品牌字，以及「从一个问题，」「走进提瓦特」两行，要求字形参考原神标题并更有设计感。

本轮仅调整品牌与首页展示标题。导航、按钮、正文、原文阅读继续使用可读的文字字体；标题保留真实 DOM 文本供辅助技术与检索读取。保留非官方知识站说明。

## 实际素材

- [品牌字标](../../../apps/web/public/assets/brand-wordmark-v3.png)：2073×759，RGBA 透明图。页面使用 alpha 遮罩，由主题前景色着色。
- [中文标题字标](../../../apps/web/public/assets/hero-title-zh-v3.png)：1983×793，白字黑底的 RGB 字形板。页面使用 luminance 遮罩，黑色底板不显示。

采用内置 image_gen 生成。第一轮透明标题出现碎边，因此未用于页面；最终标题改用干净的黑底字形板加浏览器亮度遮罩。没有使用整页生成图替代 React 页面，也没有引入不可分发字体文件。

## 最终品牌修订提示词

Finish this transparent wordmark asset for final website use. Preserve EXACT text "void-terminal" on the first line, and "虚空终端" on a smaller second line, the custom elegant fantasy-game letterform character, left alignment, and the single muted ink-blue color. The correction is clean production finish and safe framing: ensure the ENTIRE leading v and trailing l including every tip fit wholly within the canvas, add 5% transparent safe margin on all four sides, and remove all rough edge pixels, hairline artifacts, distressed texture and speckles. Make every glyph a crisp smooth solid silhouette with clean transparent counters; no gradient, highlight, bevel, shadow, outline or background. Retain only the few intentional celestial details already integrated into the lettering. The wordmark must remain extremely legible at 150 pixels wide. True transparent alpha background, no checkerboard or solid backdrop, no icon, no additional text.

## 最终中文标题生成提示词

A clean professional video-game title typography plate, WHITE LETTERING ON PURE SOLID BLACK (#000000) BACKGROUND. Flat artwork, not transparent. EXACT two left-aligned lines of Chinese, first line: 从一个问题， second line: 走进提瓦特 . Design pristine custom title lettering inspired by Genshin Impact: readable confident Chinese forms, moderately bold even strokes, refined sharp wedge terminals, restrained elegant flares, one tiny celestial accent integrated into a stroke. Warm-white (#FFFDF5) glyphs, solid flat fill. The letters must look digitally finished and extremely clean. NO distressed ink, NO splatter, NO specks, NO brush texture, NO ragged edges, NO tiny disconnected fragments, NO bevel or extruded faces, NO highlights/shading/gradients/outlines, NO decorations around the text, NO shadow, NO background texture. Every glyph is a single clean flat typographic shape with smooth contours and crisp transparent-looking black counters. Give the two lines a generous clear gap, about 30% of a glyph height, with no overlaps. Wide horizontal 2.5:1 composition with 5% black safe margins around the complete lettering. Do not add quotation marks, labels, or any other text. Chinese characters must be exact.

## 验证

源文件和 alpha/亮度边界已检查；页面按桌面、手机和深浅主题做视觉核对。此记录不代表真实模型问答验收。
