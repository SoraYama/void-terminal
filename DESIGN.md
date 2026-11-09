---
name: void-terminal
description: 原作风格的提瓦特资料与研究终端
colors:
  paper: "#f7f4ed"
  panel: "#fffdf8"
  ink: "#385371"
  muted: "#7b8999"
  accent: "#476e90"
  accent-soft: "#e2eaf0"
  gold: "#baa47f"
  border: "#d8d9d9"
typography:
  body:
    fontFamily: "ui-rounded, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
  archive-heading:
    fontFamily: "MuseumDisplay, ui-rounded, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "2px"
  reading:
    fontFamily: "ui-rounded, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 2
rounded:
  control: "10px"
  card: "15px"
  panel: "19px"
spacing:
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    padding: "10px 15px"
  document-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "21px"
  field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px"
    height: "44px"
---

# Design System: void-terminal

## Overview

**Creative North Star: "原作风格终端"**

界面以《原神》游戏内菜单和须弥场景为视觉参照：风景、徽记、细金线、纸面和蓝灰文字共同构成可阅读的资料终端。游戏感与装饰性是明确的方向，但内容、操作状态和来源仍需清楚辨认。

共享外壳使用蓝灰与暖纸色；万象集录和群星图鉴则在同一背景上使用更接近游戏菜单的嵌线面板、物品稀有度和元素色。保留这两种已有层次，不把单个模块的颜色当成所有页面的默认值。

**Key Characteristics:**

- 须弥风景与原作相关图标提供世界感，纸面承载阅读和操作。
- 蓝灰字色、暖纸底色、细金线和叶形徽记贯穿共享外壳。
- 图鉴用游戏菜单式的分类、选中态、图像、稀有度或元素色组织内容。
- 浅色与深色主题、中文与英文以及桌面与手机均有对应处理。

## Colors

共享外壳的基础色见 frontmatter；实际值由 `apps/web/src/app/globals.css` 中的 CSS 变量决定。

### Primary

- **青蓝** `accent`：当前导航、主要操作与链接。
- **浅雾蓝** `accent-soft`：筛选、引用、对话气泡等较轻的选中或信息表面。

### Secondary

- **暖金** `gold`：徽记、分隔线、引用边线和细节装饰。

### Neutral

- **暖纸** `paper` 与 **亮纸面** `panel`：页面背景与可交互内容面。
- **蓝灰墨** `ink` 与 **浅蓝灰** `muted`：主要文字与次级信息。
- **灰色边框** `border`：输入框和需要明确边界的控件。柔和装饰分隔线另用 `--line`。

深色主题由同名变量切换：`paper` 为 `#202e3e`、`panel` 为 `#28384a`、`text` 为 `#f1eee5`、`muted` 为 `#a8b7c7`、`accent` 为 `#d9c6a2`、`accent-soft` 为 `#38516c`、`gold` 为 `#c7b18b`、`border` 为 `#536172`。不要把浅色主题的字面值硬编码进通用组件。

图鉴另有自己的纸面、墨色和金色变量；角色元素使用七种对应颜色，道具使用一至五星稀有度颜色。以各模块 CSS 中的变量为准，并为深色主题保留对应变体。

## Typography

正文及控件使用 frontmatter 的系统圆润字体栈。阅读正文为 16px、行高 2；对话 Markdown 为 16px、行高 1.9。常规标题使用 600 字重，常见二级和三级标题分别为 23px、18px；较小的元信息与控件标签常用 11–13px。

万象集录和群星图鉴的模块标题分别使用自托管的 `MuseumDisplay`、`CharacterDisplay`：它们是为对应中英文标题裁剪的 Noto Serif SC 600 字体，不能假设包含完整字符集。角色详情部分还使用宋体回退栈。首页中文主标题是图像字形而非通用字体；字标使用 v4 资源的遮罩，强制颜色模式有文字回退。具体资源及许可见 `apps/web/public/assets/fonts/README.md`。

## Layout

- 桌面采用固定侧栏与独立滚动的主工作区；常规侧栏宽 250px，可收起为 76px 图标栏。较宽屏幕与中等屏幕有各自宽度调整。
- 阅读与对话限制行长：阅读内容基准宽度为 820px，对话内容为 920px，横向留白使用 `clamp(20px, 3.4vw, 48px)`。
- 原文列表在宽屏使用两列卡片；万象集录使用列表与详情并排，角色图鉴使用目录和独立详情视图。
- 650px 及以下切换为 64px 高的移动顶栏与抽屉导航；图鉴网格为三列，道具详情以移动端全屏详情呈现。其他布局按模块在 850px、1000px、1100px、1150px 等断点调整，不假设所有模块共用一个断点。
- 多个面板和列表各自滚动，不能依赖整个页面滚动来访问所有内容；留意安全区域与短屏。

## Elevation & Depth

使用纸面色差、细线和柔和阴影叠出层次：普通阅读卡片主要靠边界区分，悬停时出现阴影；设置弹窗、来源抽屉与图鉴面板通过阴影和遮罩脱离背景。图鉴的内嵌金线让面板更接近游戏内菜单，而首页建议按钮使用半透明背景及模糊叠在风景上。

共享面板阴影为 `0 16px 60px #142f4814`，深色主题为 `0 16px 60px #0003`；图鉴面板使用 `0 9px 24px #18343828`。阴影与动态效果按实际组件使用，尊重 `prefers-reduced-motion`。

## Shapes

控件、卡片和主要面板使用柔和圆角，常用值分别为 10px、15px、19px；搜索框、圆形发送按钮、图鉴面板等按用途采用各自形状。细边框、内嵌金线、星形分隔与叶形徽记比厚重边框更能体现现有视觉语言。

## Components

### Buttons and controls

共享按钮默认至少 44px 高；主要按钮采用主题强调色背景与面板色文字，悬停时提亮。普通按钮在悬停时使用浅强调背景，禁用态降低透明度；键盘焦点默认有 3px 可见轮廓。图鉴内部使用与纸面相配的细金边和对应模块的焦点色。

### Inputs and selects

输入框以面板色、细边框和圆角承载；搜索通常将图标与无边框输入组合在一个容器中，并给容器提供焦点态。共享下拉框使用 Radix Select，选项面板继承主题色，具备键盘导航、选中和高亮状态；不要用只改变触发器样式的原生菜单替代它。

### Cards and reading

原文卡片以亮纸面、细线和 21px 内边距排列，标题、摘要和阅读入口构成层级。正文以较长行高与金色引用边线呈现；引用、来源和未知信息应保持可识别。

### Navigation and overlays

侧栏当前入口使用强调色实底，其余入口与历史记录保持轻量；图鉴导航使用已核验的原作图标。手机使用顶栏和抽屉。设置为居中弹窗，来源在桌面为右侧抽屉、手机为底部抽屉；遮罩、焦点管理和关闭入口属于组件的一部分。

### Game archive panels

万象集录通过分类、稀有度色、物品图和详情面板组织信息；群星图鉴通过元素图标、角色肖像、头像条和详情分区组织信息。图片和原作图标使用现有来源核验流程；数据缺失时展示明确的空、加载或错误状态。

## Do's and Don'ts

### Do:

- **Do** 以现有游戏内菜单与须弥场景为参照，使用纸面、蓝灰文字和适量金色细节。
- **Do** 使用主题变量，并同时检查深色、移动端、键盘焦点和减少动态效果。
- **Do** 对稀有度、元素、选中和不可用状态使用已有模块语义与可辨认的文字或图标。
- **Do** 保留可阅读的正文层级、独立滚动区域和可追溯的来源入口。

### Don't:

- **Don't** 把图鉴的局部色彩或页面布局直接推广为全站默认规范。
- **Don't** 将标题专用的字体子集当作支持所有正文字符的通用字体。
- **Don't** 仅用颜色传达元素、选中或错误状态，也不要移除键盘焦点提示。
- **Don't** 为填补视觉空缺而臆造原作图标、素材或缺失数据。
