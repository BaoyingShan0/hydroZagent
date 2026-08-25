---
name: fortran
description: "Read, write, build, and couple legacy and modern Fortran (F77/F90/F2003+) — the language most hydrology/hydraulic models (SWAT, HEC-RAS internals, MIKE SHE cores, custom flood-routing, finite-difference St. Venant solvers) are written in. Use whenever the user touches .f/.for/.f77/.f90/.f95/.f03/.f08/.f15 files, mentions gfortran/ifort/ifx/flang/f2py, or asks to port/wrap/debug a Fortran model. Covers fixed-form F77 reading rules (COMMON blocks, EQUIVALENCE, implicit typing, column rules), free-form F90+ (modules, intent, allocatable), build systems (Make/CMake/meson), and Fortran↔Python interop via f2py. Triggers: 'fortran', 'F77', 'F90', 'gfortran', 'f2py', 'wrap this .f90', 'port this model', '编译 Fortran', '水文模型'."
license: MIT
---

# Fortran for hydrology models

Fortran is the lingua franca of legacy hydrology/hydraulic models. This skill covers reading the old fixed-form code, writing new free-form code, building it, and — most importantly for modern workflows — **wrapping it with `f2py` so Python can call it**. That last step is the #1 real-world need: couple a 30-year-old flood-routing subroutine to a pandas/xarray pipeline without rewriting it.

> Script paths are relative to this skill's directory. **pi-lens does not cover Fortran** (no ast-grep grammar, `fortls` rarely installed) — rely on `gfortran -Wall` + `fortls` for feedback, see §5.

## 0. First run: check the toolchain

```bash
python scripts/doctor.py          # report; exit 1 if a required tool is missing
python scripts/doctor.py --fix    # also print install commands for your OS
```

Required: `gfortran`. Strongly recommended: `f2py` (ships with numpy), `make`, `cmake`, `fortls` (LSP), `fprettify` or `findent` (formatter).

## 1. Reading legacy fixed-form F77 (the hard part)

Fixed-form is column-sensitive. AI agents and modern eyes both misread it. Memorize the columns:

| Columns | Purpose | Gotcha |
|---|---|---|
| 1 | Comment line if `C`, `c`, or `*` | A `!` in column 1 is also a comment in many compilers (F90 extension) |
| 1–5 | Statement label / line number | Blanks ignored |
| 6 | Continuation char (any non-blank) | **A space in column 6 means "new statement"; a char means "continues the previous line."** Miscounting this is the #1 silent bug when editing F77 |
| 7–72 | Statement | Columns 73–80 are ignored (historically card sequence numbers) |

Reading rules that bite:

- **Implicit typing.** With `IMPLICIT NONE` absent (it usually is in old code), variables starting `I–N` are INTEGER, everything else REAL. `NDEPTH` is INTEGER, `XMAX` is REAL. Never assume a variable's type from its name; check declarations or the implicit rule.
- **`COMMON` blocks** are global shared memory. `COMMON /BLK1/ A(100), B, C(50)` lays out a flat block; different routines map the same block with different names/types (via `EQUIVALENCE`) — this is pre-pointer aliasing. Changing a variable's size in one routine but not others silently corrupts the block. Treat any COMMON block as load-bearing across every file that names it.
- **`EQUIVALENCE`** makes two names alias the same storage. Reading order and re-typing through equivalence is a frequent source of "works in debug, wrong in release."
- **`REAL*8` vs `DOUBLE PRECISION` vs `REAL(KIND=8)`.** `REAL*8` is a common non-standard extension (gfortran accepts it). `DOUBLE PRECISION` is standard F77. They're usually the same 8-byte float but don't mix kinds in expressions without care.
- **`FORMAT` statements** are labeled, often far from the `WRITE` that uses them. Grep for the label.
- **Control flow is `GO TO` + labels.** Don't "clean it up" by restructuring — you will break it. Follow the labels.
- **Fixed-form column sensitivity means spaces don't matter inside a statement** (`DO 10 I=1,5` and `DO10I=1,5` both parse), which is why the famous `DO 10 I=1.5` (a typo for `1,5`) became an assignment `DO10I = 1.5` creating a new variable. Modernize with `IMPLICIT NONE` first.

**First move on any legacy F77 file:** add `IMPLICIT NONE` and let the compiler list every undeclared variable. That single change surfaces decades of bugs. Expect a long error list; fix declarations, not logic.

## 2. Writing modern free-form F90+

| Feature | Use |
|---|---|
| `module` | Encapsulate data + procedures; replaces COMMON |
| `intent(in/out/inout)` | Annotate every dummy arg; catches aliasing bugs |
| `allocatable` | Dynamic arrays; replaces fixed-size `PARAMETER` arrays |
| `derived type` | `type :: station; real :: lat, lon, z; ... end type` |
| `implicit none` | Always. Put at the top of every scope |
| `pure` / `elemental` | Mark side-effect-free procedures |
| `where` / `forall` | Array operations without loops |

```fortran
module hydro_utils
  implicit none
  contains
    pure function manning_q(depth, n_manning, slope, width) result(q)
      ! Manning's equation: uniform-flow discharge
      real(8), intent(in) :: depth, n_manning, slope, width
      real(8) :: q
      real(8) :: area, r_hyd
      area = width * depth
      r_hyd = area / (width + 2.0_8 * depth)   ! rectangular channel
      q = (1.0_8 / n_manning) * area * r_hyd**(2.0_8/3.0_8) * sqrt(slope)
    end function manning_q
end module hydro_utils
```

Use `real(8)` or, better, define a kind once: `integer, parameter :: dp = kind(1.0d0)` then `real(dp)`. Avoid bare `real` (default kind is 4-byte = single precision — wrong for hydrology).

## 3. Compilers

| Compiler | Install | Notes |
|---|---|---|
| **gfortran** | GCC (free; on Windows: MSYS2, Strawberry Perl, or winget) | The default. Installed on this machine via Strawberry Perl. |
| **ifx** | Intel oneAPI (free) | Replaces ifort (deprecated 2024). Best for Intel CPUs; some legacy ifort flags differ |
| **flang** | LLVM | Growing; check your distro |

```bash
gfortran -Wall -Wextra -fcheck=all -std=f2008 -O2 -o model model.f90 utils.f90
#  -Wall -Wextra    warnings
#  -fcheck=all      runtime bounds/pointer/array checks (DEBUG only — slow)
#  -std=f2008       reject non-standard extensions (helps modernize F77)
#  -O2 / -O0        optimize / debug
#  -ffpe-trap=invalid,zero,overflow   trap NaN/Inf (debug)
#  -finit-local-zero  zero-init locals (reproduces old "uninitialized but worked" behavior)
```

## 4. Build systems

**Make** (simplest, common for legacy):
```makefile
FC = gfortran
FFLAGS = -Wall -O2
OBJS = model.o utils.o io.o
model: $(OBJS)
	$(FC) $(FFLAGS) -o model $(OBJS)
%.o: %.f90
	$(FC) $(FFLAGS) -c $<
```

**CMake** (recommended for new/mixed-language projects; pairs naturally with f2py):
```cmake
cmake_minimum_required(VERSION 3.20)
project(hydro_model LANGUAGES Fortran)
enable_language(Fortran)
set(CMAKE_Fortran_STANDARD 2008)
add_executable(model src/model.f90 src/utils.f90 src/io.f90)
# Fortran_PREPROCESS ON for .F90 vs .f90 distinction
```

**meson** (good with f2py/numpy builds):
```meson
project('hydro_model', 'fortran', 'c')
executable('model', 'src/model.f90', 'src/utils.f90')
```

## 5. fortls (LSP) + formatter

pi-lens has no Fortran support. For IDE-like feedback install `fortls` (pip) and a formatter:

```bash
pip install fortls fprettify findent
# fortls: LSP — hover, go-to-def, rename, diagnostics (incl. IMPLICIT NONE warnings)
# fprettify: auto-format free-form F90+ (indentation, whitespace)
# findent:  re-indent fixed OR free form; also converts fixed→free
```

`fortls` config (`.fortls`):
```json
{"source_dirs": ["src"], "include_dirs": ["include"], "incremental_sync": true}
```

For editing legacy F77: run `findent --fortran=fixed < old.f > new.f` to normalize indentation without changing semantics, then read it.

## 6. f2py — Fortran ↔ Python (the key workflow)

`f2py` (ships with numpy, installed on this machine) wraps Fortran subroutines as importable Python modules. This lets a pandas/xarray pipeline call a 30-year-old model routine directly. **No rewrite, no file-shuffling, no IPC.**

Given `src/manning.f90`:
```fortran
subroutine manning_q(depth, n, slope, width, q, m)
  implicit none
  real(8), intent(in)  :: depth, n, slope, width
  real(8), intent(out) :: q
  integer, intent(in)  :: m
  !f2py intent(in) :: depth, n, slope, width, m
  real(8) :: area, rh
  area = width * depth
  rh = area / (width + 2.0_8 * depth)
  q = (1.0_8 / n) * area * rh**(2.0_8/3.0_8) * sqrt(slope) * m
end subroutine
```

Build and call:
```bash
python -m numpy.f2py -c src/manning.f90 -m manning_mod  # → manning_mod.*.pyd/.so
```
```python
import numpy as np, manning_mod
q = manning_mod.manning_q(2.0, 0.035, 0.001, 10.0, 1)   # scalar -> scalar
depths = np.array([1.0, 2.0, 3.0])                        # array -> array (vectorized)
qs = manning_mod.manning_q(depths, 0.035, 0.001, 10.0, 1)
```

### f2py gotchas (the ones that bite)

- **`intent` is mandatory** for `f2py` to know what's input vs output. Use `!f2py intent(in)` / `intent(out)` directives if the Fortran `intent(...)` attribute is missing (legacy code).
- **Arrays are column-major (Fortran order).** Passing a C-order (row-major) numpy array to a Fortran routine that treats it as 2D silently transposes/corrupts. Always `np.asfortranarray(x)` or declare `intent(in) :: x(m,n)` and let f2py enforce shape. A wrong memory layout gives correct-looking but wrong numbers — the worst failure mode.
- **1-indexed.** Fortran arrays start at 1; f2py maps this, but if the Fortran indexes a global `COMMON` block by raw position, the Python side still sees 1-based semantics in any index returned.
- **`REAL*8` / `double precision` ↔ `float64`.** Mismatched kinds → garbage. Standardize on `real(8)` / `real(kind=dp)` Fortran-side and `np.float64` Python-side.
- **Character args** (`character(len=*)`) are awkward; avoid or pass as bytes.
- **Modules vs subroutines.** Wrapping a `module` exposes `modname.modulename.subname`; wrapping bare `subroutine`s exposes `modname.subname`. Keep it flat for legacy code.
- **Build backend:** modern numpy (≥1.26) recommends `meson` for f2py builds (`python -m numpy.f2py -c ... --backend meson`). The legacy distutils backend is removed in Python 3.12+. If a build fails on Python 3.12+, install `meson` + `ninja` and use `--backend meson`.
- **Reproducibility:** pin the build in a script. See `scripts/build_f2py_example.sh` for a minimal working example you can copy.

## 7. Porting legacy Fortran → a safer state (in order)

1. **Get it building with gfortran + `-std=f2008 -Wall`.** Fix the warnings that are real errors (undefined symbols, kind mismatches); leave style warnings.
2. **Add `IMPLICIT NONE`** to every scope. Declare everything the compiler now complains about. Do NOT change logic.
3. **Reproduce a baseline run** (known output for known input) and save it. Every subsequent change must match this baseline to tolerance. This is your safety net.
4. **Normalize formatting** with `findent`/`fprettify` — one commit, no semantic change. Re-run the baseline.
5. **Wrap leaf subroutines with f2py** (§6) and drive them from Python tests. Now you have regression tests without a Fortran test framework.
6. **Modernize incrementally:** COMMON → module, fixed → free form (`findent --fortran=free`), `GO TO` → structured control flow. One change per commit, baseline must still match. Resist a big-bang rewrite.

## 8. When to stop porting

Legacy Fortran that computes correct numbers and builds with one `gfortran` command does not need modernizing. The high-value move is usually **step 5 (f2py wrap + Python regression tests)**, not a full rewrite. Only rewrite when the code can no longer build on current compilers, or when the COMMON-block aliasing makes changes too risky.

## Dependencies

`gfortran` · `make` · `cmake` · `meson` + `ninja` (for f2py on Python 3.12+) · `fortls` (LSP, pip) · `fprettify`/`findent` (formatter, pip) · `numpy` (for f2py). See `scripts/doctor.py`.
