# 数据更新与道具资料发布

知识库与博览馆共用不可变快照。网页请求只读取活动快照；上游仓库有新提交不会自动覆盖线上。更新需要下载、构建、检查和发布。

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

验证失败时停止 web/knowledge，保留失败的新库及其 WAL/SHM 为同一组证据，恢复发布前的一致数据库和旧代码提交，再重新启动。验证 readiness、活动快照和旧引用。

若代码与数据库均正常，单纯选择以前的快照可以用 `python -m knowledge.ingest rollback <旧快照 ID>`；旧快照没有结构化物品时，博览馆会显示尚未构建，不能混用新快照的道具。
