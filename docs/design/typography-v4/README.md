# 侧栏品牌字标间距 · 2026-11-03

用户明确本次调整的是侧栏的 `void-terminal / 虚空终端` 两行，首页中文大标题保持现状。

- [生产字标](../../../apps/web/public/assets/brand-wordmark-v4.png)：2009×573，RGBA 透明 PNG。内置 imagegen 以 v3 为参考重新生成，保留原有字形与中英文比例，增加两行间距。
- 输出整理仅裁掉透明留白、增加 12px 安全边距，并统一 RGB 为 `#3e5e7b` 以减小体积；alpha 字形保留。两个文字行之间有约 42px 透明间隙，在 145px 侧栏展示宽度下约为 3px。
- CSS 使用完整图片的 alpha 遮罩与 `contain`，按主题前景色着色。桌面字标恢复 145px，徽记恢复原有响应式尺寸。v3 资产保留供历史记录参考。

## 内置 imagegen 提示词

Edit the supplied brand wordmark for the EXISTING void-terminal website. This reference image is the edit target. Preserve the same exact wording, typographic identity and relative letter sizing: first line exactly "void-terminal", second line exactly "虚空终端" in smaller Chinese lettering, left aligned under the English. Preserve the elegant readable fantasy-game custom serif forms, sharp wedge terminals, and few intentional star accents. Primary change: create a clearly visible clean gap between the English descenders and the top of the Chinese line, about 25% of the English capital letter height, so these two rows do not visually touch at 145 CSS pixels wide. Preserve the present Chinese-to-English size ratio. Production asset only, not a mockup. Single flat solid muted ink blue #3e5e7b, smooth clean filled silhouettes, no texture, gradient, outline, blur, shadow or extra symbol. Truly transparent alpha background. Make the composition wide, compact and easy to crop, and include at least 6% transparent safety margin around EVERY outer letter tip, particularly the leading v and trailing l; no clipped lettering. No additional text, no decorative frame, no background. The exact two-line text must remain crisp and legible when used as a 145px-wide website wordmark.
