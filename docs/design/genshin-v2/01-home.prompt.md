# 01 · 须弥首页视觉修订 v2

日期：2026-10-28。方式：内置 image_gen，使用两张已实际查看的官方素材作为参考。非产品实现。

素材：`assets/scenery-sumeru-world.jpg`（须弥场景）与 `assets/genshin-logo-official.png`（原神中文 Logo）。本稿不采用 v1 海港/城堡作为参考。

输出：`01-home.png`，1586 × 992，一次生成。概念图仍由生成器合成；最终产品应直接使用官方原始素材文件，不能使用生成器重绘的 Logo 冒充原始资产。

视觉检查：须弥巨树、树城、河谷与花草地保留且清晰，未出现 v1 写实城堡/海港/巨月；米白与灰蓝 UI、无衬线文字、提问框明确；原神标记与非官方说明均可见。图像生成仍存在少量边缘纹理和字形重建，不应声称是像素级无损素材排版。

```text
Use case: ui-mockup / reference-image compositing.
Asset type: one high-fidelity desktop homepage design for "void-terminal", an unofficial Genshin Impact knowledge AI. Front-on flat web page screenshot, full bleed, approximately 1600 x 1000, no browser chrome, no device shell, no collage.

Input image 1 is the ACTUAL OFFICIAL GENSHIN SUMERU SCENERY ASSET and is the required background photograph/game artwork to arrange the page upon. It is not merely a moodboard. Preserve its recognizable giant Sumeru tree, green tree-built architecture, domed details, river valley, arching roots and bridges, boats, grass, flowers, mountains, blue sky, and clear soft cel-shaded anime game rendering. Preserve the original topography, buildings and framing logic. Use the actual scene as-is except for composition crop and minimal localized contrast treatment. Do not invent a different city or redraw it as realistic fantasy architecture.
Input image 2 is the OFFICIAL CHINESE GENSHIN LOGO. Preserve its exact white "原神" glyph silhouette. Remove the surrounding padding and blue rectangle when placing it, but do not invent a substitute wordmark or approximate lettering.

The key correction: the result MUST look clearly like Genshin's own Sumeru scenery and Genshin menu palette, not Middle-earth, not a realistic European harbor, not gothic, not oil painting, not cinematic photorealism, not a fictional star system. No castles, no extra towers, no giant moon, no star arcs, no invented boats/buildings. Do not reference any previous dark harbor design. The original game's clean colorful shapes and softly lit daytime atmosphere remain visible, especially the large tree and city on the right.

Composition:
Left fixed 220px navigation sidebar, full-height, warm off-white #ECE8DF with subtle slate-blue linework and extremely soft antique-gold details. It resembles the clarity and restraint of a Genshin menu but is a modern web application. A small original simple geometric knowledge symbol can appear beside the product logotype, but no replacement of the official game logo. At top exact product text "void-terminal", beneath it small "虚空终端". Use refined readable modern sans-serif controls, not newspaper-style high-contrast Chinese serif everywhere. Selected navigation is a comfortable slate-blue rounded rectangle with cream text "新对话" and a plus icon. Under it "原文库" with a light line book icon. Then muted heading "最近对话" and two compact query labels "关于世界树的记录" and "查阅任务原文". Leave ample space. At bottom: "设置", "中 / EN", small theme icon. Do not add account avatar, fake data statistics, sign-in, uploads or microphone.

Main area to the right displays the provided Sumeru scenery across the whole remaining canvas. Its giant tree and iconic city in the right half must be very recognizable and mostly unobstructed. Keep the image bright enough to identify the original game. A gentle localized slate-blue translucent scrim may help text over the left part of the main area, but do not darken the entire landscape to black, do not desaturate the greens, and do not blur away the tree city.

Place a modest white official Genshin logo from input image 2 near the upper-left of the main area, about 80px wide, with tasteful clear space. Product brand is still void-terminal in the sidebar; this smaller Genshin logo identifies the game. No huge logo splashed over the tree.

Arrange the principal content in the left/center portion of the main area, carefully leaving the giant tree canopy and city on the right visible:
At around 25 percent vertical position, a large, clear, softly rounded modern Chinese headline exactly "从一个问题，走进提瓦特". It may be two lines for the asymmetrical composition. White or very light warm white lettering with restrained soft shadow for contrast, medium weight, not ornate Songti calligraphy. Below, short exact supporting text "循着原文，读懂故事与世界". Clean contemporary sans-serif, lower emphasis.

Below this, around 48 percent height, a prominent inviting chat composer about 620-690px wide and 140px tall. Warm off-white opaque surface, slight paper-like warmth without old parchment texture, moderate 14px corners, subtle soft shadow, no thick all-around gold frame. Placeholder in slate blue exactly "向虚空提问…". Bottom left: a tiny document icon and "全部资料" with restrained chevron, then tiny simple sparkle/compass icon and "深入考据". Bottom right: one simple slate-blue circular send button with a cream upward arrow. No paperclip, no microphone, no attachment, no upload, no model picker.

Under the composer, three SMALL lightweight transparent topic entry buttons along one line with thin slate or cream line icons, tiny simple labels exactly "角色故事", "任务脉络", "书籍考据". No giant card grid, no card images, no fake facts. Keep these secondary; the composer is the clear action center. Let the official scene breathe beneath and around the content.

At the bottom of the main area, quiet small exact text "非官方原神知识站". At bottom-right corner, tiny low-contrast exact text "视觉设计稿 · 内容示意". The disclaimer is deliberate and must remain readable.

Finish: impeccable high-fidelity UI alignment, natural clear type sizes, light geometric icons, elegant restrained separators, cream/slate-blue/soft antique-gold with a touch of Sumeru green. The scenery is the real supplied anime game image, not a new illustration. Make a Genshin player immediately recognize this as Sumeru. All labels are short and clean; no fabricated game quotes, no invented lore facts, no accuracy score. This is a visual composition mockup of real assets with modern interactive controls, not an artwork poster.
```
