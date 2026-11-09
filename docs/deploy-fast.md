# 最快落地：单台服务器 + Docker Compose + Caddy

这个项目需要常驻检索服务和大语料数据库。本文默认部署 `DEPLOYMENT_MODE=self-hosted`：用户在浏览器设置中填写自己的模型 Key，无需 Supabase、SMTP、登录或积分。低流量试运行使用独立的 `compose.sqlite.yaml`，在同一台服务器运行 Web、知识服务与 Caddy，直接复用已有 SQLite 完整快照。默认关闭向量模型，不需要 GPU。Caddy 能自动申请和续期证书；域名需指向服务器，80/443 端口可达。[官方 HTTPS 条件](https://caddyserver.com/docs/automatic-https)

本文的 PostgreSQL 同机导入方案可先按 **4 vCPU、8 GB RAM、150–200 GB SSD** 保守估算；这不是项目最低配置，也不是并发容量或 PostgreSQL 空间保证。本机 SQLite 索引约 18 GB，规范化语料约 4.7 GB；此方案还要容纳 PostgreSQL 索引、导入临时空间、原始来源和备份。默认自托管模式关闭向量模型，不需要 GPU。向量化及更高并发需另外测量。

`compose.yaml` 仍是 PostgreSQL 方案；不要与 `compose.sqlite.yaml` 合并使用。下面先给 SQLite 单机路径，后面的 PostgreSQL 部分保留给需要向量模型或更高语料查询并发的部署。托管版积分账本独立存放在 `accounts` 卷的 SQLite 文件中，两种语料后端都支持，不要求 PostgreSQL。40 GB 磁盘对并存两份完整快照或全量重建可能不足。参见 [长期自费云机器比较（2026-11-02）](agent/research/2026-11-02-cloud-cost.md)。

官方托管版使用同一仓库和同一镜像，在运行时显式设置 `DEPLOYMENT_MODE=hosted`，并按 [账户与积分运维指南](operations/account-trial.md) 配置邮箱登录、积分与服务器模型服务。托管版不提供 BYOK；依赖未就绪时拒绝生成，不会降级。未设置模式时默认自托管，显式空值或其他值会按配置错误拒绝服务。修改运行模式需要重新创建 Web 容器，无需为模式重新构建镜像。

## SQLite 单机部署

服务器安装 Docker Engine / Compose，域名 A 指向服务器，开放 22、80/tcp、443/tcp 与 443/udp。知识服务与 Web 不发布宿主端口。数据目录必须允许容器 UID 10001 写入，因为 SQLite 会创建 WAL/SHM 文件。

```sh
git clone --branch codex/void-terminal https://github.com/SoraYama/void-terminal.git
cd void-terminal
sudo install -d -o 10001 -g 10001 -m 0750 /opt/void-terminal/data
# 创建 .env（不要覆盖已有生产配置）：
(set -C; umask 077; printf 'DEPLOYMENT_MODE=self-hosted\nSITE_DOMAIN=akasha.example.com\nCATALOG_DATA_DIR=/opt/void-terminal/data\nKNOWLEDGE_API_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env)
```

先将 `SITE_DOMAIN` 改为实际域名。不要把本机 `.env` 或模型 Key 上传服务器；自托管版不需要配置服务器模型 Key。语料就绪后，在浏览器设置中输入自己的 Key 并测试连接，再开始提问。

迁移前在源机器做一致性备份，不能直接复制正在使用的 SQLite 主文件并遗漏 WAL：

```sh
mkdir -p artifacts/deploy
python3 - <<'PYBACKUP'
import sqlite3
with sqlite3.connect('file:data/catalog.sqlite?mode=ro', uri=True) as source:
    with sqlite3.connect('artifacts/deploy/catalog.sqlite') as target:
        source.backup(target)
PYBACKUP
gzip -1 -k artifacts/deploy/catalog.sqlite
shasum -a 256 artifacts/deploy/catalog.sqlite artifacts/deploy/catalog.sqlite.gz
rsync -av --partial --progress artifacts/deploy/catalog.sqlite.gz user@server:/tmp/
```

在服务器校验压缩文件 SHA-256 后，解压到数据目录中的临时文件；再核对未压缩 SHA-256、活动快照与数量，最后重命名为 `catalog.sqlite`。首次部署示例（已有服务更新快照时先停知识服务，并保留原备份）：

```sh
sudo sh -c 'gzip -dc /tmp/catalog.sqlite.gz > /opt/void-terminal/data/catalog.sqlite.incoming'
sudo sha256sum /opt/void-terminal/data/catalog.sqlite.incoming
# 与源文件哈希一致后：
sudo mv /opt/void-terminal/data/catalog.sqlite.incoming /opt/void-terminal/data/catalog.sqlite
sudo chown 10001:10001 /opt/void-terminal/data/catalog.sqlite
sudo chmod 0640 /opt/void-terminal/data/catalog.sqlite
docker compose -f compose.sqlite.yaml config --quiet
docker compose -f compose.sqlite.yaml build
docker compose -f compose.sqlite.yaml up -d --wait --wait-timeout 240
curl --fail https://akasha.example.com/api/status
```

`ready=true`、活动快照、文档/分片数量和实际原文查询均正确才算语料可用。健康检查只验证进程存活，避免频繁扫描百万级语料；它不能代替这项上线检查。语料约 17 GiB，压缩包、镜像、构建缓存与恢复副本还需要额外空间。查询不需要上传时使用的上游原始目录，出处文本和引用已保存在数据库中。

更新应用：在仓库执行 `git pull --ff-only`、`docker compose -f compose.sqlite.yaml build`、`docker compose -f compose.sqlite.yaml up -d --wait`，并重新验证 `/api/status` 和检索。更新前记录旧提交和镜像 ID；数据库迁移/重建单独执行。Caddy 的证书在命名卷中持久化；不要执行 `down -v`。

**已有托管站点升级前，必须先在原 `.env` 中显式设置 `DEPLOYMENT_MODE=hosted`。** 保留原 Compose 项目名和 `accounts` 卷，先单独备份账户账本；更新、切换语料后端或回滚都不能删除/替换该卷。重建后检查 `/api/status.deployment.mode` 为 `hosted`，并在浏览器确认只有登录与积分入口；自托管站点则应为 `self-hosted`，且无账户入口。

## PostgreSQL：1. 准备服务器

安装 Docker Engine 与 Compose v2；域名 A/AAAA 指向这台机器，确认 DNS 记录都能到达服务器。开放 SSH、80、443；数据库和知识服务端口保持内网。若服务器已有 TLS 代理，可直接沿用 [nginx 配置](../deploy/nginx.conf)，不再启动 Caddy。

```sh
git clone --branch codex/void-terminal git@github.com:SoraYama/void-terminal.git
cd void-terminal
cp .env.example .env
```

这是新服务器的步骤；已有 `.env` 不要覆盖。编辑 `.env`：

```dotenv
DEPLOYMENT_MODE=self-hosted
SITE_DOMAIN=akasha.example.com
PUBLIC_APP_ORIGIN=https://akasha.example.com
POSTGRES_PASSWORD=替换为随机URL安全密码
KNOWLEDGE_API_TOKEN=替换为至少32字节随机令牌
TRUST_PROXY=true
SHARED_MODE_ENABLED=false
ACCOUNT_TRIAL_ENABLED=false
SHARED_DAILY_TOKEN_BUDGET=0
EMBEDDING_ENABLED=false
```

密码和令牌各自使用 `openssl rand -hex 32` 生成。自托管 BYOK 不需要服务器填写模型 Key，也不会因设置账户/共享开关而使用服务器 Key。基础镜像目前采用版本标签，正式运维可再固定经过审查的镜像 digest。

## PostgreSQL：2. 构建并启动

```sh
docker compose -f compose.yaml -f deploy/compose.caddy.yaml build
docker compose -f compose.yaml -f deploy/compose.caddy.yaml up -d --wait db knowledge web caddy
docker compose -f compose.yaml -f deploy/compose.caddy.yaml logs --tail=80 caddy
```

此时页面可以打开，空库会明确显示未就绪。HTTPS 签发时间取决于 DNS、端口与 CA；不要把页面可打开等同于语料导入完成。Caddy 自动刷新 `text/event-stream`，保留断连取消，数据库和知识服务没有公开端口。[SSE 刷新行为](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)

## PostgreSQL：3. 复用已经整理好的语料

最快的数据路径是把本机 `data/normalized-v5/` 迁到服务器并导入 PostgreSQL，省去重新下载和归一化。它包含快照、出处和全文，不包含模型 Key。不要把本机 SQLite 文件直接作为 PostgreSQL 数据卷。

先在服务器上创建导入目录，并让实际 SSH 上传用户拥有写权限（将 `user` 替换为该用户），例如 `sudo install -d -o user -g user /srv/void-terminal-import/normalized`。在本机执行，替换 SSH 用户和主机：

```sh
rsync -avz --progress data/normalized-v5/ user@server:/srv/void-terminal-import/normalized/
```

在服务器上，确认导入容器 UID 10001 能读取该目录后：

```sh
docker compose -f compose.yaml -f deploy/compose.caddy.yaml --profile ingest run --rm \
  --volume /srv/void-terminal-import:/import:ro \
  ingest import --normalized /import/normalized --no-activate
docker compose -f compose.yaml -f deploy/compose.caddy.yaml --profile ingest run --rm ingest snapshots
# 检查实际快照、coverage 和样本文本，再将输出的 ID 代入：
docker compose -f compose.yaml -f deploy/compose.caddy.yaml --profile ingest run --rm ingest activate SNAPSHOT_ID
```

本机 SQLite 全量导入曾用约 55 分钟，不能据此保证 PostgreSQL 导入时间。语料规模和索引通常比站点构建更耗时。没有本机规范化文件时，按 [README 的首次导入步骤](../README.md#首次导入与快照) 获取固定上游来源。

## 4. 上线核对与 Key 隐私

访问 `https://你的域名/api/status`，核对 `deployment.mode`、活动快照和文档数；验证书籍全文、引用、流式输出、停止生成以及你实际使用的模型。生产语料备份/恢复按 [README](../README.md#备份与恢复) 执行，托管版另行备份账户账本；不要删除命名卷。模式信息与语料是否就绪分开判断，`ready=false` 不会把托管版切成 BYOK。

- Key 仅在当前页面内存，刷新清除；接口地址与模型名作为非密钥偏好保存在本机。
- 自托管请求路径是浏览器 → 你部署的实例 → 用户选定模型服务。实例运营者技术上可以接触 Key，HTTPS 保护传输，不能让运营者不可见。
- 模型服务会收到问题、历史对话和召回的原文。自定义地址必须是你信任的供应商；改地址会清空旧 Key。
- 应用不把 Key 写入数据库、对话导出或日志。本文 Caddy 配置在全局运行日志过滤请求头，也未开启访问日志；仅关闭访问日志不足以防止上游故障时的错误日志记录自定义 Key 头。自行添加的 CDN、APM、代理和日志采集仍应避免记录请求头/请求体。供应商自己的日志、留存与训练政策需另行核对。
- 只有自托管 BYOK 可以选择接口与模型。托管版不接收浏览器 Key 或模型覆盖；服务器 Key 绑定管理员的模型地址，访客无法把它转发到自定义服务。
- 自定义地址只允许公网 HTTPS，并校验 DNS 与实际连接地址；不能用服务器代理访问内网、云元数据或用户电脑的 localhost。本地模型需要由管理员提供受控可达接口。采用校验与连接固定，避免仅检查域名的 SSRF/DNS 重绑定问题。[OWASP 指引](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

SQLite 路径已在 Ubuntu 24.04 / 2 CPU / 4 GB / 120 GB 的单机上完成全量快照、HTTPS、目录/引用和真实 RAG SSE 无效 Key 检查；未进行付费模型生成，也未做并发容量测试。详见 [部署记录](agent/feature/2026-11-02-public-deploy.md)。PostgreSQL 全量导入与容量需单独验证。
