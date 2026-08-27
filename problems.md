## 结论

HydroZAgent 已经具备较强的产品化、扩展和审计基础，但作为 coding agent，其可靠性和验证闭环明显落后于当前 Codex、Claude Code 的成熟形态。

基于这批历史记录，我给出：

- 水利定制与本地化能力：8/10
- 扩展性与会话可审计性：8/10
- 代码理解与任务执行：6.5/10
- 工具调用可靠性：5/10
- UI 修改闭环：4/10
- 上下文与成本效率：3.5/10
- 综合工程成熟度：约 5.8/10

它已经是一个有潜力的内部产品原型，但还没有达到“用户可以放心交给它、自主完成并验证”的水平。

## 样本指标

分析范围为 2026-08-21 至 2026-08-27 的 10 个 session：

| 指标 | 结果 |
|---|---:|
| 用户输入 | 92 |
| Assistant 消息 | 622 |
| 工具调用 | 621 |
| 工具结果 | 616 |
| 工具失败 | 45，约 7.3% |
| 正常结束的用户回合 | 58/92，约 63% |
| error/aborted 回合 | 30/92，约 32.6% |
| 疑似用户纠偏/要求继续 | 22/92，约 23.9% |
| 输入 tokens | 12,885,309 |
| 输出 tokens | 126,608 |
| 输入/输出比 | 约 102:1 |
| 回合耗时中位数 | 53.3 秒 |
| 回合耗时 P90 | 346.8 秒 |
| 上下文压缩 | 9 次 |
| 分支使用 | 0 次 |

成本字段全部为 0，说明自定义代理没有上报价格，因此目前无法进行可靠的成本对标。

## 主要问题

### 1. 模型容量配置是最严重的稳定性缺陷

共有 18 次请求因为上下文与输出上限冲突而直接失败。例如 GLM 请求保留了 163,840 输出 tokens，输入 36,161 tokens，刚好超过真实 200,000 上限：[历史错误](/C:/Users/14168/.pi/agent/sessions/--C--Users-14168-Documents-GitHub-浙水智能体--/2026-08-27T01-23-43-123Z_01a040d0-d593-7232-8c7a-fd20b3ac6145.jsonl:94)。

当前自定义模型默认值是：

```ts
contextWindow: 1000000
maxTokens: 128000
```

见 [ConfigModal.tsx](/C:/Users/14168/Documents/GitHub/浙水智能体/community-hydroagent/apps/desktop/src/renderer/src/ConfigModal.tsx:73)。

核心层虽然有 token clamp，但它依赖配置中的 `contextWindow`；当配置比代理真实上限乐观时，保护就失效了：[simple-options.ts](/C:/Users/14168/Documents/GitHub/浙水智能体/community-hydroagent/packages/ai/src/api/simple-options.ts:15)。

### 2. 工具协议兼容不够稳

45 次工具错误中：

- 20.0%：工具参数结构错误，如 `file_path`/`old_string` 与实际 schema 不一致
- 15.6%：工作目录或文件路径错误
- 8.9%：编辑目标过期、文本无法精确匹配
- 28.9%：npm、GitHub、node-gyp、网络等外部问题

典型 schema 错误见[该 session](/C:/Users/14168/.pi/agent/sessions/--C--Users-14168-Documents-GitHub-浙水智能体--/2026-08-26T06-43-27-706Z_01a03ccf-355a-75f1-9f73-5dd98deb7e73.jsonl:38)。这些本应在执行前由 harness 自动转换或拦截。

### 3. UI 修改缺少“看见结果”的闭环

记录中有：

- 17 个用户图片输入
- 57 次 `edit`
- 6 次 build
- 3 次 LSP 检查
- 0 次测试
- 0 次改后页面截图或浏览器回归

因此出现了“不是红色”“还是灰色”“没有修改成功”等多轮返工：[灰色按钮反馈](/C:/Users/14168/.pi/agent/sessions/--C--Users-14168-Documents-GitHub-浙水智能体--/2026-08-26T06-43-27-706Z_01a03ccf-355a-75f1-9f73-5dd98deb7e73.jsonl:305)。

Codex 当前桌面端浏览器支持检查渲染状态、DOM、控制台、网络和截图验证；Claude Code 的 Chrome 集成也明确支持设计验证、视觉回归和本地 Web 测试。[Codex Browser](https://learn.chatgpt.com/docs/browser)、[Claude Code Chrome](https://code.claude.com/docs/en/chrome)。

### 4. 插件安装缺少兼容性准入

一次批量安装后，`rpiv-todo` 与内置 `pi-deck-todo` 注册同名 `todo` 工具，导致扩展运行整体禁用：[冲突记录](/C:/Users/14168/.pi/agent/sessions/--C--Users-14168-Documents-GitHub-浙水智能体--/2026-08-25T06-41-19-342Z_01a037a6-e3ee-7e2c-adb2-b3f5414d9b7a.jsonl:62)。

这说明目前“安装成功”只代表包管理器成功，没有验证：

- 工具名冲突
- Node ABI 与原生依赖
- Windows/Linux 兼容性
- 扩展能否实际启动
- 是否影响其他扩展

### 5. 上下文使用效率偏低

平均每个用户回合消耗约 14 万输入 tokens。主要原因可能包括：

- 长 session 中不断重放历史
- 同时加载大量扩展和工具 schema
- 不同任务继续堆在同一会话
- 工具输出没有充分压缩
- 只发生 9 次 compaction，且从未使用分支
- 621 次工具调用中只有 1 次 Agent 委派

Codex 官方建议把验证标准写入 `AGENTS.md`，使用测试、Review、浏览器和隔离任务降低长上下文噪声；Claude Code 也将 gather–act–verify 作为正式 agent loop，并提供 hooks、subagents 与独立上下文。[Codex 最佳实践](https://learn.chatgpt.com/guides/best-practices)、[Claude Code 工作机制](https://code.claude.com/docs/en/how-claude-code-works)。

## 与 Codex、Claude Code 的位置关系

| 能力 | HydroZAgent | Codex / Claude Code |
|---|---|---|
| 水利场景、本地内网 | 明显优势 | 通用产品 |
| 多模型、多代理供应商 | 优势 | 相对封闭 |
| Skills、MCP、插件 | 较强 | 成熟 |
| 会话轨迹与审计 | 较强 | 成熟 |
| 模型能力自动校准 | 明显不足 | 更成熟 |
| 工具 schema 稳定性 | 不足 | 更成熟 |
| 代码修改后验证 | 不稳定 | 已形成正式工作流 |
| UI 浏览器回归 | 基本未落地 | 两者均已支持 |
| Hooks 强制质量门禁 | 尚未产品化 | 两者均有正式机制 |
| 并行 Agent/工作树 | 很少使用 | 已产品化 |
| 自动故障恢复 | 不足 | 相对成熟 |

需要强调：历史中的 `zeta/claude-*` 只是 Claude 模型，不等于 Claude Code；`zeta/gpt-5.4` 也不等于 Codex。当前数据只能比较 HydroZAgent 的实际表现与两者公开的 harness 能力，不能构成科学的直接胜负排名。

## 优化优先级

### P0：先解决会话会失败的问题

1. 模型能力探测与动态限额

   - 不再默认 100 万上下文。
   - 首次连接读取模型元数据或执行容量探测。
   - 请求前按真实上限动态计算输出预算。
   - 遇到 context 400 后自动降低 `maxTokens`、压缩上下文并重试一次。
   - 缓存每个 provider/model 的真实能力和失败历史。

2. 工具参数兼容层

   - 自动把 `file_path` 转换为 `path`。
   - 兼容旧版与新版 edit 参数格式。
   - 执行前进行 schema 校验并让模型只修复参数，不浪费一次真实调用。
   - Windows 路径统一规范化，先验证 workspace 与文件存在性。

3. Provider 健康检查与故障转移

   - connection/timeout 连续两次后启动熔断。
   - 保存当前任务状态，切换备用模型继续，而不是让用户反复输入“继续”。
   - UI 显示“模型故障、正在恢复”，区分用户中止和系统失败。

### P1：建立“修改—验证—交付”闭环

4. 完成门禁

   - 修改代码后必须执行适用的 LSP、类型检查或目标测试。
   - UI 任务必须启动本地页面、截图并检查 DOM/样式。
   - 未验证时只能报告“已修改，尚未验证”，不能直接声称“完成”。

5. 插件准入扫描

   - 安装前扫描工具名、命令名和快捷键冲突。
   - 在临时目录安装并启动一次。
   - 检测原生模块、Node 版本和目标操作系统。
   - 单个扩展失败时隔离该扩展，不应禁用整个扩展系统。

6. 上下文治理

   - 工具按需加载，而不是把几十个插件 schema 全放进每次请求。
   - 大型读文件和命令输出保存到文件，只向主上下文注入摘要。
   - 任务完成后建议新建 session。
   - 调研、测试、日志分析使用隔离子 Agent。
   - 达到 60%–70% 上下文时主动压缩，而不是等到 API 拒绝。

### P2：形成持续评测体系

7. 增加类似 Claude Code `/insights` 的本地分析页，持续记录：

   - 回合正常完成率
   - 用户纠偏率
   - 工具失败率及根因
   - 首次修改验收率
   - 代码修改验证覆盖率
   - P50/P90 延迟
   - 每任务 tokens 与费用
   - provider 健康度

8. 建立真正的三方基准：

   - 固定同一 Git commit、权限、任务说明和验收测试。
   - 设置 15–30 个任务：代码检索、UI 单点修改、视觉复现、多文件重构、依赖安装、故障修复、规划任务。
   - HydroZAgent、Codex、Claude Code 每题至少重复两次。
   - 以自动测试、截图差异和人工盲评共同评分。

建议第一阶段目标：正常结束率从 63% 提升至 90%，工具错误率从 7.3% 降至 2% 以下，工具 schema/路径错误降至 1% 以下，UI 修改必须 100% 附带改后验证证据，P90 回合耗时从 347 秒降低到 180 秒以内。

评估体系
| 能力域 | 建议权重 | 对标对象 |
|---|---:|---|
| 软件开发与系统维护 | 30% | Codex、Claude Code |
| 水利专业业务能力 | 25% | 水利工程师实际工作质量 |
| 文档、表格、报告生产 | 15% | ChatGPT、Claude、Microsoft Copilot |
| 水情数据分析与可视化 | 10% | Python/Excel/GIS 专业流程 |
| 内网知识库与信息检索 | 8% | 企业知识助手、RAG 系统 |
| 运营与自动化流程 | 7% | MCP、工作流与任务自动化产品 |
| 安全、权限、审计 | 5% | 政企内网应用要求 |