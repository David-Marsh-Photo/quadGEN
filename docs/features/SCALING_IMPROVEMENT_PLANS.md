# Scaling Improvement Plans – Global Scale Reliability

This document captures the staged plan for improving quadGEN's global scaling system. It summarizes the audit, checklists, and parity validation work across the phased rollout.

## Goal
Deliver a resilient scaling pipeline that:
- Preserves baseline ink limits during rapid adjustments
- Keeps Smart key points in sync with plotted curves and metadata
- Records undo/redo history deterministically via transactions
- Provides automated regression coverage (randomized and targeted parity harnesses)

## Tracks

### Track 3 — Smart Rescaling Service *(Phase 0)* — ✅ Complete
- Implemented `smart-rescaling-service.js` with normalization, metadata reconciliation, and performance safeguards.
- 19-unit Vitest suite covers guard rails, precision, warnings, and metadata propagation.
- UI now delegates rescale operations to the service and exposes audit mode logging.

### Track 4 — Scaling Test Harness *(Phase 0)* — ✅ Complete
- Added dedicated Vitest suite for baseline cache logic (`tests/core/scaling-utils-baseline.test.js`).
- Added Playwright E2E scenarios for drift, rapid undo, Smart curve editing, and measurement revert interactions.
- Introduced state-driven wait helpers (`tests/utils/scaling-test-helpers.ts`).

### Track 1 — Orchestrator *(Phase 1)* — In Progress
- **Transactions:** History manager now supports `beginTransaction/commit/rollback`, buffering entries until commit; coverage in `tests/core/history-manager-transactions.test.js`.
- **Coordinator scaffolding:** Feature-flagged `scaling-coordinator.js` wraps `scaleChannelEndsByPercent`, serializes operations, and records telemetry.
- **UI integration:** `commitScaleAll` and debounced input flows call the coordinator when `enableScalingCoordinator(true)` is set; flag initializes in `state.js` and flushes queued work on disable.
- **Parity validation:**
  - Randomized legacy vs. coordinator harness (`scripts/diagnostics/compare-coordinator-legacy.js`) – zero diffs for both 10×200 and 10×1000 runs.
  - Smart parity (Edit Mode ON, `P700-P900_MK50.quad`) – zero diffs (`artifacts/scaling-coordinator-smart/`).
  - LAB parity (`cgats17_21step_lab.txt` applied) – zero diffs (`artifacts/scaling-coordinator-lab/`).
- **Outstanding Phase 1 items:**
  - ✅ Extend parity runs to combined Smart + LAB scenarios (`scripts/diagnostics/compare-coordinator-combined.js` → `artifacts/scaling-coordinator-combined/`).
  - ✅ Migrate AI and programmatic scaling calls through the coordinator (covered by `tests/ai-actions-scaling.test.js`).

#### Coordinator telemetry hook (pre-flag rollout)
- [x] Define the telemetry payload contract (operation id, source, target percent, priority, duration, queue depth, success/failure flag, error message) and document it alongside existing coordinator metrics. *(Payload now emitted as `{ timestamp, phase, operation: { id, source, percent, priority, metadata, enqueuedAt, startedAt, completedAt, durationMs }, metrics: { enqueued, processed, failed, maxQueueLength, lastDurationMs, queueLength, processing }, error/result }`.)
- [x] Add a dedicated telemetry helper (`src/js/core/scaling-telemetry.js`) that exposes `recordCoordinatorEvent({ phase, ... })` and forwards events to the status-service logger + debug registry.
- [x] Emit telemetry events from `scaling-coordinator.js` on enqueue, start, success, fail, and flush paths, bundling the latest `metrics` snapshot with each payload.
- [x] Register a `scalingTelemetry` debug namespace so ops can inspect the live stream and last emitted payload from DevTools.
- [x] Extend parity diagnostics (e.g., `scripts/diagnostics/compare-coordinator-*.js`) to capture telemetry artifacts so canary runs record queue depth, failure counts, and timings.
- [x] Add unit coverage that stubs the telemetry helper to assert the expected event sequence for success, failure, and flush flows (`tests/core/scaling-coordinator.test.js`).
- [x] Add a Playwright smoke check that toggles the flag, issues a scale, and verifies the telemetry buffer reflects the queued → success transition (`tests/e2e/scaling-coordinator-telemetry.spec.ts`).

#### UI migration preparation (pre-flag rollout)
- [x] Refactor `commitScaleAll` to always route through `scalingCoordinator.scale(...)`, preserving the immediate/debounced paths via priority metadata instead of calling `applyGlobalScaleCore`.
- [x] Update Enter/blur/arrow key handlers to rely on the coordinator promise (restore old input value on rejection, surface status messages).
- [x] Replace `scaleChannelEndsByPercentCore` reapply calls in `handlePercentInput`/`handleEndInput` with coordinator-driven resyncs so Edit Mode recalculations go through a single code path.
- [x] Audit other UI entry points (`initializeScaleHandlers`, batch channel enable/disable flows, undo/redo refresh) for remaining direct scaling-utils usage and queue equivalent coordinator calls. Window/debug bridges now forward through the coordinator so external tooling no longer hits `scaleChannelEndsByPercent` directly.
- [x] Update Vitest fakes to stub the coordinator in existing UI unit tests (where we mocked scaling-utils) and add assertions that the coordinator was invoked with the right metadata.
- [x] Refresh Playwright workflows (scale input typing, rapid arrow nudges, per-channel edits) to confirm the UI still responds promptly once the legacy path is gone (`tests/e2e/scaling-coordinator-ui-interactions.spec.ts`).

### Track 2 — Declarative State *(Phase 2)* — Planned
- Modernize state manager to store scaling metadata declaratively.
- Introduce dual-write/read phase before deprecating global baseline caches.

## Release Roadmap

### Phase 0 Recap
- Transactions not yet required; coordinator remained disabled.
- Baseline cache tests and Smart rescale service shipped with Phase 0 deliverables.

### Phase 1 (Orchestrator)
1. **Pre-work:** Transactions (✅) and coordinator scaffolding (✅).
2. **Parity Validation:** Randomized, Smart, and LAB parity completed.
3. **AI/Programmatic Migration:** Complete — Lab Tech scaling commands now enqueue through the coordinator and surface queue failures.
4. **UI Migration:** Feature flag remains off until Phase 2 migration readiness.

### Phase 2 (Declarative State)
- Introduce state manager support for scaling metadata.
- Commission dual-path reads/writes and retire global baseline caches once parity is stable.
- `getCurrentScale` now respects the scaling state slice when `__USE_SCALING_STATE` is enabled (prepping dual-read consumers before broader UI migration).
- Scale input and chart consumers now listen for the scaling-state flag event and subscribe to `scaling.globalPercent`, keeping UI synchronized when the state flag toggles.
- Dev bundle now boots with `__USE_SCALING_STATE = true`, so local sessions exercise the declarative path by default (compat helpers still allow toggling off for diagnostics).

#### Phase 2 – Next Actions (2025-10-05)
1. ✅ **State/Global parity guard:** Implement the `validateScalingStateSync()` helper and `window.scalingStateAudit` counters, invoke the check on every scale operation, and add Vitest + Playwright coverage so desyncs fail fast.
2. ✅ **History snapshot parity:** Expand history snapshots to persist both state and legacy baselines, add validation comparing them, and port undo/redo tests to assert the dual-format round-trips cleanly.
3. ✅ **Consumer audit:** Finish migrating any remaining readers (status overlays, diagnostics scripts, legacy bridges) to honor the state flag while preserving the global fallback; document the verified touchpoints so the Phase 2 deliverable can close. → Status overlays verified via `getCurrentScale`; diagnostics capture includes `scalingSnapshot`/`scalingAudit`; legacy parity scripts now validate after each scale; the dedicated Help → Version History audit panel has since been retired in favour of the scriptable diagnostics path; clamp-to-100 parity remains green (tests/core/scaling-utils-dualread.test.js, tests/e2e/scaling-state-parity.spec.ts) with state maxAllowed reset to 1000 when baselines clear.
4. ✅ **Rollout validation (single-lab):** Because quadGEN is a private studio tool, finalize the rollout with automated harness coverage plus a single-operator manual check instead of staged percentage canaries. → Fresh harness sweep (`scaling-state-ab-2025-10-05T18-55-45-586Z.json` legacy, `...18-56-07-047Z.json` state) recorded avg/p95 durations of 7.50 ms / 9.2 ms (legacy) vs 8.17 ms / 10.5 ms (state) with telemetry p95 at 6.1 ms vs 7.5 ms and mismatchCount 0/500 in both modes; manual verification steps live in `docs/manual_tests.md`.
5. ✅ **Reason counters + automation:** Scaling-state audit now tracks `reasonCounts` (flag toggles, subscription resync, legacy fallback, history undo/redo, rapid scaling) with dedicated coverage (`tests/core/scaling-utils-audit-reasons.test.js`, `tests/e2e/scaling-state-workflows.spec.ts`). Diagnostics harness (`scripts/diagnostics/scaling-state-ab.js`) exports `reasonCountsSummary` so A/B runs report parity by reason bucket.

#### Phase 2 – Consumer Audit Snapshot (2025-10-05)
- **UI bindings:** `src/js/ui/event-handlers.js` and `src/js/ui/chart-manager.js` subscribe to `quadgen:scaling-state-flag-changed` and read via `getCurrentScale`, ensuring the scale input, chart status line, and session status banner follow the state slice when the flag is on.
- **Compat + tooling:** Window bridges expose `setScalingStateEnabled`, `validateScalingStateSync`, and snapshot helpers; parity diagnostics (`tests/diagnostics/scaling-baseline-snapshot.cjs`) now persist `scalingSnapshot` + `scalingAudit` payloads for regression tracking.
- **Telemetry harness:** `scripts/diagnostics/scaling-state-ab.js` runs seeded parity scrubs, capturing scaling telemetry and audit snapshots into `artifacts/scaling-state-ab/` for the Phase 2 rollout gates.
- **Undo/redo refresh:** History manager now fires UI hook triggers directly, eliminating the missing `triggerProcessingDetail`/`triggerPreviewUpdate`/`triggerInkChartUpdate` warnings (Playwright `tests/e2e/scaling-state-workflows.spec.ts`).
- **Intent remap guard:** `canApplyIntentRemap` defends against legacy delegate recursion (Vitest: `tests/ui/intent-system.test.js`), eliminating the RangeError previously logged during Playwright parity runs.
- **Regression coverage:** `tests/core/scaling-utils-dualread.test.js` and `tests/e2e/scaling-state-parity.spec.ts` assert validator + audit flows; smoke (`tests/e2e/page-load-smoke.spec.ts`) stays green after parity wiring.
- **Resolved:** Legacy importer utilities (`scripts/diagnostics/compare-coordinator-*.js`) now call `validateScalingStateSync({ throwOnMismatch: false, reason: 'diagnostics' })` after each operation.
- **Help overlay:** Help → Version History shows live scaling state audit counters (refresh + reset) so Phase 2 consumer audit coverage is complete; next follow-up is expanding diagnostics parity with the same snapshot payloads when additional consumers migrate.
- **Reason counters:** `scalingStateAudit.reasonCounts` exposes per-reason tallies (flag enable/disable, subscription resync, legacy apply, history undo/redo, rapid scaling) surfaced in the Help panel and the diagnostics harness.

#### Phase 2 – Rollout Validation Checklist (Private Lab)
1. **Telemetry harness (automated):** Run the parity harness with the flag off/on and archive artifacts alongside the existing sweep:
   ```bash
   node scripts/diagnostics/scaling-state-ab.js --iterations=5 --sequence=100 --no-state
   node scripts/diagnostics/scaling-state-ab.js --iterations=5 --sequence=100 --state
   ```
   Confirm `mismatchCount === 0`, queue p95 ≤ 20 ms, and state-mode latency delta ≤ +5 ms vs legacy.
2. **Automated regression gate:** Rebuild and execute `npx playwright test tests/e2e/scaling-state-workflows.spec.ts`, `npm test -- --run tests/core/scaling-utils-dualread.test.js`, and `npm run test:smoke` to assert the flag-on default stays green.
3. **Manual verification (single operator):** Follow the “Scaling State – Manual Acceptance” flow in `docs/manual_tests.md` to exercise scale input edits, undo/redo, and telemetry counters in one session.
4. **Rollback lever:** Keep `window.setScalingStateEnabled(false)` available through the compat bridge; if any mismatch appears, toggle the flag off, re-run the harness to confirm recovery, and investigate before re-enabling.

### Phase 3 (UI Rollout)
- Migrate high-traffic UI paths (blur, Enter, arrow keys, direct input).
- A/B deploy with the flag toggled on for staging, ramp to production.

### Phase 4 (Legacy Retirement)
- Remove legacy scaling entry points and feature flag.
- Document the new orchestrated workflow in user-facing notes.

## Parity Harness Summary
- `compare-coordinator-legacy.js` (randomized sequences, artifacts in `artifacts/scaling-coordinator-parity/`).
- `compare-coordinator-smart.js` (Smart curve scenario, artifacts in `artifacts/scaling-coordinator-smart/`).
- `compare-coordinator-lab.js` (LAB measurement scenario, artifacts in `artifacts/scaling-coordinator-lab/`).

## Checklist References
- `docs/features/checklists/PHASE_0_FOUNDATION.md`
- `docs/features/checklists/PHASE_1_ORCHESTRATOR.md`
- `docs/features/checklists/PHASE_2_DECLARATIVE_STATE.md`

Keep this plan updated as additional parity runs complete and migration tasks are delivered.
