# Hybrid Density Mapping Specification

Status: Proposal (implementation-ready)

## Purpose
- Blend legacy highlight handling with CIE-exact density for midtones and shadows, improving convergence near 100 % while preserving current highlight “arrival.”
- Provide a shared mapping for LAB `.txt` and Manual L* ingestion so both paths produce consistent correction curves.

## User-Facing Entry Points
- Advanced option in Global Corrections (planned): “Hybrid (Legacy highlights + CIE density)” mapping selector with threshold/rolloff sliders.
- Lab Tech command (future): `set_lab_mapping({ mode: 'hybrid', threshold, rolloff })` to mirror UI controls.

## Core State & Helpers (Target Implementation)
- New utilities: `lstarToY`, `yToDensity`, `buildHybridContext`, `hybridDensity` in `src/js/data/linearization-utils.js`.
- Reconstruction pipeline: `buildInkInterpolatorFromMeasurements` consumes hybrid actual density values and existing Gaussian/RBF smoothing remains unchanged.
- Configuration persisted via `LAB_MAPPING_METHOD`, `LAB_MAPPING_THRESHOLD`, `LAB_MAPPING_ROLLOFF` (local storage + settings panel).

## Expected Behavior
1. **Hybrid Actual Density**
   - Compute legacy normalized density `D_L* = 1 − (L − Lmin)/(Lmax − Lmin)`.
   - Compute CIE density `D_CIE = -log10(Y)/Dmax`, with Y from the CIE inverse and clamped to ε.
   - Blend by position using a smootherstep weight `w(pos)` so highlights use legacy mapping and mid/shadows transition to CIE density.

2. **Weight Function**
   - Parameters: threshold τ (default 12 %), rolloff ρ (default 10 %).
   - For normalized position `pos ∈ [0,1]`: `w = 1 - smootherstep(clamp((pos − τ)/ρ, 0, 1))`.
   - Ensures C1 continuity at the blend boundaries.

3. **Correction Solve**
   - Target density is still linear (`expected = pos`).
   - Residual smoothing (Gaussian kernel with adaptive σ) and PCHIP interpolation remain the same as current LAB pipeline.
   - Endpoint pins (`t=0 → 0`, `t=1 → 1`) are preserved.

4. **Manual L* Path**
   - Manual data uses the same hybrid mapping prior to inversion, unifying the correction engine across LAB and manual inputs.

## Algorithm Summary
1. Build context (Lmin, Lmax, Dmax, τ, ρ).
2. For each measurement, compute `actual = w·D_L* + (1 − w)·D_CIE`.
3. Derive correction with existing adaptive smoothing.
4. Sample 256 points, clamp to [0,1], pin endpoints.

## Edge Cases & Guards
- Degenerate L* range (`Lmax ≈ Lmin`): fall back to CIE branch or warn the user.
- Very low luminance: clamp Y with ε (≈1e−6) before log transform.
- Sparse measurements: hybrid mapping still applies; smoothing may need a wider σ (existing heuristics handle this).
- Parameters exposed in UI must validate 0 ≤ τ < 1 and 0 < ρ ≤ 1 − τ.

## Validation Plan
- Numeric A/B with baseline datasets (e.g., `data/Color-Muse-Data.txt`) comparing residuals and slope behavior across legacy, hybrid, and pure CIE mappings.
- Visual overlays to ensure no visible kink at the blend boundary and shadows converge faster.
- Regression: confirm undo/redo, `.quad` export, and Edit Mode overlays remain unchanged.

## Debugging Aids
- Temporary console logging behind `DEBUG_LOGS` to print hybrid context and per-sample weights during development.
- Script `scripts/compare_density_mappings.py` (used in initial analysis) to compare mapping variants.

## References
- POPS parity study: `docs/POPS_vs_quadGEN_formula_map.md`, `docs/pops_profiler_formulas/*.csv`.
- Measurement pipeline: `docs/print_linearization_guide.md`, `src/js/data/linearization-utils.js`.
