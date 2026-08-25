#!/usr/bin/env python3
"""Check the scientific-Python toolchain the data-workflow skill relies on.
Prints a report; exits 0 if the CORE tier is present, 1 otherwise. `--fix` also
prints install commands (uv / conda / pip) for your OS. Python 3.8+, stdlib only.
"""
from __future__ import annotations

import importlib
import platform
import shutil
import subprocess
import sys


def py_lib(name):
    try:
        m = importlib.import_module(name)
        return getattr(m, "__version__", "ok")
    except Exception:
        return None


def tool(name):
    return shutil.which(name) or shutil.which(name + ".exe")


# Tiers: core (required), grid (NetCDF/HDF5 gridded data), geo (GIS/raster),
# hydro (model evaluation), viz-extra (optional plotting), env (environment mgmt).
TIERS = {
    "core": [
        ("numpy", True, lambda: py_lib("numpy")),
        ("pandas", True, lambda: py_lib("pandas")),
        ("scipy", True, lambda: py_lib("scipy")),
        ("matplotlib", True, lambda: py_lib("matplotlib")),
        ("seaborn", False, lambda: py_lib("seaborn")),
    ],
    "grid (NetCDF/HDF5)": [
        ("xarray", True, lambda: py_lib("xarray")),
        ("netCDF4", False, lambda: py_lib("netCDF4")),   # native dep; often missing
        ("h5netcdf", False, lambda: py_lib("h5netcdf")),  # pure-py fallback for netCDF4
        ("h5py", False, lambda: py_lib("h5py")),          # native HDF5 dep
        ("cfgrib", False, lambda: py_lib("cfgrib")),      # GRIB (GFS/ECMWF)
    ],
    "geo (GIS/raster)": [
        ("geopandas", False, lambda: py_lib("geopandas")),
        ("rasterio", False, lambda: py_lib("rasterio")),
        ("shapely", False, lambda: py_lib("shapely")),
        ("pyproj", False, lambda: py_lib("pyproj")),
        ("cartopy", False, lambda: py_lib("cartopy")),
        ("regionmask", False, lambda: py_lib("regionmask")),
        ("rioxarray", False, lambda: py_lib("rioxarray")),
    ],
    "hydro (model eval)": [
        ("hydroeval", False, lambda: py_lib("HydroEval") or py_lib("hydroeval")),
        ("HydroErr", False, lambda: py_lib("HydroErr")),
    ],
    "env mgmt": [
        ("uv", False, lambda: tool("uv")),
        ("conda", False, lambda: tool("conda")),
        ("pixi", False, lambda: tool("pixi")),
        ("jupyter", False, lambda: tool("jupyter") or py_lib("jupyter")),
    ],
}


def native_ok():
    """Best-effort check that GDAL/proj native libs are reachable."""
    g = tool("gdalinfo")
    p = tool("proj")
    return f"gdal={'yes' if g else 'no'} proj={'yes' if p else 'no'}"


def install_commands():
    plat = platform.system()
    py = sys.executable
    pip = f'"{py}" -m pip install --upgrade'
    lines = ["# Install commands for your platform:"]
    lines.append("# Core (pure Python) — fastest with uv:")
    lines.append("  uv pip install numpy pandas scipy matplotlib seaborn hydroeval HydroErr")
    lines.append(f"  # or pip: {pip} numpy pandas scipy matplotlib seaborn hydroeval HydroErr")
    lines.append("")
    lines.append("# Gridded + geo (native deps: HDF5, GDAL, proj) — use conda/pixi on Windows:")
    if plat == "Windows":
        lines.append("  conda install -c conda-forge xarray netCDF4 h5py geopandas rasterio cartopy regionmask rioxarray")
        lines.append("  #  or pixi:  pixi add xarray netCDF4 h5py geopandas rasterio cartopy regionmask rioxarray")
        lines.append("  #  (pip install of rasterio/geopandas/netCDF4 often fails on Windows without build tools)")
    elif plat == "Darwin":
        lines.append("  brew install gdal proj hdf5")
        lines.append("  uv pip install xarray netCDF4 h5py geopandas rasterio cartopy regionmask rioxarray")
    else:
        lines.append("  sudo apt-get install -y libgdal-dev libproj-dev libhdf5-dev")
        lines.append("  uv pip install xarray netCDF4 h5py geopandas rasterio cartopy regionmask rioxarray")
    lines.append("")
    lines.append("# Env tools (pick one):")
    lines.append("  pip install uv           # pure-Python projects (fast)")
    lines.append("  # conda / mamba / pixi   # projects needing native libs")
    return "\n".join(lines)


def main():
    fix = "--fix" in sys.argv
    print(f"data-workflow toolchain doctor  (platform: {platform.system()} {platform.machine()})")
    print(f"python: {sys.version.split()[0]}   native: {native_ok()}")
    print(f"{'tier':<20} {'package':<14} {'req':<5} status")
    print("-" * 70)
    missing_required = []
    for tier, checks in TIERS.items():
        for name, req, getter in checks:
            try:
                val = getter()
            except Exception as e:
                val = f"error: {e}"
            if val:
                status = val
            else:
                status = "MISSING (optional)" if not req else "*** MISSING ***"
                if req:
                    missing_required.append(f"{tier}/{name}")
            print(f"{tier:<20} {name:<14} {'yes' if req else 'no':<5} {status}")
    print("-" * 70)
    if missing_required:
        print(f"\nRequired (core) missing: {', '.join(missing_required)}")
        print("Core data analysis will fail without them.")
    else:
        print("\nCore tier present. (grid/geo/hydro tiers are optional per task.)")
    if fix or missing_required:
        print()
        print(install_commands())
    sys.exit(1 if missing_required else 0)


if __name__ == "__main__":
    main()
