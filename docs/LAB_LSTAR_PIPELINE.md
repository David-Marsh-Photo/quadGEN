# quadGEN LAB L* Processing Pipeline

This document captures the exact data path from LAB L* measurements to the final per‑channel 256‑sample `.quad` output, focusing on computation and function boundaries. 

## 1) Input → Parse
Summary: Read the LAB file, keep only valid rows, and sort them so we have clean, ordered measurements to work from.
- Function: `parseLabData(fileContent, filename)`
- Input format (whitespace‑separated):
  - Header: `GRAY  LAB_L  [LAB_A  LAB_B]`
  - Rows: `GRAY% (0..100)`, `LAB_L (0..100)` (A/B optional, ignored)
- Procedure:
  - Split lines; drop comments/blank/header.
  - Parse valid rows → `{ input: grayPercent, lab: labL }`.
  - Validate ranges; sort by `input` ascending.
  - Preserve `originalData` for overlays/metadata.

## 2) L* → Target Mapping (per patch)
Summary: Compare each measured tone to where it should land on a smooth, linear scale; compute how much darker or lighter the printer needs to be at that input. quadGEN supports two normalization modes:
- **Perceptual (default)**
  - `pos = clamp01(input / 100)`
  - Normalize L* directly: `actual = (L^*_{\max} - L^*) / (L^*_{\max} - L^*_{\min})`
  - `expected = pos`
  - `correction = expected − actual`
- **Log-density (opt-in)**
  - `pos = clamp01(input / 100)`
  - CIE luminance: `Y = ((L+16)/116)^3` if `L>8`, else `Y = L/903.3`
  - Optical density (unnormalized): `Draw = −log10(clamp(Y, ε, 1))`
  - Normalize by dataset min/max: `actual = (Draw - \min(Draw)) / (\max(Draw) - \min(Draw))`
  - `expected = pos`
  - `correction = expected − actual`
- Build `correctionPoints = [{ position: pos, correction, originalLab, originalInput }]`.

## 3) Base 256‑sample Reconstruction (Gaussian‑weighted, local bandwidth)
Summary: Build a smooth curve from the sparse measurements by blending nearby points, using a local kernel width that adapts to the measurement spacing, and pin both ends to stable values.
- Local bandwidth: `σ(x) = clamp(0.02, α · s_local(x), 0.15)`, α≈3; `s_local(x)` is the median distance to the K nearest measured positions (K≈6).
- For `i ∈ [0..255]`:
  - `position = i / 255`
  - Compute `σ(position)` and kernel weights `w = exp(− d^2 / (2 σ^2))` with `d = |position − correctionPoints[j].position|`.
  - `weightedCorrection = Σ(correction[j] * w)`
  - `totalWeight = Σ(w)`
  - `baseline = position`
  - `finalCorrection = totalWeight > 0 ? weightedCorrection / totalWeight : 0`
  - `corrected = clamp01(baseline + finalCorrection)`
  - `samples[i] = corrected`
- Endpoint anchors: `samples[0] = 0`, `samples[255] = 1`.
- parseLabData returns the LAB linearization object:

```js
{
  domainMin: 0.0,
  domainMax: 1.0,
  samples: Float[256] in [0,1],
  originalData: Array<{input, lab}>,
  format: 'LAB Data',
  getSmoothingControlPoints(smoothingPercent) => { samples, xCoords, needsDualTransformation }
}
```

## 4) Optional Smoothing Path (Pipeline only)
Summary: The LAB pipeline still exposes `getSmoothingControlPoints(sp)` for tooling/tests, but the main UI no longer surfaces a smoothing slider. The adaptive Gaussian kernel in §3 keeps curves stable without extra input.
- Provider: `getSmoothingControlPoints(sp)` on the returned LAB object. When `sp>0`, it widens the blending radius and emits a smaller control-point set for interpolation consumers.
- Dynamic radius (legacy defaults retained):
  - `baseRadius = 0.08`, `maxRadius = 0.25`
  - `radius = baseRadius + (sp/100) * (maxRadius − baseRadius)`
- Rebuild `dyn[256]` with the wider radius; endpoints stay pinned at 0 and 1.
- Downsample to evenly spaced control points so downstream interpolation stays efficient.
- Return `{ samples, xCoords, needsDualTransformation: true }` when smoothing is applied (see §6 for the orientation flip). Callers should respect that flag even if the UI doesn’t expose smoothing.

## 5) Interpolation and LUT Application
Summary: Use the smoothed (or original) correction points to compute the exact output value for every step, ensuring the curve stays smooth and well‑behaved.
- Entry: `apply1DLUT(values, lutOrData, domainMin, domainMax, maxValue, interpolationType, smoothingPercent)`
- Inputs:
  - `values`: 256 INTs in `[0..endValue]` (base per‑channel array, see §6).
  - `lutOrData`: LAB object (above), or raw samples array, or other parsed data types.
- Preprocessing:
  - If LAB object: use `getSmoothingControlPoints(sp)` when `sp>0` else `samples`.
  - Build `lutX`: `xCoords` (if provided) or evenly spaced `[domainMin..domainMax]`.
- Interpolation selection:
  - `pchip` → monotonic PCHIP (recommended for measured data)
  - `linear` → piecewise linear
  - (Other interpolators are available for non‑LAB paths.)
- Forward mapping (per index):
  - `t = (values[i]/maxValue) * (domainMax − domainMin) + domainMin`
  - `lutValue = interpolationFunction(t)`
  - `out[i] = round(clamp01(lutValue) * maxValue)`
- Dual transformation (only if `needsDualTransformation`):
  - Normalize: `nr[i] = out[i] / maxValue`
  - Horizontal flip index: `i' = round((1 − i/(N−1)) * (N−1))`
  - Vertical invert: `flipped[i] = 1 − nr[i']`
  - `out = round(flipped * maxValue)`

## 6) Per‑Channel/Global Application and Ink‑Limit Scaling
Summary: Start from each channel’s base (ramp or existing curve), apply per‑channel and/or global corrections, and scale to the ink limit to get final 256 numbers.
- Generator: `make256(endValue, channelName, applyLinearization)`
- Base curve `arr (0..endValue)`:
  - If an existing curve is loaded for `channelName`:
    - If source is Smart curve → scale by `endValue / TOTAL`.
    - Else (loaded .quad) → scale by `endValue / baselineEnd[channelName]`.
  - Else → linear ramp: `arr[i] = round(i * (endValue/255))`.
- Apply per‑channel linearization (if enabled):
  - `arr = apply1DLUT(arr, perChannelLinearization[channel], domainMin, domainMax, endValue, interpolationType, smoothingPercent)`
- Apply global linearization (if enabled and channel is not Smart):
  - `arr = apply1DLUT(arr, linearizationData, domainMin, domainMax, endValue, interpolationType, smoothingPercent)`
- Return `arr` as final 256 INTs in `[0..endValue]` for export.

## 7) Interpolators
Summary: Math helpers that turn a few control points into a smooth curve; PCHIP is used for measurement‑driven work because it preserves shape and avoids artifacts.
- `createPCHIPSpline(x, y)` — monotonic, shape‑preserving.
- `createCubicSpline(x, y)` — clamped cubic.
- `createCatmullRomSpline(x, y, tension)` — Catmull‑Rom.

## 8) Invariants and Safeguards
Summary: Guardrails that keep the curve stable, avoid weird wiggles, and ensure the final result prints predictably.
- Endpoints anchored in LAB reconstruction, preserved across interpolation.
- PCHIP prevents overshoot/undershoot and flat spots.
- Smoothing only affects the LAB path when explicitly requested (no double‑smoothing for Smart / dense .quad curves).
- Orientation: when smoothing is used, returned control points set `needsDualTransformation=true`; `apply1DLUT` performs the horizontal+vertical flip on the final mapped 256 array to match expected plotting semantics.
