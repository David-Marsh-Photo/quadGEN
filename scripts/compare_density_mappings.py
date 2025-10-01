#!/usr/bin/env python3
"""
Compare three L*→density mapping pipelines on a LAB measurement file:

  1) legacy  – min/max L* normalization (quadGEN current)
  2) cie     – CIE-exact luminance → optical density (−log10(Y)) normalized
  3) hybrid  – legacy in highlights, CIE elsewhere with a smooth transition

Input format: Color Muse style LAB .txt with header 'GRAY\tLAB_L\tLAB_A\tLAB_B'.

Outputs a textual report comparing:
  - Residual magnitudes by region (0–10%, 10–90%, 90–100%)
  - Mean |correction| by region (on 256-sample corrected curve)
  - Midtone slope at t=0.5
  - Pairwise RMS differences between corrected curves

Optionally writes CSV of the corrected curves.

Usage:
  python scripts/compare_density_mappings.py --input data/Color-Muse-Data.txt \
      [--sigma 0.15] [--threshold 0.12] [--rolloff 0.10] [--export-curves curves.csv]

"""
from __future__ import annotations
import argparse
import csv
import math
import os
import statistics
from dataclasses import dataclass
from typing import List, Tuple, Dict, Optional

EPS = 1e-6


# ---------- Parsing ----------

def parse_lab_txt(path: str) -> List[Tuple[float, float]]:
    """Parse Color Muse LAB .txt returning list of (input_percent, Lstar).
    Accepts tab or comma separated; ignores non-numeric rows.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Input file not found: {path}")
    pairs: List[Tuple[float, float]] = []
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            # Skip header line if it contains GRAY or LAB
            if i == 0 and ("GRAY" in line.upper() or "LAB" in line.upper()):
                continue
            # Split by tab or comma
            parts = [p.strip() for p in line.replace(',', '\t').split('\t') if p.strip()]
            if len(parts) < 2:
                continue
            try:
                x = float(parts[0])
                L = float(parts[1])
            except ValueError:
                continue
            if 0.0 <= x <= 100.0 and 0.0 <= L <= 100.0:
                pairs.append((x, L))
    if len(pairs) < 2:
        raise ValueError("Not enough rows parsed; expected at least 2 measurement pairs.")
    # Sort by input percent
    pairs.sort(key=lambda t: t[0])
    return pairs


# ---------- Mapping helpers ----------

def lstar_to_Y(L: float) -> float:
    """CIE inverse: L* -> relative luminance Y (0..1)."""
    if L > 8.0:
        f = (L + 16.0) / 116.0
        return f * f * f
    else:
        return L / 903.3


def Y_to_density(Y: float) -> float:
    """Optical density D = -log10(Y), with clamp."""
    Yc = max(EPS, min(1.0, Y))
    return -math.log10(Yc)


def density_legacy(L: float, Lmin: float, Lmax: float) -> float:
    r = max(EPS, (Lmax - Lmin))
    return 1.0 - (L - Lmin) / r


def density_cie_norm(L: float, Dmax: float) -> float:
    D = Y_to_density(lstar_to_Y(L))
    return (D / Dmax) if Dmax > EPS else 0.0


def smootherstep(x: float) -> float:
    # smooth C1 continuous step: 0->1 with zero slope at ends
    return x * x * x * (x * (6 * x - 15) + 10)


def w_highlight(pos: float, threshold: float, rolloff: float) -> float:
    x = (pos - threshold) / max(EPS, rolloff)
    x = max(0.0, min(1.0, x))
    s = smootherstep(x)
    return 1.0 - s


@dataclass
class HybridContext:
    Lmin: float
    Lmax: float
    Dmax: float
    threshold: float
    rolloff: float


def build_hybrid_ctx(L_values: List[float], threshold: float, rolloff: float) -> HybridContext:
    Lmin = min(L_values)
    Lmax = max(L_values)
    Dmax = max(Y_to_density(lstar_to_Y(L)) for L in L_values)
    return HybridContext(Lmin=Lmin, Lmax=Lmax, Dmax=Dmax, threshold=threshold, rolloff=rolloff)


def hybrid_density(L: float, pos: float, ctx: HybridContext) -> float:
    DL = density_legacy(L, ctx.Lmin, ctx.Lmax)
    DC = density_cie_norm(L, ctx.Dmax)
    w = w_highlight(pos, ctx.threshold, ctx.rolloff)
    return w * DL + (1.0 - w) * DC


# ---------- Reconstruction ----------

def gaussian_corrected_curve(positions: List[float], residuals: List[float], sigma: float) -> List[float]:
    """Gaussian-weighted reconstruction of corrected(t) sampled on 256 steps."""
    assert len(positions) == len(residuals)
    n = 256
    out = [0.0] * n
    sig2 = 2.0 * sigma * sigma
    for i in range(n):
        t = i / (n - 1)
        num = 0.0
        den = 0.0
        for p, r in zip(positions, residuals):
            d = abs(t - p)
            w = math.exp(-(d * d) / max(EPS, sig2))
            num += r * w
            den += w
        corr = (num / den) if den > 0 else 0.0
        out[i] = max(0.0, min(1.0, t + corr))
    # Anchor endpoints
    out[0] = 0.0
    out[-1] = 1.0
    return out


def _natural_cubic_second_derivatives(x: List[float], y: List[float]) -> List[float]:
    n = len(x)
    if n < 2:
        return [0.0] * n
    u = [0.0] * (n - 1)
    z = [0.0] * n
    # Natural spline boundary conditions: second[0] = second[n-1] = 0
    for i in range(1, n - 1):
        h_im1 = max(EPS, x[i] - x[i - 1])
        h_i = max(EPS, x[i + 1] - x[i])
        sig = h_im1 / (h_im1 + h_i)
        p = sig * z[i - 1] + 2.0
        z[i] = (sig - 1.0) / p
        dy_i = (y[i + 1] - y[i]) / h_i
        dy_im1 = (y[i] - y[i - 1]) / h_im1
        u[i] = (6.0 * (dy_i - dy_im1) / (h_im1 + h_i) - sig * u[i - 1]) / p
    second = [0.0] * n
    for j in range(n - 2, -1, -1):
        second[j] = z[j] * second[j + 1] + u[j]
    return second


def segment_cubic_corrected_curve(positions: List[float], residuals: List[float]) -> List[float]:
    """Reconstruct corrected(t) using a natural cubic spline over residuals, sampled at 256."""
    assert len(positions) == len(residuals)
    n = len(positions)
    if n == 0:
        return [i / 255.0 for i in range(256)]
    # Ensure strictly increasing x for spline
    xs, ys = zip(*sorted(zip(positions, residuals)))
    xs = list(xs)
    ys = list(ys)
    # Deduplicate coincident x by averaging residuals
    x_u: List[float] = []
    y_u: List[float] = []
    for x, y in zip(xs, ys):
        if not x_u or abs(x - x_u[-1]) > 1e-12:
            x_u.append(x)
            y_u.append(y)
        else:
            # average with last
            y_u[-1] = 0.5 * (y_u[-1] + y)
    if len(x_u) == 1:
        # Only one point; constant residual
        const_r = y_u[0]
        out = [max(0.0, min(1.0, (i / 255.0) + const_r)) for i in range(256)]
        out[0] = 0.0; out[-1] = 1.0
        return out
    second = _natural_cubic_second_derivatives(x_u, y_u)
    def interp_res(t: float) -> float:
        if t <= x_u[0]:
            return y_u[0]
        if t >= x_u[-1]:
            return y_u[-1]
        # binary search for interval
        lo, hi = 0, len(x_u) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if x_u[mid] <= t:
                lo = mid
            else:
                hi = mid
        h = max(EPS, x_u[lo + 1] - x_u[lo])
        A = (x_u[lo + 1] - t) / h
        B = (t - x_u[lo]) / h
        y = (A * y_u[lo] + B * y_u[lo + 1] +
             ((A**3 - A) * second[lo] + (B**3 - B) * second[lo + 1]) * (h * h) / 6.0)
        return y
    out = [0.0] * 256
    for i in range(256):
        t = i / 255.0
        r = interp_res(t)
        out[i] = max(0.0, min(1.0, t + r))
    out[0] = 0.0
    out[-1] = 1.0
    return out


# ---------- Pipelines ----------

@dataclass
class PipelineResult:
    name: str
    positions: List[float]
    expected: List[float]
    actual: List[float]
    residuals: List[float]
    corrected: List[float]


def run_pipeline(pairs: List[Tuple[float, float]], method: str, sigma: float, threshold: float, rolloff: float) -> PipelineResult:
    xs = [x for x, _ in pairs]
    Ls = [L for _, L in pairs]
    positions = [max(0.0, min(1.0, x / 100.0)) for x in xs]
    expected = positions[:]  # linear target in density domain

    if method == 'legacy':
        Lmin, Lmax = min(Ls), max(Ls)
        actual = [density_legacy(L, Lmin, Lmax) for L in Ls]
    elif method == 'cie':
        Dmax = max(Y_to_density(lstar_to_Y(L)) for L in Ls)
        actual = [density_cie_norm(L, Dmax) for L in Ls]
    elif method == 'hybrid':
        ctx = build_hybrid_ctx(Ls, threshold=threshold, rolloff=rolloff)
        actual = [hybrid_density(L, pos, ctx) for L, pos in zip(Ls, positions)]
    elif method in ('cie_cubic', 'segment_cubic'):
        # Same CIE-normalized mapping as 'cie'; different reconstruction later
        Dmax = max(Y_to_density(lstar_to_Y(L)) for L in Ls)
        actual = [density_cie_norm(L, Dmax) for L in Ls]
    elif method == 'pops':
        # POPS-like: approximate Y using exponent 2.978 (no piecewise), then D = -log10(Y)
        # No normalization of actual; scale expected to the same units via Dmax_pops
        def Y_pops(L: float) -> float:
            return ((L + 16.0) / 116.0) ** 2.978
        Dvals = [Y_to_density(Y_pops(L)) for L in Ls]
        Dmax_pops = max(Dvals) if Dvals else 1.0
        actual = Dvals[:]  # unnormalized actual densities
        # Scale expected to the same density units for a fair residual comparison
        expected = [p * Dmax_pops for p in positions]
    else:
        raise ValueError(f"Unknown method: {method}")

    residuals = [e - a for e, a in zip(expected, actual)]
    # Reconstruction method
    if method in ('legacy', 'cie', 'hybrid', 'pops'):
        corrected = gaussian_corrected_curve(positions, residuals, sigma=sigma)
    elif method in ('cie_cubic', 'segment_cubic'):
        corrected = segment_cubic_corrected_curve(positions, residuals)
    else:
        corrected = gaussian_corrected_curve(positions, residuals, sigma=sigma)

    return PipelineResult(name=method, positions=positions, expected=expected, actual=actual, residuals=residuals, corrected=corrected)


# ---------- Metrics & Report ----------

def region_mask(n: int, lo: float, hi: float) -> List[int]:
    idxs = []
    for i in range(n):
        t = i / (n - 1)
        if lo <= t <= hi:
            idxs.append(i)
    return idxs


def mean_abs(values: List[float]) -> float:
    return sum(abs(v) for v in values) / max(1, len(values))


def slope_at_mid(curve: List[float]) -> float:
    n = len(curve)
    i = n // 2
    # central difference over small window
    im1 = max(0, i - 1)
    ip1 = min(n - 1, i + 1)
    dt = (ip1 - im1) / (n - 1)
    if dt <= 0:
        return 0.0
    return (curve[ip1] - curve[im1]) / dt


def rms_diff(a: List[float], b: List[float]) -> float:
    n = min(len(a), len(b))
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(n)) / n)


def print_report(path: str, results: Dict[str, PipelineResult]):
    print(f"Input: {path}")
    N = len(next(iter(results.values())).corrected)
    # Regions
    idx_hi = region_mask(N, 0.0, 0.10)
    idx_mid = region_mask(N, 0.10, 0.90)
    idx_sh = region_mask(N, 0.90, 1.0)

    def region_stats(pr: PipelineResult):
        # Residuals are at measured points; compute grouped by position
        pos = pr.positions
        res = pr.residuals
        # Map measured residuals into regions by pos
        res_hi = [r for r, p in zip(res, pos) if p <= 0.10]
        res_mid = [r for r, p in zip(res, pos) if 0.10 < p < 0.90]
        res_sh = [r for r, p in zip(res, pos) if p >= 0.90]
        # Correction magnitudes from full curve
        corr = pr.corrected
        corr_hi = [corr[i] - (i / (N - 1)) for i in idx_hi]
        corr_mid = [corr[i] - (i / (N - 1)) for i in idx_mid]
        corr_sh = [corr[i] - (i / (N - 1)) for i in idx_sh]
        return {
            'residual_mean_abs_hi': mean_abs(res_hi),
            'residual_mean_abs_mid': mean_abs(res_mid),
            'residual_mean_abs_sh': mean_abs(res_sh),
            'corr_mean_abs_hi': mean_abs(corr_hi),
            'corr_mean_abs_mid': mean_abs(corr_mid),
            'corr_mean_abs_sh': mean_abs(corr_sh),
            'slope_mid': slope_at_mid(pr.corrected),
        }

    stats = {name: region_stats(pr) for name, pr in results.items()}

    # Pretty print
    print("\nResiduals (|expected − actual|) at measured points:")
    print("  method       highlights(0–10%)  mid(10–90%)  shadows(90–100%)")
    order = [n for n in ('legacy', 'hybrid', 'cie', 'pops', 'segment_cubic', 'cie_cubic') if n in results]
    for name in order:
        s = stats[name]
        print(f"  {name:<11} {s['residual_mean_abs_hi']:>9.5f}         {s['residual_mean_abs_mid']:>9.5f}      {s['residual_mean_abs_sh']:>9.5f}")

    print("\nCorrection curve magnitude (mean |corrected(t) − t|):")
    print("  method       highlights(0–10%)  mid(10–90%)  shadows(90–100%)")
    for name in order:
        s = stats[name]
        print(f"  {name:<11} {s['corr_mean_abs_hi']:>9.5f}         {s['corr_mean_abs_mid']:>9.5f}      {s['corr_mean_abs_sh']:>9.5f}")

    print("\nMidtone slope at t≈0.5 (1.0 = identity):")
    for name in order:
        s = stats[name]
        print(f"  {name:<11} {s['slope_mid']:.5f}")

    # Pairwise RMS differences between corrected curves
    pairs = []
    for i in range(len(order)):
        for j in range(i + 1, len(order)):
            pairs.append((order[i], order[j]))
    print("\nPairwise RMS difference between corrected curves:")
    for a, b in pairs:
        d = rms_diff(results[a].corrected, results[b].corrected)
        print(f"  {a:<11} vs {b:<6}: {d:.6f}")


def maybe_write_curves_csv(path: str, results: Dict[str, PipelineResult]):
    if not path:
        return
    fieldnames = ['t', 'legacy', 'hybrid', 'cie']
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        n = len(next(iter(results.values())).corrected)
        for i in range(n):
            t = i / (n - 1)
            row = {
                't': f"{t:.6f}",
                'legacy': f"{results['legacy'].corrected[i]:.6f}",
                'hybrid': f"{results['hybrid'].corrected[i]:.6f}",
                'cie': f"{results['cie'].corrected[i]:.6f}",
            }
            w.writerow(row)
    print(f"\nWrote corrected curves CSV: {path}")


def main():
    ap = argparse.ArgumentParser(description="Compare L*→density mapping pipelines on a LAB .txt file")
    ap.add_argument('--input', '-i', type=str, default='data/Color-Muse-Data.txt', help='Path to Color Muse LAB .txt (default: data/Color-Muse-Data.txt)')
    ap.add_argument('--sigma', type=float, default=0.15, help='Gaussian kernel radius (0..1)')
    ap.add_argument('--threshold', type=float, default=0.12, help='Hybrid: highlight threshold (0..1)')
    ap.add_argument('--rolloff', type=float, default=0.10, help='Hybrid: transition width (0..1)')
    ap.add_argument('--export-curves', type=str, default='', help='Optional CSV path to write 256-sample corrected curves')
    args = ap.parse_args()

    pairs = parse_lab_txt(args.input)

    results: Dict[str, PipelineResult] = {}
    for method in ('legacy', 'hybrid', 'cie', 'pops', 'segment_cubic'):
        results[method] = run_pipeline(pairs, method=method, sigma=args.sigma, threshold=args.threshold, rolloff=args.rolloff)

    print_report(args.input, results)
    if args.export_curves:
        maybe_write_curves_csv(args.export_curves, results)


if __name__ == '__main__':
    main()
