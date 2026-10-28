# 深色聊天与原文来源设计稿

生成方式：内置 image_gen。参考图：01-home-dark.png。输出：02-chat-dark.png。日期：2026-10-28。

用途：前端视觉审查，不是实现截图。画面中的问题、答案和来源内容为操作说明/占位示意，不是游戏原文或真实检索结果。

视觉检查：保留首页品牌、导航、星金细边框和输入框造型；正文区退去大型背景，引用 [1] 与右侧来源对应；停止按钮、流式状态、来源关闭入口均可见。生成器扩写了通用的任务梳理说明，属于设计占位文案，不是对某个游戏任务的事实断言。原文区的短行仅表示阅读内容的排版位置。

## 最终提示词

```text
Use case: ui-mockup.
Asset type: high-fidelity desktop web app design, a precise continuation of the supplied visual reference.
Input image 1 is the design-system reference: void-terminal dark home screen. Create the active conversation screen of the SAME product, not another style. Preserve the original gold four-point compass logo, lowercase "void-terminal" wordmark and small "虚空终端", exact sidebar width and structure, restrained antique-gold borders, midnight navy surfaces, line-icon style and composer proportions. Output one flat straight-on full desktop web content frame, approximately 1586x992 landscape. No device mockup, no outside presentation margin.

Replace the scenic hero and large headline with a sophisticated readable AI conversation workspace. Keep the entire left sidebar visually consistent, including "新对话", "原文库", "最近对话", two short recent-chat labels and bottom "设置", "中 / EN" and moon control. Main workspace uses a solid near-black midnight-blue background #0B1226 with subtle #141F36 layered surfaces; no scenic illustration under body text. Only faint gold constellation traces at the far top-right and very low bottom edge.

Layout to the right of the sidebar: a generously spaced central chat column, then an open source-reading drawer about 330px wide at the right, separated by a very fine gold/navy vertical rule. The central column is large enough for comfortable 18px-equivalent Simplified Chinese body text. Top conversation title "任务脉络与原文依据". One user message in a compact right-aligned subdued-blue panel exactly "帮我梳理这段任务的来龙去脉，并列出原文依据。". Below, the assistant uses a tiny original compass mark and clear sans-serif body text, with a mix of short actual UI copy and sparse neutral reading lines. Exact opening: "我会按事件顺序整理关键节点，并保留不同的对话分支。". Three restrained section headings "事件脉络", "对话分支", "原文依据". Exact further short sentence "先看原文，再区分明确记载与综合推论。". Add small clickable gold citation chips "[1]" and "[2]" beside relevant lines. Do not invent game facts, quests, book titles, page numbers or supposed game quotations. This is a composition and interaction-state mockup. Lower in the answer show a tiny gold streaming cursor and a subdued status "正在生成回答…". Do not create an all-skeleton page: actual short text should dominate, and use only several restrained placeholder reading lines for the omitted long material.

Right drawer: heading "来源原文", close X; category chip "任务对话 · 示例"; selected source "[1]" in gold matching the central citation; section label "原文节选"; short neutral source placeholder "此处展示与引用对应的原文片段。" followed by several quiet reading lines; a clearly separated "查看上下文" link/button and lower "来源信息" metadata area with "示例来源". No invented book name or page count. Give this drawer an elegant reading hierarchy, not a wall of cards.

Bottom of central conversation: pinned composer directly matching the reference's dark-blue fill, thin gold border and rounded geometry, placeholder "继续追问…", bottom controls "全部资料" and "深入考据". At the right end show a gold circular STOP control with a dark solid square inside, indicating active streaming. The composer must be fully visible, with comfortable outer margins; no attachment, microphone, sharing, favorite or account buttons.

Typography: elegant Chinese serif allowed for the title and original brand; all body text and controls use crisp clear modern sans-serif. Excellent baseline alignment, calibrated whitespace, restrained radii, tiny readable citations, high contrast and refined gold accents. Rich recognizable Genshin-adjacent star-voyage atmosphere carried through fine details, but do not use official logos, character portraits or a game HUD. No charts, dashboard statistics or accuracy percentages. Small discreet bottom-corner label exactly "视觉设计稿 · 内容示意". Preserve the professional visual quality and palette of the reference.
```
