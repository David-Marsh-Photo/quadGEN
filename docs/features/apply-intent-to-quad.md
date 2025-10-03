# Apply Intent to .quad Specification

## Purpose
- Allow users to bake the currently selected contrast intent into the loaded `.quad` when no measurement data is active, producing intent-specific curve variants for distribution.
- Preserve a copy of the original `.quad` so returning to Linear restores the baseline.

## User-Facing Entry Points
- Global Correction panel → `Apply Intent to quad` button (`#applyIntentToQuadBtn`). Visible only when a `.quad` is loaded and no LAB/Manual data is applied.
- Lab Tech command: `apply_intent_to_loaded_quad()`.

## Core State & Helpers
- Intent system module: `src/js/ui/intent-system.js` (button enable/disable, status messages).
- Intent math: `src/js/core/intent-math.js` (target evaluators).
- Curve regeneration: `src/js/core/processing-pipeline.js` (re-sampling `.quad` with new target).
- History integration: `history.recordIntentApply`.

## Expected Behavior
1. **Eligibility**
   - Requires a loaded `.quad`, no global measurement applied (`LinearizationState.hasAnyLinearization() === false`).
   - Button tooltip explains why it may be disabled (e.g., measurement active).

2. **Execution**
   - Re-sample the loaded `.quad` curve in printer space using the current intent function (`T(t)`), applying PCHIP interpolation per channel.
   - Update `loadedQuadData.curves` and Smart seeds accordingly.
   - Preserve original curves in `loadedQuadData.originalCurvesBaseline` so returning to Linear resets to the original data.

3. **Filename & Metadata**
   - Update filename label to include intent tag (e.g., `_G085_` for gamma 0.85, `_FILM_` for filmic).
   - Add `.quad` comment noting the applied intent.
   - Undo restores pre-apply curves and filename.

4. **Returning to Linear**
   - Selecting Linear intent (and optionally using a Reset command) reloads the cached original `.quad` curves, clearing the applied intent badge.

## Edge Cases & Guards
- Intent application respects ink limits; global scale factor (if active) re-applies after intent baking.
- When auto limit metadata (`bakedAutoWhite/Black`) exists, ensure recompute reflects the new baked curve appropriately.
- Lab Tech invocation should no-op with warning if measurement data is active.

## Testing
- Manual matrix: apply each preset, confirm filename/comment tags, revert to Linear, undo/redo.
- Future Playwright coverage: load `.quad`, apply gamma intent, verify 80 % sample crosses as expected.

## Debugging Aids
- `DEBUG_LOGS` prints before/after curve stats, intent identifiers, and filename changes.
- `window.__quadDebug.intentSystem` exposes helper methods for manual invocation.

## References
- Contrast intent spec: `docs/features/contrast-intents.md`.
- History manager spec: `docs/features/history-manager.md`.
