# Manual L* Entry Specification

## Purpose

- Let technicians enter measured L* values without first creating a measurement file.
- Generate the same printer-space, PCHIP-based correction used by supported LAB measurement workflows.
- Replace an existing global correction as one reversible operator action.

## User-Facing Entry Point

- Global Corrections → `Enter L* Values`.
- Lab Tech is shelved and does not expose a Manual L* command in the shipped UI.

## Core State and Helpers

- `src/js/ui/manual-lstar.js` owns modal validation, layout persistence, application, and history boundaries.
- `parseManualLstarData` reconstructs the measurement curve with the current CIE L* or CIE density normalization mode and PCHIP interpolation.
- `LinearizationState`, StateManager, application compatibility state, chart, preview, and export must describe the same active correction.

## Expected Behavior

1. **Data entry and validation**
   - The grid supports 5–50 rows and defaults to five evenly spaced Patch % positions.
   - Every Patch % and measured L* field is required and must be within `0..100`.
   - Patch % positions must be strictly increasing. Repeated measured L* values are accepted.
   - Invalid or blank fields keep `Generate Correction` disabled and expose an inline validation message.

2. **Correction generation**
   - `Generate Correction` creates a printer-space global correction with format `Manual L* Entry` and source `manual`.
   - Gaussian-weighted measurement reconstruction uses PCHIP wherever a smooth interpolation is required.
   - Applying over another global correction first restores the immutable source `.quad` curves, then reapplies the current Global Scale. The Manual result therefore depends on the measurements and current settings, not on the correction it replaces.
   - Chart, preview, filename, and exported `.quad` refresh before the modal closes.

3. **History and metadata**
   - Apply records one transaction named `Apply manual L* correction`.
   - Undo restores the complete pre-Apply correction, loaded curves, channel values, baked metadata and controls, chart, preview, export, filenames, and compatibility state.
   - Redo restores the exact Manual result, including its callable smoothing-control provider.
   - Internal data uses a generated `Manual-L-<count>pts` filename; the operator-facing correction label is `Manual L* Entry`.

4. **Dialog behavior**
   - The modal has named dialog semantics, contains keyboard focus, closes by Escape, close control, or backdrop, and returns focus to its opener.
   - The grid supports ordinary native keyboard entry. CSV paste is not implemented.

5. **Patch layout persistence**
   - Saving as `.txt` or applying records the row count and Patch % positions in local storage.
   - Reopening restores that layout. Measured L* values are not persisted in local storage.
   - Clearing browser storage or using a private session restores the five-row default.
   - Undo/Redo affects correction state, not the saved data-entry layout preference.

## Testing

- `tests/e2e/manual-lstar-apply.spec.ts` covers prior-correction replacement plus complete Apply/Undo/Redo convergence, including baked state and runtime smoothing.
- `docs/manual_tests.md` retains the operator patch-layout persistence check.

## References

- Modal and history integration: `src/js/ui/manual-lstar.js`.
- Measurement parser: `src/js/parsers/file-parsers.js`.
- Reconstruction helper: `src/js/data/lab-parser.js`.
- History restoration: `src/js/core/history-manager.js`.
