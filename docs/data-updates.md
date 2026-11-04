# 数据更新与道具资料发布

知识库与博览馆共用不可变快照。新请求默认读取活动快照，带 `snapshotId` 的历史引用继续读取对应旧快照。日常更新走服务器端流程；下方的离线手工步骤保留为历史发布和故障排查参考。

## 服务器自动更新

`void-catalog-refresh.timer` 在启用后每天北京时间 04:30 触发，服务器关机错过的任务会在恢复后补跑。检查 [AnimeGameData](https://github.com/DimbreathBot/AnimeGameData/commits/main/) 和 [genshin-db](https://github.com/theBowja/genshin-db/commits/main/) 的 `main`；提交对不变时立即结束。更新在生产服务器隔离容器构建，无需打开本机、Codex 或浏览器。

```sh
systemctl list-timers --all void-catalog-refresh.timer
systemctl status void-catalog-refresh.service --no-pager
journalctl -u void-catalog-refresh.service -n 80 --no-pager
cat /opt/void-terminal/catalog-refresh/state/last-run.json
# 需要立刻检查时，触发与定时器相同的流程。
systemctl start --no-block void-catalog-refresh.service
```

`published` 表示线上验收已通过，`unchanged` 表示两源均未变化。`failed` 或 `rolled-back` 时，先看日志定位来源、容量、构建或验收问题，再确认公网 `/api/status` 仍指向原快照。不要手改运行中的 `registry.json`，也不要清理已有发布文件；磁盘空间不足时更新会停止，保留既有快照。任务进行中以 systemd 和日志为准，`last-run.json` 保存最近一次完成的结果。

每次固定两源提交，验证来源、语种、道具分类、图片覆盖和 SQLite 完整性。新的压缩快照先挂载并在知识容器内读取，再原子切换活动快照。公网状态、道具详情、文献和旧引用通过才保留切换；失败或发布过程中断时恢复原注册表。若两源提交没有变化，重试会优先重新校验并复用最近一次完整打包的候选归档。构建记录保存在 `state/staged-result.json`，工作目录清理或发布回退后仍可重试；校验不通过时保留现网快照。已有 SQLite 和预算表保留原位，重启时由 `void-catalog-mounts.service` 恢复归档挂载。实现细节见[自动更新设计](superpowers/specs/2026-11-04-catalog-refresh-design.md)。

更新应用代码和日常同步数据是两件事。管理已启用自动更新的生产容器时，使用同一组 Compose 文件，保留知识服务的只读挂载：

```sh
cd /opt/void-terminal/app
docker compose -f compose.sqlite.yaml \
  -f /opt/void-terminal/catalog-refresh/code/deploy/compose.catalog-refresh.yaml ps
```

从 2026-11-03 生产基线首次接入时，将校验过的发布提交归档解到 `/opt/void-terminal/catalog-refresh/code-<短提交>`。在服务器以 root 执行，`REV` 为七位提交前缀：

```sh
cd /opt/void-terminal/catalog-refresh
docker build -t "void-terminal-knowledge:catalog-refresh-$REV" \
  -f "code-$REV/deploy/Dockerfile.knowledge" "code-$REV"
bash "code-$REV/deploy/bootstrap-catalog-refresh.sh" "$REV"
systemd-run --unit=void-catalog-commission-20261104 \
  /bin/bash /opt/void-terminal/catalog-refresh/code/deploy/commission-catalog-refresh.sh
```

引导脚本要求现网还在 2026-11-03 基线，保留旧镜像，检查 Compose 切换前后都能读取旧数据；失败时恢复原知识容器。接入任务在服务器后台持续运行，首次发布及历史引用验证通过、复查两源均无变更后才启用定时器。可用 `journalctl -u void-catalog-commission-20261104` 查看接入过程，首次发布记录保存在 `state/commission-first-publish.json`。此脚本只用于首次安装；日常检查使用 `void-catalog-refresh.service`。

以下第 1–6 节记录切换到自动更新前的流程。日常同步使用上面的 systemd 入口，避免绕过注册表或替换承载历史数据的 SQLite。

## 1. 固定并校验上游版本

检查两个仓库的 main Atom feed 与 GitHub commit API：

- https://github.com/DimbreathBot/AnimeGameData/commits/main.atom
- https://github.com/theBowja/genshin-db/commits/main.atom

变更 `sources/manifest.json`、`knowledge/ingest/normalize.py` 中的提交，以及 `acquire.py` 中的 Git tree、TextMap 大小和 Git blob 清单。提交和根 tree 不是同一个值，使用 git-commit API 中的 `tree.sha`。补充源提交改变时，重新生成固定 blob 清单；不能把截断的 recursive tree 当成完整清单。

保留 `gameVersion:null`，除非另有可核实的正式版本证据。上游标签和内部配置不等于当前可获取的游戏物品。

## 2. 本地获取、构建和图片检查

从仓库根目录运行，Python 使用已安装的 knowledge 环境：

```sh
export PYTHONPATH=services/knowledge
services/knowledge/.venv/bin/python -m knowledge.ingest fetch --source main --destination data/raw/main
services/knowledge/.venv/bin/python -m knowledge.ingest fetch --source supplement --destination data/raw/supplement
services/knowledge/.venv/bin/python -m knowledge.ingest normalize --input data/raw/main --supplementary data/raw/supplement --output data/normalized-current
services/knowledge/.venv/bin/python -m knowledge.ingest verify-images --normalized data/normalized-current --cache data/item-image-checks.json --workers 12
```

检查 `snapshot.json`、`coverage.json`、`report.json`、`item-coverage.json` 和下载标记。图片检查会更新未发布的物品文件和快照摘要，因此必须在导入前完成。失败可重试并利用校验缓存；不能修改已发布快照下的物品 payload。

覆盖报告区分：完整、不适用、上游缺失、尚未解析、图片不可达。测试和废弃记录保留来源并默认隐藏；不可用图片使用类型图标，不用生成图片代替游戏资源。

## 3. 在离线数据库中导入

先通过 SQLite backup API 取得当前库的一致副本。不要只复制正在使用的 `catalog.sqlite` 主文件，WAL 可能包含尚未合并的数据。已有旧快照的一致副本作为离线 `data/catalog-release.sqlite`，确保历史引用仍可访问。

```sh
export DATABASE_URL="sqlite:///$(pwd)/data/catalog-release.sqlite"
export EMBEDDING_ENABLED=false
services/knowledge/.venv/bin/python -m knowledge.ingest import --normalized data/normalized-current --no-activate
services/knowledge/.venv/bin/python -m knowledge.ingest snapshots
```

读取 `snapshot.json` 中实际生成的 ID，检查新旧文档、物品与覆盖。确认后用 `activate <实际快照 ID>` 激活离线副本。再做完整性、代表数值、旧快照引用、搜索和网页验证；不能直接在仍服务请求的线上 SQLite 中进行长时间全量导入。

## 4. 发布到现有 SQLite 服务器

生产目录：代码 `/opt/void-terminal/app`、数据库 `/opt/void-terminal/data/catalog.sqlite`，SSH alias 为 `void-terminal`。仅使用 `docker compose -f compose.sqlite.yaml`；默认 `scripts/update.sh` 面向另一种数据库部署，不能直接套用。

1. 确认代码版本、干净工作区、磁盘空间和镜像构建成功。估算空间时同时计入旧库、新库、备份、WAL 与压缩包。
2. 在本地 checkpoint 离线库并关闭连接，压缩后记录压缩和解压 SHA-256，上传到服务器独立 staging 路径并复核。
3. 保留上一版代码提交与容器镜像。短暂停止 web/knowledge，执行 `PRAGMA wal_checkpoint(TRUNCATE)` 并确认没有 busy/未合并的 WAL；关闭所有连接后，可将完整旧库重命名为回退副本，或使用 SQLite backup 导出。不能删除未合并的 WAL，也不能在旧进程仍打开文件时切换。
4. 将当前 `budget_days`、`budget_reservations` 的一致状态迁入新库，保留新快照的活动指针。即使目前共享模式关闭，也不要以旧归档覆盖运行期状态。
5. 以原子重命名切换经过验证的新库；数据目录由 UID/GID `10001:10001` 拥有，目录 `0750`，库文件 `0640`，目录允许 SQLite 创建 WAL/SHM。
6. 启动 knowledge/web，检查 readiness、最新 sourceCommit、物品列表及详情、关键属性、图片、文档搜索、旧引用和 SSE；最后再记录发布成功。

已有用户明确授权本次线上数据更新。后续发布仍应按当次任务的授权范围执行，不以本文自动扩大权限。

## 5. 回退

验证失败时停止 web/knowledge，保留失败的新库及其 WAL/SHM 为同一组证据，恢复发布前的一致数据库和旧代码提交，再重新启动。先从停服后的新库迁回最新预算状态；损坏库读取可能改变 WAL/SHM，因此先保留完整失败文件组，再通过只读主文件硬链接与独立 sidecar 副本读取，不能直接打开证据组做恢复。预算无法读取时保留证据并明确记录待核对状态。验证 readiness、活动快照和旧引用。

若代码与数据库均正常，单纯选择以前的快照可以用 `python -m knowledge.ingest rollback <旧快照 ID>`；旧快照没有结构化物品时，博览馆会显示尚未构建，不能混用新快照的道具。

## 6. 2026-11-03 发布基线

- 功能提交：`94d9881e6fcc099a06e3521bafcdd4c9ea97101e`；后续仅文档提交不改变镜像内容。
- 当前快照：`agd-bd35e243fa43-9f534ea4c12d`；保留快照：`agd-792978e5503e-1ac83cf28961`。
- 发布目录：`/opt/void-terminal/releases/item-museum-20261103`，包含 `release-manifest.json`、`staging-verification.json`、`cutover-before.json`、`activation-result.json` 和已审查的操作脚本。
- 原代码：`d10fd2510f6f47f3669a46d7fbf6d6fe8b45762e`；原数据库：该发布目录下 `catalog.before-museum.sqlite`。
- 原镜像：`void-terminal-knowledge:before-item-museum-20261103` 与 `void-terminal-web:before-item-museum-20261103`。知识服务实际 ID 为 `sha256:31ffb49cc2fc673499bbb25c19439700e69e3d11cc8c0233214632c7c0ee4227`，Web 为 `sha256:a1b7f8bd01b890d872e017afe336728b9e62edc922d6f3ca7f62a2a5d0675ef3`；回退前核对实际 ID，不使用旧日志中的过期 latest 标签。

在服务器上只读复验本次发布（SSE 使用无效密钥检查来源和预期鉴权错误，不发生付费生成）：

```sh
python3 /opt/void-terminal/releases/item-museum-20261103/verify-release.py \
  --origin https://void-terminal.sorayama.moe \
  --snapshot agd-bd35e243fa43-9f534ea4c12d --sse
```

如需完整版本回退，先按第 5 节停服、迁回预算和恢复一致旧库，再执行以下代码/镜像恢复命令；不能在新旧进程仍打开数据库时移动文件：

```sh
cd /opt/void-terminal/app
git checkout --detach d10fd2510f6f47f3669a46d7fbf6d6fe8b45762e
docker tag void-terminal-knowledge:before-item-museum-20261103 void-terminal-knowledge:latest
docker tag void-terminal-web:before-item-museum-20261103 void-terminal-web:latest
docker compose -f compose.sqlite.yaml up --no-build -d --wait --wait-timeout 240 knowledge web
```

本次 19:18:45（Asia/Shanghai）切换完成，公网 API/SSE 与桌面/手机真实资料验收通过。19:19:48 复查两个上游官方 Atom feed，分别仍为 `bd35e243fa436f141f015cf221a6e19d0c34b7ca` 和 `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`。这些提交是 2026-11-03 发布的基线。
