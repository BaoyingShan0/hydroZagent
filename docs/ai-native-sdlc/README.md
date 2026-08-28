# AI 原生 SDLC —— 本仓库的落地约定

参考原文：[The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)（中文翻译见工作区顶层 `../../../AI原生SDLC实战手册-中文翻译.md`）。

这份文档不复述手册内容，只回答一件事：**手册的六个阶段，在这个仓库里分别落在哪个文件、哪条规则、哪个命令上**。目的是让"AI 原生开发"从一次性讨论变成可以被每次会话自动加载、可以被下一个人（或下一个 agent session）直接复用的具体约定，而不是停留在概念层面。

`harness-convergence/` 是第一个真实案例（2026-08-28，Agent Harness 运行收敛功能），本文档的模板和约定都是从它反推出来的，不是凭空设计。

## 六阶段 → 本仓库实现

| 阶段 | 手册要求 | 本仓库实现 | 状态 |
|---|---|---|---|
| 1. 规划 | 想法 → `intent.md` | `docs/ai-native-sdlc/<slug>/intent.md`（模板：`_template/intent.md`），`/intent` prompt 辅助生成 | ✅ 本次补齐 |
| 2. 设计 | 需求 → 设计文档 | `docs/ai-native-sdlc/<slug>/spec.md`，同目录，引用 `intent.md` 作为输入 | ✅ 已有先例（`harness-convergence/spec.md`），暂无专属模板/prompt |
| 3. 构建 | CLAUDE.md、Skills、Hook 护栏、plan mode | `HYDRO.md`（业务约束，自动加载）+ `.pi/skills/dev-conventions` 等入库 skill + `.pi/prompts/` plays + `@narumitw/pi-plan-mode` | ✅ 已完备 |
| 4. 测试 | 反馈闭环、CI 跑评测 | `/qa` pre-done checklist + `packages/evals` 评测框架 | ⚠️ evals 未接入 CI（`ci.yml` 只跑 build-check-test） |
| 5. 部署 | AI 进 PR 审查闭环、审批关卡 hook | `.github/workflows/pr-gate.yml` / `issue-gate.yml` / `approve-contributor.yml` | ✅ 已完备 |
| 6. 维护 | 定期扫描、闭合循环 | `issue-analysis.yml` / `issue-triage-labels.yml` / `/cl` changelog 审计 | ⚠️ 无定期代码库扫描任务 |

⚠️ 项标记的是已知缺口，不是本次改动范围；留在这里是为了下次有精力时能直接从这张表接着做，不用重新盘点一遍。

## 什么任务值得写 intent，什么不用

不是每个任务都要走这套流程——手册本身强调"重量匹配工作量"。满足以下任一条件时才写 `intent.md`：

- 影响范围跨多个 package/模块，或涉及现有行为的破坏性变更
- 需求本身模糊，需要先对齐"要解决的问题是什么"，而不是直接扎进实现
- 预计工作量超过半天，或是会被长期维护、后人需要理解决策原因的架构改动

日常 bug 修复、小功能、脚本任务不需要这套仪式，直接用 `/code`、`/data`、`/doc` 或 plan mode。

## 文件位置与生命周期

```
docs/ai-native-sdlc/
  _template/intent.md      # 模板，不会被引用为具体功能的产出
  <feature-slug>/
    intent.md               # 阶段 1 产出
    spec.md                 # 阶段 2 产出（可选，仅当 intent 已 accepted 且值得做设计评审时）
```

- `<feature-slug>` 用 kebab-case，对应功能本身（例：`harness-convergence`），不用日期或 session id。
- `intent.md` 的 `Status` 字段：`draft` → `accepted`（用户确认后）→ `superseded`（被后续 intent 取代时，标注取代者）。只有 `accepted` 的 intent 才应该进入 spec 或直接实现。
- 用户未确认前不要开始写代码；`Open questions` 没答完不是阻塞项，但要显式列出，不要假装已经想清楚。

## 已知缺口（TODO，不在本次改动范围内）

- [ ] 阶段 4：把 `packages/evals` 接入 `ci.yml`，让行为回归有 CI 保护网。
- [ ] 阶段 3：把 `packages/coding-agent/examples/extensions/bash-spawn-hook.ts` 这类护栏示例，提升为 `.pi/settings.json` 里真正生效的构建期 hook。
- [ ] 阶段 6：加一个定期扫描代码库（技术债/安全）的调度任务。
