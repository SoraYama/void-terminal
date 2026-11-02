> **Date / Revised**: 2026-11-02

# Azure、Hetzner、OVH、Vultr：低流量部署的长期自费成本

## 1. 背景与代码状态

用户要求拉取最新代码，重新比较 Azure 和其他机器；已明确没有学生订阅或代金券，按长期自费比较，不把新客赠金作为长期价格。

执行 `git fetch --prune origin`、`git pull --ff-only`。当前分支 `codex/void-terminal` 已是最新，HEAD 和上游均为 `e567a81ffd975e4492286c2dfce1a4ebe118e92a`。拉取前工作区干净；本次只补充调研和部署说明，没有改动应用实现、创建云资源或购买服务。

## 2. 实际资源需求与限制

- 本机 `data/catalog.sqlite` 实测 16.736 GiB。Git 不包含此文件，拉取代码不会下载完整语料；部署需另行迁移数据。
- 现有 `CatalogStore` 同时支持 SQLite 和 PostgreSQL。SQLite 适配器当前标记为 `sqlite-development`，本地完整语料已使用它；这不等于完成了小型 VPS 的生产验收。
- `compose.yaml` 默认强制依赖 PostgreSQL。轻量方案需要独立配置 Web、knowledge、HTTPS 代理，复用 SQLite，关闭嵌入模型与站长共享付费。本次没有实施这套配置。
- SQLite 构造过程会初始化 schema，连接会启用 WAL；不能直接把数据库目录挂成操作系统只读卷。数据目录和 WAL 文件需有合适权限。
- 低流量试运行资源目标为 2–4 GB RAM、40–60 GB SSD，不是容量承诺。构建、下载原始来源、全量导入应在服务器之外完成。
- 40 GB 磁盘可作为现有单份快照的运行目标，但还需容纳系统、镜像、日志和 WAL。并存第二份约 17 GiB 数据库进行更新时可能空间不足；不要把“能放一个库”当作能全量重建、备份和原子替换。
- 下列套餐都不含本地大模型推理。默认 BYOK；模型 API 费用由访客承担，服务器仍有固定费用。

## 3. 2026-11-02 官方价格核对

除明确注明外，未计税、域名、额外备份及超额用量。按需价格不等于永久锁价；未登录客户控制台核验库存、购买资格或具体地区最终订单。

| 方案 | 配置 | 价格与计费边界 | 判断 |
| --- | --- | --- | --- |
| Azure Japan East，Linux B1ms | 1 vCPU、2 GiB；另配 64 GiB Standard SSD LRS 和标准 IPv4 | 按 730 小时合计约 $28.31/月，另计磁盘操作等用量 | 没有赠金时，不符合当前省钱目标 |
| Hetzner CX23，德国/芬兰 | 2 vCPU、4 GB、40 GB NVMe | €5.49 + IPv4 €0.50 = €5.99/月；美元项目报价 $6.49 + $0.60 = $7.09/月 | 欧洲线路能接受且有库存时，优先考虑的月付试运行候选 |
| OVH VPS-1 2027，法国站目录估算 | 2 vCores、4 GB、40 GB NVMe | 基础月付 €4.49，加目录中的必选基础备份 €0.35，合计约 €4.84/月未税；官网 $4.54/月起则是年付入口 | 低成本首选候选；其他站点、新加坡最终报价和库存未核实 |
| Vultr Regular `vc2-1c-2gb` | 1 vCPU、2 GB、55 GB SSD | $10/月 | 想选择日本/新加坡等地区时的对照方案；仍需实测线路、内存和检索速度 |
| AWS Lightsail Linux，含 IPv4 | 2 vCPU、2 GB、60 GB SSD | $12/月 | 套餐明确，但当前比 Vultr 对照档更贵 |

Azure 原始查询分别保存到被 Git 忽略的 `artifacts/research/2026-11-02-cloud/`。所取计量项为：

- `Virtual Machines BS Series` / `B1ms` / `japaneast` / Linux Consumption：$0.0272/小时。
- `Standard SSD Managed Disks` / `E6 LRS Disk` / `japaneast`：$4.80/月。
- `IP Addresses` / `Standard IPv4 Static Public IP` / `japaneast`：$0.005/小时。
- 合计：`0.0272 × 730 + 4.80 + 0.005 × 730 = $28.306`。未把 Windows、Spot、Low Priority 或 Cloud Services 的记录混入 Linux VM 计算。

Hetzner 采用 2026-06-15 新订单调整后的价格，不能继续引用旧的 €2.99/€3.99 CX23 价格。官网说明 Cost-Optimized 库存有限；静态产品页的 unavailable 提示不能替代登录控制台的实时库存检查。

OVH 法国站公开目录核实 `vps-2027-model1` 的 `default` 月付为 €4.49，`commitment=0`；`upfront12` 则是 €3.81/月的基础费、一次支付 12 个月。目录要求选择 `os`、`storage`、`automatedBackup`；Linux 与本地磁盘的 default 价格均为零，但基础日备份 `option-auto-backup-2027-1-model1` 的 default 月费是 €0.35。因此本次预算按 €4.84 而非只按 €4.49 计算；前台宣传备份 included 与此目录构成存在差异，以实际完整购物车为准。

此目录的 datacenter 配置允许 SGP 等选项，但允许选择不代表有库存，也不能推断用户自己站点的最终订单总价。亚洲地区套餐另有流量条件：VPS-1 每月 500 GB，超过后限速到 10 Mbps；不能把页面的 unlimited traffic 文案解释为亚太不限速。地区、税费、年付现金支出及续费条件仍需配置器的最终报价确认。非 FR 站点参数返回 400；未用这些失败结果补造其他站点报价。

## 4. 选择建议与验证边界

1. 优先核对 OVH VPS-1 的完整月付订单，以法国站目录估算约 €4.84/月未税为参考。若自己的购买站点和地区价格接近，配置适合成为低流量试运行候选，不先锁一年。
2. 接受欧洲机房时，Hetzner CX23 是备选：检查库存和实际线路，以 €5.99/月未税为固定费用目标，按小时/月封顶试用。国内访客体验优先时，比较 OVH 新加坡的最终无年约报价和 Vultr 日本/新加坡 $10 档。未测试真实线路，不能仅凭地区保证访问质量。
3. OVH $4.54 年付起价先作为候选，不能按每月仅付 $4.54 做现金流计划。
4. Azure 的标准按需 VM 当前不推荐。免费 VM 是有资格与期限限制的权益，B2ats v2 本身也只有 1 GiB RAM，不能当作长期免费 4 GB 主机。
5. Oracle Always Free 可另行尝试：官方当前 A1 配额为总计 2 OCPU/12 GB、启动盘与块盘合计 200 GB，但存在容量不足和闲置回收规则，尤其不适合把低访问量站点的持续在线建立在“免费资源一定保留”的假设上。本次不将其作为可靠付费机器的等价替代。

没有执行容器部署、2/4 GB 限额压测、云上检索、证书签发、付费模型调用或公网验收。只修改文档，无需重跑应用测试；以文档 diff 和价格计算核对为验证。

## 官方来源

- [Azure Retail Prices API 文档](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)：免鉴权查询 `https://prices.azure.com/api/retail/prices`，筛选 region、SKU、Consumption；需排除 Windows/Spot 等产品记录。
- [Azure Linux VM 价格](https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/)、[Managed Disks 价格](https://azure.microsoft.com/en-us/pricing/details/managed-disks/)、[公网 IP 价格](https://azure.microsoft.com/en-us/pricing/details/ip-addresses/)。上表的具体值来自 Retail Prices API，不是动态网页占位符。
- [Hetzner 2026-06-15 价格调整](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)、[CX23 配置](https://www.hetzner.com/cloud/cost-optimized/)、[Primary IP 价格](https://docs.hetzner.com/cloud/servers/primary-ips/overview/)。
- [OVH 亚洲 VPS](https://www.ovhcloud.com/asia/vps/)、[全球官网的年付配置入口](https://www.ovhcloud.com/en/vps/configurator/?planCode=vps-2027-model1&pricing=upfront12)、[2027 系列说明与 IPv4 包含项](https://blog.ovhcloud.com/en/posts/vps-2027/)。
- [OVH 法国站官方公开目录](https://eu.api.ovh.com/1.0/order/catalog/public/vps?ovhSubsidiary=FR)：`vps-2027-model1` 的月付/年付与必选 addon 价格；查询副本存于忽略目录 `artifacts/research/2026-11-02-cloud/ovh-vps-FR.json`。
- [Vultr 官方公开套餐 API](https://api.vultr.com/v2/plans)，本次已重新请求核对 $10 档。
- [AWS Lightsail 价格](https://aws.amazon.com/lightsail/pricing/)，采用 Linux/Unix、含公网 IPv4 套餐。
- [Oracle Always Free 配额、容量与闲置回收](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)。
