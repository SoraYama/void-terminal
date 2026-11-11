# 提瓦特资源图志：AppSample 7.2 本地原型

Canvas 可缩放瓦片地图、聚合与具体资源图标、分类/名称/ID 检索、分层与入口定位、七个独立场景。源点和楼层数据来自 AppSample；此目录保存代码、六个资源 SVG、一个参考游戏地图图标重绘的页头 SVG 和验收脚本，完整第三方数据和图片随本地预览保存，不加入仓库。

## 当前机器直接体验

2026-11-10 已从持久缓存重新构建，并启动仅本机可访问的预览：

- 全量地图：<http://127.0.0.1:48172/teyvat-atlas-7.2-hd.html>
- 奥摩斯港围栏核验：<http://127.0.0.1:48172/ormos-geofence-7.2.html>

若重启后服务已关闭，在终端运行：

```sh
ATLAS_DIR='/Users/sorayama/.codex/visualizations/2026/11/09/01a1c014-f8de-7cb2-ab48-460de462f5ee'
python3 -m http.server 48172 --bind 127.0.0.1 --directory "$ATLAS_DIR"
```

`atlas72-source/` 保存固定输入，`atlas72-assets/` 保存 2,901 个缓存资产，均位于上面的持久目录。地图已内嵌底图，放大后的更高清瓦片按需联网加载。无需启动 Next.js 或数据库即可体验这两个原型页面。

在项目根目录重建全图：

```sh
ATLAS_DIR='/Users/sorayama/.codex/visualizations/2026/11/09/01a1c014-f8de-7cb2-ab48-460de462f5ee'
python3 prototypes/world-map/build.py --source "$ATLAS_DIR/atlas72-source" --cache "$ATLAS_DIR/atlas72-assets" --output "$ATLAS_DIR" --online-hd
```

本地确定性查询可直接调用已有围栏索引：

```sh
python3 prototypes/world-map/region_query.py --data "$ATLAS_DIR/region-data/query-bundle-7.2.json" --question '须弥的奥摩斯港有多少草神瞳'
```

这两个页面是独立原型；围栏查询尚未接入主站聊天框，全量地图尚未提供通用小区域围栏筛选。`region-data/ormos-tiles/` 保存围栏核验页重建用的 72 张瓦片。

## 构建与验收

需要 Python 3 + Pillow，以及工作区已有的 Node.js / Playwright。

```sh
python3 prototypes/world-map/build.py \
  --source /path/to/pinned-source \
  --cache /path/to/assets-cache \
  --output /path/to/preview \
  --fetch
node prototypes/world-map/verify.cjs /path/to/preview/teyvat-atlas-7.2.html
```

去掉 `--fetch` 可用已有资产缓存离线重建。默认输出 `teyvat-atlas-7.2.html` 和 `audit-7.2.json`，浏览器直接打开 HTML，不需要服务端。两种文件名均默认按视野加载高清；加 `--offline` 才禁用运行时网络图片，用于离线专项构建。

加 `--online-hd` 沿用当前预览文件名 `teyvat-atlas-7.2-hd.html`。按视野从固定版本 AppSample CDN 加载原始瓦片：提瓦特最高 15、霜月 14、渊下宫/巨渊/旧日之海/空之神殿 13、远古圣山 12。按实际屏幕像素密度选层级，最多 6 个并发、256 张解码图缓存；移走视野取消未完成请求。断网/缺片保留内嵌底图，网络恢复事件会清除失败缓存重试。页面不展示高清开关或技术状态控件。

```sh
node prototypes/world-map/verify-hd.cjs /path/to/preview/teyvat-atlas-7.2-hd.html
node prototypes/world-map/verify-portals.cjs /path/to/preview/teyvat-atlas-7.2-hd.html
node prototypes/world-map/verify-ui.cjs /path/to/preview/teyvat-atlas-7.2-hd.html
```

高清验收会实际读取 CDN；普通 `verify.cjs` 通过测试环境关闭网络图，验证内嵌底图的搜索和交互。楼层 PNG 保持原始精度，放大不等于增加细节。

导航展示提瓦特及七个地区，独立地图菜单包含六张附属地图及褪色古堡分层入口。地区按钮与「定位地区」同步；除已有枫丹限定数据视图外，地区定位沿用源相机中心，资源总数仍标为提瓦特范围，不推造行政边界。列表默认按资源类型汇总，点类型可过滤并定位；纯数字或 `#编号` 精确检索单点，地图点击仍可打开详细位置和楼层。

跨场景入口用门洞 SVG 按钮，入口名与点击动作都根据 `targetMapKey` 解析到实际场景。返回主图统一标为「返回提瓦特」。放大、悬停或键盘聚焦显示名称，44px 点击区域支持手机；古堡等楼层中不展示跨场景入口。`verify-portals.cjs` 验证全部六组进入/返回及手机点击。

`--source` 需要 `markers.json`、`zh.html` 及七个场景的页面文件。取样地址：

- 点位：https://game-data.b-cdn.net/gim/markers_all.v5.compressed.json
- 中文目录：https://genshin-impact-map.appsample.com/?lang=zh
- `teyvat.html`：https://genshin-impact-map.appsample.com/
- `enkanomiya.html`：https://genshin-impact-map.appsample.com/enkanomiya/
- `chasm.html`：https://genshin-impact-map.appsample.com/chasm/
- `sea.html`：https://genshin-impact-map.appsample.com/sea-of-bygone-eras/
- `sacred.html`：https://genshin-impact-map.appsample.com/ancient_sacred_mountain/
- `space.html`：https://genshin-impact-map.appsample.com/temple_of_space/
- `moon.html`：https://genshin-impact-map.appsample.com/frost_moon/

这是版本固定的研究原型。刷新到下一游戏版本时需要重新确认公告、地图配置和分类，不能只修改版本标签。使用新的缓存目录防止同名源资产被旧缓存遮盖。

## 边界

- 当前快照为 2026-11-10 北京时间的数据，7.2 为官网与源地图声明的游戏版本；不把站点标点数称为游戏内全部可拾取物品。
- 「突破材料」按源目录的区域特产分类；「敌人与首领」是掉落来源，不表示掉落物直接摆放在该坐标。
- 宝箱品质、解谜和摩拉藏物分别分类。未知资源标签保留源编号；缺失楼层值不推断为地表。
- 全图离线瓦片为 10–12 档；枫丹追加 13–14 档，旧日之海和冰神瞳区域追加 13 档。在线高清按视野补齐各场景源图最高档。缺失单张瓦片用已有低档瓦片回退，不生成假地图。
- 列表按资源类型聚合并分批展示，地图仍绘制筛选后的全体点；切图与楼层切换保留查询文本。默认神瞳为 8 行，不再逐点重复展示。
- 六个 SVG：水神瞳、苍晶螺、湖光铃兰、虹彩蔷薇、精致宝箱、摩拉，按 AppSample 的游戏物品参考重绘，用于本地原型；其余资源使用 AppSample 相应图标。
- 数据、图片与自定义图标的来源和对外使用范围需在公开发布前确认；本次交付为本地文件。
