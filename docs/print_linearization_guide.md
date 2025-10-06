
# Print Linearization from Measured L* — Practical Guide

## Purpose
Define a repeatable method to turn **measured L*** values from a printed step‑wedge into a **correction curve** (LUT) that yields perceptually linear tone reproduction (equal L* spacing per input step). Tone is treated in **printer space** (0% = paper white, 100% = max ink).

## Workflow (concise)
1. **Print** a step‑wedge with known nominal inputs (e.g., 0, 5, …, 100%).
2. **Measure** each patch’s **L*** with a device (e.g., Color Muse, i1Pro2).
3. **Normalize & orient** the data so that the working curve is monotone with X=input% → Y=response.
4. **Compute target**: desired response is a straight line (linear in L*, typically 100→0 across 0→100% input).
5. **Build correction** by **inverting** the measured response to map nominal input to the adjusted input that hits the linear target.
6. **Apply** the correction as a 1D LUT (e.g., 256 samples) during printing.
7. **Iterate**: reprint the wedge with the correction applied, re‑measure, refine.

## Mathematical summary
Let the nominal inputs be \(x_i \in [0,100]\) and measured lightness \(L^*_i\). We want output that is linear in L* versus input, i.e. a target function \(L^*_{\text{target}}(x) = 100 - x\).

Convert discrete measurements into a monotone response function \(f\): \(x\mapsto L^*\). (Use interpolation between samples.) The required **correction** is the inverse mapping from target to the input that produces it:

\[ x_{\text{adj}}(x) = f^{-1}\big( L^*_{\text{target}}(x) \big). \]

In practice (discrete, noisy data), we:
- Interpolate \(f\) (piecewise‑linear or PCHIP/monotone cubic).
- Numerically invert by swapping axes and interpolating again.
- Tabulate \(x_{\text{adj}}\) at uniform inputs to form the LUT.

### Optional density mapping
Some workflows transform L* to **relative optical density** to stabilize shadow behavior:
\[ Y \approx \left(\frac{L^*}{100}\right)^\gamma \quad(\gamma\approx 2.4 \text{ for sRGB}),\quad D = -\log_{10}(Y),\quad D_{rel} = D/\max(D). \]
You may perform the inversion in \(D_{rel}\) instead of L*. The code below provides both paths.

## Algorithm (implementation notes)
- Use **monotone interpolation**; if data are noisy, smooth minimally.
- Enforce endpoints: \(x=0\Rightarrow x_{adj}=0\), \(x=100\Rightarrow x_{adj}=100\).
- Export a **256‑sample** LUT for integration into printing pipelines.

### Active-range mapping (quadGEN feature flag)
- QuadToneRIP reference workflows normalize linearization within each channel’s **active ink span**. quadGEN mirrors this behavior behind the `ENABLE_ACTIVE_RANGE_LINEARIZATION` flag (toggle via `enableActiveRangeLinearization(true)`).
- The active-range path:
  - Detects the channel’s active indices (first/last non-zero ink samples) and the equivalent range in the LUT targets.
  - Reprojects the target curve across that span so delayed-onset channels can compress (later starts) and early channels can expand while the zero plateau stays untouched.
  - Enforces monotonic output with `enforceMonotonic()` after remapping to avoid banding or reversals.
- When the flag is **off**, quadGEN retains the legacy fixed-domain behavior (same correction applied at every 0–100% input). Enable the flag when validating active-range parity against DNPRO/POPS data; leave it off during legacy comparisons.

## Python example
Reads a CSV with columns: `input_percent,Lstar`. Produces a 256‑sample correction LUT (`x_adj[0..255]`) mapping nominal input 0..100 to adjusted input 0..100.

```python
import csv
import math
import numpy as np

def read_measurements(csv_path):
    xs, Ls = [], []
    with open(csv_path, newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            xs.append(float(row['input_percent']))
            Ls.append(float(row['Lstar']))
    xs = np.array(xs, dtype=float)
    Ls = np.array(Ls, dtype=float)
    # sort by input just in case
    order = np.argsort(xs)
    return xs[order], Ls[order]

def lstar_to_rel_density(Lstar, gamma=2.4):
    # Convert L* to an approximate luminance proxy, then to relative density
    # L* ~ 100 * (Y)^(1/gamma)  =>  Y ~ (L*/100)^gamma  (approx)
    Y = np.clip((np.maximum(Lstar, 0.0)/100.0)**gamma, 1e-6, 1.0)
    D = -np.log10(Y)
    Dmax = np.max(D)
    return D / (Dmax if Dmax > 0 else 1.0)

def build_correction(xs, Ls, use_density=False):
    xs = np.asarray(xs, float)    # inputs in %
    Ls = np.asarray(Ls, float)    # measured L*
    # Ensure monotonic orientation (printer space): input 0=white (high L*), 100=black (low L*)
    # If not monotone decreasing, enforce by sorting by x and optionally smoothing.
    # Interpolate measured response at uniform input grid
    x_grid = np.linspace(0, 100, 256)
    L_grid = np.interp(x_grid, xs, Ls)

    if use_density:
        m_grid = lstar_to_rel_density(L_grid)             # 0..1, increasing with ink
        target = np.linspace(0, 1, 256)                   # linear in density
    else:
        # Linear target in L*: 100→0 across 0→100
        target = np.linspace(100.0, 0.0, 256)
        m_grid = L_grid

    # Build inverse by swapping axes: we have x_grid -> m_grid
    # We want x_adj(x) such that m_grid(x_adj) = target(x).
    # Guard monotonicity for inversion
    # If m_grid not strictly monotone, enforce by tiny epsilon ramp
    mg = np.array(m_grid, float)
    # Make it strictly monotone by cumulative maximum/minimum in the expected direction
    if mg[0] < mg[-1]:
        # increasing
        for i in range(1, len(mg)):
            if mg[i] < mg[i-1]:
                mg[i] = mg[i-1]
        inv_x = np.interp(target, mg, x_grid, left=0.0, right=100.0)
    else:
        # decreasing
        for i in range(1, len(mg)):
            if mg[i] > mg[i-1]:
                mg[i] = mg[i-1]
        inv_x = np.interp(target, mg[::-1], x_grid[::-1], left=0.0, right=100.0)

    # Ensure endpoints anchored
    inv_x[0] = 0.0
    inv_x[-1] = 100.0
    # Optional: slight smoothing to remove stair-steps while preserving monotonicity
    # Here we just clip to be non-decreasing
    inv_x = np.maximum.accumulate(inv_x)

    return x_grid, inv_x  # nominal inputs, adjusted inputs

if __name__ == "__main__":
    # Example usage
    # Sample synthetic data (replace with your CSV)
    xs = np.array([0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], float)
    Ls = np.array([100, 97, 94, 88, 82, 75, 67, 58, 48, 36, 22, 8], float)

    # Compute correction in L* domain
    x_grid, x_adj = build_correction(xs, Ls, use_density=False)

    # Export 256-sample LUT (0..100% adjusted input per 0..100% nominal)
    with open("linearization_Lstar_LUT.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["nominal_input_percent", "adjusted_input_percent"])
        for x, a in zip(x_grid, x_adj):
            w.writerow([round(float(x), 4), round(float(a), 4)])

    # Or compute using relative density
    _, x_adj_D = build_correction(xs, Ls, use_density=True)
    with open("linearization_Drel_LUT.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["nominal_input_percent", "adjusted_input_percent"])
        for x, a in zip(x_grid, x_adj_D):
            w.writerow([round(float(x), 4), round(float(a), 4)])
```

**Notes**
- This example uses **piecewise‑linear** interpolation (`np.interp`) for both the forward response and its inverse. For higher fidelity and slope continuity, replace with a **monotone cubic (PCHIP)** interpolator.
- Clamp and smooth carefully near the endpoints to avoid overshoot and flat‑top artifacts.

## I/O formats
- **Input CSV**: `input_percent,Lstar` with input in 0–100 and L* in 0–100.
- **Output CSV LUT**: `nominal_input_percent,adjusted_input_percent` with 256 rows (0..100 in equal steps).

## References (overview/intuition)
- Heidelberg Prinect (conceptual inversion): https://onlinehelp.prinect-lounge.com/Prinect_Calibration_Manager/Version2020/en/Prinect/c02/c02-5.htm
- VistaLogics — Printer Linearization (procedural + theory): https://www.vistalogics.com/uploads/2/3/6/6/2366826/linearization.pdf
- SGIA Journal — Linearization of the Imaging Process (context & rationale): https://www.printing.org/docs/default-source/default-document-library/journal/98-3-linearization-imaging-process.pdf
- Research (3D gradation curves in Lab): https://ceur-ws.org/Vol-1814/paper-09.pdf
- Practical blog (inversion & iteration mindset): https://tinker.koraks.nl/photography/the-curve-is-dead-long-live-the-curve-the-linearization-game-part-3/

## Deliverables
- This guide (`print_linearization_guide.md`).
- Example LUTs if you run the script: `linearization_Lstar_LUT.csv`, `linearization_Drel_LUT.csv`.
