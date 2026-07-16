# Context
Implemented bell curve handling improvements based on 7-agent audit comparing quadGEN to industry solutions (HDR imaging, chromatography, audio processing).

# Changes Made
- `src/js/core/bell-shift.js`: Gaussian falloff (`exp(-d²/2σ²)`), PCHIP resampling
- `src/js/core/bell-width-scale.js`: Gaussian falloff, PCHIP resampling
- `src/js/core/bell-curve-utils.js`: Added `pchipSample()` monotone cubic Hermite interpolation
- `src/js/data/curve-shape-detector.js`:
  - Asymmetry metrics (`asymmetryRatio`, `isLeftSkewed`, `isRightSkewed`)
  - Savitzky-Golay smoothing (default, configurable via `useSavitzkyGolay`)
  - Gaussian fit quality metric (`gaussianFitQuality` R² score)
- `docs/features/bell-curve-improvements-plan.md`: Created implementation plan with status

# Commands Run
- `npm run build:agent` - Build succeeded
- `npm run test:smoke` - 1/1 passed
- `npm run test -- tests/curves/` - 25/25 passed
- `npx playwright test tests/e2e/bell-curve-apex-shift.spec.ts` - 1/1 passed
- `npx playwright test tests/e2e/bell-width-scale.spec.ts` - 2/2 passed

# Findings
- All bell curve tests pass with new Gaussian falloff and PCHIP interpolation

# Follow-ups
- No follow-up is implied. Adaptive anchors or additional metric tests require a measured product need under the current complexity budget.
- The durable behavior contract is maintained in the bell-curve feature documentation; raw audit transcripts are archived outside the repository.

Updated `docs/features/bell-curve-improvements-plan.md`: Added implementation status table
Updated `CHANGELOG.md`: Added bell curve improvements to Unreleased section
