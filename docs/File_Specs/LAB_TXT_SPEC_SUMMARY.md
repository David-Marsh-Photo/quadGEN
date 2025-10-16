# LAB Measurement (.txt) – Developer Reference (for quadGEN)

Purpose
- Define the simple text format quadGEN accepts for LAB measurement data and how it is transformed into a correction curve.

Expected Input Format
- Plain text; header row required.
- Header must contain `GRAY` and `LAB_L` tokens (case-sensitive in current code path):
  - Example header: `GRAY\tLAB_L\tLAB_A\tLAB_B`
- Data rows: whitespace- or tab-separated columns:
  - Column 1: GRAY percent (0..100)
  - Column 2: LAB_L (L* value, 0..100)
  - Optional columns: LAB_A, LAB_B (ignored by quadGEN parser)
- Comments and blanks:
  - Lines starting with `#` or `//` are ignored
  - Empty lines are ignored

Parsing & Validation
- Rows with valid 0..100 values for both GRAY and LAB_L are kept.
- At least 2 valid data points are required.
- Points are sorted by GRAY percentage.

Curve Construction (Adaptive Gaussian reconstruction)
- Normalize GRAY to 0..1 → position x.
- Perceptual vs log-density:
  - **Perceptual (default)**: `actual = (L^*_{\max} - L^*) / (L^*_{\max} - L^*_{\min})`.
  - **Log-density (toggle)**: convert to CIE luminance `Y`, optical density `Draw = −log10(clamp(Y, ε, 1))`, then normalize by dataset min/max `D = (Draw - \min(Draw)) / (\max(Draw) - \min(Draw))`.
- Expected baseline is `x` in either case.
- Compute per‑point correction `C = x − actual` and blend with an adaptive Gaussian kernel (σ(x) derived from median neighbor spacing). The kernel automatically smooths uneven data; the Options panel slider lets you widen or tighten the kernel (0–300 %).
- Build 256 samples, clamping to [0,1] and pinning endpoints (samples[0]=0, samples[255]=1).
- Output object:
  - `{ domainMin: 0, domainMax: 1, samples, originalData, originalSamples, format: 'LAB Data', getSmoothingControlPoints(%) }`
- When the smoothing slider is set to **0 %**, quadGEN now bypasses the Gaussian blend entirely so perfectly linear measurement ramps (e.g., the `linear_reference_lab.txt` fixture) pass through untouched; monotonic enforcement still prevents reversals.

Smoothing Control (pipeline hook)
- `getSmoothingControlPoints(%)` remains available for tooling/tests. When invoked with `sp>0`, it widens the kernel (legacy 0.08→0.25 range) and emits a reduced control-point set. The Options panel slider writes the same parameter, so production users can dial in additional smoothing without leaving the UI.

Implementation Notes
- Only LAB_L is used; LAB_A/B are ignored for linearization.
- The method applies corrections to a linear baseline; it does not attempt full ICC‑style color management.
- The result is a neutral correction curve to be combined with quadGEN’s printer‑space pipeline.
- The **Simple Scaling** pipeline is the default consumer of these samples: it multiplies each channel’s plotted curve by a smoothed gain envelope with ±15 % clamps (K/MK fixed) and redistributes overflow into darker reserves. Switch to the **Density Solver** pipeline from ⚙️ Options when you need the ladder-based redistribution described below.
- When the **Density Solver** pipeline is enabled (⚙️ Options → Correction method), the normalized ramp and its incremental density deltas feed the density solver described in `docs/features/channel-density-solver.md`. The solver:
  - Computes `ΔDensity` between successive samples (perceptual or log-density depending on the import toggle).
  - Cross-references the active `.quad` curves to calculate channel share at each sample (`draw_channel / Σ draw_all`).
  - Finds dominance windows per channel to establish a **density constant**—the maximum darkening that ink has demonstrated on its own.
  - Forms the correction delta as **targetDensity − measuredDensity** (the baseline composite density is no longer the driver).
  - Distributes mixed intervals by weighting shares with the density constants and using those weights strictly as a funnel: headroom, ceilings, and ink availability remain the guardrails, so a zero delta stays zero for every channel.
  - Records cumulative contributions, measurement deltas, and per-sample share tables for debugging.
- The solver output is stored on `compositeLabSession` as `densityWeights`, `densityConstants`, `measurementDeltas`, `densityProfiles`, and `densityInputs`. The UI exposes `window.getCompositeDensityProfile(inputPercent)` so operators can inspect the constants and the per-sample redistribution used during global corrections.

Minimal Valid Skeleton (that quadGEN will load)
```
# GRAY and LAB_L must be present in the header
GRAY\tLAB_L\tLAB_A\tLAB_B
0\t97.0\t0.0\t0.0
50\t50.0\t0.0\t0.0
100\t3.0\t0.0\t0.0
```

Notes
- Separator can be tabs or spaces; values must be numeric and within 0..100.
- At least two valid rows are required; three (0, mid, 100) is recommended.
