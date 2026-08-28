# 代码检索工作流

## 原则：先索引，后扫描

**错误做法：** `find ... | xargs grep` 暴力全文扫描（大项目里极慢，本次花了 ~13 分钟）
**正确做法：** 按优先级使用以下工具

### 1. 结构化索引（最快）

```
symbol_search(query)      # 按标识符/关键词找文件，BM25 排名
project_report()          # 项目级概览：入口点、hub 文件、目录结构
module_report(path)       # 单文件结构：符号列表、依赖关系
read_symbol(path, symbol) # 读具体符号正文
```

### 2. 本地 grep（中等）

```bash
# 限定目录和文件类型，不要全量扫描
grep -rl "关键词" --include="*.tsx" apps/desktop/src/
rg "关键词" apps/desktop/src/  # 如果装了 ripgrep 更快
```

### 3. AST 搜索（精确 + 快）

```
activate ast_grep_search
ast_grep_search(pattern, lang: "typescript")
```

### 4. 暴力扫描（最后手段）

```bash
find ... | xargs grep  # 只在以上全部无效时启用
```

## 避免的陷阱

- **不要派 agent 做简单搜索** — `grep -rl "关键词" --include="*.tsx"` 一行就能搞定，不需要派 Explore agent
- **`symbol_search` 索引未就绪时** — 会返回 available:false，直接切换到 grep，不要重试
- **不要并行多个搜索** — 先试最快的，不行再试下一个
- **限定搜索范围** — 始终指定目录（如 `apps/desktop/src/`），不要从项目根目录扫

## 典型场景速查

| 场景 | 工具 |
| ------ | ------ |
| 找含某字符串的组件文件 | `grep -rl "字符串" --include="*.tsx" 目录/` |
| 找某功能相关代码 | `symbol_search(query: "功能描述")` |
| 了解项目结构 | `project_report()` |
| 查看某文件有哪些符号 | `module_report(path)` |
| 找函数定义/调用 | `ast_grep_search(pattern)` |
| 找组件的 UI 文本 | `grep -rl "UI文本" --include="*.tsx" 目录/` |
