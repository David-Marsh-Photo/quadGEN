# History & Undo Specification

## Purpose
- Provide deterministic undo/redo across global corrections, Smart edits, intent changes, and UI toggles.
- Batch multi-channel actions to mirror user expectations (e.g., seeding Smart points, scaling all channels).

## User-Facing Entry Points
- Undo/Redo buttons (`#undoBtn`, `#redoBtn`).
- Keyboard shortcuts (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z).
- Programmatic calls via Lab Tech (implicit through action APIs).

## Core Modules
- `src/js/core/history-manager.js` – stack implementation, batching, persistence.
- Action helpers spread across features (Smart curves, scaling, intents) call `history.record*` functions.

## Action Types
- `channel` – per-channel curve changes (set Smart points, adjustments, recompute).
- `global` – measurement loads, global revert, global scale, intent application.
- `batch` – grouped per-channel operations (e.g., seeding Smart points, global scale updates recorded in one entry).

## Expected Behavior
1. **Recording Actions**
   - Feature helpers call history functions with sufficient context to rebuild state (`oldKeyPoints`, `newKeyPoints`, `oldCurve`, `samples`, metadata, selected channel/ordinal, etc.).
   - Undo stack prunes redo entries on new action.

2. **Undo Execution**
   - Pops stack, applies stored `old*` data via corresponding feature helpers (`setSmartKeyPoints`, `LinearizationState` updates, etc.), restores metadata, and triggers UI refresh.
   - Redo pushes the opposite state back onto the undo stack.

3. **Batching**
   - `history.recordBatchAction(label, actions[])` groups multiple channel updates under one entry (used for initial seeding, global scale, manual undo sequences).
   - Undo replays sub-actions in reverse order.

4. **Integration with Edit Mode**
   - Selected channel/ordinal snapshots ensure focus stays consistent after undo/redo.
   - `_REVERT_IN_PROGRESS` guards prevent Edit Mode from reacting mid-operation.

5. **Persistence**
   - History cleared when loading a new `.quad` or resetting app state.

## Edge Cases & Guards
- Avoid double-recording (e.g., when `skipHistory` flag is set during silent reapply flows).
- Protect against stale DOM references; history actions rely on feature helpers to update UI rather than direct DOM mutations.
- Ensure metadata (auto-limit, bakedGlobal) accompanies undo to prevent double applies.

## Testing
- Manual checks in `docs/manual_tests.md` (undo matrix for global/per-channel operations, auto-limit toggles, intent changes).
- Future Playwright coverage: orchestrate sequences (load measurement → edit Smart curve → undo → redo).

## Debugging Aids
- Dev logging toggled via `DEBUG_LOGS` prints action kinds and stack depth.
- `window.__quadDebug.historyManager` (when exposed) lists stack entries for inspection.

## References
- Feature specs: `edit-mode.md`, `global-scale.md`, `revert-controls.md` (each describes the history entries they create).
- Implementation: `src/js/core/history-manager.js`.
