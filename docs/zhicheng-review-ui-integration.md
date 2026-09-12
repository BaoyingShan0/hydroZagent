# 职称评审材料审查 UI 集成文档

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        App.tsx                              │
│  ┌─────────────┐  ┌──────────────────────────────────────┐  │
│  │   Sidebar   │  │            Main Content              │  │
│  │             │  │                                      │  │
│  │  [导航按钮]  │  │  ┌────────────────────────────────┐  │  │
│  │             │  │  │  ZhichengReviewPage             │  │  │
│  │  Extensions │  │  │  ┌──────────────────────────┐  │  │  │
│  │  Skills     │  │  │  │ Step 1: 上传清单         │  │  │  │
│  │  Experts    │  │  │  ├──────────────────────────┤  │  │  │
│  │  职称审查 ◄─┼──┼─┼─┼─▶ │ Step 2: 下载附件         │  │  │  │
│  │             │  │  │  ├──────────────────────────┤  │  │  │
│  │             │  │  │  │ Step 3: 审查材料         │  │  │  │
│  │             │  │  │  ├──────────────────────────┤  │  │  │
│  │             │  │  │  │ Step 4: 查看结果         │  │  │  │
│  └─────────────┘  │  └──────────────────────────┘  │  │  │
│                    └────────────────────────────────┘  │  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    IPC Layer                                │
│  zhichengCheckStatus, uploadCsv, download, review, ledger  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  zhichengIpc.ts                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Python Scripts                                      │  │
│  │  - download_from_oss.py                              │  │
│  │  - phase1_review.py                                  │  │
│  │  - phase2_ledger.py                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 文件清单

### 前端组件

| 文件 | 说明 |
|---|---|
| `apps/desktop/src/renderer/src/components/pages/ZhichengReviewPage.tsx` | 主页面组件（4 步引导式工作流） |
| `apps/desktop/src/renderer/src/components/zhicheng-review/ZhichengReviewPanel.tsx` | 可复用面板组件（备用） |
| `apps/desktop/src/renderer/src/components/sidebar/SidebarContent.tsx` | 添加了"职称审查"导航按钮 |
| `apps/desktop/src/renderer/src/App.tsx` | 添加了 zhicheng 页面路由 |

### 后端 IPC

| 文件 | 说明 |
|---|---|
| `apps/desktop/src/shared/ipc.ts` | 添加了 6 个 IPC channel |
| `apps/desktop/src/main/ipc/zhichengIpc.ts` | IPC handler，执行 Python 脚本 |
| `apps/desktop/src/main/index.ts` | 注册 zhichengIpc |

### 前端 API

| 文件 | 说明 |
|---|---|
| `apps/desktop/src/preload/index.ts` | 暴露 zhicheng API 给渲染进程 |

### Python 脚本

| 文件 | 说明 |
|---|---|
| `.pi/skills/zhicheng-review/scripts/download_from_oss.py` | Phase 0：下载 PDF |
| `.pi/skills/zhicheng-review/scripts/phase1_review.py` | Phase 1：逐人审查 |
| `.pi/skills/zhicheng-review/scripts/phase2_ledger.py` | Phase 2：生成台账 |

## 用户操作流程

### 步骤 1：上传清单

1. 用户点击侧边栏 **"职称审查"** 按钮
2. 进入第一步页面，点击 **"选择 CSV 文件"**
3. 系统自动读取 CSV 文件，上传到主进程
4. 状态切换到第二步

### 步骤 2：下载附件

1. 用户点击 **"开始下载"**
2. 调用 `download_from_oss.py`，从 OSS 下载 PDF
3. 显示进度条
4. 下载完成后自动切换到第三步

### 步骤 3：审查材料

1. 显示所有人员列表
2. 用户可以：
   - 点击 **"开始审查"** 批量审查所有人
   - 点击某人的 **"审查"** 按钮单独审查
3. 显示审查进度和结果
4. 完成后自动切换到第四步

### 步骤 4：查看结果

1. 显示统计卡片（总人数/齐全/有疑点）
2. 支持：
   - 按状态筛选（齐全/缺件/待核实/超限/部分审查）
   - 按姓名/身份证搜索
3. 点击 **"生成台账"** 生成 ledger.csv
4. 表格展示每个人的审核结果

## API 端点

### IPC Channels

```typescript
{
  zhichengCheckStatus: "zhicheng:check-status",
  zhichengUploadCsv: "zhicheng:upload-csv",
  zhichengDownload: "zhicheng:download",
  zhichengReview: "zhicheng:review",
  zhichengLedger: "zhicheng:ledger",
  zhichengStatusChanged: "zhicheng:status-changed",
}
```

### Frontend API

```typescript
window.desktopApi.zhicheng = {
  checkStatus: () => Promise<any>,
  uploadCsv: (data: { path: string; name: string; content: string }) => Promise<any>,
  download: (options: { csvPath: string; workers?: number }) => Promise<any>,
  review: (options: { persons?: string[] }) => Promise<any>,
  ledger: () => Promise<any>,
  onStatusChanged: (callback: (status: any) => void) => () => void,
};
```

## 启动方式

### 方式一：通过侧边栏导航

1. 启动桌面应用
2. 点击左侧边栏的 **"职称审查"** 按钮
3. 开始使用

### 方式二：通过命令

在聊天中输入：

```
/zhicheng-review status
```

Agent 会调用 extension 注册的 `zhicheng_status` 工具。

### 方式三：通过命令行

```bash
cd D:\Github\hydroZagent\.pi\skills\zhicheng-review

# Phase 0: 下载
python scripts/download_from_oss.py 申报清单.csv --out materials --workers 12

# Phase 1: 审查
python scripts/phase1_review.py manifest.csv --persons all

# Phase 2: 台账
python scripts/phase2_ledger.py --reports-dir reports --out ledger.csv
```

## 数据流

```
CSV 文件 → 主进程 → .pi/skills/zhicheng-review/
                                        ├── manifest.csv (下载清单)
                                        ├── materials/<身份证>/ (PDF)
                                        └── reports/<身份证>_review.md (审查报告)
                                        └── ledger.csv (总台账)
```

## 注意事项

1. **Python 环境**：确保已安装 Python 3.8+ 和以下依赖：
   ```bash
   pip install PyMuPDF openai pyyaml
   ```

2. **HEKOU_LAB 环境变量**：设置内部 LLM 的 API Key：
   ```bash
   export HEKOU_LAB="your-api-key"
   ```

3. **OSS 访问**：确保申报清单 CSV 中的 OSS 链接可访问

4. **性能**：
   - 600 人 × 20 PDF = 12,000 文件下载（预计 2-4 小时）
   - 12,000 PDF 审查（预计 4-8 小时，取决于 PDF 大小和 LLM 响应速度）
   - 建议使用 `--workers 8-12` 并行下载

## 下一步

- [ ] 添加 i18n 支持（中文标签）
- [ ] 添加进度推送（WebSocket 或 polling）
- [ ] 添加人员详情页（点击某人查看审查报告）
- [ ] 添加导出功能（导出报告为 PDF/Word）
- [ ] 添加批量重试功能（对失败的审查项重试）