> **Date / Revised**: 2026-11-07

# 官网免费点数与图鉴版本发布

## 发布与验证

运行版本为 `47f87453e4480ff188c9775a5ab7bc997ea14f1f`，已从 `codex/hosted-free-credits` 快进合并至 main。完整 [CI 42333485833](https://github.com/SoraYama/void-terminal/actions/runs/42333485833) 成功：Web 485 项，Python 552 项通过 / 1 跳过（含独立 PostgreSQL），Chromium 245 项通过 / 13 项预设跳过；类型检查、生产构建、评估及目录控制器检查通过。

生产容器使用该提交构建的镜像：Web `sha256:2c2c4c9ab0d5edb911f970e548a5955ee5670566d6c9ca4caa5d165125642a6a`，knowledge `sha256:f9793d1660884e1dc0cb7c208f67cf65bdb835c2394773b96b3a3f0b7dda1c8f`。两项健康检查通过；Caddy 容器、原有 `void-terminal_accounts` 卷和活动资料快照保持不变。目录刷新设置中的 worker image 已同步为新 knowledge 镜像。

用户明确批准对所有邮箱开放，运行配置采用 `TRIAL_ALLOWED_EMAILS=*`，空值仍然拒绝访问。官网启用 Turnstile、持久设备风控、每日 3 点优先消费、储备点数保留、支付宝与 BSC 赞助及邮件申请额外点数。月度共享 token 上限为 62,000,000，每日上限仍为 2,000,000；这不是精确货币账单上限。自部署仍使用 BYOK。

公网 14 项检查通过：服务就绪与 hosted 模式、活动快照不变、匿名调用要求登录和设备验证、官网拒绝 BYOK、BSC PNG 与已解码核准的地址图片一致、不同地址返回 404、支付宝原图字节一致、两幅旅行者立绘及星级/属性图标和字体按发布源码提供。未发起真实模型生成、人工赠点或赞助转账。

真实 Chrome 登录态及历史仍可读取，旧剩余点数显示为储备。390px 页面已目视验收旅行者立绘，原图加载、本地字体与无横向溢出均通过。赞助页面显示实际地址、链 56 和 USDT/USDC/BNB，BSC 图片已加载。用户本人完成 Cloudflare 设备挑战后，浏览器回读确认今日点数为 `3 / 3`，原储备余额未变，验证提示已消失。新邮箱端到端 OTP 登录本次没有重新测试；该路径的浏览器自动化仍使用隔离 fixture。

本地证据位于 `artifacts/release-20261107/`，包含 CI 日志、公开接口回执及生产截图；不进入源码。服务器发布目录为 `/opt/void-terminal/releases/hosted-free-47f8745-r2`；配置和账本备份只保存在服务器私有目录。

## 账本迁移与恢复约束

在线备份、恢复到独立文件并升级的演练成功后，停止 Web/knowledge 写入者，再制作正式备份、迁移 schema v0 → v3、验证备份及恢复副本。对旧 accounts / account_usage 全部原有字段逐行比较一致，然后启动新服务。旧账号不会重复获得新人 20 点。

首次尝试保留在 `/opt/void-terminal/releases/hosted-free-47f8745`：它在在线备份阶段失败，尚未停止容器或变更运行配置。原因是 WAL/SHM 不存在，SQLite `mode=ro` 连接在只读卷上不能创建辅助文件；同一服务 UID、同一只读连接在可写目录下读取正常。修正仅允许服务 UID 10001 写辅助文件，备份连接仍为 `mode=ro` / `query_only=ON`。使用全新 r2 目录重试，未覆盖失败回执或恢复材料。

不要仅回退旧容器镜像：旧二进制不支持 v3。存在新写入时优先修复向前，不能直接覆盖为旧备份。日常部署须保留第三个 Compose 配置 `app/compose.support.yaml`，否则支付宝图片挂载会丢失；旧 `catalog_release_enrichment.py` 只有两个 Compose 文件，未来用它做应用发布前须补齐该挂载。每日资料刷新本身不重新创建 Web 容器。

## 给账号人工加点

目前没有网页管理后台。用户先登录官网建立额度记录；运营者在 Supabase 的 Authentication → Users 按邮箱查找 User UID。账本使用该 UID，不接受邮箱作为 `--account-id`。

登录服务器后执行以下命令；把占位 UID 和点数换成实际值。每一笔新的赠点生成并私下保存一个 UUID。结果不确定时保留原 UUID，仅重试第二条命令，避免重复发放。

```sh
grant_ref=$(python3 -c 'import uuid; print(uuid.uuid4())')

docker exec --user 10001:10001 void-terminal-knowledge-1 \
  python -m knowledge.account_admin grant \
  --database /accounts/accounts.sqlite \
  --account-id "USER_UUID" \
  --units 100 \
  --reference "$grant_ref" \
  --reason-code support_adjustment \
  --allow-write
```

`status: ok` 表示成功；`replayed: true` 表示同一笔操作已存在，没有重复增加。增加的是不随每日刷新清零的储备点数，用户刷新账户页即可查看。该操作不会解除设备风控；设备误判豁免是独立的 `exempt` 操作。更多备份、恢复和幂等约束见 [credit-ledger](../../operations/credit-ledger.md)。
