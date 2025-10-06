# Scaling Improvement Tracker

## Baseline Artifacts
- 2025-10-04T16:30:36Z — `artifacts/scaling-baseline/baseline-2025-10-04T16-30-36-855Z.json` (SHA256 a37ab047b3cf47037ef5f8e22dde4283e169aa3406bccc5da7332563dd4d8d2b)

## Phase 0 Track 4: Test Harness ✅ COMPLETE (2025-10-04)

### Summary
Comprehensive test infrastructure for global scaling baseline cache behavior, including unit tests, E2E regression scenarios, state-driven wait helpers, and CI integration.

### Unit Tests (12 passing in `tests/core/scaling-utils-baseline.test.js`)
- ✅ Baseline cache lifecycle: capture → reuse → invalidation at 100%
- ✅ Guard conditions: min/max limits, zero endpoints, invalid inputs
- ✅ Multi-channel independence and cache coherence
- ✅ Manual edit baseline refresh workflow
- ✅ Clamping behavior at ink maximum (65535)
- ✅ Scale computation from current values (first operation)

### E2E Tests (7 passing scenarios)
- ✅ `tests/e2e/global-scale-baseline-drift.spec.ts` - Manual edit under scaled state preserves baseline
- ✅ `tests/e2e/global-scale-rapid-undo.spec.ts` - Rapid slider scrub maintains history integrity
- ✅ `tests/e2e/global-scale-measurement-revert.spec.ts` - Measurement state preservation across scale/revert cycles
- ✅ `tests/e2e/edit-mode-keypoint-scaling.spec.ts` - Smart point insertion after global scale (absolute position preservation)
- ✅ `tests/e2e/edit-mode-scale.spec.ts` - Basic scaling with state-driven waits
- ✅ `tests/e2e/edit-mode-global-revert.spec.ts` - Revert button interaction with LAB data
- ✅ `tests/e2e/edit-mode-global-recompute-revert.spec.ts` - Recompute + revert workflow

### Test Infrastructure
- **Helpers** (`tests/utils/scaling-test-helpers.ts`):
  - `waitForScaleComplete(page, expectedPercent)` - Polls for scale slider state change
  - `captureScalingState(page)` - Snapshots scale %, baselines, channel ends
  - `compareScalingStates(before, after)` - Diffs two state snapshots
  - `waitForPointNearInput(page, targetInput, tolerance)` - Smart point position check
- **CI Integration**:
  - Pre-commit hook: `npm run test:scaling:baseline` (bypass with `SKIP_SCALING_PRECHECK=1`)
  - Parallel execution: 3 workers via `SCALE_SPEC_WORKERS` env var
  - Timeout threshold: 30s per test, reports slow tests >15s
  - Automated via `npm run test:e2e` (runs seeding harness + scaling specs)

### Test Execution
```bash
# Unit tests only
npm run test:scaling:baseline

# E2E scaling specs only
npx playwright test tests/e2e/global-scale-*.spec.ts

# Full E2E suite (includes seeding + all scaling tests)
npm run test:e2e

# Pre-commit check (runs automatically on git commit)
node scripts/test-tools/run-precommit-scaling.js
```

### Deliverables
- [x] 12 unit tests (100% of checklist items)
- [x] 5 E2E regression scenarios (100% of checklist items)
- [x] Reusable test helpers with state-driven waits
- [x] CI gate with pre-commit hooks
- [x] Documentation in README.md and docs/manual_tests.md

---

## Phase 0 Track 3: Rescaling Service ✅ COMPLETE (2025-10-04)

### Summary
Smart rescaling service implemented with pure functions for normalization, metadata reconciliation, and rescaling operations. Fully integrated into smart-curves.js with audit mode for legacy comparison.

### Implementation (`src/js/curves/smart-rescaling-service.js`)
**Core Functions:**
- ✅ `normalizeKeyPoints(points)` - Clamping [0,100], monotonic enforcement, duplicate removal (0.01 tolerance)
- ✅ `reconcileBakedMetadata(meta, scaleFactor)` - Auto flag cleanup when endpoints shift >1%
- ✅ `rescaleKeyPointsForInkLimit(channel, fromPercent, toPercent, options)` - Main rescaling entry point
  - Supports `preserveAbsolute` (default) and `preserveRelative` modes
  - Returns `{ success, points, metadata, warnings, scaleFactor }`
  - Validates inputs, normalizes outputs, reconciles metadata

### Unit Tests (19 passing in `tests/curves/smart-rescaling-service.test.js`)
**normalizeKeyPoints** (3 tests):
- Clamps inputs/outputs to [0,100], sorts by input, enforces monotonic
- Removes duplicates within 0.01 tolerance
- Handles invalid inputs safely (null, undefined)

**reconcileBakedMetadata** (3 tests):
- Returns shallow copy when scale factor ~1.0
- Clears `bakedAutoWhite`/`bakedAutoBlack` when scale shifts >1%
- Preserves metadata when scale change below threshold

**rescaleKeyPointsForInkLimit** (13 tests):
- Invalid input validation
- preserveRelative mode
- Scale 100→50% (halving), 50→100% (doubling with clamp)
- Zero percent handling (collapse to 0)
- No-op when scale factor = 1.0
- Endpoint accuracy (within 0.5%)
- Float precision edge cases (99.99999% → 100%)
- Performance: 256-point array <10ms
- Warnings for shifts >5%
- Metadata reconciliation propagation
- Integration: monotonic output enforcement

### Integration (`src/js/curves/smart-curves.js`)
- ✅ `rescaleSmartCurveForInkLimit` delegates to service (line 469)
- ✅ Audit mode `window.__SMART_RESCALE_AUDIT` compares legacy vs service (lines 19-64, 489-522)
- ✅ Logs warnings when delta >0.05%
- ✅ Debug logging for rescale operations when `DEBUG_LOGS = true`
- ✅ History integration with rescale tracking

### E2E Integration (via Track 4 tests)
- ✅ `tests/e2e/global-scale-measurement-revert.spec.ts` - LAB correction + rescale
- ✅ `tests/e2e/edit-mode-keypoint-scaling.spec.ts` - Smart point insertion after scale
- ✅ `tests/e2e/global-scale-rapid-undo.spec.ts` - Undo/redo with rescaling
- ✅ All scaling E2E tests run with service active (no regressions)

### Performance
- ✅ Single channel rescale: <10ms (256 points)
- ✅ 8-channel simultaneous rescale: ~30-40ms (beats <50ms target)
- ✅ Zero memory leaks (pure functions, no state)
- ✅ Float precision stable across edge cases

### Deliverables
- [x] Service implementation with 3 exported functions
- [x] 19 unit tests (127% of 15 required)
- [x] Integration via audit mode + E2E tests
- [x] Performance benchmarks (all targets met)
- [x] Legacy code replaced with service delegation

---

## Phase 0: Status Summary

**Track 3 (Rescaling Service):** ✅ Complete
**Track 4 (Test Harness):** ✅ Complete

### Combined Test Coverage
- **Unit Tests:** 31 passing (12 baseline + 19 rescaling)
- **E2E Tests:** 7 passing (all scaling scenarios)
- **Total:** 38 tests with 100% pass rate

### Next: Phase 0 Release
All functional requirements met. Ready for release checklist and documentation updates.

---

## Phase 1: Orchestrator — In Progress

**Pre-work (Transactions):** ✅ Completed (2025-10-04)
- Added buffered history transactions with begin/commit/rollback helpers (`HistoryManager` now guards against nesting, captures snapshots, and flushes entries atomically).
- Wrote dedicated Vitest coverage (`tests/core/history-manager-transactions.test.js`, 10 specs) to guard commit/rollback/nesting behaviours.
- Default feature flag wiring: `window.__USE_SCALING_COORDINATOR` initializes to `false` and exposes `enableScalingCoordinator(true|false)` for manual toggling.

**Coordinator Scaffolding:** ✅ Initial implementation landed (feature-flagged)
- `src/js/core/scaling-coordinator.js` serializes Scale requests, wraps each run in a history transaction, and mirrors legacy UI updates.
- Debug namespace `window.scalingCoordinator` exposes `setEnabled`, `flushQueue`, and `getDebugInfo()` (metrics: queue length, failures, last duration).
- 11 coordinator unit tests validate FIFO behaviour, priority handling, rollback paths, metadata plumbing, and metrics (`tests/core/scaling-coordinator.test.js`).
- `src/js/ui/event-handlers.js` respects the flag: when enabled, `commitScaleAll` and debounced input flows queue operations through the coordinator; legacy path remains intact otherwise.
- AI commands (`scale_channel_ends_by_percent`) now call `scalingCoordinator.scale()` directly, so Lab Tech automation benefits from transactional scaling even when the UI flag remains off.

- **Parity Validation:**
  - `scripts/diagnostics/compare-coordinator-legacy.js` runs randomized legacy vs. coordinator sequences (default 10×200 steps; recent 10×1000 run also produced zero diffs). Artifacts stored under `artifacts/scaling-coordinator-parity/summary.json` for auditing.
  - Coordinator initialization now re-applies the feature flag during event-handler boot and flushes any queued operations when disabled, keeping parity runs deterministic.
  - Smart parity check (`scripts/diagnostics/compare-coordinator-smart.js`) loads `P700-P900_MK50.quad`, enables Edit Mode, and exercises a four-step scale sequence (80→60→120→95). Legacy and coordinator snapshots matched (`artifacts/scaling-coordinator-smart/`).
  - LAB parity check (`scripts/diagnostics/compare-coordinator-lab.js`) applies `cgats17_21step_lab.txt`, runs a five-step sequence (90→110→70→125→95), and confirms parity (`artifacts/scaling-coordinator-lab/`).
  - AI command parity (`scripts/diagnostics/compare-coordinator-ai.js`) invokes `scale_channel_ends_by_percent` through the Lab Tech bridge (90→110→70→95) with matching legacy/coordinator outputs (`artifacts/scaling-coordinator-ai/`).

**Outstanding (Phase 1):**
- Expand parity coverage to Smart curve + LAB scenarios (ensure coordinator and legacy undo/redo stay aligned under Edit Mode).
- Scale up the randomized sequence harness to the full 1000-iteration matrix defined in the checklist before migrating high-traffic UI paths.
