> **Date / Revised**: 2026-11-09

# 7.1 神瞳落图与地图分层

这次验证 [上一轮调研](2026-11-09-world-map-data.md) 的 `v7.1.3`（游戏 7.1.0）数据能否叠到同版本地图，并调查主地图的分层、独立场景及跨层入口。当前样本可以画主地图，无法单独支持完整分层探索。

后续已完成[枫丹逐点对照](2026-11-09-fontaine-map-match.md)：AppSample 在枫丹可补足明确楼层、楼层图和入口引用，并在旧日之海提供独立场景。下文为开展逐点对照前的核验范围。

## 7.1 主地图落图证据

- 固定使用 [v7.1.3 地图数据](https://github.com/kxxoling/genshin-map-data/tree/v7.1.3/data/teyvat) 的 `labels.json`、`points.json`、`meta.json`、覆盖画面范围的 108 张 `N3` 瓦片。`mapId=2`，`mapVersion=eea752b746ae1f2e0c1988a574f2b7b0`，画布 36,864 × 18,432，原点 `(24206,8918)`。瓦片、坐标均取自 GitHub 的同一标签。
- 依据 [参考客户端坐标规则](https://github.com/kxxoling/genshin-pix-map/blob/0e0016737d525a7b9f3dbdbed6b97bb8150f88e0/src/render/official-tiles.ts)，原图像素为 `(x + originX, y + originY)`，`y` 向下，不翻转；`N3` 缩放为 `1/8`。拼接 256×256 瓦片后裁取 `left=914, top=0, width=2732, height=2304`，点位坐标减同一裁剪偏移。108 张瓦片均可解码；1,460 个神瞳源 ID 与平面坐标均唯一，全部落入已解码瓦片的非透明像素。预览目测八类点位分别落在合理的地区轮廓。这个检查证明图与坐标匹配，不代表逐点进游戏验证可拾取。
- 8 类神瞳：风 66、岩 131、雷 181、草 271、水 225、火 249、月 197、冰 140。和标注来源为 HoYoLAB 的 [SenseOS 主地图分类表](https://senseos.gg/wiki/genshin-impact/interactive-map/)对照，风至月 7 类计数一致，冰神瞳该表为 230（较晚的数据，不能直接当作 7.1 的纠错依据）。[AppSample 主图](https://genshin-impact-map.appsample.com/zh/)风神瞳报 65；这不是快照中坐标重复导致，仍不推断具体差异点。
- 会话标点图 `teyvat-oculi-7-1.html` 内嵌底图与 1,460 个点位。用 Chromium 在 736px 和 390px 复验：全图 1,460 点；选水神瞳后为 225 点、54 个带 `z` 的菱形；点 `#50095` 回读 `(-5248, -263), z=3`；放大、拖动、恢复全图工作，无横向溢出和页面脚本错误。未发布到网站，未把底图或点库提交到项目仓库。

## 地图层级与数据缺口

| 维度 | 核验结果 | 接入时需要什么 |
| --- | --- | --- |
| 独立地图 | AppSample 的[旧日之海](https://genshin-impact-map.appsample.com/sea-of-bygone-eras/)有 46 个水神瞳，另于[提瓦特主图](https://genshin-impact-map.appsample.com/zh/)的 225 个；[层岩巨渊地下矿区](https://genshin-impact-map.appsample.com/chasm/)另列 82 个流明晶石、15 个传送锚点、28 个石堆藏物箱，以及石珀和夜泊石类别；[渊下宫](https://genshin-impact-map.appsample.com/enkanomiya/)有五种键纹共 59 个。SenseOS 也将霜月等作为独立地图，霜月页面统计另有 74 个月神瞳。以上是各网页的目录统计，不表示资源总量或逐点采集验收。 | 每张图分别拿场景 ID、底图/瓦片与坐标变换、点位列表；资源可以跨图检索，渲染时只取当前地图的点位。不能把独立场景坐标当主图坐标。 |
| 地区内楼层 | [快照生成脚本](https://github.com/kxxoling/genshin-map-data/blob/v7.1.3/scripts/fetch-official.mjs)仅请求 `map_id=2`，把真值 `z_level` 保留为 `z`，不保留楼层 ID、名字、范围及单层瓦片。全快照 2,896 条带 `z`（`1:339 / 2:1261 / 3:1296`），72 个资源分类，`x∈[-5855.12,-3440.12]`，`y∈[-2699.5,1194]`，在主图投影上集中于枫丹附近。225 个水神瞳中 54 条带 `z`（`1:6 / 2:22 / 3:26`）；另外七类无 `z`。摩拉 136/571、木匣 44/420、传送锚点 21/641 带 `z`；石堆藏物箱、清心、琉璃袋都没有。 | `z_level` 保留为源字段。缺失值包括被脚本丢弃的零或空，不能认定是地表。需要每个分层区的 `floorId`、名称、边界、图像定位与可追溯的点位归属。 |
| 可用来源 | [SenseOS](https://senseos.gg/wiki/genshin-impact/interactive-map/)展示从 HoYoLAB 得到的 7 张地图，并报告主图 312 个地下/室内层名、12,709 个归为地下的标记；它自己说明地表和地下模式共用地表底图，没有画楼层图片。其公开页面提供了覆盖证据；未取得可复用的逐点楼层导出，也没有验证每个点的楼层归属。 | 优先核对 HoYoLAB 可授权的数据中是否包含楼层目录、对应点位与单层底图；把「有地下标签」「能按楼层查」「可渲染对应楼层底图」当成三个独立能力。 |
| 入口及解锁 | [空荧酒馆](https://yuanshen.site/docs/)支持点位关联、楼层高亮；[更新日志](https://yuanshen.site/docs/blog/posts/changelog-client)记载点击点位可自动切换地上/地下。其公开 [地区模型](https://github.com/kongying-tavern/genshin-cloud-rust/blob/58f506f67aa477abbb80043c3ff1640b6e6457ba/packages/database/src/models/area/area.rs)有 `parent_id`，[点位模型](https://github.com/kongying-tavern/genshin-cloud-rust/blob/58f506f67aa477abbb80043c3ff1640b6e6457ba/packages/utils/src/models/marker.rs)有二维 `position`、物品与数量、任意 `extra`，无固定 `floorId`；[点位关联](https://github.com/kongying-tavern/genshin-cloud-rust/blob/58f506f67aa477abbb80043c3ff1640b6e6457ba/packages/database/src/models/marker/marker_linkage.rs)另建方向边。源码不等同生产库导出契约。[米游社须弥洞口攻略](https://www.miyoushe.com/ys/article/28019307)提供洞口有前置任务、先入另一洞口或多次降水位的实例。 | 入口/出口用显式连边，允许单向、双向、解锁前置及跨图链接。地区树用于检索导航，不能代替楼层；最近锚点按可达关系而非主图直线距离算。 |

## 下一块样本怎么验

建议以枫丹做贯通验收：`提瓦特／枫丹` 中先选一个有至少两层的分层区（如褪色古堡），要求样本含水神瞳、宝箱、摩拉藏物及真实入口；另接 `旧日之海` 独立场景，用 46 个水神瞳的源统计对账，并验证跨图跳转。每个点带 `sourceVersion + mapId + regionId + floorId? + pointId`，每张底图带自身坐标系和版本。图层未知的点留在「楼层未确认」，不能按投影或 `z` 猜层。将地上/地下重复平面坐标作为独立样本检查，切换楼层保留搜索和已收集状态。之后再用层岩巨渊验收矿物、特产、藏物及解锁条件。

本次未调用官方地图内部接口，也未联系任何数据方。正式上线前仍需核对 [米游社协议](https://www.miyoushe.com/hna/agreement)、[HoYoverse 条款](https://genshin.hoyoverse.com/en-us/company/terms)、[空荧酒馆协议](https://yuanshen.site/docs/agreement)及具体数据授权。
