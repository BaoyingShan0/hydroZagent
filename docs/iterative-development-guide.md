# 浙水智能体：边使用边开发指南

## 核心结论

日常使用和迭代不需要先发布版本。开发阶段直接运行桌面开发版即可正常使用浙水智能体、发现问题并修改代码。

只有需要交给其他用户、验证安装包行为或建立稳定里程碑时，才需要构建发行包或发布 GitHub Release。

## 首次准备

在 `community-hydroagent` 仓库根目录执行：

```bash
npm install --ignore-scripts
npm run desktop:install
npm run desktop:prepare
```

这些命令分别安装 Agent 核心依赖、安装桌面端依赖与 Electron 运行时，并构建桌面端需要的本地 Agent 运行时。`desktop:install` 继续禁止普通依赖执行生命周期脚本，只额外运行 Electron 官方安装程序；直接使用 `--ignore-scripts` 安装桌面端会缺少 `electron.exe`。

## 日常启动

在仓库根目录执行：

```bash
npm run desktop:dev
```

开发模式下，桌面端优先使用当前仓库中 `packages/coding-agent` 构建出的 Agent CLI，不依赖电脑上另外安装的全局 `pi`。

## 不同修改的生效方式

| 修改内容 | 如何生效 |
|---|---|
| React 页面、样式、普通前端组件 | 通常自动热更新 |
| Electron 主进程或 preload | 开发服务通常会重启应用；异常时手动重启 `desktop:dev` |
| `packages/coding-agent` 或其他 Agent 核心包 | 重新运行 `npm run desktop:prepare`，再启动桌面端 |
| `apps/desktop/package.json` 依赖 | 重新运行 `npm run desktop:install` |
| 根工作区依赖 | 重新运行 `npm install --ignore-scripts` |

## 推荐迭代循环

1. 从仓库根目录执行 `npm run desktop:dev`。
2. 在真实水利工作场景中使用桌面端和局域网 Web 服务。
3. 记录可复现的问题、期望行为和必要截图。
4. 新建短生命周期 Git 分支并修改代码。
5. 根据修改范围执行专项测试。
6. 通过检查后做一个小粒度提交。
7. 继续使用开发版验证修复，不必等待正式发布。

常用检查命令：

```bash
npm run check             # Agent 核心：格式、依赖、类型和浏览器冒烟检查
npm run desktop:check     # 桌面端 TypeScript 检查
npm run desktop:test      # 桌面端测试
```

## 什么时候需要构建发行包

以下情况应生成完整桌面发行物：

- 需要像普通软件一样通过安装包使用。
- 需要提供给其他用户或水利业务人员测试。
- 需要验证安装、卸载、升级、协议链接和应用数据目录。
- 需要确认 Agent 运行时已正确内置，不依赖开发环境。

在仓库根目录执行：

```bash
npm run desktop:dist
```

该命令先构建当前仓库的 Agent 可执行文件，再生成包含它的 Electron 发行包。不要直接在 `apps/desktop` 内运行 `dist` 作为正式交付流程，否则不能保证包含本仓库的 Agent 运行时。

本地生成安装包不等于发布版本。安装包可以仅供本机或小范围测试，不需要创建 GitHub Release。

## 什么时候需要正式发布版本

建议满足以下条件后再发布 `0.1.0-alpha` 等测试版本：

- 启动、配置模型、新建会话和连续对话等主流程稳定。
- 局域网 Web 服务经过真实设备验证。
- 安装包可以在一台没有开发环境的电脑上独立运行。
- 已明确当前版本的已知问题和升级方式。
- 希望团队或外部测试者获得同一个可追踪版本。

可以按以下层级逐步推进：

1. `desktop:dev`：个人高频使用与快速修改。
2. `desktop:dist`：本地安装包与小范围验收。
3. GitHub 预发布版本：多人测试和里程碑留档。
4. 稳定版本：面向正式用户交付。

## 使用中的问题记录建议

每个问题至少记录：

- 使用场景和目标。
- 可重复的操作步骤。
- 实际结果与期望结果。
- 错误提示、日志或截图。
- 问题发生在桌面端、Agent 核心还是局域网 Web。

这样可以把真实使用反馈直接转化为可验证的小任务，形成“使用—发现—修改—验证—继续使用”的稳定迭代节奏。

Q: 浙水智能体打包分享给用户时，要不要内置 or 标明 npm版本


A:打包分享给普通用户时，建议“不内置 npm，也不要求用户安装 npm”。
最终安装包应该自包含：
Electron 运行时
浙水智能体桌面端
packages/coding-agent 构建出的独立 Agent 可执行文件
默认 Skills、Extensions 和水利资源
局域网 Web 服务
用户只需安装并启动“浙水智能体”，不应看到 Node/npm 环境配置。
npm 版本只需要在开发和构建文档中固定，例如：
{
  "engines": {
    "node": ">=22.19.0",
    "npm": ">=11.10.0 <12"
  },
  "packageManager": "npm@11.19.0"
}
推荐分层：
场景	npm 处理
普通用户安装包	不内置、不要求安装、不展示
开发者源码运行	明确 Node 与 npm 版本
CI/正式打包	固定使用 npm 11.19.0
“关于”页面	展示应用、Agent、Electron 版本；无需展示 npm
用户动态安装 npm 扩展	尽量改成内置扩展或受控安装机制，避免依赖系统 npm

目前 npm run desktop:dist 的设计方向就是将独立 Agent 运行时打入安装包。正式交付前应在一台没有 Node/npm 的干净 Windows 电脑上验证：
能启动桌面端。
能创建和运行 Agent 会话。
能使用内网 Web。
不会提示安装 Pi、Node 或 npm。
默认 Skills/Extensions 可以正常加载。
结论：npm 是开发工具，不应成为浙水智能体普通用户的运行依赖。

Q:ommunity-hydroagent 这个项目，我想一边使用，在使用时发现问题，再修改，如此迭代。在使用时，是否需要先发布为一个版本？


A： 不需要先发布版本。你现在最适合采用“开发版常用、发现问题即修改”的迭代方式。
首次准备：
cd community-hydroagent
npm install --ignore-scripts
npm --prefix apps/desktop install --ignore-scripts
npm run desktop:prepare
日常使用：
npm run desktop:dev
这种模式下：
可以正常使用浙水智能体桌面端和局域网 Web 服务。
修改前端界面通常会热更新。
修改 Electron 主进程后，应用会自动重启。
修改 packages/coding-agent 后，需要重新执行 npm run desktop:prepare。
发现问题后建议新建分支、修复、验证并做小粒度提交。
只有以下情况才需要生成版本：
想像普通软件一样从安装包启动。
需要发给其他用户测试。
需要验证安装、升级、内置 Agent 运行时等发布行为。
本地生成完整安装包可以执行：
npm run desktop:dist
它会把当前仓库的 Agent 运行时与桌面端一起构建，但不等于发布 GitHub Release。建议先持续使用开发版，等核心流程稳定后再发布 0.1.0-alpha 测试版本。
