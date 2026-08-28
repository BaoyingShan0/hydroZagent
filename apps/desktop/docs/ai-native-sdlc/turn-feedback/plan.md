# Plan: 会话逐轮反馈闭环

## Files that change

- `src/shared/types/session.ts`：反馈契约、限制与共享校验。
- `src/main/sessions/SessionCatalog.ts`：深拷贝、原子 upsert、持久化与重复记录合并。
- `src/main/ipc/sessionIpc.ts`、`src/main/web/WebServiceManager.ts`：不可信输入边界校验。
- `src/renderer/src/components/session/turn/TurnFeedback.tsx`：星级、输入、保存状态与生命周期补写。
- `src/renderer/src/components/session/turn/TurnRow.tsx`：在耗时后装配反馈区。
- `src/renderer/src/utils/sessionRecordIdentity.ts`：catalog 轮询的反馈等价判定。
- `src/renderer/src/i18n/rendererCopy.*.ts`：双语文案。
- `tests/sessionCatalog.test.mjs`、`tests/turnFeedbackUi.test.mjs`：持久化、校验与 UI 契约。

## Order of work

1. 定义共享数据契约和旧数据兼容方式。
2. 在 SessionCatalog 实现按 turnId 的原子 upsert。
3. 补齐桌面 IPC 与 Web 边界校验。
4. 实现并装配反馈 UI。
5. 运行针对性测试和类型检查。
6. 启动真实界面，验证 0/5、5/5、文字输入和保存状态并截图。

## Risks

- 防抖保存期间轮次被时间线窗口裁剪：组件卸载时补写。
- 连续星级/意见请求乱序：请求序号只接纳最后一次响应，catalog 写入本身串行化。
- catalog 轮询覆盖本地输入：有待保存草稿时拒绝用远端记录回填输入框。

## Proof

- `node --test tests/sessionCatalog.test.mjs tests/turnFeedbackUi.test.mjs`
- `npm run typecheck`
- 运行界面后的 DOM 检查和截图。

## Verification result

- 37/37 targeted tests passed.
- Desktop TypeScript check passed.
- Browser interaction passed: click 5 stars, enter Chinese feedback, blur-save, and read the same values back from the session catalog.
- Visual regression screenshot: `test-results/turn-feedback-preview.png` (ignored test artifact).
- Compact inline layout regression screenshot: `test-results/turn-feedback-inline.png` (ignored test artifact).
- Repository-wide `npm run check` reached the existing `packages/ai` model-catalog checks, then failed on unrelated provider/model ID mismatches; the desktop feature gates above remain green.
