#!/usr/bin/env python3
"""Physical-plausibility validator for hydrology time-series CSVs.

Hydrology data has physical constraints generic "drop NaN" cleaning violates:
discharge can't be negative, rainfall can't be negative, water level must be
within its sensor range, and spikes must be FLAGGED not silently deleted
(regulatory review asks why a value is missing). This script encodes those
rules and produces a report; it does not mutate the input by default.

Usage:
  python validate_timeseries.py station.csv --time tm \\
      --level level --rain rain --q q --report station.report.txt
  python validate_timeseries.py station.csv --time tm --q q --fix -o cleaned.csv

Rules (override thresholds on the CLI; sensible hydrology defaults):
  discharge q:   q >= 0                       ; negatives flagged
  rainfall rain: 0 <= rain <= --rain-max 500  ; negatives->0, >max flagged
  level:         --level-min/-max (or infer 3*std) ; out-of-range flagged
  any numeric:   |Δ| <= --rate-std 8*std      ; spikes flagged (rate-of-change)
  timestamps:    monotonic, unique, regular freq; gaps reported

Exit code 0 = clean, 1 = issues found (always writes report), 2 = usage error.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def find_col(df, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    return None


def validate(df, cols, time_col, args):
    issues = []  # (severity, col, rule, count, detail)

    # --- timestamps ---
    t = pd.to_datetime(df[time_col], errors="coerce")
    if t.isna().any():
        issues.append(("error", time_col, "unparseable_timestamp", int(t.isna().sum()),
                       f"{int(t.isna().sum())} rows failed to parse as datetime"))
    df = df.assign(_t=t).sort_values("_t")
    dupes = df["_t"].duplicated().sum()
    if dupes:
        issues.append(("warn", time_col, "duplicate_timestamp", int(dupes),
                       f"{int(dupes)} duplicate timestamps; keep first when --fix"))
    dt = df["_t"].diff().dropna()
    if len(dt) > 0:
        med = dt.median()
        gaps = dt[dt > med * 3]
        if len(gaps):
            issues.append(("warn", time_col, "gap", len(gaps),
                           f"{len(gaps)} intervals > 3x median ({med}); "
                           f"largest gap {dt.max()}"))
        irregular = (dt != med).sum()
        if irregular > len(dt) * 0.05:
            issues.append(("info", time_col, "irregular_freq", int(irregular),
                           f"{int(irregular)} of {len(dt)} steps differ from median {med}"))

    # --- per-variable physical checks ---
    for label, col in [("q", cols.get("q")), ("level", cols.get("level")), ("rain", cols.get("rain"))]:
        if not col or col not in df.columns:
            continue
        s = pd.to_numeric(df[col], errors="coerce")
        n_bad_num = s.isna().sum() - df[col].isna().sum()
        if n_bad_num > 0:
            issues.append(("error", col, "non_numeric", int(n_bad_num),
                           f"{int(n_bad_num)} values not numeric"))
        if label == "q":
            neg = (s < 0).sum()
            if neg:
                issues.append(("error", col, "negative_discharge", int(neg),
                               f"{int(neg)} negative discharge values (physically impossible)"))
        elif label == "rain":
            neg = (s < 0).sum()
            if neg:
                issues.append(("error", col, "negative_rainfall", int(neg),
                               f"{int(neg)} negative rainfall; set to 0 when --fix"))
            too_big = (s > args.rain_max).sum()
            if too_big:
                issues.append(("warn", col, "rain_exceeds_max", int(too_big),
                               f"{int(too_big)} values > {args.rain_max} (gauge-tip error likely)"))
        elif label == "level":
            lo = args.level_min if args.level_min is not None else (s.mean() - 3 * s.std())
            hi = args.level_max if args.level_max is not None else (s.mean() + 3 * s.std())
            oob = ((s < lo) | (s > hi)).sum()
            if oob:
                issues.append(("warn", col, "level_out_of_range", int(oob),
                               f"{int(oob)} values outside [{lo:.2f}, {hi:.2f}]"))

        # rate-of-change spike check (any numeric series)
        if len(s) > 2 and s.notna().sum() > 2:
            d = s.diff().abs()
            mu, sd = d.mean(), d.std()
            if sd > 0:
                spikes = (d > mu + args.rate_std * sd).sum()
                if spikes:
                    issues.append(("warn", col, "spike", int(spikes),
                                   f"{int(spikes)} steps jump > {args.rate_std}σ of Δ "
                                   f"(μ={mu:.3g}, σ={sd:.3g}); flag, do not auto-delete"))

    return df, issues


def apply_fixes(df, cols, issues, time_col):
    """Apply the safe, unambiguous fixes; leave ambiguous values as NaN.
    Dedup is on the parsed timestamp, not the row index (real CSVs have unique
    row indexes even when timestamps repeat)."""
    out = df.copy()
    out["_t"] = pd.to_datetime(out[time_col], errors="coerce")
    out = out.sort_values("_t")
    out = out[~out["_t"].duplicated(keep="first")]
    for _, col in cols.items():
        if not col or col not in out.columns:
            continue
        s = pd.to_numeric(out[col], errors="coerce")
        if col == cols.get("rain"):
            s = s.mask(s < 0, 0.0)            # negative rain -> 0
        if col == cols.get("q"):
            s = s.mask(s < 0, np.nan)         # negative Q -> NaN (flagged)
        out[col] = s
    out = out.drop(columns=["_t"])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input")
    ap.add_argument("--time", default=None, help="datetime column (auto-detect: tm/time/datetime/date/时间)")
    ap.add_argument("--q", default=None, help="discharge column (auto-detect: q/Q/flow/流量/discharge)")
    ap.add_argument("--level", default=None, help="water level column (auto-detect: level/H/z/水位/stage)")
    ap.add_argument("--rain", default=None, help="rainfall column (auto-detect: rain/p/tp/雨量/precip)")
    ap.add_argument("--rain-max", type=float, default=500.0, help="max plausible rainfall per step (mm)")
    ap.add_argument("--level-min", type=float, default=None)
    ap.add_argument("--level-max", type=float, default=None)
    ap.add_argument("--rate-std", type=float, default=8.0, help="spike threshold in σ of Δ")
    ap.add_argument("--report", default=None, help="write a text report here (default: stdout)")
    ap.add_argument("--fix", action="store_true", help="apply safe fixes and write cleaned CSV")
    ap.add_argument("-o", "--out", default=None, help="output CSV when --fix")
    args = ap.parse_args()

    path = Path(args.input)
    if not path.exists():
        sys.exit(f"input not found: {path}")
    df = pd.read_csv(path)

    time_col = args.time or find_col(df, ["tm", "time", "datetime", "date", "时间", "日期"])
    if not time_col:
        sys.exit("no time column found; pass --time <col>")
    cols = {
        "q": args.q or find_col(df, ["q", "Q", "flow", "流量", "discharge"]),
        "level": args.level or find_col(df, ["level", "H", "z", "水位", "stage"]),
        "rain": args.rain or find_col(df, ["rain", "p", "tp", "雨量", "precip", "precipitation"]),
    }
    cols = {k: v for k, v in cols.items() if v}

    df, issues = validate(df, cols, time_col, args)

    lines = [f"# Validation report: {path.name}",
             f"# rows: {len(df)}   columns checked: {', '.join(cols.values()) or '(none matched)'}",
             ""]
    if not issues:
        lines.append("No issues found.")
    else:
        lines.append(f"{'sev':<6} {'column':<16} {'rule':<22} count  detail")
        lines.append("-" * 90)
        for sev, col, rule, n, detail in sorted(issues, key=lambda x: (x[0] != "error", x[1])):
            lines.append(f"{sev:<6} {col:<16} {rule:<22} {n:<6} {detail}")
    report = "\n".join(lines) + "\n"
    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
        print(f"report: {args.report}")
    else:
        print(report)

    if args.fix:
        if not args.out:
            sys.exit("--fix requires -o <output.csv>")
        fixed = apply_fixes(df, cols, issues, time_col)
        fixed.to_csv(args.out, index=False)
        print(f"cleaned: {args.out}  ({len(fixed)} rows)")

    sys.exit(1 if any(i[0] == "error" for i in issues) else 0)


if __name__ == "__main__":
    main()
