# Phase 1: Orchestrator Refactor (Track 1) - Checklist

**Duration:** Weeks 1-5 (including pre-work)
**Risk Level:** 🔴 High
**Goal:** Address baseline cache drift via queue-based orchestration

---

## Pre-work (Week 0: Days 1-4)

### Add Transaction Support to History Manager
- [x] Design transaction API
  - `history.beginTransaction(description: string): TransactionId`
  - `history.commit(transactionId: TransactionId): void`
  - `history.rollback(transactionId: TransactionId): void`
- [x] Implement transaction state tracking
  - Active transaction ID (null if none)
  - Pending actions buffer (collected during transaction)
  - Nesting depth counter (prevent nested transactions)
- [x] Update `recordChannelAction` to buffer during transactions
  - Check if transaction active
  - If yes: push to buffer, don't record to history yet
  - If no: record immediately (existing behavior)
- [x] Implement `commit()` logic
  - Flush buffer as single batch action
  - Clear transaction state
  - Trigger history update event
- [x] Implement `rollback()` logic
  - Discard buffer contents
  - Restore state to pre-transaction snapshot
  - Clear transaction state
- [x] Add transaction nesting guards
  - Throw error if `beginTransaction()` called during active transaction
  - Log warning if transaction not committed within 5 seconds
- [x] Write unit tests for transaction API (10+ cases)
  - Begin → commit → undo (single batch entry)
  - Begin → rollback → undo (no entry recorded)
  - Multiple actions in transaction (all atomic)
  - Rollback restores original state
  - Nested transaction throws error
- [x] Document transaction API in `src/js/core/history-manager.js` JSDoc
- [ ] Capture baseline scaling + undo/redo snapshots before coordinator work
  - Throwaway Playwright script exercises current scale → undo → redo flows
  - Save serialized channel state + console output artifacts for later parity checks
  - Store artifacts under `artifacts/scaling-baseline/` (ignored in repo if desired)

---

## Phase 1 (Weeks 1-2: Build Parallel System)

### Create Scaling Coordinator Module
- [x] Create `src/js/core/scaling-coordinator.js`
- [x] Implement `ScalingCoordinator` class
  - Constructor: Initialize queue, processing flag, history reference
  - `async scale(percent, source, options)`: Queue entry point
  - `async processQueue()`: Main processing loop
  - `async executeScaleOperation(op)`: Single operation handler
- [x] Implement queue data structure
  - Array of operation objects: `{ type, percent, source, timestamp, resolve, reject }`
  - FIFO ordering (oldest first)
  - Priority levels: 'high' (immediate), 'normal' (debounced)
- [x] Implement processing logic
  - Check if already processing (prevent re-entry)
  - Pop next operation from queue
  - Begin history transaction
  - Call `scaleChannelEndsByPercent()`
  - Wait for Smart curve rescaling to complete
  - Wait for chart update to complete
  - Commit history transaction
  - Resolve promise
  - Process next operation (recursive)
- [x] Add error handling
  - Catch errors during operation
  - Rollback history transaction
  - Reject promise with error
  - Continue processing queue (don't block on failure)
- [x] Add debug logging (if `DEBUG_LOGS = true`)
  - Queue length on each operation
  - Processing time per operation
  - Transaction IDs
- [x] Expose coordinator telemetry on `window.scalingCoordinator.debug`
  - Track max queue length, average processing time, retry counts
  - Include quick `dumpMetrics()` helper for canary reviews
  - Document usage in coordinator module comments

### Integrate with Event Handlers
- [x] Update `src/js/ui/event-handlers.js`
- [x] Add feature flag check in `commitScaleAll()`
  ```javascript
  if (window.__USE_SCALING_COORDINATOR) {
    scalingCoordinator.scale(parsed, 'ui').then(result => {
      showStatus(result.message);
    });
  } else {
    applyGlobalScaleCore(parsed); // Legacy path
  }
  ```
- [x] Import `scalingCoordinator` singleton at top of file
- [x] Initialize coordinator in `initializeEventHandlers()`
- [x] Add coordinator to debug registry (`window.scalingCoordinator`)

### Feature Flag Infrastructure
- [x] Add `window.__USE_SCALING_COORDINATOR = false` in `src/js/core/state.js`
- [x] Add toggle function: `window.enableScalingCoordinator(boolean)`
  - Set flag value
  - Log message to console
  - Optionally reload UI bindings
- [x] Document flag in `CLAUDE.md` debug section

### Unit Tests for Coordinator
- [x] Test: Single scale operation (100% → 80%)
- [x] Test: Multiple sequential operations (100 → 80 → 60 → 100)
- [x] Test: Queue ordering (FIFO, oldest processed first)
- [x] Test: Error handling (operation fails, queue continues)
- [x] Test: Transaction boundaries (one operation = one undo entry)
- [x] Test: Promise resolution (caller receives result)
- [x] Test: Promise rejection (caller receives error)
- [x] Test: High priority operations (bypass debounce)
- [x] Test: Concurrent scale requests (queued, not parallel)
- [x] Test: Queue drain on disable (no in-flight ops lost)
- [x] **Total: 10+ unit tests**

### Integration Tests (Coordinator + Legacy Comparison)
- [ ] Test: Compare coordinator vs. legacy on 1000 random operations
  - Generate random scale values (1-1000%)
  - Run with flag ON and OFF
  - Assert final state identical
  - Document any divergence as bug
- [ ] Test: Coordinator with Smart curves active
  - Enable Edit Mode
  - Scale via coordinator
  - Verify key points rescaled correctly
- [ ] Test: Coordinator with undo/redo
  - Scale → undo → redo
  - Verify state transitions correct
  - Check history stack depth (one entry per scale)

### Deliverables (Phase 1)
- [x] **scaling-coordinator.js** module (200-300 lines)
- [x] **History transaction API** working (5+ tests passing)
- [x] **Feature flag** toggles coordinator on/off
- [x] **10+ unit tests** for coordinator (all passing)
- [ ] **Integration tests** show parity with legacy (1000 ops)

---

## Phase 2 (Week 3: Migrate Low-Traffic Paths)

### Migrate AI Commands
- [ ] Update `src/js/ai/ai-actions.js`
- [ ] Remove feature flag check (always use coordinator for AI)
  ```javascript
  scale_channel_ends_by_percent({ scalePercent }) {
    return scalingCoordinator.scale(scalePercent, 'ai');
  }
  ```
- [ ] Update other AI scaling functions if any
- [ ] Add coordinator to Lab Tech context (expose via `window`)

### Migrate Programmatic Calls
- [ ] Audit all direct calls to `scaleChannelEndsByPercent` via grep
- [ ] Update each call site to use coordinator
- [ ] Leave UI event handlers on legacy (defer to Phase 3)

### Testing
- [ ] Run AI integration tests (Track 4 harness)
  - Test: `scale_channel_ends_by_percent` via Lab Tech
  - Test: Undo after AI scale
  - Test: AI scale during active user scale (queued correctly)
- [ ] Run full E2E suite with AI path on coordinator
- [ ] Verify no regressions in AI command behavior

### Deliverables (Phase 2)
- [ ] **AI commands** route through coordinator (no flag)
- [ ] **Programmatic calls** route through coordinator
- [ ] **UI handlers** still on legacy (high-traffic deferred)
- [ ] **AI integration tests** pass (all scenarios)

---

## Phase 3 (Week 4: Migrate High-Traffic UI Paths)

### Migrate Blur/Enter Handlers
- [ ] Update `commitScaleAll()` in `event-handlers.js`
- [ ] Remove feature flag check (always use coordinator)
  ```javascript
  function commitScaleAll(raw, immediate = false) {
    scalingCoordinator.scale(parsed, 'ui', {
      priority: immediate ? 'high' : 'normal'
    });
  }
  ```
- [ ] Keep legacy functions as private (not exported, not called)

### Migrate Arrow Key Handler
- [ ] Update arrow key timeout logic
  ```javascript
  setTimeout(() => {
    scalingCoordinator.scale(elements.scaleAllInput.value, 'ui');
  }, 0);
  ```

### Migrate Real-Time Input Handler
- [ ] Update input event debounce
  ```javascript
  inputDebounceTimer = setTimeout(() => {
    scalingCoordinator.scale(value, 'ui', { priority: 'normal' });
  }, 150);
  ```

### A/B Testing
- [ ] Deploy to staging with flag OFF (control group)
- [ ] Enable flag for 10% of operations (canary test)
- [ ] Monitor for 24 hours:
  - Coordinator failures per minute (`scalingCoordinator.metrics.failed`) stay at 0
  - Queue length/latency (`getDebugInfo().maxQueueLength`, `lastDurationMs`) remain within targets (max queue ≤ 5, p95 < 50 ms)
  - UI telemetry (existing status-service logs) shows no scale errors
- [ ] Increase to 50% if canary passes
- [ ] Monitor for 48 hours with same metrics
- [ ] Enable for 100% if no issues; keep legacy fallbacks accessible for one release cycle

### Performance Benchmarks
- [ ] Measure input latency with Playwright
  - Simulate rapid typing in scale input
  - Measure time from keypress to chart update
  - Assert p95 <50ms (coordinator overhead <5ms)
- [ ] Measure queue processing time
  - 100 operations queued at once
  - Time from first to last completion
  - Assert <2 seconds total (20ms avg per op)

### Deliverables (Phase 3)
- [ ] **All UI handlers** route through coordinator
- [ ] **Legacy functions** private (not called)
- [ ] **A/B test results** documented (50%+ canary passed)
- [ ] **Performance benchmarks** meet targets (p95 <50ms)

---

## Phase 4 (Week 5: Remove Legacy Code)

### Mark Legacy Functions as Deprecated
- [ ] Update `scaling-utils.js`
  ```javascript
  export function applyGlobalScale(rawPercent) {
    throw new Error('applyGlobalScale deprecated - use scalingCoordinator.scale()');
  }
  ```
- [ ] Update `scaleChannelEndsByPercent` JSDoc
  - Add `@deprecated Use scalingCoordinator.scale() instead`
- [ ] Search codebase for any remaining direct calls
  - Should find zero (all migrated)

### Remove Feature Flags
- [ ] Delete `window.__USE_SCALING_COORDINATOR` from state.js
- [ ] Remove flag checks from event-handlers.js
- [ ] Remove `enableScalingCoordinator()` toggle function
- [ ] Update debug docs (flag no longer needed)

### Archive Legacy Code
- [ ] Create `legacy/scaling-migration-2025/`
- [ ] Copy original `scaling-utils.js` (pre-coordinator)
- [ ] Copy original `event-handlers.js` (pre-coordinator)
- [ ] Add `MIGRATION_NOTES.md` explaining:
  - Why orchestrator was added
  - How dual-path worked
  - Known issues with legacy approach
  - Rollback instructions (if needed)

### Update Documentation
- [ ] Update `CLAUDE.md` → "Scaling System Architecture"
  - Add orchestrator data flow diagram
  - Document transaction boundaries
  - Explain queue ordering guarantees
- [ ] Update `CLAUDE_ARCHITECTURE.md`
  - Replace old scaling diagram with coordinator-based flow
  - Document coordinator API
  - Add examples of using coordinator

### Deliverables (Phase 4)
- [ ] **Legacy functions** throw deprecation errors
- [ ] **Feature flags** removed (cleanup)
- [ ] **Legacy code** archived (reference only)
- [ ] **Documentation** updated (architecture + usage)

---

## Success Criteria (Phase 1 Track Completion)

### Functional
- [ ] Zero baseline cache drift bugs (tested 1000+ operations)
- [ ] Undo/redo works correctly after rapid scaling (E2E verified)
- [ ] All scaling Playwright tests pass (no regressions)
- [ ] AI commands route through coordinator (deterministic)
- [ ] Queue never deadlocks (soak test 10,000 operations)

### Performance
- [ ] Input latency <50ms p95 (measured in production)
- [ ] Queue processing <20ms per operation average
- [ ] No memory leaks (1,000 operations tested)
- [ ] Chart updates feel instant (no visible lag)

### Quality
- [ ] Code coverage >80% for scaling-coordinator.js
- [ ] Transaction API has >90% coverage
- [ ] Zero flaky tests (10 consecutive CI runs)
- [ ] Debug logs work correctly (`DEBUG_LOGS = true`)

---

## Release Checklist (Phase 1 Completion)

### Documentation
- [ ] Update `CHANGELOG.md` under "Unreleased" → "Changed"
  - "Refactored scaling system to use transaction-based orchestrator for improved reliability"
  - "Undo/redo now handles scaling operations atomically (one action = one undo entry)"
- [ ] Update `CHANGELOG.md` under "Unreleased" → "Performance"
  - "Optimized scaling input latency: [document p95 before/after]"
- [ ] Update `src/js/ui/help-content-data.js` VERSION_HISTORY
  - "Major scaling system refactor improves undo/redo support and prevents baseline cache drift"

### Build & Deploy
- [ ] Run `npm run build:agent` to regenerate bundle
- [ ] Verify coordinator code in bundle (not tree-shaken)
- [ ] Test bundle on clean browser (no cache)
- [ ] Deploy to staging for final validation

### Regression Matrix
- [ ] Document coordinator transaction coverage (5 scenarios)
- [ ] Document queue ordering coverage (3 scenarios)
- [ ] Document performance benchmarks (p50, p95, p99)
- [ ] Tag entries as "Phase 1 - Orchestrator"

### Team Communication
- [ ] Demo orchestrator to team (queue, transactions, rollback)
- [ ] Review migration notes (how dual-path worked)
- [ ] Document known issues / deferred improvements
- [ ] Celebrate completion! 🎉

---

## Rollback Plan (Any Phase)

### If Issues Found
- [ ] Toggle `__USE_SCALING_COORDINATOR = false` (Phases 1-3)
- [ ] Or: Revert entire commit (Phase 4, after flags removed)
- [ ] Drain queue before fallback (no in-flight operations lost)
- [ ] Document issue with reproduction steps
- [ ] File bug for future fix

---

**Phase 1 Start Date:** _______________
**Phase 1 Completion Date:** _______________
**Sign-off:** _______________ (Team Lead / Tech Lead)
