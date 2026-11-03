> **Date / Revised**: 2026-11-03
> **State**: Implementation and local UI verification in progress; final offline catalog importing; production publication pending.

# 道具博览馆与最新数据准备

## 1. Background & Problem

用户要求更新两个数据源，并补齐武器、圣遗物、任务物品及其他背包道具的数值、介绍和图片；设计接近游戏内的博览馆。用户已选择「游戏背包式：网格浏览与右侧详情」。本记录是中间状态，不代表已完成物品补全或线上更新。

## 2. Design

- 设计：[2026-11-03-item-museum-design](../../superpowers/specs/2026-11-03-item-museum-design.md)。全篇已完成一次只读 builder check，结果 `nothing important left`。
- 概念稿：[item-museum-concept.png](../../design/item-museum-concept.png)，内置 imagegen 生成；[完整提示词](../../design/item-museum-prompt.md)。图中的道具图形、文字和数值属于示意，不可用作产品数据。
- 桌面采用分类与网格、右侧详情，手机采用三列网格与全屏详情；复用站点须弥、纸白、蓝灰、暖金视觉，支持当前主题与侧栏。
- 设计包括按道具类型组织的数值、培养、故事与来源，记录状态、逐字段覆盖报告、受控图片来源、快照一致性和可回退发布。
- 用户已确认按此设计继续实现并更新线上数据；实施计划为 [2026-11-03-item-museum](../../superpowers/plans/2026-11-03-item-museum.md)。

## 3. Actual Acquisition Evidence

本地忽略目录 `data/raw/main` 已通过现有下载器取得最新主源：

- repo `DimbreathBot/AnimeGameData`，commit `bd35e243fa436f141f015cf221a6e19d0c34b7ca`，root Git tree `216b990b921ca71e3ffac08a270747f1f403600f`（GitHub git-commit API 核实）。
- 2,279 Excel 文件、57,643 Talk 文件、29,175 Readable 文件、4,779 Subtitle 文件，加 4 份完整 CHS/EN standard/Medium TextMap；共 93,880 文件。这个数量不是道具数量。
- GitLab 镜像 commit identity 核实；路径归档绑定固定下载 URL、commit、字节数与 SHA-256，四份 TextMap 通过精确大小和 Git blob SHA-1 校验。
- `acquisition.json` 标为所声明主源范围完整。仓库 `normalize.py`、`acquire.py` 与 manifest 的 pins 已同步更新并通过获取和归一化测试。

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
- 完成全量图片检查，并修正 Yatta 的 `furniture/`、`reliquary/`、`namecard/`、`monster/` 子目录。官方装备图片优先，真实 404 才使用经过验证的同标识资源路径。最终中英文共 21,734 条记录的图片可用、5,532 条候选图片不可达、384 条无可用标识；对应 13,825 个稳定物品 ID。中文全部 317 个圣遗物部件有可用图片，288 条武器源记录中 274 条可用。不可达不等于源数据中没有图像，页面会显示类型占位。

## 5. Production Boundary & Next Work

线上没有发生写入或发布，活动快照仍为 `agd-792978e5503e-1ac83cf28961`。既有归档已下载并核实压缩 SHA-256 `48e7a06d06357af97ed95279716b41e41f4a23ba8df3c5e2f173321137dc1f83`；解压后的离线库为 17,969,799,168 字节，SHA-256 `a30b76eea72ba25522e31230da4bc868a198dc1263ff51134ae3d5c7e8adc9e7`，`quick_check=ok`。保留旧快照及历史引用。服务器当时可用 76GiB；数据更新必须考虑旧库、新库、WAL、压缩包同时存在的空间。

数据构建及接口已通过任务审查：27,650 条中英文物品记录，对应 13,825 个稳定 ID；这是源数据记录数。354 个明确内部记录跨语言默认隐藏。完整正文为 1,560,911 条。新源的中文 Readable 路径字段已适配，武器/圣遗物/任务物品中文故事分别有 251/299/1,126 条解析完整。中文武器数值 283/288 条完整、5 条未解析；圣遗物 313/317 条完整、4 条未解析。缺少部位规则、成长等级或类型化初始值时保留已核实部分并标为未解析。最终待发布快照为 `agd-bd35e243fa43-6d0e54515743`，已完成图片校验并正在导入离线库，尚未线上切换。

数据服务最终回归为 126 passed、7 个依赖外部 PostgreSQL 环境的 skip、1 个已有 Starlette/httpx deprecation warning、13 subtests passed。已验证全部 27,650 条物品模型和 41,715 个物品文献关联；无错误或悬空关联。任务接口采用服务端分页、受限代理和 SQL 同快照事务，旧快照没有物品时明确 `ready:false`。跨语言检索只使用源中的中英文正式名称，不添加猜测的昵称；共用套装文献的模型元数据不再附任意一个部位摘要，部位资料通过单件详情查看。

页面已具备桌面网格/右侧详情和手机全屏详情、深浅主题、URL 筛选与详情、等级/突破/精炼、圣遗物规则、来源文献和手动发送的预填提问。截图位于忽略目录 `artifacts/screenshots/*museum*`，当前使用 API 夹具；完整真实库与生产验证尚待完成。操作与回退流程见 [data-updates](../../data-updates.md)。原型生成图片未被用作真实道具资产。
