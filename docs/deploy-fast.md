# 最快落地：单台服务器 + Docker Compose + Caddy

这个项目需要常驻检索服务和大语料数据库。沿用已有 Compose，把 Web、知识服务、PostgreSQL 放在同一台服务器，再用 Caddy 接入 HTTPS，改造和维护步骤最少。Caddy 能自动申请和续期证书；域名需指向服务器，80/443 端口可达。[官方 HTTPS 条件](https://caddyserver.com/docs/automatic-https)

内测机器可先按 **4 vCPU、8 GB RAM、150–200 GB SSD** 估算；这不是并发容量或 PostgreSQL 空间保证。本机 SQLite 索引约 18 GB，规范化语料约 4.7 GB；生产还要容纳 PostgreSQL 索引、导入临时空间、原始来源和备份。默认关闭向量模型和共享付费模式，不需要 GPU。向量化及更高并发需另外测量。

## 1. 准备服务器

安装 Docker Engine 与 Compose v2；域名 A/AAAA 指向这台机器，确认 DNS 记录都能到达服务器。开放 SSH、80、443；数据库和知识服务端口保持内网。若服务器已有 TLS 代理，可直接沿用 [nginx 配置](../deploy/nginx.conf)，不再启动 Caddy。

```sh
git clone --branch codex/void-terminal git@github.com:SoraYama/void-terminal.git
cd void-terminal
cp .env.example .env
```

这是新服务器的步骤；已有 `.env` 不要覆盖。编辑 `.env`：

```dotenv
SITE_DOMAIN=akasha.example.com
PUBLIC_APP_ORIGIN=https://akasha.example.com
POSTGRES_PASSWORD=替换为随机URL安全密码
KNOWLEDGE_API_TOKEN=替换为至少32字节随机令牌
TRUST_PROXY=true
SHARED_MODE_ENABLED=false
SHARED_DAILY_TOKEN_BUDGET=0
EMBEDDING_ENABLED=false
```

密码和令牌各自使用 `openssl rand -hex 32` 生成。访客自带 Key 模式不需要服务器填写模型 Key。基础镜像目前采用版本标签，正式运维可再固定经过审查的镜像 digest。

## 2. 构建并启动

```sh
docker compose -f compose.yaml -f deploy/compose.caddy.yaml build
docker compose -f compose.yaml -f deploy/compose.caddy.yaml up -d --wait db knowledge web caddy
docker compose -f compose.yaml -f deploy/compose.caddy.yaml logs --tail=80 caddy
```

此时页面可以打开，空库会明确显示未就绪。HTTPS 签发时间取决于 DNS、端口与 CA；不要把页面可打开等同于语料导入完成。Caddy 自动刷新 `text/event-stream`，保留断连取消，数据库和知识服务没有公开端口。[SSE 刷新行为](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)

## 3. 复用已经整理好的语料

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

访问 `https://你的域名/api/status`，核对活动快照和文档数；验证书籍全文、引用、流式输出、停止生成以及你实际使用的模型。生产备份/恢复按 [README](../README.md#备份与恢复) 执行；不要删除命名卷。

- Key 仅在当前页面内存，刷新清除；接口地址与模型名作为非密钥偏好保存在本机。
- 请求路径是浏览器 → 本站后端 → 用户选定模型服务。本站运营者技术上可以接触 Key，HTTPS 保护传输，不能让运营者不可见。
- 模型服务会收到问题、历史对话和召回的原文。自定义地址必须是你信任的供应商；改地址会清空旧 Key。
- 应用不把 Key 写入数据库、对话导出或日志。本文 Caddy 配置在全局运行日志过滤请求头，也未开启访问日志；仅关闭访问日志不足以防止上游故障时的错误日志记录自定义 Key 头。自行添加的 CDN、APM、代理和日志采集仍应避免记录请求头/请求体。供应商自己的日志、留存与训练政策需另行核对。
- 用户只能覆盖 BYOK。共享 Key 绑定管理员的模型地址；访客无法把它转发到自定义服务。
- 自定义地址只允许公网 HTTPS，并校验 DNS 与实际连接地址；不能用服务器代理访问内网、云元数据或用户电脑的 localhost。本地模型需要由管理员提供受控可达接口。采用校验与连接固定，避免仅检查域名的 SSRF/DNS 重绑定问题。[OWASP 指引](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

本轮仅新增并检查部署文件与说明。本机没有 Docker，尚未执行容器部署、证书签发、全量 PostgreSQL 迁移或公网验收。
