# Plan: hydroZagent 内网多用户接入与使用记录

- Author: 浙水智能体用户 / Claude / Codex
- Captured: 2026-09-01
- Revised: 2026-09-01
- Status: accepted
- Source intent: [`intent.md`](./intent.md)（accepted）
- Source spec: [`spec.md`](./spec.md)（accepted）
- Source requirements: [`requirements.md`](./requirements.md)
- SDLC stage: Accepted / ready for implementation from S0

> 本计划仅实现 `spec.md` 的 P0。实施按纵向切片推进，每片都必须“变更 → 针对性测试 → 退出标准 → 安全回滚”闭环。普通开发构建保持现状；受管能力只进入专用 Windows 受管制品，且在 S11 发布门禁通过前不得分发。

## 0. 给执行者的必读约定

1. 修改代码前完整阅读仓库 `AGENTS.md`、`HYDRO.md` 及目标目录规则。遵守 erasable TypeScript、无新增 `any`、顶层 import、依赖精确固定等约束。
2. 一次只实现一个切片。每片结束先跑针对性测试；改过代码必须跑根目录 `npm run check`，修复全部 error、warning、info。
3. 门禁顺序不可颠倒：HCS 必须先完成“令牌 + 当前同意 + 当前模型白名单”的服务端校验（S3），客户端才能在 S8 改走代理。
4. 所有安全失败均 fail-closed：不得退回模型直连、旧 Provider、无鉴权 Web 服务或明文落库。
5. `spec.md §20` 的生产值不得靠代码默认猜测。测试配置可有固定夹具；生产配置缺少 TTL、保留期、配额、白名单、CA、密钥或 ACL 声明时，`/readyz` 必须失败。
6. 受管标志必须是编译期常量。生产受管制品不得通过运行时环境变量、设置文件或 UI 切换为非受管模式。
7. 不调用真实付费或内网模型做自动化测试。代理测试使用本地假的 OpenAI-compatible upstream，覆盖 SSE、工具调用、取消和错误映射。
8. 依赖和 lockfile 视同代码审查。新依赖使用精确版本；先审查来源、维护状态、许可证和 lifecycle scripts，再按仓库规则安装。Argon2id 实现如包含安装脚本，须取得明确执行许可。
9. 只提交当前切片改动；显式列路径，不跨顶层仓库与 `hydroZagent` 子仓库混提交；未经用户要求不提交。

## 1. 固定的工程决策

### 1.1 HCS 包与依赖边界

- `apps/server` 使用独立 `package.json` 与 `package-lock.json`，与现有 `apps/desktop` 一致，不加入根 workspace，避免影响 pi 包的 lockstep 发布。
- 根脚本新增 `hcs:check`、`hcs:test`，但 HCS 安装由 `npm ci --prefix apps/server --ignore-scripts` 独立完成。
- 服务端基础栈固定为：Fastify（HTTP/SSE）、`pg`（连接池）、版本化 SQL migration runner、`jose`（JWT）、TypeBox/JSON Schema（运行时校验）、经安全审查的 Argon2id 实现、Vitest（测试）。AES-256-GCM 使用 Node `crypto`，不引入 ORM、pgcrypto 或第二套加密库。
- S0 实施时把上述依赖固定为精确版本并记录审查结果；不得在后续切片临时更换框架。
- Argon2id 实现必须先证明可在 Linux CI/容器中通过 `--ignore-scripts` 安装并运行；若候选包必须执行 lifecycle script，S0 在安装前暂停并请求对**具体包、具体版本、具体脚本**的明确许可，不得静默放开全部脚本。

### 1.2 单一契约源

- 新建 `contracts/hcs/v1/`，保存 OpenAPI/JSON Schema、RPC schema 与接受/拒绝夹具，作为 auth、usage、error、`ManagedModel`、`configure_managed_provider` 的唯一契约源。
- `scripts/generate-hcs-contracts.mjs` 生成：
  - `apps/server/src/contracts/generated.ts`
  - `apps/desktop/src/shared/hcsContracts.generated.ts`
  - `packages/coding-agent/src/modes/rpc/managedProvider.generated.ts`
- 生成文件不得手工修改；`scripts/check-hcs-contracts.mjs` 在 CI 中校验生成结果无漂移、三端对同一夹具结论一致。
- `ManagedModel` 不复用桌面 `AvailableModel`。桌面展示结构只能由 `ManagedModel` 派生。

### 1.3 测试基础设施

- HCS 集成测试使用临时 PostgreSQL 数据库；CI 使用 PostgreSQL service container，每个测试文件/worker 使用独立 schema 或事务清理。
- 模型代理使用进程内 fake upstream，不读取 endpoint、API key 等真实环境变量。
- Windows 专用行为（DPAPI、受管打包、随包 Pi）必须在 `windows-latest` CI job 验证；Ubuntu job 不能代替。

## 2. 变更面

### `contracts/hcs` 与根脚本

- 规范化 API/RPC schema、契约夹具、生成与漂移检查脚本。
- 根 `package.json` 增加 HCS/契约检查入口；CI 增加 HCS PostgreSQL job 和 Windows 受管制品 job。

### `apps/server`（新建 HCS）

- `src/config/`：测试/生产配置 schema；生产必填项缺失即拒绝 ready。
- `src/db/`：连接池、事务、`schema_migrations`、版本化 SQL migration。
- `src/auth/`：注册、登录、刷新、退出、注销、密码重置、实时 session 撤销。
- `src/consent/`：告知、同意、撤回、失效与服务端校验。
- `src/proxy/`：`ManagedModel` catalog、白名单授权、OpenAI Chat Completions 代理、流式取消、可信调用日志。
- `src/ingest/`：使用记录、幂等和调用关联。
- `src/security/`：AES-256-GCM 信封、AAD、密钥加载/轮换、日志脱敏。
- `src/lifecycle/`：到期清理、崩溃调用结算、匿名化和审计。
- `src/admin-cli/`：Linux 本机 one-shot CLI；P0 不提供记录查询/导出。
- `src/health/`：`/healthz`、`/readyz`。
- `test/`：单元、契约、集成、安全与故障恢复测试。

### `deploy/hcs`（新建 Linux 部署资产）

- HCS/PostgreSQL Compose、非 root 容器、systemd wrapper、配置模板、secret mounts、TLS/内网 CA、迁移 job、备份/恢复/清理、日志与基础告警、模型 ACL 验证脚本。

### `apps/desktop`

- `src/main/managed/`：编译期标志、固定 HCS 地址/CA、启动策略与 fail-closed gate。
- `src/main/auth/`：登录/刷新/退出/注销、DPAPI-backed `safeStorage` 凭证仓库。
- `src/main/catalog/`：HCS catalog 拉取、校验、缓存和过期。
- `src/main/proxy/`：每 runtime 回环代理、capability、令牌注入、调用 ID 捕获。
- `src/main/reporting/`：使用记录组装、有界重试和失败提示。
- 受管锁定：Pi/DSH/ImageGen/飞书/视觉桥/Web/customPiPath/WSL/Provider 配置面。
- renderer 只通过受限 IPC 获取登录状态、脱敏模型目录和错误状态，不接触令牌、capability 或 CA 私钥。

### `packages/coding-agent`

- 增加完整 `configure_managed_provider` RPC envelope、协议版本、状态机和私有受管传输层。
- capability 不进入 `Model.headers`、模型快照、RPC 响应、stdout 或日志。

## 3. 依赖顺序

```text
S0 契约、脚手架、迁移、独立 lockfile、CI
 └─► S1 账号/令牌/本机管理员 CLI
      └─► S2 知情同意
           └─► S3 模型目录与代理（服务端门禁生效）
                └─► S4 使用记录 + AEAD/AAD
                     └─► S5 生命周期、匿名化、审计
                          └─► S6 Linux 部署与运维硬化（服务端 P0 可部署）

S1/S3 契约稳定后可开发客户端，但受管制品不得发布：
S7 编译期受管制品 + 登录/DPAPI/固定 HCS 信任
 └─► S8 Managed Provider RPC + 回环代理（依赖 S3、S7）
      └─► S9 受管锁定与全部逃逸面封堵
           └─► S10 上报 + 同意 UI + 临时会话（依赖 S2、S4、S9）
                └─► S11 端到端、部署验证、Windows 制品与发布门禁
```

- S0–S6 可仅通过 API、fake upstream 和部署测试完成。
- S7 可并行实现，但 S8 集成必须使用已通过 S3 的 HCS。
- 任何中间切片均不得作为正式受管制品发布；S11 是唯一发布出口。

## 4. 实施切片

> 每片均包含目标、变更、验证、退出标准和回滚。退出标准未满足不得开始依赖它的切片。

### S0：契约、脚手架、数据模型与 CI

- **目标**：建立可运行的空 HCS、单一契约源、完整 P0 schema 和可重复测试环境。
- **变更**：
  - 新建 `contracts/hcs/v1`、生成/漂移检查脚本。
  - 新建独立 `apps/server` package/lockfile、Fastify 空服务、配置解析、`/healthz`。
  - 实现版本化 SQL migration runner 和 Spec §3 全表；包括 `consents.invalidated_at`、`password_resets.issued_by_audit_id`、三类 audit actor、`model_proxy_calls.in_progress`、`turn_model_call_links` 两端 `ON DELETE CASCADE`。
  - 根脚本接入 HCS check/test；CI 新增 PostgreSQL service、HCS 独立安装、migration up/down、typecheck/test 和契约漂移检查。
- **验证**：干净库 migrate up；测试环境 migrate down/up；重复 migrate 幂等；外键/级联约束测试；`/healthz`；生成文件 `--check` 无漂移。
- **退出标准**：HCS 可启动；CI 确实安装并测试独立 package；三端契约可据同一 schema 开发。
- **回滚**：尚无生产数据时删除新 package/contract；生产 migration 一律 forward-fix，不执行破坏性 down。

### S1：账号、令牌与 Linux 本机管理员 CLI

- **目标**：完整账号生命周期、实时撤销和可审计本机管理操作。
- **变更**：
  - 注册/登录/刷新/退出/注销/密码重置；密码长度 12–128、弱口令和账号名检查、Argon2id；自助注册固定 `is_self_reported=true`，接口与提示明确“自报账号、非实名”。
  - access token 使用带 `iss/aud/user_id/sid/jti/role/exp` 的签名 JWT；refresh token 使用高熵 opaque token，仅存哈希并轮换。
  - 每个受保护请求实时查询 `auth_sessions` 和 `users.status`；role 从库读取。
  - IP+账号限流、失败锁定、保留账号名、异常注册审计。
  - `hydro-hcs admin <子命令>` 为 Linux 本机 one-shot CLI；共享服务层，不开放管理网络端点。校验受信 sudo 上下文，记录 `os_operator` 原始 UID；支持 seed/建号/改角色/删记录/签发重置令牌，P0 不查询/导出。
  - 签发重置令牌先写 audit，再把 ID 写入 `password_resets.issued_by_audit_id`；改密撤销全部 session。
- **验证**：哈希、JWT、refresh 轮换、锁定、注册限流、实时撤销；退出/停用/改密后旧 access 立即失败；无 sudo 上下文或非法子命令拒绝；审计主体与重置外键正确；日志无口令/令牌。
- **退出标准**：Spec AC8/AC11 与 P0 CLI 边界均有自动化证据。
- **回滚**：在下游未接入前可关闭 auth 路由；接入后关闭 auth 必须同时让 proxy/ingest fail-closed。

### S2：知情同意状态机

- **目标**：建立可实时强制、不会被清理任务误删的同意状态。
- **变更**：实现 notice、consent、withdraw；当前 notice 更新时将旧有效记录写 `invalidated_at`；注销时失效当前同意；`assertValidConsent` 只接受当前版本且未撤回/失效的记录，不把同意写入 JWT。
- **验证**：无记录、旧版本、withdrawn、invalidated 均拒绝；当前版本接受；重复同意幂等；换版和注销正确失效。
- **退出标准**：S3 可把同意检查作为强制授权条件。
- **回滚**：S3 接入前可独立关闭；接入后关闭 consent 必须使 proxy/ingest 不可用，不得跳过校验。

### S3：托管模型目录与模型代理

- **目标**：HCS 成为模型授权的唯一服务端入口并产生可信调用日志。
- **变更**：
  - `GET /proxy/v1/models` 返回 `{catalog_version,expires_at,models:ManagedModel[]}`；公开模型 ID 到上游模型/路由仅在 HCS 保存。
  - `POST /proxy/v1/chat/completions` 按“令牌 → 当前同意 → 当前 catalog 原子解析模型”授权；非白名单返回 `model_not_allowed`。
  - 剥离客户端认证头，只用 HCS secret 构造上游请求；支持 SSE、工具调用、超时、最大 body、每用户配额、全局并发和 `Retry-After`。
  - 授权通过后建立 `model_proxy_calls(in_progress)`，响应首部返回调用 ID；完成/错误/取消结算 tokens/latency/status；客户端断开同步 abort upstream。
  - `/readyz` 检查 DB、生产配置、密钥存在性和 fake/真实上游可达性；日志严格 redaction。
- **验证**：正常、无令牌、无同意、停用、非白名单、catalog 过期/不可用；SSE/工具调用；取消释放连接；头替换；配额；调用日志结算；正文/令牌/上游密钥不进日志。全部使用 fake upstream。
- **退出标准**：AC1/AC2/AC5/AC6/AC9、HCS 白名单授权和目录 fail-closed 通过。
- **回滚**：代理可整体下线；客户端只能得到不可用状态，不退回直连。

### S4：使用记录、调用关联与 AES-256-GCM

- **目标**：保存客户端尽力采集的输入/最终回复；身份可信、正文内容不宣称可信。
- **变更**：
  - `POST /ingest/usage` 校验 access+consent，从 token 解析用户，忽略客户端身份；P0 由服务端固定 `group_snapshot=null`；校验 DTO 大小、状态、ID 和字段边界。
  - `event_id` upsert-once；重复内容不同也不覆盖首条，并记录冲突摘要。
  - `model_call_ids[]` 逐个校验同用户并在同一事务写关联；跨用户导致整次请求拒绝。
  - `user_input`/`assistant_final` 使用 AES-256-GCM 信封；96-bit 随机 nonce；AAD 严格为 `JSON.stringify([v,"usage_record",event_id,user_id,field_name])`。
  - 当前 `key_id` 写新数据；旧 key 可读；实现后台惰性重加密的服务接口，密钥缺失时读写 fail-closed。
- **验证**：正常、终态/空最终文本、临时会话、去重、冲突、跨用户、零到多调用关联；数据库不含明文；跨记录/用户/字段搬运密文解密失败；轮换和密钥缺失测试。
- **退出标准**：AC1/AC7/AC13/AC14、AAD 防替换、关联及加密门禁全部证明。
- **回滚**：ingest 可关闭；客户端最终提示记录失败，但模型代理仍可按“尽力采集”语义工作。

### S5：生命周期、故障恢复、匿名化与审计

- **目标**：让保留、删除、恢复和审计规则与 accepted Spec 完全一致。
- **变更**：
  - `usage_records` 从 `received_at` 起算；当前有效 consent 不清理，失效 consent 从 `withdrawn_at/invalidated_at` 起算。
  - `model_proxy_calls` 独立期限；session/reset 分别以 `COALESCE(revoked_at,expires_at)`、`COALESCE(used_at,expires_at)` 起算。
  - HCS 启动与定时任务把超过代理最大超时仍为 `in_progress` 的调用结算为 `error/server_interrupted`。
  - 两端 cascade 只删除关联行；匿名化时墓碑 username、随机不可登录 password hash、清除可识别字段并保留 ID。
  - audit 支持 `user/system/os_operator`；清理使用 system；摘要只允许白名单元数据。audit 保留期不短于 password reset，仍被引用时禁止删。
  - key rotation 只有在主库及未过期备份均无引用后才能销毁旧 key。
- **验证**：有效同意不误删；各种起算点；两端 cascade；崩溃恢复；注销匿名化；audit actor/摘要/引用期限；清理失败重试和告警事件。
- **退出标准**：Spec 生命周期、审计、匿名化和故障恢复不变量通过。
- **回滚**：清理 scheduler 可停用以避免误删；不能关闭鉴权、加密或审计后继续服务。

### S6：Linux 单节点部署、TLS、备份与基础运维

- **目标**：把 S0–S5 变成可在内网 Linux 安全部署的 P0 服务。
- **变更**：
  - Compose 部署 HCS/PostgreSQL，HCS 非 root、只读 rootfs、最小 volume；PostgreSQL 仅在 Compose 内网监听、不映射宿主公网端口；systemd wrapper 负责开机启动、重启和 OnFailure 告警。
  - 生产配置和 secrets 以 root/service 用户受控文件或 secret mount 注入；不写镜像、仓库、命令行和日志。
  - PostgreSQL 数据卷和宿主备份目录必须位于 LUKS 或单位基础设施提供的加密块存储；部署检查记录静态加密证据。
  - HCS 直接提供 HTTPS，证书/私钥由内网 CA 签发并挂载；客户端信任材料由 S7 编译进受管制品。
  - migration 作为 one-shot job 在 HCS ready 前执行；失败不启动业务服务。
  - 安装受控 sudoers 规则：仅 `hydro-admin` 组可运行固定 one-shot CLI，配置/secret 对普通用户不可读；seed 使用 `actor_type=system`，其他 CLI 调用必须有受信 `SUDO_UID`。
  - 配置模型服务 ACL，只允许 HCS 主机；提供从 HCS 成功、从非 HCS 主机失败的验证脚本。
  - 备份通过管道执行 `pg_dump | age -r <单位备份公钥>`，明文 dump 不落盘；HCS 主机只持 recipient 公钥，恢复私钥保存在独立密钥设施。`age` 版本/容器 digest 固定并纳入部署审查；密文按 `T_backup` 销毁，记录 `T_table + T_backup ≤ T_absolute` 核算。恢复时流式解密到隔离数据库，先 migration、到期清理、完整性验证，再切换服务。
  - 日志轮转、磁盘/进程/readyz 基础告警；高级指标和完整恢复演练仍属 P2，但 P0 至少执行一次受控恢复冒烟。
- **验证**：全新 Linux VM 启动；权限/secret/HTTPS/CA；migration 失败 fail-closed；重启恢复；ACL 双向证明；加密备份无法明文读取；恢复后过期数据不可查询；告警触发。
- **退出标准**：服务端 P0 可部署，Spec §19 部署门禁具备证据。
- **回滚**：回滚到上一 HCS 镜像并保留向前兼容 schema；代理下线即客户端不可用，不开放直连。

### S7：Windows 受管构建、固定信任与登录凭证

- **目标**：建立不可运行时改写的受管制品和系统绑定凭证存储。
- **变更**：
  - `electron.vite.config.ts` 为 main 编译 `__HYDRO_MANAGED__`；普通开发/发行默认 false，专用 `desktop:dist:managed` 脚本固定 true 并使用独立 artifact 名。
  - 受管 build manifest 编译固定 HCS HTTPS base URL 和当前/下一内网 CA PEM bundle；TLS 必须同时通过 CA 链和目标 hostname 校验，打包后不读取设置/env 覆盖。CA 轮换通过先发布含双 CA、再发布移除旧 CA 的受管制品完成。
  - renderer 通过只读 IPC 获取 managed 状态；不得自行判断环境变量。
  - 使用 Electron `safeStorage`（Windows DPAPI）加密 access/refresh token；磁盘只保存原子写入的密文信封，renderer 无读取 IPC；启动时必须检查 `safeStorage.isEncryptionAvailable()`，不可用即 fail-closed，P0 不接受 `basic_text` 或明文兼容模式。
  - 登录、刷新、退出、注销和 Agent gate；刷新失败、撤销或停用立即清除本地凭证并禁用 Agent。
- **验证**：编译产物在运行时设置同名 env 也不能改变模式；HCS URL/CA 不可覆盖；未登录/离线禁用；DPAPI 往返、密文非明文、退出/注销清理；普通构建行为不变。Windows CI 运行。
- **退出标准**：受管制品身份、HCS 信任与 AC15 凭证边界通过。
- **回滚**：生产只能安装上一版受管制品；不得把受管制品运行时切成非受管。普通开发构建不受影响。

### S8：Managed Provider RPC、catalog 与本地回环代理

- **目标**：Pi 只通过主进程代理访问 HCS，且所有秘密保持在私有内存态。
- **变更**：
  - 完整实现 Spec `ConfigureManagedProviderCommand/Response` envelope、`errorCode`、协议版本、未配置 gate、同配置幂等和首 prompt 后 `managed_runtime_started`。
  - `ManagedModel → Pi Model` 固定 `api/baseUrl/cost` 并映射 input/thinking/compat；再派生桌面 `AvailableModel`。
  - capability 存在受管传输层私有闭包，不进入 `Model.headers`；RPC/model snapshot/stdout 全部脱敏。
  - main 直接从 HCS 拉 catalog；用 HCS `Date` 响应头与 `expires_at` 计算 TTL，再转换为本机单调时钟 deadline，避免客户端时钟偏移。过期且刷新失败禁用 Agent；HCS 始终是模型授权最终边界。
  - 回环代理监听随机 `127.0.0.1` 端口，仅接受带当前 runtime capability 的 `POST /proxy/v1/chat/completions`；拒 catalog、其他方法、auth、ingest；转发前剥离 capability/认证头，再注入 access token。
  - access 临近过期时由 main auth 模块先刷新再发请求；代理收到 HCS `401` 最多刷新并重试一次，且只能在尚未收到上游响应体前重试，流式中途不得自动重放。
  - 每 runtime 租约维护 `runtime_id/session_id/active_turn_id`；捕获调用 ID；结束/退出/切账号立即关闭端口并清 capability。
- **仓库记录**：更新 `packages/coding-agent/CHANGELOG.md` 的 `[Unreleased]`，描述新增受管 RPC/运行时能力，不修改已发布版本章节。
- **验证**：协议/状态机/模型映射；capability 不出现在任何可序列化对象、stdout、日志；路径/方法矩阵；旧/错/过期 nonce；catalog 过期；令牌替换；多 runtime/多 turn 调用 ID 隔离；完整 Pi→main→HCS→fake upstream 链路。
- **退出标准**：AC3、目录 fail-closed、凭证/capability 防泄漏和轮次关联通过。
- **回滚**：受管制品 fail-closed；只有普通开发构建保留原直连路径。

### S9：受管锁定与逃逸面封堵

- **目标**：受管制品中不存在可绕过 HCS 的模型入口或可替换 Pi 路径。
- **变更**：在 main 启动装配边界只安装 Pi；阻断 DSH、ImageGen、飞书桥、视觉桥扩展；锁定并移除 Web 设置；忽略本机 auth/models/provider migration；禁 `customPiPath`、WSL 和开发 Pi 环境变量；只解析随包、版本/协议匹配的原生 Pi。
- **验证**：逐项绕过测试；直接修改设置文件、`~/.pi`、环境变量、扩展文件均失败；受管安装包无共享模型密钥，随包 Pi 支持指定协议且无法被路径替换。
- **退出标准**：AC3/AC4/AC10 及全部逃逸面测试通过。
- **回滚**：回滚上一受管制品；不得重新开启入口。普通开发构建保持原功能。

### S10：使用记录上报、同意 UI 与临时会话

- **目标**：形成尽力采集、失败可见的客户端闭环。
- **变更**：
  - 首登拉 notice 并同意；拒绝、撤回、旧版本或校验失败均停止 Agent；同意状态只以服务端为准。
  - 每轮收集输入、最终回复、终态和元数据；主进程附对应 `model_call_ids[]`；不上传历史会话、图片、工具参数等 P0 排除内容。
  - 进程内有界指数退避；成功/去重停止；超过上限明确提示，不跨重启持久补传。
  - “匿名会话”改为“临时会话（不保存在本机，但使用记录仍会上报）”，设置 `anonymous=true`。
- **验证**：完成/中止/错误/无最终文本/多次工具调用；历史恢复不回传；断 ingest 有界重试后提示；撤回立即停用；临时会话文案与标记。
- **退出标准**：AC7/AC16、同意 UI 和采集边界通过。
- **回滚**：上报失败按既定重试并最终提示，不阻断已授权模型调用；同意服务端门禁不可回滚绕过。

### S11：端到端、部署验证与发布门禁

- **目标**：用真实受管制品和测试部署汇总全部发布证据。
- **变更**：
  - E2E：注册/登录→notice/consent→catalog→代理→工具循环→上报/关联→撤回/注销→清理/匿名化。
  - Windows job 构建版本锁定 Pi 和受管安装包，执行制品扫描、运行时 mode/URL/CA/路径锁定测试。
  - Linux 测试部署执行 HTTPS、ACL、backup/restore-before-ready、迁移和基础告警验证。
  - 汇总 Spec §18/§19 对应测试文件和证据；生产配置/治理清单签字后才能批准发布。
- **验证**：见 §6 命令和 §8 DoD；所有测试只使用假数据/fake upstream，部署 ACL 使用专门测试 endpoint。
- **退出标准**：全部 Spec 不变量有自动化或部署证据；无未确认生产必填项；受管制品可发布。
- **回滚**：本切片不新增业务逻辑；任一门禁失败即阻断发布。

## 5. Spec 不变量到测试的映射

| Spec 不变量 | 首次证明 | 长期回归 |
| --- | --- | --- |
| 未登录/离线不可调用 | S3/S7/S8 | server auth/proxy + Windows managed tests |
| 撤销/停用实时失效 | S1 | auth middleware integration |
| 当前同意服务端强制且不入 token | S2/S3 | consent + proxy integration |
| HCS 每请求拒绝非白名单模型 | S3 | proxy authorization/bypass |
| `ManagedModel` 三端映射一致 | S0/S8 | contract drift + mapping tests |
| catalog 过期 fail-closed | S3/S8 | server/desktop catalog tests |
| capability 不进 Model/RPC/stdout/log | S8 | serialization/leak tests |
| 回环代理只允许单一路径与方法 | S8 | route/method matrix |
| 非 Pi 入口/替换 Pi 全封 | S9 | bypass + packaged artifact tests |
| 凭证不落 env/auth.json/Shell | S7/S8 | DPAPI + leak tests |
| 流式取消释放上游 | S3 | SSE abort integration |
| 使用记录身份可信、内容标记尽力采集 | S4 | ingest contract/data tests |
| P0 分组快照恒空且账号明确非实名 | S1/S4 | auth/ingest contract tests |
| 幂等与跨用户关联拒绝 | S4 | conflict/link integration |
| AES-GCM + AAD 防跨记录/字段替换 | S4 | tamper tests |
| 密钥不可用 fail-closed/轮换 | S4/S5 | key lifecycle tests |
| 当前有效同意不被清理 | S5 | retention tests |
| 崩溃遗留调用结算 | S5 | startup/reaper recovery tests |
| 两端级联与注销匿名化 | S5 | lifecycle integration |
| one-shot CLI/sudo actor/audit 摘要 | S1/S5/S6 | CLI + deployment permission tests |
| `T_table + T_backup` 与恢复先清理 | S6 | backup/restore gate |
| 上报有界重试且失败可见 | S10 | reporting tests |
| HTTPS/内网 CA/模型 ACL | S6/S7/S11 | deployment + Windows trust tests |
| PostgreSQL 不外露且磁盘静态加密 | S6 | deployment permission/storage audit |

## 6. 验证命令

按切片运行最小集合；S5、S6、S11 跑对应里程碑集合。不得直接运行整仓 `npm test`。

```powershell
# HCS
npm --prefix apps/server run typecheck
npm --prefix apps/server test
npm --prefix apps/server run test:integration

# Desktop
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop test

# Coding agent 定向测试
Push-Location packages/coding-agent
$repoRoot = git rev-parse --show-toplevel
node "$repoRoot/node_modules/vitest/dist/cli.js" --run test/managed-provider.test.ts
Pop-Location

# 任一代码切片完成后
npm run check
```

```bash
# 非 e2e 全量里程碑；从仓库根目录执行
bash ./test.sh
```

CI 另执行：契约生成 `--check`、PostgreSQL migration、fake upstream integration、Windows `desktop:dist:managed`、Linux 部署/ACL/backup smoke。具体脚本在对应切片创建后写入本节，不使用占位路径通过验收。

## 7. 回滚与发布控制

- 数据库 migration 生产只 forward-fix；应用回滚到仍兼容新 schema 的上一镜像。
- auth/consent/proxy 任一核心模块不可用时，HCS 不 ready，客户端禁用 Agent。
- ingest 暂时不可用时允许已授权模型调用继续，但客户端必须有界重试并最终提示。
- cleanup scheduler 可停用以避免误删；加密、审计和鉴权不可关闭后继续服务。
- 受管制品没有运行时“关闭受管”开关；只能回滚到上一受管制品。`__HYDRO_MANAGED__=false` 仅存在于普通开发/非受管构建。
- 发现模型直连、HCS 白名单绕过、capability/令牌泄漏、CA/endpoint 可覆盖或 Web 旁路时立即阻断发布。

## 8. Definition of done

1. S0–S11 全部退出标准满足，Spec §18/§19 每项都有可定位的测试或部署证据。
2. HCS 独立 lockfile、精确依赖、契约生成、PostgreSQL CI 和 fake upstream 测试稳定。
3. 服务端按 token、当前 consent、当前模型白名单原子授权；撤销/停用实时生效；取消无悬挂。
4. 使用记录身份由服务端解析，正文明确为客户端尽力采集；幂等、关联、AES-GCM/AAD、密钥轮换与 fail-closed 通过。
5. 有效 consent 不误删；崩溃调用结算；两端级联、匿名化、三类 audit actor 和 one-shot CLI 闭环。
6. Linux 单节点 HTTPS 部署、PostgreSQL 不外露、磁盘静态加密、secret/sudoers 权限、模型 ACL、备份加密、`T_table + T_backup` 核算及恢复先清理通过。
7. Windows 受管制品编译期锁定 HCS URL/CA/模式；DPAPI 密文存储；Pi/DSH/ImageGen/飞书/视觉桥/Web/customPiPath/WSL 全部不可绕过。
8. capability、令牌、正文、共享模型密钥不出现在安装包、日志、RPC、stdout、环境变量和普通配置中。
9. 客户端只采集同意后的新轮次；有界重试、失败可见；临时会话语义正确。
10. 生产 TTL、保留期、配额、模型白名单/兼容参数、CA、ACL、容量、数据责任人/审批人/分类与脱敏策略均已显式填写并留档；缺项不可发布。
11. 普通开发构建行为不变；正式受管制品只能经 S11 门禁发布。

## 9. 不在本计划实现

- P1：分组分配/统计、Web 管理界面、用户自查、记录查询/导出、自助密码重置。
- P2：持久化 Outbox、按账号隔离本地目录、macOS、HA、高级指标/容量趋势、正式完整备份恢复演练、非 Pi 模型通道纳管。

## 10. 上线前人工决策门

以下不阻塞编码，但阻塞 S6 生产部署和 S11 发布：

生产填写与签字使用同目录的 `production-approval-template.md`；不得把模板中的建议或测试值直接视为生产批准值。

1. access/refresh TTL、锁定/限流/配额值。
2. usage/失效 consent/model call/auth safety/audit 的保留期限，以及 `T_backup/T_absolute`。
3. 生产模型白名单、完整 `ManagedModel` 元数据与上游路由。
4. 内网 CA、证书轮换负责人、HCS 固定域名和模型 ACL 实施方式。
5. 目标用户数、日均轮次、最大正文、RPO/RTO、磁盘容量。
6. 数据责任人、审批人、分类级别、查看/删除规则及是否脱敏。

## 11. Implementation checkpoints

> 每完成一个切片追加：日期 — 切片 — 变更提交/路径 — 测试命令与通过数 — 关键安全断言 — 未完成项。没有证据不得写“完成”。

- **2026-09-01 — S0–S2** — `contracts/hcs/v1/`、`apps/server/src/{auth,consent,admin-cli,db}/`、独立 `apps/server/package-lock.json`；契约测试 3/3、服务端单元集合纳入 59/59；契约生成无漂移、Argon2id 采用 `hash-wasm` 且安装保持 `--ignore-scripts`。未完成：真实 PostgreSQL 证据由 CI 提供。
- **2026-09-01 — S3–S5** — `apps/server/src/{proxy,usage,lifecycle}/` 与 `test/integration/managedFlow.integration.test.ts`；服务端 17 文件/59 单测通过；白名单、取消、幂等、跨用户关联、AEAD/AAD、清理/匿名化、上游健康检查同源密钥边界均有测试。未完成：本机无 PostgreSQL，5 项集成测试等待 CI。
- **2026-09-01 — S6** — `deploy/hcs/`、`scripts/check-hcs-deploy.mjs`；部署静态门禁通过，脚本覆盖 digest pin、最小权限、age 流式备份和恢复先清理。未完成：真实 Linux VM、模型 ACL 双向证明与恢复 smoke。
- **2026-09-01 — S7–S10** — `apps/desktop/src/main/managed/`、受管 UI/IPC/Pi 进程链路、`packages/coding-agent/src/modes/rpc/managed-provider.ts`；桌面受管定向测试 33/33、桌面 typecheck、coding-agent 4/4 通过。关键断言：URL/CA/模式编译期固定，DPAPI fail-closed，设备身份由 main 持有，单一路径回环代理，私有 capability，Git 摘要/遥测/运行时设置等逃逸面封堵，只采集同意后新轮次且重试不落盘。
- **2026-09-01 — S11（门禁实现，发布未通过）** — PostgreSQL 全流程测试、`.github/workflows/ci.yml` Windows 受管制品 job、`electron-builder.managed.cjs`、`check-managed-artifact.cjs`、`release-evidence.md` 与 `production-approval-template.md` 已落库。未完成：Windows 真实制品、Linux 部署/ACL/备份恢复及 §10 人工决策证据；任一缺失继续阻断发布。

- **2026-09-07 — P0 工程收尾（本轮结果替换历史数字）** — 基线 `ab1aaf46f2e94b0db796e3ae6a479ecc761f4ebd` 加未提交工作区改动，保留用户原有修改。根检查通过；HCS 18 文件 / 63 项通过；PostgreSQL 17.11 临时 schema 的 3 文件 / 5 项实际通过，显式缺少数据库配置立即失败；桌面全量 3063 通过、0 失败、2 个既有符号链接跳过；真实 Windows safeStorage 两项及真实打包全链路通过，受管核心无跳过。修复 SQL 保留字/类型推断、HTTP 类型强制转换、模型目录与根类型漂移、Windows 打包及 Pi 资源、桌面既有回归，以及测试数据库启动的输出管道占用。NSIS/ZIP 已生成、扫描并核对归档与已测运行资源哈希；未签名，仅限测试。详见 `release-evidence.md` 和 `.artifacts/hcs-acceptance/`。
- **2026-09-07 — 工程验收仍未通过 / S11 未批准** — 本轮已获用户明确授权执行隔离全仓与桌面全量测试，覆盖原计划第 6 节的日常定向限制。Windows 全仓保留 51 项失败（符号链接、POSIX 权限、Unix transport），无超时当作通过；缺 Linux 原生全量零失败证据及远程 CI 实际运行结果。生产部署、双向 ACL、静态加密/备份恢复、Windows 安装升级、生产参数和责任人审批仍为上线门禁。测试证书和测试包不能代替发布批准；未提交、未推送、未部署生产。
