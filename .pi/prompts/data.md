---
description: "Work on hydrology/scientific data — load, clean, validate, analyze, visualize time series / NetCDF / geospatial. Includes frequency analysis and physical-plausibility checks."
argument-hint: "<task or file path>"
---
Work on a data task: $ARGUMENTS

This prompt covers the **data** side of hydrology work: time series (water level, rainfall, discharge), gridded data (NetCDF/HDF5: ERA5/GFS/reanalysis), and geospatial data (shapefiles, rasters/DEMs). For the *code* that does the analysis, use `/code`; this prompt is about the **data workflow** itself.

## Workflow

1. **Read the `data-workflow` skill first** (`/skill:data-workflow` or read its SKILL.md). It has the canonical load→validate→analyze→visualize path, the hydrology validation rules, and the Pearson III (SL 44) frequency script. Do not improvise the workflow from memory.

2. **Classify the data shape** from `$ARGUMENTS` and the files:
   - `.csv/.tsv/.xlsx` of station observations → **tabular time series** (pandas)
   - `.nc/.nc4/.h5/.hdf5` of gridded fields → **multi-dim** (xarray + netCDF4/h5py)
   - `.shp/.geojson/.gpkg` → **vector geo** (geopandas); `.tif/.tiff` → **raster** (rasterio/rioxarray)
   - unknown → inspect with `markitdown` or `file`, then ask the user

3. **Check the toolchain once** if you haven't this session:
   ```bash
   python .pi/skills/data-workflow/scripts/doctor.py
   ```
   If a required lib is missing, tell the user the install command (doctor `--fix` prints it; pure-Python via `uv`, native via `conda`/`pixi`) and stop until they install it or confirm to proceed. `netCDF4`/`geopandas`/`rasterio` failing on Windows is almost always a missing native dep — steer to conda/pixi, not pip.

4. **Load → Clean/Validate → Analyze → Visualize** (from the skill):
   - **Load** with the right loader; set `na_values=[-9999, 99999]` for station CSVs (hydrology sentinels); `parse_dates` and set the time index.
   - **Validate** with `scripts/validate_timeseries.py` — this is mandatory for station data. It enforces physical plausibility (discharge ≥ 0, rainfall in range, level within sensor range, spike detection) and writes a report. **Never `dropna()` without recording why**; regulatory review (防洪评价) asks.
   - **Analyze**: resample (sum for rainfall/flux, mean for level, max for peaks); for frequency analysis use `scripts/pearson3_freq.py` (Chinese SL 44 standard; scipy has no P-III); for model eval use NSE/KGE (`hydroeval` if installed, else manual).
   - **Visualize**: hydrograph (level line + rainfall inverted twin axis), flow duration curve (log-log), stage-discharge rating curve, frequency curve. Set a CJK font or labels render as tofu.

5. **Reproducibility** (regulatory hygiene — non-negotiable for hydrology):
   - Pin the environment (`uv pip freeze` or `conda env export`) committed with the script.
   - One script per figure/table; a reviewer runs `python fig3.py` and gets Figure 3.
   - Raw data is read-only; write derived data to `out/` or `processed/`.
   - Record provenance (station ID, source, download date) for every input.
   - Notebooks are for exploration only; promote to a script before a result is cited.

6. **Report** the data shape, the validation result (how many flagged, which rules), the analysis method and its parameters (e.g. `Cv=0.42, Cs=1.05` for P-III), and the output path. For frequency analysis, state the return periods and design values explicitly and note the sample size (n<30 → unreliable Cs, use a regional Cs/Cv ratio).

## Rules

- Physical plausibility errors (negative discharge, level out of range) are **flagged, not silently deleted**. State in the report how many values were flagged and the action taken.
- Never blind-fill long gaps. Short gaps (≤3 steps) may be interpolated; long gaps stay NaN with a documented reason.
- For Chinese (中文) figure labels, verify a CJK font is set — `matplotlib` without one renders 豆腐块.
- Don't install system/native packages (GDAL, HDF5) without telling the user; the doctor only *prints* install commands. Let the user run them.
- If `$ARGUMENTS` is empty or ambiguous, ask for the file path and the intended analysis before running anything.
- Frequency analysis with n<30: warn and prefer a regional `--cs-cv-ratio` over the sample Cs (SL 44 guidance).
