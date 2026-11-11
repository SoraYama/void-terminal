> **Date / Revised**: 2026-11-09

# 枫丹资源地图：7.1 快照与 AppSample 逐点对照

在[同版本神瞳落图](2026-11-09-map-layer-audit.md)后，拿到第二个站点的公开坐标文件，实跑枫丹主图、褪色古堡和独立场景旧日之海。结果是：枫丹样本的点位可跨源对齐；AppSample 的公开地图还给出了点到楼层图、洞口和通路的关联。

## 数据和版本

| 来源 | 这次实际读取的内容 |
| --- | --- |
| [米游社地图派生的固定快照](https://github.com/kxxoling/genshin-map-data/releases/tag/v7.1.3) | 游戏 7.1.0；[points.json](https://raw.githubusercontent.com/kxxoling/genshin-map-data/v7.1.3/data/teyvat/points.json) 只有主图 `mapId=2`，88,704 条；SHA-256 `00fc954f4d525429387715a2712cffec75b460ccfc47cc9bbb7508a376bdfa56`。 |
| [AppSample](https://genshin-impact-map.appsample.com/) | 以其数据的[固定镜像](https://genshin-map-overlay.pages.dev/data/markers/markers-9f0c3fe690.json)作比较，文件时间 `2026-11-06T03:11:46.156Z`，7 个场景共 88,921 条，主图 83,108 条；SHA-256 `9f0c3fe69094909c4e634998e03fc96d4ec390d3d59688ab9e1f8a185e0a8da9`。另从站点公开配置指向的 [CDN](https://game-data.b-cdn.net/gim/markers_all.v5.compressed.json)取得 `2026-11-09T07:39:05.819Z` 文件，SHA-256 `f86529bb3a18cf338234b8390ec5735e78bae76109d80793a273e71c529cf7db`，复验主图 225 个水神瞳、108 个古堡分层点与 3 个入口/通路的去重并集（330 条），以及旧日之海全部 712 条，两个日期的这些记录一致。镜像和 CDN 是同一个来源。 |
| [SenseOS 的 HoYoLAB 数据展示](https://senseos.gg/wiki/genshin-impact/interactive-map/#sea-of-bygone-eras) | 用其旧日之海分类表复核数量。没有用它的坐标做第三次逐点配对。 |

AppSample 点位文件没有游戏版本字段，取样日在[游戏 7.2 发布](https://genshin.hoyoverse.com/en/news/detail/167187)之后。这是用较新数据验证 7.1 快照的既有枫丹点位。两个主图的冰神瞳分别为 140 和 230、风神瞳分别为 66 和 65，不能把整个数据集当作同版本或按数量相加。

## 主图配对

1. 解码 AppSample 压缩文件的列数据，对 `id` 作全列累加；按场景和同名分类筛选。两源点位 ID 不同，配对不用 ID。采用[现有转换脚本](https://github.com/SimphiweGithub/genshin-map-transfer)的初始归一化：`u=(lng-.33314565158651044)/.00008581802238050456`，`v=(lat-.19941397307989506)/-.00008584331336280794`。枫丹局部还需约 -2207.5 像素 X 平移。
2. 将米游社快照 225 个水神瞳按 ID 排序取零基下标每四个一个，排除佩特莉可镇和古堡 `68349–68357`，得到 54 个校准点。用平移初值、双向最近邻（12 像素内，次近差至少 3 像素）对应 54/54，拟合二维仿射。最终 `[u,v,1] @ [[0.9994758420,0.00000696994],[-0.00000447733,0.9997689516],[-2207.5591714,0.5243709]]`。该系数仅在枫丹样本验证。
3. 未参与拟合的 171 个水神瞳全部一对一匹配；残差中位 0.045、最大 0.086 个 7.1 原图像素。最近两条水神瞳记录的次近差约 2.23 像素，仍远大于自身残差（约 0.05 / 0.04 像素）。这量的是两个标点系统之间的误差，不是游戏中的定位误差；高度一致提示底层坐标很可能共享出处。
4. 用主图水神瞳的外接矩形四边各扩 60 像素（`x=[-6052,-3411.5]`，`y=[-2900.25,1245.5]`）取样；固定上一步的仿射，逐类对两侧跑双向最近邻。下表 18 类 1,817 条都一对一匹配，最大残差 0.1004 个原图像素以内。这个矩形是重复采样范围，不是枫丹行政边界。

| 类别 | 匹配数 |
| --- | ---: |
| 水神瞳 | 225 |
| 普通／精致／珍贵／华丽／奇馈宝箱 | 68 / 189 / 75 / 37 / 66 |
| 摩拉／枫丹藏物箱 | 192 / 295 |
| 传送锚点／洞口／双向通路／水洞 | 94 / 29 / 31 / 22 |
| 苍晶螺／海露花／柔灯铃／虹彩蔷薇／幽光星星／湖光铃兰 | 105 / 120 / 30 / 81 / 79 / 79 |

225 个水神瞳在 7.1 快照只有 54 个带 `z`。AppSample 同批有 86 个明确楼层（覆盖原 54 个，补出 32 个）；全部 225 个的 `level` 值却都为 6，故不能用 `level` 当作楼层。按 AppSample [页面脚本](https://genshin-impact-map.appsample.com/_next/static/chunks/3aiymv_i7elpl.js)解码，楼层和通路来自 `meta` 里的 `l=入口ID_入口ID|groupId|floorId`，再用当前地图的公开 `overlays` 配置关联名称、PNG 和经纬边界。

## 褪色古堡

古堡对应 AppSample `mapId=2, groupId=129`。[地图页面](https://genshin-impact-map.appsample.com/?id=69143&mid=2&type=o508)的初始配置列出 4 张楼层图；四个 PNG URL 实测均响应 HTTP 200、`image/png`。108 个分层点全部落在所归属的 PNG 边界内，6 个水神瞳全部与 7.1 点位配对。[古堡收集攻略](https://www.gamersky.com/handbook/202404/1737056_2.shtml)也列出此区域有 6 个水神瞳，并给出部分点需魔导书的条件。

| AppSample 楼层 | 全部点位 | 水神瞳（7.1 快照 ID） | 五种品质宝箱 | 枫丹藏物箱 | 神瞳关联入口或通路（AppSample → 7.1） |
| --- | ---: | --- | ---: | ---: | --- |
| B1 / [162](https://game-cdn.appsample.com/gim/overlays/162-x703.png) | 48 | 3：68352、68353、68354 | 5 | 2 | 洞口 68938 → 68591 |
| B2 / [163](https://game-cdn.appsample.com/gim/overlays/163-iej1.png) | 11 | 0 | 1 | 1 | 无神瞳可核对 |
| B3 / [164](https://game-cdn.appsample.com/gim/overlays/164-ibkv.png) | 35 | 1：68355 | 4 | 1 | 双向通路 68935 → 68594 |
| B4 / [165](https://game-cdn.appsample.com/gim/overlays/165-b057.png) | 14 | 2：68356、68357 | 1 | 2 | 双向通路 68936 → 68593 |

- 3 个入口／通路引用都能在同图解析，且能与 7.1 快照中的同类点位配对。另有 4 个锚点、2 个摩拉标记和 3 个苍晶螺带古堡楼层。
- 6 个神瞳在 7.1 仅 `68353` 有 `z=2`，在 AppSample 对应 B1；`68353` 和 `68355` 的平面坐标都同时落在四张楼层图的矩形边界里，却分别属于 B1 和 B3。没有楼层字段时不能用 `z`、边界交集或最近锚点补猜。
- `entrances` 是可展示的指引点。数据未证明从任意入口可走到目标、正反向均可达或已满足任务解锁；古堡楼层名字以 AppSample 的 B1–B4 为准，不能与攻略的“底层／中层”直接等同。

## 旧日之海

[AppSample 旧日之海](https://genshin-impact-map.appsample.com/sea-of-bygone-eras/)使用独立 `mapId=34`。712 个标记中有 46 个水神瞳、48 个五种品质宝箱、50 个枫丹藏物箱、41 个摩拉标记、17 个传送锚点、11 个水洞、6 个苍晶螺及 10 个海露花；这些分类计数也在 [SenseOS 的 HoYoLAB 对照表](https://senseos.gg/wiki/genshin-impact/interactive-map/#sea-of-bygone-eras)出现。场景总数与分类口径不同，不能视为全量一致。7.1 主图快照没有该场景，所以这里没有声称跨源坐标配对。

AppSample 的场景配置有 8 张楼层图（6 个分组），192 个点带楼层，全部与图层 ID 和边界对应。46 个水神瞳中的 12 个带楼层，引用了 15 个不同指引点（9 个水洞、3 个双向通路、3 个传送锚点），都能在本场景解析。其余 34 个只缺细分楼层，不能当作地表。旧日之海没有套用主图坐标；本次没有验证主图传送到旧日之海的自动跳转。

## 接入判断

- 位置查询可以建在版本固定的标点上；每次导入按 `gameVersion / source / mapId / category` 对账，分类保留原始含义。以 `mapId + groupId + floorId` 定位楼层，单独保存底图坐标系和入口引用；无楼层的点显式留空。
- AppSample 的[公开嵌入说明](https://genshin-impact-map.appsample.com/help/embed/)允许按分类嵌入其地图，适合先做资源搜索的跳转或嵌入。技术上能读取的坐标、楼层 PNG 与玩家内容，仍需核实是否可自行采集、存储及对外再发布。本次未接入产品、部署或在仓库保存点库和地图图片。
