# Agent 地图查询与卡片协议

地图查询已接入现有 Agent 的只读工具链。模型选择地区与资源，服务端计算点位归属、数量和待复核项，再通过 SSE 发出地图卡片。地图数据与原文库各自固定版本，不能互相替代。

## 本地运行

已准备数据时，从仓库根运行：

```sh
npm ci
npm run build
npm run start
```

打开 `http://localhost:3000/map`，或从首页侧栏进入「提瓦特舆图 / Teyvat Atlas」。地图页不需要模型 Key，可搜索并选择国度、区域、资源；URL 保留地区、资源及地图快照，支持刷新与前进后退。默认展示已核验的奥摩斯港草神瞳。当前未校准的独立场景会显示明确限制。

需要对话查询时，在设置中配置自己的模型 API Key，再提问“须弥的奥摩斯港有多少草神瞳”。地图独立查询不依赖原文知识服务；原文考据与混合问题仍使用原有知识服务。

Web 默认读取 `<repo>/data/maps`，也可设绝对路径 `MAP_DATA_DIR`。数据不纳入 Git、不打包进 Docker 镜像；两个 Compose 配置通过 `MAP_DATA_HOST_DIR` 将目录只读挂载到 `/data/maps`。保留历史目录，历史对话不会回退到新版本。

从留存输入准备数据（Python 3 标准库即可，输入不改动）：

```sh
python3 scripts/prepare-map-data.py \
  --bundle /absolute/region-data/query-bundle-7.2.json \
  --assets /absolute/atlas72-assets \
  --extra-tiles /absolute/region-data/ormos-tiles \
  --output /absolute/data/maps
```

可选 `--source`（AppSample 页面目录）、`--game-data`（TextMap/ExcelBinOutput 目录）、`--area-config`（核验使用的 WorldArea 配置）用于带来源哈希的英文名称补全。不会凭空翻译缺失名称。

产物为 `current.json` 和不可变 `map-7.2-<hash>/`，每个版本包含 manifest、bundle、asset index 和图片。准备脚本重复运行只验证，不覆盖已变动的版本；服务端检查内容哈希、目录范围和图片类型。

## 只读工具与 HTTP

- `search_map_regions({query,country?})`：地区名称/ID、中英名称搜索；返回所属国家、父区、场景及围栏/校准可用性。
- `query_map_resources({region,resource,country?})`：精确地区和资源统计；模糊资源名返回候选，不能把一个类型的数量当整个类别总数。
- 工具固定使用当前请求的 `mapSnapshotId`，模型参数不能覆盖版本。
- `GET /api/maps/catalog?snapshotId=...`：供地图页使用的完整地区和资源目录，包含快照、版本、数据时间及中英文名称；省略版本时返回当前目录。

```sh
curl 'http://localhost:3000/api/maps/regions?q=Port%20Ormos'
curl http://localhost:3000/api/maps/query \
  -H 'Content-Type: application/json' \
  -d '{"region":"奥摩斯港","resource":"草神瞳"}'
```

两接口可传 `snapshotId` 指定地图版本。查询成功返回 `{card: MapCard}`；歧义、缺围栏、独立场景未校准等返回 HTTP 422 及 `{error,message,candidates?}`，绝不转换为数量 0。缺失历史快照返回 `MAP_SNAPSHOT_UNAVAILABLE`。地图图片仅通过同域 `/api/maps/assets/<snapshot>/...` 的受限路径读取。

## 聊天协议

`ChatRequest.mapSnapshotId` 是可选地图版本；原有 `snapshotId` 仍只表示原文库版本。

```text
event: maps
data: {"mapSnapshotId":"map-7.2-…","maps":[MapCard]}

event: text_delta
data: {"text":"奥摩斯港范围内有 2 个草神瞳……"}

event: done
data: {"finishReason":"stop","mapSnapshotId":"map-7.2-…","maps":[MapCard]}
```

`maps` 是该回答当前的完整卡片集合，最多 4 张；最终 `done.maps` 再次保留完整集合。纯地图回答可以没有原文 `snapshotId`。现有角色/武器/圣遗物 `cards` 协议保持独立。

`MapCard` 的运行时校验及 TypeScript 类型位于 `apps/web/src/lib/map-cards.ts`：

- `schemaVersion: 1`、`kind: resource-map`、稳定 ID、地图快照/游戏版本/数据时间。
- `region`、`resource`、完整 `count`、`status`、边界/高度/重叠待复核计数。地区含可选 `nameEn`、`countryEn`、`parentNameEn`；资源含可选 `nameEn`，旧卡片仍兼容。
- `map` 固定底图与投影、瓦片版本、缩放级别和视野范围。
- `polygons` 是子区多边形集合；存在 `parentPolygons` 时，显示与统计的平面范围是两者并集的交集。
- 最多 500 个 `markers`；`included` 计入，`nearby`、`review` 不计入。点位包含原始 ID、投影坐标、三维核对状态与已知高度/楼层。`truncated` 表示只裁剪展示点，`count` 仍是完整查询结果。
- 坐标已经是 `x=AppSample lng, y=-Mercator(lat)`；客户端不能再次投影。瓦片源 Y 向上，绘制 top 为 `(-sourceY-1) * 360 / 2^zoom`。
- 来源 URL、图片派生路径、点数、坐标范围、几何规模和版本均校验。模型不能提供任意 HTML 或外部图片地址。

浏览器通过 Canvas 绘制高清瓦片、交集围栏与标点；支持缩放、拖拽、双指操作、聚合和键盘/列表选择。地图字段随 IndexedDB 历史保存；旧消息无地图字段仍正常读取。未知 schema 或畸形卡片不渲染。导出 Markdown 保留数量、地区、版本、状态和来源。

## 证据边界与验收

`crosschecked` 表示计入点有公开三维坐标交叉核验，不代表官方全量出生点或玩家实时采集状态。`projected-snapshot` 是地图投影统计；`requires-review` 必须展示边界、未知高度及重叠的不确定性。原始场景3之外的坐标校准未完成；缺围栏和锚点的地区不产生统计卡。高清瓦片优先读取留存资源，缺片仅向固定 AppSample 版本路径补取，离线则明确降级。

```sh
npm run typecheck
npm test
npm run build
MAP_E2E_REAL_DATA=1 npm run test:e2e --workspace @void-terminal/web -- tests/e2e/map-chat.spec.ts
```

`map-agent.test.ts` 使用真实 DSH 执行器与地图查询，仅模型 HTTP 输出受控；`map-chat.spec.ts` 使用实际地图 API/资源和受控聊天流验收交互、增量消息及历史。它们不等同于付费模型的实网连通验收。
