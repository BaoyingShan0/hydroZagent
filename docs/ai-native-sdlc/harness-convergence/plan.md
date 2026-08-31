# Plan: Agent Harness 运行收敛与资源止损

- Author: 浙水智能体用户 / Codex
- Captured: 2026-08-28
- Accepted: 2026-08-28
- Status: accepted / implementation-in-progress
- Source intent: [`intent.md`](./intent.md)
- Source spec: [`spec.md`](./spec.md)
- SDLC stage: Build / S0–S3 complete, S4 next

## 1. 执行原则

按 AI-Native SDLC 将实现拆成可独立审查、验证和回滚的纵向切片。每个切片必须保持主分支可运行，不允许先铺开 Agent core、AgentSession、RPC 和 PiDeck 后再统一补测试。

计划遵守以下硬约束：

1. 先落无行为变化的 core contract，再接 detector；不得用一次大重构同时改变 loop lifecycle 和策略。
2. `packages/agent` 是 admission、detector 和 typed outcome 的唯一权威；`packages/coding-agent` 只负责编排和适配。
3. `AgentSession` v1 只保存同进程 task runtime；不得实现伪 durable program counter。
4. PiDeck/TUI 只消费 `AgentSessionEvent`/RPC；不得复制 fingerprint、预算或 pause 判定。
5. 所有生产 enforcement 先经过 `off → observe → enforce canary → default enforce`。
6. 每个切片先运行针对性测试和非写入检查；仓库 `npm run check` 含 `biome check --write`，只能在隔离/干净 feature worktree 中作为里程碑检查运行，并在之后复核 diff。
7. 本计划不实现 AgentHarness v2 runtime，但所有新增接口必须能映射到其 effect intent、usage ledger 和 `run_suspend`。
8. v1 不实现 parent budget。该能力必须由 v2 durable runtime 提供受管 snapshot/provider 与安全更新事件，不能只在纯 controller 中留下不可触达字段。

## 2. 预计变更面

### `packages/agent`

- `src/types.ts`：`BeforeRequestContext`、`EffectAdmission`、`AgentLoopExit/Result`、加法式 `agent_end` outcome、tool observation 与外部 effect event。
- `src/agent-loop.ts`：单一内部 typed engine、兼容低层 adapters、provider gate、工具阶段拆分、二次 validation、原子 admission 和 source-order observation。
- `src/agent.ts`：`promptWithOutcome()` / `continueWithOutcome()` 与 outcome-aware lifecycle，保留现有 void compatibility wrapper。
- `src/convergence/`（新增）：types、canonicalizer、controller、limits、usage dedupe、profiles 和公开入口。
- `src/index.ts`：导出稳定的 convergence contract。
- `src/harness/telemetry.ts`：Harness telemetry schema v2 与 convergence span。
- `docs/harness.md`：只记录未来 v2 mapping，不复制本 spec。
- `test/agent-loop.test.ts`、`test/agent.test.ts`：core lifecycle 和兼容回归。
- `test/convergence/trace-schema.ts`、`trace-reader.ts` 与 `*.test.ts`（新增）：版本化 fixture contract、独立 reader、纯 controller、replay、clock、limits、usage 与 admission。
- `test/harness/telemetry.test.ts`：schema/cardinality/attributes。
- `test/fixtures/convergence/manifest.json` 与 case fixtures（新增）：脱敏事故 trace、负样本及 expected decision boundary。

### `packages/coding-agent`

- `src/core/agent-session.ts`：task runtime、hook 组合、pause lifecycle、同进程 resolution 与 continuation gate。
- `src/core/sdk.ts`：构造 Agent 时安装 Harness-owned request/effect adapter，不改变 provider extension 顺序。
- `src/core/model-runtime.ts`：审计并覆盖 `stream` / `streamSimple` / `fetchDeferred` 的真实 dispatch；`complete*` 只沿用 stream 派生路径。
- `src/core/provider-effect-adapter.ts`（新增）：provider 类 effect 的共享 EffectRef/admission/event/usage 编排边界。
- `src/core/convergence/convergence-audit.ts`（新增）：typed audit helper，只调用 `appendCustomEntry()`。
- `src/core/settings-manager.ts`：`ConvergenceSettings`、profile/override 校验与默认 rollout mode。
- `src/core/extensions/types.ts`：更新 tool mutation contract，明确 mutation 后由 core 二次校验。
- `src/core/session-manager.ts`：不改存储 schema；复用 audit-only `appendCustomEntry()`，禁止 `appendCustomMessageEntry()`。
- `src/core/compaction/compaction.ts`、`branch-summarization.ts`：manual/auto compaction、summary 与 branch summary 全部接收共享 ProviderEffectAdapter。
- `src/modes/json-event.ts`：加法式透传 convergence 事件。
- `src/modes/rpc/rpc-types.ts`、`rpc-mode.ts`、`rpc-client.ts`：状态、幂等 resolution command/response。
- `src/modes/interactive/interactive-mode.ts`：TUI pause 提示与恢复动作。
- `test/agent-session-*.test.ts`、`test/rpc*.test.ts`、`test/settings-manager*.test.ts`：session、continuation、配置和协议回归。

### PiDeck desktop

- `src/shared/types/agent.ts`：投影 `convergenceState`，保持 `AgentStatus` 与 backend 能力边界。
- `src/main/pi/PiRpcClient.ts`：typed resolution request。
- `src/main/pi/AgentManager.ts`：消费 pause/settled/get_state，投影 pausing/paused/historical_pause。
- `src/renderer/src/atoms/session-atoms.ts`：session-scoped convergence state。
- `src/renderer/src/hooks/useSessionSend.ts`：paused 时阻止普通发送并提交 resolution。
- `src/renderer/src/components/session/ChatSessionPane.tsx` 或相邻新组件：最小 pause banner/actions。
- `src/renderer/src/i18n/rendererCopy.zh-CN.ts`、`rendererCopy.en-US.ts`：双语原因、用量和恢复文案。
- `tests/agentSettledContract.test.mjs`、`sessionProcessEvents.test.mjs`、`sessionRuntimeUi.test.mjs` 与新增 convergence UI contract test。

## 3. 依赖顺序

```text
S0 基线/fixture
  -> S1 Core typed effect/lifecycle（always-admit）
      -> S2 Pure ConvergenceController
          -> S3 Tool pipeline + atomic admission
          -> S4 Provider/continuation + resource accounting
              -> S5 AgentSession pause/resolution
                  -> S6 Settings/RPC/TUI/audit/telemetry
                      -> S7 PiDeck projection/actions
                          -> S8 Eval calibration + enforce rollout
```

S3 与 S4 在 S1/S2 完成后可以独立开发，但合并顺序固定为 S3 后 S4，减少 `agent-loop.ts` 与 `AgentSession` 冲突。S5 不得在 S3/S4 的 effect-start 不变量通过前开始 enforcement。

## 4. 实施切片

### S0：冻结基线并建立事故 trace

目标：在改 core 前锁定现有兼容语义，并把真实事故转换成可重放、无敏感正文的结构化 fixture。

变更：

- 在 `agent-loop.test.ts` 固化现有 sequential/parallel source order、`terminate` 聚合、extension block、abort 与 tool lifecycle event 顺序。
- 在 coding-agent runtime tests 固化 retry/failover/compaction 与 `agent_end → agent_settled` 现有顺序。
- 从原 JSONL 只提取 tool name、规范化参数/结果 hash、error class、usage、相对时间和序号；删除 prompt、输出正文、绝对路径、provider credential/headers。
- 增加负样本骨架：bounded polling、分页、测试重跑、渐进搜索、长命令和并行读取。
- 新增 `test/convergence/trace-schema.ts` 和 `trace-reader.ts`。Fixture manifest 固定 `schemaVersion`、`controllerVersion`、`canonicalizerVersion`、`hashAlgorithm`、case 文件和 expected decisions；reader 遇到未知版本、缺字段或敏感原文字段即失败。

验证：

- `npm --prefix packages/agent test -- test/convergence/trace-reader.test.ts` 能用独立 reader 加载 manifest/cases，得到稳定 observation sequence，并验证版本拒绝与敏感字段拒绝。
- 本切片不修改生产代码；基线测试必须在改动前通过。

退出标准：存在可证明旧行为的测试与脱敏 fixture，后续切片可以显示具体 diff，而非凭印象判断兼容。

### S1：落 typed effect/lifecycle，保持 always-admit

目标：补齐 spec 所需 core seam，但默认 adapter 永远 `admitted`，因此无收敛行为变化。

变更：

- 定义 `EffectRef`、`EffectAdmission`、`ExternalEffectEvent`、`BeforeRequestContext`、`AgentLoopExit` 和 `AgentLoopResult`。
- 抽出单一内部 loop engine 返回 `AgentLoopResult`；现有公开 `agentLoop()` / `agentLoopContinue()` 保持 `EventStream<AgentEvent, AgentMessage[]>`，`runAgentLoop()` / `runAgentLoopContinue()` 保持 `Promise<AgentMessage[]>`。
- 新增 `runAgentLoopWithOutcome()` / `runAgentLoopContinueWithOutcome()`；旧四个低层 API 只做兼容适配并共享同一 engine。
- 新增 `Agent.promptWithOutcome()` / `continueWithOutcome()`；现有 `prompt()` / `continue()` 继续返回 `Promise<void>`。把 `runWithLifecycle()` 改为正常返回 typed outcome；只有真实异常进入 `handleRunFailure()`。
- 在 provider dispatch 前增加 `beforeRequest` 调用点；默认实现 always-admit。
- 引入 `external_effect_start/end`，暂不接 budget。
- Core `AgentEvent.agent_end` 加法式增加可选 `outcome/pauseId`，并同步扩展 AgentSession/extension 的同名字段；不新建平行 pause event shape。

验证：

- Type-level/runtime contract test 证明现有四个低层 loop API 和 Agent public API 无需修改调用方式即可通过，事件/result 仍按旧形状可消费。
- `beforeRequest: paused` 不调用 streamFunction、不追加 assistant error；cancelled 保持 abort 语义。
- Typed pause 正常穿过 lifecycle：`agent_end(outcome="paused", pauseId)`；AgentSession 投影时 `willRetry=false`，extension forwarding 不丢字段。
- `external_effect_start` 与真正 stream/tool dispatch 一一对应。

回滚：typed 方法和事件均为加法式；若后续策略关闭，always-admit 路径仍可长期保留并服务 AgentHarness v2。

### S2：实现纯 `ConvergenceController`

目标：完成不依赖 AgentSession/工具/UI 的确定性策略，并使任意 trace 可 replay。

变更：

- 实现 canonicalJson/versioned hash、FIFO、streak、cause signature、warning dedupe 与三层 decision。
- 实现 `ConvergenceTaskSnapshot`、monotonic clock 注入、usageEntryId dedupe、CAS `updateLimits()` 和 one-time permit；不加入 v1 无 runtime producer 的 parent snapshot。
- 实现 `off | observe | enforce` 的同算法投影；第一版 profile 数值仅为测试 fixture，不作为产品默认。
- 未知工具 classifier 默认 `unknown`；built-in classifier 留注册接口，不在本切片猜语义。

验证：

- 相同 snapshot + observation + clock/usage delta 得到 byte-equivalent snapshot 与 decision。
- 覆盖 equality、overflow-safe integer、FIFO eviction、epoch reset、limit revision conflict、usage replay 和 allow-once consumption。
- Property/table tests 验证 tier 顺序和 decision priority。

退出标准：controller 可在没有 Agent loop 的情况下重放事故/负样本，并输出稳定 cause signature。

### S3：接入工具 pipeline 与并行原子 admission

目标：建立工具侧最关键的安全不变量，默认仍只使用 off/observe。

变更：

- 将 tool pipeline 显式拆为 prepare、admit/execute、finalize/observe 三阶段。
- Extension `tool_call` mutation 后用同一 schema 二次 validation；新增 `beforeToolEffect`。
- 所有 immediate/executed outcome 统一生成 `ToolOutcomeObservation` 和稳定 `errorClass`。
- Parallel Promise closure 在 `tool.execute()` 前同步调用 `admitEffect()`；prepare 阶段 latch pause 时，先前 prepared sibling 也不得执行。
- 保留 `tool_execution_start` 为 planned lifecycle；新增 effect event 表示实际执行。
- S3 只交付 `packages/agent` core seam，不在 AgentSession 启用 controller。AgentSession hook composition 与 runtime controller ownership 明确延后到 S5，并以 S4 的共享 provider adapter 为前置；因此 S3 完成不代表产品 runtime 已 enforce。

验证：

- 使用可控 `Deferred`/barrier 和有序 event log 构造三工具 parallel batch：第二个 preflight 设置 latch，在释放任何 execute barrier 前断言三个 execute spy 均为 0；全部 planned call 有 start/end observation。
- 再构造“第一个 effect 已 admitted 并在 execute 内同步设置 pause、随后停在 deferred promise”的场景；释放第一个 effect 前后都断言 latch 之后没有新的 `external_effect_start`，后续 sibling execute spy 为 0，最终仅第一个 settle。测试不得依赖调度时序偶然通过。
- Effect lifecycle rejection test 让异步 `external_effect_start` emit reject，同时证明已同步启动的工具仍等待完成并恰好尝试一次 `external_effect_end`，之后才向上传播 emit failure。
- Guard block `isErrorForModel=true`，但 toolErrors/repeat/no-progress 均不增加。
- Unknown tool、两次 validation、extension block/throw、normal terminate 行为分别回归。
- `replan_required` 与 `terminate=true`、`shouldStopAfterTurn=true` 同时发生时，replan 优先：产生 replan 的 turn 不调用 stop hook，下一 provider turn 必须发生，完成后才恢复 stop hook。

回滚：`mode=off` 只保留阶段化 pipeline/二次校验；不得通过恢复旧 Promise.all 路径回滚。

### S4：覆盖 provider、retry、fallback、compaction 和 usage

目标：保证所有 provider 类 effect 共用一次 admission，并在同一 task budget 中幂等记账。

变更：

- 新增 session-scoped `ProviderEffectAdapter`，统一创建 source-ordered EffectRef、调用一次 admission、发送 `external_effect_start/end` 并以 `usageEntryId` settle；它委托现有 `ModelRuntime`，不复制 provider/retry/extension 逻辑。
- 审计并覆盖 `model-runtime.ts` 的 `stream`、`streamSimple`、`fetchDeferred`；`complete`/`completeSimple` 继续从 stream 派生，禁止重复 admission。把 `model-runtime.ts` 纳入 code review 和 bypass test 的必查面。
- Initial request、`agent.continue()`、same-model retry、model failover 经 adapter 提供的 `beforeRequest` admission；manual/auto compaction、compaction summary、branch summarization 与 deferred fetch 直接使用同一个 adapter。`sdk.ts`、`agent-session.ts`、`compaction.ts` 和 `branch-summarization.ts` 不得再传 raw `ModelRuntime` dispatch 绕过它。
- Agent loop path 在 `beforeRequest` 内恰好调用一次 `admitEffect()`，随后调用已 admission 的 raw stream delegate；非 loop path 由 adapter 自身执行同一 gate。任何路径都不得在 wrapper 和 hook 两次 gate 同一 EffectRef。
- `EffectAdmission` 保持 `admitted | paused | cancelled`，不把 controller 内部的 `replan_required` 泄漏给 core `beforeRequest`。`ProviderEffectAdapter.admitProviderRequest()` 是唯一桥接 API：当 snapshot 为 `replan_required` 时，它只允许紧邻的 `provider_request` 在同一同步临界区依次执行 `completeReplanTurn()` 和 `admitEffect()`，再向 core 返回标准 `admitted`；其他 effect kind、普通 wrapper 或直接 `admitEffect()` 均不得消费该 replan entitlement，也不得把 `replan_required` 强转为 `admitted`。
- Replan entitlement 在首次 provider admission 时即消费；dispatch/stream 失败沿用现有 provider retry/fallback，但不得再次调用 `completeReplanTurn()`。Pending cause 被移入 escalated cause 后，同 cause tool admission 再次命中即按 controller 规则升级 pause。
- `_handlePostAgentRun()` 在安排 continuation 前做只读检查，真正 dispatch 再 admission，避免 TOCTOU。
- Provider/tool/compaction settlement 生成稳定 usageEntryId；接入现有 Usage，不复制 token 类型。
- Active time 包含 retry backoff；pause 时冻结 monotonic accumulator。

验证：

- 为 initial/continue、retry、fallback、manual compaction、auto compaction、compaction summary、branch summary 和 deferred fetch 建 table-driven integration tests；每行断言 EffectRef kind/sequence、恰好一次 admission、一次 start/end、稳定 usageEntryId。
- Provider replan contract test 先构造 `replan_required` snapshot，证明 raw `admitEffect({effectKind:"provider_request"})` 仍返回 `replan_required`；再经 `ProviderEffectAdapter.admitProviderRequest()` 证明 `completeReplanTurn()` 恰好一次、一个 provider effect 被 admitted/start，而 tool、compaction 和 deferred fetch 均不能消费 entitlement。随后同 cause tool call 必须升级为 pause。
- Provider replan dispatch 失败/retry test 证明 entitlement 不重复消费、cause escalation 不丢失、每个 retry/fallback effect 仍有独立 EffectRef 和一次 admission。
- 每条路径在 pause/cancelled 时 provider/stream/fetch/payload-extension spy 均为 0；latch 后 event log 不出现新的 `external_effect_start`。
- Retry/fallback/compaction 不重置 taskRunId、hard counters 或 usage seen IDs。
- 同一 usageEntryId settle/replay 两次只累计一次；usage 缺失不影响 error/time/call detector。

退出标准：任何已知 provider 调用路径都必须在测试中出现对应 `external_effect_start`，不存在旁路。

### S5：实现 AgentSession pause 与同进程 resolution

目标：完成 `pausing → paused → active/settled` lifecycle，并明确阻止隐式绕过。

变更：

- AgentSession 引入唯一的 process-local task runtime：controller、continuation descriptor、pause/resolution registry。
- AgentSession `_installAgentToolHooks()` 在此切片完成组合：extension mutation/block → core revalidate → controller admission；result extension/normalize → controller observation。禁止在 S3 core 和 AgentSession 各维护一套 classifier/state。
- 使用 typed Agent outcome；pause 不创建 assistant error、不触发 retry。
- Core `AgentEvent.agent_end` 是 outcome/pauseId 字段的唯一命名源；AgentSession 的 `agent_end` 原样增加这两个可选字段并保留 `willRetry`，`agent_settled` 同样增加可选 outcome/pauseId。JSON/RPC、extension 和 PiDeck 只投影该契约。
- 在 in-flight settle 前投影 `pausing`，最终发送 `agent_end(outcome="paused", pauseId, willRetry=false)`、`agent_settled(outcome="paused", pauseId)` 后投影 `paused`。旧 consumer 忽略新增字段时仍看到原有事件顺序。
- 增加 `isPaused`/`convergenceState`；paused 时普通 prompt/steer/follow-up 返回 `convergence_resolution_required`。
- 实现 `replan`、`allow_once`、`update_limits`、`terminate` 的幂等 resolution；同 task resume 不走会创建新 task 的 public prompt path。

验证：

- 精确事件顺序、core → AgentSession → extension 字段转发、旧 consumer 兼容、`willRetry=false`、无 assistant error 及 streaming/idle/paused 三态均有 contract test。
- 所有 resolutionId 重放、stale pause、CAS conflict、invalid/hard-budget limit、permit consumption 与启动失败均覆盖。
- Resolution 前后 messages、tool results、taskRunId 和累计 budget 不丢失。

退出标准：Harness 可在同一进程暂停并恢复；feature mode 仍默认 observe，不对一般用户强制阻断。

### S6：配置、RPC、TUI、审计与 telemetry

目标：形成完整的非桌面 Harness 产品面，具备配置、解释、恢复、重连和观测能力。

变更：

- SettingsManager 增加 schema validation、profile/override 合并、rollout mode 和 limit revision。
- RPC 增加 convergence state、事件、`resolve_convergence` command/typed response；rpc-client 加同名方法。
- JSON/print/TUI 模式加法式透传事件；TUI 显示 reason、observed/limit、usageKnown 和允许动作。
- 新增 typed `ConvergenceAuditWriter`，只调用 `SessionManager.appendCustomEntry("harness.convergence.pause.v1" | "harness.convergence.resolution.v1" | "harness.convergence.restart.v1", data)`；禁止使用进入 LLM context 的 `appendCustomMessageEntry()`。
- 固定 pause 顺序为 latch → pause audit append attempt → `convergence_pause(auditStatus)` → in-flight settle → `agent_end` → `agent_settled`。Audit append 失败保持 latch，事件标记 `auditStatus="failed"`，不得继续 dispatch；audit entry id 仅供本地 writer/session 关联，不进入 RPC 或 telemetry。
- 固定 resolution 顺序为 validate → 补写缺失 pause audit → append resolution audit → clear latch/install permit → start invocation。任一 audit 写失败返回 `audit_write_failed` 并保持 paused；重启后只投影 `historical_pause/new_task_only`。
- Harness telemetry schema 升 v2，增加 `pi.harness.convergence`；远程导出严格服从 `enableAnalytics`。
- 更新 telemetry generated docs/check fixture。

验证：

- 旧 RPC 客户端忽略未知事件；新 client 对 success/error/idempotency round-trip。
- Session context reconstruction test 证明三类 audit entry 均为 `type="custom"`、不会进入后续模型 messages；append failure tests 证明 latch/事件顺序和 typed RPC error。
- 重启 fixture 不允许 allow_once/原 task continue，只允许 replan_new_task/terminate。
- Telemetry schema 拒绝 ID、hash、tool name、路径和正文；analytics off 时 exporter spy 为 0。
- TUI 在 paused 后不再显示 streaming，resolution 后恢复同 task。

Harness milestone：S0–S6 全绿后，Harness 层功能完整；在 PiDeck 接入前保持默认 observe。

### S7：PiDeck 状态投影与恢复操作

目标：PiDeck 只展示 pi 权威状态，并允许用户执行同一 RPC resolution。

变更：

- 在 shared `AgentRuntimeState` 增加可选 convergenceState；不扩展 DSH/imagegen 行为。
- AgentManager 处理 convergence event、agent_settled 和 get_state 重连；`paused` 不映射成 error，也不保持 running spinner。
- Renderer atom 保存 session-scoped 状态；发送 hook 在 paused 时显示 typed 阻断。
- 增加最小 pause banner：主原因、当前值/限额、usage unknown、重新规划、放行一次、调整限额、终止；最终视觉不在本计划定稿。
- 所有 action 通过 PiRpcClient；UI 不生成 cause signature、permit 或新预算。

验证：

- `pausing → paused → active/settled` UI contract、重连 historical pause、旧 pi 无字段兼容。
- `agent_settled(outcome=paused)` 不触发成功完成通知，不被 get_state 的旧 streaming 值覆盖。
- DSH/imagegen backend 测试证明未获得 convergence capability 时不显示操作。

退出标准：TUI、RPC 与 PiDeck 都能解释并处理 pause，enforce canary 才可开始。

### S8：Eval 校准与分阶段 enforce

目标：用版本化证据确定 profile 数值并安全启用 enforcement。

变更：

- 完成事故正样本和负样本 classifier；逐个记录 expected decision boundary。
- 在同一 trace 上比较 conservative/balanced/strict，输出版本化 calibration report，而非把数字埋在代码注释。
- Observe 阶段采集触发率、manual abort、would-pause、usage missing、allow-once 后 progress；共享 telemetry 仍需 opt-in。
- Profile 常量携带 `profileRevision`，变更必须附 eval diff/changelog。
- 先内部/显式用户 canary enforce，再将 balanced 设为默认；出现异常可仅改 mode 回 observe。

发布门禁：

- 所有正样本在声明 boundary 触发，且 pause 后 `external_effect_start` 为 0。
- Mandatory 负样本无 hard pause；bounded polling 只在 policy 上限后触发。
- 所有 resolution、restart boundary、missing usage 和 old-client compatibility 测试通过。
- Targeted tests、telemetry docs check、desktop typecheck 与非写入检查通过；最终仓库 `npm run check` 只在隔离/干净 worktree 运行并复核其写入 diff。若存在既有失败，保存命令、失败项和无关性证据。

## 5. Spec 不变量到测试的映射

| Spec 不变量 | 首次证明切片 | 长期回归位置 |
| --- | --- | --- |
| pause 后零新 effect start | S1/S3/S4 | agent-loop + agent-session convergence tests |
| parallel prepared sibling 不执行 | S3 | `packages/agent/test/agent-loop.test.ts` |
| 四个低层 loop API 返回类型兼容 | S1 | agent-loop compile/runtime compatibility tests |
| pause 不是 assistant error/retry | S1/S5 | agent + agent-session retry tests |
| extension 后二次 validation | S3 | agent-loop + extensions runner integration |
| immediate outcome 统一 observation | S3 | agent-loop observation table tests |
| usage replay 不重复累计 | S2/S4 | controller usage + compaction/retry tests |
| 所有 provider 类路径无旁路且只 admission 一次 | S4 | ProviderEffectAdapter table tests + ModelRuntime bypass audit |
| pause 后 idle 且 isPaused | S5 | agent-session runtime events |
| audit 不进 context，失败不解锁 | S6 | convergence audit + session context + RPC failure tests |
| v1 restart 只允许 new task | S6 | custom entry + RPC restart fixture |
| telemetry 低基数且 opt-in | S6 | harness telemetry + analytics spy |
| PiDeck 不复制 detector | S7 | shared type/projection/UI contract tests |

## 6. 验证命令

实施时按切片选择最小集合，里程碑运行完整集合：

```powershell
npm --prefix packages/agent test -- test/convergence/trace-reader.test.ts
npm --prefix packages/agent test -- test/agent-loop.test.ts test/agent.test.ts test/convergence
npm --prefix packages/agent run test:harness -- test/harness/telemetry.test.ts
npm --prefix packages/agent run check:telemetry-docs
npm --prefix packages/coding-agent test -- test/provider-effect-adapter.test.ts test/convergence-audit.test.ts test/agent-session-runtime-events.test.ts test/agent-session-retry.test.ts test/agent-session-failover.test.ts test/agent-session-compaction.test.ts test/rpc.test.ts test/settings-manager.test.ts
node --test apps/desktop/tests/agentSettledContract.test.mjs apps/desktop/tests/sessionProcessEvents.test.mjs apps/desktop/tests/sessionRuntimeUi.test.mjs
npm --prefix apps/desktop run typecheck
npx --no-install biome check .
npx --no-install tsgo --noEmit
```

实际新增测试文件应加入命令。不得只依赖整仓 `npm test` 的最终结果来定位 core lifecycle 回归。若 workspace 的 `tsgo` 需要 package-local config，则在对应 package 目录运行等价的非写入 typecheck。

最终发布门禁另在隔离/干净 feature worktree 运行 `npm run check`。该脚本包含 `biome check --write`，不得在含用户未提交改动的共享 worktree 直接运行；执行前后记录 `git status --short` 和 diff，确认没有越界机械改写。

## 7. 回滚与发布控制

- S1 core additions 为加法式；always-admit 是永久兼容 fallback。
- S2–S6 通过 `mode=off/observe` 关闭 v1 收敛决策，不删除已经产生的本地审计；现有 timeout/retry/abort 始终保留。
- S7 UI 可在未知/disabled capability 下隐藏，不影响后端 pause 安全性。
- Enforce 回滚首选把 profile mode 降为 observe；无需回滚 session schema，因为 custom entries/事件均为加法式。
- Telemetry v2 exporter 不兼容时可停止导出 convergence span；本地事件与 pause 不依赖 telemetry。
- 任何时候发现 pause 后仍有新 effect start，立即停止 rollout；该问题不能通过提高阈值规避。

## 8. 明确不在本计划实现

- AgentHarness v2 durable operation runtime、child lane accounting 和 crash-safe exact resume。
- Parent budget runtime 注入、managed ceiling 和安全更新事件；这些属于 AgentHarness v2，不进入 v1 acceptance/DoD。
- 进程重启后恢复同一 v1 task run。
- 使用模型自述判断 progress，或按某个模型/provider 写特判。
- PiDeck 中复制 tool classifier、fingerprint 或 budget state machine。
- 未经 eval 直接写死 balanced/strict 默认阈值。
- 原事故中的 diff UI bug 与 PiDeck pause banner 的最终视觉设计。

若产品将“首版必须跨进程精确恢复”改为硬需求，应停止 S5–S7，先另立 AgentHarness v2 operation implementation plan；不得扩张 v1 custom entry 绕过该依赖。

## 9. Definition of done

1. S0–S8 的退出标准全部满足，所有 spec 不变量有自动化测试。
2. 正常 Agent public API、extension 顺序、terminate、abort、retry、fallback、compaction 与旧 RPC 客户端保持兼容。
3. 任一 enforce pause 后直到 matching resolution，provider/tool `external_effect_start` 数为 0。
4. TUI、RPC、PiDeck 能显示权威原因和执行全部允许的 recovery action。
5. V1 same-process 与 historical-pause 边界在代码、协议、UI 和测试中一致。
6. Telemetry schema v2、隐私字段、analytics opt-in 和生成文档通过检查。
7. Profile 数值来自版本化 eval/calibration report，rollout 可一键降级到 observe。
8. 临时 AgentSession adapter 的 v2 mapping 与删除条件有代码注释/文档引用，没有第二个 durable state machine。
9. `ModelRuntime.stream/streamSimple/fetchDeferred`、manual/auto compaction、compaction/branch summary、retry/fallback 均通过共享 ProviderEffectAdapter 的逐路径测试，无 raw dispatch 旁路。
10. Pause/resolution/restart audit 仅使用 `appendCustomEntry()`，不进入 LLM context；audit failure 保持 pause 且返回 typed error。

## 10. Implementation checkpoints

### 2026-08-28 — S0 complete

- 新增版本化 trace schema、独立 reader、manifest、脱敏事故 fixture 和六类 negative controls。
- 事故窗口只保存相对时间、工具名、call/result SHA-256、错误分类和 usage；验证连续 23 次相同失败调用，不包含 prompt、args、result 正文、路径、model/provider 或 credential。
- 证据：trace reader 5/5；既有 Agent baseline 45/45；coding-agent retry/failover/runtime 11/11；faux-provider compaction 20/20。

### 2026-08-28 — S1 complete

- 保留 `agentLoop()`、`agentLoopContinue()`、`runAgentLoop()`、`runAgentLoopContinue()` 的既有返回类型；新增 outcome-aware helpers。
- 新增同步 `beforeRequest`、provider `external_effect_start/end`、typed `AgentLoopResult` 和 `Agent.promptWithOutcome()/continueWithOutcome()`；默认未安装 gate 时保持 legacy dispatch/event 行为。
- Core、AgentSession 和 extension 的 `agent_end` 使用同一可选 `outcome/pauseId` 字段；最终 outcome 投影到 `agent_settled`，paused/aborted 不进入 retry 判定。
- 证据：Agent targeted tests 57/57；coding-agent outcome/retry/settled tests 28/28；targeted Biome 与 `packages/agent` production typecheck 通过。
- 整仓 `tsgo --noEmit` 仍被本切片外的 `packages/ai` Cloudflare/model catalog 类型不一致阻断；未运行会执行 `biome --write` 的整仓 `npm run check`，以保护共享 dirty worktree。

### 2026-08-28 — S2 complete

- 在 `packages/agent` 新增纯 `ConvergenceController`：版本化 canonical JSON/SHA-256、统一 observation 记账、FIFO/streak、warning dedupe、replan provider-turn escalation、resource hard latch，以及 `off | observe | enforce` 的同算法投影。
- Snapshot 对齐 spec 的 `controllerVersion`、数值型 `profileRevision`、全局 `observationSequence`、累计 active time、`observations`、cause escalation、usage ledger IDs 和带 `permitId` 的 one-time permit；未加入 v1 无 producer 的 parent budget。
- `updateLimits()` 使用 field-level patch 和 expected revision CAS；`null` 恢复 profile 值，冲突不做部分更新。Usage 采用 `input + output + cacheWrite`，重复 `usageEntryId` 幂等，缺失 usage 只关闭 token detector 的可知性。
- 未注册工具的 progress 默认 `unknown`；受信 built-in adapter 通过显式 classifier registry 注册，controller 不猜测第三方工具语义。
- 证据：controller table/property/replay tests 22/22；fixture expectations、relative time、usage ledger 均由 replay 驱动；targeted Biome、diff check 与 `packages/agent` production typecheck 通过。

### 2026-08-28 — S3 complete

- Tool pipeline 现已明确分为 source-order prepare、同步 atomic admit/execute、finalize/observe；`tool_execution_start` 保持 planned/preparation 语义，只有 admission hook 存在且实际 dispatch 时才发 `external_effect_start/end`。
- `beforeToolCall`/extension mutation 后由 core 使用同一 schema 二次 validation；unknown、首次/二次 validation、extension block/throw、guard pause、cancelled 和 executed result 均形成统一 `ToolOutcomeObservation`，parallel commit 保持 assistant source order。
- Parallel closure 在调用 `tool.execute()` 前同步执行 `beforeToolEffect`；effect start 的 emit 调用与 `tool.execute()` 之间无 await，因此 execute 同步锁存的 pause 会阻断随后 sibling。已 admission 的 effect 允许 settle，blocked sibling 仍生成 planned start/end 与 model-facing tool result。
- Guard block 保持 `isErrorForModel=true`，但 observation 使用 `guard_block`，由 controller accounting table 排除 toolErrors/repeat/no-progress；extension policy block、unknown tool 和 validation failure 使用各自稳定 error class。
- 证据：两类可控 Deferred/barrier 原子性测试、五类 immediate outcome table、cancel/replan/sibling 与 guard observation 测试通过；Agent convergence + legacy loop tests 88/88；coding-agent extension/concurrency/outcome tests 60/60；targeted Biome、diff check 与 `packages/agent` production typecheck 通过。

### 2026-08-28 — S0–S3 review remediation complete

- Trace replay 不再硬编码 incident/negative 分支：逐条匹配 `trace.expectations`，按 `relativeMs` delta 调用 monotonic time reducer，并按稳定 entry ID 记录每条 usage；同时断言 replay 后 active time、uncached token 与 consumed usage 数量。
- Tool gate 的 `cancelled` 通过 batch control 返回 `AgentLoopExit.cancelled` 并映射既有 aborted lifecycle；`replan_required`、`guard_replan_block` 和 batch-local `sibling_not_admitted` 已成为 core typed contract，replan block 后允许下一 provider turn。
- Paused snapshot 的 tick 只推进 controller clock origin，不再增加 active elapsed；provider credential/context async hook 在 admission 前完成，admission 后同步调用 effect-start/dispatch，dispatch、result 或 async iterator 异常均恰好 settle 一次 effect-end。
- Parallel finalize 固定为 observation commit → `tool_execution_end` → tool-result message 的 source order。未注入 factory/counter 的低层 fallback 使用 process-wide non-repeating sequence 与 UUID effect ID；AgentSession task-scoped producer 仍属于 S5。
- S3 的完成定义已收窄为 `packages/agent` core seam；AgentSession controller ownership、extension/controller hook composition 和 runtime enforce 明确属于 S5，且以前置 S4 provider adapter 为依赖。

### 2026-08-31 — S0–S3 second review remediation complete

- Executed result fingerprint 使用不修改原始 tool result 的递归 JSON 投影：对象中的 `undefined` 字段被逐层省略，数组位置、循环和非 plain object 仍由 strict canonicalizer 拒绝。Nested-details 重复调用测试证明 fingerprint 稳定且 `exactRepeatStreak` 可累计。
- Paused latch 不能由 strategy epoch reset 绕过；observation 产生的 `replan_required` 会阻断 sequential sibling effect，并强制下一 provider turn，即使已完成工具设置了 `terminate`。
- 已启动工具的 start event emit 即使异步失败，也会等待 effect 完成并尝试一次 matching end 后再传播错误；强制 replan provider turn 不受 `shouldStopAfterTurn` 提前终止。
- Trace reader 使用严格 schema allowlist 并拒绝常见 secret 字段；`taskSnapshot` 和 API-key/admission 顺序注释已与 runtime contract 对齐。
- S4 已锁定 provider replan entitlement 的单一桥接 API 与失败/retry 测试，不扩张 core `EffectAdmission`。
- 证据：Agent convergence + legacy loop tests 94/94；coding-agent settled regression 3/3；targeted Biome、`git diff --check` 与 `packages/agent` production build 通过。

下一门禁：S4 新增共享 `ProviderEffectAdapter`，先锁定 provider replan entitlement 的 `completeReplanTurn() → admitEffect()` 单入口，再逐路径覆盖 initial/continue/retry/fallback、`ModelRuntime.stream/streamSimple/fetchDeferred`、manual/auto compaction 与 branch summary，确保每个 provider effect 恰好 admission 一次并以稳定 `usageEntryId` settle。
