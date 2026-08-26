# 浙水智能体产品架构

## 目标

用户获得的是一个“浙水智能体”产品，而不是需要分别安装和理解 Agent CLI、PiDeck 与 Web 服务的多个工程。

## 运行关系

```text
桌面工作台 apps/desktop
  ├─ 本地会话与项目管理
  ├─ 局域网 Web 服务
  └─ RPC 子进程
       └─ packages/coding-agent
            ├─ packages/agent
            ├─ packages/ai
            └─ packages/protocol
```

开发时，根目录的 `scripts/dev-desktop.mjs` 将 `HYDROZAGENT_PI_CLI_PATH` 指向当前仓库构建出的 CLI。桌面端 `PiLocator` 优先使用该路径，避免误连机器上版本不同的全局 `pi`。

正式分发时，根命令 `npm run desktop:dist` 先为当前平台生成独立 Agent 可执行文件，再由 Electron Builder 将其复制到 `resources/pi-runtime`。桌面端在打包环境中优先寻找该内置运行时。

## 目录约束

- `packages/*` 属于 Agent 核心 npm 工作区，遵循根 TypeScript、Biome 和锁版本策略。
- `apps/desktop` 是完整 Electron 应用，保留独立 `package-lock.json`、TypeScript 配置和测试体系。
- 两者位于同一仓库，但不共享 `node_modules`，避免 Electron 原生依赖污染核心工作区。
- 水利业务能力应优先沉淀为 Agent skills、extensions 或领域服务；桌面端负责交互呈现与本地编排。

## 发布边界

完整用户发行物必须通过根目录 `desktop:dist` 生成。直接在 `apps/desktop` 内执行 `dist` 不保证包含本仓库 Agent 运行时，仅适用于桌面壳调试。
