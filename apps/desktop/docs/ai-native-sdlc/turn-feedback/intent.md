# Intent: 会话逐轮反馈闭环

- Author: 浙水智能体用户
- Captured: 2026-08-28
- Status: accepted
- Source: 当前产品对话

## Problem

用户等待浙水智能体完成一轮工作后，只能看到回复与耗时，不能就该轮结果直接给出结构化评价。产品也无法把评价稳定关联到产生它的 session 与回复内容，后续难以定位低质量结果、复盘或形成评估集。

## Proposed outcome

每轮已完成的智能体回复在删除与耗时之后，以同一排的轻量操作项展示五颗星和反馈输入框。用户可选择 0–5 星并输入意见；数据与对应 SessionRecord 一起持久化，重启和重新打开会话后仍能恢复。

## Affected users and systems

- 使用桌面端或 Web 工作台查看会话的用户。
- 会话时间线、session catalog、Electron IPC 与 Web session update 边界。

## Constraints

- 保持 session-first：反馈按稳定 sessionId + turnId 归属，不使用全局临时状态。
- 不改写 pi/DSH 的后端会话日志；反馈属于 PiDeck 产品层元数据。
- 兼容没有反馈字段的旧 SessionRecord。
- 星级支持整数 0–5；意见长度最多 2000 字符。
- 中文和英文界面、键盘与屏幕阅读器语义同步支持。

## Success measures

- 星级点击后可立即持久化，意见停止输入后 1 秒内持久化。
- 重新加载 catalog 后，星级和意见与原回复轮次一致。
- 无效星级或超长意见在主进程边界被拒绝。
- 针对性测试、类型检查和实际界面截图验证通过。
