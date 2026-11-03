> **Date / Revised**: 2026-11-03

# 上游版本与背包物品字段审计

## 1. Background & Problem

核实 AnimeGameData / genshin-db 是否更新、线上快照是否最新，以及武器、圣遗物、任务物品与其他背包物品是否具备完整数值、介绍和图片。本次读取公开上游、生产状态接口、代表性文档接口及只读 SQLite；没有发布快照或修改生产配置。

检查日期为 2026-11-03，下列时间均为北京时间（Asia/Shanghai）。GitHub 网页工具返回过旧的缓存提交列表；本次版本结论使用实时 Atom feed，并从服务器调用 GitHub 官方 commits API 交叉确认。匿名 API 在本地出口触发过限流，不用缓存列表代替最新状态。

## 2. Root Cause / Approach

### 上游版本和线上版本

| 来源 | 线上实际引用提交 | 检查时 main 最新提交 | 结论 |
| --- | --- | --- | --- |
| DimbreathBot/AnimeGameData | `792978e5503ecfba73dcb3562ed44a0d35a2abe2`，2026-10-02 07:32:38 | `bd35e243fa436f141f015cf221a6e19d0c34b7ca`，2026-11-02 11:33:58 | 落后 2 次提交；中间还有 11 月 2 日 00:50:27 的 `c5ef717b77418e5a23234e990e7c0d3a829975ae` |
| theBowja/genshin-db | `49a6544a6c6ae36089cb42fa591fc46f01de8bcf` | 同一提交，2026-09-22 04:39:46 | 所固定的提交已是该仓库 main 最新提交，但只获取五类实体正文 |

主源新提交标签为 `CNRELWin7.2.0_R49008628_S48722240_D49008628`，旧提交标签为 `CNRELWin7.1.0_R48379043_S48511369_D48533839`。这是上游标签；本次没有独立验证游戏当前正式版本，线上 `gameVersion` 仍为 null，不能据此补填版本。

生产 `https://void-terminal.sorayama.moe/api/status` 与直接读取 SQLite 的活动指针一致：

- 活动快照 `agd-792978e5503e-1ac83cf28961`，构建于 2026-10-28。
- 1,548,672 documents / 1,688,671 chunks，中文与英文，词法检索。
- 服务器 `/opt/void-terminal/data/catalog.sqlite`，代码提交 `d10fd2510f6f47f3669a46d7fbf6d6fe8b45762e`。
- 武器、圣遗物、材料补充文档的实际 `source.commit` 确认为 `49a6544...`，并非仅依赖仓库 manifest 推断。

### 主源配置表差异

按相同 `id` 比较 pinned 与最新提交的实际 JSON 内容：

| 表 | 旧行数 | 新行数 | 新增 | 修改 | 删除 |
| --- | ---: | ---: | ---: | ---: | ---: |
| WeaponExcelConfigData | 287 | 288 | 1 | 34 | 0 |
| ReliquaryExcelConfigData | 4,352 | 4,352 | 0 | 2 | 0 |
| MaterialExcelConfigData | 10,512 | 10,679 | 167 | 1,071 | 0 |

新增武器配置 ID 为 `14525`。34 条武器修改主要是字段 `BHPHNALIMAG` 到 `enhanceRule` 的变化，不能宣称 34 把武器数值调整。167 条新增材料中有 33 条 `MATERIAL_QUEST`、16 条 `MATERIAL_FOOD`、21 条家具图纸配置。所有数量都是上游配置记录，可能包含测试、废弃、隐藏或内部记录，不等于当前玩家可获得的独立道具数量。

### 线上中文道具字段统计

对活动快照的中文 `weapon / artifact / material / food / furniture / tcg` 文档逐条读取 `metadata.raw`、`resolvedFields`、正文与出处；以下同样不是去重后的玩家背包物品数：

| 数据组 | 记录数 | 确认存在 | 确认缺口 |
| --- | ---: | --- | --- |
| 主源 Weapon | 271 | 271 条有图标标识和原始 `weaponProp`、突破表 ID；260 条解析出标准介绍 | 11 条没有标准介绍；完整等级曲线、突破数值表没有进入文档库；没有图片 URL |
| 补充 weapons | 255 | 255 条有基础攻击数值、介绍、突破材料；符合适用条件的武器有精炼参数 | 无独立 `stats` / `curve` 数据；图片对象 0；技能模板未统一展开 |
| 主源 Reliquary | 4,352 | 图标标识、星级、部位、主副属性池 ID、最大等级；4,277 条有标准介绍 | 75 条未解析出标准介绍；主属性值、等级数值、副词条数值表未入库 |
| 补充 artifacts | 63 套 | 套装效果、部件介绍及故事；4 套为单件套，缺少其他部件不直接计为缺失 | 无主副词条完整数值、成长表及图片对象 |
| 主源 Material | 10,511 | 10,096 条有标准介绍，10,501 条有图标标识；有分类、部分稀有度、堆叠和使用操作原始字段 | 未构成统一物品属性模型；使用效果/配方/来源等多为原始 ID，缺少完整关联 |
| 其中 MATERIAL_QUEST | 2,786 | 2,572 条解析出标准介绍，2,782 条有图标标识，2,781 条有解析出的名字 | 214 条无标准介绍、4 条无图标标识、5 条无解析出的名字；未按任务条件完整连接和过滤 |
| 补充 materials | 921 | 919 条有 description，788 条有 sources | 不能覆盖主源所有材料和任务物品；无图片对象 |
| 主源 CookRecipe | 284 | 介绍、图标标识和原始食材/产出配置 | 没有完整食品效果关联和统一数值展示 |
| 主源 HomeWorldFurniture | 2,513 | 介绍、部分图标标识、舒适度和负荷等原始字段 | 47 条无标准介绍；图标和属性未形成图鉴展示 |

“无标准介绍”严格指未解析出 `/descTextMapHash`，不等于没有任何其他正文或其他描述字段。素材类统计还涵盖食物 723、小道具 134、风之翼 19、名片 293、家具图纸 1,366 等；不能把这些相加后称作去重背包总数。任务物品抽样中 `Material:100006` 为“丘丘人解药”，正文包含 `(test)此道具废弃`，证明有文本不等于当前可获得物品。

## 3. Key Findings / Owning Files

### 数值配套表未进入当前检索库

`services/knowledge/knowledge/ingest/normalize.py:raw_tables` 跳过没有文本 hash 的表行，正文以解析出的文本构成。主源以下配套表虽然上游存在，但在活动文档库按规范 ID 前缀查询结果为空：

- `WeaponCurve`：100 行；`WeaponPromote`：1,814 行。
- `ReliquaryLevel`：101 行；`ReliquaryMainProp`：66 行；`ReliquaryAffix`：350 行。

已下载并核实这些 pinned 表没有顶层 `TextMapHash` 字段。`EquipAffix` 的文本表已进入 `other`，但没有完整关联成武器/圣遗物属性卡。武器等级数据也可以来自补充源独立的 `src/data/stats/weapons.json`（255 条）和 `src/data/curve/weapons.json`（100 等级），当前下载范围都不包含它们。

### 图片配套文件未获取；标识不等于图片资源

补充源在同一个固定提交下提供：

- `src/data/image/weapons.json`：255 条，每条含 HTTPS 图片链接。
- `src/data/image/artifacts.json`：65 条，每条含 HTTPS 图片链接；不能把 65 个映射视为 65 套已导入中文实体，当前补充实体为 63 套。
- `src/data/image/materials.json`：923 条，HTTPS URL 为 0，主要只有 `filename_icon`，还需要可用图片源和按需校验。

当前 bundled inventory 和 `acquire.py:selected_files` 仅选择语言目录中的五类实体 JSON，没有获取上述图片、stats、curve 文件。主源主要提供 `UI_...` 资源标识，当前文本下载范围不包含这些图标的位图资源。

对上游护摩之杖和角斗士之花图片地址执行 HEAD，均为 HTTP 200、Content-Type `image/png`。这只是两张样本图片可达，不是全量图片链接、授权或线上展示验证。

### API 保留部分 raw；页面和模型主要消费文本

- 生产护摩之杖主源文档正文只有 23 字简介，数值和图标标识在 `metadata.raw`；补充文档有故事、精炼参数和突破材料，但正文仍出现 `{0}` 未展开的技能模板。
- `apps/web/src/components/library-record.tsx` 显示文本、关系与出处，没有物品图片、等级属性、突破表或词条组件。
- `apps/web/src/lib/server/research.ts:modelMetadata` 不把任意 `raw`/`resolvedFields` 送给模型，只提升少量已知语义 ID。不能因 API 返回了原始数字就声称模型可以稳定回答完整装备数值。

## 4. Conclusions / Lessons

1. 线上主源已落后；补充源提交最新，但导入范围不完整。更新快照与补齐物品数值/图片属于两个独立工作。
2. 更新主源时同时刷新固定 commit、Git tree / TextMap 校验清单和适配规则；新旧武器字段已经有变化，不能只改 `sources/manifest.json`。使用新不可变快照验证覆盖和回归后发布。
3. 完整物品资料应明确按类型定义字段，接入数值表与图片映射、解析精炼模板，并关联属性、用途、来源和任务条件。任务物品、隐藏项与测试项要有显式状态，不能擅自删除或推定可获取性。
4. 当前可支持大量文本考据，但不能宣称“所有背包道具都有完整数值、介绍和图片”。

## 5. Evidence

本地生成证据位于忽略目录 `artifacts/data-audit-20261103/`：

- `catalog.json`：生产只读字段统计、物品分类、样本和配套表查询。
- `upstream.json` / `upstream-summary.json`：实时提交、生产状态、新旧表行数与 SHA-256。
- `support.json`：补充源数值/图片配套文件、生产文档接口、两张图标 HEAD。
- `cache/`：固定提交和最新提交的实际表数据，均有报告中的来源 URL 和哈希。
- `audit-catalog.py` / `audit-upstream.py` / `audit-support.py`：本次审计脚本。

上游复核入口：

- https://github.com/DimbreathBot/AnimeGameData/commits/main.atom
- https://github.com/DimbreathBot/AnimeGameData/commit/bd35e243fa436f141f015cf221a6e19d0c34b7ca
- https://github.com/theBowja/genshin-db/commits/main.atom
- https://github.com/theBowja/genshin-db/blob/49a6544a6c6ae36089cb42fa591fc46f01de8bcf/src/getdata.js
- https://void-terminal.sorayama.moe/api/status
