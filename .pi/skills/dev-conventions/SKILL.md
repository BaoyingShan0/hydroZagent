---
name: dev-conventions
description: "Cross-cutting development-quality discipline for ALL code and data work in this repo, in ANY language (Fortran, Python, R, MATLAB, C/C++, Julia, Shell, SQL, Vue/TS/JS, Go, Rust, Java, and others). Use this skill BEFORE writing or changing code or data scripts, BEFORE declaring a task done, when reviewing code, when committing, and whenever the user asks about testing, reproducibility, code quality, or good practice. This is the general framework (总纲); language- and task-specific details live in the fortran, data-workflow, and doc-convert skills. Triggers: 'write code', 'before done', 'how do I know it works', 'test', 'reproducible', 'code review', 'quality', 'best practice', '规范', '写代码前', '提交前', '怎么算完'."
license: MIT
---

# Development quality conventions (cross-language)

One principle, stated first so everything below has a reason: **every change you make must produce a result that is verifiable, reproducible, and physically plausible.** Hydrology engineering outputs often feed regulatory submissions (防洪评价, 水资源论证) where a reviewer — or a court — may need to rerun your work years later and get the same number. "It ran without error" is not "done."

This is the cross-cutting discipline. It applies regardless of language or task. The `fortran`, `data-workflow`, and `doc-convert` skills give language/task-specific detail; when a rule there conflicts with one here, the specific skill wins for its domain, and this skill is the default everywhere else.

## 1. Define "done" before you start

Before writing or changing any code, state how you will know the result is correct. The reason this comes first: hydrology code frequently has no test suite (legacy Fortran), and many outputs are figures or reports where "correct" is easy to feel but hard to specify after the fact. If you decide what "correct" means before writing the thing that achieves it, you cannot fool yourself later.

The acceptance criterion takes whatever form the work allows — pick the strongest available:

| Strength | Form | When it fits |
|---|---|---|
| best | An automated test (pytest, vitest, testthat, Test.jl, ctest, `bats`...) | Any pure function, data transform, parser |
| good | A known-good output to reproduce exactly (a **baseline**) | Legacy models with no tests — mandatory here, see §2 |
| good | A hand-computed or regulation-cited expected number | Frequency analysis (SL 44 tables), rating-curve fit, mass balance |
| acceptable | A property that must hold | discharge ≥ 0; ∑unit-hydrograph = 1; continuity closes; units balance |
| weakest | "It looks right" | Only for exploratory/throwaway work; never for a result anyone will cite |

State the criterion in your first reply or in a comment at the top of the script. If you cannot state one, say so and ask the user — that itself is progress.

## 2. Baseline-first for legacy code

Legacy models (Fortran, old MATLAB, inherited spreadsheets-as-programs) usually have no tests and no spec. Their only honest safety net is a captured baseline: a known input, the output it produces today, recorded to a file. Before changing any logic in such code, capture the baseline. After each change, re-run and diff to tolerance. A change that shifts the output is either a bug or an intended fix — and you can only tell which because you have the baseline.

This matters more in hydrology than in typical software because the "tests" for a 30-year-old flood-routing routine are often a single hand-verified example in a report from 1996. Lose that reference and the model becomes unverifiable. So: baseline before logic, always, for anything legacy.

## 3. Language tools — what to run, and what's already automated

pi-lens (an installed extension) automatically lints and formats **Python** (ruff, vulture) and **Vue/JS/TS** (biome/prettier/eslint/Volar) and gives read-protection. For every other language you must run the formatter/linter yourself. The table below covers the languages that appear in hydrology practice; it is not exhaustive — if a language isn't listed, find its canonical formatter, linter, and test runner and use them.

| Language | Format / Lint (auto?) | Test | Build / Run | Hydrology notes |
|---|---|---|---|---|
| **Fortran** | fprettify, findent, fortls (manual) | none standard → baseline-diff (§2) | gfortran, cmake/meson; f2py to Python | fixed-form F77 is column-sensitive — see `fortran` skill before editing `.f`/`.for` |
| **Python** | ruff, vulture (**pi-lens auto**) | pytest | `uv run` (pure-py); conda/pixi if native deps | data code: also run `data-workflow` validators |
| **R** | lintr, styler (manual) | testthat | `Rscript` | common for stats/frequency; P-III exists in Python here too |
| **MATLAB / Octave** | mlint (manual) | none standard → baseline-diff | matlab; octave for portability | check it runs under Octave if the team lacks MATLAB licenses |
| **C / C++** | clang-format, clang-tidy (manual) | ctest, Catch2, Unity | cmake, make | HPC kernels, f2py backends |
| **Julia** | JuliaFormatter.jl (manual) | Test.jl | `Pkg`, `julia` | emerging in scientific computing |
| **Shell (bash/sh)** | shfmt, shellcheck (manual) | bats | `bash` | data pipelines; `shellcheck` catches the dangerous quoting/globbing bugs |
| **SQL** | sqlfluff, sqlfmt (manual) | data assertions (dbt, hand) | psql, duckdb | validate row counts, keys, ranges on load |
| **Vue / TS / JS** | biome, prettier, eslint (**pi-lens auto**) | vitest | npm/pnpm | dashboards; ECharts/Cesium common in 水情 platforms |
| **Go** | gofmt, golangci-lint (manual) | `go test` | `go build` | services |
| **Rust** | rustfmt, clippy (manual) | `cargo test` | `cargo` | performance-critical or safety-critical |
| **Java** | google-java-format, checkstyle (manual) | JUnit | maven/gradle | enterprise integrations |

Run the formatter and linter for the language(s) you touched before declaring done. Exceptions (a deliberately long line, a disabled rule) are fine — state them, don't hide them.

## 4. The pre-done self-check

Before you tell the user a code/data task is complete, run through this. The `/qa` prompt automates it; this is what it checks. Each item exists for a reason, stated inline.

1. **Acceptance criterion met.** The thing you said in §1 would prove correctness — does it pass? If you never stated one, go state one now and check it.
2. **Formatter + linter clean** for every language touched (§3). pi-lens covers Python/Vue automatically; run the others by hand. Fix or explicitly justify each warning.
3. **Tests / baseline pass.** Run the test suite. For legacy, diff against the baseline (§2). A failing test is a blocker unless the user accepts the risk.
4. **Output actually eyeballed.** Open the figure, read the table, inspect the log — do not report "ran successfully" without looking at what it produced. A script that exits 0 can still plot the wrong curve.
5. **Physical plausibility** (data work only). Discharge ≥ 0, rainfall in range, water level within sensor range, no impossible jumps. The `data-workflow` `validate_timeseries.py` script encodes these; flag, don't silently delete.
6. **Reproducible.** Environment pinned (§5), random seed set, one script per artifact, raw inputs untouched (§6).
7. **Docs in sync.** If you changed a script's behavior, inputs, or a data flow, update its docstring/README/comment in the same change (§8).

Report which of these passed, which had stated exceptions, and which were skipped (and why). A clean "all seven green" with no detail is less trustworthy than an honest "5/7, skipping tests because there are none; baseline matches."

## 5. Reproducibility (the regulatory reason)

Hydrology results get cited in submissions that may be audited long after delivery. Make every analysis rerunnable by someone who was not you:

- **Pin the environment.** `uv pip freeze > requirements.txt` (pure Python) or `conda env export --no-builds > environment.yml` (native deps). Commit it next to the script. A result without its environment is a result no one can recheck.
- **Set the random seed** explicitly (`np.random.seed(...)`, `set.seed()`, etc.). An unset seed means a different number on every run.
- **One script per artifact.** A reviewer runs `python fig3_hydrograph.py` and gets Figure 3. No "first run cell 4, then cell 7" notebook paths for anything deliverable. Notebooks are for exploration; promote to a script before a result is cited.
- **Record provenance.** A comment or sidecar noting source, station ID, download date for every input. "era5_tp_2023.nc — CDS request 2024-03-15, basin-averaged" not just "the rainfall file."

## 6. Data discipline (cross-cutting)

These apply to any data work, not only the `data-workflow` skill's domain:

- **Raw data is read-only.** Never mutate an input file. Write cleaned/derived data to a separate `processed/` or `out/` directory.
- **Never blind-`dropna()`.** A missing value has a cause (sensor fault, gauge tip error, transmission loss). Record why each value is missing; flag physically-impossible values, don't delete them. Regulatory review asks.
- **Short gaps (≤3 steps) may be interpolated; long gaps stay NaN** with a documented reason. Filling a 6-month gap in a discharge series by interpolation produces a fiction, not data.

## 7. Dependencies and environment

- **Do not install system or native packages** (gfortran, GDAL, HDF5, conda itself) without telling the user. The `doctor.py` scripts in each skill only *print* install commands; let the user run them. Native deps on Windows are especially fragile (pip building netCDF4/geopandas/rasterio often fails) — steer to conda/pixi, not pip.
- **Pure-Python deps → `uv`** (fast, the `mitsupi/uv` skill wraps it). **Native deps (GDAL, HDF5, proj) → `conda` or `pixi`.** Pick one environment per project and pin it.
- **Direct dependencies pinned to exact versions**, like any reviewed code. A floating dep is an unreviewed future change.

## 8. Documentation stays in sync

If you change what a script does, what its inputs are, or how a data flows, update the docstring, README, or inline comment **in the same change**. The reason: hydrology scripts are often read by the next engineer months later with no memory of the conversation that produced them. A script whose behavior drifted from its comments is worse than no comment. This includes the `packages.md` inventory when you add or change a skill/prompt/tool.

## 9. Commit discipline

Borrow the Conventional Commits format (the `mitsupi/commit` skill uses it). This repo's adaptation:

- Format: `<type>(<scope>): <summary>` — `type` is `feat`/`fix`/`docs`/`refactor`/`chore`/`test`/`perf`; `scope` is the component or language (`fortran`, `data`, `doc`, `vue`, `skill`, ...); summary ≤ 72 chars, imperative, no period.
- Only commit files you changed this session; stage explicit paths, never `git add -A`.
- Do not commit unless the user asks (this repo's rule, from the upstream AGENTS.md — still applies).
- Do not push unless asked.

**Note on the root `AGENTS.md`:** it is the upstream pi project's own TS/Node development rules (vitest, `npm run check`, `packages/*`, lockstep release). It does **not** describe this fork's hydrology workflow. It is kept unchanged so merging upstream stays clean. For this repo's actual development discipline, use this skill and the `/qa` prompt — not the root AGENTS.md's command section.

## How this skill relates to the others

| Skill / prompt | When to load it |
|---|---|
| `fortran` | editing `.f`/`.for`/`.f90`+ or doing f2py — fixed-form rules, baseline-diff detail |
| `data-workflow` | loading/cleaning/analyzing/plotting hydrology data — validators, Pearson III, resampling rules |
| `doc-convert` | Office/PDF conversion — engine matrix, doctor |
| `/code` | picking the right language workflow for a code task |
| `/data` | running the data load→validate→analyze→visualize chain |
| `/qa` | the pre-done/pre-commit self-check (§4), automated |
| `mitsupi/commit` | the commit-message formatter (this skill §9 references it) |
| `mitsupi/uv` | Python environment management (this skill §7 references it) |
| `pi-lens` | automatic lint/format for Python + Vue/JS/TS (this skill §3 relies on it) |
