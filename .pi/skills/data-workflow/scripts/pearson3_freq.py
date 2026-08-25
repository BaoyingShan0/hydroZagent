#!/usr/bin/env python3
"""Pearson Type III frequency analysis (Chinese hydrology standard SL 44).

SL 44 《水利水电工程设计洪水计算规范》 specifies Pearson Type III as the
frequency distribution for design-flood / design-water-level computation.
scipy does NOT implement Pearson III directly; this script provides the
canonical implementation for this repo, verified against the standard P-III
frequency-factor table (金光炎《水文统计原理》; e.g. Cs=2,p=1% -> φ≈3.605).

Math:
  Pearson III = 3-parameter gamma: X ~ Gamma(shape=α, scale=β) shifted by τ.
    α = 4/Cs² ,  β = (Ex·Cv·Cs)/2 ,  τ = Ex·(1 - 2·Cv²/Cs)
  Standardized frequency factor φ_p (mean 0, std 1, skew Cs):
    u = (Cs/2)·φ + 1 ~ Gamma(α=4/Cs², scale=Cs²/4)
    -> φ_p = (2/Cs)·(gamma.ppf(1-p, α, scale=Cs²/4) - 1)   for Cs > 0
    -> by symmetry, φ(Cs<0, p) = -φ(-Cs, 1-p)
    -> Cs == 0 reduces to Normal: φ_p = norm.ppf(1-p)
  Design value: x_p = Ex · (1 + Cv · φ_p)
  Return period T, exceedance prob p = 1/T.

Fitting (method of moments, SL 44 default):
  Ex = mean,  Cv = std/mean,  Cs = skew  (Cs from sample; SL 44 often adjusts
  Cs via a "Cs/Cv ratio" from regional experience — pass --cs-cv-ratio R to set
  Cs = R·Cv). Gumbel (EV1) alternative for international comparison: --method gumbel.

Usage:
  python pearson3_freq.py amax.csv --value q --periods 10 20 50 100 200
  python pearson3_freq.py amax.csv --value q --periods 50 100 --plot freq.png
  python pearson3_freq.py amax.csv --value q --method gumbel --periods 100
  python pearson3_freq.py amax.csv --value q --cs-cv-ratio 2.5 --periods 100
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats  # norm, gamma, gumbel_r


def phi_pearson3(p, cs):
    """Pearson III frequency factor φ for exceedance probability p and skew Cs.
    p is exceedance prob (P[X>=x] = p). Returns φ such that x = Ex*(1 + Cv*φ).
    Verified: phi(0.01, 2.0) ≈ 3.605 (matches standard table)."""
    p = np.asarray(p, dtype=float)
    if cs == 0:
        return stats.norm.ppf(1.0 - p)
    if cs < 0:
        return -phi_pearson3(1.0 - p, -cs)
    alpha = 4.0 / (cs * cs)
    scale = (cs * cs) / 4.0
    u = stats.gamma.ppf(1.0 - p, a=alpha, scale=scale)   # P(U<=u)=1-p
    return (2.0 / cs) * (u - 1.0)


def fit_pearson3(x):
    """Method-of-moments fit: returns (Ex, Cv, Cs)."""
    ex = float(np.mean(x))
    cv = float(np.std(x, ddof=1) / ex) if ex != 0 else 0.0
    n = len(x)
    # sample skew (biased; SL 44 uses this then may adjust)
    s = np.std(x, ddof=1)
    cs = float(np.sum((x - ex) ** 3) / ((n - 1) * s ** 3)) if s > 0 else 0.0
    return ex, cv, cs


def design_pearson3(ex, cv, cs, periods):
    p = 1.0 / np.asarray(periods, dtype=float)
    phi = phi_pearson3(p, cs)
    xp = ex * (1.0 + cv * phi)
    return xp, phi, p


def design_gumbel(x, periods):
    """Gumbel (EV1) for international comparison. x_p = loc + scale * (-ln(-ln(1-1/T)))."""
    loc, scale = stats.gumbel_r.fit(x)
    p = 1.0 / np.asarray(periods, dtype=float)
    xp = stats.gumbel_r.ppf(1.0 - p, loc=loc, scale=scale)
    return xp, (loc, scale), p


def plot_curve(x, ex, cv, cs, periods, out):
    """Plot the frequency curve on P-III probability paper (normal-prob x-axis)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    matplotlib.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False

    ps = np.concatenate([np.linspace(0.001, 0.01, 20), np.linspace(0.01, 0.99, 80)])
    phi = phi_pearson3(ps, cs)
    xs = ex * (1.0 + cv * phi)

    fig, ax = plt.subplots(figsize=(8, 5.5))
    # P-III paper: use norm.ppf(1-p) as the x-axis transform
    xp = stats.norm.ppf(1.0 - ps)
    ax.plot(xp, xs, "b-", label=f"P-III  Cv={cv:.3f}  Cs={cs:.3f}")
    # empirical points (Gringorten plotting position)
    xs_emp = np.sort(x)[::-1]
    n = len(x)
    p_emp = np.arange(1, n + 1) / (n + 1)
    ax.plot(stats.norm.ppf(1.0 - p_emp), xs_emp, "ko", ms=4, label="empirical")
    # design points
    pd = 1.0 / np.asarray(periods, dtype=float)
    xd, _, _ = design_pearson3(ex, cv, cs, periods)
    ax.plot(stats.norm.ppf(1.0 - pd), xd, "r^", ms=8, label="design values")
    for T, v in zip(periods, xd):
        ax.annotate(f"T={T}\n{v:.1f}", (stats.norm.ppf(1.0 - 1.0 / T), v),
                    textcoords="offset points", xytext=(6, 4), fontsize=8)
    ticks_p = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 0.8, 0.9, 0.95, 0.99]
    ax.set_xticks(stats.norm.ppf(1.0 - np.array(ticks_p)))
    ax.set_xticklabels([f"{p*100:.0f}%" for p in ticks_p])
    ax.set_xlabel("频率 p (超出概率)")
    ax.set_ylabel("设计值 x")
    ax.set_title("皮尔逊III型频率曲线 (SL 44)")
    ax.grid(True, which="both", ls=":", alpha=0.4)
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(out, dpi=130)
    print(f"plot: {out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input", help="CSV with annual maxima (one value per year)")
    ap.add_argument("--value", default=None, help="value column (auto-detect: value/q/amax/洪峰)")
    ap.add_argument("--periods", type=int, nargs="+", default=[10, 20, 50, 100, 200],
                    help="return periods T (years); p=1/T")
    ap.add_argument("--cs-cv-ratio", type=float, default=None,
                    help="override Cs = ratio*Cv (SL 44 regional experience)")
    ap.add_argument("--method", choices=["pearson3", "gumbel"], default="pearson3")
    ap.add_argument("--plot", default=None, help="write a frequency-curve PNG here")
    ap.add_argument("--min-n", type=int, default=10,
                    help="minimum sample size (default 10); warn below 30")
    args = ap.parse_args()

    path = Path(args.input)
    if not path.exists():
        sys.exit(f"input not found: {path}")
    df = pd.read_csv(path)
    col = args.value
    if col is None:
        for c in ["value", "q", "Q", "amax", "洪峰", "peak", "flood"]:
            if c in df.columns:
                col = c
                break
    if col is None:
        col = df.select_dtypes(include="number").columns[0]
        print(f"# auto-selected value column: {col}", file=sys.stderr)
    x = pd.to_numeric(df[col], errors="coerce").dropna().to_numpy(dtype=float)
    n = len(x)
    if n < args.min_n:
        sys.exit(f"sample size {n} < {args.min_n}; frequency analysis unreliable")

    print(f"# Pearson III / SL 44 frequency analysis")
    print(f"# input: {path.name}   column: {col}   n: {n}")
    if n < 30:
        print(f"# WARNING: n={n}<30; SL 44 recommends >=30 for stable Cs. "
              f"Consider a --cs-cv-ratio from regional data.", file=sys.stderr)

    periods = args.periods
    if args.method == "gumbel":
        xp, params, p = design_gumbel(x, periods)
        ex, cv, cs = float(np.mean(x)), float(np.std(x, ddof=1) / np.mean(x)), float(stats.skew(x))
        print(f"# method: Gumbel (EV1)   loc={params[0]:.4f}  scale={params[1]:.4f}")
        print(f"# sample stats: Ex={ex:.4f}  Cv={cv:.4f}  Cs={cs:.4f}")
    else:
        ex, cv, cs = fit_pearson3(x)
        if args.cs_cv_ratio is not None:
            cs = args.cs_cv_ratio * cv
            print(f"# Cs overridden by --cs-cv-ratio: Cs = {args.cs_cv_ratio} * Cv = {cs:.4f}")
        xp, phi, p = design_pearson3(ex, cv, cs, periods)
        print(f"# method: Pearson III (SL 44)   Ex={ex:.4f}  Cv={cv:.4f}  Cs={cs:.4f}")

    print()
    print(f"{'T(yr)':<8} {'p':<10} {'φ':<10} {'design x':<14}")
    print("-" * 44)
    for T, pp, v in zip(periods, p, xp):
        phi_str = f"{phi_pearson3([pp], cs)[0]:.4f}" if args.method == "pearson3" else "-"
        print(f"{T:<8} {1.0/T:<10.4f} {phi_str:<10} {v:<14.4f}")

    if args.plot:
        plot_curve(x, ex, cv, cs, periods, args.plot)


if __name__ == "__main__":
    main()
