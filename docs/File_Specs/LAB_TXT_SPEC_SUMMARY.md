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
- Convert L* to CIE‑exact optical density and normalize by dataset max:
  - Relative luminance: `Y = ((L+16)/116)^3` if `L > 8`, else `Y = L/903.3`.
  - Optical density: `Draw = −log10(clamp(Y, ε, 1))`.
  - Normalized density: `D = Draw / max(Draw across dataset)`.
- Expected linear density baseline is `x`.
- Compute per‑point correction `C = x − D` and blend with an adaptive Gaussian kernel (σ(x) derived from median neighbor spacing). The kernel automatically smooths uneven data—no user slider required.
- Build 256 samples, clamping to [0,1] and pinning endpoints (samples[0]=0, samples[255]=1).
- Output object:
  - `{ domainMin: 0, domainMax: 1, samples, originalData, originalSamples, format: 'LAB Data', getSmoothingControlPoints(%) }`

Smoothing Control (pipeline hook)
- `getSmoothingControlPoints(%)` remains available for tooling/tests. When invoked with `sp>0`, it widens the kernel (legacy 0.08→0.25 range) and emits a reduced control-point set. The main UI no longer exposes a smoothing slider; the adaptive kernel keeps curves stable out of the box.

Implementation Notes
- Only LAB_L is used; LAB_A/B are ignored for linearization.
- The method applies corrections to a linear baseline; it does not attempt full ICC‑style color management.
- The result is a neutral correction curve to be combined with quadGEN’s printer‑space pipeline.

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
