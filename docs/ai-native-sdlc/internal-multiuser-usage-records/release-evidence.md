# 内网多用户与使用记录：发布证据

> 更新日期：2026-09-01
> 当前结论：**实现已进入发布门禁，尚未批准发布**。本文件只记录可复现证据；未实际执行的环境验证明确标记为待执行。

## 1. 自动化证据

| 能力/不变量 | 证据位置 | 本机结果 |
| --- | --- | --- |
| 单一契约源、三端生成无漂移、拒绝夹具 fail-closed | `contracts/hcs/v1/`、`scripts/hcs-contract-core.test.mjs`、`scripts/check-hcs-contracts.mjs` | 3/3 通过；漂移检查通过 |
| 注册、登录、刷新轮换、锁定、实时撤销、CLI 审计 | `apps/server/test/auth*.test.ts`、`admin*.test.ts`、`integration/auth.integration.test.ts` | 单元测试已通过；PostgreSQL 集成由 CI 执行 |
| 当前告知与同意强制 | `apps/server/test/consentService.test.ts`、`integration/managedFlow.integration.test.ts` | 单元测试已通过；全流程集成由 CI 执行 |
| 模型白名单、服务端密钥、流式取消、配额和调用结算 | `apps/server/test/proxyService.test.ts`、`integration/managedFlow.integration.test.ts` | 单元测试已通过；全流程集成由 CI 执行 |
| 身份可信上报、P0 空分组、幂等/冲突/跨用户关联 | `apps/server/test/usageEncryption.test.ts`、`integration/managedFlow.integration.test.ts` | 单元测试已通过；全流程集成由 CI 执行 |
| AES-256-GCM、规范 AAD、密钥轮换与缺钥失败 | `apps/server/test/usageEncryption.test.ts` | 已通过 |
| 保留清理、有效同意保护、崩溃调用结算、注销后匿名化 | `apps/server/test/lifecycleService.test.ts`、`integration/managedFlow.integration.test.ts` | 单元测试已通过；数据库级联由 CI 执行 |
| HCS 服务端整体回归 | `apps/server/test/` | 17 文件、59 测试通过；上游模型与健康检查 URL 强制同源，避免共享 key 跨域发送 |
| 编译期固定 HCS URL/CA/hostname 与 DPAPI 密文边界 | `managedHcsClient.test.mjs`、`managedCredentialStore.test.mjs` | 已通过 |
| catalog 服务端时间、单调 TTL、过期 fail-closed、`ManagedModel` 派生 | `managedCatalogService.test.mjs` | 已通过 |
| 回环代理单一路径、capability、请求头剥离、401 单次刷新 | `managedLoopbackProxy.test.mjs` | 已通过 |
| 非 Pi、Git AI 摘要、配置、扩展、日志、升级安装等 IPC 逃逸面封堵 | `managedIpcLock.test.mjs`、`managedSettingsPolicy.test.mjs`、`piProcessSecurityEnv.test.mjs` | 已通过；受管构建另强制 Chromium sandbox 并禁止产品遥测 |
| 当前轮最终回复、无最终文本、临时会话标记、有界重试与失败可见 | `managedUsageProjection.test.mjs`、`managedUsageReporter.test.mjs` | 已通过 |
| 撤回使用规范端点并立即停止本地 Agent | `managedAuthManager.test.mjs` | 已通过 |
| Managed Provider 协议、模型映射、幂等、版本错误与启动后冻结 | `packages/coding-agent/test/managed-provider.test.ts` | 1 文件、4 测试通过 |
| capability/catalog 不进入 RPC 调试日志 | `apps/desktop/tests/piRpcClientTimeout.test.mjs` | 已通过 |
| Windows 独立受管制品、随包 Pi、无扩展资源、编译常量扫描 | `electron-builder.managed.cjs`、`check-managed-artifact.cjs`、CI `managed-windows-artifact` | 门禁已实现；等待 Windows CI 首次产物 |
| Linux compose、非 root、只读文件系统、数据库不映射、加密备份/恢复先清理 | `deploy/hcs/`、`scripts/check-hcs-deploy.mjs` | 静态门禁通过；真实 Linux 主机待执行 |

桌面端本次受管定向集合共 33 项通过，`apps/desktop` TypeScript 检查通过。普通桌面构建的既有行为继续由原 CI job 验证；受管构建使用独立 artifact 名和独立扫描 job。

### 仓库现有基线说明

- 根目录 `npm run check` 的 Biome（1086 个文件）、精确依赖、TS import、shrinkwrap 与 coding-agent install-lock 门禁均通过；随后 `tsgo --noEmit` 被当前分支既有的 `packages/agent/test/convergence/*` 类型漂移及 `packages/ai` 生成模型目录漂移阻断。本次受管改动涉及的 HCS、desktop 与 coding-agent 定向类型/测试均独立通过，不能据此把根门禁表述为全绿。
- 桌面全量测试首次运行得到 3052 项中 3019 通过、31 失败、2 跳过；其中与本次改动相交的启动顺序、RPC 日志菜单和 `AgentManager` 测试加载共 3 项已修复，并分别以 4/4、12/12、8/8 定向复验通过。其余失败位于当前分支既有的历史分页、WSL 路径、dev isolation、UI 静态契约等范围；后续全量复跑曾超时，因此仍不把桌面全量标为通过。

## 2. PostgreSQL 全流程门禁

`apps/server/test/integration/managedFlow.integration.test.ts` 使用临时 schema 和 fake upstream，覆盖：

1. 自助注册后未同意时目录拒绝；
2. 拉取告知并同意后取得目录；
3. HCS 把公开模型映射为私有上游模型，且只使用服务端密钥；
4. 模型调用 ID 与 AES-GCM 加密使用记录关联；
5. 相同事件幂等去重且 `group_snapshot=NULL`；
6. 撤回同意后立即拒绝目录；
7. 注销撤销令牌；保留期清理后账号匿名化。

本机没有 `HCS_TEST_DATABASE_URL`，因此 3 个集成测试文件共 5 项被明确跳过；CI 的 `hcs-check-test` job 提供 PostgreSQL 17 service 并将跳过项转为必跑项。跳过结果不能作为发布通过证据。

## 3. 发布前仍需取得的外部证据

- Windows CI 成功构建并扫描真实受管 NSIS/ZIP；在 Windows 实机完成 DPAPI、安装/升级、随包 Pi 和登录 smoke。
- 全新 Linux VM 使用审批后的 digest 镜像执行 HTTPS、`readyz`、PostgreSQL 不外露、HCS→模型可达和非 HCS→模型不可达的双向 ACL 验证。
- 生成一次 age 加密备份，在隔离 restore volume 完成 checksum、恢复、migration、到期清理和完整性检查。
- 填妥 `production-approval-template.md` 中的 TTL、保留期、配额、模型目录、CA/ACL、容量、RPO/RTO 和数据治理责任人/审批人。
- 保存上述命令输出、镜像 digest、制品 SHA-256、执行时间和审批签字。

在这些证据齐备前，S11 必须保持阻断发布；不得把本地类型检查、静态检查或“CI job 已编写”表述为生产验收完成。
