> **Date / Revised**: 2026-11-10

# 游戏小区域围栏：7.2 原始资源核验与查询验收

用户要求实际核验数据，不合格就换源。本轮替换了不完整的旧镜像，取得官方 **7.2.0 Global** 客户端资源中的 WorldArea 载荷，完成版本专用解码、区域目录关联、坐标校准和示例资源统计。本文取代上一轮「只有 358 个主世界区域、尚未校准」的阶段结论。

交付物根目录：`/Users/sorayama/.codex/visualizations/2026/11/09/01a1c014-f8de-7cb2-ab48-460de462f5ee`。

- `ormos-geofence-7.2.html`：可拖动、缩放的高清 Canvas 核验图，内嵌 72 张瓦片，区分港内和界外标点。
- `region-data/query-bundle-7.2.json`：597 条区域目录、583 个有几何的区域、89,091 条标点、7 国坐标校准及 172 条三维坐标交叉记录。
- `region-data/native-7.2/`：13 场景原始载荷、规范化多边形、解码器、来源与哈希证据及复现说明。
- `region-data/4203-result.json`：奥摩斯港的实际查询结果；`coverage-7.2.json` 为完整覆盖与缺失清单。
- `region-data/query-acceptance.json`、`browser-acceptance.json`：查询和浏览器验收。

## 数据源取舍

| 来源 | 实际检查 | 结论 |
| --- | --- | --- |
| AppSample 7.2 | 89,091 条资源点；区域相机只有中心与缩放，没有小区围栏 | 保留资源点和底图，不能单独回答小区域数量 |
| DimbreathBot/AnimeGameData | 最新 `d7f2135c7eb0052e842e0f187f4e5bb88c304737` 虽标 7.2，主世界 WorldArea 仍为旧 blob `d84fa771c2f218101ab1e4c44b9dfbb24c59587f`；49 个一级区域、358 个不同区域键 | 拒绝作为全量 7.2 围栏 |
| [AstaPS-Resource](https://github.com/MeChen618/AstaPS-Resource/tree/6cfecfb55f88) | 主世界 65 个一级区域、461 个不同区域键；几何为历史 7.0 血统，缺新基捷城和如翼之峰 | 用作解码校准和历史对照，不作为最新数据 |
| [RinoPaw 原生 7.1 研究](https://github.com/RinoPaw/Genshin-Reverse/tree/0b4596ed47eacfcb2ea65ddad7f1aea1c4e5bfce) | 解包方式、7.1 解码器、场景覆盖与高度变化证据 | 作为独立参照；7.1 解码器直接运行 7.2 会拒绝，不能改标签冒充 |
| 官方 7.2 Global Sophon 资源 | 下载 manifest、设计索引块和 WorldArea 所在数据块，校验 manifest 的块 MD5；解出全部 13 场景 | 本轮采用的围栏源 |

官方资源 manifest 入口固定在 [TwintailTeam/game-manifests](https://github.com/TwintailTeam/game-manifests/blob/dbc55338c2ee2067f89761d4992c68215341ee01/hk4e_global.json)，索引算法参照 [Inteyvat-Wiki/GenshinData-scripts](https://github.com/Inteyvat-Wiki/GenshinData-scripts/tree/8c1028f3ee9940cff204f632395f2e1f45816124)。官方 CDN URL、分块、大小、哈希保存在 `native-7.2/manifest-selected-7.2.json` 和 `README.md`。

- 索引块 `31049741.blk`：2,569,406 字节，SHA-256 `d993c81196145c66ac968108390952733a00d4cf8fce3b7b1275c9231a8f59ea`。
- 数据块 `24230448.blk`：139,134,667 字节，SHA-256 `cb1a68de51f3baeba7afc771284d46410a7b6cb993aa3d085a0c8a7813e14768`。

## 围栏核验结果

13 个场景全部解码到 EOF，无剩余字节；顶点有限、XZ 最小/最大范围与多边形严格一致，区域 ID 与 7.2 配置目录关联。结果为 **92 个一级区域 + 491 个唯一二级区域 = 583 个区域**，共有 589 条多边形记录，保留同一区域的多块几何与高度范围。

主世界 `sceneID=3`：493 条目录定义中 **480 条有几何**，其中一级区域 67、二级区域 413，共 484 条多边形。新基捷城、如翼之峰及全部 17 个子区已覆盖。`82006 克什尼克矿区` 实际属于 `id1=61`，不能按目录 ID 前缀猜父区域。

7.2 解码规则由未变更区域的真实坐标和 ID 校准字段次序与可逆数值变换，**不是对 7.2 原生程序逐函数反编译**。历史 7.0 社区基线的 570 段中，561 段全字段逐点相等，涉及 10,168 个向量；另 9 段不同。其中 8 个子区的变化已存在于原生 7.1，不把这些旧变化称为 7.2 新增。比较基线、逐偏移与独立高度对照见原始证据包。

独立位置检查：7.2 神像 1975 位于父区 60，唯一子区命中 6004；神像 1976 位于父区 61，唯一子区命中 6101；XZ 与高度同时成立。

| 用户关心的小区域 | 国家 / 上级 | 目录 ID | 原生 id1 / id2 | 顶点数 |
| --- | --- | --- | --- | --- |
| 星落湖 | 蒙德 / 坠星山谷 | 1103 | 1 / 103 | 22 |
| 望风山地 | 蒙德 / 坠星山谷 | 1104 | 1 / 104 | 40 |
| 摘星崖 | 蒙德 / 坠星山谷 | 1106 | 1 / 106 | 31 |
| 奥摩斯港 | 须弥 / 阿陀河谷 | 4203 | 21 / 2103 | 11 |

597 条定义中仍有 14 条在完整的原始 WorldArea 资源中无对应几何：主世界 13 条，scene101 一条。其中有测试、废弃、空名称，也有正常地名；不能笼统称为全部废弃，更不能补造边界。详见 `coverage-7.2.json`。这些记录保留目录但查询报缺失；同名跨场景区域要求用 ID 消歧。

## 坐标与数量验证

AppSample 的 lng/lat 是游戏地图投影坐标，不能当成 WGS84 或直接套用世界 x/z。使用客户端 `scene3_point.json` 的神像、传送锚点，按七国分别拟合二维变换；点 ID 能被 3 整除的独立样本不参与拟合。须弥有 84 个训练锚点、41 个独立验证锚点，验证最大偏差 8.876 个游戏坐标单位。该偏差是样本残差，不是全图误差上界。

额外取得 [Sam5440 公开采集坐标](https://github.com/Sam5440/Genshin_Impact_Teleport/tree/main/ManualCollectPoint/SpecialItems)：110 条 3.0 草神瞳全部一对一匹配 AppSample；66 条风神瞳记录中 62 条通过严格配对，4 条因重复目标或偏差/歧义排除。原始记录、源 blob、配对阈值和排除项均留档。社区采集坐标不是经过认证的客户端物件生成坐标。

实际执行「须弥的奥摩斯港有多少草神瞳」返回 **2 个**，以 `4203 奥摩斯港` 的原生范围、父区与高度为口径：

| AppSample ID | 三维对照 | 判定 | 距边界（游戏坐标单位） |
| --- | --- | --- | --- |
| 33876 | 3.0/c24 | 区内，计入 | 45.2035 |
| 33877 | 3.0/c26 | 区内，计入 | 4.7566 |
| 33859 | 3.0/c25 | 区外，不计入 | 27.8190 |
| 33860 | 3.0/c22 | 区外，不计入 | 64.4494 |

33877 的 AppSample 投影距界只有约 2.76，落在校准残差范围内，因此进行了三维坐标复核：确认在界内，高度也符合 [-2,1000]。两个入选点均无同级区域重叠，查询没有未核验边缘点或未知高度项。

数量只对应固定 AppSample 快照 `2026-11-09T20:39:02.715Z`，不能据此承诺全游戏永无缺点或所有任意区域查询都精确。原生“小区域”不一定等于攻略标题中的“附近”：例如星落湖的原生边界很小，周边山地需要另选范围。

## 可重复查询与验收

```sh
python3 prototypes/world-map/region_query.py \
  --data /Users/sorayama/.codex/visualizations/2026/11/09/01a1c014-f8de-7cb2-ab48-460de462f5ee/region-data/query-bundle-7.2.json \
  --question '须弥的奥摩斯港有多少草神瞳'

python3 prototypes/world-map/verify_region_index.py \
  --data /Users/sorayama/.codex/visualizations/2026/11/09/01a1c014-f8de-7cb2-ab48-460de462f5ee/region-data/query-bundle-7.2.json \
  --output /private/tmp/region-query-acceptance.json
```

新增脚本位于 `prototypes/world-map/`：`calibrate_regions.py`、`crosscheck_coordinates.py`、`build_region_index.py`、`region_query.py`、`verify_region_index.py`、`render_region_audit.py`。前者需要 numpy，其余索引/查询/验收使用 Python 标准库。按当前证据可供本地 Agent 调用；本轮没有把工具注册到线上问答服务，也没有发布。

验收覆盖：真实 2 点结果及 ID、凹多边形、边缘点、高度边界、最新 19 条区域、缺围栏拒绝、独立场景未校准拒绝、国家矛盾拒绝、“附近”范围不明拒绝。桌面 1280×900、手机 390×844 均无横向溢出和 JS 错误，72 张高清瓦片载入，缩放按钮、滚轮、拖动、复位可用。

通用查询保留 `requires-review` / `projected-snapshot` 状态，不能把所有校准投影都标成三维核验通过。独立地图还未做坐标校准；重叠子区域的引擎先后优先级未在本地查询实现，命中多区会标记复核。国家目录、地区围栏、资源点质量、线上 Agent 接入分别记录，不混同完成程度。

## 本地体验启动与构建复核

用户随后要求直接本地体验。已将 `/private/tmp/atlas72-cache` 的 2,901 个资产复制到交付目录 `atlas72-assets/`，72 张奥摩斯港高清瓦片复制到 `region-data/ormos-tiles/`。用持久输入与缓存执行 `build.py --online-hd` 成功，89,091 点、759 类型，保留原有 1 未命名类型和 1 缺片回退；构建不需要重新抓取资源。

本轮启动 `python3 -m http.server 48172 --bind 127.0.0.1 --directory <交付目录>`。地图 URL 为 `http://127.0.0.1:48172/teyvat-atlas-7.2-hd.html`，核验图为同地址的 `ormos-geofence-7.2.html`。服务是当前本地进程，不承诺机器重启后自动运行；启动、重建和查询命令补到 `prototypes/world-map/README.md`。

实际经 HTTP 浏览器验收：两个页面返回 200、8 类神瞳聚合、枫丹湖光铃兰 79 点、69143 进入古堡 B4、旧日之海 46 神瞳、奥摩斯港 72 瓦片与 2 个计入标点、查询索引 89,091 点/583 围栏。没有 JS 错误；验收文件为交付目录 `local-preview-readiness.json` 和 `local-query-readiness.json`。当前仍为独立原型，没有宣称主站聊天或全图通用小区域筛选已经接入。
