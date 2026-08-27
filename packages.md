# 项目打包清单（Extensions & Skills）

本文件记录 `hydroZagent` 项目级 `.pi/settings.json` 中分发的 pi 包（extensions + skills），供水利工程师 clone 后"打开即用"。工程师信任项目后，pi 启动时自动按 `.pi/settings.json` 安装缺失包：npm 包装进 `.pi/npm/`，git 包克隆进 `.pi/git/`（两者均被 gitignore，不入库；只有 `.pi/settings.json` 入库）。

统计：**32 个包**（31 npm + 1 git），提供约 **64 个 skills**；另含项目内置（不入 packages、直接入库）的 `dev-conventions`/`doc-convert`/`fortran`/`data-workflow` 四个 skill 与 `/qa`/`/doc`/`/code`/`/data` 四个 prompt，见下文[开发质量规范](#开发质量规范跨语言)、[文档处理](#文档处理办公软件操作与互转)与[代码与数据处理](#代码与数据处理fortranpythonvue-与科学数据)三节。

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

## 文档处理（办公软件操作与互转）

水利工作者日常要处理 Word/Excel/PPT/PDF 的操作与相互转换。本仓库用三层叠加解决，前三层已就绪：

| 层 | 资源 | 位置 | 作用 |
|---|---|---|---|
| ① 深度创建/编辑/读取单个格式 | anthropics `docx`/`xlsx`/`pptx`/`pdf`/`doc-coauthoring` skills | `git:anthropics/skills`（已在 settings.json） | 格式化、公式、幻灯片、追踪修订、表单、OCR |
| ② 任意格式互转 + PDF 页操作 | `doc-convert` skill | `.pi/skills/doc-convert/`（入库） | 一棵决策树选引擎（LibreOffice/pandoc/markitdown/poppler/pypdf）；`scripts/convert.py` 路由器一句搞定 docx↔pdf、xlsx↔csv、pdf↔txt、pptx↔pdf、md↔docx、doc→docx、xls→xlsx、ppt→pptx，以及 merge/split/rotate PDF |
| ③ 快速入口 | `/doc` slash prompt | `.pi/prompts/doc.md`（入库） | `/doc 把简报.docx 转成 pdf`，端到端含校验 |
| ④ 工具链自检与一键安装 | `doctor.py` + `install/install.{sh,ps1}` | `.pi/skills/doc-convert/`（入库） | 检测 pandoc/LibreOffice/poppler/qpdf/python&npm 库 + CJK 字体；缺什么打印该 OS 的安装命令。**这是让 ①② 真正能跑的关键**——anthropics skills 假设这些已装，但新机一律没有 |

用法：

```bash
python .pi/skills/doc-convert/scripts/doctor.py          # 自检工具链
python .pi/skills/doc-convert/scripts/doctor.py --fix     # 打印本机安装命令
bash     .pi/skills/doc-convert/install/install.sh        # macOS/Linux 一键装
powershell -ExecutionPolicy Bypass -File .pi/skills/doc-convert/install/install.ps1   # Windows
python .pi/skills/doc-convert/scripts/convert.py 简报.docx -t pdf     # 互转
```

设计取舍：

- **不默认加 MCP 办公服务器**（如 `markitdown-mcp`、`office-word/excel/powerpoint-mcp-server`）。它们底层仍需同一套工具链，且多为 Windows + MS Office 专属，不适合作为跨平台内网分发默认。若某办公室已装 MS Office 且想要原生自动化，可后续用 `pi-mcp-adapter` 按需接入，并在 `.pi/settings.json` 加包。
- **PDF 是终结格式**：PDF→docx/xlsx/pptx 一律有损（只能抽文字/表格再重建），`doc-convert` 会明示，不假装无损往返。
- **CJK 字体**：中文文档转 PDF 必须有中文字体，否则 LibreOffice 渲染成豆腐块。`doctor.py` 会查中文字体（本机检测到 `msyh.ttc` 微软雅黑）。

## 代码与数据处理（Fortran/Python/Vue 与科学数据）

水利工程师的代码与数据工作横跨三种语言、三类数据形状：遗留 **Fortran** 模型、**Python** 分析/ML 管线、**Vue/TS** 监测看板；时间序列（水位/雨量/流量）、网格数据（NetCDF/HDF5：ERA5/GFS/再分析）、地理空间（shapefile/DEM）。本仓库用四层叠加解决：

| 层 | 资源 | 位置 | 作用 |
|---|---|---|---|
| ① Python/Vue 代码 LSP+lint+format | pi-lens extension | `npm:pi-lens`（已装） | Python（ruff/vulture）、Vue/JS/TS（biome/prettier/eslint/Volar）、读保护。**覆盖不到 Fortran**（ast-grep 无 Fortran 语法） |
| ② 遗留 Fortran | `fortran` skill | `.pi/skills/fortran/`（入库） | 固定格式 F77 列敏感读取规则（列 6 续行）、自由格式 F90+、gfortran/ifx、make/cmake/meson、fortls/fprettify、**f2py 与 Python 互操作**（内存序/kind/intent 陷阱）、迁移策略。附 `scripts/doctor.py`（工具链自检）与 `scripts/build_f2py_example.sh`（可跑的 f2py 范例：Manning 流量公式） |
| ③ 科学数据工作流 | `data-workflow` skill | `.pi/skills/data-workflow/`（入库） | load→validate→analyze→visualize 全链路；**水文物理合理性校验**（流量≥0、雨量在范围、水位在量程、突变检测——标记不删，防洪评价要查）、重采样规则（雨量求和/水位均值/洪峰取大）、水文标准图表（过程线/雨量柱状/历时曲线/水位-流量关系）；**皮尔逊III型频率分析（SL 44 国标）**、模型评价指标 NSE/KGE。附 `scripts/doctor.py`、`scripts/validate_timeseries.py`、`scripts/pearson3_freq.py` |
| ④ 快速入口 | `/code`、`/data` slash prompt | `.pi/prompts/`（入库） | `/code 把 fort 模型包成 python 可调` 按语言选工作流；`/data 清洗 2023 水位.csv 算频率` 走数据链路 |

用法：

```bash
python .pi/skills/fortran/scripts/doctor.py                       # Fortran 工具链自检
python .pi/skills/data-workflow/scripts/doctor.py                  # 科学 Python 自检（core/grid/geo/hydro 分层）
python .pi/skills/data-workflow/scripts/validate_timeseries.py station.csv --time tm --q q --report station.report.txt   # 水文数据校验
python .pi/skills/data-workflow/scripts/pearson3_freq.py amax.csv --value q --periods 10 20 50 100 200 --plot freq.png    # SL 44 频率分析
bash   .pi/skills/fortran/scripts/build_f2py_example.sh            # 跑通 f2py 范例（需 gfortran + meson/MSVC）
```

设计取舍：

- **不加新的 npm extension**。pi 生态没有覆盖 Fortran 或科学数据处理的 extension：pi-lens 管代码质量但无 Fortran 语法树；anthropics skills 是办公文档不是数据；mitsupi 是工具类。所以这两个能力以入库 skill 形式自建，跟 `doc-convert` 同模式。
- **Fortran 不靠 LSP，靠编译器 + 基线对照**。遗留 Fortran 模型没有测试套件，唯一安全网是「改前存一份已知输出，改后逐位比对」。`fortran` skill 明确要求先抓基线再改逻辑。pi-lens 对 Fortran 诚实地说「不覆盖」，不假装能 lint。
- **皮尔逊III型是国标，scipy 没有**。SL 44《水利水电工程设计洪水计算规范》指定 P-III 型做设计洪水/水位频率计算，而 `scipy.stats` 不含 P-III（只有 `pearson3` 且参数化不同、可靠性存疑）。`pearson3_freq.py` 用 `α=4/Cs²`、`scale=Cs²/4` 的 gamma 变换实现，已对照标准 φ 表验证（Cs=2、p=1%→φ≈3.605；Cs=2 下界 φ≥−1；教材算例 Ex=1000/Cv=0.5/Cs=2、T=100→2802.5）。国际对比用 Gumbel（`--method gumbel`）。
- **环境策略分两套**：纯 Python 库（numpy/pandas/scipy/matplotlib）用 `uv`（快）；带原生依赖的（netCDF4/h5py/geopandas/rasterio，需 HDF5/GDAL/proj）在 Windows 上 pip 编译常失败，用 `conda`/`pixi`。`doctor.py` 按层报告并打印对应安装命令。
- **水文数据校验≠通用清洗**。通用 `dropna()` 会掩盖传感器故障。`validate_timeseries.py` 把物理不可能值（负流量、超量程水位）**标记不删**，写报告说明每类多少个、怎么处理——防洪评价审查要问。短缺口（≤3 步）可插值，长缺口留 NaN 并注明原因，绝不盲目填充。

## 开发质量规范（跨语言）

水利工程师的代码与数据工作横跨多种语言——遗留 Fortran 模型、Python/R 分析、MATLAB 遗产、C/C++ HPC 内核、Shell 管线、SQL、Vue 看板，偶有 Julia/Go/Rust/Java。这些工作没有一个统一的“开发质量总纲”：上游 `AGENTS.md` 是 pi 自身的 TS/Node 规范（vitest、`npm run check`、`packages/*`），对本 fork 的水利开发场景不适用甚至会误导（agent 会以为本仓库有 `npm run check` 可跑）。

本仓库的处理：**上游 `AGENTS.md` 原样保留**（为合并上游少冲突），水利项目的开发质量规范全部放在 `.pi/` 下，以入库 skill + slash prompt 形式承载：

| 层 | 资源 | 位置 | 作用 |
|---|---|---|---|
| ① 跨语言质量总纲 | `dev-conventions` skill | `.pi/skills/dev-conventions/`（入库） | 一条原则：每次改动须产出**可验证、可复现、物理合理**的结果。覆盖 8 项纪律：开工前定验收标准、遗留代码先抓基线、各语言工具表（12 种语言）、完成前自检 7 项、可复现性（防洪评价要查）、数据纪律、依赖与环境、提交规范、文档同步。这是总纲，语言/任务细则见 `fortran`/`data-workflow`/`doc-convert` |
| ② 完成前自检入口 | `/qa` slash prompt | `.pi/prompts/qa.md`（入库） | `/qa <文件或任务>` 自动跑 7 项自检（验收标准/lint/test 或基线/输出人工看/物理合理性/可复现/文档同步），诚实报告，有 blocker 不假装完成。不自动提交 |
| ③ 已装的被动质量层 | pi-lens extension | `npm:pi-lens` | Python（ruff/vulture）与 Vue/JS/TS（biome/prettier/eslint/Volar）自动 lint+format+读保护。**仅覆盖这两种生态**，其余语言靠 `dev-conventions` 工具表手动跑 |

用法：

```bash
# 写代码/改代码前：读 dev-conventions skill（agent 自动按需加载）
# 完成前自检：
/qa                                                # 检查本 session 改动
/qa src/forecast.py                                # 检查指定文件
/qa "调洪演算模块重构"                              # 检查一个任务范围
```

设计取舍：

- **借鉴现有 skill**：`dev-conventions` 借鉴 `skill-creator` 的 agent 友好写法（解释 why 而非堆砌 MUST、progressive disclosure、description 触发词 pushy）、`@7n/rules` 的规则优先级（冲突时专项 skill 优先于总纲）、`mitsupi/commit` 的 Conventional Commits 格式、`mitsupi/uv` 的可复现性模式。不重造轮子。
- **语言覆盖广，不绑死三种**。工具表列 12 种语言（Fortran/Python/R/MATLAB/C/C++/Julia/Shell/SQL/Vue-TS/Go/Rust/Java）各自的 format/lint/test/build，并标注哪些 pi-lens 已自动覆盖。原则是语言无关的（可验证/可复现/物理合理），新增语言照套。
- **“测试优先”泛化为“验收标准优先”**。水利代码多无测试套件（遗留 Fortran、notebook 脚本），生搬 TDD 不现实。`dev-conventions` §1 把“done 的判据”分四级（自动测试 > 已知输出基线 > 手算/规范期望值 > 必须成立的性质），按工作性质取最强可用者。遗留模型强制 §2 基线对照——这是唯一安全网。
- **上游 AGENTS.md 不动**。它是 pi core 的 TS/Node 规范（vitest、锁步发布、`models.generated.ts`），对本 fork 误导但保留可少合并冲突。`dev-conventions` §9 明确告诉 agent：本仓库实际开发纪律看 `.pi/` 下的本 skill 与 `/qa`，不看根 AGENTS.md 的命令段。
- **诚实标签优先**。`/qa` 要求如实报告“3/7，缺这三项”而非假装“全绿”。pi-lens 的 partial/unconfirmed 标签照原样转述，不洗成 clean——防洪评价审查要的是真。

## 提醒

1. **三组 skill 都依赖工具链，新机一律缺**：(a) 文档处理——`docx` 用 Node `docx` npm 包；`xlsx` 用 `openpyxl`/`pandas`；`pdf` 用 `pypdf`/`pdfplumber` + `pandoc`；互转还需 LibreOffice（`soffice`）、Poppler。(b) Fortran——需 `gfortran`、`make`、`f2py`（+ `meson`/`ninja` 或 MSVC 才能跑 f2py 的 C 包装）。(c) 科学数据——`numpy`/`pandas`/`scipy` 多数机器有，但 `netCDF4`/`h5py`/`geopandas`/`rasterio` 带 HDF5/GDAL 原生依赖，Windows 上 pip 编译常失败，要用 `conda`/`pixi`。**各自先跑 doctor 自检**：
   ```bash
   python .pi/skills/doc-convert/scripts/doctor.py
   python .pi/skills/fortran/scripts/doctor.py
   python .pi/skills/data-workflow/scripts/doctor.py
   ```
   缺什么按打印的命令装（doc-convert 还可一键跑 `install/install.{sh,ps1}`）。内网部署文档里写明这一步。Anthropic skills 的 license 标注 `Proprietary`（见仓库 LICENSE.txt），商用前需确认条款；三个自建 skill 均为 MIT。

2. **mitsupi 含 macOS 专属 skill**（apple-mail、oebb-scotty、anachb），Windows/内网环境用不上，pi 按需加载，不影响。

3. **仍需自建的水利专业 skill**：水文计算中的调洪演算、单位线、洪水预报模型（**频率计算已由 `data-workflow` 的 `pearson3_freq.py` 覆盖，SL 44 国标**）、专业图表（雨量等值线、水库水位-库容曲线、台风路径）、GIS/地图（流域图、站点分布）、水利规程知识库（国标行标检索问答，配合 context-mode 的 FTS5）。这些 pi 生态没有，是产品差异化所在，后续可用已装的 `skill-creator` 在 `.pi/skills/` 自建。

---

## 维护说明

- 增删包：`pi install <source> -l --approve` / `pi remove <source> -l`（在项目根执行，`-l` 写项目设置）
- 启用/禁用具体资源：`pi config -l`（按包过滤 extensions/skills/prompts/themes）
- 包文件不入库（`.pi/npm/.gitignore` 与 `.pi/git/.gitignore` 均 `*`），仅 `.pi/settings.json` 入库
- 同步上游 pi core：`git fetch upstream` 后按需 rebase/merge，注意 `.pi/settings.json` 是本项目自定义、合并冲突时保留本项目版本
