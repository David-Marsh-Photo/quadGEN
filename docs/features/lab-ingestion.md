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

4. **Undo/Redo**
   - Loading measurement data is undoable; undo clears measurement state and restores original `.quad` curves and Smart metadata.

## Edge Cases & Constraints
- Neutral detection: CGATS importer sets CMY values ≤2.5 % to zero for K-onlies while retaining metadata.
- Intent mismatch: UI warns when measurement intent differs from current selection.
- File validation errors surface in status/completion toasts; parsing logs gated by `DEBUG_LOGS`.

## Testing
- Playwright: add coverage that loads sample LAB/CGATS files, checks metadata display, Smart seeding counts, and revert behavior.
- Manual matrix: `docs/manual_tests.md` → LAB import section (global/per-channel enable, undo toggles).

## Debugging Aids
- Enable `DEBUG_LOGS` for parser traces and smoothing context.
- Inspect `window.LinearizationState.getGlobalData()` / `getPerChannelData(channel)` for metadata and smoothing helpers.

## References
- Parser modules: `src/js/data/`.
- Smoothing helpers: `src/js/data/linearization-utils.js`.
- UI wiring: `src/js/ui/event-handlers.js` (file inputs), `src/js/ui/revert-controls.js`.
