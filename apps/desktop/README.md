# 浙水智能体桌面端

这是 `community-hydroagent` 的 Electron 用户入口，负责项目与会话管理、水利品牌界面和局域网 Web 共享。

桌面端必须与仓库根目录的 Agent 核心一起开发和发布。统一的安装、启动、检查和发行命令见[仓库主说明](../../README.md)，运行关系见[产品架构](../../docs/product-architecture.md)。

## 组件边界

- Agent 执行能力来自 `../../packages/coding-agent`。
- 开发启动由根脚本注入本地 Agent CLI 路径。
- 正式发行版内置当前仓库构建的 Agent 可执行文件。
- 局域网 Web 服务仍由桌面主进程托管，是产品核心能力。

本组件 fork 自 [PiDeck](https://github.com/ayuayue/PiDeck)，沿用 MIT 许可与原贡献者署名。
