#!/usr/bin/env bash
# Minimal working f2py example: build a Fortran subroutine, call it from Python.
# Copy this pattern to wrap a legacy hydrology routine. Idempotent; safe to re-run.
#
#   bash scripts/build_f2py_example.sh
#
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/manning.f90" <<'EOF'
subroutine manning_q(depth, n, slope, width, m, q)
  ! Manning's uniform-flow discharge for a rectangular channel.
  implicit none
  real(8), intent(in)  :: depth, n, slope, width
  integer, intent(in)  :: m
  real(8), intent(out) :: q
  !f2py intent(in) :: depth, n, slope, width, m
  real(8) :: area, rh
  area = width * depth
  rh   = area / (width + 2.0_8 * depth)
  q    = (1.0_8 / n) * area * rh**(2.0_8/3.0_8) * sqrt(slope) * dble(m)
end subroutine manning_q
EOF

# Build. Try meson backend first (needed on Python 3.12+), fall back to legacy.
PYTHON="${PYTHON:-python}"
if "$PYTHON" -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" && command -v meson >/dev/null 2>&1; then
  "$PYTHON" -m numpy.f2py -c "$WORK/manning.f90" -m manning_mod --backend meson
else
  "$PYTHON" -m numpy.f2py -c "$WORK/manning.f90" -m manning_mod
fi

# Smoke test: scalar + array call.
"$PYTHON" - <<'EOF'
import numpy as np, manning_mod
q_scalar = manning_mod.manning_q(2.0, 0.035, 0.001, 10.0, 1)
depths   = np.array([1.0, 2.0, 3.0])
q_array  = manning_mod.manning_q(depths, 0.035, 0.001, 10.0, 1)
print(f"scalar Q = {q_scalar:.4f} m3/s")
print(f"array  Q = {q_array}")
assert q_scalar > 0 and all(q_array > 0), "discharge must be positive"
assert abs(q_array[1] - q_scalar) < 1e-9, "depth=2 must match scalar call"
print("OK: f2py wrap works, scalar and array paths agree")
EOF

echo
echo "Done. Copy manning_mod.*.pyd/.so next to your Python code and 'import manning_mod'."
