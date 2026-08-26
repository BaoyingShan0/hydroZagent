# Composer TipTap 对照计划

> 目标：用 TipTap 替换会话 Composer 的自研 `contentEditable`（`RichInput`），在 **零发信契约破坏** 的前提下做稳芯片/IME/粘贴，并分期加入输入区数学预览与 mermaid 图框。  
> 非目标：不替换草稿本 Textarea、不替换右侧 CodeMirror、不把 TipTap JSON 当持久化草稿。

**状态：** 进行中  
**范围：** 仅桌面端 Composer（`WebComposer` 暂不动）  
**原则：** 草稿真相永远是纯字符串；TipTap 只是编辑器实现。

---

## 1. 为什么换

| 现状 | 问题 |
|------|------|
| `RichInput` 手写 contentEditable | chip 同步、光标、IME、粘贴易回归（如 `&` 误芯片） |
| 输入区无数学/图预览 | 公式只能发出去后在时间线看；要边写边看只能继续堆 DOM |
| 草稿本已有 Streamdown 预览 | 那是另一套产品面，不能拿来当 Composer |

TipTap（ProseMirror）用原子节点表达 `@`/`/`/`&`，比裸 DOM 装饰稳；数学/mermaid 也可做成节点预览。

---

## 2. 硬契约（合并门禁）

1. **`sessionDraftByIdAtom` 仍是 string**；禁止 TipTap JSON 持久化。
2. **发信管线不变**：session-ref resolve → template expand → plan → images → queue/steer。
3. **Chip 文本形态不变**：`@path` / `@"spaced path"` / `/cmd` / `&name`；与 `detectTrigger` / `parseRichInputChips` 规则对齐。
4. **IME 安全**：composition 期间不因 Enter 误发送；`composerBehavior` 快捷键策略保持。
5. **粘贴优先级**：剪贴板路径 → 文件项 → 图片 → 纯文本。
6. **数学/图语法与时间线一致**：`$…$` / `$$…$$`、\`\`\`mermaid；发出去仍是源码字符串。
7. **KaTeX / Mermaid 复用现有依赖**（`katex`、`@streamdown/math` / mermaid 链路），禁止再引第二套引擎。

---

## 3. 明确不做

- 粗体/斜体/标题工具栏、表格编辑、协作光标
- 整篇 Markdown WYSIWYG（输入框变成预览页）
- 用 TipTap 替换 CodeMirror / ScratchPad
- 内联附图双轨存储（图框 P2 默认只做 mermaid 源码+预览；粘贴图继续走现有 attachment bar）
- Web 端 Composer 同期改造

---

## 4. 能力对照表（Parity）

### P0 — 等价替换（必须全绿才删旧实现）

| ID | 能力 | 旧实现 | TipTap 要求 | 验收 |
|----|------|--------|-------------|------|
| C01 | 多行纯文本 + `\n` | RichInput | Document + Paragraph + HardBreak | 往返测 |
| C02 | placeholder / disabled | RichInput | 同等 | 手工 |
| C03 | Enter 发送 vs 换行（三档设置） | controller + behavior | 不吞 IME；快捷键同旧 | 手工+测 |
| C04 | IME composition 锁 | RichInput | 同等 | 手工中文 |
| C05 | `@` 文件 chip + 白名单 | parseRichInputChips | Mention 节点 kind=file | 单测+冒烟 |
| C06 | `/` 命令 chip + 白名单 | 同上 | kind=skill | 单测 |
| C07 | `&` 会话 chip；`&&`/URL/`cmd&x` 不成 chip | detectTrigger + 解析 | **修误判一并验收** | 单测 |
| C08 | 建议列表 ↑↓ Enter Esc + 坐标锚点 | PromptSuggestions | 桥接 caret coords | 冒烟 |
| C09 | 应用建议 / Esc 清空触发符 | controller | 同等 | 冒烟 |
| C10 | chip 点击开文件 / session modal | onChipClick | NodeView click | 冒烟 |
| C11 | 拖文件树 → `@ref` | onDrop | 同等事件出口 | 已有测 |
| C12 | 粘贴路径 / 图 / 纯文本 | controller + RichInput | 同等 | 冒烟 |
| C13 | 纸夹 attach → 插入 `@path` | attachFile | 同等 | 冒烟 |
| C14 | draft / caret / 拒绝发送回填 | atoms + caretRef | 同等 props 契约 | 冒烟 |
| C15 | bang `!`/`!!`、plan、steer、队列 | Composer 壳 | **不改语义** | 回归 |
| C16 | `getRichInputCaretCoords` 等导出 | RichInput.tsx | 新模块提供兼容导出或适配 | typecheck |
| C17 | 用户气泡 chip 展示 | SurfaceComponents + parse | **共用同一 parse 模块** | 视觉一致 |

### P1 — 输入区数学预览

| ID | 能力 | 要求 | 验收 |
|----|------|------|------|
| M01 | `$…$` / `$$…$$` 预览 | KaTeX node view；失败显示源码 | 与时间线对照 |
| M02 | 发出仍为源码 | serialize 不含 HTML | 单测 |
| M03 | 公式内不误触发 `@`/`/`/`&` | 解析顺序/节点边界 | 单测 |

### P2 — 图框（默认 A：mermaid）

| ID | 能力 | 要求 | 验收 |
|----|------|------|------|
| D01 | \`\`\`mermaid 围栏预览 | 可折叠回源码；懒加载 | 与时间线对照 |
| D02 | 失败态 | 显示错误，不崩编辑器 | 手工 |
| D03 | 发出仍为围栏源码 | serialize | 单测 |

> 内联附图节点（方案 B）**不做**，除非产品另开需求。

### P3 — 收尾

| ID | 工作 |
|----|------|
| X01 | 删除 RichInput contentEditable 实现与死 CSS |
| X02 | 旧 RichInput 相关 source 测试迁到新模块 |
| X03 | README/内部注释一行：Composer 支持的 MD 子集 |

---

## 5. 目标架构

```
components/session/composer/
  index.ts                     ← 对外出口（类型 / chips / TipTapComposer / caret）
  types.ts                     ← ComposerEditorProps（与实现解耦）
  chips.ts                     ← 纯函数：parse / format（时间线共用）
  caretCoords.ts               ← controller 用的光标坐标（不暴露 TipTap）
  TipTapComposer.tsx           ← 薄视图壳
  useTipTapComposerEditor.ts   ← 编辑器生命周期 / 受控同步
  tiptap/
    createComposerExtensions.ts
    buildComposerEditorProps.ts
    mentionChip.ts
    plainTextCodec.ts          ← string ↔ doc
    caretBridge.ts             ← TipTap 内部 pos 映射 + 实例注册
```

**依赖方向（硬性）：**

```
controller / ComposerArea
        ↓
  composer/types + chips + caretCoords + TipTapComposer
        ↓
  useTipTapComposerEditor → tiptap/*
```

- `RichInput`（旧实现）可依赖 `chips/types`，**禁止** TipTap 或 controller 依赖 RichInput。
- 草稿真相仍是 string；chip 仅为装饰。

---

## 6. 依赖

| 包 | 用途 |
|----|------|
| `@tiptap/react` / `@tiptap/core` / `@tiptap/pm` | 编辑器 |
| `@tiptap/starter-kit` | **裁剪**：只要 document/paragraph/hard-break/history；关掉 bold/heading/list 等 |
| 已有 `katex` | P1 数学 |
| 已有 streamdown mermaid 链路 | P2 预览复用，禁止第二套 |

React 19：使用 TipTap 3.x（已支持 React 19）。Electron 内 `immediatelyRender: false` 按 TipTap 文档处理。

---

## 7. 测试与验证

### 必写/必迁单测

- `parseRichInputChips` / `&` 误判回归（`&&`、URL 内、`cmd&x`）
- `string ↔ doc` 往返：多行、尾换行、仅 chip、chip 夹文本、空串
- `formatFilePathRef` 仍被 fileNodeDrag / FileDiff 使用（既有测保持绿）

### 手工冒烟（P0）

- 中文 IME + Enter 发送/换行三档  
- `@` `/` `&` 建议与点击  
- 拖文件树、粘贴图、发送带 session-ref  
- 切换会话 draft 恢复  

### 门禁命令

```bash
npm run typecheck
npm test
```

---

## 8. 分期与合并建议

| 阶段 | 产出 | PR 建议 |
|------|------|---------|
| P0a | 抽出 chips + 计划文档 | 可先合，零行为变 |
| P0b | TipTapComposer 等价切换 | 独立 PR，对照本表 C01–C17 |
| P1 | 数学预览 | 独立 PR |
| P2 | mermaid 图框 | 独立 PR |
| P3 | 删旧实现 | 独立小 PR |

每个 PR 描述附带本表勾选；禁止「半吊子切过去但芯片规则分叉」。

---

## 9. 风险

| 风险 | 对策 |
|------|------|
| 往返丢空白 | 往返单测锁死 |
| 建议菜单坐标漂移 | caretCoords 对 ProseMirror coordsAtPos |
| 包体增大 | starter-kit 裁剪；math/mermaid 按阶段加 |
| Controller 膨胀 | 编辑器只换实现，建议/发信逻辑不动 |
| 双实现长期分叉 | P0 绿后尽快删 RichInput 编辑路径 |

---

## 10. 当前进度

- [x] 对照计划落盘（本文）
- [x] P0a：抽出 `composer/chips.ts` + `&` 白名单误判修复
- [x] P0b：TipTap 依赖 + TipTapComposer + ComposerArea 切换（首版）
- [ ] P0 验收勾选 C01–C17（手工冒烟 + 门禁）
- [ ] P1 / P2 / P3
- [ ] 删除旧 RichInput contentEditable 路径（P0 验收通过后）
