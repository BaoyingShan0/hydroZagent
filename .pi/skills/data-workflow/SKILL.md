---
name: data-workflow
description: "Load, clean, validate, analyze, and visualize hydrology/scientific data — time series (water level, rainfall, discharge), gridded data (NetCDF/HDF5: ERA5, GFS, reanalysis), and geospatial data (shapefiles, rasters/DEM). Use whenever the user works with .csv/.tsv/.xlsx of station observations, .nc/.nc4/.h5/.hdf5 of gridded met/hydro fields, .shp/.geojson/.tif of basins/DEMs, or asks to clean/resample/gap-fill/validate/plot hydrological data. Includes hydrology-specific physical-plausibility validation (discharge>=0, level within sensor range, no impossible jumps), hydrograph/hyetograph/duration-curve plotting, and Chinese-standard Pearson-III frequency analysis (SL 44, return periods). Triggers: '水情数据', '雨量', '水位', '流量', '时间序列', '清洗数据', '缺测', 'NetCDF', 'ERA5', '频率分析', '重现期', '皮尔逊III型', 'hydrograph', 'resample', 'validate'."
license: MIT
---

# Scientific data workflow for hydrology

Hydrology data work is three shapes (tabular time series, gridded multi-dim, geospatial) × four operations (load, clean/validate, analyze, visualize). This skill gives one canonical path for each, with **hydrology-specific validation rules** and **Chinese-standard frequency analysis** that generic data skills omit.

> Script paths are relative to this skill's directory. Helper scripts: `scripts/doctor.py` (toolchain), `scripts/validate_timeseries.py` (physical-plausibility validator), `scripts/pearson3_freq.py` (Pearson III frequency curve — SL 44 standard).

## 0. First run: check the toolchain

```bash
python scripts/doctor.py          # report; exit 1 if a required lib is missing
python scripts/doctor.py --fix    # print install commands (uv / conda / pip)
```

Core (installed on most machines): `numpy`, `pandas`, `scipy`, `matplotlib`. Gridded data needs `xarray` + `netCDF4`/`h5py` (often missing — native deps). Geo needs `geopandas`/`rasterio`/`shapely`/`pyproj` (need GDAL/proj). Hydrology model-eval: `hydroeval`/`HydroErr` (pip).

**Environment strategy (important):** pure-Python libs → `uv` (fast, the mitsupi `uv` skill wraps it). But `netCDF4`/`h5py`/`geopandas`/`rasterio` have native deps (HDF5, GDAL, proj) that `pip` builds poorly on Windows. For those use **conda** or **pixi** — they ship the native libs. Pick one env per project and pin it; reproducibility matters for regulatory work (防洪标准 review).

```bash
# pure Python (fast, no native deps):
uv pip install pandas scipy matplotlib seaborn hydroeval HydroErr
# needs native libs (NetCDF/HDF5/GDAL — use conda/pixi on Windows):
conda install -c conda-forge xarray netCDF4 h5py geopandas rasterio cartopy
#   or: pixi add xarray netCDF4 h5py geopandas rasterio cartopy
```

## 1. Load

| Shape | Format | Loader | Gotcha |
|---|---|---|---|
| Tabular | CSV/TSV | `pd.read_csv(path, parse_dates=['time'])` | Set `na_values=[-9999,99999,9999]` — hydrology uses sentinels heavily |
| Tabular | Excel | `pd.read_excel(path, sheet_name='...')` | Multi-header rows: `header=[0,1]` then `MultiIndex` |
| Gridded | NetCDF | `xr.open_dataset(path)` | Lazy by default; `.load()` to force. Close with `.close()` or use `with xr.open_dataset(...) as ds:` |
| Gridded | HDF5 | `h5py.File(path)` or `xr.open_dataset` | ERA5 `.nc` from CDS is NetCDF4 (HDF5-based); needs `netCDF4` or `h5netcdf` |
| Geo | Shapefile | `gpd.read_file(path)` | Reproject to a projected CRS (e.g. EPSG:32649 UTM) before computing areas/distances |
| Geo | Raster (DEM/GeoTIFF) | `rasterio.open(path)` or `rxr.open_rasterio(path)` | Check `crs`, `transform`, nodata value; mask nodata before stats |

```python
import pandas as pd, xarray as xr, geopandas as gpd, rasterio
# Water-level time series with the common -9999 missing sentinel:
df = pd.read_csv("level.csv", parse_dates=["tm"], na_values=[-9999, 99999]).set_index("tm")
# ERA5 rainfall (NetCDF): time x lat x lon
ds = xr.open_dataset("era5_tp_2023.nc")        # tp in m, accumulate to daily
# Basin boundary:
basin = gpd.read_file("basin.shp").to_crs(32649)  # UTM 49N for east China
```

## 2. Clean & validate (hydrology-specific)

Hydrology data has **physical constraints** that generic "drop NaN" cleaning violates. A discharge of -5 is never "just noise" — it's a sensor fault and must be flagged, not silently dropped. Run `scripts/validate_timeseries.py` for an automated pass; the rules it encodes:

| Variable | Rule | Action |
|---|---|---|
| discharge Q | `Q >= 0` | negative → flag, set NaN (don't delete) |
| water level H | within `[Hmin, Hmax]` sensor range | out-of-range → flag |
| rainfall P | `0 <= P <= Pmax` (e.g. 500 mm/step) | negative → 0; > Pmax → flag (gauge tip error) |
| any series | rate-of-change within physical bound | spike → flag (not auto-delete) |
| any series | gap length > threshold | report; choose fill (interpolate / model / leave) |
| timestamps | monotonic, no dupes, expected freq | resample/reindex to canonical freq |

```bash
# Validate a CSV: columns tm, level, rain, q  (auto-detects by name)
python scripts/validate_timeseries.py station.csv --time tm \
    --level level --rain rain --q q --report station.report.txt
```

```python
# Manual cleaning pattern (transparent, reproducible):
df = df.sort_index()
df = df[~df.index.duplicated(keep="first")]
df = df.asfreq("h")                          # canonical hourly index, NaNs for gaps
df.loc[df["q"] < 0, "q"] = pd.NA             # flag physically impossible
df["q"] = df["q"].interpolate(limit=3)       # fill only short gaps (<=3 steps)
# long gaps: leave NaN, report, decide with domain knowledge — never blind-fill
```

**Never** `df.dropna()` without a reason — record why each value is missing. Regulatory review (防洪评价) asks.

## 3. Analyze

### Resampling (the most common op)
```python
df_day = df.resample("D").agg({"rain": "sum", "level": "mean", "q": "mean"})
df_mon = df.resample("MS").agg({"rain": "sum", "level": "mean", "q": "mean"})
# annual maxima for frequency analysis:
annual_max = df["q"].resample("YE").max()    # YE = year-end (pandas >=2.2; was 'A' before)
```
Rule: **sum** for rainfall/flux accumulation, **mean** for level/state, **max** for peaks/extremes.

### Gridded regional extraction
```python
# ERA5 tp is (time, lat, lon); clip to basin, area-average, accumulate to daily
import regionmask  # or shapely clip
mask = regionmask.from_geopandas(basin).mask(ds)
ds_basin = ds.where(mask == 0)
tp_daily = ds_basin["tp"].resample(time="1D").sum() * 1000   # m -> mm
ts = tp_daily.mean(dim=["lat", "lon"])                        # basin-average series
```

### Hydrological statistics
- **Return period / frequency analysis** — Chinese standard is **Pearson Type III** (SL 44 《水利水电工程设计洪水计算规范》). Use `scripts/pearson3_freq.py`; scipy has no P-III. Gumbel (EV1) is the international alternative for comparison.
- **Model evaluation** — NSE, KGE, log-NSE, RMSE. Use `hydroeval`/`HydroErr` if installed; manual NSE = `1 - sum((obs-sim)^2)/sum((obs-mean(obs))^2)`.
- **Rating curve** (stage-discharge) — power law `Q = a*(H-H0)^b`, fit via `scipy.optimize.curve_fit` on log-transformed values.

## 4. Visualize (hydrology canonical plots)

| Plot | What | Code sketch |
|---|---|---|
| **Hydrograph** 水位过程线 | level line + rainfall bars (inverted, twin axis) | `ax1.plot(t, level); ax2=twinx(); ax2.bar(t, rain); ax2.invert_yaxis()` |
| **Hyetograph** 雨量柱状图 | rainfall bars over time | `ax.bar(t, rain, width=1/24)` |
| **Flow duration curve** 流量历时曲线 | sorted Q vs exceedance prob, log-log | `q_sorted=np.sort(q)[::-1]; p=np.arange(1,len(q)+1)/(len(q)+1); loglog(p,q_sorted)` |
| **Stage-discharge** 水位-流量关系 | H vs Q scatter + fitted rating curve | `scatter(H,Q); plot(H, a*(H-H0)**b)` |
| **Frequency curve** 频率曲线 | annual max vs return period on Pearson-III-probability paper | `scripts/pearson3_freq.py --plot` |
| **Duration curves / exceedance** | % time exceeded | sorted descending vs rank/len |

**CJK labels:** set `matplotlib` font to a CJK font or labels render as boxes.
```python
import matplotlib
matplotlib.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "PingFang SC"]
matplotlib.rcParams["axes.unicode_minus"] = False
```

## 5. Pearson III frequency analysis (SL 44 standard)

```bash
# Annual maxima in a CSV (one value per year), compute design values for return periods
python scripts/pearson3_freq.py amax.csv --value q --periods 10 20 50 100 200 --plot freq.png
```

The script fits Pearson III (Ex, Cv, Cs by method of moments with Cs adjusted per SL 44 if you pass `--lc`), prints design values `x_p` for each return period T (p = 1/T), and optionally plots the frequency curve on Pearson-III probability paper. This is the Chinese national standard for design-flood computation; scipy does not implement it, so this script is the canonical reference for this repo.

For international work, Gumbel (EV1) is in `scipy.stats.gumbel_r` — use `pearson3_freq.py --method gumbel` for comparison.

## 6. Reproducibility (regulatory hygiene)

Hydrology results often feed regulatory submissions (防洪评价, 水资源论证). Make every analysis reproducible:

- **Pin the environment**: `uv pip freeze > requirements.txt` (or `conda env export`) committed alongside the script.
- **One script per figure/table**: a reviewer runs `python fig3_hydrograph.py` and gets Figure 3. No notebook-only paths.
- **Raw data is read-only**: never mutate input files; write cleaned/derived data to a separate `out/` or `processed/` dir.
- **Record data provenance**: a comment or sidecar noting source (station ID, download date, CDS request) for every input.
- **Notebooks are for exploration; scripts are for delivery.** Promote a notebook to a script before it produces a result anyone else will cite.

## Dependencies

Python: `numpy`, `pandas`, `scipy`, `matplotlib`, `seaborn`, `xarray`, `netCDF4`/`h5netcdf`, `h5py`, `geopandas`, `rasterio`, `shapely`, `pyproj`, `cartopy` (maps), `regionmask`, `hydroeval`, `HydroErr`. Native (via conda/pixi on Windows): GDAL, proj, HDF5. Env tools: `uv` (pure Python), `conda`/`pixi` (native deps). See `scripts/doctor.py`.
