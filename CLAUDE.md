# CLAUDE.md

本仓库开发规则以两个文件为准，Claude Code 会自动加载本文件，但不会自动加载下面两个——请显式读取：

- [`AGENTS.md`](./AGENTS.md) —— 上游 `pi` 项目的 TS/Node 开发规范（保持原样，未按本 fork 调整，减少合并冲突）。
- [`HYDRO.md`](./HYDRO.md) —— **本 fork 实际生效的规则**：水利业务约束、任务路由、验收标准、复杂任务的 intent 流程。与 `AGENTS.md` 冲突时以 `HYDRO.md` 为准（`pi` 运行时会自动加载它；Claude Code/Codex 需要在会话开始时主动读取）。

`/sdd` 的 Review 步骤（核对项目规范）执行时，请把 `HYDRO.md` 当作与 `AGENTS.md` 同等权重的必读文件。
