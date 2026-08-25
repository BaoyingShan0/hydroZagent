---
description: "Pre-done / pre-commit quality self-check for any code or data work. Runs the 7-point checklist (acceptance criterion, lint/format, tests/baseline, output eyeball, physical plausibility, reproducibility, doc sync) and reports honestly. Does NOT commit unless you also ask."
argument-hint: "[file paths or task description]"
---
Run the pre-done quality self-check for: $ARGUMENTS

This is the executable form of the `dev-conventions` skill's §4. Work through each item; report honestly — a partial checklist with stated exceptions beats an unqualified "all green." Do **not** commit unless the user explicitly asks in the same turn.

## Steps

1. **Identify the scope.** From `$ARGUMENTS` and `git status`/`git diff`, determine: which files changed, which languages they are (Fortran/Python/R/MATLAB/C/C++/Julia/Shell/SQL/Vue/TS/Go/Rust/Java/...), and whether any data is involved. If `$ARGUMENTS` is empty, run the check over `git status` (unstaged + staged changes you made this session); if nothing changed, ask what to check.

2. **Acceptance criterion.** Was a "done" criterion stated before the work (a test, a baseline, an expected number, a property)? If yes, verify it passes now. If no — say so, then state one and check it. (dev-conventions §1: deciding what 'correct' means before, not after.)

3. **Lint + format.** For each language touched, run its formatter/linter:
   - Python / Vue / JS / TS → pi-lens does this automatically; run `lens_diagnostics mode=full` and read the verdict. Fix or justify each warning.
   - Fortran → `gfortran -Wall -std=f2008 -fcheck=all -c <file>`; optionally `fprettify --diff`.
   - R → `lintr::lint("<file>")`; `styler` dry-run.
   - Shell → `shellcheck <file>`; `shfmt --diff`.
   - C/C++ → `clang-tidy`, `clang-format --dry-run`.
   - other languages → the canonical tool from the dev-conventions §3 table.
   State which languages were clean and which had justified exceptions.

4. **Tests / baseline.**
   - If a test suite exists (pytest, vitest, testthat, `go test`, `cargo test`, `ctest`, `bats`...), run the affected tests. Report pass/fail counts.
   - If the code is legacy with no tests (common for Fortran/old MATLAB): verify against a captured baseline — re-run on the known input and diff to tolerance. Report whether output matches.
   - If neither applies, say "no tests, no baseline — acceptance rests on §2 (criterion) and §5 (eyeball)."

5. **Eyeball the output.** Open the figure / read the table / inspect the log the change produces. Do not report success from an exit code alone. Describe what you actually saw. For a figure: axes labeled? CJK font rendering (no 豆腐块)? For a table: values sane, no -9999 leaking through? For a number: right order of magnitude, right sign?

6. **Physical plausibility** (only if data is involved). Run `python .pi/skills/data-workflow/scripts/validate_timeseries.py` on any station data the change touches, or check the rules manually: discharge ≥ 0, rainfall in [0, Pmax], water level within sensor range, no impossible rate-of-change spikes. Flagged values should be marked, not silently deleted. Report counts per rule.

7. **Reproducibility.** Confirm: environment is pinned (`requirements.txt`/`environment.yml`/`uv.lock` committed next to the script); random seed set explicitly; one script per deliverable artifact (no "run notebook cells 4 then 7" for anything cited); raw inputs untouched (derived output in a separate dir).

8. **Doc sync.** If the change altered behavior, inputs, or a data flow: is the docstring / README / inline comment / `packages.md` updated in the same change? If a skill or tool was added/changed, is `packages.md` updated?

## Report

Print a compact report:

```
QA self-check — <scope>
  1. acceptance:    <met / not stated / failed>
  2. lint/format:   <clean / N exceptions: ...>
  3. tests/baseline: <pass N / fail N / none — resting on §2,§5>
  4. output eyeball: <what was actually seen>
  5. physical:      <n/a / N flagged: ...>
  6. reproducible:  <yes / missing: seed, env pin, ...>
  7. docs:          <in sync / needs: ...>
  verdict:          <ready / blockers: ...>
```

If there are blockers, list them concretely and stop — do not declare done. If the user asked to commit and verdict is "ready," stage only the files you changed (explicit paths) and commit per dev-conventions §9 (Conventional Commits). Do not push unless asked.

## Rules

- Honesty over tidiness. A real "3/7, here's what's missing" is more useful than a fake "all green." pi-lens labels like "partial"/"unconfirmed" mean exactly that — relay them, don't launder them into "clean."
- Do not run `git add -A` / `git add .` / `git reset --hard` / `git stash` — stage explicit paths only.
- Do not commit unless the user asks in this turn.
- If the change spans multiple languages, run §3 for each; don't assume Python's tools cover Fortran or R.
- For legacy code, §4 (baseline) is the gate, not §3 (lint) — a clean compile of a logic-wrong change is still wrong.
