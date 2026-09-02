# Spec: hydroZagent 内网多用户接入与使用记录

- Author: 浙水智能体
- Captured: 2026-09-01
- Revised: 2026-09-01（六轮 spec 评审）
- Status: accepted
- Source intent: `[intent.md](./intent.md)`（accepted）
- Source requirements: `[requirements.md](./requirements.md)`
- SDLC stage: Accepted / handed off to Implementation Planning (`plan.md`)

> P0 技术设计，可据以写 `plan.md`。**不含实际代码实现**。P1/P2 只给边界。

## 1. 设计结论

新增独立内网后端 **Hydro Control Server（HCS）**，并对 hydroZagent 桌面客户端做受管改造。取舍：

1. **门禁靠架构**：客户端不持模型密钥、不直连；所有模型调用经 HCS 代理，代理在转发前原子校验“有效令牌 + 有效同意 + 当前模型白名单”。
2. **唯一模型通道**：P0 受管构建只保留 Pi→HCS 一条通道，禁用全部非 Pi 独立模型入口（DSH、生图、飞书桥、视觉桥），且**只用随应用发布、版本锁定的原生 Pi**（§8）。
3. **两类记录、两种可信等级**：`model_proxy_calls`（服务端生成、可信、无正文）与 `usage_records`（客户端上报、尽力采集、含正文加密、身份由令牌解析）。
4. **凭证不落地**：令牌只存系统安全存储；经主进程本地回环代理注入，绝不写 `auth.json`/`models.json`、不进 env、不进 Shell（§5）。
5. **P0 单节点、严格在线、fail-closed**：连不上即禁用 Agent；任何回滚不得退回模型直连或无鉴权 Web 旁路。
6. **技术栈**：Node/TypeScript，monorepo 新建 `apps/server`；数据库 PostgreSQL；`packages/coding-agent` **纳入改造范围**（承载受管 Provider bootstrap RPC）。



## 2. 系统组成与部署拓扑

```text
客户端（每台 Windows 电脑）hydroZagent（Electron）
  main：登录门禁 · 令牌(系统安全存储) · 受管策略 · 本地回环令牌代理(每 runtime 一租约) · 模型目录缓存 · 会话上报
  Pi 子进程(版本锁定原生 Pi)：内存态临时 Provider 指向 main 回环端口（→ HCS）
  [受管构建禁用] DSH / 生图 / 飞书桥 / 视觉桥 / customPiPath / WSL
        │ 本地回环(127.0.0.1)                      │ HTTPS(内网)
        ▼                                          ▼
   main 本地令牌代理 ──HTTPS(内网, 剥离上游认证后附 Authorization)──► HCS
                                                        │
HCS（内网 Linux 单节点，apps/server）：auth / proxy / catalog / ingest / lifecycle / admin-cli / (P1)admin-web / storage(PostgreSQL)
        │ 内网 ACL：仅接受来自 HCS 的请求
        ▼   内网自建模型推理服务（已就绪，OpenAI 兼容）
```

- 部署：P0 单节点（容器 + compose/systemd），HTTPS 内网 CA（客户端固定信任，§14）。



## 3. 数据模型（PostgreSQL）

分组表 P1 才建（D17）；`usage_records.group_snapshot` 列 P0 存在但恒空。

```sql
users(
  id uuid pk, username text unique not null,        -- 唯一仅防重名，不防冒名(D7)
  password_hash text not null,                        -- Argon2id 加盐单向哈希
  role text not null default 'user', status text not null default 'active', -- active|disabled
  is_self_reported boolean not null default true,
  failed_login_count int not null default 0, locked_until timestamptz null,
  anonymized_at timestamptz null,                     -- 注销后数据清理完成即匿名化(§13)
  created_at timestamptz not null
)
auth_sessions(id uuid pk, user_id uuid fk, refresh_token_hash text not null, -- id 即 JWT sid
  issued_at timestamptz, expires_at timestamptz, revoked_at timestamptz null, device_id text, client_version text)
consents(id uuid pk, user_id uuid fk, notice_version text not null,
  consented_at timestamptz not null, client_version text,
  withdrawn_at timestamptz null, invalidated_at timestamptz null) -- 告知换版/账号注销时失效
password_resets(id uuid pk, user_id uuid fk, token_hash text, expires_at timestamptz,
  issued_by_audit_id uuid fk not null, used_at timestamptz null) -- 签发者由 admin_audit 统一表达
model_proxy_calls(id uuid pk, user_id uuid fk, model text,     -- 可信，无正文
  started_at timestamptz, ended_at timestamptz,
  status text,                                        -- in_progress|completed|error|cancelled
  error_code text null, prompt_tokens int null, completion_tokens int null, latency_ms int null)
usage_records(event_id text pk, session_id text not null, turn_id text not null,  -- 尽力采集
  user_id uuid fk, group_snapshot jsonb null,         -- 快照 P0 恒空
  received_at timestamptz not null, client_created_at timestamptz,
  task_category text, model text, client_version text, device_id text,
  turn_status text not null,                           -- completed|aborted|error
  user_input bytea, assistant_final bytea,            -- ★AEAD 密文信封(§14)
  anonymous boolean not null default false)
turn_model_call_links(
  usage_event_id text fk references usage_records(event_id) on delete cascade,
  model_call_id uuid fk references model_proxy_calls(id) on delete cascade,
  primary key (usage_event_id, model_call_id))
admin_audit(id uuid pk,
  actor_type text not null,                            -- user|system|os_operator
  actor_user_id uuid fk null, actor_principal text null,
  action text not null, target_type text not null, target_id text null,
  params_summary jsonb not null default '{}', at timestamptz not null)
-- P1: groups(id,name,type), user_groups(user_id,group_id)
```

- `usage_records.user_id`/`group_snapshot` 只由服务端从令牌与库填充。
- 写 `turn_model_call_links` 校验两条记录属同一 `user_id`，拒绝跨用户关联。
- 正文仅存 `usage_records`（AEAD 加密），`model_proxy_calls` 与日志不含正文。



## 4. 认证与令牌机制

- **JWT 载荷**：`{ user_id, sid, jti, role, exp }`。`sid`=`auth_sessions.id` 用于精确撤销；`jti` 仅作审计标识，不宣称重放防护。**令牌内不含同意状态**（同意始终按库实时校验，§11）。
- **撤销语义（实时 DB 校验为准）**：每次代理/采集请求校验签名 + `sid` 未撤销 + `users.status='active'`；退出/停用**立即失效**。访问令牌短 TTL（值见 §20）仅纵深防御。
- **role/同意不信令牌副本**：每次请求从库读取。
- **密码规则**：长度 12–128 个字符，拒绝常见弱口令及包含账号名的口令；不再使用含糊的“长度或字符类”二选一规则。
- **登录限流与锁定**：登录接口按 IP + 账号限流；`failed_login_count` 超阈值设 `locked_until`。
- **密码重置（P0：admin 辅助）**：`users` 无邮箱，故由 admin 经受保护 CLI 签发一次性重置令牌交付用户；签发操作先写 `admin_audit`，其 ID 记入 `password_resets.issued_by_audit_id`，可统一表达应用管理员、系统任务或 OS operator；**重置成功后撤销该用户全部现有会话**。自助重置待引入可信联系方式（§21）。
- **账号生命周期**：注册（限流+复杂度+重名/保留名+异常审计）、登录、刷新（轮换、仅存哈希）、退出（撤销当前 sid）、注销（`status=disabled`+撤销全部会话，数据处理见 §13）。
- **首个管理员**：HCS 启动配置（env/seed）创建。



## 5. 受管运行时可信边界与凭证传递

**问题**：令牌只存系统安全存储，Pi 须携带令牌调模型但不能写文件/进 env；且用户可换旧版/改版 Pi 或用 WSL 绕过受管协议。

**契约**：

- **只用版本锁定的原生 Pi**：受管构建仅使用随应用发布、版本锁定的原生 Pi，**禁用** `customPiPath` **与 WSL 模式**（避免旧版/改版 Pi 不支持或绕过受管协议、以及 WSL 的 127.0.0.1 跨网络边界问题）。
- **受管 Provider bootstrap RPC**：新增 `configure_managed_provider`（落在 `packages/coding-agent`）。请求与响应为：
  ```ts
  type ConfigureManagedProviderCommand = {
    id?: string;
    type: "configure_managed_provider";
    protocolVersion: 1;
    runtimeId: string;
    catalogVersion: string;
    baseUrl: string; // main 回环地址，固定以 /proxy/v1 结尾
    capability: string;
    models: ManagedModel[]; // §6
  };
  type ConfigureManagedProviderResponse =
    | {
        id?: string;
        type: "response";
        command: "configure_managed_provider";
        success: true;
        data: { configured: true; protocolVersion: 1; catalogVersion: string };
      }
    | {
        id?: string;
        type: "response";
        command: "configure_managed_provider";
        success: false;
        error: string; // 保持现有 RPC 客户端的字符串错误契约
        errorCode: "managed_protocol_unsupported" | "managed_config_invalid" | "managed_runtime_started";
      };
  ```
  - 主进程在**首个 prompt 前**必须完成初始化；未初始化则 Pi 拒绝 `prompt`/`set_model`/`cycle_model`，`get_available_models` 返回空列表，Agent 不可用（fail-closed）。
  - Pi 校验 `protocolVersion`，不支持时返回 `managed_protocol_unsupported`；字段或模型无效返回 `managed_config_invalid`。
  - 首次配置以 `runtimeId` 绑定当前进程。相同版本、相同内容的重复请求幂等；首个 prompt 后禁止原地替换配置并返回 `managed_runtime_started`，目录变化时由主进程重启 runtime，避免半轮切换模型契约。
  - 配置成功后，Pi 的可用模型快照**只包含**本次注入的 `ManagedModel` 映射结果，忽略本机模型与认证配置。
  - **capability 不得进入** `Model.headers` **或其他可序列化模型对象**：由受管 Provider 的私有内存态传输层在发请求时注入；`get_state`、`get_available_models`、`set_model` 响应及 stdout 事件只能返回脱敏模型元数据，不能回显 capability。
  - Pi 只在内存持有该 Provider，**不落** `models.json`**/**`auth.json`**、不进 env**。
- **本地回环代理**：主进程 `127.0.0.1` 随机端口监听；收到 Pi 模型请求后，校验并**剥离** `X-Managed-Capability` **及任何上游认证头**，再从系统安全存储取访问令牌附 `Authorization`，经 HTTPS 转发 HCS。**Pi 永不接触令牌，HCS 也不接收本地 capability**。
- **capability 传输**：Pi→回环代理携带 `X-Managed-Capability: <nonce>` 头；代理校验该 nonce 属当前 runtime 租约，否则拒绝。
- **nonce 语义**：每个 Pi runtime 一个高熵 capability，runtime 生命周期内有效；**runtime 结束/注销/切账号即撤销**，端口与能力立即失效。
- **路径最小化**：main 直接从 HCS 拉取 catalog 并通过 RPC 注入 Pi，catalog 不经过回环代理；回环代理只放行 `POST /proxy/v1/chat/completions`，拒绝 catalog、`/auth`、`/ingest` 等其他 HCS 路径与方法。



## 6. 模型代理与托管模型目录（HCS）

- **模型目录契约**：`GET /proxy/v1/models`（**需鉴权**）返回 `{ catalog_version, expires_at, models: ManagedModel[] }`。`ManagedModel` 是 HCS→main→Pi 的唯一权威运行时 DTO；桌面 `AvailableModel` 必须由其单向派生，不作为 HCS 或 Pi 的契约输入：
  ```ts
  type ManagedModel = {
    id: string; // 客户端请求使用的公开白名单 ID；上游真实 ID/路由仅存 HCS
    name: string;
    provider: "hydro-managed";
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: Array<"text" | "image">;
    thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;
    defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    compat?: OpenAICompletionsCompat; // 服务端校验后的允许字段子集，不允许 headers/apiKey/baseUrl
  };
  ```
  - Pi 映射时固定 `api="openai-completions"`、`baseUrl=configure_managed_provider.baseUrl`、内部计费 `cost={input:0,output:0,cacheRead:0,cacheWrite:0}`；`input`、`thinkingLevelMap`、`compat` 按 DTO 使用，`defaultThinkingLevel` 用于首次选择该模型时初始化会话思考档位，且必须是该模型支持的档位。main 再从同一 DTO 派生桌面 `AvailableModel`：`images=input.includes("image")`、`defaultEffort=defaultThinkingLevel`；`reasoning=false` 时无思考档位，`reasoning=true` 时支持所有未被 `thinkingLevelMap` 显式标为 null 的标准档位。由此避免把 DSH 展示字段当成 Pi 运行时契约。
  - 白名单可为**单个或多个**模型；多个时允许用户在白名单内选择。
  - 客户端登录后拉取并缓存；按 `catalog_version` 刷新，缓存仅在 `expires_at` 前有效；获取失败且缓存已过期时 fail-closed，不回退本机模型。
- **代理端点**：`POST /proxy/v1/chat/completions`（OpenAI 兼容，D15），`stream=true` SSE 透传；能力=chat completions + 工具调用透传 + 流式；**不支持** `/responses`。
- 处理链：校验令牌（签名+sid 未撤销+active）→ 校验有效同意（否则 `consent_required`）→ **按 HCS 当前目录原子解析请求** `model` **为服务端保存的上游模型/路由**（不在白名单则 `model_not_allowed`，避免“先校验、后换配置”的竞态）→ 建 `model_proxy_calls`（`status=in_progress`）→ 剥离客户端认证头、只用服务端持有密钥构造上游请求 → 转发内网模型 → 流式回传 → settle 更新 `status=completed|error|cancelled` 并补全 tokens/latency。客户端缓存和受管 UI 不是白名单安全边界，HCS 校验才是最终授权。
- **调用 ID 回传**：响应头 `X-HCS-Model-Call-Id`（流式在首响应头即返回），由主进程租约捕获（§7）。
- **取消**：客户端断开/取消 → 同步终止上游、不留悬挂（AC9），落 `cancelled`。
- **并发/配额/超限**：每用户配额 + 全局并发上限；超限 `429 quota_exceeded`/`rate_limited`（含 `Retry-After`）；超时/最大请求体返回 OpenAI 兼容错误。
- **日志脱敏**：不记录请求体/响应体/令牌/敏感头。
- **健康探针**：`GET /healthz`（存活）+ `GET /readyz`（检查数据库、配置、上游模型可用性）；进程守护 + 故障告警。



## 7. 使用记录采集与调用关联（主进程租约）

- 端点：`POST /ingest/usage`（鉴权 = access + 有效同意）。
- **关联在主进程完成**：每个 Pi runtime 一个独立代理租约，转发时持 `runtime_id/session_id/active_turn_id`；主进程捕获每个 `X-HCS-Model-Call-Id` 追加到当前 active turn 的集合；上报时填 `model_call_ids[]`（不依赖 Pi 暴露该头）。**无用户轮次的请求**（compaction/summary/无 turn retry）只留可信 `model_proxy_calls` 日志、不建关联。
- 服务端：从令牌解析 `user_id`；忽略客户端提交身份；逐个校验 `model_call_id` 属同一 `user_id` 后写 `turn_model_call_links`（联合主键幂等）。
- **幂等**：`event_id` upsert-once，重复返回 `{accepted:true, deduplicated:true}`。
- 只采集同意后新轮次；历史会话不回传；无有效同意不上报，服务端二次校验（AC7）。



## 8. 受管模式（Pi 锁定 + 禁用非 Pi 入口，D12）

在 Electron **主进程装配运行时的启动边界**强制（非仅 UI）：

- **只用版本锁定原生 Pi，禁用** `customPiPath` **与 WSL**（§5）。
- **Pi 通道**：内存态临时 Provider 指向 §5 回环端口；忽略并覆盖 `~/.pi` 下 `auth.json`/`models.json` 非受管 provider；关闭"添加/迁移/选择其他 Provider"（`providerMigrationService` 路径禁用）。
- **禁用非 Pi 模型入口**：DSH 后端（`CompositeAgentGateway` 只装 pi、阻断 DSH host）、生图 ImageGen、飞书桥、**视觉桥 pi-deck-vision**（不加载扩展、隐藏设置、忽略 `~/.pi/agent/pi-deck-vision.json`）。
- 受管标志由构建期常量 + 启动校验保证，运行期不可改写。
- 验收：受管构建下无任何本地配置/后端/扩展/替换 Pi 可绕过 HCS 调模型。



## 9. 客户端改造点（apps/desktop + packages/coding-agent）

登录门禁（严格在线）、令牌系统安全存储、退出撤销+清本地、注销清全部本地凭证、模型调用改走回环代理（移除内置密钥/直连）、`configure_managed_provider` RPC（packages/coding-agent）、模型目录缓存与 fail-closed、会话上报（P0 进程内有界指数退避重试、失败可见、不保证退出后续传，D18）、知情同意（服务端强制）、临时会话 UI 改名、局域网 Web 锁定（§10）、禁用 DSH/生图/飞书/视觉桥/customPiPath/WSL（§8）。

## 10. 局域网 Web 服务锁闭

受管构建把 `webServiceEnabled` 忽略并锁定为 false，设置项移除；fail-closed：任何回滚不得重开该无鉴权入口。

## 11. 知情同意机制

- 告知文本带 `notice_version`；`GET /auth/notice` 返回当前文本与版本。
- `POST /auth/consent` 记录同意（**同意状态始终由服务端按库实时校验、不写入令牌，故不重签令牌**）。
- 代理调用前实时校验"当前版本已同意且未撤回"，否则 `consent_required`。
- 撤回 `POST /auth/withdraw-consent`：停采集 + 停使用权（重新同意恢复）；旧记录不立即删（D14/§13）。



## 12. API 契约（P0，REST/JSON/HTTPS）


| 方法    | 路径                             | 说明                                 | 鉴权                           |
| ----- | ------------------------------ | ---------------------------------- | ---------------------------- |
| POST  | `/auth/register`               | 自助注册（限流+复杂度）                       | 无                            |
| POST  | `/auth/login`                  | 登录（限流+失败锁定）                        | 无                            |
| POST  | `/auth/refresh`                | 刷新令牌                               | refresh                      |
| POST  | `/auth/logout`                 | 撤销当前会话                             | access                       |
| POST  | `/auth/password-reset/confirm` | 用 admin 签发令牌改密（撤销全部会话）             | reset token                  |
| POST  | `/auth/deactivate`             | 注销账号                               | access                       |
| GET   | `/auth/notice`                 | 当前告知文本/版本                          | 无                            |
| POST  | `/auth/consent`                | 记录同意                               | access                       |
| POST  | `/auth/withdraw-consent`       | 撤回同意                               | access                       |
| GET   | `/proxy/v1/models`             | 受管模型目录（元数据 DTO + 版本）               | access                       |
| POST  | `/proxy/v1/chat/completions`   | 模型代理（流式、工具透传）                      | access + consent             |
| POST  | `/ingest/usage`                | 上报（幂等）                             | access + consent             |
| GET   | `/healthz` / `/readyz`         | 存活 / 就绪（DB·配置·上游）                  | 无                            |
| (CLI) | admin                          | 建首管理员/建号/改角色/删记录/签发重置令牌；P0 不含查询/导出 | 仅 Linux 本机 one-shot CLI（§13） |




## 13. 数据生命周期与管理审计

- **统一保留期限与起算点**：`usage_records` 从 `received_at` 起算；`consents` 的当前有效记录作为准入状态不清理，撤回、告知换版或账号注销时写 `withdrawn_at`/`invalidated_at`，再从该失效时间起按统一期限清理。若产品需要周期性重新同意，须通过新的告知版本显式触发，不得靠定时任务静默删除有效同意。
- **其他表清理**：`model_proxy_calls` 从 `ended_at` 按独立期限清理；`auth_sessions` 从 `COALESCE(revoked_at, expires_at)`、`password_resets` 从 `COALESCE(used_at, expires_at)` 起按安全记录期限清理。HCS 启动及定时任务把超过运行阈值仍为 `in_progress` 的调用结算为 `error`、`error_code=server_interrupted`，避免崩溃留下永久处理中状态。
- **定时清理任务**：按上述期限清理到期记录；任务失败**重试 + 告警**；每次清理以 `actor_type=system` 写 `admin_audit`。
- **删除级联**：`turn_model_call_links` 的两端外键均为 `ON DELETE CASCADE`；删除 `usage_records` 或到期的 `model_proxy_calls` 都只移除关联行，不连带删除另一端主体。`model_proxy_calls`（可信日志）使用独立保留期，不随 usage 自动删。
- **注销用户**：`status=disabled` + 撤销全部会话；其 `usage_records`/`consents` 按统一期限清理；所有带可识别字段的 retention-managed 关联记录清理完成后，`users` 主记录**匿名化**（置 `anonymized_at`、`username` 改为墓碑值、`password_hash` 替换为不可登录的随机墓碑哈希、清除其他可识别字段，保留 id 供审计外键完整性）。
- **P0 管理 CLI 边界**：管理命令是与 HCS 共用服务层的 Linux 本机 one-shot CLI，不开放 TCP/HTTP/Unix Socket 管理端点。数据库/服务配置仅 `root:hydro-hcs` 可读；`sudoers` 只允许 `hydro-admin` OS 组执行固定的 `hydro-hcs admin <子命令>`，禁止任意参数转为 Shell。CLI 仅接受结构化参数，读取由 sudo 设置的原始调用者 UID，记录 `actor_type=os_operator`、`actor_principal=uid:<SUDO_UID>`；无受信 sudo 上下文时拒绝执行（首管理员 seed 除外）。P1 Web 管理操作使用 `actor_type=user` 与 `actor_user_id`；首管理员 seed 和自动任务使用 `actor_type=system`。P0 不提供记录查询/导出。
- **管理审计**：建号/改角色/删记录/签发重置令牌/清理等写 `admin_audit`。`params_summary` 只允许操作类型、过滤条件摘要、记录数量、原因码等白名单字段，禁止正文、密码、令牌、capability、密钥和请求/响应体；`admin_audit` 保留期独立设定且必须不短于 `password_resets` 安全记录期限，仍被重置记录引用的审计行禁止删除（§20）。
- **备份过期**：备份按独立窗口 `T_backup` 加密保存并到期销毁。普通全量备份中单条记录的最坏实际存续期为**主库表保留期限** `T_table` **+ 最大备份窗口** `T_backup`；若治理要求绝对上限 `T_absolute`，必须配置 `T_table + T_backup ≤ T_absolute`。从备份恢复后，必须先执行到期清理并验证完成，再开放查询、导出或模型代理服务。



## 14. 安全与合规实现

- **正文加密（AEAD）**：`user_input`/`assistant_final` 固定使用 **AES-256-GCM**，**密文信封格式** `{ v, key_id, nonce, ciphertext, tag }` 序列化入 `bytea`；密钥经密钥设施注入（不用 pgcrypto、不入 DB 会话）。每次加密使用唯一 96-bit 随机 nonce。
- **AAD 防替换绑定**：附加认证数据固定为 UTF-8 编码的 `JSON.stringify([v,"usage_record",event_id,user_id,field_name])`，其中 `field_name` 为 `user_input|assistant_final`；数组顺序即规范格式，不允许其他序列化。解密时重新构造并校验 AAD，密文被搬到其他记录、用户或字段时必须失败。
- **密钥轮换**：新写入用当前 `key_id`；轮换后旧 `key_id` 保留用于解密历史；支持后台惰性重加密迁移。在确认主库及未过期备份均不再引用旧 `key_id` 前不得销毁旧密钥。
- **密钥不可用 fail-closed**：密钥缺失时，采集写入与读取**安全失败**（拒绝而非明文落库）。
- **静态与传输**：磁盘级加密、备份加密、文件权限最小化；全程 HTTPS 内网 CA；模型密钥与令牌签名密钥经环境变量/密钥设施注入，不入仓库与日志。
- **日志脱敏**：见 §6；自动化"日志不含正文/令牌/capability"检查（§19）。
- **fail-closed**：门禁/受管/Web 锁闭/密钥缺失一律安全失败。
- **数据治理（Intent 硬约束）**：记录访问仅限 admin；P0 CLI 只提供删除，P1 才提供查询/导出。查看/导出需正当目的并写 `admin_audit`。责任人/审批人/数据分类/脱敏为待确认（§20）。



## 15. 错误码（对客户端）

`invalid_request`（字段非法、保留名称、重名等不应归入鉴权失败的请求）、`unauthorized`、`consent_required`、`account_disabled`、`account_locked`、`rate_limited`、`quota_exceeded`、`model_not_allowed`、`upstream_error`、`payload_too_large`、`catalog_unavailable`（目录不可用→fail-closed）、`duplicate_event`（幂等命中，非错误）。RPC 本地错误另含 `managed_protocol_unsupported`、`managed_config_invalid`、`managed_runtime_started`。

## 16. ID 生成与任务类别规则

- `event_id`/`session_id`/`turn_id`：客户端生成 UUIDv4/v7，全局唯一；`event_id` 作幂等键。
- `model_call_id`：服务端生成，响应头回传，主进程租约捕获（§7）。
- `task_category`：取自 HYDRO 任务路由类别（Coding/Hydro/Document/Data/Operations/Knowledge），仅统计维度，不作鉴权。



## 17. 容量与接口指标（结构定稿，数值待容量评估）

并发用户数、日均轮次、单条 `usage_records` 最大体积（超限 `payload_too_large`）、数据库年增长、备份周期与 RPO/RTO、代理转发额外延迟目标、`/ingest/usage` 与 `/auth/*` p95 目标。数值待 §20。

## 18. 需求追踪矩阵（P0 验收 → 设计 → 测试）


| 验收点                                    | 设计落点     | 测试层               |
| -------------------------------------- | -------- | ----------------- |
| AC1 未登录/离线不可调用；伪造身份上报被拒；重复去重           | §4/§6/§7 | 契约+集成+幂等          |
| AC2 未同意当前版本被拒                          | §6/§11   | 集成                |
| AC3 无共享密钥可直调模型                         | §5/§8    | 受管安装包检查           |
| AC4 受管无法切换 Provider（含忽略本机 auth/models） | §8       | 受管+绕过测试           |
| AC5 模型服务拒绝非代理来源                        | §2 ACL   | 部署验证              |
| AC6 日志不含正文/令牌                          | §6/§14   | 日志泄漏扫描            |
| AC7 只采集同意后新轮次、不回传历史                    | §7/§11   | 集成                |
| AC8 令牌撤销/停用及时失效                        | §4 实时 DB | 撤销时延测试            |
| AC9 流式取消上游同步终止                         | §6       | 流式取消+连接释放         |
| AC10 局域网 Web 旁路关闭                      | §10      | 受管安装包检查           |
| AC11 注册限流/重名/异常审计；标注自报                 | §4       | 契约+安全             |
| AC12 P0 分组快照为空正常                       | §3       | 契约                |
| AC13 密钥不明文暴露                           | §14      | 部署审计              |
| AC14 两类记录可信等级可区分                       | §3/§7    | 数据契约              |
| AC15 令牌系统安全存储 + 退出/注销清理                | §5/§9    | 凭证泄漏+清理测试         |
| AC16 P0 有界重试、失败可见、不保证退出后续传             | §9       | 重试/失败提示测试         |
| 追加 DSH/生图/飞书/视觉桥/替换 Pi 绕过被封            | §5/§8    | 绕过测试              |
| 追加 跨用户关联被拒                             | §3/§7    | 跨用户关联测试           |
| 追加 凭证不落 env/auth.json/Shell            | §5       | 凭证泄漏测试            |
| 追加 模型目录 fail-closed                    | §6       | 目录不可用测试           |
| 追加 非白名单模型由 HCS 拒绝                      | §6       | 代理授权+绕过测试         |
| 追加 数据到期清理 + 级联 + 匿名化 + 审计              | §13      | 生命周期测试            |
| 追加 密钥不可用 fail-closed                   | §14      | 密钥缺失测试            |
| 追加 有效同意不误删、崩溃调用可结算                     | §13      | 生命周期+故障恢复测试       |
| 追加 管理 CLI 本机隔离且审计主体可信                  | §13      | sudoers/文件权限+审计测试 |
| 追加 AEAD 密文不可跨记录/字段替换                   | §14      | AAD 篡改测试          |




## 19. 分层测试与发布门禁

- **单元**（apps/server）：令牌签发/校验/撤销、失败锁定、幂等 upsert、同用户关联校验、同意状态机及保留期起算点、清理任务级联、崩溃遗留调用结算、AES-256-GCM 加解密/密钥轮换/AAD 防替换。
- **契约**：全部 §12 端点请求/响应/错误码；`ManagedModel` catalog DTO 与 Pi `Model` 映射；`configure_managed_provider` 请求/响应/版本错误；`/ingest/usage` 需 access+consent。
- **集成**：登录→拉目录→同意→代理→上报→关联全链路；consent_required；撤回停用；令牌撤销时延；有效同意不误删；数据到期清理与匿名化；恢复备份后先清理再开放服务。
- **绕过测试**：受管构建下 DSH/生图/飞书/视觉桥/本机 provider/替换 Pi/WSL 调模型均失败；HCS 拒绝不在当前白名单的 `model`；回环代理只放行 `POST /proxy/v1/chat/completions`，拒 catalog、其他方法、`/auth`、`/ingest`；nonce/capability 随 runtime 失效且不转发 HCS；`configure_managed_provider` 旧版本及运行中替换配置被拒。
- **流式**：取消后上游连接释放、无悬挂 `model_proxy_calls`。
- **fail-closed**：目录不可用、密钥不可用时安全失败、不明文落库。
- **泄漏扫描**：日志、安装包、Pi stdout/RPC 响应和可序列化 `Model` 对象均不含正文/令牌/共享密钥/capability。
- **管理面**：非授权 OS 组、无受信 sudo 上下文或无法读取受控配置时 CLI 不可执行；审计记录原始调用者 UID；审计摘要拒绝敏感字段。
- **发布门禁**：上述全过 + 受管安装包检查 + 内网模型 ACL 部署验证 + 备份有效保留上限核算。



## 20. 待确认与风险

**P0 前必须定（数值/运维/组织）**：令牌访问/刷新 TTL；`usage_records`+失效 `consents` 统一保留期限、`model_proxy_calls`/认证安全记录/`admin_audit` 保留期、备份窗口及 `T_table + T_backup` 实际上限；模型服务 ACL 落地方式；数据治理（责任人/审批人/数据分类/是否脱敏）；容量数值（用户数/日均轮次/最大体积/RPO/RTO）；模型白名单、每个模型的 `ManagedModel` 元数据与兼容参数。
**已定**：栈=Node/TS、位置=monorepo `apps/server`（+`packages/coding-agent` 改造）、DB=PostgreSQL、证书=内网 CA、非 Pi 入口（含视觉桥）+customPiPath+WSL=受管禁用、Pi=版本锁定原生、撤销=实时 DB、正文加密=AES-256-GCM 信封+AAD、密码重置=P0 admin 辅助、同意=不写令牌按库校验、模型白名单=HCS 每请求强制、P0 管理面=Linux 本机 one-shot CLI+sudoers 且不含查询/导出。
**风险**：受管绕过面广（Pi 配置面 + DSH + 生图 + 飞书 + 视觉桥 + customPiPath/WSL + 本机 `~/.pi`），须穷尽封堵并以绕过测试回归；代理为单点（P0 存活/守护/告警，HA 属 P2）；"一机一账号"为 P0 已知风险（D13）；admin 辅助重置依赖管理员在场。

## 21. 分期实现边界

- **P0**：§2–§19（分组表 P1 才建、快照恒空；管理 CLI 不提供记录查询/导出）。
- **P1**：分组分配/统计（去重口径+类型维度）、Web 管理界面、用户自查、（如引入）自助密码重置。
- **P2**：加密持久化 Outbox 补传、按账号隔离本地目录、macOS 构建/签名、指标看板/容量趋势/备份恢复演练/高级监控、（如需）非 Pi 模型通道经 HCS 纳管。
