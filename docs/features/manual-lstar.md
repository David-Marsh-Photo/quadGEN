# Manual L* Entry Specification

## Purpose
- Allow technicians to enter measured L* values manually, generate printer-space corrections, and seed Smart curves without importing a file.
- Ensure manual entries share the same smoothing, metadata, and undo behavior as LAB file ingestion.

## User-Facing Entry Points
- Global Corrections → `Enter L* Values` modal.
- Lab Tech command: `apply_manual_lstar_values` (array input).

## Core State & Helpers
- Modal controller: `src/js/ui/manual-lstar.js` (validation, grid management).
- Processing pipeline: `parseManualLstarData` → `buildInkInterpolatorFromMeasurements`.
- State integration identical to LAB ingestion via `LinearizationState`.

## Expected Behavior
1. **Data Entry & Validation**
   - Grid defaults to evenly spaced Target L* values (0→100). User enters Measured L* per row.
   - Validation ensures at least three rows, all target/measured values within 0..100, monotone target progression.
   - Inline error styling guides corrections.

2. **Correction Generation**
   - `Generate Correction` triggers the same smoothing/inversion helper used for LAB files (hybrid mapping optional).
   - Results populate `LinearizationState` as a global measurement, update charts, and seed Smart key points (respecting Edit Mode state).

3. **Metadata**
   - Stored format tag `MANUAL_LSTAR`, originalData reflects grid entries, measurement intent recorded from current UI selection.
   - Undo/redo fully supported; undo restores pre-manual state and clears metadata.

4. **UI Polish**
   - Target swatches show expected tone; measured swatches preview input until valid.
   - Modal supports CSV paste and keyboard navigation for efficient entry.

5. **Patch Layout Persistence**
   - Saving (`Save as .txt`) or applying (`Generate Correction`) records the current row count and Patch % positions in local storage.
   - The modal restores those Patch % positions and row count the next time it opens so recurring manual workflows do not require re-entering patch spacing.
   - Clearing browser storage or running in private browsing resets the modal to the default five evenly spaced rows.

## Edge Cases & Constraints
- Duplicate measured rows allowed but flagged; smoothing minimizes oscillation.
- Empty rows ignored; using fewer than three valid points results in modal error.
- When auto white/black limit is enabled, metadata tags (`bakedAutoWhite/Black`) update after Smart recompute.

## Testing
- Manual matrix: `docs/manual_tests.md` → Manual L* section (validation, correction generation, undo).
- Future Playwright coverage: fill grid, submit, verify correction + Smart seeding.

## Debugging Aids
- `DEBUG_LOGS` prints parsed manual data and smoothing parameters.
- Developer tools: `window.LinearizationState.getGlobalData()` exposes stored manual entries for inspection.

## References
- Modal implementation: `src/js/ui/manual-lstar.js`.
- Smoothing helper: `src/js/data/linearization-utils.js`.
- LAB ingestion spec: `docs/features/lab-ingestion.md`.
