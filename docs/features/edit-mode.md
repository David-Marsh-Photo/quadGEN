# Edit Mode Specification

## Purpose
- Provide an interactive workspace for Smart key-point editing with clear focus, safe defaults, and full undo/redo support.
- Ensure parity between manual edits, Smart-curve automation, and Lab Tech scripts by sharing the same key-point infrastructure.

## User-Facing Entry Points
- Toggle button (`#editModeToggleBtn`) in the Edit Curves panel; label updates to `◈ Edit Mode: ON/OFF`.
- Channel selector (`#editChannelSelect`) plus previous/next buttons cycle through enabled channels.
- Chart interactions (click to insert, drag handles) are active only when Edit Mode is ON.

## Core State & Helpers
- Module: `src/js/ui/edit-mode.js` (selection state, seeding, UI refresh).
- Smart curve primitives: `src/js/curves/smart-curves.js` (ControlPoints, set/insert/adjust/delete APIs).
- History manager: `src/js/core/history-manager.js` (`recordChannelAction`, `recordBatchAction`).
- Chart rendering: `src/js/ui/chart-renderer.js` (focus layering, cursor tooltip, overlays).

## Expected Behavior
1. **Activation & Seeding**
   - First enable per channel auto-seeds Smart key points: direct copy when source ≤25 points; otherwise the curve is simplified to ≤21 points (configurable via `DIRECT_SEED_MAX_POINTS`).
   - Disabled channels persist key points without enabling ink; enabled channels seed and draw immediately.
   - Seed operations record a single undo batch.
   - Seeding rebuilds the curve from the key points, except when any seeded relative output exceeds 100 (End just above the rounded Percent field, e.g. End 19481 = 29.726% against 29.7): those key points are stored without rebuilding, so the loaded samples stay exact until the first edit rebuilds them (`persistSmartPoints`; guarded by `tests/e2e/edit-mode-kclk-ceiling-regression.spec.ts`).

2. **Focus & Rendering**
   - Selected channel renders last, full opacity with numbered markers; others dim to 50 % and hide ordinals.
   - A dashed linear reference (0→End) appears for context; cursor tooltip locks to the selected channel.
   - The insert ring and LAB-marker hover highlights draw on `#inkChartOverlay`, which is positioned at the chart canvas offset (not the wrapper's padding box) so the ring sits on the curve.

3. **Editing Tools**
   - XY input accepts `X,Y` (absolute percent after End). Validation clamps 0–100 and surfaces inline errors.
   - Nudge controls: arrow buttons (with Shift=coarse, Alt= fine) adjust X or absolute Y. Keyboard arrows mirror behavior when focus is on the chart.
   - Chart click inserts a key point sampled from the current curve; the new point becomes selected.
   - Delete removes non-endpoint key points unless `allowEndpoint=true` is specified via API.

4. **Integration with Ink Limits**
   - Absolute Y edits that exceed the current End automatically raise the channel End and rescale other points to keep their absolute outputs unchanged; UI shows status (e.g., “MK ink limit changed to 60%”).
   - Per-channel ink limit edits outside Edit Mode rescale relative outputs so plotted points remain consistent.
   - When a drag raises the ink limit, the updated percent/End values remain the new baseline after the drag completes, so subsequent edits retain the additional headroom without needing a second adjustment.

5. **Undo/Redo & History**
   - Every insert, adjust, delete, recompute, or seed records history; global undo restores curves, key points, and metadata.
   - Recompute (Simplify) regenerates key points from the plotted curve and tags metadata (`bakedGlobal`, `bakedAutoWhite/Black` when applicable).

## Edge Cases & Constraints
- Minimum gap (`ControlPolicy.minGap`, default 0.01) prevents key-point overlap; editing too close surfaces a descriptive error.
- Stored relative outputs may exceed 100; `validateKeyPoints` rejects only negative outputs and inputs outside 0–100, so insert, delete, rescale, drag-cancel restore, and undo/redo work on channels whose End sits above the rounded Percent.
- End=0 channels remain disabled; attempts to edit prompt the user to enable the channel first.
- Edit Mode OFF blocks mutations but preserves seeded key points for the next session.
- Auto-seeded overlays align with measurement patches when counts ≤25 to avoid mid-edit jumps.

## Testing
- Playwright: `tests/e2e/edit-mode-drag-smart-point.spec.ts`, `tests/e2e/edit-mode-delete.spec.ts`, `tests/e2e/edit-mode-scale.spec.ts`, and `tests/e2e/edit-mode-ink-limit-raise.spec.ts` cover editing, deletion, scaling, and low-ink-limit interactions.
- Playwright: `tests/e2e/edit-mode-click-select-point.spec.ts` checks click selection and that the insert-preview overlay aligns with the chart canvas.
- Unit: `tests/ui/edit-mode-persist-seeding.test.js` covers measurement-based reseeding with synthetic samples; `tests/core/smart-key-point-validation.test.js` covers the relative-output validation contract.
- Manual: `docs/manual_tests.md` (Edit Mode section) outlines nudge behavior, tooltip locking, and overlay expectations.

## Debugging Aids
- Toggle `DEBUG_LOGS = true` to log `ensureSmartKeyPointsForChannel`, ControlPoints operations, and recompute metadata.
- Inspect `window.ControlPoints.get(channel)` in dev tools to verify relative outputs and interpolation.

## References
- Smart curve internals: `src/js/curves/smart-curves.js`.
- Channel row events: `src/js/ui/event-handlers.js` (percent/end inputs, revert integration).
- Revert integration: `docs/features/revert-controls.md` (once migrated).
