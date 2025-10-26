# Curve Shape Detection Plan

## Objective
Detect whether each loaded channel curve behaves like a bell curve (low → apex → low) or stays monotonic (low → higher) so the Lab tech tooling can surface bell-heavy inks (e.g., C and LK in `data/KCLK.quad`) for redistribution checks and automated safeguards.

## Success Criteria
- Parsing or regenerating any 256-sample curve yields shape metadata per channel (`bell`, `monotonic`, `flat`, `unknown`) with supporting stats (peak location/value, rise/fall confidence flags).
- The UI exposes the classification (badge/tooltip) without slowing chart renders perceptibly (<2 ms per channel on mid-tier hardware).
- Automated tests flag regressions by loading `KCLK.quad` and synthetic fixtures, ensuring C+LK are detected as bell while K remains monotonic.
- Documentation (manual tests, Help → Glossary + Version History) and CHANGELOG capture the behavior.

## Implementation Steps (95 % success confidence)
1. **Spec audit & fixture prep**  
   - Re-read `docs/manual_tests.md` sections covering bell curves (271–314) plus `docs/features/channel-density-solver.md` / `density_ladder_plan.md` to align terminology.  
   - Confirm `data/KCLK.quad` is representative (C/LK bell, K monotonic) and note any other files with usable bells for optional coverage.

2. **Shape detector helper**  
   - Add `src/js/data/curve-shape-detector.js` exporting `classifyCurve(samples, options)` that:  
     - Normalizes 0–65535 samples to 0–1.  
     - Locates the global max, ensuring it sits ≥10 indices from endpoints.  
     - Computes a smoothed first derivative (5-sample window) to check rising (positive slopes) then falling (negative slopes) segments with ±150-count noise tolerance.  
     - Requires both ends ≤35 % of peak for “bell”; requires ≥90 % non-decreasing samples for “monotonic”.  
     - Returns `{ classification, peakIndex, peakValue, startValue, endValue, confidence, reasons }` plus helper enums/constants for reuse.

3. **State integration**  
   - Extend `getLoadedQuadData()` structure (likely `src/js/core/state.js`) with `channelShapeMeta`.  
   - Create a small utility (`updateChannelShapeMeta(channelName, samples)`) that caches classifications and invalidates them when curves mutate.

4. **Parse-time classification**  
   - In `parseQuadFile` (`src/js/parsers/file-parsers.js`), run the detector after slicing each channel’s 256 samples; attach the result to the returned payload so initial loads immediately know the shape type.

5. **Smart-curve & edit invalidations**  
   - Whenever Smart curves regenerate (`src/js/curves/smart-curves.js`, e.g., after `make256`, recompute, undo/redo, or measurement imports), call the detector and refresh `channelShapeMeta`.  
   - Ensure metadata follows history snapshots (undo/redo), leveraging existing `ControlPoints.persist()` behavior so shape tags revert correctly.

6. **UI surfacing**  
   - In the channel table component (likely `src/js/ui/channel-table.js` or adjacent), render a subtle badge/tooltip per channel: e.g., “Bell curve (apex 29 % input)” or “Monotonic rise”.  
   - Gate rendering behind metadata availability and theme tokens; keep DOM weight minimal to avoid layout jank.

7. **Public API exposure**  
   - Update whatever exposes `window.getLoadedQuadData()` so tests and power users can read `channelShapeMeta`.  
   - Consider adding a lightweight `window.getChannelShapeMeta()` helper for Playwright diagnostics.

8. **Automated tests & fixtures**  
   - **Unit**: Create `tests/unit/curve-shape-detector.spec.js` with synthetic arrays covering bell, monotonic, flat, noisy, and invalid inputs.  
   - **Integration**: Write a Playwright spec (`tests/e2e/bell-shape.kclk.spec.ts`) that loads `KCLK.quad`, waits for the app ready signal, asserts `channelShapeMeta.C/LK === 'bell'`, `K === 'monotonic'`, and captures a screenshot of the badges (per regression requirements).  
   - Ensure tests fail on baseline (no detector) to satisfy “capture regression first”, then rerun after implementation and store the screenshot under `test-screenshots/`.

9. **Docs & help content**  
   - Update `docs/manual_tests.md` with a “Curve shape detection” entry referencing the Playwright script + manual verification steps.  
   - Add a Glossary entry (“Bell curve (ink channel)”) and Version History blurb in `src/js/ui/help-content-data.js`; note the feature under “Unreleased → Added” in `CHANGELOG.md`.

10. **Build, smoke, and evidence**  
    - Run `npm run build:agent` immediately after code changes so `dist/index.html`+root `index.html` refresh.  
    - Execute `npm run test:smoke`, the new unit suite, and the Playwright spec; archive the screenshot and console logs.  
    - Summarize verification steps plus pointers to artifacts in the final note to the user.

### Risk & Mitigation Notes
- **False positives on noisy ramps**: adjustable thresholds and slope smoothing constants live in the helper so we can tune without touching callers.  
- **Performance**: detector is O(256) with tiny allocations; memoize per channel to avoid redundant runs during quick edits.  
- **Undo/redo drift**: treat metadata as part of the persisted control-point state so history restores shape tags alongside curves.

### Confidence
Following the steps above — particularly the up-front tests, cached metadata plumbing, and dedicated helper — provides a ≥95 % chance we deliver accurate bell/monotonic detection without regressions.
