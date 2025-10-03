# Revert Controls Specification

## Purpose
- Restore measurement-based corrections after manual or Smart-curve edits without reloading files.
- Provide scoped undo points for both global LAB corrections and per-channel measurement/Smart overlays.

## User-Facing Entry Points
- Global Correction panel: `↺ Revert to Measurement` (`#revertGlobalToMeasurementBtn`).
- Channel rows: per-channel `↺` buttons (`.per-channel-revert`).
- Lab Tech assistants call `revert_global_to_measurement()` or `revert_channel_to_measurement(channel)`.

## Core State & Helpers
- Revert helpers live in `src/js/ui/revert-controls.js` (global + per-channel orchestration).
- State dependencies: `LinearizationState`, `loadedQuadData`, history manager, and channel row registry.
- UI refresh: `updateRevertButtonsState`, `updateProcessingDetail`, `updateInkChart`, `triggerPreviewUpdate`.
- Edit Mode coordination via `src/js/ui/edit-mode.js` (selection preservation).

## Expected Behavior
1. **Global Revert**
   - Guard: only enabled when global measurement data (LAB/CGATS/manual) is applied.
   - On click: capture history, clear `LinearizationState` global data, remove Smart curves and metadata for every channel, restore original `.quad` curves (`loadedQuadData.originalCurves`), and reset ink limits from stored baselines.
   - UI updates: global toggle re-enabled (ON), filename/labels drop “Edited”, status toast `Reverted to measurement (global)`.
   - Edit Mode: previously selected channel is re-selected if still enabled so key-point panels stay in sync.

2. **Per-Channel Revert**
   - Enabled when the channel has measurement data or an active Smart curve.
   - On click: guard for measurement/Smart presence, capture history, clear Smart key points and metadata, restore measurement data (`LinearizationState.setPerChannelData`) or original curve as appropriate, reset ink limit baseline, and update per-channel toggle state.
   - Status messages differentiate outcomes (“Reverted MK to measurement” vs “Cleared Smart on MK”).
   - Edit Mode selection preserved if the channel remains enabled.

3. **History & Undo**
   - Both global and per-channel flows create undo checkpoints before mutating state; undo restores curves, key points, ink limits, and measurement flags.

## Edge Cases & Constraints
- If no measurement or Smart data exists, buttons stay disabled with tooltip “No measurement loaded”.
- Missing `originalCurves[ch]` falls back to existing curve; user is notified in console (debug) but UI still clears metadata.
- `_REVERT_IN_PROGRESS` flag prevents concurrent updates and ensures Edit Mode doesn’t react mid-operation.
- Revert operations respect auto-limit metadata (`bakedAutoWhite/Black`) by clearing associated flags.

## Testing
- Playwright: add coverage (planned) to trigger each button and confirm curve/metadata restoration; until then, rely on manual matrix in `docs/manual_tests.md` (Global/Per-channel Revert section).
- Manual scenarios: outlined in the original revert doc (global with Smart curves, per-channel measurement, manual edits, missing baselines). Update `docs/manual_tests.md` as flows evolve.

## Debugging Aids
- Enable `DEBUG_LOGS` to surface `[REVERT]` traces detailing guard checks, curve restoration, and baseline resets.
- Inspect `window.__quadDebug` namespaces for `revertControls` (if exposed) to manually invoke helpers during development.

## References
- Implementation: `src/js/ui/revert-controls.js`, `src/js/ui/event-handlers.js` (button wiring), `src/js/core/history-manager.js`.
- Related docs: `docs/features/edit-mode.md`, `docs/features/global-scale.md` (ink-limit interplay), `docs/print_linearization_guide.md`.
