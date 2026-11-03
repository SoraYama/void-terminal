> **Date / Revised**: 2026-11-03
> **State**: Design prepared; implementation and production publication pending.

# 道具博览馆与最新数据准备

## 1. Background & Problem

用户要求更新两个数据源，并补齐武器、圣遗物、任务物品及其他背包道具的数值、介绍和图片；设计接近游戏内的博览馆。用户已选择「游戏背包式：网格浏览与右侧详情」。本记录是中间状态，不代表已完成物品补全或线上更新。

## 2. Design

- 设计：[2026-11-03-item-museum-design](../../superpowers/specs/2026-11-03-item-museum-design.md)。全篇已完成一次只读 builder check，结果 `nothing important left`。
- 概念稿：[item-museum-concept.png](../../design/item-museum-concept.png)，内置 imagegen 生成；[完整提示词](../../design/item-museum-prompt.md)。图中的道具图形、文字和数值属于示意，不可用作产品数据。
- 桌面采用分类与网格、右侧详情，手机采用三列网格与全屏详情；复用站点须弥、纸白、蓝灰、暖金视觉，支持当前主题与侧栏。
- 设计包括按道具类型组织的数值、培养、故事与来源，记录状态、逐字段覆盖报告、受控图片来源、快照一致性和可回退发布。
- 已发出异步设计确认；在收到确认前尚未编写产品代码。主源下载等既有数据操作独立推进。

## 3. Actual Acquisition Evidence

本地忽略目录 `data/raw/main` 已通过现有下载器取得最新主源：

- repo `DimbreathBot/AnimeGameData`，commit `bd35e243fa436f141f015cf221a6e19d0c34b7ca`，root Git tree `216b990b921ca71e3ffac08a270747f1f403600f`（GitHub git-commit API 核实）。
- 2,279 Excel 文件、57,643 Talk 文件、29,175 Readable 文件、4,779 Subtitle 文件，加 4 份完整 CHS/EN standard/Medium TextMap；共 93,880 文件。这个数量不是道具数量。
- GitLab 镜像 commit identity 核实；路径归档绑定固定下载 URL、commit、字节数与 SHA-256，四份 TextMap 通过精确大小和 Git blob SHA-1 校验。
- `acquisition.json` 标为所声明主源范围完整。本次运行通过进程内替换已核实的提交与 TextMap 清单调用既有下载器；仓库 `normalize.py`、`acquire.py` 与 manifest 的产品 pins **尚未修改**。归一化之前必须同步更新代码中的 pins，不能直接以旧默认 commit 构建。

新 TextMap 清单：

| 文件 | 字节 | Git blob SHA-1 |
| --- | ---: | --- |
| TextMapCHS.json | 51627416 | `5d272e67fe7ff2cd296c6031933357ff8d38e397` |
| TextMapEN.json | 57676996 | `5acb737e25d4462cab42496b8128d3bd91b2c08e` |
| TextMap_MediumCHS.json | 19104964 | `bc84431fb83bd2e2f2411e37ed94339ce4a2883e` |
| TextMap_MediumEN.json | 21026945 | `e1caa0f1184ab23033545ab4789c362ac1218da1` |

补充源固定 `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`，root tree `f7a0f90c9d12dc5b13cc890f3f06ebb0a60bb02f`，与 GitHub git-commit API 一致。已额外下载并按 Git blob 验证 `image/{weapons,artifacts,materials,foods,namecards,windgliders}.json`、`stats/weapons.json` 和 `curve/weapons.json` 八份支持文件；清单位于 `data/raw/supplement/item-support-acquisition.json`。五类语言正文获取首次在约 2,500/2,944 时网络超时，原子暂存已撤销；通过有限网络重试后，2,944 份文件已全部取得并再次逐项验证字节数及 Git blob。仍然只声明五类语言正文范围完整，其他 25 类未被 bundled inventory 覆盖。最终下载校验报告为 `artifacts/data-audit-20261103/acquisition-validation.json`。

## 4. Read-only Data Checks

- `artifacts/data-audit-20261103/latest-item-coverage.json`：最新原始记录含 Weapon 288、Reliquary 4,352、Material 10,679、家具 2,541。其中文任务物品 2,819 条，2,605 条可解析标准介绍、2,815 条有图标标识；这些仍含内部记录，未去重、未构成最终展示计数。
- `latest-numeric-checks.json`：护摩之杖在 1、20（突破前后）、80（突破前后）、90 级的主源数值与补充源独立数值/曲线计算一致；90 级基础攻击 608、暴击伤害 66.2%。这是原始数据算术校验，不是产品计算器测试。
- 圣遗物源 `ReliquaryLevel.level=21` 对应界面 +20，五星生命值 4,780、攻击力 311、暴击伤害 62.2%；实现必须避免把源 level 直接作为 UI 强化等级。
- 最新对话样本改用 `dialogList/talkRole/talkContentTextMapHash/nextDialogs`；核对代码后，现有 normalizer 已支持这些明确字段以及旧混淆字段，不需要因字段改名重写。上线前仍需新数据回归和覆盖对比。
- `image-provider-probe.json`：官方武器/圣遗物图片样本可用；官方 `/item/` 路径不能直接套用到材料。`gi.yatta.moe/assets/UI/` 对部分真实材料图标返回 PNG，但废弃任务项、名片等样本有 404；尚未完成全量图片映射与校验。Enka 样本返回 403，另一候选域名解析失败，不作为可用图源结论。

## 5. Production Boundary & Next Work

线上没有发生写入或发布，活动快照仍为 `agd-792978e5503e-1ac83cf28961`。已开始只读下载既有归档 `/opt/void-terminal/releases/catalog.sqlite.zst` 到本地 `data/catalog-baseline.sqlite.zst`，用于保留历史快照与引用；该归档约 2.8GiB，下载状态需另行核实，不能视作成功完成。服务器当时可用 76GiB；数据更新必须考虑旧库、新库、WAL、压缩包同时存在的空间。

收到设计确认后先按 writing-plans 形成实施计划，再实现 pin/获取范围更新、数值与图片归一化、物品快照和分页 API、博览馆页面、覆盖报告、回归及发布。原型生成图片不得代替真实道具资产。最终必须真实报告源数据缺失、图片不可达和未解析项目，不能承诺把上游根本不存在的介绍补成权威文本。
