# Spec: Agent Harness 运行收敛与资源止损

- Author: 浙水智能体用户 / Codex
- Captured: 2026-08-28
- Revised: 2026-08-28
- Status: accepted
- Source intent: [`intent.md`](./intent.md)
- SDLC stage: Accepted / handed off to Implementation Planning (`plan.md`)

## 1. 设计结论

本功能不新增第二套 Agent loop、retry、usage、session 或 RPC 通道。它在 pi 现有运行时上增加确定性的 `ConvergenceController`，并补齐当前 loop 缺少的两个最小核心边界：

1. `admitEffect()`：在 provider 请求或 `tool.execute()` 真正开始前，同步、原子地决定 `admitted | paused | cancelled`。
2. 类型化 `AgentLoopExit`：让 pause/cancel 正常结束 loop，不通过抛异常伪装成 assistant error。

所有 detector、预算和 pause latch 位于 `packages/agent` 的无 UI、无存储依赖策略层。当前 `packages/coding-agent` 的 `AgentSession` 组合 extension、配置、retry、compaction、事件和同进程恢复。PiDeck、TUI、print 和 RPC 只消费状态及提交 resolution，不自行计算收敛。

`AgentHarness v2` 完成后，同一个 controller 接入其 durable operation、effect mutation line、append-only usage ledger、`run_suspend` 和 `TelemetryContext`。当前适配器必须可删除，不得演化成第二个持久化 Harness。

保护机制不是普通 extension。Extension 可以按现有规则改参、改结果或阻断工具，但其卸载、重载或异常不能绕过 effect gate。

## 2. 现有生态复用与必要增量

| 能力 | 复用/增量设计 | 不做什么 |
| --- | --- | --- |
| `Agent.beforeToolCall` / `afterToolCall` | 保留 extension 兼容入口；新增 extension 后二次校验、Harness-owned `beforeToolEffect` 与统一 `observeToolOutcome` 阶段 | 不包装每个工具形成第二条执行链 |
| `Agent.shouldStopAfterTurn` | 继续作为 turn 后的快速检查 | 不把它当成唯一 provider gate |
| Agent loop | 增加 `beforeRequest`、原子 `admitEffect` 和类型化 loop exit | 不复制或重写第二个 loop |
| `AgentToolResult.terminate` | 保留“整个 batch 均 terminate 才提前结束”的现有语义 | 不用 `terminate` 表达 durable pause |
| extension `tool_call` / `tool_result` | 先完成 mutation，再二次 validation/normalize，最后由 controller 观察 | 不改变 extension handler 链式顺序 |
| `AgentSession` | 当前唯一 task runtime、事件和同进程 resolution 入口 | 不在 TUI/RPC/PiDeck 各做一套 guard |
| retry / failover / compaction | 保留现有实现；每个外部 request 进入同一 effect gate 和 task budget | 不再实现 backoff、error 分类或 compaction |
| `SettingsManager` | 增加可选 `convergence`，沿用现有配置加载、合并与校验 | 不新增独立配置文件 |
| SessionManager custom entry | 只记录 pause/resolution 审计和重启后的历史提示 | v1 不用 custom entry 假装 durable program counter |
| AgentHarness v2 | 长期承载 durable pause、crash replay、parent budget 和 usage ledger | 不在 scaffold 外建立平行状态机 |
| Harness `TelemetryContext` | 将 `HARNESS_TELEMETRY_SCHEMA` 升至 v2，增加低基数 convergence span | 不引入第二个 analytics SDK |
| stdio JSON-RPC / `AgentSessionEvent` | 加法式增加状态、事件和一个幂等 resolution command | 不增加 PiDeck 专用 side channel |

## 3. 作用域、时钟与标识

### 3.1 Task run 与 strategy epoch

- **Task run**：用户在 idle 状态提交 prompt 时创建；正常完成、用户终止或无法恢复的失败才结束。Pause 只让当前 Agent invocation settled，逻辑 task run 保持 paused。
- **Agent invocation**：一次 `agent.prompt()` / `agent.continue()` 生命周期。一个 task run 可包含 retry、fallback、compaction 和 pause 后的多个 invocation。
- **Strategy epoch**：task run 内的一段策略尝试。可信的 replan resolution 开启新 epoch；只清空停滞窗口，不清零累计时间、Token、工具调用或错误。
- **Session**：承载历史和累计展示；新 task run 不继承上一任务的 repeat/no-progress 窗口。
- **Parent budget（v2）**：未来由 durable operation、子 Agent 或 lane 提供的托管 ceiling。v1 没有安全的 runtime 注入路径，因此不声明、不接受也不执行 parent budget。

Steering/follow-up 如果在当前 invocation 中被消费，属于同一 task run；它开始新 strategy epoch，但不重置硬预算。Model failover、model switch、retry 和 compaction 均不新建 epoch。

### 3.2 Effect 与确定性 ID

```ts
type EffectKind = "provider_request" | "tool" | "compaction_request" | "deferred_fetch";

type EffectRef = {
  effectId: string;
  kind: EffectKind;
  taskRunId: string;
  sequence: number;
};
```

- `taskRunId` 在 task 创建时生成并写入本地 task runtime；v2 使用 durable operation id。
- `sequence` 在 source-order planning 时单调递增，不使用并发完成顺序。
- v1 `effectId = ${taskRunId}:${kind}:${sequence}`；同一计划重试不复用 effectId，crash replay 由 v2 durable intent id 负责。
- `eventId` 标识每个 warning/replan/pause 事件；`pauseId` 标识一次 pause 生命周期。二者可以相同，但协议不依赖相等关系。
- `limitRevision` 是从 1 开始的单调整数；每次有效 profile/config 变更加一。

### 3.3 单调时钟

- v1 active time 使用注入的 monotonic clock（Node 中为 `performance.now()`）累计 delta；wall-clock timestamp 只用于审计展示。
- Pause 前冻结累计值，resolution 后以新的 monotonic origin 继续；不得通过 `Date.now()` 相减计算预算。
- v1 不支持进程重启后继续同一 task run，因此不需要跨进程拼接 monotonic delta。
- v2 在 durable boundary 持久化 `accumulatedActiveMs`，resume 时建立新 monotonic origin；wall clock 回拨不影响预算。

## 4. 核心状态、admission 与 loop exit

### 4.1 状态机

```text
active
  ├─ soft threshold ───────────────> active + warning
  ├─ recoverable stagnation ───────> replan_required
  │                                   ├─ progress/replan ─> active (new epoch)
  │                                   └─ same cause ─────> paused
  ├─ hard budget ─────────────────> paused
  └─ completion/abort/failure ────> settled

paused
  ├─ same-process resolution ─────> active
  ├─ terminate ───────────────────> settled
  └─ process restart (v1) ────────> historical_pause
                                      └─ replan_new_task / terminate
```

### 4.2 原子 admission

```ts
type EffectAdmission =
  | { kind: "admitted"; effect: EffectRef; permitId?: string }
  | { kind: "paused"; pause: ConvergencePauseSnapshot }
  | { kind: "cancelled"; reason: "user_abort" | "operation_cancelled" };

type ExternalEffectEvent =
  | { type: "external_effect_start"; effect: EffectRef }
  | {
      type: "external_effect_end";
      effect: EffectRef;
      outcome: "completed" | "error" | "cancelled";
    };
```

`admitEffect(ref, snapshot)` 必须满足：

1. v1 中为同步操作，v2 中运行于 operation 的单一 mutation line；检查 latch、比较预算、消费 `allow_once` permit 与登记 in-flight 不可分割。
2. 它位于最后一个异步 hook 之后、真正的网络调用/`tool.execute()` 之前，中间不得再 `await` 用户代码。
3. 返回 `paused` 时先原子设置 pause latch，再生成 snapshot；所有之后的 admission 返回同一 `pauseId`。
4. 返回 `admitted` 后立即发 `external_effect_start` 并启动 effect。Effect settle 后以同一 `effectId` 移出 in-flight。
5. 用户 cancellation 优先于 pause；cancel 不创建 convergence 事件。

### 4.3 Provider gate 与类型化退出

Agent core 增加 Harness-owned `beforeRequest`，不是 extension event：

```ts
type BeforeRequestContext = {
  effect: EffectRef;
  model: { provider: string; id: string };
  taskSnapshot: ConvergenceTaskSnapshot;
};

type AgentLoopExit =
  | { kind: "completed" }
  | { kind: "paused"; pauseId: string }
  | { kind: "cancelled"; reason: "user_abort" | "operation_cancelled" };

type AgentLoopResult = {
  messages: AgentMessage[];
  exit: AgentLoopExit;
};
```

`beforeRequest` 返回 `EffectAdmission`：

- `admitted`：进入现有 `streamFunction`，之后才运行 provider payload/header extension。
- `paused`：不调用 `streamFunction`，不创建 assistant message，不抛异常；loop 正常返回 `{kind:"paused"}`。
- `cancelled`：不创建 convergence pause；loop 返回 `{kind:"cancelled"}`，沿用 aborted lifecycle。
- 真正的未处理异常仍进入现有 `handleRunFailure()` 并形成 assistant error。

`replan_required` 是 controller 内部状态，不扩展 `EffectAdmission`，也不由 core loop 猜测或通过类型强转放行。S4 的 `ProviderEffectAdapter.admitProviderRequest()` 是唯一桥接入口：当 controller 已处于 `replan_required`，它仅为紧邻的 `provider_request` 在同一同步临界区执行 `completeReplanTurn()` 后立即调用 `admitEffect()`，并向 `beforeRequest` 返回标准 `admitted`。Tool、compaction、deferred fetch、普通 provider wrapper 和 raw `admitEffect()` 都不能消费这次 entitlement。Entitlement 在 provider admission 时消费；provider dispatch 失败后的 retry/fallback 不得再次 complete，同 cause tool admission 再次命中时升级 pause。

`beforeRequest` 是 provider adapter 对 `admitEffect()` 的唯一调用点，而不是 admission 之前的第二个可变检查；同一 EffectRef 只能 admission 一次。Tool path 则由同步 `beforeToolEffect` 计算 detector decision，再在 execute closure 中调用一次 `admitEffect()`。

现有公开低层 API 必须保持二进制/类型兼容：`agentLoop()` / `agentLoopContinue()` 继续返回 `EventStream<AgentEvent, AgentMessage[]>`，`runAgentLoop()` / `runAgentLoopContinue()` 继续返回 `Promise<AgentMessage[]>`。内部只保留一个 loop engine，它产生 `AgentLoopResult`；新增 `runAgentLoopWithOutcome()` / `runAgentLoopContinueWithOutcome()` 消费该 engine 并返回完整结果，旧函数仅适配/丢弃 `exit` 后返回 `messages`。不得复制第二套 loop。

`Agent` 新增 `promptWithOutcome()` / `continueWithOutcome()`；现有 `prompt()` / `continue()` 保持 `Promise<void>`，作为忽略 outcome 的 compatibility wrapper。`runWithLifecycle()` 以正常返回值传递 typed pause/cancel；只有真实未处理异常进入 `handleRunFailure()`。`AgentSession` 必须使用 typed path。禁止用 sentinel exception 实现 pause。

### 4.4 保护级别和优先级

1. `warning`：只发事件/遥测；同一 dedupe key 只发一次。
2. `replan_required`：仅用于 exact repeat/no-progress。当前调用产生 guard tool result，但不执行 effect；允许一次 provider turn 改变策略。
3. `paused`：关闭 admission latch，等待显式 resolution。Hard resource budget 直接 pause，不自动增加 provider turn。

`replan_required` 的强制 provider turn 高于通用 `shouldStopAfterTurn`：产生 replan 的 tool turn 不调用该 hook，不能被它提前结算；强制 provider turn 完成后恢复正常 stop hook 语义。Cancel 和 paused 仍高于 replan。

同一边界优先级固定为：cancel → existing pause → local hard limit → repeat/no-progress escalation → warning → admit。一次决策只选一个主原因，其余记入 `contributingReasons`。Parent hard limit 的优先级留给 v2 conformance spec 定义，不进入 v1 controller。

## 5. 工具阶段、effective args 与统一观测

### 5.1 强制阶段顺序

```text
prepareArguments
  -> schema validation #1
  -> extension tool_call mutation/block
  -> schema validation #2 on mutated args
  -> Harness beforeToolEffect(effective args)
  -> prepare outcome
  -> admitEffect() immediately before execute
  -> external_effect_start
  -> tool.execute
  -> extension tool_result rewrite
  -> image/result normalization
  -> observeToolOutcome(final outcome)
  -> tool/message events and persistence
```

- Extension block 立即形成 `extension_block` outcome，不进入第二次 validation。
- Extension 未阻断时，修改后的对象必须用同一 tool schema 再校验；失败时不执行，分类为 `invalid_arguments_after_extension`。
- Harness-owned `beforeToolEffect` 是二次 validation 后的同步 controller 调用，不运行 extension/user code；它永远看到与实际执行完全一致的 args。
- `observeToolOutcome` 是 core finalization phase，不是 `afterToolCall` 的别名；它覆盖 immediate/executed outcome，对 executed outcome 总在 extension result rewrite 与 normalization 之后运行。
- 这些阶段与 AgentHarness v2 的 planned/effect_pending/completed 分层一致；不是新工具运行时。

### 5.2 并行 batch 的原子性

并行模式继续 source-order prepare、并发 execute、source-order finalize，但每个 Promise closure 必须在调用 `tool.execute()` 的同一同步栈中先执行 `admitEffect()`：

```ts
const admission = admitEffect(effect, snapshot);
if (admission.kind !== "admitted") return blockedOutcome(admission);
emitExternalEffectStart(admission.effect); // 无用户代码、无 await
return tool.execute(...);
```

如果第二个 call 在 prepare/`beforeToolEffect` 阶段 latch pause，`Promise.all` 开始后第一个已 prepared sibling 也会在 admission 被拒绝，因此不会执行。如果 pause 在某个 admission 本身产生，之后的 sibling 全部看到相同 latch。已经获得 `admitted` 且发出 `external_effect_start` 的 sibling 才属于 in-flight，允许按现有 abort/replay 语义 settle。

Batch 按 source order 生成全部 blocked/executed tool results 后，loop 若看到 pause latch，必须直接返回 `{kind:"paused"}`，且发生在 queue drain、`shouldStopAfterTurn` 和下一 provider request 之前。该 typed exit 优先于 `shouldTerminateToolBatch()`；普通 `terminate` 聚合语义保持不变。

现有 `tool_execution_start` 保持向后兼容，正式定义为“model tool-call lifecycle / preparation start”，不是外部 effect 已启动的证据；invalid、blocked call 也有 start/end 对。新增 `external_effect_start` 才表示网络或工具副作用即将开始，pause 不变量和 telemetry 均以它为准。

### 5.3 统一 observation

```ts
type ToolObservationKind =
  | "executed"
  | "unknown_tool"
  | "invalid_arguments"
  | "invalid_arguments_after_extension"
  | "extension_block"
  | "extension_hook_failure"
  | "guard_replan_block"
  | "guard_pause_block"
  | "sibling_not_admitted"
  | "cancelled";

type ToolErrorClass =
  | "none"
  | "tool_execution_error"
  | "unknown_tool"
  | "invalid_arguments"
  | "invalid_arguments_after_extension"
  | "extension_hook_failure"
  | "provider_error"
  | "policy_block"
  | "guard_block"
  | "cancelled";

type ToolOutcomeObservation = {
  observationSequence: number;
  effectId?: string;
  toolCallId: string;
  toolName: string;
  kind: ToolObservationKind;
  errorClass: ToolErrorClass;
  callFingerprint?: string;
  resultFingerprint?: string;
  isErrorForModel: boolean;
  progress: "progress" | "no_progress" | "unknown";
};
```

模型上下文中的 blocked result 仍可为 `isError:true`，但预算不再直接用该布尔值记账：

| outcome | toolCalls | toolErrors | repeat history | no-progress |
| --- | ---: | ---: | ---: | ---: |
| executed success | +1 | 0 | 是 | classifier |
| executed error | +1 | +1 | 是 | classifier |
| unknown/invalid args | +1 | +1 | 是，使用结构化 synthetic result | `no_progress` |
| extension hook failure | +1 | +1 | 是 | `no_progress` |
| extension policy block | +1 | 0 | 是，只包含稳定 policy class | `unknown` |
| guard replan/pause block | +1 | 0 | 否，避免 guard 自己制造重复 | 不计 |
| sibling not admitted / cancelled | +1 | 0 | 否 | 不计 |

`effectsAdmitted` 另行计数，只在 admission 成功时增加。ToolCalls 表示模型提出的调用量，effectsAdmitted 表示实际外部资源消耗。

## 6. 指纹、detector 与可重放语义

### 6.1 指纹

```text
callFingerprint = hash(toolName + canonicalJson(effectiveArgs))
resultFingerprint = hash(observationKind + errorClass + canonicalizedFinalResult)
observationFingerprint = hash(callFingerprint + resultFingerprint)
```

`canonicalJson` 固定为：对象 key 按 UTF-16 code unit 升序、数组保持顺序、有限数值使用 JSON 表示、`-0` 归一为 `0`、非有限数/循环/不可序列化值拒绝。默认不做路径大小写、斜杠、自然语言相似或模糊归一化。Hash 算法及 canonicalizer version 写入 snapshot 和 trace fixture。

原始参数/结果不进入共享 telemetry。受信 built-in adapter 可显式删除 volatile 字段或生成 semantic fingerprint；不得复用 `AgentTool.replay` 表达业务重复。

### 6.2 Observation 序列与窗口

- `observationSequence` 在 model tool call 的 source order 中分配；并行完成后也按 source order commit。
- Controller 维护 profile 指定的 `maxWindowObservations` FIFO。淘汰只影响 repeat/no-progress，累计 resource budgets 永不淘汰。
- `progress` 清空当前 epoch 的 no-progress/repeat streak；`unknown` 不清空也不增加 no-progress；`no_progress` 增加 no-progress streak。
- 新 strategy epoch 清空 FIFO、streak、cause escalation 和 warning dedupe；不清空累计 budget。

### 6.3 Exact repeat 与 cause signature

同一 `observationFingerprint` 连续 commit 且没有 progress，`exactRepeatStreak` 增加；不同 fingerprint 把该 streak 重新从 0 计算。准备下一次相同 `callFingerprint` 时，如果最近完成记录的相同 observation streak 已达到 replan limit，则在结果未知前阻断调用。

```text
causeSignature = hash(
  controllerSchemaVersion + reason + scope + detectorKey + strategyEpoch + limitRevision
)
```

- exact repeat 的 `detectorKey` 为最近 observation fingerprint；no-progress 为 classifier group；预算为 metric 名。
- 同一 causeSignature 第一次越过 replan threshold 进入 `replan_required`；新 provider turn 后再次命中同一 signature 升级 pause。
- warning dedupe key 为 `(causeSignature, level)`；limit revision 或 epoch 改变后可重新发出。

### 6.4 阈值比较

- Counter limit 表示允许的最大累计值。Admission 前对预计值检查：`nextValue > limit` 才阻断；settle 后 `value >= warn` 可发 warning。
- Elapsed/Token 在 dispatch 前若 `used >= pause` 则暂停；响应 settle 导致首次达到 hard limit 时先记录结果，再 latch，下一 effect admission 被拒绝。
- Repeat/no-progress 在 `streak >= replan` 时要求一次 replan；在 `streak >= pause` 时无条件 pause。即使尚未到 pause tier，已发 replan 后下一 provider turn再次命中相同 causeSignature 也升级 pause。
- Tiered limit 必须为正安全整数并满足 `warn < replan < pause`（不存在的 tier 跳过）；资源指标只允许 `warn < pause`。
- `observe` 与 `enforce` 使用同一状态转移和计数；observe 将 `replan/paused` 投影为 `would_replan/would_pause`，不设置 latch。

### 6.5 合理重复与 no-progress

```ts
type ToolConvergencePolicy =
  | { mode: "normal" }
  | { mode: "bounded_poll"; maxIdenticalResults: number; minIntervalMs?: number }
  | { mode: "user_confirmed_retry" };
```

- 未注册 adapter 的第三方工具启用 exact repeat/error/resource budgets；其 progress 默认为 `unknown`，不因语义 no-progress 硬暂停。
- Built-in search/read 可在新非空 result hash 时报告 progress；edit/write 以 file/diff digest 变化报告；test/bash 以结构化退出状态或结果摘要变化报告。
- `bounded_poll` 仅在声明次数/节奏内放宽 exact repeat，仍累计时间、Token、toolCalls 和 effectsAdmitted。状态变化报告 progress。
- 普通 prompt 文本不能关闭 guard；只有 resolution 的 `allow_once` 可产生一次 permit。

## 7. 预算、usage 与配置更新

```ts
type ConvergenceMetric =
  | "toolCalls"
  | "toolErrors"
  | "activeElapsedMs"
  | "uncachedTokens"
  | "noProgressObservations"
  | "exactRepeats";

type TieredLimit = { warn?: number; replan?: number; pause: number };
type ConvergenceLimits = Partial<Record<ConvergenceMetric, TieredLimit>>;
type ConvergenceLimitsPatch = Partial<Record<ConvergenceMetric, TieredLimit | null>>;
```

- `null` 恢复当前 profile 推导值；字段缺失保持不变。因此 `update_limits` 是 field-level patch，不是整对象替换。
- Patch 必须携带 `expectedLimitRevision`，以 CAS 方式一次校验、合并、验证和递增 revision；冲突不产生部分修改。
- 当前 spec 固定语义和配置形状，不凭单一事故拍定默认数值。下一阶段必须用版本化 eval 校准 profile；产品完成态必须有默认 enforce profile。
- 支持 `off | observe | enforce`。Local `off` 不关闭现有 provider timeout、retry cap 或用户 abort；v1 不宣称 managed parent ceiling。

### 7.1 Usage 去重与 Token

- 使用现有 `Usage`；v2 只从 append-only usage ledger 读，不建第二 token contract。
- 每条 settled usage 分配确定性的 `usageEntryId = effectId + usageKind`。Controller 维护已消费 ID 集合；同一 ID 重放不重复累计。
- v1 provider、tool、retry、fallback 和 auto-compaction adapter 都必须生成 usageEntryId；v2 由 ledger unique entry id 保证幂等。
- 主预算为 `uncachedTokens = input + output + cacheWrite`，`cacheRead` 单独观测。Provider adapter 先归一化字段。
- Usage 缺失记录 `usageKnown:false` 和缺失 source；Token detector 不估算，其他 detector 继续生效。
- Cost 只观测，不做第一版 hard limit。

### 7.2 默认作用域

Resource budget 按 task run 累计；strategy epoch 只影响停滞窗口。Retry、fallback、model switch、自动 compaction 均共享 task budget。Parent/child/lane budget 等待 AgentHarness v2 的 durable operation config/provider 与 usage ledger，不在 v1 的 `CreateAgentSessionOptions`、`AgentSessionConfig` 或 `SettingsManager` 增加半套注入协议。

## 8. Provider、retry 与 compaction 集成

`packages/coding-agent/src/core/provider-effect-adapter.ts` 新增 session-scoped `ProviderEffectAdapter`，作为所有 provider 类 effect 的唯一编排边界。它负责 source-ordered `EffectRef`、恰好一次 admission、`external_effect_start/end` 和 `usageEntryId` settlement；它委托现有 `ModelRuntime`，不复制 provider 选择、retry、fallback、extension 或 usage 类型。

```text
transform/convert context
  -> Harness beforeRequest / admitEffect
  -> external_effect_start
  -> streamFunction
  -> provider payload/header extension
  -> network dispatch
```

- Initial provider、same-model retry、fallback 后 continue、manual/auto compaction、compaction summary、branch summarization 和 deferred fetch 都创建 EffectRef 并走同一 admission。
- Adapter 明确覆盖 `ModelRuntime.stream`、`streamSimple` 和 `fetchDeferred` 的真实调用点；`complete` / `completeSimple` 继续从对应 stream 派生，禁止在派生层重复 admission。
- Agent loop path 由 adapter 提供 `beforeRequest`，并把已 admission 的 raw stream delegate 交给现有 loop；compaction、summary、branch summary 和 deferred fetch 则由 adapter 自身执行相同 gate。每个 `EffectRef` 恰好调用一次 `admitEffect()`，不得既在 adapter wrapper 又在 core hook 二次 gate。
- `shouldStopAfterTurn` 保留为快速边界；不能替代 initial/resume/retry 的 request gate。
- `_handlePostAgentRun()` 在安排 retry/failover/compaction 前查询 pause/cancel；真正 dispatch 时仍再次 admission，避免 TOCTOU。
- Retry backoff 计入 active time；sleep 结束后重新 admission。Pause 不作为 provider error，不触发 retry。
- User abort 优先，返回 cancelled；不得生成 pause 或 resolution。

## 9. Pause 生命周期、AgentSession 与重启范围

### 9.1 同进程 lifecycle

当 admission 返回 pause：

1. Controller 原子设置 latch 并冻结 snapshot；未 admission effect 形成结构化 blocked outcome。
2. Coding-agent adapter 同步尝试 `appendCustomEntry("harness.convergence.pause.v1", data)`；内部写入结果保留 audit entry id，产品事件只记 `auditStatus="persisted" | "failed"`。
3. Adapter 再发布唯一的 `convergence_pause` 产品事件并携带 audit status。审计失败不得清除 latch、继续 dispatch 或降级为普通 warning。
4. 已 in-flight effect settle；latch 后不得新增 `external_effect_start`。
5. Agent loop 返回 `{kind:"paused", pauseId}`，不追加空 assistant error。
6. Core `agent_end`、AgentSession `agent_end` 和 extension 转发都使用第 10 节的加法式 outcome 字段；paused 时 `willRetry=false`。
7. Agent `isStreaming=false`；AgentSession `_isAgentRunActive=false`，最后发 `agent_settled(outcome="paused", pauseId)`。
8. `AgentSession.isIdle === true` 表示没有活动 effect；新增 `isPaused === true` 和 `convergenceState` 表示新 prompt/continue 必须先 resolution。

Latch 刚设置且仍有 in-flight effect 时，session `convergenceState.status="pausing"`，此时 `isStreaming` 可暂时为 true；`agent_settled` 后变为 `paused` 且 `isStreaming=false`。Pause 不是长期保持 streaming 的特殊状态。UI 在 `pausing` 展示“正在安全停止”，在 `paused` 清除 spinner 并展示 actions。

`isPaused` 在 `pausing | paused | historical_pause` 时为 true。除 `resolve_convergence`、只读查询和现有 abort/terminate 外，普通 prompt、steer、follow-up 与 `agent.continue()` 返回 typed `convergence_resolution_required`，不得隐式创建新 task 绕过 pause。

### 9.2 同进程恢复

AgentSession 内存保存完整 `ConvergenceTaskSnapshot` 和 continuation descriptor：

```ts
type ContinuationDescriptor =
  | { kind: "agent_continue" }
  | { kind: "agent_prompt"; message: AgentMessage }
  | { kind: "retry"; attempt: number }
  | { kind: "compaction"; reason: "threshold" | "overflow" };
```

- `allow_once` 或 `update_limits(..., continue:true)` 通过内部 resume path 恢复同一 `taskRunId`，不能调用会新建 task 的普通 public prompt path。
- `replan` 通过现有消息队列追加用户消息，但由 resume path 保持 task id 并增加 strategy epoch。
- Resolution 先验证 stale/CAS/limits，再通过 typed audit helper 追加 `harness.convergence.resolution.v1`。只有审计写入成功后，才原子清除 latch/安装 permit并启动新的 Agent invocation；写入失败返回 `audit_write_failed`，维持原 pause。启动失败保留已记录 resolution 和可解释 failure，不重复消费 permit。
- `terminate` 结束 task，保留会话与审计。

### 9.3 v1 重启边界

v1 **不支持进程重启后精确恢复同一 paused task run**。当前 AgentSession 没有 durable operation program counter；只保存 controller snapshot 而没有 request/tool intent 仍会形成不完整的第二状态机。

Coding-agent 增加 typed `ConvergenceAuditWriter`，内部只调用 `SessionManager.appendCustomEntry(customType, data)`；禁止调用会参与 LLM context 的 `appendCustomMessageEntry()`。这些 entry 可推进 session leaf，但 context reconstruction 不把 `type="custom"` 作为模型消息。Writer 只追加：

- `harness.convergence.pause.v1`：pause id、task id、reason、计数、limit revision、evidence hash/entry id、recoverability=`same_process`；
- `harness.convergence.resolution.v1`：resolution id、pause id、action、执行者、结果；
- 可选 `harness.convergence.restart.v1`：检测到未 resolution 的历史 pause。

重启后 unresolved entry 投影为 `historical_pause`，`recoverability="new_task_only"`。只允许 `replan_new_task`（把历史证据链接到新 task）或 `terminate`，不提供 `allow_once`、原 task continue 或“调整后继续”。精确 crash/reopen/resume 只在 AgentHarness v2 durable operation 落地后启用。

Pause audit 写失败时，process-local latch 仍保持关闭；任何会恢复 dispatch 的 resolution 都必须先补写 pause audit，再写 resolution audit。若存储持续不可用，现有 user abort 仍是安全逃生路径，但不得伪造已持久化记录。事件与 RPC 必须暴露 typed audit failure，不能把它转成 assistant error。

## 10. 对外类型与错误契约

### 10.1 Snapshot 与事件

```ts
type AgentSessionConvergenceState =
  | { status: "none" }
  | { status: "pausing" | "paused"; pauseId: string; taskRunId: string; recoverability: "same_process" }
  | { status: "historical_pause"; pauseId: string; taskRunId: string; recoverability: "new_task_only" };

type ConvergenceTaskSnapshot = {
  schemaVersion: 1;
  controllerVersion: string;
  canonicalizerVersion: string;
  taskRunId: string;
  mode: "off" | "observe" | "enforce";
  profileRevision: number;
  strategyEpoch: number;
  observationSequence: number;
  limitRevision: number;
  state: "active" | "replan_required" | "paused";
  limits: ConvergenceLimits;
  counters: Record<ConvergenceMetric | "effectsAdmitted", number>;
  usageKnown: boolean;
  accumulatedActiveMs: number;
  observations: ToolOutcomeObservation[]; // 已按 maxWindowObservations 淘汰
  noProgressStreak: number;
  exactRepeatStreak: number;
  escalatedCauseSignatures: string[];
  warningDedupeKeys: string[];
  consumedUsageEntryIds: string[];
  permit?: {
    permitId: string;
    pauseId: string;
    causeSignature: string;
    effectKind: EffectKind;
    consumed: boolean;
  };
};

type ConvergencePauseSnapshot = ConvergenceTaskSnapshot & {
  state: "paused";
  pauseId: string;
  reason: ConvergenceReason;
  causeSignature: string;
  inFlightEffectIds: string[];
  blockedEffectIds: string[];
};

type ConvergenceReason =
  | "exact_repeat"
  | "no_progress"
  | "tool_error_budget"
  | "tool_call_budget"
  | "active_time_budget"
  | "token_budget";

type ConvergenceResolutionKind =
  | "replan"
  | "allow_once"
  | "update_limits"
  | "terminate"
  | "replan_new_task";

type ConvergenceEvent = {
  type:
    | "convergence_warning"
    | "convergence_would_replan"
    | "convergence_would_pause"
    | "convergence_replan"
    | "convergence_pause";
  eventId: string;
  pauseId?: string;
  taskRunId: string;
  strategyEpoch: number;
  reason: ConvergenceReason;
  contributingReasons: ConvergenceReason[];
  causeSignature: string;
  boundary: "before_request" | "before_tool" | "admit_effect" | "after_tool" | "after_turn" | "before_continuation";
  observationSequence: number;
  limitRevision: number;
  auditStatus?: "persisted" | "failed" | "not_configured";
  observed: Partial<Record<ConvergenceMetric, number | null>>;
  limits: ConvergenceLimits;
  evidence: Array<{ toolName?: string; callHash?: string; resultHash?: string; entryId?: string; errorClass?: ToolErrorClass }>;
  inFlightEffectIds: string[];
  blockedEffectIds: string[];
  recoveryActions: ConvergenceResolutionKind[];
};

type AgentRunOutcomeKind = "completed" | "paused" | "aborted" | "failed";

// packages/agent: existing AgentEvent member, additive optional fields only
type CoreAgentEndEvent = {
  type: "agent_end";
  messages: AgentMessage[];
  outcome?: AgentRunOutcomeKind;
  pauseId?: string;
};

// packages/coding-agent and extension forwarding use the same field names
type AgentSessionEndEvent = CoreAgentEndEvent & { willRetry: boolean };
type AgentSettledEvent = {
  type: "agent_settled";
  outcome?: AgentRunOutcomeKind;
  pauseId?: string;
};
```

`ConvergenceTaskSnapshot` 是 controller 的完整、版本化重放输入；数组按 observation sequence 排序，序列化时对象 key 使用 canonicalJson 顺序。`ContinuationDescriptor` 属于 AgentSession runtime，不混入 controller snapshot。事件不含 prompt、参数、结果正文或绝对路径。Hash 和 entry id 默认也不出本地 session/RPC 边界。

Outcome 契约由 core `AgentEvent` 定义字段名，AgentSession、JSON/RPC、extension 和 PiDeck 只原样投影，不各自发明形状。新 producer 总是填 `outcome`；旧 producer 缺省时，兼容适配器按既有 abort/error lifecycle 推导，否则视为 `completed`。旧 consumer 可忽略新增字段。`paused` 必须携带 `pauseId`、在 AgentSession 层固定 `willRetry=false`，且不能生成 assistant error；extension `agent_end` / `agent_settled` 转发必须保留这两个字段。

### 10.2 Resolution command/response

```ts
type ResolveConvergenceCommand = {
  type: "resolve_convergence";
  resolutionId: string;
  pauseId: string;
  expectedLimitRevision: number;
  action:
    | { type: "replan"; message: string }
    | { type: "allow_once" }
    | { type: "update_limits"; patch: ConvergenceLimitsPatch; continue: boolean }
    | { type: "terminate" }
    | { type: "replan_new_task"; message: string };
};

type ResolveConvergenceResult =
  | {
      ok: true;
      resolutionId: string;
      pauseId: string;
      state: "active" | "settled";
      taskRunId: string;
      limitRevision: number;
      resumed: boolean;
    }
  | {
      ok: false;
      code:
        | "pause_not_found"
        | "pause_already_resolved"
        | "pause_not_recoverable"
        | "limit_revision_conflict"
        | "invalid_limit_patch"
        | "audit_write_failed"
        | "hard_budget_still_exceeded";
      pauseId: string;
      currentLimitRevision?: number;
      message: string;
    };
```

- 同一 `resolutionId` 重放返回原结果；同一 pause 使用不同 resolutionId 再处理，返回 `pause_already_resolved`。
- `allow_once` 只生成一个绑定 `(pauseId, causeSignature, effect kind)` 的 permit，在 admission 时消费，不因 effect 失败返还。
- `update_limits` 是 CAS patch；低于当前 usage 或 tier 顺序非法时全部拒绝。
- Model switch 继续使用现有 `set_model`，本身不 resolution；随后再 replan/allow/update。
- `AgentSessionEvent` 和 `get_state` 加法式增加 `convergenceState`。旧 RPC 客户端可忽略未知事件。

## 11. Settings 契约

```ts
type ConvergenceSettings = {
  mode?: "off" | "observe" | "enforce";
  profile?: "conservative" | "balanced" | "strict";
  limits?: ConvergenceLimitsPatch;
  maxWindowObservations?: number;
  toolPolicies?: Record<string, ToolConvergencePolicy>;
};
```

- Profile 展开结果、canonicalizer/controller version 与 limits 一起进入 task snapshot。
- Profile 变更需要 changelog、eval 对比和 revision；运行中变更通过有序 config event 应用。
- Project setting 可收紧 global；是否可放宽由现有 trust/managed policy 决定。
- Tool policy 只允许已注册工具名和受限 schema；复杂 classifier 作为受信代码 adapter，不从配置执行任意代码。
- Observe/enforce 共用 detector；off 仍服从现有 timeout/retry/abort。Parent ceiling 延后到 v2，不能靠 v1 setting 注入。

## 12. Telemetry schema、隐私与 analytics opt-in

`HARNESS_TELEMETRY_SCHEMA.version` 从 1 升到 2，新增短生命周期 span `pi.harness.convergence`。每个 warning、would_replan、would_pause、replan、pause 和 resolution 各创建一个 span，不让 span 跨越用户暂停时间。

允许的属性固定为：

| 属性 | 类型/基数 | 说明 |
| --- | --- | --- |
| `pi.convergence.action` | string, low | `decision | resolution` |
| `pi.convergence.decision` | string, low | `warning | would_replan | would_pause | replan | pause | resume | terminate` |
| `pi.convergence.reason` | string, low | `ConvergenceReason` 枚举 |
| `pi.convergence.boundary` | string, low | boundary 枚举 |
| `pi.convergence.metric` | string, low | `ConvergenceMetric` 或 `none` |
| `pi.convergence.mode` | string, low | `observe | enforce` |
| `pi.convergence.recovery_action` | string, low | resolution kind；decision 时缺省 |
| `pi.convergence.usage_known` | boolean | Token usage 是否完整 |
| `pi.convergence.strategy_epoch` | number | epoch |
| `pi.convergence.observation_sequence` | number | commit sequence |
| `pi.convergence.profile_revision` | number | profile revision |
| `pi.convergence.limit_revision` | number | effective limit revision |
| `pi.convergence.observed` | number | 主 metric 当前值 |
| `pi.convergence.limit` | number | 主 metric limit |
| `pi.convergence.in_flight_count` | number | pause 时 in-flight 数 |
| `pi.convergence.blocked_count` | number | gate 阻断数 |

`taskRunId`、pause/event/effect/resolution id、cause signature、hash、entry id、tool name、provider/model、prompt、路径和正文不得进入该 span。Provider/model 继续由已有 `pi.ai.request` span 管理，避免重复高基数维度。

本地 `AgentSessionEvent` 和 custom entry 属于产品功能，在 analytics 关闭时仍工作。远程/共享 telemetry 只有在现有 `Settings.enableAnalytics === true` 且已配置 exporter 时才创建/导出；本功能不得绕过 opt-in。完整 evidence 只保存在用户本地 session，且 RPC 只按现有本地信任边界提供。

## 13. 验收、持续 eval 与发布门禁

### 13.1 核心不变量

1. Pause latch 设置后，在匹配 resolution 前，不再出现新的 `external_effect_start`。
2. 并行 batch 中已 prepare 但未 admit 的 sibling 不执行；仅 admission 成功的 effect 可 settle。
3. `tool_execution_start/end` 对所有 planned call 配对；`external_effect_start` 只对应真实 effect。
4. Pause 不创建 assistant error、不进入 retry；user abort 不创建 pause。
5. Pause 后 Agent/AgentSession 均非 streaming、已 idle/settled，同时 `isPaused=true`。
6. Extension 改参后二次 validation；controller 指纹与实际执行 args 一致。
7. Immediate、executed、blocked、cancelled outcome 全部产生一次 source-ordered observation；guard block 不计 toolErrors。
8. Usage entry 重放不重复累计，missing usage 不禁用其他 detector。
9. Retry、fallback、compaction、model switch 不清空 task budget。
10. v1 重启后不提供伪精确恢复；v2 crash/reopen/resume 使用 durable operation conformance。
11. 现有四个低层 loop API 返回类型保持不变；typed pause 只通过新增 outcome API 和加法式事件字段暴露。
12. Pause audit 使用 `appendCustomEntry()` 且不进入 LLM context；审计失败保持 latch，resolution audit 成功前不恢复 dispatch。

### 13.2 分层测试

- `packages/agent`：fake clock、fixed hash、FIFO 淘汰、cause signature、threshold equality、CAS limits、usage dedupe、admission 原子性、typed loop outcome 与旧低层 API 兼容。
- Agent loop：sequential/parallel、已 prepared sibling、extension block/throw/mutation、二次校验、immediate outcome、terminate、abort、provider gate。
- `packages/coding-agent`：pause 事件顺序、isStreaming/isIdle/isPaused、retry/failover/compaction、same-process resolution、historical pause、RPC idempotency。
- PiDeck/TUI：状态展示、重连、unknown event 兼容和全部 resolution response；不复制 detector。
- AgentHarness v2：suspended convergence、usage ledger、effect intent、crash/reopen/resume 和 parent budget conformance。

### 13.3 Eval 与发布

- 将 2026-08-28 事故做成脱敏、版本化 trace：同一失败搜索 23 次、错误扩张、LSP 通过后继续扩张和用户中断均可重放。
- 正样本：exact repeat、空结果循环、错误/时间/Token 超支、验证已足够后的扩张。
- 反样本：bounded polling、分页、测试重跑、渐进搜索、长命令、并行读取、compaction 和 provider fallback。
- Model、prompt、tool schema、classifier、profile、canonicalizer 或 controller 变化均运行同一 eval。
- 发布顺序：shadow/observe → 标注误报 → enforce canary → 默认 enforce。门禁包含事故样本及时停止、反样本误暂停率达标、pause 后零 effect start、resolution 全通过。

## 14. 已决问题与剩余风险

已决：

1. 三层保护为 warning/replan/pause；hard resource budget 直接 pause。
2. Tool 与 provider 都在 effect 真正开始前执行原子 admission；不依赖 prepare 或异常。
3. Extension mutation 后强制二次 schema validation；统一 observer 覆盖 immediate outcome。
4. V1 pause 让 invocation idle/settled，并只支持同进程精确恢复；重启后只能关联证据创建新 task。Durable resume 等待 AgentHarness v2。
5. Guard block 不计 toolErrors/repeat/no-progress，但计 model toolCalls；实际 effect 另计 effectsAdmitted。
6. Detector 的 FIFO、streak、cause signature、比较、limit patch、usage dedupe 和 monotonic clock已固定。
7. Telemetry 使用 schema v2、低基数枚举/数值和现有 analytics opt-in。
8. V1 不实现 parent budget；该能力依赖 v2 durable runtime 提供受管 snapshot/provider 和安全更新事件。

剩余风险：

- no-progress classifier 仍是最高误报来源。未知第三方工具保持保守；built-in adapter 必须逐个用正反 trace 验证。
- 具体 profile 数值仍需下一阶段以 eval 校准，但不能改变本 spec 的比较和状态转移语义。
- 新增 `external_effect_start` 与 typed loop exit 会触及 Agent core 生命周期；implementation plan 必须先落 contract/compatibility tests，再接 detector。
- V1 重启后不能原 task resume 是明确能力边界。若产品要求首版即 durable resume，应改变依赖顺序、先实现 AgentHarness v2 operation runtime，而不是扩张 AgentSession custom entry。
- V1 没有 parent budget runtime 注入入口。若该 ceiling 成为首版硬需求，必须先定义 `CreateAgentSessionOptions`/operation provider、更新事件和持久化语义，再单独修订 spec/plan，不能只在 controller 增加一个不可触达字段。
