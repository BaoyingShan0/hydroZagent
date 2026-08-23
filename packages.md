# 项目打包清单（Extensions & Skills）

本文件记录 `community-hydroagent` 项目级 `.pi/settings.json` 中分发的 pi 包（extensions + skills），供水利工程师 clone 后"打开即用"。工程师信任项目后，pi 启动时自动按 `.pi/settings.json` 安装缺失包：npm 包装进 `.pi/npm/`，git 包克隆进 `.pi/git/`（两者均被 gitignore，不入库；只有 `.pi/settings.json` 入库）。

统计：**32 个包**（31 npm + 1 git），提供约 **64 个 skills**。

---

## Extensions（28 个包）

按水利工作场景分组。

### 水利数据 / 知识核心

| 包 | 价值 |
|---|---|
| `npm:pi-mcp-adapter` | MCP 适配器，把内网水情/雨情 API 封装成 MCP server 接入 |
| `npm:context-mode` | FTS5 知识库（存规程规范）+ 沙箱代码执行（水文计算脚本） |
| `npm:pi-web-access` | Web 搜索 + PDF 抽取 + GitHub 克隆 |
| `npm:pi-memory` | 跨会话长期记忆（工程师偏好、常用站点、调度规则） |
| `npm:pi-hermes-memory` | 更重的记忆系统（SQLite FTS5 + 自动整合），与 `pi-memory` 二选一用 |
| `npm:pi-mega-compact` | 长会话上下文压缩（水文大数据量必备） |

### 任务 / 计划 / 自主

| 包 | 价值 |
|---|---|
| `npm:@narumitw/pi-goal` | 单目标自主完成（如"汇总某流域今日水情"） |
| `npm:@tintinweb/pi-subagents` | 多子 agent（数据查询 + 报告撰写并行） |
| `npm:@narumitw/pi-plan-mode` | 只读计划模式（调度方案先规划再执行） |
| `npm:@mjasnikovs/pi-task` | 确定性任务流水线（带 verify/enforce 门禁） |
| `npm:@plannotator/pi-extension` | 计划评审标注 |
| `npm:pi-background-tasks` | 后台长任务（水文模型长时间计算不阻塞交互） |
| `npm:@juicesharp/rpiv-todo` | 防汛值班任务清单（live overlay，扛 /reload 与压缩） |
| `npm:@juicesharp/rpiv-ask-user-question` | 关键决策时结构化澄清（如"哪个调度方案"） |
| `npm:@juicesharp/rpiv-btw` | 主流程中插问侧边问题 |
| `npm:@companion-ai/feynman` | 研究型 agent / 文献综述（水利科研/论文场景） |

### 代码 / 工程

| 包 | 价值 |
|---|---|
| `npm:pi-lens` | 实时代码反馈（LSP/lint/格式化/结构分析） |
| `npm:@narumitw/pi-lsp` | 语言服务工具 |
| `npm:pi-simplify` | 代码简化评审 |
| `npm:@vigolium/piolium` | 安全审计（多阶段、子 agent） |
| `npm:@dietrichgebert/ponytail` | "少写代码"模式 |
| `npm:@7n/rules` | 规则 lint |
| `npm:@parke.dev/pi-github` | GitHub PR/issue/review/checks |
| `npm:@ff-labs/pi-fff` | 模糊文件/内容搜索（在大量数据文件、规程文档里定位） |
| `npm:@gotgenes/pi-permission-system` | 权限系统（内网多用户、分级操作） |

### TUI / 输入

| 包 | 价值 |
|---|---|
| `npm:@narumitw/pi-statusline` | 信息状态栏（显示当前流域/站点/响应等级等） |
| `npm:@juicesharp/rpiv-voice` | 本地离线语音听写（sherpa-onnx Whisper，防汛值班/现场巡查） |
| `npm:@tangle-network/tcloud-agent` | 沙箱 agent 运行时 |

---

## Skills（4 个来源，约 64 个 skill）

### `git:github.com/anthropics/skills`（Anthropic 官方，20 个）

最关键，填补 Word/Excel/PPT 缺口。含：

| Skill | 水利场景 |
|---|---|
| `docx` | 创建/编辑/读取 Word（水情简报、调度方案、防洪预案） |
| `xlsx` | 创建/编辑/读取 Excel（水文数据表、蓄水率统计、雨量数据） |
| `pdf` | PDF 读取/合并/拆分/表单填写/OCR（规程规范 PDF） |
| `pptx` | PPT 创建编辑（汇报材料） |
| `doc-coauthoring` | 文档协同撰写 |
| `mcp-builder` | 构建 MCP server（封装内网水情 API） |
| `skill-creator` | 创建自定义 skill（后续建水利专业 skill 用） |
| `webapp-testing` | Web 应用测试 |

其余：academy-guide、algorithmic-art、brand-guidelines、canvas-design、claude-api、discernment-nudge、frontend-design、internal-comms、slack-gif-creator、theme-factory、web-artifacts-builder。

### `npm:mitsupi`（pi 作者 Armin 合集，18 个）

extensions + skills + prompts + themes 一包多能。Skills 含：commit、mermaid（流程图）、summarize、google-workspace、github、update-changelog、frontend-design、librarian、native-web-search、pi-share、sentry、tmux、uv、web-browser、openscad、ghidra、apple-mail、oebb-scotty、anachb（后三个为 macOS 专属，Windows/内网用不上但不影响）。

### `npm:@howaboua/pi-skills`（11 个开发流程 skill）

skill-creator、gh-issue-pr-flow、agents-md、chrome-cdp、project-reference-research、anti-ai-copy、agent-native-hardening、adversarial-qa、codex-prompt-caching、gh-stack、model-facing-api-design。

### `npm:pi-skill-glab`（1 个）

GitLab CLI skill，适配很多单位内网用 GitLab 管理规程/代码的场景。

### 附：已装 extension 包自带的 skills

| 来源包 | Skills |
|---|---|
| `context-mode` | context-mode、ctx-doctor、ctx-index、ctx-insight、ctx-purge、ctx-search、ctx-stats、ctx-upgrade |
| `pi-lens` | pi-lens-ast-grep、pi-lens-lsp-navigation、pi-lens-write-ast-grep-rule、pi-lens-write-tree-sitter-rule |
| `pi-mcp-adapter` | mcp-scripting |

---

## 提醒

1. **Anthropic skills 依赖 Python 环境**：`docx` 用 Node `docx` npm 包；`xlsx` 用 `openpyxl`/`pandas`；`pdf` 用 Python 库 + `pandoc`。工程师机器需装 Python + Node，内网部署文档里要写明。Anthropic skills 的 license 标注 `Proprietary`（见仓库 LICENSE.txt），商用前需确认条款。

2. **mitsupi 含 macOS 专属 skill**（apple-mail、oebb-scotty、anachb），Windows/内网环境用不上，pi 按需加载，不影响。

3. **仍需自建的水利专业 skill**：水文计算（调洪演算、单位线、洪水预报模型、频率计算）、专业图表（水位过程线、雨量等值线、水库水位-库容曲线）、GIS/地图（流域图、站点分布、台风路径）、水利规程知识库（国标行标检索问答，配合 context-mode 的 FTS5）。这些 pi 生态没有，是产品差异化所在，后续可用刚装的 `skill-creator` 在 `.pi/skills/` 自建。

---

## 维护说明

- 增删包：`pi install <source> -l --approve` / `pi remove <source> -l`（在项目根执行，`-l` 写项目设置）
- 启用/禁用具体资源：`pi config -l`（按包过滤 extensions/skills/prompts/themes）
- 包文件不入库（`.pi/npm/.gitignore` 与 `.pi/git/.gitignore` 均 `*`），仅 `.pi/settings.json` 入库
- 同步上游 pi core：`git fetch upstream` 后按需 rebase/merge，注意 `.pi/settings.json` 是本项目自定义、合并冲突时保留本项目版本
