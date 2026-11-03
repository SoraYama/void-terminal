> **Date / Revised**: 2026-11-03
> **State**: Published; real public API/SSE and desktop/mobile acceptance passed at functional commit 94d9881.

# 道具博览馆与最新数据发布

## 1. Background & Problem

用户要求更新两个数据源，并补齐武器、圣遗物、任务物品及其他背包道具的数值、介绍和图片；设计接近游戏内的博览馆。用户已选择「游戏背包式：网格浏览与右侧详情」并批准实现与线上更新。新版已发布至 https://void-terminal.sorayama.moe/museum ，本地及公网真实数据验收均通过。

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
- 最新对话样本改用 `dialogList/talkRole/talkContentTextMapHash/nextDialogs`；核对代码后，现有 normalizer 已支持这些明确字段以及旧混淆字段，不需要因字段改名重写。新数据回归、覆盖对比及发布验收均已完成。
- 完成全量图片检查，并修正 Yatta 的 `furniture/`、`reliquary/`、`namecard/`、`monster/`、`gcg/` 子目录。官方装备图片优先，真实 404 才使用经过验证的同标识资源路径。最终中英文共 22,984 条记录的图片可用、4,282 条候选图片不可达、384 条无可用标识；对应 13,825 个稳定物品 ID。中文全部 317 个圣遗物部件有可用图片，288 条武器源记录中 274 条可用。不可达不等于源数据中没有图像，页面会显示类型占位。GCG 修复补回 1,250 条中英文图片记录；严格保留原始图标标识，不移除 `_Platinum` 等后缀猜配其他卡面。

## 5. Production Release & Verification

2026-11-03 19:18:45（Asia/Shanghai）完成生产切换，功能提交为 `94d9881e6fcc099a06e3521bafcdd4c9ea97101e`；切换与健康等待约 85 秒。旧快照 `agd-792978e5503e-1ac83cf28961` 及历史引用保留在新库。既有归档压缩 SHA-256 为 `48e7a06d06357af97ed95279716b41e41f4a23ba8df3c5e2f173321137dc1f83`；初始离线库 17,969,799,168 字节、SHA-256 `a30b76eea72ba25522e31230da4bc868a198dc1263ff51134ae3d5c7e8adc9e7`，`quick_check=ok`。最终传输库 36,492,312,576 字节、SHA-256 `d22ed9422ff956fe8fcc9c3200d92fd9500cfcc64b27af15c86100f4a9aa4dce`；压缩包 5,926,766,618 字节、SHA-256 `5f469e5976516cf1c09dedacdb7037ed614503f8f0c18ee0257fd1a3f7f8fb09`。本地与服务器均完成整库 `quick_check`、哈希和代表数据验证。十二个上传分片全部首次接收成功并逐一验 SHA；临时 HTTPS 凭证已撤销、Caddy 已恢复、接收器已删除，公网入口复查为 404。

生产目录仍为 `/opt/void-terminal/app` 与 `/opt/void-terminal/data/catalog.sqlite`，只使用 `compose.sqlite.yaml`。停服后 checkpoint、迁入最新预算状态（当时两张预算表均为 0 行），再原子切换；目录 `10001:10001/0750`、数据库 `10001:10001/0640`。旧一致数据库保留于 `/opt/void-terminal/releases/item-museum-20261103/catalog.before-museum.sqlite`，旧镜像标签为 `void-terminal-{knowledge,web}:before-item-museum-20261103`。实际新知识服务镜像 `sha256:1d6ed87731b90130115bcb0b99768af5c0bac6c0ee3ec09a35355d610b15fd58`、Web 镜像 `sha256:ec88109f67d87cded76cec49eac712879893d56747e6d90db2218b6ba741f07f`，均已确认运行且健康；Caddy 未重启。发布前已演练预算迁移、哈希拒绝、旧快照回退与损坏数据库/WAL/SHM 证据保留。19:19:48 再次查询两个仓库官方 Atom feed，仍分别匹配本文主源和补充源提交，报告 `upstream-publication-check.json`。

数据构建及接口已通过任务审查：27,650 条中英文物品记录，对应 13,825 个稳定 ID；这是源数据记录数。405 个明确内部记录跨语言默认隐藏，默认可浏览 13,420 条源记录。完整正文为 1,560,911 条、分块为 1,697,095 条。新源的中文 Readable 路径字段已适配，武器/圣遗物/任务物品中文故事分别有 251/299/1,126 条解析完整。中文武器数值 283/288 条完整、5 条未解析；圣遗物 313/317 条完整、4 条未解析。默认可见武器为 277 条，其中 276 条数值完整、274 张图片可用。缺少部位规则、成长等级或类型化初始值时保留已核实部分并标为未解析。最终快照 `agd-bd35e243fa43-9f534ea4c12d` 已成为线上活动快照。此前三个候选快照在导入完成前因已确认缺陷而撤销，均已确认事务回滚，未曾激活或发布。

数据服务最终回归为 130 passed、7 个依赖外部 PostgreSQL 环境的 skip、1 个已有 Starlette/httpx deprecation warning、19 subtests passed；最终展示修复后 Web 268 项通过，类型检查与构建通过。已验证全部 27,650 条物品模型和 41,715 个物品文献关联；无错误或悬空关联。任务接口采用服务端分页、受限代理和 SQL 同快照事务，旧快照没有物品时明确 `ready:false`。跨语言检索只使用源中的中英文正式名称及本地说明，不添加猜测的昵称；共用套装文献的模型元数据不再附任意一个部位摘要，部位资料通过单件详情查看。补充源已有获取途径的 1,576 条中英文记录均已并入，主源有值时仍优先主源。卡牌类型按来源语言显示可读名称；圣遗物说明明确这是不同源配置变体的合并展示，不代表普通掉落档位。

页面已具备桌面网格/右侧详情和手机全屏详情、深浅主题、URL 筛选与详情、等级/突破/精炼、圣遗物规则、来源文献和手动发送的预填提问。既有自动化场景使用 API 夹具；最终本地与公网实际数据库验收均使用真实接口与游戏图片，无 API 夹具。两次真实桌面浅色/手机暗色各 13 项检查通过、无页面错误，分别有 10 张截图，位于 `artifacts/screenshots/real-museum/` 和 `artifacts/screenshots/public-museum/`；护摩 20 级突破前后/90 级、精炼 5、圣遗物 +20、卡牌/任务物品图片、故事、原文、未发送提问和手机 Escape 均通过，并人工查看公网桌面和手机截图。公网 API 20 项检查通过，涵盖七类记录、正式名称跨语言搜索、关键数值、覆盖报告、旧引用及文献搜索；SSE 使用无效模型密钥，取得真实来源后收到预期 `MODEL_AUTH`，证明检索与流式错误处理，未声称验证付费模型生成。报告 `artifacts/data-audit-20261103/public-runtime-verification.json`、公网截图目录 `report.json`，生产实态记录 `production-state.log`。操作与回退流程见 [data-updates](../../data-updates.md)。原型生成图片未被用作真实道具资产。

默认可见中文资料覆盖（源记录口径；数值列仅指武器/圣遗物装备规则，普通道具不适用）：

| 分类 | 记录 | 完整说明 | 可用图片 | 完整装备数值 | 完整故事 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 武器 | 277 | 261 | 274 | 276 | 251 |
| 圣遗物部件 | 317 | 312 | 317 | 313 | 299 |
| 材料 | 4,341 | 4,134 | 4,000 | — | 0 |
| 食物 | 775 | 775 | 757 | — | 1 |
| 任务物品 | 2,511 | 2,329 | 2,183 | — | 1,017 |
| 小道具 | 131 | 131 | 115 | — | 0 |
| 其他 | 5,068 | 5,021 | 3,550 | — | 49 |

默认可见共 11,196 个 ID 有可用图片，2,042 个候选图片不可达、182 个缺少标识。表中缺口区分上游缺失和尚未解析，普通材料/食物不一定存在独立故事；食物效果和用途显示在通用属性中。统计不是当前游戏可获取物品数量。完整输出见忽略目录 `artifacts/data-audit-20261103/final-visible-coverage.json`，单件页面也可查看资料完整性。

实施取舍及代价：物品检索使用中英文正式名称与本地说明，不自行发明昵称，因此部分玩家昵称无法命中；共享套装文献省略任意单部位摘要，模型上下文会少一些部位信息，完整单件资料仍可在详情查看；导入期间先在隔离目录准备镜像以减少等待，活动服务直到真实验收通过后才切换，代价是临时 CPU 与磁盘占用。
