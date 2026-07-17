# History and Undo Specification

## Purpose

- Provide deterministic Undo/Redo for supported curve, correction, intent, scaling, and UI actions.
- Present one operator action when a workflow updates several channels or state owners.

## User-Facing Entry Points

- Undo and Redo buttons (`#undoBtn`, `#redoBtn`).
- Keyboard shortcuts: Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z.

## Core Modules

- `src/js/core/history-manager.js` owns the in-memory undo and redo stacks, transactions, snapshots, and restoration.
- `src/js/core/state-manager.js` publishes subscribed state mutations that become history entries unless `skipHistory` is set.
- Feature modules define the user-facing transaction boundary and any feature-specific payloads.

## Action Types

- `channel`: one channel value or curve change.
- `ui`: edit selection and other supported interface state.
- `linearization`: subscribed correction-state changes.
- `batch`: one command represented by several channel actions.
- `snapshot` / `snapshot_pair`: complete before/after application states.
- `transaction`: one top-level operator action containing buffered child entries and snapshots.

## Expected Behavior

1. **Recording**
   - A new top-level action clears the redo stack.
   - Silent synchronization uses `skipHistory` so state bridges do not create extra operator actions.
   - Transactions buffer child entries until commit and retain a pre-transaction snapshot for rollback.

2. **Undo and Redo**
   - Undo replays transaction children in reverse; Redo replays them forward.
   - Complete before/after snapshots bookend multi-store workflows so their final state is deterministic.
   - Snapshot restoration synchronizes StateManager, `LinearizationState`, application and window compatibility state, loaded curve data, controls, chart, preview, and processing detail.
   - In-memory cloning preserves function-valued correction behavior, such as Manual L* smoothing providers, while still isolating mutable arrays and objects.

3. **Manual L* transaction**
   - `Apply manual L* correction` is one top-level transaction.
   - Its before and after snapshots include correction data, source and baked metadata, filenames, control details, channel curves and values, scaling state, and compatibility surfaces.
   - Undo restores the replaced correction; Redo restores the exact Manual correction and runtime smoothing behavior.

4. **Batches and rebased corrections**
   - Batch entries group channel actions such as Global Scale updates.
   - Global correction snapshots retain rebased curve samples and baseline Ends so restoration precedes downstream chart and preview refreshes.

5. **Lifetime**
   - History is session-memory state; it is not persisted across application reloads.
   - Resetting application state clears the stacks.

## Guards

- Restoration suppresses new history capture.
- No-op enabled, percentage, and End writes are not recorded.
- New transactions must roll back to their captured pre-state if application throws.
- Baked metadata must be applied after generic control restoration so baked toggles remain disabled and checked.

## Testing

- `npm run test:history` runs the seven retained browser history contracts with zero skips.
- `tests/e2e/manual-lstar-apply.spec.ts` proves the Manual L* transaction across replacement, baked state, full payloads, smoothing, chart, preview, export, Undo, and Redo.
- `tests/core/history-manager-transactions.test.js` and `tests/core/history-manager-schema.test.js` cover transaction and snapshot mechanics.

## References

- Manual L*: `docs/features/manual-lstar.md`.
- Global Scale: `docs/features/global-scale.md`.
- Revert controls: `docs/features/revert-controls.md`.
- Implementation: `src/js/core/history-manager.js`.
