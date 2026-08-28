# Spec: Agent Harness 运行收敛与资源止损

- Author: 浙水智能体用户 / Codex
- Captured: 2026-08-28
- Status: draft-for-review
- Source intent: [`intent.md`](./intent.md)
- SDLC stage: Requirements & Design / `spec.md`

## 1. 设计结论

本功能不新增第二套 Agent loop、retry、usage、session 或 RPC 通道。它在现有 pi 生态上增加一个确定性的 `ConvergenceController`（收敛策略控制器），并由现有运行边界调用：

1. `packages/agent` 提供无 UI、无存储依赖的策略状态机、预算类型、规范化观测和决策类型。
2. 当前 `packages/coding-agent` 的 `AgentSession` 负责把控制器组合进已有 `beforeToolCall`、`afterToolCall`、`shouldStopAfterTurn`、provider stream、retry、compaction、settings 和 session event 流程。
3. PiDeck、TUI 和 RPC 只展示结构化事件并提交恢复动作，不自行计算重复、错误或预算。
4. `AgentHarness v2` 完成后，同一个策略控制器接入其 `before_tool`、request dispatch gate、append-only usage ledger、durable operation state、`run_suspend` 和 `TelemetryContext`；不得把当前适配层演化成另一套持久化 Harness。

保护机制是 Harness 所有的确定性策略，不实现为普通 extension。Extension 仍可按现有规则修改或阻断工具，但 extension 的卸载、重载或异常不能绕过资源止损。

## 2. 复用现有生态

| 现有能力 | 本功能如何复用 | 明确不做什么 |
| --- | --- | --- |
| `Agent.beforeToolCall` / `afterToolCall` | 在有效参数确定后做工具前检查，在 extension 改写后的最终结果上记账 | 不包装每个工具形成第二条执行链 |
| `Agent.shouldStopAfterTurn` | 在 turn 安全边界阻止下一次 provider 请求 | 不用 prompt 要求模型自行停止 |
| `AgentToolResult.terminate` | 保留已有“整个 batch 均 terminate 才提前结束”的兼容语义 | 不把 `terminate` 偷换成 durable pause |
| `AgentSession` | 作为当前 TUI、print、RPC 的唯一编排和恢复入口 | 不在各模式分别实现 guard |
| extension `tool_call` / `tool_result` | 先完成 extension 的原地改参与结果改写，再计算最终指纹 | 不改变 extension 的先后顺序和错误隔离语义 |
| `SettingsManager` | 增加可选 `convergence` 配置并沿用现有 global/project 合并与校验方式 | 不新增独立配置文件或环境变量体系 |
| auto retry / model failover / compaction | 继续使用现有实现；控制器只决定能否开始下一外部 effect，并统一累计预算 | 不再实现 backoff、provider error 分类或 compaction |
| SessionManager JSONL custom entry | 当前适配期追加 pause/resolution 审计记录，旧会话无需迁移 | 不新增平行数据库或修改既有 message entry |
| AgentHarness v2 usage ledger / operation state | 长期作为 Token 记账、暂停、恢复和 crash replay 的权威状态 | 不在当前 scaffold 外再建 durable state machine |
| AgentHarness `TelemetryContext` / schema | 扩展现有 schema 记录低敏计数、原因和决策 | 不上传工具参数、结果正文、文件路径或 prompt |
| stdio JSON-RPC / `AgentSessionEvent` | 以可选事件、状态字段和一个恢复命令做向后兼容扩展 | 不增加 PiDeck 专用 side channel |

## 3. 范围和术语

### 3.1 任务与预算作用域

- **Task run**：用户在 idle 状态提交的一次 prompt 开始，到 agent settled、用户终止或收敛暂停为止。内部 provider retry、model failover、自动 compaction 和 `agent.continue()` 均属于同一 task run。
- **Strategy epoch**：task run 内的一段策略尝试。明确的重新规划、受信恢复动作或新的 steering 指令可开始新 epoch；它只重置重复/无进展窗口，不清零时间、Token、工具调用和错误累计。
- **Session**：用于展示累计统计和承载上层限额，不作为默认重复指纹窗口。新 task run 不继承前一任务的重复 streak。
- **Parent budget**：未来子 Agent 或并行 lane 从父运行获得的共享上限。子预算可以更严，不能超过父级剩余额度。

暂停期间不累计 active elapsed time。恢复后继续同一 task run 的累计预算，除非用户终止并提交一个全新任务。

### 3.2 外部 effect

以下操作受“暂停后不得新增 effect”约束：

- provider request，包括自动重试、fallback 后继续和自动总结请求；
- 工具 execute，包括并行 batch 中尚未开始的调用；
- Harness 管理的轮询或 deferred fetch。

已经进入执行态的 provider 请求或工具属于 in-flight effect。触发暂停时不伪装成未执行，也不丢弃其结果；它们按现有 abort/replay 语义 settle。暂停事件必须区分 `inFlightEffectIds` 与 `blockedEffectIds`。

## 4. 状态与决策模型

```text
active
  ├─ soft threshold ───────────────> active + warning event
  ├─ recoverable stagnation ───────> replan_required
  │                                   ├─ changed strategy/progress ─> active
  │                                   └─ same cause again ─────────> paused
  ├─ hard budget / unsafe repeat ──> paused
  └─ normal completion/abort ──────> settled

paused
  ├─ replan / allow_once / raise_limit ─> active
  └─ terminate ────────────────────────> settled
```

### 4.1 三个保护级别

1. `warning`：只发事件和遥测，不改变执行；每个 `(taskRunId, reason, threshold)` 只发一次。
2. `replan_required`：只用于重复调用和无进展等可恢复问题。触发工具不执行，而是生成结构化的 guard tool result，允许模型再进行一个 provider turn 改变策略。相同原因在同一 epoch 再次发生时升级为 `paused`。
3. `paused`：在外部 effect gate 原子地关闭新的 dispatch，发出 pause 事件并等待显式 resolution。错误、时间、Token 或调用数的 hard limit 直接进入此状态，不自动追加一次模型调用。

普通 `AgentToolResult.terminate` 继续保持当前 batch 兼容语义。`paused` 使用独立的 typed decision 和 dispatch gate，不能只依赖 `terminate: true`，否则混合并行 batch 无法保证所有未开始 effect 都被挡住。

### 4.2 决策优先级

同一边界同时出现多个信号时，按以下顺序处理：

1. 用户 abort / operation cancellation；
2. 已存在的 pause latch；
3. parent hard limit；
4. local hard limit；
5. repeat/no-progress replan 或升级；
6. warning；
7. allow。

一次只产生一个主原因，其他命中项放入 `contributingReasons`。相同输入状态必须产生相同决策，时钟和 usage 通过显式 snapshot 传入，测试不得依赖真实时间。

## 5. 观测与判定

### 5.1 工具调用指纹

指纹在工具参数完成 `prepareArguments`、schema validation 和 extension `tool_call` 原地修改后计算：

```text
callFingerprint = hash(toolName + canonicalJson(effectiveArgs))
```

`canonicalJson` 只做确定性处理：对象 key 排序、JSON 标量标准化和循环/不可序列化值拒绝。默认不做模糊路径、大小写或自然语言相似匹配，以避免误判。原始参数不得进入共享遥测；事件只携带 hash、tool name 和本地 session entry id。

工具可以通过受信的 classifier adapter 定义语义指纹或忽略明确的 volatile 字段。不得复用 `AgentTool.replay` 表达重复策略，因为 crash replay safety 与业务轮询是两个独立概念。

### 5.2 工具结果指纹与错误分类

结果在 extension `tool_result` 改写和图片规范化之后观察：

```text
resultFingerprint = hash(isError + canonicalizedContent + canonicalizedDetails)
observationFingerprint = hash(callFingerprint + resultFingerprint)
```

- `isError: true` 是工具错误预算的权威默认信号。
- schema validation、unknown tool、extension block 和 guard block 分别使用独立 error class；guard 自己生成的 block 不回算为工具错误。
- provider error 不进入工具错误预算，继续由现有 retry/failover 处理，但其等待时间和已产生 usage 仍进入 task budget。
- 文本正则只允许作为 built-in tool adapter 的降级分类器，并必须有测试；通用层不根据某个模型或某段英文报错写特判。

### 5.3 重复调用

默认 detector 记录最近有界窗口内的 `observationFingerprint`：

- 同一调用得到同一结果，且中间没有 progress evidence，构成一次 exact repeat。
- 只重复调用但结果发生变化，不命中 exact repeat；仍受工具调用数、时间和 no-progress 预算约束。
- 第一次达到 replan threshold 时阻断该调用并要求重新规划；同一 cause signature 在当前 epoch 再次出现则暂停。
- 阈值来自配置 profile，不硬编码在模型 prompt、工具实现或 PiDeck。

### 5.4 无进展

通用层只判断“可观察停滞”，不声称理解任务是否完成。每个工具结果由 classifier 输出：

```ts
type ProgressSignal = "progress" | "no_progress" | "unknown";
```

判定规则：

- 新的非错误结果默认为 `unknown`，不会仅因“调用了不同工具”就重置窗口。
- 重复空结果、重复相同错误、成功但无状态变化的 no-op 为 `no_progress`。
- built-in search/read 在得到新的非空结果 hash 时可标记 `progress`；edit/write 在文件或 diff digest 变化时可标记 `progress`；test/bash 在退出状态或有意义的结果摘要变化时可标记 `progress`。
- 未注册 adapter 的第三方工具只启用 exact repeat 和 error/resource budgets，不启用语义 no-progress 硬暂停，以降低误报。
- 模型声称“我已重新规划”不构成 progress evidence。用户 resolution 可开启新 strategy epoch，但不清空硬预算。

### 5.5 合理重复与轮询

内建工具 adapter 可声明 `normal`、`bounded_poll` 或 `user_confirmed_retry` 策略：

- `bounded_poll` 在 cadence 和最大次数内不触发 exact-repeat replan，但仍累计 elapsed、Token 和 call budget；状态变化会产生 progress。
- 测试重跑、分页读取不按工具名全局豁免，而以有效参数、页游标、结果变化和显式 adapter 判断。
- 用户在 pause resolution 中选择 `allow_once`，只放行被阻断的同一 effect 一次；permit 在 dispatch 时消费，不因执行失败返还。
- 普通自然语言中的“再试一次”不自动绕过 hard limit，避免 prompt injection 关闭 Harness。

## 6. 预算模型

```ts
type ConvergenceLimits = {
  toolCalls?: TieredLimit;
  toolErrors?: TieredLimit;
  activeElapsedMs?: TieredLimit;
  uncachedTokens?: TieredLimit;
  noProgressObservations?: TieredLimit;
  exactRepeats?: TieredLimit;
};

type TieredLimit = {
  warn?: number;
  replan?: number;
  pause: number;
};
```

- `toolErrors`、`activeElapsedMs`、`uncachedTokens` 和 `toolCalls` 不使用 `replan`，到 hard limit 直接 pause；`replan` 字段仅对支持该级别的 detector 合法。
- 本 spec 固定语义和配置形状，不在文档中拍定未经 eval 校准的数值。默认 profile 必须在实现计划中以事故 trace、正常长任务、轮询和测试重跑 eval 得出，并作为版本化常量测试。
- 配置支持 `off | observe | enforce`。初次发布先 shadow/observe，再按遥测和人工标注启用 enforce；产品发布完成态必须有默认 enforce profile，不能长期停留在仅观测。
- 本地用户可关闭 local profile；受管环境可下发不可被子 session 提高的 parent ceiling。没有隐藏的永久硬编码上限。

### 6.1 Token 归一化

- 使用现有 `Usage` 和 AgentHarness append-only usage ledger，不新建 token contract。
- 主预算指标为 `uncachedTokens = input + output + cacheWrite`；`cacheRead` 单独记录，不作为默认硬限额。若 provider 提供的字段语义不同，由现有 provider adapter 先归一化。
- provider、工具、自动 retry、fallback 和自动 compaction 的 usage 都计入同一 task run；禁止因 model switch 清零。
- usage 缺失时记录 `usageKnown: false` 和缺失来源，Token detector 不作猜测；时间、调用数、错误和重复 detector 继续工作。
- 成本只做观测字段，不作为第一版 hard limit，因为定价会变化且并非所有 provider 可得。

### 6.2 时间

- `activeElapsedMs` 从 task run 接受时开始，包含 provider、工具、retry backoff、fallback 和自动 compaction 时间。
- paused 后停止计时，resolution 后继续；进程休眠或重启通过持久时间戳恢复时不得出现负数。
- 在安全边界检查 task 总时间。单个长工具或 provider 的强制超时继续使用各自已有 timeout/AbortSignal，不由此功能中途伪造可恢复 pause。

## 7. 运行时集成顺序

### 7.1 工具调用

```text
prepareArguments -> schema validation
  -> extension tool_call mutation/block
  -> ConvergenceController.beforeTool(effective args)
  -> batch dispatch gate
  -> tool execute
  -> extension tool_result rewrite
  -> image normalization
  -> ConvergenceController.observeToolResult(final result)
  -> existing tool/message events and persistence
```

并行 batch 仍按现有 source order prepare、并发 execute、source order finalize。新增的只是 Harness-owned dispatch gate：若 prepare 阶段触发 pause，所有尚未开始的 prepared effect 均转为结构化 blocked outcome，不启动工具。已经开始的 sibling effect 允许 settle，其 id 进入 pause snapshot。该行为需要专门回归测试，不能改变普通 extension block 与 `terminate` 的既有语义。

### 7.2 Provider、retry 与 compaction

- 每次 provider、retry、fallback、自动总结 dispatch 前调用同一个 `beforeRequest` gate。
- gate 必须在 provider payload extension 和网络请求之前；pause 不是 provider error，不进入 auto retry。
- `shouldStopAfterTurn` 作为正常 tool turn 后的快速安全边界保留，但不是唯一 gate。
- `_handlePostAgentRun()` 在准备 retry/failover/compaction continuation 前再次查询 controller；暂停时不得 `agent.continue()`。
- 用户 abort 优先，沿用现有 aborted outcome；不得把用户取消误报成 convergence pause。

### 7.3 当前适配与 AgentHarness v2

当前 `AgentHarness` 仍是未完成 scaffold，因此第一版不能要求先重写整个 v2 runtime。采用以下兼容路径：

- 策略与 decision 类型放在 `packages/agent`，可由当前 loop adapter 和未来 v2 driver 共同调用。
- 当前 `AgentSession` 保存 process-local controller，并用 SessionManager custom entries 记录 pause/resolution 审计。
- v2 落地时将 `paused` 映射为 durable suspended operation（新增结构化 convergence reason），计数来自 operation state 与 usage ledger，事件映射到既有 `run_suspend`；随后删除 current adapter 中重复的生命周期持久化代码。
- v2 telemetry 继续使用 `packages/agent/src/harness/telemetry.ts` 的 schema 和 `TelemetryContext`，不引入第二个 analytics SDK。

## 8. 对外契约

### 8.1 结构化事件

```ts
type ConvergenceReason =
  | "exact_repeat"
  | "no_progress"
  | "tool_error_budget"
  | "tool_call_budget"
  | "active_time_budget"
  | "token_budget"
  | "parent_budget";

type ConvergenceEvent = {
  type: "convergence_warning" | "convergence_replan" | "convergence_pause";
  eventId: string;
  taskRunId: string;
  strategyEpoch: number;
  reason: ConvergenceReason;
  contributingReasons: ConvergenceReason[];
  boundary: "before_request" | "before_tool" | "after_tool" | "after_turn" | "before_continuation";
  observed: Record<string, number | boolean | null>;
  limits: Record<string, number | null>;
  evidence: Array<{
    toolName?: string;
    callHash?: string;
    resultHash?: string;
    isError?: boolean;
    entryId?: string;
  }>;
  inFlightEffectIds: string[];
  blockedEffectIds: string[];
  recoveryActions: ConvergenceResolutionAction[];
};
```

事件不包含原始 prompt、工具参数、工具输出或绝对路径。TUI/PiDeck 如需展示上下文，通过已有本地 session entry id 定位已获授权的数据。

### 8.2 持久审计

当前 SessionManager 追加两类现有 custom entry：

- `harness.convergence.pause.v1`：保存 pause id、task run、计数 snapshot、limit revision、evidence ids/hashes 和待处理 effect ids；
- `harness.convergence.resolution.v1`：保存 pause id、action、参数摘要和执行者来源。

entries append-only，不原地修改旧记录。重启后 session 没有偷偷运行的 task；客户端可展示未解决 pause，并由用户显式开始恢复。未来 v2 以 durable operation state 为权威，custom entry 只保留面向时间线的审计投影。

### 8.3 恢复命令

RPC 增加一个幂等命令，TUI 和 PiDeck 复用同一 AgentSession API：

```ts
type ResolveConvergenceCommand = {
  type: "resolve_convergence";
  pauseId: string;
  action:
    | { type: "replan"; message: string }
    | { type: "allow_once" }
    | { type: "update_limits"; limits: Partial<ConvergenceLimits>; continue: boolean }
    | { type: "terminate" };
};
```

- `pauseId` 已处理时返回原 resolution；过期 id 返回 typed stale error，不重复继续。
- `replan` 开启新 strategy epoch，并通过现有 prompt/queue 路径加入用户消息；如果 hard resource budget 仍超限，必须先更新限额。
- `allow_once` 只给触发边界一个 permit，不清零计数。下一次相同命中会再次暂停。
- `update_limits` 不能高于 parent ceiling，也不能把 limit 设成低于当前 usage 后悄悄继续。
- `terminate` 关闭 task run，不删除上下文。
- 模型切换继续使用现有 `set_model`；切换本身不自动解除 pause，随后仍需 resolution。

`AgentSessionEvent`、RPC event union 和 `get_state` 只做可选、加法式扩展；旧客户端可忽略未知事件，新客户端不能依赖 PiDeck 本地推导状态。

## 9. 配置与版本治理

`SettingsManager.Settings` 增加可选字段：

```ts
type ConvergenceSettings = {
  mode?: "off" | "observe" | "enforce";
  profile?: "conservative" | "balanced" | "strict";
  limits?: Partial<ConvergenceLimits>;
  toolPolicies?: Record<string, ToolConvergencePolicy>;
};
```

- 缺省配置按版本化 profile 展开；profile 变更需要 changelog、eval 对比和 limit revision。
- project setting 可以收紧 global setting；能否放宽由现有 trust/managed policy 决定。
- tool policy 只接受已注册工具名和受限 schema，不执行配置中的任意代码。复杂 classifier 作为受信代码 adapter 注册。
- `off` 只关闭 local decision，不关闭现有 provider timeout、retry cap、用户 abort 或上层 parent ceiling。
- observe 与 enforce 使用同一 detector；observe 只替换最终 decision，避免两套算法漂移。

## 10. 遥测、隐私与可观测性

扩展既有 Harness telemetry schema，记录：

- detector reason、level、boundary、profile revision；
- 当前计数、limit、是否 usage 缺失、是否 parent limit；
- 从 warning 到 pause 的耗时、resolution action、是否再次触发；
- 每 task 工具调用数、错误数、exact repeat 数、非缓存 Token 和 active elapsed；
- 用户手动 abort 是否发生在 guard warning 之后，用于估算漏报；
- `allow_once` 后成功进展率和被用户标记的误报率。

TelemetryContext 只发送低基数枚举和数值。hash、entry id、tool name 是否发送由现有 telemetry privacy policy 决定，默认不发送 call/result hash。完整证据只留在用户本地 session。

## 11. 验收与持续 eval

### 11.1 不变量测试

1. `convergence_pause` 发出后，在匹配的 resolution 之前，不出现新的 provider request start 或 tool execution start。
2. 并行 batch 的未开始 effect 被阻断；已开始 effect 正常 settle，结果不丢失，UI 不残留 running tool。
3. provider retry、fallback、compaction、model switch 不清零 task resource budget。
4. 用户 abort 不产生 pause；pause 不进入 auto retry。
5. extension 修改后的有效参数和结果参与指纹；extension reload 不重置预算或绕过 gate。
6. usage 缺失只禁用 Token 判定，不影响其他 detector。
7. `allow_once` 恰好消费一次，重复或过期 resolution 幂等拒绝。
8. 旧 settings、旧 JSONL session 和不认识新事件的 RPC 客户端继续工作。

### 11.2 分层测试

- `packages/agent`：纯 controller 单元测试，使用 fake clock、fake usage 和固定 canonicalization；覆盖状态转移、优先级、窗口上限和 deterministic replay。
- agent loop：覆盖 sequential/parallel batch、extension block、invalid args、terminate、abort 与 pause gate 的组合。
- `packages/coding-agent`：覆盖 AgentSession task scope、retry/failover/compaction、steering/follow-up、settings 合并、custom entry 和 RPC round-trip。
- PiDeck/TUI：只验证事件展示、恢复命令、重连与未知事件兼容，不复制 detector 测试。
- AgentHarness v2：加入 suspended convergence 的 crash/reopen/resume conformance；usage 只从 ledger 读取。

### 11.3 Eval 数据集与发布门禁

- 把 2026-08-28 事故转换成脱敏、版本化 trace fixture：同一失败搜索重复 23 次、后续错误扩张以及用户中断均可重放。
- 正样本包括重复失败、空结果循环、测试已经通过后的无关扩张、错误预算和时间/Token 超支。
- 反样本包括有界 polling、分页、测试重跑、渐进式搜索、长时间命令、并行读取、自动 compaction 和 provider fallback。
- 每次模型、prompt、tool schema、classifier、profile 或 controller 改动均运行同一 eval。
- enforce 发布门禁至少包含：事故样本全部在目标边界前停止、反样本误暂停率低于约定阈值、pause 后零新增 effect、恢复路径全部成功。

## 12. 已决问题

1. 采用 `warning -> replan_required -> paused` 三层；hard resource budget 直接 pause。
2. 默认按 task run 累计，strategy epoch 只管理停滞窗口，session/parent 作为可选上层 ceiling。
3. 只有 classifier 提供的可观察 evidence 或受信 resolution 能重置 no-progress；模型自述不能。
4. 合理重复由 effective args/result 变化、built-in adapter 和 bounded polling policy 判断，不按工具名永久豁免。
5. 手动放行默认仅一次；提高限额必须是独立、可审计的 action。
6. Token hard budget 使用归一化 uncached tokens，cache read 与 cost 分开观测，缺失 usage 不估算。
7. retry、fallback 与 compaction 共享 task budget；未来子 Agent/lane 使用可收紧的子预算并受 parent ceiling 约束。
8. local guard 可关闭；managed parent ceiling 不能由子 session 关闭或提高。

## 13. Areas of concern

- 当前 `AgentHarness v2` 尚未完成，第一版需要一个明确可删除的 AgentSession adapter。实施计划必须标出未来迁移点，避免临时 custom entry 成为永久第二状态机。
- 当前 core 的 `terminate` 是 batch 聚合语义，无法单独表达 pause。实现必须增加 typed dispatch gate，并对并行 prepare/execute 边界做不变量测试，不能通过改变所有 `terminate` 行为取巧。
- no-progress classifier 是误报风险最高的部分。未知第三方工具第一版保持保守，只启用 exact repeat/error/resource budgets；built-in adapter 必须逐个用正反 trace 验证。
- 未知 usage 会使 Token hard limit 无法执行。UI 和 telemetry 必须明确显示“Token 用量不完整”，不能显示虚假的剩余额度。
- profile 的具体数值不能凭本次单一事故决定。它们是下一阶段 plan 中的 eval/calibration 工作项，但 spec 要求最终产品默认进入 enforce，而非只产生 warning。
- pause 后已有 in-flight effect 的处理必须沿用现有 abort/replay contract。是否主动取消单个长工具属于工具 timeout/取消策略，不混入本功能的 task budget pause。
