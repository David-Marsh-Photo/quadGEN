# Plot Smoothing Start Protection

## Purpose
- Smooth the leading edge (input ≈ 0 %) of the plot-smoothed curve so early samples follow the original `.quad` ramp without introducing a sharp slope change around 1–2 % input.
- Preserve paper-white behaviour: the first sample must remain fixed at 0, and highlight detail should not be brightened beyond the original measurement.
- Complement the tail-protection work so both ends of the curve remain faithful after heavy plot smoothing.

## Context
- `applyPlotSmoothingToCurve` pins index `0`, yet the global rescale raises all samples. At high smoothing percentages this makes sample 1 (≈ 0.39 %) and sample 2 (≈ 0.78 %) jump upward, creating a kink near ~1.3 % input.
- Unlike the shadow tail, there’s no need to push toward the ink limit; we simply want a gentle transition from the smoothed curve back to the original highlight ramp.

## Target Behavior
1. Execute the existing smoothing pass to reduce mid-curve noise.
2. Keep sample 0 anchored at 0.
3. Blend the first `k` samples (recommended 6) back toward the original curve so the derivative near 0 matches the unsmoothed ramp.
4. Ensure the start remains monotonic and non-negative; highlight blends must never drop below the original curve to avoid negative ink values.

## Algorithm Overview
1. **Primary smoothing:** run `applyPlotSmoothingToCurve` (unchanged).
2. **Head blend window:** for indices `0 … k-1`, compute a taper weight that is 0 at index 0 and 1 at index `k-1`.
   - Blend: `blended[i] = (weight * smoothed[i]) + ((1 - weight) * baseline[i])`.
3. **Baseline floor:** clamp each blended sample to be ≥ the original curve to avoid losing highlight density.
4. **Monotonic guard:** ensure each blended sample ≥ previous sample to avoid dips.
5. **Cache updates:** store the blended head in `_plotSmoothingOriginalCurves`, `_zeroSmoothingCurves`, etc., so undo/redo remains consistent.

## Parameters & Defaults
- `k` (head window size): 6 samples (≈ 2.3 % input) captures the highlighted kink; tunable if noisier curves require shorter coverage.
- Weight profile: linear (0 → 1). Optionally allow a cosine or quadratic profile later if we need a softer hand-off.

## Interactions & Considerations
- **Smart point edits:** if Smart metadata marks the head as “smart touched,” skip the blend or blend toward the Smart curve instead of the original baseline.
- **Highlight rolloff flags:** respect any future highlight rolloff features; if a channel has a toe adjustment, the blend should incorporate the rolled-off base.
- **Zero smoothing restore:** the first samples must revert precisely on slider reset; snapshot caches should store the blended result.
- **Performance:** the head blend is O(k) and negligible compared with the smoothing loop.
- **Tail protection:** runs after this step and remains compatible; head blending preserves the highlight slope while tail blending restores the shadow ink limit (see `plot-smoothing-tail-protection.md`).

## Failure Modes & Mitigations
- **Noisy baseline:** if the original head jitters, the blend may reintroduce noise. Option: pre-smooth the baseline head or clamp to a monotone fit (PCHIP) before blending.
- **Multiple disabled channels:** ensure blending only runs on channels with a non-zero baseline and enabled state.
- **Redundant processing:** skip the blend when `k` exceeds the curve length (e.g., short test arrays) or when smoothing percent is 0.
- **Kernel padding:** the smoothing kernel must shrink near boundaries instead of repeating index 0/len−1; otherwise zeros drag the head down. (Implemented via adaptive window.)

## Implementation Checklist (95 % Success Confidence)
1. **Design Ack**
   - [x] Confirm window size `k` with stakeholders (start at 6).
   - [x] Decide baseline floor behaviour: clamp to original sample or to `max(original, previous sample)`.
2. **Helper Function**
   - [x] Implement `blendCurveHeadWithBaseline(curve, baseline, options)` mirroring the tail helper but without guard rescale.
   - [x] Add unit tests for monotonic behaviour, noisy baselines, and short curves.
3. **Pipeline Integration**
   - [x] Call the head blend immediately after smoothing (and before tail blend).
   - [x] Update cache structures (`plotBaseCurves`, `_plotSmoothingOriginalCurves`, `_zeroSmoothingCurves`) to capture the blended head.
4. **Smart Metadata & Flags**
   - [x] Respect Smart touched segments—skip blend if `keyPointsMeta[channel].smartTouched` is true and no measurement seed exists.
   - [x] Ensure feature plays nicely with any highlight rolloff/auto-limit toggles.
5. **Regression Coverage**
   - [x] Extend `tests/ui/plot-smoothing-cache.test.js` with:
       - Highlight-focused dataset (e.g., P800 V19) asserting the first few deltas shrink.
       - Synthetic plateau near zero to ensure no new dips exist.
   - [ ] Add a Playwright smoke step (optional) sampling the initial delta after smoothing.
6. **Manual & Visual QA**
   - [x] Capture before/after charts (e.g., V19 at 120 %) showing the highlight kink removed.
   - [x] Update `docs/manual_tests.md` with highlight blend check instructions.
7. **Docs & Release Notes**
   - [x] Mention dual-end protection in `CHANGELOG.md` and Help → Version History once shipped.
   - [x] Cross-link this doc with `plot-smoothing-tail-protection.md`.
8. **Build & Verification**
   - [ ] `npm run build:agent`
   - [ ] `npm run test:smoke`
   - [x] `npx vitest tests/ui/plot-smoothing-cache.test.js`
9. **Final Review**
   - [x] Confirm no regressions on Smart edits or manual smoothing toggles.
   - [ ] Gather stakeholder sign-off before merging.

- The production blend uses a six-sample window with a linear taper toward the smoothed values while clamping to the original ramp and enforcing monotonicity.
- `applyPlotSmoothingToCurve` keeps the legacy symmetric window with endpoint padding; highlight blending compensates for the initial slope jump.
- The helper is exported as part of `__plotSmoothingTestUtils` for unit coverage.
- Head blending runs after the guard-rescale step so the highlight ramp remains anchored even when the tail is scaled back to the ink limit.
- Adaptive smoothing truncates the averaging window near the head to prevent zero padding; regression tests cover short positive ramps.
