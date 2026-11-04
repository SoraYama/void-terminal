# 2026-11-04：服务器定时更新知识库与博览馆

- 用户选择现有服务器执行，不依赖 Mac。上线顺序和失败边界见 [设计](../../superpowers/specs/2026-11-04-catalog-refresh-design.md) 和 [运维文档](../../data-updates.md)。
- 应用与主机控制器按 `c9543bd7e48d39012a74f12698fca962cd81cf88` 部署。实际运行镜像 `sha256:2ff2235f2e9762bae4a2a5a33b12ba2adf6ed9c29d7af8de1d9a6feb9b5d3b74`，已保留原镜像 `sha256:1d6ed87731b90130115bcb0b99768af5c0bac6c0ee3ec09a35355d610b15fd58`；Web 和 Caddy 容器未重建。
- 回归：knowledge 182 通过、19 子测试通过、7 个 PostgreSQL 测试跳过，主机 11 通过。服务器隔离演练验证 SquashFS 在知识容器启动后传播、实际 systemd `ExecStopPost` 在进程突然退出后恢复旧指针、开机入口恢复待确认切换并挂载旧快照。四个真实旧版镜像归档与官方 Git 子树哈希一致。
- 上线接入：2026-11-04 11:30 北京时间，公网仍可读取旧活动快照 `agd-bd35e243fa43-9f534ea4c12d`、武器/圣遗物/任务详情、文献和更早的 `agd-792978e5503e-1ac83cf28961` 引用。证据在服务器 `/opt/void-terminal/catalog-refresh/bootstrap-public.json`、`state/mounts-result.json` 和 `state/bootstrap-images.json`。
- 首次接入单元 `void-catalog-commission-20261104.service` 于 11:30:55 开始，锁定主源 `d54f6f0d423ded9d055bb740a3e5f3aa8f2667f1`、补充源 `49a6544a6c6ae36089cb42fa591fc46f01de8bcf`。构建、发布时间、旧引用复验、无更新复跑与定时器状态以服务器日志和 `state/commission-first-publish.json`、`state/last-run.json` 为准；开始构建不代表已发布。
- 首次构建已完成，但 12:43 的发布前清理把 Docker 的小写 `no such object` 误判为失败；当时活动注册表未切换，公网旧快照和历史引用可读，定时器保持关闭。
- 17:36 部署主机修复 `b75c5d1ea7a85fda18ed96603b7935e874c31a05`，沿用原知识服务镜像。接入单元 `void-catalog-commission-reuse-b75c5d1.service` 复用已打包归档，经压缩包和挂载后数据库 SHA-256 校验、SQLite 完整性及覆盖检查，于 17:53:43 发布 `agd-d54f6f0d423d-b53cca6b3508`。公网读回 1,560,921 份文档、1,697,134 个检索片段，武器、圣遗物、任务物品和新旧三条引用样本可读；两源提交与当时各自的 GitHub `main` 一致。
- 发布后原服务复跑返回 `unchanged`；17:53:44 启用持久定时器。服务器回读为 `enabled/active`，首次计划触发为北京时间 2026-11-05 04:30，验收时尚未发生。服务器证据：`state/commission-first-publish.json`、`state/last-run.json` 及上述 systemd 单元日志。
- 为下次构建留空间：仅清理昨日临时传输的 12 个压缩包分片，合计 5,926,766,618 字节。清理前逐字节核对它们拼接后与完整归档完全相同；完整压缩包和 `catalog.before-museum.sqlite` 均保留。`state/reclaimed-upload-parts-20261103.json` 记录完整归档 SHA-256、每片偏移与哈希，可复原原始分片。日常任务不会自动清理发布或备份文件。

失败时查看 `journalctl -u void-catalog-refresh.service`，核对公网 `/api/status` 和原活动快照。已发布归档不自动清理。每次建库前检查工作空间和 5 GiB 现网保留容量；逐次累积的历史可能需要扩容或另行安排保留策略。
