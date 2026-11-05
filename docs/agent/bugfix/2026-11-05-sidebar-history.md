> **Date / Revised**: 2026-11-05

# 手机侧栏历史列表被压缩

群星图鉴发布前，GitHub CI 的 8 个手机端对话回归在点击历史记录时超时。按钮存在，但 `history-label` / `sidebar-bottom` 拦截点击。

用 iPhone 13 浏览器上下文复现：可用窗口为 390 × 664，新增第四个导航入口后，`history-list` 的 `flex: 1; min-height: 0` 将列表压成 0 像素。桌面和手机侧栏本身已有纵向滚动，因此为两种侧栏内的历史列表设 88px 最小高度，保留两行可操作空间；不足的窗口由外层滚动，不改变导航或对话行为。

修复前已有 `scroll-anchor.spec.ts` 手机用例能够复现；修复后测量列表为 88px。生产构建成功，完整浏览器回归 113 通过、7 个既有跳过，包含原先失败的全部 8 个手机用例。证据：`artifacts/characters/sidebar-fix-build.log`、`sidebar-fix-e2e.log`；后续线上验证见本次角色图鉴发布记录。
