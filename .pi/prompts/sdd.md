---
description: "Full Spec-Driven Development pipeline for a complex task — intent, spec, plan, execute, verify, wrap up. Ships with the repo; no extra plugin install needed. See docs/ai-native-sdlc/README.md."
argument-hint: "<one-line description of the feature/change>"
---
Run the Spec-Driven Development pipeline for: $ARGUMENTS

This is the pi-native, repo-shipped implementation of the [AI-native SDLC](./docs/AI原生SDLC实战手册-中文翻译.md) for this project. It only uses prompts and skills already committed to this repo (`.pi/prompts/`, `.pi/skills/`) — nothing that requires a personal plugin install, so it works the same for every engineer who clones the repo and runs `pi`. Do not skip a gate to get to code faster.

## Step 0: complexity gate

- 🟢 **Skip SDD, just do it**: typo/comment fix, single-function bugfix with an obvious acceptance criterion, config tweak, executing a step from an already-accepted plan.
- 🔴 **Run the full pipeline**: new feature/module, change touching ≥2 files or crossing package boundaries, changes to core business logic/data structures/interfaces, or a requirement you can't state an acceptance criterion for yet.

If 🟢, say so plainly, do the thing, stop — don't force the ceremony. If 🔴, announce "走 SDD" and work through the stages below in order.

## Pipeline

1. **Intent** — Read `.pi/prompts/intent.md` and follow it: capture the problem (not the solution) as `docs/ai-native-sdlc/<slug>/intent.md`. Ask 1-3 clarifying questions if Problem/Constraints are underdetermined (per `HYDRO.md`'s task-routing rule) rather than guessing. **Wait for the user to confirm (`Status: accepted`)** before moving on.

2. **Spec** — Write `docs/ai-native-sdlc/<slug>/spec.md` next to the intent. Use `docs/ai-native-sdlc/harness-convergence/spec.md` as a reference for shape, not a template to copy verbatim — the parts that matter for any spec are: 设计结论（what you're actually building）, 复用现有生态 vs 明确不做什么（don't reinvent what already exists in this repo）, 对外契约（interfaces/data shapes that other code will depend on）, 验收标准. **Wait for the user to confirm the spec** before moving on.

3. **Plan** — Use the `writing-plans`-style discipline: turn the accepted spec into a plan file in `docs/plans/` (follow the existing convention there — see `hydrozagent-optimization-plan.md`), dated, with concrete steps and a verification method per step.

4. **Execute** — Implement per the plan. Apply `dev-conventions` skill §1-§2 (state the acceptance criterion / capture a baseline before touching legacy code) and whichever HYDRO.md task-category rules apply (Coding/Hydro/Document/Data/Operations/Knowledge). For independent sub-tasks, parallel subagents are fine; for logic-bearing changes, write the test/baseline first.

5. **Verify** — Run `/qa` over the changed scope before declaring anything done. A partial checklist with stated exceptions is acceptable; a claimed "done" with no verification is not.

6. **Wrap up** — Once `/qa` verdict is "ready": stage only the files this task touched (explicit paths, never `git add -A`/`git add .` — see `AGENTS.md` Git rules), commit using the Conventional Commits format from `dev-conventions` §9. Ask the user whether to push / open a PR; do not do either unilaterally.

## Rules

- Intent not accepted → don't write spec. Spec not accepted → don't write plan. Plan not on disk → don't touch code.
- Evidence before claims: no "done" without a `/qa` run backing it.
- If an accepted intent/spec already exists for overlapping scope in `docs/ai-native-sdlc/`, amend or supersede it rather than forking a duplicate.
- Communicate in the language the project/user already uses (see `HYDRO.md`; default Chinese).
