# Plot Smoothing Tail Protection

## Purpose
- Preserve the original shadow-end ink limit (last sample in printer space) when heavy plot smoothing is applied to global linearizations.
- Prevent the single-sample “kink” that appears near 100 % input when the rescale step snaps a heavily smoothed curve back to the stored maximum.
- Maintain visual continuity and derivative consistency in the darkest tone region so smoothed plots remain trustworthy for evaluation and export.

## Context
- `applyPlotSmoothingToCurve` currently fixes both endpoints before rescaling the smoothed curve to the original maximum.
- With large smoothing radii (e.g., 120 %), the rescale multiplies the tail by a sizable factor, producing a steep final segment.
- That steep segment misrepresents the intended correction and risks altering the shadow tone response when the curve is exported or used in previews.

## Target Behavior
1. Run the existing weighted smoothing pass to reduce mid-curve noise.
2. Keep the first sample pinned (input 0 %) to honor paper-white constraints.
3. Allow the tail to relax smoothly, but ensure the last sample (input 100 %) returns exactly to the original ink limit after processing.
4. Avoid introducing new non-monotonic artifacts, even when the baseline curve contains flat or noisy regions.

## Algorithm Overview
1. **Primary smoothing:** execute the current windowed average to obtain the smoothed series.
2. **Partial rescale:** if the smoothed maximum is below the original end value, rescale to a guard fraction (e.g., 98 % of the baseline maximum). This raises the tail without overshooting.
3. **Tail blend window:** over the final `k` samples (recommended 5–8), blend between the partially rescaled values and the original unsmoothed curve using a linear taper:
   - weight at `i = N-k` (start of window) → 1.0 (keep smoothed value)
   - weight at `i = N-1` (last sample) → 0.0 (fallback to original value)
4. **Endpoint anchor:** forcibly set sample `N-1` to the original end value to guarantee perfect agreement.
5. **Monotonic guard:** clamp any sample that exceeds the next sample to ensure the tail remains non-decreasing; fall back to the previous value if needed.

## Parameters & Defaults
- `k` (tail window size): 6 (tunable; larger window yields softer transition).
- Guard fraction for partial rescale: 0.98 of the baseline maximum (caps the pre-blend scale at 98 % of the stored ink limit).
- Monotonic guard tolerance: allow at most `originalSlope * 1.1` before clamping.

## Interactions & Considerations
- **Rebasing:** When smoothing is zeroed out via undo or slider reset, cached curves must be restored exactly; store both the blended tail and original data for reversal.
- **Smart edits:** Smart point snapshots rely on the smoothed curves—ensure the blend respects Smart point metadata and skips channels flagged `smart`.
- **Performance:** The additional tail pass is `O(k)` per channel and negligible relative to the smoothing loop.
- **Testing:** Validate against multiple datasets (V19, noisy LAB imports, synthetic ramps) and plot smoothing extremes (0 %, 50 %, 120 %, 300 %).
- **Head protection:** Head blending runs before this stage and preserves the highlight slope; the tail helper only adjusts the final samples so both ends cooperate (see `plot-smoothing-start-protection.md`).

## Failure Modes & Mitigations
- **Flat maxima:** If the original curve plateaus before the end, the blend window should detect identical samples and skip redundant rescale.
- **Over-clamp:** If the guard fraction is too aggressive, the blend collapses; adjust to ensure the window has non-zero headroom.
- **Inconsistent caches:** Always update `_plotSmoothingOriginalCurves`, `_plotSmoothingOriginalEnds`, and `_zeroSmoothingCurves` with post-blend data so undo/redo stays coherent.

## Implementation Checklist (95 % Success Confidence)
1. **Design Validation**
   - [x] Confirm desired guard fraction and window size with stakeholders (print team, QA).
   - [x] Identify all call sites of `applyPlotSmoothingToCurve` and `applyPlotSmoothingToLoadedChannels`.
2. **Prototype Tail Blend**
   - [x] Add optional tail-blend helper (pure function) with unit tests covering monotonic, plateau, and noisy tails.
   - [x] Integrate the helper behind a flag (`ENABLE_PLOT_TAIL_BLEND`) for quick rollback during testing.
3. **Update Plot Smoothing Pipeline**
   - [x] Modify `applyPlotSmoothingToCurve` to remove the forced last-sample assignment and call the tail blend after smoothing + partial rescale.
   - [x] Ensure `_plotSmoothingOriginalCurves` and `_zeroSmoothingCurves` capture the blended tail for future restores.
4. **Monotonic & Endpoint Safeguards**
   - [x] Implement post-blend monotonic clamp for the final window.
   - [x] Write invariants/console assertions (dev mode) verifying `tail[n] >= tail[n-1]` and `tail[n] === originalEnd`.
5. **Regression Tests**
   - [x] Extend Vitest coverage (`tests/ui/plot-smoothing-cache.test.js`) with cases for multiple smoothing percents and blended tail verification.
   - [ ] Add a Playwright smoke scenario that loads V19, sets smoothing to 120 %, and samples the tail deltas; fail if the last delta spikes.
6. **Performance & Memory Check**
   - [ ] Profile blending against large multi-channel `.quad` loads to confirm negligible overhead.
   - [ ] Verify no extra allocations persist after smoothing resets (memory leak test).
7. **Documentation & Help**
   - [x] Update `docs/manual_tests.md` with the new tail blend expectations (already drafted).
   - [x] Note the new behavior in Help → Version History once released.
8. **QA Sign-off**
   - [x] Generate before/after screenshots for V19 and at least one noisy dataset.
   - [x] Secure QA approval that the shadow endpoint remains stable and visually smooth.
9. **Release Prep**
   - [ ] Remove/disable feature flag if tests are green.
   - [ ] Rebuild bundle, run `npm run test:smoke`, and audit diffs for unintended changes before commit.

## Implementation Notes
- Tail blending now scales the smoothed curve toward 98 % of the ink limit, applies a six-sample taper, and enforces that the final delta never exceeds the original `.quad` delta.
- The head blend feeds this helper with clamped highlights so both ends stay synchronized when smoothing exceeds 150 %.
- `tests/ui/plot-smoothing-cache.test.js` carries three regression cases:
  - P800 V19 tail must remain non-divergent after smoothing.
  - A synthetic plateau tail cannot exceed the original shadow delta, preventing guard overshoot.
  - P800 V19 LK highlights remain monotonic through 72 % smoothing, confirming head/tail cooperation.
