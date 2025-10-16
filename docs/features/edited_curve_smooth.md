# Edited Curve Smoothing Regression

## Background
- Feature: Edit Mode Smart curves with plot smoothing slider.
- Regression: Moving a Smart key point, then changing the plot smoothing percent, restored the channel curves to the pre-edit baseline while the Smart points remained at their edited positions.
- Cause: Plot-smoothing caches (`_zeroSmoothingCurves`, `_plotSmoothingOriginalCurves`, etc.) were only captured when LAB data or .quad loads occurred; Smart edits never refreshed the snapshots.

## Fix Summary
- Added `refreshPlotSmoothingSnapshotsForSmartEdit` in `src/js/curves/smart-curves.js`.
  - Called whenever `setSmartKeyPoints` persists a new Smart curve so the baseline/smoothing caches match the edited curve.
  - Ensures zero-smoothing snapshots and baseline ends track the latest Smart edit, preventing reversion when smoothing toggles.
- Exposed helper through `__plotSmoothingTestUtils` for regression coverage.
- Playwright spec `tests/e2e/edit-mode-smoothing-retains-edits.spec.ts` captures the end-to-end scenario (Smart edit → smoothing 80% → back to 0%) and validates the curve remains edited.
- Vitest unit `tests/ui/plot-smoothing-cache.test.js` now asserts that refresh helper preserves edited curves when smoothing is applied then cleared.

## Verification
- `npm test`
- `npm run build:agent`
- `npm run test:smoke`
- `npx playwright test tests/e2e/edit-mode-smoothing-retains-edits.spec.ts`

## Follow-ups
- Monitor future Smart-curve entry points (e.g., batch edits or agent-driven updates) to ensure they invoke the refresh helper.
- Consider capturing before/after smoothing snapshots in debug UI to make cache state visible when troubleshooting similar regressions.
