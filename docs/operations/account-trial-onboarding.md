# 虚空终端邮箱试用：首次开通

方案：Supabase Auth 邮箱验证码 + Resend SMTP；应用与额度账本继续在现有服务器运行。先邀请测试，不启用付费套餐、不开放任意邮箱注册、不接支付。验证码由用户主动发起登录时发送。

## 1. 开通两个本人账号

- [Supabase Dashboard](https://supabase.com/dashboard)：先选 Free，创建或复用 `void-terminal` 项目。新建时优先选择靠近应用服务器的区域；已建项目可以复用，无需为本接入重建。数据库密码自行保存在密码管理器中，应用只使用 Auth，不需要数据库密码或 service-role Key。
- [Resend Dashboard](https://resend.com/overview)：先选 Free。当前免费交易邮件额度为每月 3,000 封、每天 100 封；Supabase Free 项目闲置一周可能暂停，因此本阶段仅作为邀请试用，不据此承诺正式商业可用性。[Resend 定价](https://resend.com/pricing)、[Supabase 定价](https://supabase.com/pricing)。

## 2. 验证发信子域名

在 Resend 添加 `auth.sorayama.moe`，发件人采用 `虚空终端 <login@auth.sorayama.moe>`。只开启发送功能，不启用收件、邮件打开跟踪或链接跟踪。验证码发信域名使用 Enforced TLS，接收服务器不支持 TLS 时投递失败，不降级为明文。

在域名 DNS 管理后台，逐项添加 **Resend 当前生成的** SPF、DKIM 和必要的发送验证记录，名称、类型和值以该项目页面为准，不猜测值。较新的 Resend 项目可能提供 `rsend.auth`、`send.auth` 两条 CNAME，而不是旧式 MX + SPF TXT，按当前页面记录操作。可选 DMARC 不应覆盖现有根域邮件策略。不要替换根域现有 MX、SPF 或站点记录；不要在同一个 DNS 名称创建多个 SPF 记录。待 Resend 显示 Verified 后继续。[官方域名说明](https://resend.com/docs/dashboard/domains/introduction)。

## 3. 将 Resend 接到 Supabase

Supabase → Authentication → Email / Notifications → SMTP Settings：

| 字段 | 值 |
| --- | --- |
| Sender email | `login@auth.sorayama.moe` |
| Sender name | `虚空终端` |
| SMTP host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | 专用于该发信域名的 Resend API Key |

按 Resend 当前界面创建仅发送、限定此域名的 Key（如果界面支持对应范围），填入 Supabase；**该 Key 不需要交给应用服务器**。上述 SMTP 参数来自 [Resend 官方 Supabase 接入说明](https://resend.com/docs/send-with-supabase-smtp)。

将 Site URL 设为 `https://void-terminal.sorayama.moe`；启用 email provider，保留邮箱确认。将 **Confirm sign up（首次注册）** 和 **Magic Link / OTP（再次登录）** 两个模板的主题均设为 `虚空终端登录验证码`，内容使用 [email-otp.html](../../deploy/auth/email-otp.html)，保留 `{{ .Token }}`。首次注册会使用确认邮件模板，因此两个模板都必须包含数字验证码，不能只修改 Magic Link。参考 [Auth 注册分支](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go) 与 [官方验证码校验文档](https://supabase.com/docs/reference/javascript/auth-verifyotp)。代码输入是六位数字，OTP length 必须设为 6；建议过期时间 600 秒、发送间隔至少 60 秒。初期 auth 邮件发送速率不超过 10 封/小时，并保持供应商限制，之后根据实际试用量调整。

Supabase 默认邮件服务只发给团队成员且限额很低，不能替代上述正式 SMTP 配置。[Supabase SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)。

## 4. 填写服务器暂存配置

本次候选目录：`/opt/void-terminal/releases/account-trial-7193f3e`。其中 `account-trial.env` 权限为 `0600`，用于独立暂存。发布时将已审阅字段合并到运行配置 `/opt/void-terminal/app/.env`，保留原站点、数据目录与内部服务凭证。

在服务器编辑（不要把密钥粘贴到聊天或提交 Git）：

```sh
ssh void-terminal
nano /opt/void-terminal/releases/account-trial-7193f3e/account-trial.env
```

需要补充的四项：

- `SUPABASE_URL`：项目 HTTPS origin。
- `SUPABASE_PUBLISHABLE_KEY`：项目的 `sb_publishable_...` Key，不使用 `sb_secret_...` 或 service-role Key。
- `TRIAL_ALLOWED_EMAILS`：第一批实际收件邮箱，逗号分隔；邀请阶段不要填 `*`。
- `DEEPSEEK_API_KEY`：已有模型供应商项目的服务端 API Key，账户须有可用额度；不自动充值或购买套餐。

签名用 `SESSION_SECRET` 已在服务器随机生成，勿复制到浏览器。暂存默认赠送 20 点、每日全站 token 预算 2,000,000（是预留上限，不是货币价格）。两个开启开关暂保留 false，完成邮件和部署检查后再由发布流程启用。

## 5. 发布前保护现有数据

这次只更新应用。保留现有 `/data` 可写预算库、只读 `/catalog-state`、只读 `/catalog-archives` 和活动快照；新增 `/accounts` 独立可写卷。部署必须使用新版 SQLite Compose 基础文件，并在现有 `refresh.lock` 内同步 `state/settings.json.knowledgeImage`，否则每日刷新会拒绝镜像不一致。

不要调用语料 bootstrap 或 enrichment promotion。回滚要同时恢复运行配置，并强制旧 Web 的 `SHARED_MODE_ENABLED=false`，防止旧版匿名共享路径使用新配置的服务端 Key。账户卷和已产生的额度记录保留，不用旧快照覆盖。

完成两个后台的开通、DNS Verified 和四项配置后，先验证一个邀请邮箱的实际收码/登录/退出/重复登录不重复赠送，再进行受控模型验收。单纯构建候选镜像不会发送真实邮件或调用模型；本次正式开通与投递验收见下节。

## 6. 本次生产发布记录

2026-11-06 已复用 `void-terminal` Supabase 项目（项目区域为首尔），Resend 发送域名 `auth.sorayama.moe`（爱尔兰）已 Verified。专用发送 Key 限制到该域名，SMTP 凭证仅保存在 Supabase；两种验证码模板均已保存并重新加载验证。OTP 为 6 位 / 600 秒，每小时最多 10 封，同一邮箱至少间隔 60 秒。首次真实邮件已进入指定试用邮箱的收件箱，SPF、DKIM 均通过。

应用版本 `7193f3eacae5e41803b75f336302bc2bbf967911` 已按邀请名单启用账户与共享服务；候选镜像通过发布检查后切换，现有快照、历史引用、Caddy 和原 `/data` 保持不变，数据刷新 timer 已恢复 active。专用 DeepSeek Key 的余额可用状态及 `deepseek-flash` 模型权限已通过服务端只读检查；随后用户完成真实验证码登录，普通考据生成及结算验收通过：首次赠送 20 点，验收一次扣 1 点，剩余 19 点、占用 0；刷新页面后余额与用量不变，对话与引用可重开。

生产 `/opt/void-terminal/app` 现在是校验过的源码归档，来源写入 `.account-trial-release.json`，并非 Git checkout。原完整目录及 `.git`、原 `.env` 保留在 `/opt/void-terminal/releases/account-trial-7193f3e/backup/app.before`。未来发布不能假定在新 app 目录执行 `git pull`；应准备校验后的版本并保持持久 Compose 配置与对应源码一致。

回滚脚本为该 release 目录下的 `rollback.py --execute`，会恢复旧应用、配置及镜像，强制关闭旧版共享模式，并保留所有账户/预算/语料数据。发布脚本已完成后不能重复执行；应查 `recovery.json` 与回执。真实登录、额度及模型生成验收的最终状态见账户功能记录。
