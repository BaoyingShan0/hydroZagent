# Spec: 会话逐轮反馈闭环

## Product behavior

1. 反馈只出现在已完成且包含 assistant 正文的轮次，紧跟删除按钮与耗时，和操作栏保持同一排；不使用独立卡片。
2. 默认显示五颗未点亮星；点击第 N 颗选择 N 星，再次点击当前星级清回 0 星。
3. 星级立即保存。文字意见在停止输入 650ms 后保存，输入框失焦或时间线窗口卸载时补写。
4. “保存中 / 已保存”通过无障碍 live region 播报但不额外占据视觉空间；只有保存失败可见并可点击重试。
5. 匿名 `noSession` 对话不展示反馈区，因为产品明确不为它建立持久 SessionRecord。

## Data contract

`SessionRecord.turnFeedback` 是可选数组，旧会话缺省为空：

```ts
type SessionTurnFeedback = {
  turnId: string;
  responseMessageId: string;
  rating: number;       // integer, 0..5
  comment: string;      // <= 2000 chars
  durationMs: number;   // non-negative safe integer
  updatedAt: number;
};
```

渲染层复用 `sessions.updateRecord(sessionId, { turnFeedback })`。该 patch 表示单轮原子 upsert，不传递整份数组，因此分屏和连续保存不会覆盖其它轮次。

## Ownership and flow

```text
TurnFeedback UI
  -> preload / browser session update API
  -> desktop IPC or Web request validation
  -> SessionCatalog.update (turnId atomic upsert)
  -> session-catalog.json
  -> returned SessionRecord updates the session-scoped Jotai atom
```

## Governance and compatibility

- `turnId` 与 `responseMessageId` 最大 512 字符，防止无界 catalog 膨胀。
- rating、comment、duration 在主进程边界与 catalog 内双重校验。
- feedback 深拷贝进出 catalog，避免调用方突变持久状态。
- catalog 合并重复会话时，同一 turnId 保留 `updatedAt` 更新的一份。
- 不引入依赖，不新增第二条通信通道，不改变后端 Agent 行为。

## Areas of concern

- `SessionRecord.updatedAt` 会在保存反馈时刷新，意味着刚评价的会话可能移动到侧栏近期位置。这符合“session 内容被更新”的语义；如后续希望只按消息时间排序，应单独引入 `contentUpdatedAt`，不在本功能中混淆两种时间。
- 反馈目前是本地产品数据，不自动上传；任何遥测或集中分析需另行取得用户授权。
