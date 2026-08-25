#!/usr/bin/env python3
"""Check the Fortran toolchain this skill relies on. Prints a report; exits 0
if gfortran is present (the only hard requirement), 1 otherwise. `--fix` also
prints install commands for your OS. Cross-platform, Python 3.8+, stdlib only.
"""
from __future__ import annotations

import platform
import shutil
import subprocess
import sys


def which(name):
    return shutil.which(name) or shutil.which(name + ".exe")


def version(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        first = (r.stdout or r.stderr).splitlines()
        return first[0].strip()[:70] if first else "ok"
    except Exception:
        return "ok"


def py_lib(name):
    try:
        import importlib
        m = importlib.import_module(name)
        return getattr(m, "__version__", "ok")
    except Exception:
        return None


def f2py_ok():
    """f2py may be `f2py` on PATH or `python -m numpy.f2py`."""
    if which("f2py"):
        return "f2py on PATH"
    try:
        r = subprocess.run([sys.executable, "-m", "numpy.f2py", "-v"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0 or "version" in (r.stdout + r.stderr).lower():
            return "python -m numpy.f2py"
    except Exception:
        pass
    return None


CHECKS = [
    # (label, required, getter)
    ("gfortran", True, lambda: which("gfortran") and version(["gfortran", "--version"])),
    ("ifx (Intel, optional)", False, lambda: which("ifx") and version(["ifx", "--version"])),
    ("make", True, lambda: which("make")),
    ("cmake", False, lambda: which("cmake") and version(["cmake", "--version"])),
    ("meson", False, lambda: which("meson") and version(["meson", "--version"])),
    ("ninja (f2py meson backend)", False, lambda: which("ninja") and version(["ninja", "--version"])),
    ("fortls (LSP)", False, lambda: which("fortls") or py_lib("fortls")),
    ("fprettify (formatter)", False, lambda: which("fprettify") or py_lib("fprettify")),
    ("findent (formatter/convert)", False, lambda: which("findent")),
    ("f2py (numpy)", True, f2py_ok),
    ("numpy (python)", True, lambda: py_lib("numpy")),
]


def install_commands():
    plat = platform.system()
    py = sys.executable
    pip = f'"{py}" -m pip install --upgrade'
    lines = ["# Install commands for your platform:"]
    if plat == "Darwin":
        lines += [
            "brew install gcc make cmake meson ninja",
            f"{pip} numpy fortls fprettify findent meson",
            "# Intel ifx: install Intel oneAPI Base + HPC Toolkit (free).",
        ]
    elif plat == "Linux":
        lines += [
            "# Debian/Ubuntu:",
            "sudo apt-get install -y gfortran make cmake meson ninja-build",
            f"{pip} numpy fortls fprettify findent meson",
            "# Fedora: sudo dnf install -y gcc-gfortran make cmake meson ninja-build",
            "# Intel ifx: install Intel oneAPI Base + HPC Toolkit (free).",
        ]
    elif plat == "Windows":
        lines += [
            "# Option A (recommended) — MSYS2, gives real gfortran + make:",
            "#   pacman -S mingw-w64-x86_64-gcc-fortran make cmake meson ninja",
            "# Option B — winget (gfortran via Strawberry Perl or MSYS2):",
            "winget install --id StrawberryPerl.StrawberryPerl",
            "winget install --id Kitware.CMake",
            f"{pip} numpy fortls fprettify findent meson",
            "# Add gfortran's bin dir (e.g. C:\\Strawberry\\c\\bin) to PATH.",
            "# Intel ifx: install Intel oneAPI Base + HPC Toolkit (free).",
        ]
    else:
        lines.append(f"# Unsupported platform {plat}; install gfortran, make, cmake, meson, numpy.")
    return "\n".join(lines)


def main():
    fix = "--fix" in sys.argv
    print(f"fortran toolchain doctor  (platform: {platform.system()} {platform.machine()})")
    print(f"{'tool':<32} {'req':<5} status")
    print("-" * 70)
    missing = []
    for label, req, getter in CHECKS:
        try:
            val = getter()
        except Exception as e:
            val = f"error: {e}"
        if val:
            status = val
        else:
            status = "MISSING (optional)" if not req else "*** MISSING ***"
            if req:
                missing.append(label)
        print(f"{label:<32} {'yes' if req else 'no':<5} {status}")
    print("-" * 70)
    if missing:
        print(f"\nRequired tools missing: {', '.join(missing)}")
        print("Fortran build/f2py will fail without them.")
    else:
        print("\nAll required tools present.")
    if fix or missing:
        print()
        print(install_commands())
    sys.exit(1 if missing else 0)


if __name__ == "__main__":
    main()
