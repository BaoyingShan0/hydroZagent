# 内网多用户与使用记录：收尾验收证据

> 更新日期：2026-09-07（Asia/Singapore）。本轮结果替换 2026-09-01 的测试数字。
> **工程验收：未通过，等待 Linux 全仓必跑测试零失败证据。S11 发布验收：未批准。**
> 已提供本地 Windows 测试制品及受管链路实测证据；不得将测试包、测试证书或已编写的 CI 当作生产批准。

## 1. 版本、环境与边界

- 基线 HEAD：`ab1aaf46f2e94b0db796e3ae6a479ecc761f4ebd`；本轮改动未提交、未推送、未发布。工作区文件身份见 `.artifacts/hcs-acceptance/source-manifest.json`。
- 基线记录：`.artifacts/hcs-acceptance/baseline-head.txt`、`baseline-status.txt`。原有 AGENTS/HYDRO/README/packages/SDLC 索引及未跟踪品牌材料、旧配置文件均保留。
- 本机 Windows 10 19045 / x64；Node 25.3.0、PowerShell、npm 11.19.0（Git Bash 隔离测试使用 npm 11.6.2）；Bun 1.3.14；Electron 43.4.0；独立 PostgreSQL 17.11，仅监听 `127.0.0.1:55432`。
- 自动化使用假账号、假正文、假模型服务和临时 schema；不调用真实付费或内网模型。`test.sh` 清空继承凭证，并将 HOME、USERPROFILE、临时项目放到真实用户目录以外。
- HCS v1 与受管 RPC 契约保持不变；没有增加生产绕过开关。P1 分组、管理页、查询导出不在本轮范围。

## 2. 已完成的修复

1. 修复 convergence 测试回调类型与错误流处理；浏览器端规范哈希改用既有纯 JavaScript SHA-256 实现，并以 Node SHA-256 校验中文、异常代理字符和长文本的相同性。
2. 通过原生成入口修复 Cloudflare Gateway / Workers AI 模型目录合并及目录漂移；同步 provider 类型、过时模型测试和 OAuth 固定夹具。锁文件经原生成入口更新。
3. 修复桌面全量测试的旧 UI 契约、历史分页、WSL 路径、模块加载和未释放异步等待。没有降低断言或新增跳过来换取通过。
4. 真实 PostgreSQL 暴露并修复 SQL 保留字 CTE 名称、时间参数类型推断。真实 HTTP 链路暴露并修复 Fastify 默认类型强制转换导致合法 `assistant_final: null` 被拒绝的问题；新增 4 项线路层验证。
5. 修复 Windows 受管打包入口的模块格式、npm 子进程调用、ASAR 读取路径；补入 Pi 原构建入口生成的版本元数据、主题和 WASM。制品独立放入 `release/managed`，扫描核对当前 Pi 构建哈希。
6. 修复 Windows 外部编辑器参数解析、显示路径及测试夹具中的路径、命令引号、平台模拟和文件 URL。Windows coding-agent 测试并发限制为 4，保留原测试超时；最终全量中启动测试通过。
7. 增加真实 Electron safeStorage 跨进程测试、真实打包应用 → 随包 Pi → 回环代理 → HTTPS HCS → 假模型 → PostgreSQL 验收；新增测试 PKI 和独立 PostgreSQL 启动设施。
8. 实测修复 PostgreSQL 启动进程继承输出管道导致脚本挂起的问题：只等待 pg_ctl 本身退出，数据库进程使用独立输出文件。CI 每条原生命令检查退出码，并保存测试报告、扫描报告与校验值。

## 3. 本轮自动化结果

日志均位于仓库 `.artifacts/hcs-acceptance/`。开始时间、耗时和逐测试结果以原始日志及 `acceptance-summary.json` 为准。

| 检查 | 本轮结果 | 日志 / 报告 |
| --- | --- | --- |
| 根 `npm run check` | 通过；格式、精确依赖、导入、锁文件、根类型与浏览器 smoke 全通过 | `root-check-final.log` |
| `node scripts/check-hcs-contracts.mjs` | 通过，无生成漂移 | `contracts-final.log` |
| 根脚本契约集合 | 9 通过 / 0 失败 / 0 跳过 | `isolated-test-final.log` |
| HCS `npm --prefix apps/server run check` | 通过 | `hcs-typecheck-final.log` |
| HCS 单元 / HTTP 线路层 | 18 文件，63 通过 / 0 失败 / 0 跳过 | `hcs-full-final.log` |
| PostgreSQL 全部集成 | 3 文件，5 通过 / 0 失败 / 0 跳过 | `postgres-integration-final.log` |
| 显式集成缺少数据库配置 | 按预期非零退出；不再整组跳过后报成功 | `postgres-missing-config.log` |
| 新测试库启动脚本（已下载且校验的 17.11 二进制） | 实际启动成功并完成 5 项集成 | `postgres-bootstrap.log` |
| Desktop 类型 | 通过 | `desktop-typecheck-final.log` |
| Desktop 全量 | 3063 通过 / 0 失败 / 2 跳过 | `desktop-full-final.log` |
| Windows 真实 safeStorage 与编译信任边界 | 2 通过 / 0 失败 / 0 跳过 | `windows-native-tests.log` |
| 真实打包 Windows 全链路 | 1 个完整端到端场景通过，0 跳过 | `windows-chain.log` |
| NSIS / ZIP 构建、扫描 | 通过；独立目录、固定 HTTPS origin/CA、受管入口和 Pi 资源哈希核对 | `managed-package-final.log`、`artifact-scan.log` |
| NSIS 内嵌归档与 ZIP 完整性 | 通过；从两个分发文件提取的 6 个运行资源哈希均匹配已测应用 | `archive-integrity.json` |
| Linux 部署资产静态门禁及逐脚本语法 | 通过；不代表 Linux 实机部署通过 | `deploy-static.log`、`deployment-syntax.log` |
| 隔离全仓 `bash ./test.sh` | **失败，退出码 1**；详见下表，未把超时或失败当成通过 | `isolated-test-final.log`、`remaining-failures.txt` |
| 远程 CI | **待取得**，没有提交或推送触发远程执行 | `.github/workflows/ci.yml` 仅为门禁实现 |

全仓 Vitest 结果：

| 工作区 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| agent | 461 | 6 | 0 |
| ai | 903 | 0 | 843 |
| client | 32 | 0 | 4 |
| coding-agent | 1936 | 11 | 47 |
| evals | 23 | 0 | 0 |
| protocol | 147 | 0 | 0 |
| server（Pi Unix transport，非 HCS） | 19 | 31 | 0 |
| telemetry | 15 | 0 | 0 |
| sqlite-node | 87 | 0 | 0 |
| TUI（Node test） | 911 | 3 | 0 |

TUI 的 Node 测试结果单独保存在 `tui-tests.tap`，其汇总并入 `acceptance-summary.json`。全仓失败保留为工程门禁阻断：6 项 agent 符号链接、11 项 coding-agent 符号链接/POSIX 权限、31 项 Pi Unix transport，以及 TUI 的符号链接用例。不能从 Windows 失败推断 Linux 已通过。本机没有 WSL Linux 发行版或 Docker；Linux 原生全量结果必须实际取得。

跳过项逐项列表见 `skipped-tests.json`：AI 的需要真实凭证/外部服务或原本禁用的用例、client/coding-agent 的原有可选及平台用例，保留原条件。本轮不为验收新增跳过。桌面两个跳过分别为 `gitCommitFileDiff.integration.test.mjs` 的符号链接内容读取和 `skillManager.test.mjs` 的根 Markdown 技能文件符号链接测试；受管核心集合、数据库和 Windows 实测没有跳过。

## 4. 真实数据库与 Windows 链路证明

PostgreSQL 临时 schema 验证注册/登录、同意前拒绝、同意后目录、服务端私有模型与密钥、加密上报及调用关联、撤回、注销和保留清理后匿名化。补充反例覆盖混合本用户/跨用户调用关联整笔回滚，重复事件冲突不覆盖正文与关联，有效但较旧的同意不误删。迁移测试验证两端删除只级联关联表，重复 up 幂等，以及测试库 down/up。

真实 Windows 场景验证：

- `app.isPackaged=true`；运行时环境变量与设置不能修改受管模式、HCS origin/CA、外部 Pi 和其他模型入口。未登录没有可调用目录。
- 随包 Pi 实际产生流式普通回复、一次 read 工具调用、临时会话和取消；四条加密记录的模型调用关联数为 `[1, 2, 1, 1]`，取消记录为 `aborted`，临时会话带匿名标记，P0 分组为空。
- 撤回后新调用拒绝；活动流式输出期间撤回会停止本地运行并断开上游连接。
- 上报 503 恰好执行 4 次尝试，触发一次失败提示。通知通过测试设施在进程内观察，避免向 Windows 通知中心放置可点击假会话。
- 重启并扫描历史后记录仍为四条，不回放历史或丢失的内存待报事件；目录过期和错误服务器证书均阻断调用。
- 真实 Windows safeStorage 由三个独立 Electron 进程保存、读取和清除；磁盘无假凭证明文，注销删除凭证。加密不可用等反例保留模拟测试。

TLS 测试仅在测试进程内将 `hcs.test.internal` 解析至回环地址；没有关闭证书校验、安装系统 CA 或修改 hosts。测试 PKI 私钥及数据库文件位于忽略目录，不纳入报告或交付材料。

## 5. Windows 测试交付

目录：`apps/desktop/release/managed/`。客户端版本 `0.1.0-hydro`，随包 Pi `0.84.2`。测试 origin 固定为 `https://hcs.test.internal:28787`。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `hydroZagent-managed-0.1.0-hydro-setup.exe` | 168801803 | `1a573db59a7e314ae2ff6b9a2962fd14c6c60f09428de344ebb5d069dad4f7e4` |
| `hydroZagent-managed-0.1.0-hydro-win.zip` | 645284012 | `779ab212eadd0de08bbd8bedcae31af98719ae3bac421a26d1d7720bf4a4d286` |

其他文件：`SHA256SUMS.txt`、`managed-artifact-report.json`；自动化与链路材料见 `.artifacts/hcs-acceptance/`。Pi SHA-256：`b5efd7126c76e79605a204e1a7d19a0907d183d68c1dd608eb87d7d9ae0188a7`。

这是未签名测试包，不是可连接生产的安装包。测试 CA 有效期为 2026-09-07 03:44:36 UTC 至 2026-09-09 03:44:36 UTC；到期后必须重新生成测试 PKI 并重新构建，不得关闭校验继续使用。扫描是资源/信任/身份检查，未冒充杀软或正式签名验证。ZIP 为减少本地封装等待使用 store 压缩，NSIS 仍包含压缩载荷。Windows 安装、升级、卸载及系统关联的实机验收尚待执行。

## 6. 复现入口

从仓库根目录执行。多条 PowerShell 原生命令之间必须检查 `$LASTEXITCODE`；完整顺序见 CI 的 Windows job。

1. 运行根检查、契约、HCS/桌面类型与测试；全仓使用 `bash ./test.sh` 隔离执行。
2. `node apps/desktop/scripts/create-managed-test-pki.cjs <新临时目录>` 生成短期假服务证书；设置测试 origin、CA 和 PKI 目录，不能使用生产私钥。
3. `./scripts/start-hcs-test-postgres.ps1` 下载并校验固定 PostgreSQL 17.11，或用 `-BinaryRoot` 指定已校验二进制；脚本拒绝复用已有测试 cluster。执行 `npm --prefix apps/server run test:integration`。
4. `CSC_IDENTITY_AUTO_DISCOVERY=false`、测试 HCS/CA 参数下执行 `npm run desktop:dist:managed`；Bun 编译工具在本机需放到 ASCII 路径，生成资源仍走 `copy-binary-assets` 原入口。
5. `node --test apps/desktop/tests/windows/buildManifest.test.cjs apps/desktop/tests/windows/safeStorage.test.cjs`。
6. 设置 `HCS_TEST_DESKTOP_EXE` 为独立 `win-unpacked` 内的测试可执行文件；在 `apps/server` 执行 `node node_modules/vitest/vitest.mjs run --config vitest.windows.config.ts`。
7. `npm --prefix apps/desktop run check:managed-artifact`；保留测试日志、扫描 JSON、SHA-256 和运行资源身份。重封装前关闭测试应用并清除本轮旧包缓存，避免旧 ZIP/NSIS 被复用。
8. 用测试 PostgreSQL 的 `pg_ctl -D .artifacts/hcs-postgres-test/data -m fast -w stop` 停止本轮服务。原始日志和逐项跳过清单留档，私钥不随证据分发。

## 7. 未关闭门禁及生产待办

| 待办 | 所需输入 | 执行角色 | 通过标准 |
| --- | --- | --- | --- |
| 工程：Linux 原生全仓回归 | 本轮代码与锁文件、Linux runner、隔离测试环境 | 开发 / CI 维护者 | 根检查、隔离全量零失败；全部跳过有逐项说明，受管核心不跳过；保存日志与源码身份 |
| 工程：远程 CI 结果 | 可执行本轮代码的远程构建版本 | CI 维护者 | 三个 job 实际成功；不能用 workflow 文件代替运行证据 |
| Linux 实机部署 | 已审批 HTTPS origin/CA、digest 镜像、主机和变更窗口 | 运维 / 系统负责人 | readyz、迁移、非 root、只读容器、密钥权限和数据库不外露实测通过 |
| 双向模型 ACL | 模型 endpoint、HCS 与非 HCS 探针身份、网络规则 | 网络 / 安全负责人 | HCS→模型允许；非 HCS→模型拒绝；保存两端探针和规则证据 |
| 静态加密、加密备份与恢复 | 加密存储方案、密钥引用、age recipient、保留期、RPO/RTO | DBA / 运维 / 数据负责人 | 无明文备份；隔离恢复校验、迁移、到期清理与完整性通过；恢复时间满足目标 |
| Windows 安装/升级/回滚 | 审批后的签名版本、上一受管版本、目标机器清单 | 桌面测试 / 发布负责人 | 安装、升级、卸载、回滚和协议关联符合预期；DPAPI/登录/随包 Pi 实机通过；保存签名/杀软结果 |
| 生产参数与审批 | TTL、限流配额、目录映射、容量、保留期限、责任人及变更单 | 数据 / 系统 / 安全 / 发布负责人 | `production-approval-template.md` 无待填写项，引用证据完整并签字 |

**工程验收未通过前，本轮制品仅作为待验收测试候选物。S11 持续未批准；本轮未部署生产、未填写未确认生产值、未批准正式发布。**
