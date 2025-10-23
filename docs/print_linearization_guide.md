
# Print Linearization from Measured L* — Practical Guide

## Purpose
Define a repeatable method to turn **measured L*** values from a printed step‑wedge into a **correction curve** (LUT) that yields perceptually linear tone reproduction (equal L* spacing per input step). Tone is treated in **printer space** (0% = paper white, 100% = max ink).

## Workflow (concise)
1. **Print** a step‑wedge with known nominal inputs (e.g., 0, 5, …, 100%).
2. **Measure** each patch’s **L*** with a device (e.g., Color Muse, i1Pro2).
3. **Choose normalization**: by default quadGEN normalizes directly in L*, preserving perceptual midpoints. Enable “Use log-density for LAB / Manual measurements” from the Global Correction panel (or within the Manual L* modal) when you need optical density (\(D = -\log_{10}(Y)\), normalized so 0 ↔ paper white, 1 ↔ densest patch) for through-light workflows.
4. **Compute target**: whichever space you selected, aim for a straight line (0→1 across 0→100% input), optionally shaped by contrast intent presets.
5. **Build correction** by **inverting** the measured curve in that space to map nominal input to the adjusted input that hits the linear target.
6. **Apply** the correction as a 1D LUT (e.g., 256 samples) during printing.
7. **Iterate**: reprint the wedge with the correction applied, re‑measure, refine.

## Measurement Files & Normalization

### Required format
- Header: `GRAY  LAB_L  LAB_A  LAB_B` (tabs or whitespace accepted).
- Rows: `GRAY% (0..100)` ascending; `LAB_L` in `[0..100]`. A/B components are optional and ignored.
- Keep the series monotone in GRAY%. Noise in L* is fine—the reconstruction path smooths it while preserving endpoints.

### Channel density inputs
- The channel table exposes a **Density** column interpreted as each ink’s normalized coverage ceiling. Factory defaults populate K/MK with 1.00, C with 0.21, and LK with 0.054. Leave other channels blank (or `0`) to let the solver infer their share on the next LAB import.
- When a manual value is present the composite solver clamps that channel to the specified ceiling plus a 0.5 % buffer; auto-computed constants respect the same guard.

### Normalization modes
- **Perceptual L\*** (default): quadGEN normalizes L* directly so midtones stay perceptually even. Set `actual = (L^*_{\max} - L^*)/(L^*_{\max} - L^*_{\min})` and target `expected = GRAY% / 100`.
- **Log-density** (opt-in): toggle “Use log-density for LAB / Manual measurements” in the Global Correction panel (mirrored in the Manual L* modal) to convert L* into CIE luminance \(Y\), optical density \(D = -\log_{10}(Y)\), then normalize relative density. Density mode emphasizes deep shadows and mirrors QuadToneRIP’s digital-negative workflow.
- Both modes pin endpoints at paper white (0 % ink) and solid black (100 % ink).

### Target mapping math
Let the nominal inputs be \(x_i \in [0,100]\) with measured \(\tilde{m}_i\) (perceptual L* or relative density). The measured response is a monotone function \(f(x) = \tilde{m}\). The ideal linear target is \(m_{\text{target}}(x) = x / 100\). The correction LUT inverts the measured response so
\[
x_{\text{adj}}(x) = f^{-1}\!\left(m_{\text{target}}(x)\right)
\]
and samples it at 256 evenly spaced inputs. PCHIP interpolation keeps both the forward and inverse mappings smooth and monotone.

## Processing Pipeline

### 1. Parse & validate
- Entry point: `parseLabData(fileContent, filename)`.
- Strips comments and blank lines, parses GRAY%/L* rows, validates bounds, sorts by input, and stores `originalData` for overlays and metadata.

### 2. Build per-patch corrections
- For each row compute `position = clamp01(input / 100)`.
- Evaluate the selected normalization mode to obtain `actual`.
- Set `expected = position` and record `correction = expected − actual` along with original inputs and measurements. These correction points drive the reconstruction pass and provide hover detail in the UI.

### 3. Reconstruct the 256-sample curve
- quadGEN blends the sparse corrections with an adaptive Gaussian kernel: `σ(x)` scales with local patch spacing (`median` distance to ~6 neighbours) but is clamped between 0.02 and 0.15.
- Each of the 256 output samples evaluates the weighted correction, adds it to the baseline `position`, clamps to `[0,1]`, and pins endpoints (sample 0 = 0, sample 255 = 1).
- A baseline pass (widen ×1.0) always runs so identity datasets remain perfectly monotone. When the LAB smoothing slider sits at 0 % the pipeline skips any additional widening.

### 4. Optional smoothing path
- The LAB smoothing slider (0–300 %) widens the Gaussian kernel using `baseRadius = 0.08`, `maxRadius = 0.25`, and `radius = baseRadius + (sp/100) * (maxRadius - baseRadius)`.
- `getSmoothingControlPoints(sp)` rebuilds the 256-sample array with the wider radius, downsamples to evenly spaced control points, and returns `{ samples, xCoords, needsDualTransformation }`. The `needsDualTransformation` flag tells downstream consumers to perform the horizontal/vertical flip that preserves plotting semantics.

### 5. Apply the LUT to channel curves
- `apply1DLUT(values, lutOrData, domainMin, domainMax, maxValue, interpolationType, smoothingPercent)` converts the 256-sample LUT into channel-specific corrections.
- LAB objects expose either raw samples (when smoothing = 0 %) or control points (when smoothing > 0). quadGEN builds the input grid (`lutX`) and evaluates the requested interpolation:
  - `pchip` (default) for monotone, shape-preserving results.
  - `linear` for piecewise-linear parity with external tools.
- The routine respects each channel’s current End value and interpolation metadata, and it keeps baselines intact when no correction is present.

### 6. Smart key points & metadata
- On load, quadGEN seeds Smart key points from the plotted curve. Datasets with ≤ 25 rows seed directly; denser sets run through the adaptive simplifier so Edit Mode stays manageable.
- Recompute regenerates Smart key points from the active curve while preserving metadata such as `bakedGlobal`, `bakedAutoWhite`, and `bakedAutoBlack`. This prevents double-application when global corrections or rolloff knees are already baked.
- `LinearizationHistory` captures LAB loads, smoothing changes, and pipeline switches so undo/redo can restore both the measurement state and Smart metadata.

### 7. Safeguards & invariants
- Endpoints remain locked at (0 %, 0 %) and (100 %, 100 %) through every reconstruction and interpolation stage.
- Monotonicity is enforced by cumulative max/min guards before inversion and by PCHIP’s shape-preserving derivatives.
- Smoothing only affects the LAB-driven path; Smart edits, dense `.quad` curves, and imported LUTs bypass the Gaussian widen unless explicitly requested.
- Composite redistribution consumes the same `target − actual` delta per sample; density ceilings (manual or inferred) include a 0.5 % buffer so measurement noise does not cause false clamps.
- `needsDualTransformation=true` triggers the final orientation fix so plots still render output ink on the Y axis even after smoothing.

### 8. Graph interpretation
- X axis: nominal input ink level (0 = paper white, 100 = solid black). Y axis: output ink level after correction.
- Dips below the diagonal mean the print was too dark (reduce ink). Humps above the diagonal indicate the print was too light (add ink).
- The LAB smoothing slider widens features while lowering peak magnitude; use it to tame noise, but leave at 0 % when validating linear reference datasets.

## Correction pipelines at a glance
- **Simple Scaling (default)** — Builds a gain envelope directly in printer space, multiplies each channel’s plotted curve by that envelope, clamps per-channel lifts to ±15 %, keeps K/MK fixed, and redistributes overflow into darker reserves. This path mirrors the industry-standard “fit to correction” workflow while respecting quadGEN’s ink-limit safeguards.
- **Density Solver** — Automatically integrated when multi-ink redistribution is required. Reuses the composite redistribution engine (density ladder, coverage ceilings, snapshot analysis) documented in `docs/features/channel-density-solver.md` for full density accounting.
- The correction overlay shows a dashed red trace of the active correction plus the dashed purple linear baseline for identity comparison.

## Simple Scaling pipeline (default)
1. **Gain envelope**  
   - Start from the corrected mapping described above and convert the signed error into a multiplicative gain \(G(x) = 1 + \text{error}(x)\).  
   - Run \(G(x)\) through the adaptive smoothing kernel (baseline widen ×1 pass + optional Options-panel widening).  
   - Clamp to `0.85 ≤ G(x) ≤ 1.15` so no channel rises or falls by more than 15 % in a single application.
2. **Per-channel application**  
   - Sample each channel’s existing curve via `make256` to obtain the baseline draw (`baseline[i]`).  
   - Multiply: `corrected[i] = baseline[i] * G(x_i)`.  
   - Clamp to the original End plus the 15 % guard; always lock K/MK to 100 % of its baseline to avoid lifting the maximum black.
3. **Overflow redistribution**  
   - If a lighter channel hits the guard, compute `overflow = corrected[i] − clamp`.  
   - Redistribute the overflow into darker channels using their relative baseline shares and available headroom. If all darker channels are capped, log the residual so operators can evaluate another pass.  
   - The redistribution step maintains monotonicity and preserves the original endpoints.
4. **Outputs and auditing**  
   - The final per-channel arrays write directly into the 256-sample `.quad` structure.  
   - The pipeline records channel lift percentages, overflow handling, and total-ink deltas in `loadedData.simpleScalingSummary` (also surfaced by the purpose-built capture script at `npm run capture:simple-scaling`).

### Simple Scaling design notes
- Mirrors legacy simple-scaling tools (e.g., DNPRO) by clamping the gain envelope to roughly ±15 % so highlights and shadows move predictably between passes.
- Overflow prefers darker channels using the baseline share map and reserve logic; when every darker channel is capped the solver records residual error instead of silently clipping.
- Auto-raise integrates with the pipeline—if the clamped gain still exceeds a channel’s End, the helper raises the limit just enough, rescales Smart key points, and logs the adjustment for undo/redo and debug badges.
- Debug payloads surface per-channel lift percentages, overflow redistribution, and auto-raise events (`loadedData.simpleScalingSummary`, `window.getCompositeDensityProfile()`); regression coverage spans `tests/core/simple-scaling.test.js`, `tests/e2e/triforce-correction-audit.spec.ts`, and the headful capture script `npm run capture:simple-scaling`.

## Algorithm (implementation notes)
- Use **monotone interpolation**; if data are noisy, smooth minimally.
- Enforce endpoints: \(x=0\Rightarrow x_{adj}=0\), \(x=100\Rightarrow x_{adj}=100\).
- Export a **256‑sample** LUT for integration into printing pipelines.

### Active-range mapping (quadGEN feature flag)
- QuadToneRIP reference workflows normalize linearization within each channel’s **active ink span**. quadGEN mirrors this behavior behind the `ENABLE_ACTIVE_RANGE_LINEARIZATION` flag (toggle via `enableActiveRangeLinearization(true)`).
- The flag defaults to **disabled**, which is the intended production setting; treat active-range remapping as an opt-in experiment until wider field validation is complete.
- The active-range path:
  - Detects the channel’s active indices (first/last non-zero ink samples) and the equivalent range in the LUT targets.
  - Reprojects the target curve across that span so delayed-onset channels can compress (later starts) and early channels can expand while the zero plateau stays untouched.
  - Enforces monotonic output with `enforceMonotonic()` after remapping to avoid banding or reversals.
- When the flag is **off**, quadGEN retains the legacy fixed-domain behavior (same correction applied at every 0–100% input). Enable the flag when validating active-range parity against DNPRO/POPS data; leave it off during legacy comparisons.

## Density solver pipeline (composite redistribution)
Multi-ink `.quad` files frequently stagger ink usage—highlight grays, cyan midtones, and shadow blacks each dominate different thirds of the ramp. The **Density Solver** automatically engages when multi-ink redistribution is required, converting the residual into density space and applying **composite redistribution**:

1. **Gather measured density** – Sample the imported LAB ramp (perceptual or log-density) into incremental deltas (`ΔDensity`) between successive inputs.
2. **Read channel shares** – For each LUT sample, compute how much of the total draw each channel supplied (`draw_channel / Σ draw_all`). Zero-output spans stay untouched.
3. **Calibrate density constants** – Scan the ramp in the order channels appear. Whenever a channel is effectively solo (≥90 % share, or ≥70 % support), record how much darkening it achieved; that becomes the channel’s density ceiling. Mixed intervals subtract the portions already explained by earlier channels so late-arriving inks only inherit the residual density. The end result is a per-channel constant expressing how strong that ink is when given free rein.
4. **Compute the correction delta** – For each sample quadGEN now evaluates `Δ = targetDensity − measuredDensity`. The linearized target is the law; baseline densities no longer dictate the sign. When the LAB smoothing slider sits at 0, the measurement evaluator echoes the raw ramp so an already linear dataset produces Δ = 0 everywhere.
5. **Distribute the delta** – Use the per-channel density weights as a **funnel** only. They describe how to split the requested change across active inks while clamps, headroom, and density ceilings keep each channel in range. If the correction asks for zero change, every channel receives zero regardless of weight magnitude.
6. **Guard amplitude** – After distribution the solver verifies the composite still matches the LAB request within the guard band (±10 % by default) and restores the original end samples so the curve keeps its exact anchors.

### TRIFORCE example
- **Inputs:** `TRIFORCE_V4.quad` and its LAB ramp (`TRIFORCE_V4.txt`).
- **Highlights:** LK runs solo through 7 % input, accumulating ~0.08 relative density. That ceiling prevents LK from claiming more than ~8 % of the total darkening even when it overlaps midtone inks later.
- **Midtones:** Cyan joins between 20–40 % input. After subtracting the LK share, the residual darkening settles near 0.15, which becomes C’s density constant.
- **Shadows:** K dominates past 70 %; the solver assigns the remaining ~0.77 to black so the redistribution knows K can legitimately supply nearly all of the shadow density.
- **Runtime inspection:** With both files loaded, run `window.getCompositeDensityProfile(95)` in DevTools. The result reports the per-channel density constants, cumulative usage, and the weighted shares applied at 95 % input—expect K to carry ~90 % of the correction, C the remainder, and LK almost none.

When composite redistribution is active, it runs with the behaviours above. You can toggle it off for diagnostics via `window.enableCompositeLabRedistribution(false)` if you need to compare against the legacy per-channel application. Additional implementation notes and troubleshooting tips live in `MULTICHANNEL_CORRECTION.md`, while the solver math is broken down in `docs/features/channel-density-solver.md`.

The solver uses **normalized weighting** by default, mirroring the ink mix from the loaded `.quad` and blending corrections so the updated curve stays proportional to the baseline composition unless a channel runs out of headroom.
- **Momentum weighting** biases redistribution toward channels whose curves are already climbing or dropping fastest, using a Gaussian momentum window.

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
        # Perceptual target: linear in L*
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
    # quadGEN always runs a legacy ×1 Gaussian pass when rebuilding LAB data; the Options slider (0–300 %, default 0 %; 50 % ≈ ×1.27) widens it on demand.
    # Here we just clip to be non-decreasing
    inv_x = np.maximum.accumulate(inv_x)

    return x_grid, inv_x  # nominal inputs, adjusted inputs

if __name__ == "__main__":
    # Example usage
    # Sample synthetic data (replace with your CSV)
    xs = np.array([0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], float)
    Ls = np.array([100, 97, 94, 88, 82, 75, 67, 58, 48, 36, 22, 8], float)

    # Compute correction in perceptual L* (default)
    x_grid, x_adj = build_correction(xs, Ls)

    # Export 256-sample LUT (0..100% adjusted input per 0..100% nominal)
    with open("linearization_Lstar_LUT.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["nominal_input_percent", "adjusted_input_percent"])
        for x, a in zip(x_grid, x_adj):
            w.writerow([round(float(x), 4), round(float(a), 4)])

    # Or enable density mode for through-light workflows
    _, x_adj_D = build_correction(xs, Ls, use_density=True)
    with open("linearization_log_density_LUT.csv", "w", newline="") as f:
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
