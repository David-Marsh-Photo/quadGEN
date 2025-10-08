# LAB Linearization Workflow and Plotting Semantics

## Overview
- Goal: Convert step‑wedge L* measurements into a smooth ink‑space correction that linearizes tone.
- Input: LAB `.txt` with GRAY% and L* (A/B optional). Header example: `GRAY\tLAB_L\tLAB_A\tLAB_B`.
- Display in quadGEN: Mapping Y = output ink level (%) vs X = input ink level (%). The diagonal Y = X is “no correction”.
- Normalization modes: quadGEN defaults to perceptual L* normalization; enable the “Use log-density…” toggle when you want the optical-density workflow described below.

## Input Format
- Header: `GRAY  LAB_L  LAB_A  LAB_B` (tabs/whitespace accepted)
- Rows: `0..100` GRAY% ascending; L* in `[0..100]` (100 = white, 0 = black)
- Example:
  - `0.00 100.00 0.00 0.00`
  - `14.30 85.70 0.00 0.00`
  - `…`
  - `85.70 8.00 0.00 0.00`
  - `100.00 0.00 0.00 0.00`

## quadGEN Interpretation (Processing)
- Perceptual mode (default):
  - Normalize L* directly: `actual = (L^*_{\max} - L^*) / (L^*_{\max} - L^*_{\min})`.
  - Linear target: `expected = GRAY% / 100` (0 = paper white, 1 = solid black).
  - Pointwise error (ink-space intent): `correction = expected − actual`.
- Log-density mode (opt-in):
  - Compute relative luminance `Y` from each L* using the CIE inverse: `Y = ((L+16)/116)^3` if `L>8`, else `Y = L/903.3`.
  - Optical density `Draw = −log10(Y)` (clamped to avoid log(0)).
  - Normalize by the dataset’s min/max density: `actual = (Draw - \min(Draw)) / (\max(Draw) - \min(Draw))`.
  - Linear density target: `expected = GRAY% / 100`.
- Reconstruction (shared): quadGEN blends the sparse corrections with an adaptive Gaussian kernel (σ(x) from local patch spacing) to keep the solve smooth without an exposed smoothing slider. Endpoints are pinned at 0→0 and 1→1.
- Result: 256‑sample mapping `[0..1]` applied as a 1D LUT (interpolation per UI selection).

## Graph Semantics (quadGEN)
- Axes:
  - X: input ink level (%) from 0 (white) to 100 (black), left → right.
  - Y: output ink level (%) after correction, bottom → top.
  - Reference: Y = X is “no correction”.
- Visual interpretation:
  - If a measured patch is too dark at input X: quadGEN reduces ink → Y < X (dip below the diagonal).
  - If a measured patch is too light at input X: quadGEN increases ink → Y > X (hump above the diagonal).
- Smoothing: Increases width, reduces peak magnitude; endpoints remain pinned.

## Worked Example (LAB-Data-2.txt)
- Measurements: Linear L* except `GRAY ≈ 85.7%` (L* 8.0 vs linear 14.3).
- Density error at 85.7%: `expected ≈ 0.857`, `actual ≈ 0.920` → too dark by ~0.063.
- Graph expectation in quadGEN:
  - Around X ≈ 86%, output ink must be reduced by ~6.3 percentage points.
  - On the plot, expect a local dip below Y = X centered near ~86%.
  - With smoothing, the dip widens and the minimum shallows accordingly.

## Why Other Tools May Look “Mirrored”
- Curves orientation: Many tools adopt Photoshop’s curves convention (0 = black at left → 100 = white at right). QuadGEN’s wedge view is 0 = white → 100 = black left → right. A feature at GRAY 85.7% therefore appears at ~14.3% in “curves” displays.
- Y semantics: Some tools plot luminance/brightness on Y instead of ink. To lighten a too‑dark region, a luminance plot bumps above the diagonal; an ink plot dips below it.
- Correction vs mapping: Some UIs plot “delta correction” (offset relative to linear) rather than the final output mapping. In a delta view, expect a negative lobe (−6.3%) near the offending X; in quadGEN’s mapping view, Y < X at that X.

## How To Compare Correctly
- Match X orientation: If comparing to a curves‑style tool, mirror X mentally: `X' = 1 − X`.
- Match Y meaning:
  - quadGEN plots ink mapping (output vs input ink). Lighten → Y < X.
  - Luminance plots: Lighten → Y > X.
- Verify anchors/magnitude:
  - Endpoints stay on the diagonal (0→0, 100→100).
  - Peak magnitude near the offending input should reflect measurement error (e.g., ~6.3% in LAB-Data-2).

## Typical Workflow
1. Measure a wedge; export `.txt` with GRAY and L*.
2. Load into quadGEN (Global or per-channel). Ensure GRAY% is strictly increasing.
3. Choose the interpolation method (PCHIP recommended). No manual smoothing control is exposed in current builds; the adaptive kernel handles stability automatically.
4. Inspect the graph:
   - Dips (Y < X) at inputs where measured was too dark.
   - Humps (Y > X) at inputs where measured was too light.
5. Export `.quad` and print a verification wedge; iterate if needed.
6. Keep the final Linear intent `.quad` as your “reference”. From there you can either bake a contrast preset with “Apply Intent” to spawn variants, or leave the reference untouched and handle contrast upstream (e.g., Photoshop curves) before printing through the linear reference—both strategies yield the same tonal response on paper.

## Troubleshooting
- Feature appears at the “wrong” X: Likely an X‑axis orientation mismatch (curves vs wedge). Mirror X for comparison.
- Feature appears on the “wrong” side of the diagonal: The comparison tool may plot luminance; invert Y semantics when reasoning.
- Jagged artifacts: Re-measure patches that look noisy and confirm GRAY% order/values; the adaptive kernel will smooth legitimate data but cannot hide measurement errors.
- Endpoints not on the diagonal: Ensure white/black endpoints were measured and included.

## Key Takeaways
- QuadGEN plots ink mapping (output vs input ink). Too dark → reduce ink → dip below the diagonal at that input. Too light → add ink → hump above.
- Other tools may mirror X or invert Y; the correction is equivalent once you align conventions.

Implementation note (2025‑09)
- The printer‑space remap (horizontal flip + vertical inversion) is now applied once in parsers for ACV and LUT inputs. Loaders no longer perform additional flips. This removes prior cases where a Photoshop “lighten” curve could appear to add ink in quadGEN due to double transforms.
- Use your measured error as the reference: e.g., a −6.3 L* at GRAY ~86% translates to “less ink near ~86% input.”

## Tonal Zones and Endpoint Policy

- Positive working space: X=0% is white, X=100% is black. Y=0% is no ink (white), Y=100% is max ink (black). More output (%) = darker print.
- Endpoints anchored: Keep 0→0 and 100→100 fixed unless you have a specific calibration need. Maintain monotonic, smooth curves; avoid kinks near endpoints.
- Zones by input (X): Highlights 0–25%, Midtones 25–75%, Shadows 75–100%.
- Common adjustments (ink‑space intent):
  - Lighten shadows → reduce output in 75–95%, taper to 0 change by 100%.
  - Lighten highlights → reduce output in 5–25%, taper to 0 change by 0%.
  - Increase midtone contrast → gentle S around 50%, endpoints unchanged.
- Digital negatives: Build corrections in positive space; invert your image in the editor for the negative (the correction remains valid after inversion).
