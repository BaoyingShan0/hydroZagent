---
description: "Work on code across the hydrology stack — Fortran (legacy models), Python (analysis/ML), Vue/TS (dashboards). Picks the right language workflow, runs the right checks."
argument-hint: "<task or file path>"
---
Work on a code task: $ARGUMENTS

This prompt covers the **mixed-language** reality of hydrology engineering code: legacy **Fortran** models, **Python** analysis/ML pipelines, and **Vue/TypeScript** monitoring dashboards. Pick the workflow by language; don't apply one language's conventions to another.

## Workflow

1. **Classify the language** from `$ARGUMENTS` and the files involved:
   - `.f/.for/.f77/.f90/.f95/.f03/.f08` → **Fortran** (load `fortran` skill)
   - `.py/.ipynb` → **Python** (this prompt + `data-workflow` skill if it's data code)
   - `.vue/.ts/.js/.tsx` → **Vue/TS frontend** (pi-lens already covers; `frontend-design` skill for UI)
   - `.r/.R` → R (frequency stats; note `pearson3_freq.py` exists for the Python path)
   - `.sh/.ps1` → shell pipeline scripts
   - mixed/unknown → ask the user

2. **Fortran path** — load the `fortran` skill first (`/skill:fortran` or read its SKILL.md). Key rules:
   - Legacy F77 is **fixed-form, column-sensitive**. Never "tidy" spacing or reflow lines — column 6 continuation rules will break silently. Read the `fortran` skill's §1 before editing any `.f`/`.for`.
   - Add `IMPLICIT NONE` and compile with `gfortran -Wall -std=f2008` to surface undeclared variables; fix declarations, not logic.
   - For Fortran↔Python coupling, use **f2py** (installed). Run `scripts/build_f2py_example.sh` for a working pattern. Watch array memory order — pass `np.asfortranarray(x)`.
   - pi-lens does **not** cover Fortran. Run `python .pi/skills/fortran/scripts/doctor.py` to check the toolchain (gfortran/fortls/f2py). Use `gfortran -Wall -fcheck=all` for feedback.
   - Before changing logic on a legacy model, **capture a baseline run** (known output for known input). Every change must reproduce it to tolerance — this is your only safety net.

3. **Python path** —
   - If it's **data/analysis** code (pandas/xarray/NetCDF/hydrology), load the `data-workflow` skill (`/skill:data-workflow`) and follow its load→validate→analyze→visualize path. Apply the hydrology validation rules (discharge ≥ 0, etc.).
   - If it's **app/library** code, proceed normally. pi-lens gives LSP + ruff feedback automatically; trust its honesty labels (partial/unconfirmed ≠ clean).
   - Environment: pure-Python deps via `uv`; native deps (netCDF4/geopandas/rasterio) via `conda`/`pixi`. Pin and commit the env file.
   - Reproducibility: one script per figure/table; raw data read-only; record provenance.

4. **Vue/TS path** —
   - pi-lens already provides LSP (Volar/vue-tsc), eslint, prettier/biome, and read-guard. Use `module_report`/`symbol_search` to navigate. For UI/design work, load the `frontend-design` skill.
   - For 水情 dashboards: ECharts is the dominant charting lib in Chinese water platforms; for maps, Cesium (3D terrain/流域) or Leaflet (2D 站点). Check what's already in the project before adding a new dep.

5. **Verify before declaring done.**
   - Fortran: rebuild, run the baseline, diff outputs to tolerance.
   - Python: run the affected tests (`./test.sh` or the specific test file); for data code, re-run the script end-to-end and eyeball the output figure/table.
   - Vue/TS: `npm run check` (lint+format+typecheck) and run the affected component test.
   - Use `lens_diagnostics mode=full` for a whole-project verdict on Python/TS; it honestly won't cover Fortran.

6. **Report** what you changed, which language workflow you used, and the verification result. For mixed-language coupling (e.g. f2py wrap), state the memory-order / kind / intent decisions explicitly.

## Rules

- Never apply one language's conventions to another (no `gofmt`-style reflow on fixed-form Fortran; no Python `snake_case` enforcement on Vue components).
- For legacy code (Fortran or otherwise): **reproduce a baseline before changing logic.** No baseline, no logic change.
- Don't install system packages (gfortran/conda/GDAL) without telling the user; the doctor scripts only *print* install commands. Let the user run them.
- If `$ARGUMENTS` is empty or ambiguous, ask for the file path / language / intent before acting.
- f2py array interop: always `np.asfortranarray` or declare Fortran `intent(in)` shapes; a wrong memory layout gives correct-looking but wrong numbers.
