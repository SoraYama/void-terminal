# 虚空终端邮箱试用：首次开通

方案：Supabase Auth 邮箱验证码 + Resend SMTP；应用与额度账本继续在现有服务器运行。先邀请测试，不启用付费套餐、不开放任意邮箱注册、不接支付。验证码由用户主动发起登录时发送。

## 1. 开通两个本人账号

- [Supabase Dashboard](https://supabase.com/dashboard)：先选 Free，创建 `void-terminal-auth` 项目。区域选择靠近现有应用服务器的欧洲区域；数据库密码自行保存在密码管理器中，应用只使用 Auth，不需要数据库密码或 service-role Key。
- [Resend Dashboard](https://resend.com/overview)：先选 Free。当前免费交易邮件额度为每月 3,000 封、每天 100 封；Supabase Free 项目闲置一周可能暂停，因此本阶段仅作为邀请试用，不据此承诺正式商业可用性。[Resend 定价](https://resend.com/pricing)、[Supabase 定价](https://supabase.com/pricing)。

## 2. 验证发信子域名

在 Resend 添加 `auth.sorayama.moe`，发件人采用 `虚空终端 <login@auth.sorayama.moe>`。只开启发送功能，不启用收件、邮件打开跟踪或链接跟踪。

在域名 DNS 管理后台，逐项添加 **Resend 当前生成的** SPF、DKIM 和必要的发送验证记录，名称、类型和值以该项目页面为准，不猜测值。不要替换根域现有 MX、SPF 或站点记录；不要在同一个 DNS 名称创建多个 SPF 记录。待 Resend 显示 Verified 后继续。[官方域名说明](https://resend.com/docs/dashboard/domains/introduction)。

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

将 Site URL 设为 `https://void-terminal.sorayama.moe`；启用 email provider，保留邮箱确认。Magic Link 模板主题设为 `虚空终端登录验证码`，内容使用 [email-otp.html](../../deploy/auth/email-otp.html)，保留 `{{ .Token }}`。代码输入是六位数字，OTP length 必须设为 6；建议过期时间 600 秒、发送间隔至少 60 秒。初期 auth 邮件发送速率不超过 10 封/小时，并保持供应商限制，之后根据实际试用量调整。

Supabase 默认邮件服务只发给团队成员且限额很低，不能替代上述正式 SMTP 配置。[Supabase SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)。

## 4. 填写服务器暂存配置

本次候选目录：`/opt/void-terminal/releases/account-trial-7193f3e`。其中 `account-trial.env` 权限为 `0600`，尚未接入运行中的服务。

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

完成两个后台的开通、DNS Verified 和四项配置后，先验证一个邀请邮箱的实际收码/登录/退出/重复登录不重复赠送，再进行受控模型验收。当前准备过程没有发送真实邮件或调用模型。
