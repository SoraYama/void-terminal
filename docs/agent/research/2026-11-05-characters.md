> **Date / Revised**: 2026-11-05

# 角色图鉴现状与游戏式展示方案

> 以下保留实施前审计结论。用户随后确认「群星图鉴」并授权实现；当前实现及验收状态见 [群星图鉴实施记录](../feature/2026-11-05-character-archive.md)，不可将本文的“尚未实现”当作最新状态。

## 1. Background & Problem

用户要求角色立绘、头像、属性、数值、故事、语音、天赋及命座按游戏内方式展示，并要求建议模块名称。

## 2. Root Cause / Approach

当前角色资料以文献存在，`normalize.py` 处理 Avatar / FetterStory / Fetters，并保留故事、台词到角色的关联；前端只有原文库与万象集录，没有角色页或专用角色接口。角色数值表虽已下载，但普通文本归一化跳过无文本 hash 的数值行。

本地中文补充源为 124 个 characters 文件、109 个 voiceovers 文件；不是已实装角色统计。voiceovers 的 voicefile 是资源标识，没有验证过的播放 URL。主源 AvatarCurve、AvatarPromote、AvatarSkillDepot、AvatarSkill、AvatarTalent、ProudSkill、FetterInfo 等可作为后续聚合输入，尚未验证全量字段连接。

`source_plan.py` 只收五类补充正文和八个物品支持文件，没有角色图片/曲线/天赋/命座支持数据。公开固定提交的 `image/characters.json` 已确认存在头像和立绘映射，但本次没有全量验证图片或音频媒体。

## 3. Key Changes

新增设计草案 `docs/superpowers/specs/2026-11-05-character-archive-design.md`。推荐「群星图鉴 / Character Archive」，独立入口，头像条、大立绘、属性/命之座/天赋/资料/培养分区，与万象集录并列。采用来源真实的二维资源，资料保留游戏条件并允许查阅，音频播放是明确验收项。

本次只完成现状核查与设计草案，没有实现角色目录、角色页面或生产更新。没有修改现有源计划、刷新任务或已有物品代码。

## 4. Conclusions / Lessons

数据文件存在、原文可检索、结构化角色资料可查、图片可见、音频可播放是五种不同状态，不能合并宣称已完成。实施前优先勘验音频和角色形态映射；不能把资源标识拼成猜测 URL，也不能以角色名模糊匹配关联数值、命座或素材。
