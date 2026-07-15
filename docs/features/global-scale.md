# Global Scale Feature Specification

## Purpose

- Apply one multiplier to every enabled channel End value without changing the relative Smart-curve shape.
- Keep scale changes undo-safe and consistent across the Scale field, Lab Tech, and compatibility helpers.

## User-Facing Entry Points

- The channel-table Scale field (`#scaleAllInput`) accepts values from 1–1000.
- The Lab Tech command `scale_channel_ends_by_percent` uses the same orchestration path.
- `window.applyGlobalScale(percent)` remains available to retained automation and returns a promise.

## Canonical Path

1. `src/js/core/scaling-coordinator.js` validates the request, opens one history transaction, invokes the core scaler, and commits or rolls back.
2. `src/js/core/scaling-utils.js` owns the canonical Scale percent, baseline cache, synchronous endpoint math, clamping, Smart-curve rescaling, and batch history details.
3. On success, the coordinator refreshes the chart, preview, session status, and user-facing status message.

There is no coordinator rollout flag, centralized-state mirror, alternate direct window bridge, request queue, priority system, or scaling telemetry/audit buffer. The scaler writes the Scale field directly, and the coordinator performs the required chart refresh, so state subscriptions did not provide a distinct product behavior.

## Expected Behavior

### Applying a scale

- Invalid or non-positive input is rejected without changing channel data.
- The Scale field clamps input to 1–1000; the core scaler also caps the applied value before any channel would exceed 65,535.
- Baselines are captured the first time scale differs from 100%. Later changes reuse those baselines, preventing cumulative drift.
- Each active channel computes `newEnd = round(baseline * scaleFactor)` and updates its End and percentage fields.
- Smart curves use `rescaleSmartCurveForInkLimit(..., { mode: 'preserveRelative' })` so global scaling does not apply the factor twice.

### History and failure handling

- A user-initiated scale is committed as one undoable transaction.
- If the core scaler fails after mutation begins, the transaction restores the pre-scale snapshot.
- Batch history stores the before/after Scale percent and cached baselines alongside channel endpoints so undo and redo restore one coherent state.
- Automatic reapply operations pass `skipHistory: true`, avoiding no-op history entries.

### Per-channel edits while scaled

- Editing a channel percentage or End value updates that channel's cached baseline.
- The active global multiplier is then reapplied silently, so the displayed endpoint continues to reflect the global Scale value.

### Returning to 100%

- Setting Scale to 100% clears cached baselines. The next non-100% request starts from the then-current channel values.

## Interactions

- Locked channels prevent global scaling and produce the existing lock message.
- Disabled or zero-End channels are skipped.
- LAB, CGATS, and manual measurement data are not altered; scaling operates on printer-space End values.
- Auto white/black limit settings are preserved.
- Undo and redo restore the global percent and per-channel End values together.

## Verification

- `tests/core/scaling-utils-baseline.test.js` covers baseline capture, drift guards, clamping, invalid input, and channel independence.
- `tests/core/scaling-coordinator.test.js` covers commit, rollback, and refresh orchestration.
- `tests/e2e/global-scale-ui.spec.ts` covers the Scale field and per-channel resync workflow.
- `tests/e2e/global-scale-rapid-undo.spec.ts`, `global-scale-measurement-revert.spec.ts`, and `edit-mode-scale.spec.ts` cover retained history, measurement, and Smart-curve interactions.

## Diagnostics

- `window.scalingCoordinator.scale(percent, options)` and `window.applyGlobalScale(percent, options)` use the canonical transaction-wrapped path.
- `window.__quadDebug.scalingUtils` exposes the core scaler plus its current Scale snapshot and baseline helpers for development diagnostics.

## References

- Source: `src/js/core/scaling-coordinator.js`, `src/js/core/scaling-utils.js`, `src/js/ui/event-handlers.js`
- Manual checks: `docs/manual_tests.md`
