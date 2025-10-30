# LAB / CGATS Ingestion Specification

## Purpose
- Normalize LAB `.txt` and CGATS `.ti3/.cgats` measurement files into printer-space corrections with consistent smoothing, metadata, and Smart-curve seeds.
- Preserve metadata needed for undo/redo, UI status, and Lab Tech flows.

## User-Facing Entry Points
- Global Corrections → `Load Data File` accepts LAB `.txt`, CGATS `.ti3/.cgats`, compatible `.csv` pairs.
- Lab Tech functions: `load_lab_data_global`, `load_lab_data_per_channel`.

## Core State & Helpers
- Parsers: `src/js/data/lab-parser.js`, `src/js/data/cgats-parser.js` (shared helpers in `src/js/data/linearization-utils.js`).
- State integration: `LinearizationState.setGlobalData`, `LinearizationState.setPerChannelData` with metadata `{ format, measurementIntent, originalData, getSmoothingControlPoints }`.
- History: `history.recordMeasurementLoad` captures loads for undo.

## Smoothing Parameters & Behavior
- **Gaussian Kernel Tuning** (`buildInkInterpolatorFromMeasurements` in `src/js/data/lab-utils.js`):
  - `K_NEIGHBORS = 4`: Each point influenced by 4 nearest measurement points (increased from legacy 2 to better handle sparse regions like 20-25% gaps)
  - `SIGMA_FLOOR = 0.036`: Minimum kernel width (3.6% of normalized range)
  - `SIGMA_CEIL = 0.30`: Maximum kernel width (30% of normalized range, increased from 0.15/0.20 to prevent early ceiling saturation)
  - `SIGMA_ALPHA = 2.0`: Multiplier for adaptive sigma calculation based on local point density
- **LAB Smoothing Slider** (Global Correction panel, 0-600%):
  - Maps percentage to `widenFactor` via **linear scaling** (exponent 1.0): `widenFactor = 1 + (percent/600) × 3` → range [1.0, 4.0]
  - Linear transformation (changed from power curve exponent 1.35) eliminates undulation artifacts caused by differential ceiling saturation at mid-range percentages
  - At 0%: widen = 1.0 (baseline Gaussian smoothing with adaptive sigma)
  - At 300%: widen = 2.5 (moderate additional smoothing)
  - At 600%: widen = 4.0 (maximum smoothing for noisy data)
- **Highlight Taper**: Smoothstep easing applied in 0-15% range blends from widen=1.0 to full widenFactor to preserve highlight detail
- **Effective Sigma**: `min(SIGMA_CEIL, max(SIGMA_FLOOR, localSigma × highlightTaper × widenFactor))`
  - Prevents over-smoothing via hard ceiling clamp
  - Adapts to local measurement density (sparse regions get wider kernels, dense regions get narrower)
  - Monotonic behavior across full slider range with current parameters

## Expected Behavior
1. **Parse & Normalize**
   - Validate headers, units, and grayscale channels; capture original rows in `originalData`.
   - Convert L* → density via hybrid/legacy mapping (pending proposal) or current legacy method.
   - Enforce monotonic samples (`enforceMonotonicSamples`) and anchor to unit range.

2. **Metadata Tagging**
   - Save `measurementIntent` (“Positive”/“Negative”) based on current UI intent at load time.
   - Record default filenames, sample counts, and smoothing control points provider (`getSmoothingControlPoints`).

3. **State Application**
   - Populate `LinearizationState` (global + per-channel) and mark `hasAnyLinearization`.
   - Update UI labels (filename, channels list, measurement badges) and enable global/per-channel revert buttons.
   - Seed Smart key points when Edit Mode is active using either direct measurement points or adaptive simplifier.
   - **Simple Scaling correction** (default method for LAB loads):
     - Generates LAB-corrected curves via `make256(..., true)` for gain blending
     - Stores corrected curves in `LinearizationState.globalCorrectedCurvesBase`
     - `loadedData.curves` contains baseline for rendering; corrected curves used only for gain blending
     - See `docs/features/correction_gain.md` for blending architecture details

4. **Undo/Redo**
   - Loading measurement data is undoable; undo clears measurement state and restores original `.quad` curves and Smart metadata.

## Edge Cases & Constraints
- Neutral detection: CGATS importer sets CMY values ≤2.5 % to zero for K-onlies while retaining metadata.
- Intent mismatch: UI warns when measurement intent differs from current selection.
- File validation errors surface in status/completion toasts; parsing logs gated by `DEBUG_LOGS`.

## Hybrid Highlight/Density Mapping *(deferred)*
- **Goal**: blend legacy highlight handling with CIE-accurate density in midtones and shadows so optical-density workflows converge faster without disturbing current highlight arrival.
- **Status**: proposal tracked for future releases; implementation will gate behind a user-facing selector (planned “Hybrid (Legacy highlights + CIE density)” option) and Lab Tech command `set_lab_mapping({ mode: 'hybrid', threshold, rolloff })`.
- **Mapping**: compute both legacy normalized density (`D_L* = 1 − (L − Lmin)/(Lmax − Lmin)`) and CIE density (`D_CIE = -log10(Y)/Dmax`), then blend them with a smootherstep weight `w(pos)` where `pos` is the normalized patch position. Default parameters: threshold ≈ 12 %, rolloff ≈ 10 %.
- **Helpers**: planned additions include `lstarToY`, `yToDensity`, `buildHybridContext`, and `hybridDensity` in `src/js/data/linearization-utils.js`. `buildInkInterpolatorFromMeasurements` will consume hybrid values while retaining existing Gaussian smoothing and PCHIP interpolation.
- **Persistence**: hybrid settings will store via `LAB_MAPPING_METHOD`, `LAB_MAPPING_THRESHOLD`, and `LAB_MAPPING_ROLLOFF` so operators can recall preferred thresholds.
- **Validation**: numeric A/B comparisons against baseline datasets (e.g., `data/Color-Muse-Data.txt`), visual overlays to confirm no blend boundary kink, and regression tests to ensure undo/redo and `.quad` exports remain stable.
- **Release criteria**: updated documentation (this spec + `docs/print_linearization_guide.md`), new automated coverage, and refreshed Help glossary entries once the feature leaves proposal status.

## Testing
- Playwright: `tests/e2e/triforce-correction-audit.spec.ts` (with helper `tests/e2e/utils/lab-flow.ts`) loads TRIFORCE datasets end-to-end, captures correction snapshots, and emits a JSON artifact for audit runs. See also `docs/features/density_ladder_plan.md` for the ladder sequencing applied during redistribution.
- Manual matrix: `docs/manual_tests.md` → LAB import section (global/per-channel enable, undo toggles).

## Debugging Aids
- Enable `DEBUG_LOGS` for parser traces and smoothing context.
- Inspect `window.LinearizationState.getGlobalData()` / `getPerChannelData(channel)` for metadata and smoothing helpers.

## References
- Parser modules: `src/js/data/`.
- Smoothing helpers: `src/js/data/linearization-utils.js`.
- UI wiring: `src/js/ui/event-handlers.js` (file inputs), `src/js/ui/revert-controls.js`.

## Implementation Architecture: Simple Scaling and Corrected Curves

### Simple Scaling Correction Method
The default correction method for LAB data loads is `SIMPLE_SCALING` (`src/js/core/correction-method.js`), which:

1. **Computes gain curve metadata** without modifying the baseline curves in `loadedData.curves`
2. **Generates LAB-corrected curves** separately for gain blending via `make256(..., true)`
3. **Stores both** in LinearizationState:
   - `globalBaselineCurves`: Original .quad curves or linear ramps (for 0% gain)
   - `globalCorrectedCurvesBase`: LAB-corrected curves (for 100% gain)
   - Correction gain slider blends between these two curve sets

### Critical Implementation Requirements

**Problem**: `loadedData.curves` contains baseline curves (used for rendering/export). Zero-smoothing and normalization code paths restore/manipulate these baseline curves. If these paths call `setGlobalCorrectedCurves(loadedData.curves)`, they overwrite LAB-corrected curves with baseline, causing 100% gain to render without corrections.

**Solution**: Guard all `setGlobalCorrectedCurves()` calls with:
```javascript
if (loadedData.correctionMethod !== CORRECTION_METHODS.SIMPLE_SCALING) {
    LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
}
```

**Required guard locations** (event-handlers.js):
- Line 1288-1289: `restoreZeroSmoothingSnapshot()` - zero-restore path
- Line 1799-1800: `refreshLinearizationDataForNormalization()` - baseline rescale
- Line 1900-1901: `refreshLinearizationDataForNormalization()` - zero-snapshot sync
- Line 3757: `rebaseChannelsToCorrectedCurves()` - rebase path (already has guard)

**Correct corrected curve generation** (event-handlers.js:3416-3419):
```javascript
// Generate LAB-corrected curves by calling make256 WITH linearization applied
const labCorrected = make256(entry.currentEnd, entry.channelName, true, undefined);
correctedCurves[entry.channelName] = Array.isArray(labCorrected) ? labCorrected.slice() : samples.slice();
```

### Test Coverage
- `tests/e2e/correction-gain-100-baseline.spec.ts` validates:
  - At 100% gain, LAB corrections are fully applied (not baseline)
  - 99% and 100% gain produce identical results
  - Corrected curves in LinearizationState contain LAB-corrected data

### References
- Correction gain blending architecture: `docs/features/correction_gain.md`
- Bug investigation history: `artifacts/correction_gain_bug.md`
