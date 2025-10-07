# Scaling Orchestrator Specification

## Purpose
- Serialize all global scale operations through a single coordinator so ink-limit edits never race with history transactions or UI refreshes.
- Provide a measurable surface (telemetry + debug hooks) for monitoring scale operations during the declarative scaling rollout.

## User-Facing Entry Points
- Channel table Scale field (`#scaleAllInput`) when the `__USE_SCALING_COORDINATOR` flag is enabled.
- Lab Tech command `scale_channel_ends_by_percent` (and natural-language delegates) when the coordinator flag is active.
- Debug helper `enableScalingCoordinator(true|false)` exposed on `window` for opt-in testing.

## Core Modules
- `src/js/core/scaling-coordinator.js` – queue manager, history transactions, status messaging.
- `src/js/core/scaling-utils.js` – underlying `scaleChannelEndsByPercent` implementation executed by the coordinator.
- `src/js/core/history-manager.js` – `beginHistoryTransaction` / `commitHistoryTransaction` / `rollbackHistoryTransaction` wrappers invoked per queued operation.
- `src/js/core/scaling-telemetry.js` – emits structured events (`enqueue`, `start`, `success`, `fail`, `flush`) with per-operation snapshots.
- UI hooks: `triggerInkChartUpdate`, `triggerPreviewUpdate`, `triggerSessionStatusUpdate`, and `setChartStatusMessage` ensure visual feedback after each operation.

## Expected Behavior
1. **Enabling & Flag Control**
   - Flag defaults off (`window.__USE_SCALING_COORDINATOR = false`).
   - Calling `enableScalingCoordinator(true)` flips the flag on the window and routes subsequent scale requests through the coordinator. Disabling flushes any queued operations.
   - Debug namespace `window.scalingCoordinator` exposes `setEnabled`, `getDebugInfo`, and `flushQueue` for diagnostics.

2. **Queue & Priorities**
   - Each request enqueues `{ id, percent, source, priority, metadata }`; high-priority jobs (e.g., Lab Tech) insert at the front.
   - Queue processes sequentially; metrics track total enqueued/processed/failed and max queue length.

3. **History Safety**
   - Coordinator opens a history transaction per operation (`beginHistoryTransaction('Scale channels to …')`).
   - On success, commits the transaction and triggers UI refresh hooks. Failures roll back the transaction and surface the status message returned by the underlying scaler.

4. **Result Handling & UI Updates**
   - Successful operations show the returned status message (typically “Scaled to 90 %”) and dispatch `scaling-coordinator:completed` with `{ percent, formattedPercent, message }` for any listeners.
   - UI hooks refresh chart, preview, and session status; chart status flashes “Preview updated”.

5. **Failure & Flush Semantics**
   - If `scaleChannelEndsByPercent` rejects or reports `{ success: false }`, the coordinator records the failure, shows the error via `showStatus`, and rejects the operation promise with the same error.
   - Disabling the coordinator or calling `flushQueue(reason)` rejects pending operations with a descriptive message while resetting queue metrics.

## Telemetry & Instrumentation
- Every phase (`enqueue`, `start`, `success`, `fail`, `flush`) records the operation snapshot and current metrics via `recordCoordinatorEvent`.
- Operation snapshots include percent, source, priority, timestamps, duration, and optional metadata (e.g., caller).
- Metrics mirror queue length, processing flag, counts, last duration, and last error/result for dashboards or local logging.

## Integration Points
- `global-scale.md` feature uses coordinator outputs when the flag is enabled; otherwise it falls back to direct scaling.
- Undo/redo flows rely on coordinator-managed transactions to guarantee the scale change is captured as a single history entry.
- Window helpers (`window.applyGlobalScale`, `window.scaleChannelEndsByPercent`) internally check the flag and delegate to the coordinator when active, preserving compatibility with legacy automation scripts.

## Testing
- Playwright: `tests/e2e/scaling-state-workflows.spec.ts` exercises coordinator-enabled scaling, undo/redo parity, and UI telemetry counters.
- Vitest: `tests/core/scaling-utils-audit-reasons.test.js` and related suites assert coordinator reason counters and queue metrics.
- Smoke: `npm run test:smoke` validates that coordinator wiring does not introduce console errors during app load.

## Debugging & Diagnostics
- Enable `DEBUG_LOGS = true` to surface `[SCALING COORDINATOR]` queue activity in the console.
- Inspect `window.scalingCoordinator.getDebugInfo()` for live queue/metrics data.
- Listen for `window.addEventListener('scaling-coordinator:completed', handler)` to monitor completion events in custom tooling.

## Known Limitations / Follow-ups
- Coordinator currently serializes only global scale; per-channel ink edits still go directly through `scaling-utils`.
- Queue does not dedupe identical consecutive requests; consumer code should avoid spamming the coordinator with redundant inputs.
- Long-term plan: promote coordinator to default-on once active-range parity work completes and telemetry indicates stable throughput.

## References
- Implementation: `src/js/core/scaling-coordinator.js`, `src/js/core/scaling-utils.js`.
- Telemetry: `src/js/core/scaling-telemetry.js`.
- Docs: `docs/features/global-scale.md`, `docs/features/SCALING_IMPROVEMENT_PLANS.md`.
