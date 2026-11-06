> **Date / Revised**: 2026-11-06

# 官网免费点数、设备风控与赞助

## 1. Background & Problem

官网暂停充值和支付接入，改为登录后的免费研究额度与自愿赞助。每日 3 点先消耗，Asia/Shanghai 零点重置且不累积；新账号一次性 20 点和人工赠送额度保留。普通研究 1 点，深入考据 3 点。赞助不兑换点数，额外点数通过公开联系邮箱人工申请。自部署仍使用自己的 API Key，不依赖官网账户、点数、设备识别或赞助配置。

## 2. Root Cause / Approach

独立账户 SQLite 账本升级到 schema v3：每日桶和保留桶分别记录余额，预留保存原始日历周期和分配，结算、释放与过期回收均使用该分配。跨午夜释放昨日预留不能补到今天。迁移保留旧余额、历史入账及未完成预留；旧账号不重新领取新人奖励。

设备识别使用服务端随机签名 HttpOnly Cookie、短期且绑定账户的验证凭证、粗粒度浏览器信号 HMAC 和可信代理网络信号。Turnstile 必须服务端校验 hostname/action/有效期；前端提供的 verified 或 deviceHash 不能授信。登录本身不等于领取点数资格：直接获得 Supabase 会话仍必须经过官网设备验证。

设备标识是防重复领取的信号，并非不可伪造的物理设备身份。清 Cookie、换浏览器及多账号的风险由持久限流、挑战、设备领取约束和全站调用预算共同控制。网络或粗指纹相同只能触发验证，不直接硬封共享网络中的其他人。

## 3. Key Changes

- `services/knowledge/knowledge/account_store.py`、`account_credit_buckets.py`、`account_risk.py`：每日优先分配、不可变预留、设备/账号领取唯一约束、30 天风险事件与 180 天设备领取记录清理。设备豁免是单独审计操作，不等于赠送点数。
- `apps/web/src/lib/server/account-risk.ts` 与账户/认证/聊天路由：统一构造可信风险上下文，缺少配置时关闭免费调用，不自动降级到无验证。自部署路径提前退出，不收集设备信息。
- `use-account.ts`：设备验证无论成功失败都重新读取账户状态。设备续期不能清除同一账号的草稿；确认退出、切换账号或刷新失败仍隔离私有历史。
- 账户 UI：每日点数和保留点数分别显示；发送、编辑或重新生成被额度/风控拒绝时保留输入与分支，不保存虚假的失败回答。
- 赞助配置只在官网序列化：国内二维码/爱发电、海外 Ko-fi、BSC 地址与接受币种均来自运营配置。无效或未提供的渠道隐藏。BSC 显示主网链 56、完整地址、复制与浏览器链接，不签名或自动到账。公开收款地址和测试 fixture 不可混用。
- `store.py` / `config.py`：公共模型月度 token 预算按 UTC 月聚合现有预算日记录；显式 0 拒绝调用。token 上限不等同于精确货币账单上限。账户每日赠送仍采用 UTC+8。

## 4. Conclusions / Lessons

部署前必须备份并验证独立账户账本，保留可恢复的旧版本快照；schema v3 不可直接用旧二进制原地回退。风险 HMAC 密钥需要稳定保管，轮换会使设备/验证状态失效。代理必须覆盖并规范化客户端地址头，不能直接信任访客自带的 X-Forwarded-For。

浏览器测试中的挑战结果、收款地址和账号是隔离 fixture，只证明应用行为。真实 Turnstile、赞助收款渠道及生产部署分别需要实际配置和验收，不以单元测试或构建成功替代。现有 Stripe 草稿保留在原工作树，本次没有发起支付或修改线上数据库。

## 5. Verification and Activation Boundary

- Python final suite: 541 passed, 9 skipped, 19 subtests passed. PostgreSQL budget transactions explicitly select READ COMMITTED before the first query, so a queued reservation sees committed charges on other days in the same month. Local statement-order regressions ran RED/GREEN; the isolated live PostgreSQL concurrency case is gated by TEST_POSTGRES_URL and was skipped on this host. One existing Starlette/httpx deprecation warning remains.
- Web: 469 unit tests, typecheck and production build passed. The desktop/mobile account + deployment-mode + controller matrix had 98 passes, 4 deliberate mode skips and two identical locator ambiguities; the corrected locators and all 14 hosted feature cases then passed against the final build. Tests exercise actual React/browser behavior with mocked account/provider boundaries; no real email, model token charge or Turnstile receipt is implied.
- Parent visually inspected desktop/mobile balance hierarchy, mobile dark mode, proof challenge, exhausted composer and BSC manual-copy fallback. Final 390 px exhausted layout exposes all send controls; 375 px BSC layout exposes the full wrapped address.
- Actual CLI rehearsal migrated a synthetic v0 ledger with available 7 / held 1, retained zero-balance legacy eligibility history, replayed a manual grant once, and verified/restored both v0 and v3 backups to fresh targets. Evidence: `artifacts/hosted-free-credits/migration-mgr4418b/receipt.json`.
- Compose YAML and exact hosted monthly-budget startup guards passed local checks. A production standalone Web process served an existing public/support fixture with HTTP 200 and byte-identical image contents. Docker itself was not available locally.
- Activation remains pending: owner-approved BSC address and assets, actual domestic/overseas links or QR assets, public contact email, and real Turnstile site/secret configuration. Examples remain empty; no test recipient was published. No production deployment, ledger migration, or sponsor transfer was performed.
