> **Date / Revised**: 2026-11-09

# Impeccable 现有设计规范

## 1. Background & Problem

项目已有须弥风景、共享外壳及游戏菜单式图鉴，但缺少供 Impeccable 和后续界面开发读取的 DESIGN.md。

## 2. Root Cause / Approach

以 `apps/web/src/app/globals.css`、万象集录和群星图鉴 CSS、组件与字体资产为主要依据；核对本地桌面首页、图鉴和手机首页。用户选择“原作风格终端”，并要求以贴合游戏内界面的风格为主。图鉴本地预览的知识服务不可用，卡片与详情以源码和既有项目记录为依据。

## 3. Key Changes

- 根目录 `DESIGN.md` 记录共享主题、模块差异、响应式布局、组件和可访问性；frontmatter 的基础 token 对应当前 CSS。
- `.impeccable/design.json` 记录组件预览、阴影、动效和断点等扩展。预览片段是从现有实现提取的简化示例；面板用色阶为展示而合成，不是代码中的设计 token。两者均不取代源码。
- Impeccable init：用户确认根目录 `PRODUCT.md` 继续作为全站共享上下文，现有产品事实无需补充；补上 schema 标记和 web 平台。用户选择宣传页、展示页默认先视觉稿，写入 `.impeccable/config.json` 的 `buildPath`；应用界面与文档仍直接写代码。
- Live 首次配置位于 `apps/web/.impeccable/live/config.json`，指向 Next.js App Router 的 `src/app/layout.tsx`。`detect-csp` 未检测到 CSP；实际交互依赖本地开发服务器与 Live helper。

## 4. Conclusions / Lessons

维护设计规范时先核对 CSS 后续覆盖、浅深主题与模块局部变量，勿将图鉴专用配色推广为全站 token。标题字体为受限字符子集；页面正文继续使用原有字体栈。
