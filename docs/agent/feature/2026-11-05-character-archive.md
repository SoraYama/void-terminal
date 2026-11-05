> **Date / Revised**: 2026-11-05

# 群星图鉴 / Character Archive

## 1. Background & Problem

用户要求以游戏角色菜单展示立绘、头像、属性数值、故事、语音、天赋和命座，确认模块名为「群星图鉴」，并明确授权直接实现。此前只有角色相关文献，没有结构化角色页面。实施前证据保留在 [审计记录](../research/2026-11-05-characters.md)；方案与计划在 `docs/superpowers/{specs,plans}/2026-11-05-character-archive*.md`。

## 2. Approach & Changes

- 以 Avatar ID 与 AvatarSkillDepot ID 精确聚合中英记录、合法等级/突破边界、原始倍率、角色形态、六个来源命座节点、故事分支与解锁条件、培养材料。未知数值不补零，未解析文本不输出模板语法。
- 新增快照绑定的角色目录、详情、覆盖和音频接口，SQLite/PostgreSQL 表与原有文献/物品原子导入。旧只读库无角色表时返回未构建状态，不迁移历史库；字符数据和媒体证据参与语料摘要。
- 图像使用固定源映射与精确 `UI_` / `Skill_` 标识，经格式/尺寸验证后展示。语音按 Avatar、台词 ID、资源类型及原始路径 FNV-1 哈希关联固定 revision 的 ZIP 成员，不按角色名模糊匹配。读取 ZIP 目录与选中成员有界；播放时验证 CRC 和 PCM，单片段 16 MiB、最多四个并发加载、32 MiB 内存缓存。
- `/characters` 与万象集录并列：筛选网格、头像切换、中央立绘、属性/命之座/天赋/资料/培养、原文与询问草稿；支持中英、明暗主题、手机、键盘、减少动态效果、直链和浏览器返回。语音主动播放，切换身份/条目/语言/分区时停止并释放资源。
- Noto Serif SC 600 自托管标题子集覆盖新中英文标题，来源和许可记录于字体 README 与 THIRD_PARTY_NOTICES；不捆绑完整游戏媒体库。

契约：`docs/characters-contract.md`。操作入口：README 的「群星图鉴」。实现分工与审查记录：`.superpowers/sdd/2026-11-05-character-archive/`（本地任务产物）。

## 3. Real-data Evidence

本地验收主源 `bd35e243fa436f141f015cf221a6e19d0c34b7ca`，补充源 `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`；角色图像映射 Git blob `7842ed8f958e5292b87a1fbc7fed58c258c139bf`。音频数据集 `simon3000/genshin-voice` 固定 revision `68950dc52d799876d1e64c1ab6c47955502e79a1`。

验收快照 `character-preview-53eea8cb88906a53` 包含 338 个本地化角色记录（169 个 Avatar ID）、632 个本地化培养物品和 22,484 篇实际关联文献，材料与文献链接无缺失。此库的**文献语料为验收子集**，保留原始数据及来源，不可替代生产全量库；现有发布库未改动。

默认显示 134 个 `AVATAR_FORMAL` 来源角色；另有 4 个明确内部记录和 31 个未分类记录，需显式开启。该标签与记录数不能证明角色已发布或可获取。134 个默认记录均有已验证头像，124 个有立绘，95 个有至少一条已索引音频。中英两份数据共 56,626 个配音映射（不是独立台词数）。492/496 个语音目录成功索引；四个派蒙大归档未通过有界读取，失败项保留在媒体报告。新角色的补充映射及部分音频缺失仍按真实状态显示；旅行者无可验证立绘时不伪造资源。

真实 Chromium 中播放纳西妲初次见面四种原声：汉语 1,565,804 bytes / 16.31 秒，英语 2,437,730 / 25.392563 秒，日语 2,161,466 / 22.514813 秒，韩语 1,545,794 / 16.101563 秒；均为 200 audio/wav，播放时间前进、单播放器、语言/分区切换停止。此验收不表示已逐条试听全部索引音频。

产物均在忽略目录 `artifacts/characters/`：`coverage-summary.json`、`real-acceptance.json`、`capture-results.json`、桌面/手机明暗主题及语音/天赋/命座/故事截图。截图等待可见原图加载完成；没有用合成图或夹具截图充当真实数据验收，没有调用聊天模型。

## 4. Validation & Review

最终 Python 回归：250 passed、19 subtests passed、7 optional PostgreSQL skips；未提供真实 PostgreSQL 测试实例，不以 SQLite 验收替代 PostgreSQL 并发验证。Web：15 个测试文件、288 项单测全部通过；TypeScript 与 Next.js 生产构建通过。已有 Starlette/Vite 测试工具提示不影响通过。日志为 `python-final.log`、`web-final.log`、`build-final.log`。

生产模式本地浏览器完成群星图鉴 18 项桌面/手机回归：等级突破、天赋、条件分支、材料快照、语音失败重试和停止、筛选返回、草稿恢复、旧快照、慢响应取消、冷启动头像、直链初始化失败重试、材料跳转保留草稿。另有真实数据的英文与旅行者风/岩形态切换、缺失立绘和滚动恢复检查，记录在 `real-navigation.json`；无页面错误、溢出或模型调用。

万象集录兼容性回归覆盖 22 项通过、4 项既有手机跳过。组合运行首次为 39 passed / 4 skipped / 1 failed：手机浅色图片等待超时，trace 中七个远程 Yatta 图片请求均未收到响应；未修改物品代码，定向复跑该场景 1 passed（8.5 秒）。保留 `e2e-final.log`、`museum-mobile-light-initial-trace.zip` 与 `museum-mobile-light-rerun.log`，不把复跑结果写成首次全绿。合计已通过 18 个角色和 22 个物品场景。

数据与服务的两次独立审查分别修复故事性别分支/突破缺相位，以及音频语言和原路径哈希绑定。最终独立代码审查复现并关闭三项 P2：初始列表失败时详情无重试、材料整页跳转丢失草稿、手机返回按钮无可访问名称。独立视觉审查关闭同名故事条件版本不明确的问题，新增「另一条件版本」、未解析条件说明和来源入口，复审结论 ship。记录在本地任务目录 `final-review.md` 与更新后的 `task-3-report.md`。

设计 detector 因引擎未安装且默认缓存位于可写范围外而未启动；没有宣称自动设计检测通过，采用新独立审查者对真实截图执行 craft-floor 检查。

## 5. Conclusions / Boundaries

在 `codex/character-archive` 本地分支实现和验收。未提交、推送或部署生产，也没有触发生产刷新计划、激活生产快照、发送用户消息或调用付费模型。后续发布应基于完整的新候选语料按既有验证/激活流程进行，不能直接拷贝本地验收子集上线。
