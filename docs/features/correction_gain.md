# Correction Gain Slider

## Feature Summary
The correction gain control in ⚙️ Options lets printers blend between the uncorrected identity ramp (0 %) and the fully computed LAB correction (100 %). The selected mix flows everywhere—chart rendering, measurement spot markers, preview thumbnails, and exported `.quad` files—so operators can compare partial corrections before committing to a bake.

## Operator Workflow
- Defaults to **100 %** on new sessions. Values persist in localStorage and through undo/redo history so comparisons remain traceable.
- Move the slider or type a value (0–100). The app debounces scrubbing by 150 ms to keep navigation responsive; releasing the thumb or pausing momentarily flushes the blended curve immediately.
- Spot markers and correction overlays scale off the same blend: at 0 % all markers collapse to green checks, while intermediate percentages shrink arrow length/labels to match the applied mix.
- Exports sample the blended curve, guaranteeing that partial gains written to disk mirror what you see on the chart.

## Implementation Notes
- Core state stores `correctionGain` as a 0–1 float. Changes trigger a cache invalidation that rebuilds the blended correction from the cached identity ramp (`identityCurve`) and the full correction (`correctedCurve`):  
  `blended = lerp(identityCurve, correctedCurve, gain)`.
- Endpoints remain anchored at 0 % / 100 %, and results are clamped to each channel’s active ink ceiling before smoothing.
- Derived consumers (spot markers, correction overlay, composite debug summaries, exports) subscribe to the same cache so the blend is reusable and avoids duplicate work.
- Slider input is wrapped in a 150 ms debounce when scrubbing. Programmatic updates or keyboard changes bypass the debounce to provide immediate feedback on discrete adjustments.

## Testing
- **Vitest (`tests/core/correction-gain-blend.test.js`)** validates lerp math, endpoint anchoring, and delta scaling for spot markers.
- **Playwright (`tests/e2e/correction-gain-slider.spec.ts`)** drags the slider across 0/50/100 % and confirms the chart, overlay, and debug helpers report the blended values.
- **Manual regression** (see `docs/manual_tests.md`): verify chart/marker behaviour at 0 %, 50 %, 100 %, and confirm exports bake the blended curve.

## Future Enhancements
- Surface a warning badge near the export button when gain < 100 % to avoid shipping partial corrections unintentionally.
- Consider a numeric “Apply” control for tightly controlled lab workflows that prefer discrete jumps over continuous scrubbing.

## Implementation Details: LinearizationState Architecture

### Corrected Curve Storage and Blending
The correction gain system relies on `LinearizationState` (`src/js/data/linearization-utils.js`) to store and blend curves:

- **Baseline curves** (`globalBaselineCurves`): Store uncorrected identity ramps (0-65535 linear or loaded .quad curves)
- **Corrected curves base** (`globalCorrectedCurvesBase`): Store LAB-corrected curves before gain blending
- **Corrected curves** (`globalCorrectedCurves`): Store gain-blended result for rendering

The `blendCurveMapsWithGain(correctedBase, baseline, gain)` function performs interpolation:
- At gain ≤ 0.1%: returns baseline curves (no correction)
- At gain ≥ 99.9%: returns corrected curves directly (full correction)
- Between 0.1% and 99.9%: linear interpolation `baseline + (corrected - baseline) * gain`

### Simple Scaling Correction Method
When `correctionMethod === CORRECTION_METHODS.SIMPLE_SCALING` (default for LAB data loads):

1. **Corrected curve generation** (event-handlers.js:3416-3419):
   - Calls `make256(endValue, channelName, true)` to apply LAB corrections
   - Stores result via `setGlobalCorrectedCurves(correctedCurves)`
   - These are the LAB-corrected curves used for gain blending

2. **Critical guards** to prevent baseline overwrite:
   - Zero-smoothing restore (line 1288-1289): Skip `setGlobalCorrectedCurves` for SIMPLE_SCALING
   - Baseline rescale (line 1799-1800): Skip `setGlobalCorrectedCurves` for SIMPLE_SCALING
   - Zero-snapshot sync (line 1900-1901): Skip `setGlobalCorrectedCurves` for SIMPLE_SCALING
   - These guards prevent normalization code from replacing LAB-corrected curves with baseline

3. **Why guards are needed**:
   - `loadedData.curves` contains baseline curves for rendering/export
   - Zero-smoothing paths restore `loadedData.curves` from snapshots (baseline data)
   - Without guards, calling `setGlobalCorrectedCurves(loadedData.curves)` overwrites LAB-corrected curves
   - Result: 100% gain would render baseline instead of corrections

### Regression Prevention
Test coverage in `tests/e2e/correction-gain-100-baseline.spec.ts` validates:
- At 100% gain, LAB corrections are fully visible (not baseline)
- 99% and 100% gain produce identical results (no accidental workarounds)
- Corrected curves in LinearizationState contain LAB-corrected data, not baseline
