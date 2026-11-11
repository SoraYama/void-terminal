> **Date / Revised**: 2026-11-09

# 提瓦特资源地图数据可行性

后续实测见[7.1 神瞳落图与地图分层](2026-11-09-map-layer-audit.md)：同版本底图叠加和浏览器交互已验证；新增独立地图漏点与楼层数据来源证据。

## 目标与结论

让虚空终端能按材料、神瞳、宝箱、摩拉藏物和地区查询点位，并从群星图鉴、万象集录和问答跳到地图。已有数据证明主地图点位可以结构化导入；本次未找到同时满足当前游戏版本、分层完整、可持续更新、明确允许公开使用的数据源。完整覆盖应按游戏版本 × 场景/楼层 × 资源分类验收。

## 数据源和实测

| 来源 | 已核验 | 限制 |
| --- | --- | --- |
| [米游社提瓦特大地图](https://act.mihoyo.com/ys/app/interactive-map/index.html)、[工具说明](https://act.miyoushe.com/puzzle/bbs/pz_ys5M3WP6KK/index.html?mhy_presentation_style=fullscreen) | 网页有分类点位和地下地图；[第三方 API 包装](https://github.com/MingxuanGame/GenshinMap)和下述快照提供了技术可行性证据。米游社[调研公告](https://www.miyoushe.com/ys/article/30555650)称点位由观测者手工标注。 | 未找到授予本站批量采集或再发布权利的官方公开 API；网页内部接口及手工标注都不保证更新时效和无漏点。 |
| [kxxoling/genshin-map-data](https://github.com/kxxoling/genshin-map-data) | [发布记录](https://github.com/kxxoling/genshin-map-data/releases)中核对的 `v7.1.3`（`941a628`）快照为游戏 7.1.0；`meta.json` 的主图 `mapId=2`；发行说明记录 13,770 个瓦片。实际读取固定标签下的 `labels.json` 与 `points.json`。 | 只验证了一张主地图数据的结构，没有渲染瓦片或验证地图对齐。未见数据再发布许可。游戏已在 11 月 4 日更新到 [7.2](https://genshin.hoyoverse.com/en/news/detail/167187)，新增[新基捷城和如翼之峰](https://genshin.hoyoverse.com/zh-tw/news/detail/167140)，不能把这份 7.1 快照标成 7.2 全量。 |
| [空荧酒馆](https://yuanshen.site/docs/) | 文档明确展示地上/地下图、按宝箱品质/获取方式筛选、解谜关联及路线能力；[后端代码](https://github.com/kongying-tavern/genshin-cloud-rust)公开。 | 软件开源许可不等于线上点库、玩家截图和底图授权；其[服务协议](https://yuanshen.site/docs/agreement)另有限制。优先询问是否能提供持续更新并允许复用的坐标、楼层和入口数据。 |
| [AppSample](https://genshin-impact-map.appsample.com/) | 页面标为 7.2，列出渊下宫、层岩巨渊等独立地图，主图显示 230 个冰神瞳。可作版本和分类覆盖的对照。 | 未核验点位导出接口与再发布许可。[Genshin Builds](https://genshin-build.com/map)明确注明点位和瓦片源自 AppSample，不算第二个独立来源。 |

`v7.1.3` 数据审计：

- [points.json](https://raw.githubusercontent.com/kxxoling/genshin-map-data/v7.1.3/data/teyvat/points.json)：4,434,629 字节，SHA-256 `00fc954f4d525429387715a2712cffec75b460ccfc47cc9bbb7508a376bdfa56`。88,704 条记录、88,704 个唯一 ID，无非有限 `x/y` 或悬空分类。全部记录有 `id/labelId/x/y`，其中 2,896 条额外带 `z`（取值 1/2/3）。这不足以建立完整楼层、洞口、子地图和同坐标异层的对应关系；不可把没有 `z` 的点一律当作地上点。
- [labels.json](https://raw.githubusercontent.com/kxxoling/genshin-map-data/v7.1.3/data/teyvat/labels.json)：90,929 字节，SHA-256 `effde50928765c0c23f1238db2ead29dcd88b171f2113047038df06917310387`。15 个顶级组，共 808 个分类节点，706 个节点有点位。
- 区域特产 4,659 条（清心 175、琉璃袋 237）；风神瞳 66、岩神瞳 131、冰神瞳 140；露天宝箱 3,511 条、解谜宝箱分类 4,199 条。解谜标记数量不能直接等同实际可开箱数量；例如 AppSample 的风神瞳显示 65 个，不能盲目合并两源计数。
- 摩拉标签 `127` 有 571 条；木匣藏物箱 `129` 有 420 条，石堆藏物箱 `359` 有 677 条，另有地区藏物箱。可提供「摩拉／藏物箱」总筛选，保留各来源原分类，并与可刷新调查、地脉、任务奖励分开。不能把 571 条标记叫作 571 个摩拉袋，也不能把分类计数相加当作无重复的游戏总量。

本次只从 GitHub 读取两个版本固定的 JSON 做结构审计，未请求米游社地图接口、抓取瓦片或提交外部数据。[米游社用户服务协议](https://www.miyoushe.com/hna/agreement)限制未经事先书面许可的自动化获取；[HoYoverse 服务条款](https://genshin.hoyoverse.com/en-us/company/terms)也限制抓取和再分发。公开快照不构成本站的采集或上线许可；应分别确认坐标/分类、底图/图标、攻略文字/图片的授权范围。现有 [第三方来源声明](../../../THIRD_PARTY_NOTICES.md)已经区分代码许可与游戏内容权利。

## 接入建议

1. 已有[角色突破/天赋材料](../../../services/knowledge/knowledge/characters/build.py#L168)与[武器突破材料](../../../services/knowledge/knowledge/items/build.py#L208)使用 `material:<id>`；现有 [ETL](../../../sources/README.md)没有完整的地图坐标输入。用显式映射把材料 ID 关联到地图分类或获取方式，显示直接采集、敌人掉落、首领、秘境、商店、合成等渠道，保留未匹配项。敌人坐标是掉落来源，不是同名材料的采集坐标。
2. 先验证一块同时包含地表、地下与入口的区域（如层岩巨渊），用清心/琉璃袋、宝箱和藏物箱检验筛选与坐标；另用独立区域验证神瞳与地区计数。底图或坐标授权未明确时，用自制示意底图和自采/明确授权的小样，养成查询可跳转现有地图；不把跳转当作已验证的精确点位联动。
3. 拿到明确可用的数据后，地图独立发布只读快照，记录 `gameVersion/sourceVersion/mapId/floor/sourcePointId`、坐标系及来源；按视野和分类查询或聚合，瓦片按需加载。比对多处锚点核验坐标变换，再抽查层级、洞口、刷新/一次性状态和解谜奖励关系。每版发布覆盖矩阵和变更摘要，失败可回滚，用户进度随稳定点位 ID 保留，避免版本切换误清空。首版支持检索、标记已收集、隐藏已收集；路线和问答定位建立在已核验的点位上。
