# Phase 2: Declarative State Refactor (Track 2) - Checklist

**Duration:** Weeks 1-5 (including pre-work)
**Risk Level:** 🟡 Medium-High
**Goal:** Address baseline cache drift via centralized state management

---

## Pre-work (Week 0: Days 1-10)

### Upgrade State Manager Infrastructure

#### Add Memoization Layer
- [ ] Design selector pattern API
  - `stateManager.createSelector(path, computeFn): SelectorFn`
  - Selector caches result using WeakMap
  - Invalidates cache when dependencies change
- [ ] Implement WeakMap-based cache
  - Key: state object reference
  - Value: computed result
  - Auto-clears when state object GC'd
- [ ] Write memoization tests (8+ cases)
  - Same input → cached result (no recompute)
  - Changed input → new result (cache miss)
  - Dependency change → invalidation
  - Memory leak test (WeakMap GC behavior)

#### Implement Batch Update API
- [ ] Design batch API
  - `stateManager.batch(fn: () => void): void`
  - Buffer all `set()` calls during `fn` execution
  - Flush buffer when `fn` completes
  - Notify subscribers once (not per update)
- [ ] Implement batching state
  - `isBatching` flag (boolean)
  - `batchBuffer` array (pending updates)
  - Nesting counter (support nested batches)
- [ ] Update `set()` to check batching
  ```javascript
  set(path, value, options) {
    if (this.isBatching) {
      this.batchBuffer.push({ path, value, options });
    } else {
      this.applyUpdate(path, value, options);
    }
  }
  ```
- [ ] Implement `batch()` logic
  - Set `isBatching = true`
  - Execute user function
  - Set `isBatching = false`
  - Flush buffer (apply all updates)
  - Notify subscribers once with combined diff
- [ ] Write batching tests (10+ cases)
  - Multiple sets in batch → single notification
  - Nested batches → buffer until outermost completes
  - Error in batch → rollback all updates
  - Performance: 100 updates batched <5ms

#### Add Computed Property Support
- [ ] Design computed property API
  - `stateManager.addComputed(path, dependencies, computeFn)`
  - Auto-updates when any dependency changes
  - Memoized (only recomputes on dependency change)
- [ ] Implement computed property registry
  - Map<path, ComputedSpec>
  - ComputedSpec: `{ dependencies, computeFn, cachedValue }`
- [ ] Hook into subscription system
  - When dependency changes, recompute
  - Notify subscribers of computed path
- [ ] Add computed properties to state tree
  - `state.computed.scaling.maxAllowed` (computed from all channel limits)
  - `state.computed.scaling.isActive` (computed from globalPercent !== 100)
- [ ] Write computed property tests (8+ cases)
  - Dependency change → recompute
  - No dependency change → cached value
  - Multiple dependencies → all tracked
  - Circular dependency → error

#### Build History Schema Versioning
- [ ] Design schema versioning system
  - Add `version` field to history snapshots
  - Current: `version = 2` (with scaling state)
  - Legacy: `version = 1` (without scaling state)
- [ ] Update history snapshot format
  ```javascript
  {
    version: 2,
    timestamp: Date.now(),
    description: '...',
    state: { /* full state tree */ }
  }
  ```
- [ ] Implement schema migration utilities
  - `migrateSnapshotV1toV2(snapshot)`: Hydrate scaling state from globals
  - `canMigrateSnapshot(snapshot)`: Check if migration possible
  - `getSnapshotVersion(snapshot)`: Extract version number
- [ ] Write v1→v2 migration logic
  ```javascript
  function migrateSnapshotV1toV2(snapshot) {
    // Compute scaling state from channel values
    const scalingState = {
      globalPercent: computeGlobalPercent(snapshot.state),
      baselines: computeBaselines(snapshot.state),
      // ... other derived values
    };
    return {
      ...snapshot,
      version: 2,
      state: {
        ...snapshot.state,
        scaling: scalingState
      }
    };
  }
  ```
- [ ] Write schema versioning tests (8+ cases)
  - v1 snapshot → migrate to v2 → restore correctly
  - v2 snapshot → no migration needed
  - Invalid snapshot → migration fails gracefully
  - Migration preserves all non-scaling state

### Total Pre-work Deliverables
- [x] **Memoization layer** (8+ tests passing)
- [x] **Batch update API** (10+ tests passing)
- [x] **Computed properties** (8+ tests passing)
- [x] **Schema versioning** (8+ tests passing)
- [ ] **Performance benchmarks** (all <5ms target)
- [ ] **Budget: 1.5-2 weeks completed**

---

## Phase 1 (Weeks 1-2: Dual-Write Pattern)

### Add Scaling State Slice
- [x] Update `src/js/core/state-manager.js`
- [x] Add scaling section to initial state
  ```javascript
  createInitialState() {
    return {
      // ... existing state
      scaling: {
        globalPercent: 100,
        baselines: null, // { [channel]: number }
        isActive: false,
        maxAllowed: 1000
      }
    };
  }
  ```
- [x] Add computed properties
  - `state.computed.scaling.isActive` = `globalPercent !== 100`
  - `state.computed.scaling.maxAllowed` = `min(65535 / baseline for all channels)`

### Implement Dual-Write in Scaling Utils
- [x] Update `src/js/core/scaling-utils.js`
- [x] Keep legacy globals active
  ```javascript
  let scaleAllPercent = 100;  // Legacy (still active)
  let scaleBaselineEnds = null;  // Legacy (still active)
  ```
- [x] Add feature-flagged state writes
  ```javascript
  export function scaleChannelEndsByPercent(percent, options = {}) {
    // NEW: Write to state (if flag enabled)
    if (window.__USE_SCALING_STATE) {
      stateManager.batch(() => {
        stateManager.set('scaling.globalPercent', percent);
        stateManager.set('scaling.baselines', computeBaselines());
      });
    }

    // OLD: Still write to globals (always active)
    scaleAllPercent = percent;
    scaleBaselineEnds = computeBaselines();

    // Rest of logic unchanged (reads from globals)
  }
  ```
- [x] Add feature flag: `window.__USE_SCALING_STATE = false`

### Add Validation (State == Globals)
- [x] Implement validation helper
  ```javascript
  function validateScalingStateSync() {
    if (!window.__USE_SCALING_STATE) return;

    const statePercent = stateManager.get('scaling.globalPercent');
    const globalPercent = scaleAllPercent;

    if (Math.abs(statePercent - globalPercent) > 0.01) {
      console.error('State desync detected:', { statePercent, globalPercent });
      // Optionally throw error in dev mode
    }
  }
  ```
- [x] Call validation after every scale operation
- [x] Add validation to E2E tests (assert no desync)
- [x] Track parity metrics via `window.scalingStateAudit`
  - Expose counters for total checks, mismatches, last mismatch delta
  - Provide `dumpParityMetrics()` helper for soak runs + tracker updates
  - Reset metrics automatically when flag toggles to keep canary data clean

### Update History to Record Both Formats
- [x] Update history manager snapshot format
  ```javascript
  captureSnapshot() {
    return {
      version: 2,
      timestamp: Date.now(),
      description: this.currentActionDescription,
      state: this.stateManager.getState(), // Includes scaling if enabled
      legacy: {
        scaleAllPercent: window.scaleAllPercent,
        scaleBaselineEnds: window.scaleBaselineEnds
      }
    };
  }
  ```
- [x] Add snapshot validation (state matches legacy)

### Testing
- [x] Test: Scale with flag ON → assert state updated
- [ ] Test: Scale with flag OFF → assert only globals updated
- [x] Test: Scale with flag ON → validate state == globals
- [ ] Test: 1000 operations with flag ON → no desync
- [ ] Test: Undo/redo with flag ON → state restored correctly

### Deliverables (Phase 1)
- [x] **Scaling state slice** added to state manager
- [x] **Dual-write** active (state + globals)
- [ ] **Validation** asserts no desync (1000 ops tested)
- [x] **History** records both formats
- [x] **Feature flag** toggles state writes

---

## Phase 2 (Week 3: Dual-Read Pattern)

### Migrate Event Handlers to Read from State
- [x] Update `src/js/ui/event-handlers.js`
- [x] Add feature-flagged state reads
  ```javascript
  function initializeScaleHandlers() {
    if (window.__USE_SCALING_STATE) {
      // NEW: Subscribe to state changes
      stateManager.subscribe(['scaling.globalPercent'], (path, newValue) => {
        elements.scaleAllInput.value = formatScalePercent(newValue);
      });
    } else {
      // OLD: Poll globals (keep for now)
      // ... existing blur/enter handlers
    }
  }
  ```
- [x] Keep legacy handlers active (dual-read fallback)

### Migrate Chart Manager to Read from State
- [x] Update `src/js/ui/chart-manager.js`
- [x] Add state subscription for chart updates
  ```javascript
  if (window.__USE_SCALING_STATE) {
    stateManager.subscribe(['scaling.globalPercent'], () => {
      updateInkChart(); // Redraw on scale change
    });
  }
  ```

### Migrate Other Consumers
- [x] Update `getCurrentScale` to prefer state-managed value when flag enabled
- [x] Grep for `scaleAllPercent` and `scaleBaselineEnds` reads *(only `scaling-utils` retains the legacy globals)*
- [x] Update each consumer to read from state if flag enabled *(Help → Version History surfaces scaling audit counters when flag is on)*
- [x] Diagnostics parity scripts call `validateScalingStateSync({ throwOnMismatch: false, reason: 'diagnostics' })` after each scale
- [x] Telemetry harness (`scripts/diagnostics/scaling-state-ab.js`) records seeded scrubs with scaling audit + telemetry artifacts under `artifacts/scaling-state-ab/`
- [x] Intent remap recursion guard removes `Error checking intent remap capability` warning (tests/ui/intent-system.test.js)
- [x] Clamp-to-100 parity verified (maxAllowed resets to 1000 when baselines clear; harness `scaling-state-ab-2025-10-05T16-55-31-047Z.json` reports mismatchCount 0)
- [x] Keep fallback to globals (dual-read)

### Rollout Validation (Private Lab)
- [x] Run automated harness with flag off/on (`node scripts/diagnostics/scaling-state-ab.js --iterations=5 --sequence=100 --no-state` / `--state`) and confirm mismatchCount 0, queue p95 ≤ 20 ms, delta ≤ +5 ms.
- [x] Execute automated regression gate (`npx playwright test tests/e2e/scaling-state-workflows.spec.ts`, `npm test -- --run tests/core/scaling-utils-dualread.test.js`, `npm run test:smoke`).
- [x] Perform single-operator manual acceptance (see `docs/manual_tests.md`): scale input edits, undo/redo, validator check, capture audit snapshot.
- [x] Record artifacts in `artifacts/scaling-state-ab/` with run notes.

### Testing
- [x] Test: Scale with flag ON → UI updates from state *(Playwright: `tests/e2e/scaling-state-workflows.spec.ts`)*
- [x] Test: Scale with flag OFF → UI updates from globals *(Playwright: `tests/e2e/scaling-state-workflows.spec.ts`)*
- [x] Test: Switch flag mid-session → no desync *(Playwright: `tests/e2e/scaling-state-workflows.spec.ts`)*
- [x] Test: Rapid scaling with state reads → no race conditions *(Playwright: `tests/e2e/scaling-state-workflows.spec.ts`)*
- [x] Test: Undo/redo with state reads → UI syncs correctly *(Playwright: `tests/e2e/scaling-state-workflows.spec.ts`)*

### Deliverables (Phase 2)
- [x] **Consumers** read from state (flag enabled, fallback preserved)
- [x] **Dual-read** fallback to globals works
- [x] **Rollout validation complete** (automated harness + manual acceptance instead of staged canary)
- [x] **No UI regression** (Playwright scaling-state workflows + smoke)

---

## Phase 3 (Week 4: Remove Globals)

### Remove Dual-Write from Scaling Utils
- [ ] Update `scaling-utils.js`
- [ ] Remove global writes (state only)
  ```javascript
  export function scaleChannelEndsByPercent(percent, options = {}) {
    // Only write to state now
    stateManager.batch(() => {
      stateManager.set('scaling.globalPercent', percent);
      stateManager.set('scaling.baselines', computeBaselines());
    });

    // Legacy globals removed (no writes)
  }
  ```

### Deprecate Legacy Globals
- [ ] Add deprecation warnings
  ```javascript
  if (!window.__ALLOW_LEGACY_SCALING_GLOBALS) {
    Object.defineProperty(window, 'scaleAllPercent', {
      get() {
        throw new Error('scaleAllPercent deprecated - use stateManager.get("scaling.globalPercent")');
      }
    });
  }
  ```
- [ ] Set `__ALLOW_LEGACY_SCALING_GLOBALS = false` by default

### Remove Dual-Read from Consumers
- [ ] Remove feature flag checks
- [ ] All consumers read from state (no fallback)
  ```javascript
  function initializeScaleHandlers() {
    // Always use state now (no flag check)
    stateManager.subscribe(['scaling.globalPercent'], (path, newValue) => {
      elements.scaleAllInput.value = formatScalePercent(newValue);
    });
  }
  ```

### Audit for Global Accesses
- [ ] Grep for `scaleAllPercent` (should find zero non-deprecated uses)
- [ ] Grep for `scaleBaselineEnds` (should find zero non-deprecated uses)
- [ ] Run full test suite → ensure zero global accesses
- [ ] Fix any remaining references

### Testing
- [ ] Test: Full E2E suite with state only (no globals)
- [ ] Test: Performance benchmarks (state overhead <5%)
- [ ] Test: Memory usage (no leaks from subscriptions)
- [ ] Test: 10,000 scale operations (stress test)

### Deliverables (Phase 3)
- [ ] **Globals removed** from writes
- [ ] **Globals deprecated** (throw errors)
- [ ] **All consumers** read from state
- [ ] **Full test suite** passes (no globals)

---

## Phase 4 (Week 5: Clean History Migration)

### Remove v1 History Support
- [ ] Update `history-manager.js`
- [ ] Remove v1→v2 migration
  ```javascript
  restoreSnapshot(snapshot) {
    if (snapshot.version === 1) {
      console.warn('Old undo history (pre-v3.1) cannot be restored');
      return false;
    }
    // Only handle v2 snapshots
    this.stateManager.restoreState(snapshot.state);
  }
  ```
- [ ] Remove migration utilities (migrateSnapshotV1toV2, etc.)
- [ ] Update snapshot capture (don't record legacy format)

### Remove Feature Flags
- [ ] Delete `window.__USE_SCALING_STATE` from state.js
- [ ] Remove flag checks from event-handlers.js
- [ ] Remove `enableScalingState()` toggle function
- [ ] Delete `__ALLOW_LEGACY_SCALING_GLOBALS` flag

### Archive Dual-Path Code
- [ ] Create `legacy/scaling-state-migration-2025/`
- [ ] Copy original scaling-utils.js (with globals)
- [ ] Copy original event-handlers.js (with global reads)
- [ ] Copy v1→v2 migration utilities
- [ ] Add `MIGRATION_NOTES.md`:
  - Why declarative state was added
  - How dual-write/dual-read worked
  - Known issues with global-based approach
  - Rollback instructions (if needed)

### Update Documentation
- [ ] Update `CLAUDE.md` → "Scaling System Architecture"
  - State tree structure for scaling
  - Computed properties (maxAllowed, isActive)
  - Subscription patterns for consumers
- [ ] Update `CLAUDE_ARCHITECTURE.md`
  - Replace data flow diagram (state-based)
  - Document state manager upgrades (memoization, batching)
  - Add examples of using scaling state

### Deliverables (Phase 4)
- [ ] **v1 history support** removed
- [ ] **Feature flags** removed (cleanup)
- [ ] **Legacy code** archived (reference only)
- [ ] **Documentation** updated (architecture + usage)

---

## Success Criteria (Phase 2 Track Completion)

### Functional
- [ ] Zero baseline cache drift bugs (state is source of truth)
- [ ] Undo/redo works correctly after rapid scaling (schema v2 tested)
- [ ] All scaling Playwright tests pass (no regressions)
- [ ] State subscriptions fire correctly (UI syncs)
- [ ] Computed properties update automatically (no manual triggers)

### Performance
- [ ] Input latency <50ms p95 (measured with state reads)
- [ ] State overhead <5% (compared to legacy globals)
- [ ] Memoization prevents N² updates (measured)
- [ ] Batch updates reduce notification count (10+ updates → 1 notification)

### Quality
- [ ] Code coverage >80% for state-manager.js upgrades
- [ ] Schema versioning has >90% coverage
- [ ] Zero memory leaks (subscription cleanup tested)
- [ ] Debug logs work correctly (`DEBUG_LOGS = true`)

---

## Release Checklist (Phase 2 Completion)

### Documentation
- [ ] Update `CHANGELOG.md` under "Unreleased" → "Changed"
  - "Refactored scaling system to use declarative state management"
  - "Undo/redo now handles scaling operations through centralized state snapshots"
- [ ] Update `CHANGELOG.md` under "Unreleased" → "Performance"
  - "Optimized state manager with memoization and batch updates"
  - "Reduced subscription overhead: [document metrics]"
- [ ] Update `src/js/ui/help-content-data.js` VERSION_HISTORY
  - "Major scaling system refactor improves reliability and enables future features (presets, per-printer defaults)"

### Build & Deploy
- [ ] Run `npm run build:agent` to regenerate bundle
- [ ] Verify state manager code in bundle
- [ ] Test bundle on clean browser (no cache)
- [ ] Deploy to staging for final validation

### Regression Matrix
- [ ] Document state subscription coverage (5 scenarios)
- [ ] Document computed property coverage (3 scenarios)
- [ ] Document schema migration coverage (4 scenarios)
- [ ] Document performance benchmarks (memoization, batching)
- [ ] Tag entries as "Phase 2 - Declarative State"

### Team Communication
- [ ] Demo state manager upgrades (memoization, batching, computed)
- [ ] Review migration notes (dual-write/dual-read patterns)
- [ ] Document state tree structure (for future features)
- [ ] Celebrate completion! 🎉

---

## Rollback Plan (Any Phase)

### If Issues Found
- [ ] Toggle `__USE_SCALING_STATE = false` (Phases 1-3)
- [ ] Or: Toggle `__ALLOW_LEGACY_SCALING_GLOBALS = true` (Phase 3)
- [ ] Or: Revert entire commit (Phase 4, after flags removed)
- [ ] Document issue with reproduction steps
- [ ] File bug for future fix

---

**Phase 2 Start Date:** _______________
**Phase 2 Completion Date:** _______________
**Sign-off:** _______________ (Team Lead / Tech Lead)
