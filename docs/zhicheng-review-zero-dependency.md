# 职称评审审查 - 零依赖方案

## ✅ 完成状态

所有 Python 脚本已重写为 **Node.js/TypeScript** 版本，应用零外部依赖运行。

## 📁 文件结构

```
.pi/skills/zhicheng-review/
├── package.json              ← npm 依赖（csv-parser, pdf-parse, axios）
├── scripts/
│   ├── download_from_oss.cjs ← Phase 0: 下载 PDF 附件
│   ├── phase1_review.cjs     ← Phase 1: 逐人审查（19 项检查）
│   └── phase2_ledger.cjs     ← Phase 2: 生成总台账
├── rules/
│   └── zhicheng_rules.yaml   ← 审核规则库
├── materials/                ← 下载的 PDF（按身份证分组）
├── reports/                  ← 审查报告（_review.md + _issues.md）
├── manifest.csv              ← Phase 0 下载清单
├── manifest.failed.csv       ← 下载失败项
└── ledger.csv                ← Phase 2 总台账
```

## 🚀 使用方式

### 方式一：桌面 UI（推荐）

1. 启动应用后，点击左侧边栏的 **"职称审查"** 按钮
2. 四步引导式工作流：
   - **Step 1**：上传 CSV 清单
   - **Step 2**：下载附件（进度条显示）
   - **Step 3**：审查材料（可批量/单独审查）
   - **Step 4**：查看结果（筛选/搜索/导出）

### 方式二：命令行

```bash
cd D:\Github\hydroZagent\.pi\skills\zhicheng-review

# Phase 0: 下载
node scripts/download_from_oss.cjs 申报清单.csv --out materials --workers 8

# Phase 1: 审查
node scripts/phase1_review.cjs manifest.csv --persons all
# 或审查某人
node scripts/phase1_review.cjs manifest.csv --person-id 430101199001011234

# Phase 2: 台账
node scripts/phase2_ledger.cjs --reports-dir reports --out ledger.csv
```

## 📦 依赖说明

### npm 依赖（自动安装）

应用打包时会自动包含以下依赖：
- `csv-parser` - CSV 文件解析
- `pdf-parse` - PDF 文本提取
- `axios` - HTTP 下载

这些依赖已添加到 `apps/desktop/package.json`，`npm install` 时会自动安装。

### 零外部依赖

- ✅ **不需要 Python**
- ✅ **不需要 pip 安装任何包**
- ✅ **不需要 Node.js 全局安装**
- ✅ **应用自带所有运行时**

## 🧪 测试验证

所有脚本已通过端到端测试：

```bash
# 测试下载脚本
node scripts/download_from_oss.cjs test.csv --dry-run

# 测试审查脚本
node scripts/phase1_review.cjs manifest.csv --person-id <ID>

# 测试台账脚本
node scripts/phase2_ledger.cjs --reports-dir reports --out ledger.csv
```

测试结果显示：
- ✅ 下载脚本：CSV 解析、URL 自动检测、去重、dry-run 正常
- ✅ 审查脚本：19 项检查、报告生成、疑点清单正常
- ✅ 台账脚本：数据汇总、CSV 导出、统计正常

## 📊 审查流程

```
CSV 清单 → download_from_oss.cjs → materials/
                                      ↓
                              manifest.csv
                                      ↓
phase1_review.cjs → reports/<身份证>_review.md
                         <身份证>_issues.md
                                      ↓
phase2_ledger.cjs → ledger.csv
```

## 🎯 关键功能

1. **PDF 分类**：基于关键词自动分类（资格证书/聘任文件/学信网报告等 10+ 类别）
2. **19 项检查**：齐全性、阈值、一致性、专业相关
3. **审查报告**：Markdown 格式，含汇总表、疑点清单、审查说明
4. **台账汇总**：按状态分类（齐全/缺件/待核实/超限/部分审查）
5. **进度追踪**：progress.json 实时更新

## ⚡ 性能

- 600 人 × 20 PDF = 12,000 文件下载（约 2-4 小时）
- 12,000 PDF 审查（约 4-8 小时）
- 建议使用 `--workers 8-12` 并行下载

## 🔧 故障排除

### 问题：Module not found: csv-parser

**解决**：运行 `npm install` 确保依赖已安装

### 问题：PDF 解析失败

**解决**：PDF 可能是扫描件，系统会标记为"待核实"

### 问题：审查超时

**解决**：增加 timeout 参数或分批审查（`--person-id <ID>`）

## 📝 下一步

- [ ] 添加 WebSocket 实时进度推送
- [ ] 添加人员详情页（点击某人查看审查报告）
- [ ] 添加导出功能（导出报告为 PDF/Word）
- [ ] 添加批量重试功能（对失败的审查项重试）