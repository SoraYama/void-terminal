# 原神素材修订 v2：深色聊天与原文来源

日期：2026-10-28。生成方式：内置 image_gen。参考：01-home.png、官方 Logo、官方须弥场景。输出：02-chat-dark.png。

用途：高保真视觉审查，非实现截图；对话、引用与来源文字是内容示意。原始官方素材来源见 assets/scenery-sources.md 与 BRIEF.md。生成图可能对素材细节重绘，最终实现应直接使用原始官方素材文件。

## 视觉检查

一次生成。正文为实色灰蓝、米白文字与输入框，品牌叶形标记和首页对应；须弥巨树仅在窄横幅出现，无 v1 写实城堡或星轨。来源面板与 [1]/[2] 引用、停止按钮和流式状态均可见。生成器自行扩写了通用任务示例和来源元信息（包括「3.0 及以后」），这些均是画面中已标注的示例，并非已核实数据；不得复制为实际产品资料或默认版本值。

## 最终提示词

```text
Use case: ui-mockup.
Asset type: a polished high-fidelity dark-mode desktop conversation page for the Genshin knowledge agent void-terminal.
Input image roles:
1. 01-home.png is the approved NEW visual design system and product shell. Preserve its brand, soft geometric leaf emblem, lowercase void-terminal wordmark, sidebar structure, rounded modern sans-serif lettering, simple menu icons and creamy rounded composer geometry. Do NOT use the older starry medieval-castle design.
2. genshin-logo-official.png is the official Chinese 原神 logo reference. Preserve the recognizable white logo glyph design rather than inventing substitute text or a new logo. Place the logo small in the header, without the source image's white outer rectangle or blue matte block.
3. scenery-sumeru-world.jpg is the official scene reference. If landscape is visible use only a crop of this exact Sumeru giant-tree city, its animation-rendered foliage and greenery. No new architecture, photorealism, European castles, star maps, moons or Gothic ornaments.

Create a single complete straight-on desktop webpage content frame, landscape approximately 1586x992, no browser/device bezel and no outer presentation mat.
The SAME product as input 1, now in DARK MODE: calm Genshin-menu slate blue/gray surfaces (#273347 sidebar, #303D50 secondary panels, #263140 main), warm cream #F4F1E8 text and selection states, very thin muted warm-gold dividers #D9C8A1, desaturated blue accents #617F99. Keep the product leaf emblem blue and cream-gold, never a giant compass/star logo. The source scene is limited to a subtle narrow 80px header strip or small edge crop; the entire body reading surface is opaque slate blue and visually quiet.

Three-column layout: left history sidebar about 250px, main answer column about 930px, right source drawer about 350px. Left top logo/emblem + "void-terminal" + smaller "虚空终端" matches image 1. A cream selected "新对话" button, "原文库", understated "最近对话", and two short history lines. Bottom "设置", "中 / EN", moon/theme control, and tiny "非官方原神知识站". Icons simple and consistent with image 1. Do not add login, avatar portraits, microphone, upload, sharing or favorite controls.

At main top, the narrow Sumeru scene strip contains a small official white 原神 logo. Below it the clear rounded sans-serif title "任务脉络"; medium weight, about 26px equivalent, not oversized Song/serif. User bubble aligned right in slightly lighter slate blue, text exactly "帮我梳理这段任务，并给出原文依据。".
Assistant response uses a small blue leaf mark, comfortable cream sans-serif body type and generous line-height. Exact opening "先看原文，再区分明确记载与综合推论。". Show 2–3 restrained paragraph groups with small subheads "事件顺序", "对话分支", "原文依据". Use short neutral copy such as "我会按发生顺序整理关键节点，并保留不同选项的上下文。" and "点击引用，可以查看对应片段与来源信息。". Include small warm-cream citation chips "[1]" and "[2]" beside appropriate lines. Remaining long prose may use a few unobtrusive reading-line placeholders, but actual copy must dominate and this must not look like an all-skeleton loading page. Do not invent specific game plot, quest titles, book names, page numbers or quotes. Use text only as a clearly marked interaction example.
Near the end of the current answer show a tiny active typing indicator and exact small status "正在生成回答…".

The open right panel is called "来源原文", with a close X. Under it a soft pill "任务对话 · 示例", selected citation "[1]" that matches the answer. Section "原文节选", short neutral content "此处展示与引用对应的原文片段。" and a few quiet lines, then "查看上下文" as a clear link and a small "来源信息" area. Reading hierarchy should be clean and warm, not a stack of heavy cards or a dashboard.

The bottom composer in the main chat column must match image 1's warm-cream rounded rectangle, gently warm border and slate-blue controls. Placeholder exactly "继续追问…". Lower left: document icon "全部资料" with small chevron, subtle separator, simple sparkle/analysis icon "深入考据". Lower right a slate-blue round STOP button with a cream solid square, indicating streaming. Give the input sufficient breathing room and keep it fully visible above the frame's bottom.
All body/UI type is round, clear, modern sans-serif in Simplified Chinese. Restrained game-menu geometry, soft edges, light gold ornaments only at separators. No black/gold luxury-dashboard styling, thick gold outlines, star-chart backgrounds, realistic harbor, medieval masonry, film-grain or cinematic realism. Preserve the actual Genshin logo and actual Sumeru reference character.
Bottom corner small exact label "视觉设计稿 · 内容示意". This is a concept mockup for review, not an implementation screenshot.
```
