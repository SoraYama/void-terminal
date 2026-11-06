> **Date / Revised**: 2026-11-05 (created) / 2026-11-06 (revised)

# 群星图鉴生产发布

## 发布状态

已于 **2026-11-06 11:17:40（北京时间）** 发布至 [群星图鉴](https://void-terminal.sorayama.moe/characters)。活动快照为 `agd-d7f2135c7eb0-26ae8d6dbac3`，发布单元 `void-character-release-782f590` 成功结束。公开 API、六组真实浏览器布局和纳西妲四语实际播放验收均通过。

完整快照包含 1,560,947 篇文档、1,697,353 个片段、27,650 条本地化物品记录及 338 条本地化角色记录（169 个源 Avatar ID）。角色图片验证映射 584 条、语音映射 56,626 条；不将本地化映射数量等同于独立图片或台词数。默认每种语言显示 134 个正式来源记录，不据此断言均为已发布可获取角色。

用户确认群星图鉴、尘世文卷更名、原版导航与七元素图标，以及角色身份区的五项布局细化后，明确要求推送并发布线上；随后要求代码合并 `main` 并提交推送。

## 代码与检查

- 功能提交 `d40d6131f0b092be203474e23f04b45560f05714`；前端修复 `5953b39ada0a90183dc5c2042603a950c575d39f` 已快进合并到本地 `main`。来源修复 `336e6eaff2e32c191bfdd1cf0fa9f5f3d9096b75` 直接在 `main` 提交并推送。
- 首次 CI 捕获手机历史列表被压成 0px，修复见 [手机侧栏记录](../bugfix/2026-11-05-sidebar-history.md)。保留 88px 最小高度，由侧栏外层承接短屏滚动。
- 来源修复 [CI](https://github.com/SoraYama/void-terminal/actions/runs/42026036154) 全部通过：Web 单测 288、Python 257（1 个既有跳过）、评测 10、主机发布控制器 31、浏览器 113（7 个既有跳过）；类型检查和生产构建通过。包含真实 PostgreSQL 服务验证。
- 同源基线重验工具提交 `782f590f7158cb5e487c72d9ddc6382e5de15b7d` 已提交并推送 `main`；新增 5 项回归，主机控制器共 36 项通过。[代码提交 CI](https://github.com/SoraYama/void-terminal/actions/runs/42152426651) 全部通过：Web 288、Python 257（1 跳过）、评测 10、主机控制器 36、浏览器 113（7 跳过），类型检查与生产构建通过。
- 本地真实资料预览仅用于 UI / 媒体验证，绝未替换生产完整语料库。

## 生产构件与来源

- 生产控制器目录：`/opt/void-terminal/catalog-refresh/code-782f590`。
- Web 镜像：`sha256:99888eec5471b74c916b721a71d5a8e62bddcd281ec7125f012b428c0dd0dd6f`。
- Knowledge / 构建 worker：`sha256:72681fbeef7dbc0f87badcc996c57c676aa54d1c49212682f7d8236c87a7f8d0`，基于 336e6ea。Web 镜像来自 5953b39；服务器 `git diff` 确认后续提交未改变前端源码、依赖或 Web 构建输入。
- 官方来源固定为 AnimeGameData `d7f2135c7eb0052e842e0f187f4e5bb88c304737`、genshin-db `8e5badd60b5d894284ccc927a56c9683529d2592`。
- 完整演练目录：`/opt/void-terminal/catalog-refresh/rehearsals/characters-336e6ea-cached2`；已于 11 月 5 日 15:00 UTC 通过。当前基线重验目录：`characters-782f590-revalidated`，于 11 月 6 日 03:02 UTC 前通过。此前报告均保留在各自目录；发布凭据：`/opt/void-terminal/releases/characters-d40d613-20261105`。
- 在完整语料上生成角色数据，经原图验证、固定版本语音压缩包目录索引、完整入库、只读 SquashFS 打包，再验证候选快照与旧公开引用；发布前额外重算 item 差异、读取中英文纳西妲属性/六命座/四语音频索引/培养材料链接。

## 回退与边界

- 首轮候选在全量入库后的来源校验被拒绝，生产注册表未改变；原因及修复见 [角色图片来源记录](../bugfix/2026-11-05-character-provenance.md)。失败候选按既有流程清理，重建前已将来源校验前移到入库前。
- 第二轮真实 338 条角色记录已通过新的来源预检，但缓存复用遗漏 `images.json`，引发不必要的图片请求；在入库前主动停止私有演练，改用首轮完整缓存。第三轮在来源计划阶段遇到 GitHub 匿名 API 限额，按官方 reset 等到 13:20:40 UTC 后重新启动。未改变生产服务或绕过来源验证。
- 最终演练在私有目录原子复用完整 `images.json` 与 characters/pathofgenshin/tcg 缓存，保留原始验证时间和正常有效期规则。确认主机约 7 GiB 可用内存后，仅将本轮 worker 上限临时设为 4 GiB / 含 swap 共 5 GiB，CPU 配额仍为 1，不改变每日任务配置。收据为 `retry-resources-cached2.json`。
- 入库超过 110 万条后观察到持续磁盘等待，worker 无 swap 使用或 OOM，主机仍有约 5.8 GiB 可用内存；于 14:03:34 UTC 将该 worker 临时提高至 5 GiB / 含 swap 共 6 GiB，为文件页缓存留出更多空间，仍限制 1 CPU。生产服务和每日任务配置未变，收据为 `retry-cache-headroom.json`。

- 最初演练的活动快照：`agd-d54f6f0d423d-55591f5f9115`，1,560,947 文档 / 1,697,353 片段。每日刷新于 11 月 5 日 21:43 UTC 发布同源快照 `agd-d7f2135c7eb0-fdc87109fe9f`；原演练凭据因注册表变化失效，按 [同源重验流程](../bugfix/2026-11-06-rehearsal-revalidate.md) 重新验收，未修改旧报告或回退每日刷新。
- 发布前控制器 `code-f8743dd`，Knowledge 镜像 `sha256:b7ee2b0dde43fbc8f13ede67f7c9f6e79f8f6aa3142d05500069d1b91f2536b1`，Web 镜像 `sha256:44d6456c99d01b6bdd13f525fd4f6363aa7037b77fbf4466ae9f4e02c4cc1915`；原注册表、设置和镜像信息保留在 `before.json`。
- 实际切换前后的状态分别记录在 `prepublication.json`、`postpublication.json`，当前基线审计无退化或物品删除。额外角色检查首次因临时脚本未关闭 SQLite 连接而无法卸载私有挂载；改用 `contextlib.closing` 后重新通过全部检查并正常卸载，再继续发布，没有强制卸载或跳过校验。
- 使用现有 `catalog_release_enrichment.py` 的锁、源提交与审计验证、精确镜像部署、快照提升及回退逻辑；以 systemd oneshot 执行并配置 `ExecStopPost ... catalog_refresh.py recover`。保留历史快照、只读挂载传播及 Caddy 卷。
- 语音索引成功不等于每条语音均播放验证。候选索引 492/496 个压缩包，派蒙四语压缩包不可验证；资源缺失保持显式缺失状态。线上实际播放抽查纳西妲初次见面四种语言，均通过。
- 不发送模型请求，不使用用户 API Key；不变更每日刷新定时器。

## 线上验收

- 公开接口返回新活动快照且 `ready=true`；完整文档/片段数量符合预期。中英文默认角色各 134 个，草元素筛选各 12 个，纳西妲立绘、六命座与故事均正常。
- 真实 Chromium 完成桌面与手机深浅主题、平板、英文六组检查。元素图标在加粗姓名前，星级在姓名后，副标题为「白草净华 · 法器」；桌面姓名和属性标题均在 y=142，平板均在 y=184。手机单列显示正常，无横向溢出或页面错误。已目视复核线上桌面、手机截图。
- 纳西妲初次见面语音四种语言均返回 `200 audio/wav` 并实际解码播放：汉语 1,565,804 bytes，英语 2,437,730，日语 2,161,466，韩语 1,545,794。验证播放时间推进、单播放器、切换语言/页签停止旧音频；天赋、命座、故事和手机资料页正常。没有发送模型请求。
- 生产两个容器均使用指定镜像且健康；三个已有不可变快照条目与 legacy 配置完整保留，固定和不固定快照的历史引用验收通过。每日刷新定时器保持 active，`enrichmentEnabled=true`。
- 本地凭据位于 `artifacts/characters/production/`：`deployment-receipts.json`、`public-readback.json`、`identity-results.json`、`real-acceptance.json` 及实际页面截图。初次本机 urllib 请求出现 403/TLS 握手超时；curl 与真实浏览器访问正常，最终公开 API 验收使用 curl，未修改站点访问控制。
