# Auto White/Black Limit Rolloff Specification

## Purpose
- Detect early plateauing near 0 % or 100 % ink and apply a soft shoulder/toe so highlights and shadows retain separation when global intents or corrections push curves into the channel End prematurely.
- Match the behavior observed in POPS Profiler while staying compatible with quadGEN’s printer-space pipeline and PCHIP interpolation.

## User-Facing Entry Points
- Auto-limit toggles in the Global Correction panel (`#autoWhiteLimitToggle`, `#autoBlackLimitToggle`).
- Lab Tech assistants can flip the same settings through `set_auto_white_limit` / `set_auto_black_limit` (see `src/js/ai/ai-actions.js`).
- Advanced configuration (ε thresholds, knee width) currently hidden; defaults tuned for production use.

## Core State & Helpers
- Detection, shaping, and metadata live in `src/js/core/processing-pipeline.js` and `src/js/data/linearization-utils.js`.
- Active auto-limit flags are persisted in `LinearizationState` and surfaced via `keyPointsMeta[channel].bakedAutoWhite` / `bakedAutoBlack` when Smart curves are recomputed.
- Chart labels and status messages are handled by `src/js/ui/chart-manager.js` and `src/js/ui/status-service.js`.

## Expected Behavior
1. **Detection**
   - Work on the plotted printer-space curve after global intent/correction, before End clamp.
   - White end: inspect the final 10 % of samples; flag a knee start `x₀` when ink is within εY (≈0.5–1 % of End) and the rolling median slope falls below εSlope (≈15 % of the midtone slope) for ≥3 consecutive samples.
   - Black end mirrors the check with absolute ink ≤ εY and slope magnitude below threshold.

2. **Rolloff Generation**
   - Build a normalized domain `t = (x − x₀)/(1 − x₀)` (white) or `t = x/x₀` (black) and apply a cubic smoothstep (`3t² − 2t³`) so the curve hits End exactly at the endpoint with zero slope.
   - For very narrow knees (<5 % of domain), upgrade to a 5th-order smoothstep or exponential soft-knee to avoid visibly abrupt shoulders.
   - Anchor new Smart key points at `{x₀, y₀}`, knee midpoint, and endpoint; keep interpolation `PCHIP`.

3. **Application**
   - Recompute Smart key points with `rescaleSmartCurveForInkLimit(..., { mode: 'preserveRelative' })` so downstream scaling respects both the auto-limit and any active global Scale multiplier.
   - Persist baked flags (`bakedAutoWhite`, `bakedAutoBlack`) so Edit Mode, undo/redo, and history capture the modified context.

4. **Disabling**
   - Toggling auto white/black OFF restores the raw curve (no knee) on the next recompute; metadata flags clear accordingly.

## Edge Cases & Constraints
- Disabled channels or End=0: auto limit logic skips them.
- Measurement datasets with ≤3 samples at an endpoint may generate unstable slopes; detector defers until more data exists.
- Manual End changes trigger a full re-evaluation so the knee adapts to the new limit.
- Exported .quad files bake the soft knee; metadata notes the auto-limit status for traceability.

## Testing
- Manual tests: See `docs/manual_tests.md` (Auto Limit section) for highlight/shadow plateau scenarios and screenshot expectations (`artifacts/autolimit.png`).
- Automated coverage: pending; add a Playwright regression that loads a plateau dataset, toggles auto white/black, and samples knee behavior.

## Debugging Aids
- Enable `DEBUG_LOGS = true` and watch for `[AUTO LIMIT]` messages that log ε thresholds, detected `x₀`, and the injected key points.
- Inspect baked flags via `window.__quadDebug.s smartCurves` to confirm `bakedAutoWhite/Black` metadata.

## Advanced Configuration (Future)
- Expose `threshold` / `rolloff` sliders in the Global Corrections advanced pane; persist via `AUTO_LIMIT_WHITE_THRESHOLD`, etc.
- Update metadata tags and history entries when settings change.

## References
- POPS parity analysis: `docs/pops_profiler_formulas/` (CSV dumps) and `docs/POPS_vs_quadGEN_formula_map.md`.
- Print linearization math: `docs/print_linearization_guide.md`.
- Detection/smoothing helpers: `buildInkInterpolatorFromMeasurements` in `src/js/data/linearization-utils.js`.
