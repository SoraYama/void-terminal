> **Date / Revised**: 2026-11-06

# 手机 Safari 首页标题白块

## 问题与原因

iPhone Safari 截图中，「从一个问题，走进提瓦特」的位置显示整块暖白色。旧样式依赖 `mask-mode: luminance` 从完全不透明的 RGB 字形板中抠字；按 alpha 解释该图时，标题元素的整块背景都可见。Chromium 手机尺寸下强制使用 alpha 重现了截图中的白块。

## 修复与验证

保留原遮罩可见区域（原图裁切起点 82, 84；尺寸 1575 × 631），把亮度转成透明度，直接显示暖白色透明 PNG。保留响应式尺寸、DOM 标题和强制颜色模式下的文字。详见[标题字形记录](../../design/typography-v3/README.md)。

Chromium 的手机和桌面截图均保留字形和透明间隙。手机尺寸下，强制 alpha 的截图从修复前 100% 白色变为修复后约 26% 白色；强制颜色模式下文字仍可见。Playwright WebKit 在 440px 手机和 1440px 桌面视口均通过截图验证，并确认手机可切换为英文标题。生产构建、TypeScript 检查和 288 项 Web 测试通过。

## 生产发布

2026-11-06 11:46（北京时间）发布提交 `15858c3`。切换前在本机候选容器核对 CSS、PNG 和活动快照，切换后 Web 健康且公网资源与候选哈希一致。知识服务、Caddy 和活动快照 `agd-d7f2135c7eb0-26ae8d6dbac3` 保持原状。回退标签为 `void-terminal-web:rollback-mobile-title-99888eec5471`。

公网 440px WebKit 截图显示中文两行字形与透明间隙，中英文切换通过；未使用 iPhone 真机。服务器收据在 `/opt/void-terminal/releases/mobile-title-15858c347e66/receipt.json`，本机截图和公网验收日志在 `artifacts/deploy/mobile-title-20261106/`。
