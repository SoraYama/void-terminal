# 官方原神风景素材来源

核查日期：2026-10-28。用于 void-terminal 前端设计稿。下载的是官方 CDN 原图，未用 AI 重画或图像处理修改本地素材。

## 1. 推荐主视觉：须弥世界观背景

- 本地文件：[scenery-sumeru-world.jpg](scenery-sumeru-world.jpg)
- 尺寸：1920 × 1080；385,855 bytes。
- 来源页面：[Genshin Impact 官方世界介绍](https://genshin.hoyoverse.com/en/map)
- 官方原图：[世界观（压缩版本）.jpg](https://act-webstatic.hoyoverse.com/upload/contentweb/2022/08/16/8969f683b92839ac427c875d0d742be2_4596868760376591695.jpg)
- 定位：官网公开 content_v2 API，channel 413，Sumeru 条目，iInfoId 104903，sExt 的 413_2。
- 已实际查看：须弥城巨树、树根周围建筑、河流、瀑布、草地与紫色花丛，游戏本身的鲜明动画渲染风格；无人物和文字。原图自带较暗的蓝色调，适合叠加明亮 UI 字体，不能声称是未调色的截图。
- 用途：推荐作为首页完整背景，可裁切为移动端；较大的巨树主体在右半部，可将主标题和输入框放在左中部或遮罩后的中央区域。

## 2. 辅助参考：须弥城条目截图

- 本地文件：[scenery-sumeru-city.jpg](scenery-sumeru-city.jpg)
- 尺寸：640 × 355；249,702 bytes。
- 来源页面：[Genshin Impact 官方世界介绍](https://genshin.hoyoverse.com/en/map)
- 官方原图：[Sumeru City](https://act-webstatic.hoyoverse.com/upload/contentweb/2022/08/16/e577d144db87b02fcd98a95d7c664724_4936581560586959253.jpg)
- 定位：相同 Sumeru 条目的 413_4 富文本中，Sumeru City 标题后的图片。
- 已实际查看：明亮蓝天、须弥城巨树、绿色花坡，同一游戏景观的另一构图；无人物和文字。只有 640px 宽，不建议直接作为桌面 hero，仅作为明亮色彩/小尺寸条目配图参考。

## 核查路径

官网页面引用的 `/_nuxt/fcae9db.js` 公开定义 `apiBaseV2=https://sg-public-api-static.hoyoverse.com/content_v2_user`、公开应用标识 `a1b1f9d3315447cc`、iAppId=32、MAP.LIST=413。通过该站点自身配置得到如下公开读取地址，并在返回条目中找到以上 CDN URL：

[官方地图内容列表 API](https://sg-public-api-static.hoyoverse.com/content_v2_user/app/a1b1f9d3315447cc/getContentList?iAppId=32&iChanId=413&iPageSize=50&iPage=1&sLangKey=en-us)

曾检查的官方角色页黄昏背景带明显预设模糊和 SUMERU 文字，未选用，已删除本地候选。最终只保留以上两张。

素材来源为原神官方，权利归原权利人；公开可访问与项目代码许可分开记录，不据此宣称已获得独立再分发许可。
