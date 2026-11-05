> **Date / Revised**: 2026-11-05

# 原文库命名与原版导航图标候选

后续：用户已选定「尘世文卷」及首选的三枚图标，并补充七元素图标、角色姓名区域下移要求。以下保留候选阶段记录；实施与验证见 [导航与元素标识调整](../feature/2026-11-05-navigation-elements.md)。

## 1. Background & Problem

群星图鉴本地完成后，用户提出原文库也应考虑更名，并要求搜索原神网站已有图标、展示合适候选。本轮范围为名称建议、素材检索与可视对比；尚未授权或实施具体名称/图标替换。

## 2. Root Cause / Approach

现有三个侧栏入口分别使用 Phosphor 的 BookOpen、Compass、UserCircle。保留现有纸白/灰蓝/暖金风格，寻找真实原版 UI 图标，按原文、物品、角色的含义配对。

Perplexity 因账户 quota 返回 401，转普通网页搜索。原神 Wiki 的 UI Icons 分类确认书籍、旅行日志等类别；原图 CDN 在本地超时。最终从公开 `PathOfGenshin/resources` 的固定提交 `015a2493b5672b28576ab78ffbcffde2ea0c9844` 获得 9 个 PNG。只获取 Git 树元数据和选定小图，未下载完整素材库。每个文件均核验 PNG、尺寸及 Git blob SHA-1；原图和 SHA-256、来源链接在忽略目录 `artifacts/navigation-icons/manifest.json`。

## 3. Key Findings / Proposal

推荐「尘世文卷」替代原文库，与万象集录、群星图鉴组成四字入口；文卷涵盖书籍、任务、对话、散落文献。更直观的备选为「提瓦特文库」。这两个名称均为建议，用户尚未选择。

| 模块 | 推荐图标 | 备选 |
| --- | --- | --- |
| 尘世文卷（名称候选） | UI_BtnIcon_CodexBooks.png，图鉴书籍 | UI_BtnIcon_CodexQuest.png，旅行日志 |
| 万象集录 | UI_BtnIcon_Bag.png，背包 | UI_BtnIcon_Codex.png，总图鉴 |
| 群星图鉴 | UI_BtnIcon_AvatarList.png，角色图鉴 | UI_BtnIcon_PlayerBoy.png，单个角色头像 |

额外审阅 UI_BtnIcon_Handbook、CodexMaterial、CharacterData，未列入首选对比。对比稿 `artifacts/navigation-icons/compare.html` 使用实际 PNG，在原始深色背景与浅深侧栏中展示，图标仅通过 CSS 着色，不修改原图轮廓。Chromium 核验 12 个展示图像全部加载，截图 `comparison.png` 已逐项目视检查。此图为候选比较稿，不是已上线页面。

## 4. Conclusions / Lessons

源文件名和轮廓能帮助选择，但仍需按导航尺寸实看。推荐书籍/背包/角色图鉴这组，既接近原神已有语义，三种入口也容易区分。素材来自社区镜像，原图权利归 miHoYo/HoYoverse；仓库代码许可证不等于图像授权。保留来源，后续获选后再接入站点资源与第三方说明。

来源：[素材仓库及图像声明](https://github.com/PathOfGenshin/resources)、[原神 Wiki UI 图标分类](https://genshin-impact.fandom.com/wiki/Category:UI_Icons)。本轮未修改产品名称、导航图标、路由或生产环境。
