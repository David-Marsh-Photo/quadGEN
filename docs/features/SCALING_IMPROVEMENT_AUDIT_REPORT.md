# Scaling Improvement Plans - Architecture Audit & Risk Assessment

**Date:** 2025-10-04
**Reviewer:** Claude (Lab Tech)
**Subject:** Analysis of proposed scaling system improvements from `SCALING_IMPROVEMENT_PLANS.md`

---

## Executive Summary

This audit evaluates five proposed improvement tracks for quadGEN's global scaling system. The current implementation shows signs of technical debt across ~500 lines of code spanning 7+ modules, with known regression vectors in baseline cache management, history tracking, and Smart curve rescaling. The proposed improvements range from **low-risk additive testing** to **high-risk architectural refactors** that touch core editing flows.

**Key Finding:** Tracks 3 and 4 (Smart Curve Service + Test Harness) offer the **best risk/reward ratio** and should be prioritized. Tracks 1 and 2 require significant planning and staged rollout to avoid breaking existing workflows.

---

## Implementation Checklists

Comprehensive phase-by-phase checklists are available for each track:

- **[Phase 0: Foundation (Tracks 3 + 4)](checklists/PHASE_0_FOUNDATION.md)** - 🟢 Low Risk, 2-3 weeks
  - Track 4: Test Harness (20+ unit tests, 5 E2E scenarios)
  - Track 3: Rescaling Service (normalize, metadata reconciliation)
  - Release workflow, regression matrix entries

- **[Phase 1: Orchestrator (Track 1)](checklists/PHASE_1_ORCHESTRATOR.md)** - 🔴 High Risk, 3.5-4.5 weeks
  - Pre-work: History transaction API (4 days)
  - Dual-path: Feature-flagged coordinator + legacy paths
  - Migration: AI → UI handlers → cleanup
  - Rollback strategy, validation gates

- **[Phase 2: Declarative State (Track 2)](checklists/PHASE_2_DECLARATIVE_STATE.md)** - 🟡 Medium Risk, 3.5-5 weeks
  - Pre-work: State-manager upgrades (10 days)
  - Dual-write: State + globals in sync
  - Dual-read: Consumers migrate to state
  - Remove globals, clean history migration

**Using the Checklists:**
- Each checklist includes pre-work, phased migration, testing, deliverables, success criteria, and rollback plans
- Check off items as completed to track progress
- Sign-off sections at end of each phase
- Refer back to this audit for context and risk analysis

---

## Current Architecture Overview

### Code Distribution
```
Core Scaling Logic:         src/js/core/scaling-utils.js (~350 lines)
UI Event Handlers:          src/js/ui/event-handlers.js (~190 lines in initializeScaleHandlers)
Smart Curve Rescaling:      src/js/curves/smart-curves.js (rescaleSmartCurveForInkLimit ~80 lines)
History Integration:        src/js/core/history-manager.js (subscription-based capture)
AI Integration:             src/js/ai/ai-actions.js (scale_channel_ends_by_percent wrapper)
State Management:           src/js/core/state-manager.js (stores channelValues, scaling metadata)
```

### Key Dependencies
- **State Manager:** Centralized state with subscription system for undo/redo
- **History Manager:** Batch action recording with snapshot restoration
- **Smart Curves:** Per-channel key point rescaling with metadata preservation
- **Input Validation:** Clamping and conversion between percent/end/value domains
- **UI Hooks:** Chart updates, preview rendering, status messages

### Critical Data Flows
1. **User Input** → Event Handler → commitScaleAll → applyGlobalScale → scaleChannelEndsByPercent
2. **scaleChannelEndsByPercent** → Baseline Cache Update → Per-Channel Scaling → rescaleSmartCurveForInkLimit
3. **rescaleSmartCurveForInkLimit** → setSmartKeyPoints → History Recording → Chart Update
4. **Undo/Redo** → History Manager → State Restoration → UI Sync → Chart Re-render

---

## Regression Vectors (Current Issues)

### 1. **Baseline Cache Drift** 🔴 HIGH SEVERITY
**Location:** `scaling-utils.js:89-134` (baseline calculation and guards)

**Problem:**
- Global baseline cache (`scaleBaselineEnds`) can become stale when channels are edited under non-100% scale
- Guard logic (lines 114-126) attempts to prevent double-scaling but uses heuristics that fail in edge cases
- Cache is cleared only when returning to 100% (line 214), not on explicit channel edits

**Evidence:**
```javascript
// scaling-utils.js:111-126
if (scaleBaselineEnds[channelName] != null) {
    baseEnd = InputValidator.clampEnd(scaleBaselineEnds[channelName]);
    // Guards here can guess wrong if user manually edits channel during scaling
    if (previousFactor > 1.000001 && currentEnd >= 65535 && baseEnd > currentEnd) {
        baseEnd = currentEnd; // Guard 1: Prevent scaling beyond max
    }
    // ... more guards
}
```

**Impact:** Subsequent scale operations compound incorrectly, breaking "proportional boost" behavior

---

### 2. **Real-Time Input Bypass** 🟡 MEDIUM SEVERITY
**Location:** `event-handlers.js:418-450` (input event handler)

**Problem:**
- Real-time `input` event handler (line 418) directly calls `applyGlobalScaleCore` with 150ms debounce
- Bypasses `commitScaleAll` logic that validates change detection (line 309)
- Can create rapid-fire scaling operations that race with history recording
- History subscriptions may miss intermediate states during rapid scrubbing

**Evidence:**
```javascript
// event-handlers.js:440-447
inputDebounceTimer = setTimeout(() => {
    // Directly call applyGlobalScale instead of commitScaleAll
    // This bypasses the complex baseline logic and just scales from current values
    if (applyGlobalScaleCore) {
        applyGlobalScaleCore(value);
    }
}, 150);
```

**Impact:** Undo/redo stack can desynchronize from displayed scale percent, user sees "100%" but internal state is 95%

---

### 3. **Smart Curve Rescaling Normalization Gaps** 🟡 MEDIUM SEVERITY
**Location:** `smart-curves.js:rescaleSmartCurveForInkLimit` (not fully shown in snippets, inferred from behavior)

**Problem:**
- Rescaling multiplies key point outputs by scale factor without explicit normalization checks
- Rounding errors accumulate across multiple scale operations
- Baked metadata (`bakedGlobal`, `bakedAutoWhite`, etc.) can become inconsistent if rescaling doesn't update tags
- No unit-testable invariants for "relative output stays in [0, 100]" post-rescale

**Evidence:** Test expectations allow up to 0.75% delta (edit-mode-keypoint-scaling.spec.ts:158)

**Impact:** Key points can collapse or exceed 100% relative output, breaking curve rendering

---

### 4. **Deferred Reapply Race Conditions** 🟡 MEDIUM SEVERITY
**Location:** Multiple locations using `setTimeout(..., 0)` for chart updates

**Problem:**
- Legacy pattern of deferring chart updates creates race conditions with undo/redo
- Playwright tests report nondeterministic failures (per SCALING_IMPROVEMENT_PLANS.md:14)
- No guaranteed ordering between scale → rescale → chart render → history snapshot

**Evidence:**
- `event-handlers.js:408-411` uses `setTimeout` for arrow key commits
- Tests use `page.waitForTimeout` instead of deterministic state checks (spec.ts:23, 46, 113)

**Impact:** Automated tests flake, users may see stale chart data for 100-200ms

---

### 5. **Testing Coverage Gaps** 🔴 HIGH SEVERITY
**Location:** `tests/e2e/edit-mode-keypoint-scaling.spec.ts` (out of date per plans)

**Problem:**
- Only 4 scaling-related tests exist (3 passing scenarios + 1 complex undo workflow)
- No coverage for: scale → edit channel → scale again (baseline drift)
- No coverage for: rapid scrubbing → undo (history desync)
- No coverage for: scale → revert → scale (baseline cache interaction with revert)
- Tests use fixed delays instead of waiting for app state markers

**Evidence:**
```typescript
// edit-mode-keypoint-scaling.spec.ts:23
await page.waitForTimeout(150); // Fixed delay, not state-driven
```

**Impact:** Regressions ship to production undetected

---

## Improvement Track Analysis

### Track 1: Centralized Scaling Orchestrator

**Proposed Scope:**
Introduce a coordinator that queues global scale, per-channel edits, and Smart rescale operations, applying them transactionally with ordered history capture.

#### Architecture Changes Required

```
New Module: src/js/core/scaling-orchestrator.js
├── ScalingQueue: Command queue with priority levels
├── ScalingTransaction: Atomic batch of scale + rescale + history operations
├── ScalingCoordinator: Mediates between UI → Queue → Core Utils → Smart Curves
└── ScalingValidator: Pre-flight checks for baseline coherence

Modified Modules:
├── event-handlers.js: Route all scale events through coordinator
├── ai-actions.js: scale_channel_ends_by_percent delegates to coordinator
├── scaling-utils.js: Pure functions (no direct state mutation)
└── history-manager.js: Subscribe to coordinator events
```

#### Code Locations Impacted

| File | Lines | Complexity | Risk |
|------|-------|------------|------|
| `scaling-utils.js` | 55-241 | **HIGH** - Core baseline logic | 🔴 Breaking changes |
| `event-handlers.js` | 265-453 | **HIGH** - 5 event listeners | 🔴 Requires rewiring |
| `smart-curves.js` | rescaleSmartCurveForInkLimit | **MEDIUM** - Metadata handling | 🟡 Wrapper safe |
| `history-manager.js` | 45-76 | **LOW** - Subscription-based | 🟢 Event source change |
| `ai-actions.js` | scale_channel_ends_by_percent | **LOW** - Thin wrapper | 🟢 Delegate pattern |

**New Code Estimate:** ~400-600 lines (orchestrator + tests)
**Additional Infrastructure:** ~100-200 lines (transaction boundaries in history-manager)
**Total Estimate:** ~500-800 lines

#### Chance of Success: **60%** 🟡

**Pros:**
- ✅ Eliminates race conditions by serializing operations
- ✅ Provides single audit point for all scaling activity
- ✅ Simplifies history tracking (one transaction = one undo entry)
- ✅ Makes AI integration more reliable (consistent entry point)
- ✅ Less state-manager coupling than Track 2 (uses existing subscription system)

**Cons:**
- ❌ Requires rewriting 5+ event handlers to use async queue pattern
- ❌ Risk of introducing new bugs in queue ordering logic
- ❌ Performance overhead from queue serialization (may feel sluggish on slower machines)
- ❌ Complex migration path (must support legacy paths during transition)
- ❌ **Moderate cost: History transaction boundaries** (one action = multiple state updates) - see Risk Factors below

#### Risk Factors:
1. **State Machine Complexity:** Queue needs to handle: scale pending → rescale in progress → chart updating → complete
   - *Hidden Cost:* State machine testing (all transitions, error paths, timeout handling) - **+1-2 days**
2. **Undo/Redo Integration:** History manager must understand transaction boundaries (begin/commit/rollback)
   - *Hidden Cost:* Add transaction API to history-manager, ensure atomic undo - **+2-3 days**
3. **UI Responsiveness:** Debouncing becomes harder with async queue (user expects instant input feedback)
   - *Hidden Cost:* Optimize queue latency, add priority levels, tune debounce timings - **+1 day**
4. **Testing Burden:** Need integration tests for every queue transition path
   - *Hidden Cost:* Already covered by Track 4 harness, minimal additional work - **+0-1 day**

**Total Hidden Infrastructure Cost: +4-7 days** (less than Track 2's +7-12 days)

#### Mitigation Strategy with Dual-Path Phasing:

**Pre-work (Week 0: Days 1-4):** Add transaction support to history-manager
- Implement `history.beginTransaction()` / `commit()` / `rollback()` API
- Ensure atomic undo across multiple state changes
- **Budget: 3-4 days** (simpler than Track 2's state-manager overhaul)

**Phase 1 (Week 1-2: Build Parallel System):** Orchestrator operates alongside legacy paths
```javascript
// scaling-coordinator.js (new module)
export class ScalingCoordinator {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async scale(percent, source = 'ui') {
    // Queue the operation
    return new Promise((resolve) => {
      this.queue.push({ type: 'scale', percent, source, resolve });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing) return;
    // ... transaction logic
  }
}

// event-handlers.js routes through coordinator if flag enabled
function commitScaleAll(raw, immediate = false) {
  if (window.__USE_SCALING_COORDINATOR) {
    // NEW: Route through orchestrator
    scalingCoordinator.scale(parsed, 'ui').then(result => {
      showStatus(result.message);
    });
  } else {
    // OLD: Direct call (legacy path, still active)
    applyGlobalScaleCore(parsed);
  }
}
```
- Orchestrator handles operations when flag enabled, else falls through to legacy
- Both paths write to same globals/state (no divergence)
- **Validation:** Compare operation outcomes (legacy vs. orchestrator) on 1000 test cases

**Phase 2 (Week 3: Migrate Low-Traffic Paths):** Move AI commands + programmatic calls first
```javascript
// ai-actions.js always uses orchestrator now
scale_channel_ends_by_percent({ scalePercent }) {
  // AI commands go through orchestrator (no feature flag)
  return scalingCoordinator.scale(scalePercent, 'ai');
}

// event-handlers.js blur/enter still use legacy (high-traffic, defer migration)
```
- AI commands have simpler patterns (no rapid-fire input)
- Programmatic calls easier to test (deterministic)
- High-traffic UI paths (blur, arrow keys) stay on legacy temporarily
- **Validation:** Run AI integration tests (Track 4 harness)

**Phase 3 (Week 4: Migrate High-Traffic UI Paths):** Move blur/enter/arrow key handlers
```javascript
// event-handlers.js fully migrated
function commitScaleAll(raw, immediate = false) {
  // No feature flag - always use orchestrator now
  scalingCoordinator.scale(parsed, 'ui', { priority: immediate ? 'high' : 'normal' });
}
```
- Remove feature flag, orchestrator becomes default
- Keep legacy functions as private fallback (not called)
- **Validation:** A/B test 50% of users for 48 hours, monitor input latency p95

**Phase 4 (Week 5: Remove Legacy Code):** Archive old direct-call patterns
```javascript
// scaling-utils.js marks legacy exports as deprecated
export function applyGlobalScale(rawPercent) {
  throw new Error('applyGlobalScale deprecated - use scalingCoordinator.scale()');
}

// Archive in legacy/scaling-direct-calls-2025.js for reference
```
- Remove all legacy direct-call code
- Update documentation to show orchestrator patterns
- Clean up feature flags

**Rollback Strategy (Any Phase):**
- Toggle `__USE_SCALING_COORDINATOR = false` (falls back to direct calls)
- Legacy paths remain functional until Phase 4
- Queue drains before fallback (no in-flight operations lost)

**Validation Gates (Each Phase):**
- ✅ Unit tests for queue ordering (20+ scenarios)
- ✅ E2E tests with orchestrator enabled (Track 4 harness)
- ✅ Input latency benchmarks ≤50ms p95
- ✅ No deadlocks after 1000 rapid operations
- ✅ Undo/redo works across transaction boundaries

**Revised Time Estimate:** 3.5-4.5 weeks (was 3-4 weeks)

**📋 Detailed Implementation Checklist:** See [Phase 1: Orchestrator Checklist](checklists/PHASE_1_ORCHESTRATOR.md) for step-by-step tasks, testing requirements, deliverables, and sign-off sections.

---

### Track 2: Declarative Scaling State

**Proposed Scope:**
Elevate `scaleAllPercent`, per-channel baselines, and derived values into the shared state manager so UI binds to state snapshots instead of direct DOM mutations.

#### Architecture Changes Required

```
Modified: src/js/core/state-manager.js
├── state.scaling.globalPercent: number (100 default)
├── state.scaling.baselines: { [channel]: number } (null when at 100%)
├── state.scaling.isActive: boolean (computed from globalPercent !== 100)
└── state.scaling.maxAllowed: number (computed from channel limits)

Modified: src/js/core/scaling-utils.js
├── All functions become pure (read from state, return new state)
├── Remove module-level `scaleAllPercent` and `scaleBaselineEnds` globals
└── Expose getters: getCurrentScalingState(), computeScaledValues(state, channel)

Modified: src/js/ui/event-handlers.js
├── Subscribe to state.scaling.* changes
├── Update input display when state changes (reactive binding)
└── Commit handlers dispatch state updates (not direct function calls)
```

#### Code Locations Impacted

| File | Lines | Complexity | Risk |
|------|-------|------------|------|
| `state-manager.js` | Add scaling section | **MEDIUM** - New state slice | 🟡 Schema migration |
| `scaling-utils.js` | 18-240 | **HIGH** - Refactor to pure functions | 🔴 Breaking changes |
| `event-handlers.js` | 265-453 | **HIGH** - Rewrite to use subscriptions | 🔴 Event model change |
| `history-manager.js` | 45-76 | **LOW** - Already subscription-based | 🟢 No changes needed |

**New/Modified Code Estimate:** ~300-400 lines (core changes)
**Additional Infrastructure:** ~200-300 lines (state-manager upgrades + history migration tooling)
**Total Estimate:** ~500-700 lines

#### Chance of Success: **65%** 🟡

**Pros:**
- ✅ Single source of truth for scaling state (no cache drift possible)
- ✅ Undo/redo "just works" (history manager already snapshots state)
- ✅ Enables future features (e.g., preset scaling ratios, per-printer defaults)
- ✅ Better debugging (time-travel through state snapshots)

**Cons:**
- ❌ State manager subscription overhead (may need memoization to prevent N² updates)
- ❌ Risk of breaking assumptions in code that directly reads `scaleAllPercent` global
- ❌ Complex migration (must update all code that touches scaling state simultaneously)
- ❌ Performance concerns (every scale change triggers state tree diff)
- ❌ **Hidden cost: State-manager upgrades** (memoization, computed properties, batching) - see Risk Factors below
- ❌ **Hidden cost: History migration tooling** (hydrate old snapshots, schema versioning) - see Risk Factors below

#### Risk Factors:
1. **Subscription Storm:** If 8 channels + chart + preview all subscribe, one scale change = 10+ callbacks
   - *Hidden Cost:* Requires state-manager performance upgrades (memoization layer, subscription batching) - **+1-2 days**
2. **State Hydration:** Undo/redo must correctly restore baseline cache (currently implicit, would become explicit state)
   - *Hidden Cost:* Build history migration tooling to hydrate old snapshots with computed scaling state - **+2-3 days**
3. **Race Conditions:** Async state updates could still race with Smart curve rescaling if not sequenced
4. **Schema Migration:** Need migration path for existing undo/redo history (old entries don't have scaling state)
   - *Hidden Cost:* Schema versioning system for history entries (v1 = no scaling, v2 = scaling state) - **+1-2 days**
5. **Computed Properties:** State manager currently doesn't support derived values (e.g., `maxAllowed` computed from all channel limits)
   - *Hidden Cost:* Add computed property infrastructure to state manager - **+2-3 days**
6. **Batching:** Multiple rapid state updates (8 channels × 2 fields = 16 updates per scale) need batching to prevent render thrashing
   - *Hidden Cost:* Implement transaction/batch API in state manager - **+1-2 days**

**Total Hidden Infrastructure Cost: +7-12 days** (beyond core scaling refactor)

#### Mitigation Strategy with Dual-Path Phasing:

**Pre-work (Week 0: Days 1-10):** Upgrade state-manager infrastructure FIRST
- Add memoization layer (selector pattern with weak-map cache)
- Implement batch update API (`stateManager.batch(() => { ... })`)
- Add computed property support (`state.computed.scaling.maxAllowed`)
- Build history schema versioning system
- Write migration utilities for v1→v2 history entries
- **Budget: 1.5-2 weeks** (often underestimated)

**Phase 1 (Week 1-2: Dual-Write Pattern):** Add state slice, keep legacy globals active
```javascript
// scaling-utils.js becomes dual-mode
let scaleAllPercent = 100;  // Legacy global (still active)
let scaleBaselineEnds = null;  // Legacy global (still active)

export function scaleChannelEndsByPercent(percent, options = {}) {
  // NEW: Write to state (feature-flagged)
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
- State writes are feature-flagged (`__USE_SCALING_STATE`)
- All reads still use legacy globals (no behavior change)
- History records both old snapshots AND new state (redundant but safe)
- **Validation:** Compare state tree vs. globals after every scale operation (assert equality)

**Phase 2 (Week 3: Dual-Read Pattern):** Migrate consumers one module at a time
```javascript
// event-handlers.js starts reading from state (feature-flagged)
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
- Consumers read from state if flag enabled, else fall back to globals
- Dual-write still active (both paths receive updates)
- **Validation:** Run A/B test with 10% of operations using state reads (compare outcomes)

**Phase 3 (Week 4: Remove Globals):** Deprecate legacy globals, state becomes source of truth
```javascript
// scaling-utils.js removes dual-write
export function scaleChannelEndsByPercent(percent, options = {}) {
  // Only write to state now
  stateManager.batch(() => {
    stateManager.set('scaling.globalPercent', percent);
    stateManager.set('scaling.baselines', computeBaselines());
  });

  // Legacy globals marked deprecated (throw error if accessed)
  if (!window.__ALLOW_LEGACY_SCALING_GLOBALS) {
    Object.defineProperty(window, 'scaleAllPercent', {
      get() { throw new Error('Use stateManager.get("scaling.globalPercent")'); }
    });
  }
}
```
- Remove all dual-write logic
- Globals become read-only getters that throw deprecation errors
- All consumers now read from state
- **Validation:** Run full test suite, ensure zero global accesses

**Phase 4 (Week 5: Clean History Migration):** Remove v1 history support
```javascript
// history-manager.js removes v1→v2 migration
restoreSnapshot(snapshot) {
  if (snapshot.version === 1) {
    // v1 snapshots no longer supported - warn user
    console.warn('Old undo history (pre-v3.1) cannot be restored after update');
    return false;
  }
  // Only handle v2 snapshots (with scaling state)
  this.stateManager.restoreState(snapshot.state);
}
```
- Remove migration shims for old history entries
- Clean up feature flags
- Archive dual-path code in `legacy/scaling-migration-2025.js`

**Rollback Strategy (Any Phase):**
- If issues found, toggle `__USE_SCALING_STATE = false` (instant revert to legacy path)
- Dual-write ensures globals always have correct values
- No data loss (history records both formats during migration)

**Validation Gates (Each Phase):**
- ✅ Unit tests pass (assert state == globals during dual-write)
- ✅ E2E tests pass (Track 4 harness with both flag values)
- ✅ Performance benchmarks ≤5% regression
- ✅ Manual testing on production-like dataset
- ✅ 48hr soak test with flag enabled for 50% of operations

**Revised Time Estimate:** 3.5-5 weeks (was 2-3 weeks)

**📋 Detailed Implementation Checklist:** See [Phase 2: Declarative State Checklist](checklists/PHASE_2_DECLARATIVE_STATE.md) for step-by-step tasks, state-manager upgrades, dual-path migration, and validation gates.

---

### Track 3: Smart Curve Rescaling Service

**Proposed Scope:**
Extract a service that clamps/normalizes rescaled key points, reconciles baked metadata, and provides unit-testable invariants.

#### Architecture Changes Required

```
New Module: src/js/curves/smart-rescaling-service.js
├── normalizeKeyPoints(points: KeyPoint[]): KeyPoint[]
│   ├── Clamp all x ∈ [0, 100], y ∈ [0, 100]
│   ├── Enforce monotonic increasing x
│   └── Remove duplicates within tolerance (0.01)
├── reconcileBakedMetadata(meta: Metadata, scaleFactor: number): Metadata
│   ├── Update bakedGlobal flag if scale changes End
│   ├── Clear bakedAutoWhite/Black if endpoints shift
│   └── Preserve other metadata fields
├── rescaleKeyPointsForInkLimit(channel, oldPercent, newPercent, options): Result
│   ├── Compute scale factor
│   ├── Apply to all points
│   ├── Run normalization
│   ├── Reconcile metadata
│   └── Return { points, metadata, warnings }
└── Unit test coverage: 15+ test cases for edge conditions

Modified: src/js/curves/smart-curves.js
├── rescaleSmartCurveForInkLimit: Thin wrapper around service
└── Call service, validate result, invoke setSmartKeyPoints
```

#### Code Locations Impacted

| File | Lines | Complexity | Risk |
|------|-------|------------|------|
| **New:** `smart-rescaling-service.js` | ~200 | **MEDIUM** - Pure functions | 🟢 Isolated module |
| `smart-curves.js` | rescaleSmartCurveForInkLimit (~80) | **LOW** - Becomes wrapper | 🟢 Additive change |
| `event-handlers.js` | No changes | **N/A** | 🟢 No impact |

**New Code Estimate:** ~250 lines (service + tests)

#### Chance of Success: **85%** 🟢

**Pros:**
- ✅ **Lowest risk track** - additive change, no breaking modifications
- ✅ Immediate value: Fixes normalization gaps and metadata inconsistencies
- ✅ Fully unit-testable (pure functions, no DOM/state dependencies)
- ✅ Enables future Smart curve features (e.g., auto-straighten, smoothing)
- ✅ Can ship independently of other tracks

**Cons:**
- ❌ Doesn't address baseline cache drift or history desync (those are in scaling-utils.js)
- ❌ Performance overhead from extra validation passes (minimal, ~1-2ms per rescale)

#### Risk Factors:
1. **Integration Testing:** Need to verify service doesn't break existing rescale behavior
2. **Metadata Schema:** Assumptions about baked flags may differ between legacy and service
3. **Floating Point Precision:** Clamping logic must handle edge cases (e.g., 99.99999 → 100.0)

#### Mitigation Strategy:
- **Phase 1:** Build service with comprehensive unit tests (15+ cases)
- **Phase 2:** Add integration test comparing legacy vs. service output on 100 sample curves
- **Phase 3:** Replace legacy rescale with service call (1-line change in smart-curves.js)
- **Phase 4:** Monitor for regressions over 1 release cycle, remove legacy code

**Recommendation:** ✅ **PURSUE THIS TRACK FIRST** - Low risk, high value, enables other improvements

**📋 Detailed Implementation Checklist:** Tracks 3 & 4 are covered together in [Phase 0: Foundation Checklist](checklists/PHASE_0_FOUNDATION.md) - includes unit tests, E2E scenarios, service extraction, and release workflow.

---

### Track 4: Deterministic Scaling Test Harness

**Proposed Scope:**
Build targeted Playwright and unit utilities that exercise every scaling vector with state snapshots before/after each step.

#### Architecture Changes Required

```
New Files:
├── tests/unit/scaling-utils.test.js (Jest unit tests)
│   ├── Baseline cache calculation (20+ cases)
│   ├── Guard logic edge cases (10+ cases)
│   └── Scale clamping behavior (5+ cases)
├── tests/e2e/scaling-comprehensive.spec.ts (Playwright integration)
│   ├── Scenario: Scale → Edit Channel → Scale (baseline drift)
│   ├── Scenario: Rapid scrub → Undo (history desync)
│   ├── Scenario: Scale → Revert → Scale (cache interaction)
│   ├── Scenario: AI scale command → Undo → Manual scale
│   └── Scenario: Multi-channel scale with Smart curves
├── tests/utils/scaling-test-helpers.ts
│   ├── waitForScaleComplete(page, expectedPercent)
│   ├── captureScalingState(page): StateSnapshot
│   ├── compareScalingStates(before, after): Diff
│   └── generateRandomScalingSequence(steps: number): Operation[]

Updated: tests/e2e/edit-mode-keypoint-scaling.spec.ts
├── Replace waitForTimeout with state-driven waits
└── Add explicit assertions on baseline cache state
```

#### Code Locations Impacted

| File | Lines | Complexity | Risk |
|------|-------|------------|------|
| **New:** Unit tests | ~300 | **LOW** - Test code | 🟢 Zero prod risk |
| **New:** E2E specs | ~400 | **MEDIUM** - Playwright scripting | 🟢 Zero prod risk |
| **New:** Test helpers | ~150 | **LOW** - Utilities | 🟢 Zero prod risk |
| `edit-mode-keypoint-scaling.spec.ts` | Update 4 tests | **LOW** - Replace timeouts | 🟢 Improves stability |

**New Code Estimate:** ~850 lines (all test code)

#### Chance of Success: **95%** 🟢

**Pros:**
- ✅ **Zero production risk** - all changes are test infrastructure
- ✅ Detects regressions before they ship (current gap per plans)
- ✅ Provides baseline for validating Tracks 1-3 (refactors can prove no behavior change)
- ✅ Improves CI stability (replaces flaky timeouts with deterministic waits)
- ✅ Documents expected behavior (tests are living specs)

**Cons:**
- ❌ Doesn't fix underlying bugs (only detects them)
- ❌ Maintenance burden (tests must evolve with features)
- ❌ May reveal more bugs than team can address (creates backlog)

#### Risk Factors:
1. **Playwright Stability:** E2E tests can still flake on slow CI runners
2. **Test Maintenance:** Each new scaling feature requires updating harness
3. **Coverage Gaps:** Hard to achieve 100% coverage of race conditions

#### Mitigation Strategy:
- **Phase 1:** Write unit tests first (fast, deterministic, no Playwright)
- **Phase 2:** Add 5 core E2E scenarios covering documented regression vectors
- **Phase 3:** Update existing scaling spec to use state-driven waits
- **Phase 4:** Integrate into CI gate (all scaling tests must pass to merge)
- **Phase 5:** Document regression matrix entries for scaled undo/revert scenarios once tests pass

**Recommendation:** ✅ **PURSUE THIS TRACK SECOND** - Protects other improvements, high ROI

**📋 Detailed Implementation Checklist:** Track 4 is covered together with Track 3 in [Phase 0: Foundation Checklist](checklists/PHASE_0_FOUNDATION.md) - see section on test harness, unit tests, E2E scenarios, and CI integration.

---

### Track 5: Scaling Event Bus

**Proposed Scope:**
Introduce a command bus (`scaling:request`, `scaling:applied`, `scaling:failed`) so UI, Smart curves, history, and status messaging react via subscriptions.

#### Architecture Changes Required

```
New Module: src/js/core/scaling-event-bus.js
├── ScalingEventBus: PubSub implementation
│   ├── emit(event: ScalingEvent): void
│   ├── on(eventName: string, handler: Function): Subscription
│   └── off(subscription: Subscription): void
├── Event Types:
│   ├── scaling:request { percent, source: 'ui'|'ai'|'undo' }
│   ├── scaling:validate { percent, maxAllowed, canProceed }
│   ├── scaling:applying { percent, affectedChannels }
│   ├── scaling:rescaling { channel, oldPercent, newPercent }
│   ├── scaling:applied { percent, updates }
│   └── scaling:failed { percent, reason }

Modified Modules:
├── scaling-utils.js: Emit events instead of direct function calls
├── event-handlers.js: Subscribe to events for UI updates
├── smart-curves.js: Subscribe to scaling:rescaling
├── history-manager.js: Subscribe to scaling:applied for history capture
└── chart-manager.js: Subscribe to scaling:applied for redraws
```

#### Code Locations Impacted

| File | Lines | Complexity | Risk |
|------|-------|------------|------|
| **New:** `scaling-event-bus.js` | ~150 | **MEDIUM** - PubSub logic | 🟡 New abstraction |
| `scaling-utils.js` | 55-241 | **HIGH** - Add emit calls | 🟡 Behavior change |
| `event-handlers.js` | 265-453 | **HIGH** - Subscribe to events | 🟡 Event model change |
| `smart-curves.js` | rescaleSmartCurveForInkLimit | **MEDIUM** - Subscribe to events | 🟡 Coupling change |
| `history-manager.js` | 45-76 | **LOW** - Subscribe to events | 🟢 Similar to current |

**New/Modified Code Estimate:** ~400 lines

#### Chance of Success: **55%** 🟡

**Pros:**
- ✅ Decouples modules (UI doesn't directly call scaling-utils)
- ✅ Enables future features (e.g., analytics, audit logging, replay)
- ✅ Clarifies sequencing (event order is explicit)
- ✅ Makes AI integration cleaner (emit scaling:request, wait for scaling:applied)

**Cons:**
- ❌ Adds latency (events are async, may introduce frame delay)
- ❌ Debugging harder (call stack is interrupted by event bus)
- ❌ Risk of event loops (subscriber emits event that triggers itself)
- ❌ Requires auditing all direct calls (easy to miss one and create dual paths)

#### Risk Factors:
1. **Performance:** Every scaling operation goes through bus dispatch (adds ~1-2ms overhead)
2. **Memory Leaks:** Subscribers must unsubscribe properly (common PubSub pitfall)
3. **Event Ordering:** If `scaling:applying` and `scaling:rescaling` fire out of order, chart breaks
4. **Error Handling:** If one subscriber throws, does it block others? Need robust try/catch

#### Mitigation Strategy:
- **Pre-work:** Survey all direct scaling-utils.js callers (grep for `scaleChannelEndsByPercent`)
- **Phase 1:** Build event bus with comprehensive tests (error handling, ordering, unsubscribe)
- **Phase 2:** Add dual-mode support (emit events AND call legacy functions)
- **Phase 3:** Migrate subscribers one module at a time
- **Phase 4:** Remove legacy function calls after all modules subscribe

**Recommendation:** ⚠️ **DEFER UNTIL TRACKS 3+4 COMPLETE** - Medium risk, unclear value vs. complexity

---

## Track 1 vs Track 2: Infrastructure Cost Comparison

Both major refactor tracks require upfront infrastructure work that initial estimates glossed over:

| Infrastructure Need | Track 1 (Orchestrator) | Track 2 (Declarative State) |
|---------------------|------------------------|------------------------------|
| **State Manager Upgrades** | ✅ None (uses existing subscriptions) | ❌ Memoization, batching, computed properties (+5-7 days) |
| **History Manager Changes** | ⚠️ Transaction API (begin/commit/rollback) (+2-3 days) | ⚠️ Schema versioning, migration tooling (+3-5 days) |
| **Queue/Orchestration** | ❌ State machine, priority queue (+1-2 days) | ✅ None (state tree is the queue) |
| **Performance Tuning** | ⚠️ Latency optimization, debounce tuning (+1 day) | ⚠️ Subscription storm prevention (+1-2 days) |
| **Total Hidden Cost** | **+4-7 days** | **+7-12 days** |
| **Revised Time Estimate** | **3.5-4.5 weeks** | **3.5-5 weeks** |

**Key Insight:** Track 1 has **lower infrastructure overhead** because it doesn't require rebuilding the state manager's internals. Track 2's "declarative state" sounds simpler conceptually, but requires significant plumbing work (memoization, batching, computed properties) that the current state manager lacks.

**Recommendation Update:** If state-manager upgrades are deferred, **Track 1 becomes more attractive** despite higher orchestrator complexity. If state-manager improvements are already planned (benefits other features), Track 2 piggybacks on that work.

---

## Comparative Risk Matrix

| Track | New Code | Modified Code | Infrastructure Cost | Prod Risk | Success Chance | **Revised Time** | Value |
|-------|----------|---------------|---------------------|-----------|----------------|------------------|-------|
| **1. Orchestrator** | ~500 | ~300 | **+4-7 days** | 🔴 High | 60% | **3.5-4.5 weeks** | High |
| **2. Declarative State** | ~300 | ~400 | **+7-12 days** | 🔴 High | 65% | **3.5-5 weeks** | High |
| **3. Rescaling Service** | ~250 | ~50 | None | 🟢 Low | 85% | **1 week** | Medium |
| **4. Test Harness** | ~850 | ~50 | None | 🟢 None | 95% | **1-2 weeks** | High |
| **5. Event Bus** | ~400 | ~350 | Minimal | 🟡 Medium | 55% | **2-3 weeks** | Medium |

**Note:** Original estimates for Tracks 1 & 2 underestimated infrastructure work by ~40-60%. Revised times reflect pre-work required to upgrade state-manager and history-manager foundations.

---

## Recommended Implementation Sequence

### Phase 1: Foundation (Weeks 1-3) ✅ LOW RISK
**Goal:** Establish safety net and fix isolated bugs

**📋 [Complete Phase 0 Checklist](checklists/PHASE_0_FOUNDATION.md)** ← Start here for step-by-step implementation

1. **Track 4: Test Harness** (Week 1-2)
   - Write 20+ unit tests for scaling-utils.js baseline cache logic
   - Add 5 E2E scenarios covering regression vectors
   - Update existing spec to use deterministic waits
   - **Deliverable:** Comprehensive test suite passes on current code

2. **Track 3: Rescaling Service** (Week 2-3)
   - Build smart-rescaling-service.js with normalization + metadata reconciliation
   - Write 15+ unit tests for service invariants
   - Replace rescaleSmartCurveForInkLimit implementation
   - **Deliverable:** Smart curve rescaling is deterministic and well-tested

**Success Criteria:**
- CI gate blocks merges if scaling tests fail
- Known normalization bugs are fixed
- No new regressions introduced

**Release Checklist (Phase 1 Completion):**
- [ ] Update `CHANGELOG.md` under "Unreleased" section with scaling improvements
- [ ] Update `src/js/ui/help-content-data.js` VERSION_HISTORY with user-facing summary
- [ ] Run `npm run build:agent` to regenerate `dist/index.html` bundle
- [ ] Add regression matrix entry documenting scaled undo/revert test coverage
- [ ] Verify all Playwright scaling specs pass deterministically (3+ runs)

---

### Phase 2: Choose Refactor Path (Weeks 4-8) ⚠️ MEDIUM-HIGH RISK
**Goal:** Address baseline cache drift and history desync

**📋 Choose Your Implementation Path:**
- **[Phase 1: Orchestrator Checklist](checklists/PHASE_1_ORCHESTRATOR.md)** (Track 1) - If scaling is isolated priority
- **[Phase 2: Declarative State Checklist](checklists/PHASE_2_DECLARATIVE_STATE.md)** (Track 2) - If state-manager improvements benefit other features

**Decision Matrix:**

| Factor | Track 1 (Orchestrator) | Track 2 (Declarative State) |
|--------|------------------------|------------------------------|
| **Time to Ship** | 3.5-4.5 weeks (less pre-work) | 3.5-5 weeks (more pre-work) |
| **Conceptual Complexity** | Higher (state machine, queue) | Lower (just state tree) |
| **Infrastructure Debt** | **+4-7 days** (history transactions) | **+7-12 days** (state-manager overhaul) |
| **Future Benefits** | Limited to scaling | Improves all state management |
| **Risk if Abandoned** | Wasted orchestrator code | Wasted state-manager upgrades |
| **Best If...** | No plans for state-manager upgrades | State-manager improvements benefit multiple features |

**Recommendation Update (Based on Infrastructure Costs):**

**Option A: Track 1 (Orchestrator) - NOW RECOMMENDED if scaling is the only priority**
- ✅ Lower infrastructure overhead (+4-7 days vs. +7-12 days)
- ✅ Self-contained (doesn't require state-manager refactor)
- ✅ Better control over async operations (queue serialization)
- ✅ Cleaner audit trail (one entry point for all scaling)
- ❌ Higher conceptual complexity (state machine logic)
- ⚠️ Budget 1 extra week for infrastructure (history transactions)

**Option B: Track 2 (Declarative State) - NOW RECOMMENDED if state-manager improvements are planned**
- ✅ Lower conceptual complexity (move globals to state)
- ✅ Improves entire app (benefits future features: presets, per-printer defaults, better debugging)
- ✅ Easier to reason about for future maintainers
- ❌ Higher infrastructure overhead (+7-12 days)
- ❌ Requires major state-manager refactor (memoization, batching, computed properties)
- ⚠️ Budget 1.5-2 extra weeks for infrastructure

**Implementation (Either Track):**
1. **Week 0 (Pre-work):** Build required infrastructure (see comparison table above)
2. **Week 1:** Build new system in parallel (feature flag)
3. **Week 2:** Migrate AI commands + arrow keys (low-traffic paths)
4. **Week 3:** Migrate blur/enter handlers (high-traffic paths)
5. **Week 4:** A/B test with 50% of users, monitor error rates

**Success Criteria:**
- Baseline cache drift test cases pass
- Undo/redo after rapid scrubbing is deterministic
- Performance regression <5% (measure 95th percentile input latency)

**Release Checklist (Phase 2 Completion):**
- [ ] Update `CHANGELOG.md` with baseline cache and history fixes
- [ ] Update `VERSION_HISTORY` in help system with refactor summary
- [ ] Run `npm run build:agent` to bundle Phase 2 changes
- [ ] Document new scaling architecture in `CLAUDE_ARCHITECTURE.md`
- [ ] Add regression tests for baseline cache edge cases to matrix
- [ ] Performance benchmark results (input latency p50/p95/p99)

---

### Phase 3: Polish (Week 8+) 🟢 LOW RISK
**Goal:** Remove legacy code and consider event bus

1. **Week 8:** Remove feature flags and legacy code paths
2. **Week 9:** Write scaling architecture docs (update CLAUDE.md, AGENTS.md)
3. **Week 10:** Evaluate Track 5 (Event Bus) if logging/analytics is needed

**Track 5 Decision Criteria:**
- ✅ Pursue if: Need audit logging, want to add undo/redo for AI commands, plan to build scaling presets
- ❌ Defer if: Current architecture meets needs, want to minimize abstraction layers

**Release Checklist (Phase 3 Completion):**
- [ ] Final `CHANGELOG.md` rotation (move "Unreleased" to versioned release section)
- [ ] Bump `APP_VERSION` in `src/js/core/version.js`
- [ ] Update `VERSION_HISTORY` in help system with complete release notes
- [ ] Run `npm run build:agent` for final release bundle
- [ ] Tag regression matrix with release version for scaling test coverage
- [ ] Archive old scaling code in `legacy/` directory with migration notes

---

## Specific Risk Factors by Track

### Track 1: Orchestrator

**🔴 Critical Risks:**
1. **Queue Deadlock:** If chart update awaits scaling, but scaling awaits chart update, app hangs
   - *Mitigation:* Use priority queue with strict ordering (scale → rescale → chart)
2. **Performance Regression:** Serializing operations may make rapid scaling feel sluggish
   - *Mitigation:* Benchmark input latency before/after, ensure <50ms p95

**🟡 Medium Risks:**
3. **Migration Complexity:** Must support legacy paths during transition (dual code paths for 2+ releases)
4. **History Integration:** Transactions need to align with undo/redo granularity

---

### Track 2: Declarative State

**🔴 Critical Risks:**
1. **Subscription Storm:** If naive implementation, one scale change could trigger 10+ callbacks
   - *Mitigation:* Add memoization to state manager, batch updates
2. **Undo/Redo Schema Migration:** Old history entries don't have scaling state
   - *Mitigation:* Hydrate old snapshots with computed scaling state on load

**🟡 Medium Risks:**
3. **Global Variable Dependencies:** Code may directly read `scaleAllPercent` in unexpected places
4. **Race Conditions:** Async state updates could still race with Smart curve rescaling

---

### Track 3: Rescaling Service

**🟢 Low Risks:**
1. **Behavior Drift:** Service output must match legacy rescale output exactly
   - *Mitigation:* Integration test comparing 100 sample curves
2. **Metadata Assumptions:** Baked flags may have undocumented semantics
   - *Mitigation:* Audit all code that reads/writes metadata

---

### Track 4: Test Harness

**🟢 Minimal Risks:**
1. **Flaky Tests:** Playwright can still flake on slow CI runners
   - *Mitigation:* Use state-driven waits, add retry logic, run in fast headless mode
2. **Maintenance Burden:** Tests must evolve with features
   - *Mitigation:* Document test patterns, make helpers reusable

---

### Track 5: Event Bus

**🔴 Critical Risks:**
1. **Event Loops:** Subscriber emits event that triggers itself (infinite loop)
   - *Mitigation:* Track re-entrancy depth, throw error if >3 levels deep
2. **Error Propagation:** If one subscriber throws, does it poison all others?
   - *Mitigation:* Wrap each subscriber in try/catch, log errors, continue processing

**🟡 Medium Risks:**
3. **Debugging Difficulty:** Call stack is interrupted by event bus (harder to trace)
4. **Memory Leaks:** Subscribers must unsubscribe (easy to forget in React-style code)

---

## Documentation & Regression Matrix Requirements

### Regression Matrix Entries

Once scaling tests pass, document the following test coverage in a regression matrix (e.g., `docs/testing/REGRESSION_MATRIX.md` or similar):

**Baseline Cache Scenarios:**
- ✅ Scale to 80% → Edit channel to 90% → Scale to 100% (baseline restored correctly)
- ✅ Scale to 120% → Manual channel edit → Scale to 80% (no double-scaling)
- ✅ Scale to 65535 limit → Edit channel down → Scale back up (guard logic works)

**History/Undo/Redo Scenarios:**
- ✅ Scale to 80% → Undo → State returns to 100% with correct baselines
- ✅ Rapid scrub 100→50→100 → Undo twice → History stack is coherent
- ✅ Scale → Edit Mode → Revert → Scale again (measurement state preserved)

**Smart Curve Interaction Scenarios:**
- ✅ Edit Mode active → Scale to 80% → Key points preserve absolute chart positions
- ✅ Global correction loaded → Scale → Baked metadata remains consistent
- ✅ Recompute after scale → No double-scaling of Smart curve endpoints

**AI Integration Scenarios:**
- ✅ `scale_channel_ends_by_percent` via Lab Tech → History recorded correctly
- ✅ AI command during active scale → Commands serialize correctly
- ✅ Undo after AI scale → Baselines restored to pre-AI state

### Documentation Updates per Phase

**Phase 1 (Test Harness + Rescaling Service):**

Location: `CLAUDE.md` (Project Instructions)
- Add section: "## Scaling System Architecture"
  - Baseline cache lifecycle (when created, when cleared)
  - Real-time input vs. committed scale semantics
  - Smart curve rescaling invariants (normalization, metadata reconciliation)
- Update "Critical Rules for Developers" with scaling-specific patterns

Location: `CLAUDE_ARCHITECTURE.md`
- Add data flow diagram: User Input → Event Handler → Scaling Utils → Smart Curves → History
- Document baseline cache guards (lines 114-126 in scaling-utils.js)
- Explain dual input paths (real-time debounce vs. blur/enter commit)

Location: `CHANGELOG.md`
- Under "Unreleased" → "Fixed":
  - Smart curve rescaling now enforces monotonic key points and normalizes outputs
  - Baseline cache guards prevent double-scaling at ink limit boundaries
- Under "Unreleased" → "Tests":
  - Added comprehensive Playwright test harness for scaling operations
  - Replaced fixed timeouts with deterministic state-driven waits

Location: `src/js/ui/help-content-data.js` (VERSION_HISTORY)
- Add entry: "Improved global scaling reliability with enhanced Smart curve rescaling and comprehensive test coverage"

**Phase 2 (Declarative State or Orchestrator):**

Location: `CLAUDE.md`
- Update "Scaling System Architecture" section with new state management approach
- Document migration from module-level globals to centralized state
- Add debugging tips for state snapshots and time-travel

Location: `CLAUDE_ARCHITECTURE.md`
- Replace data flow diagram with new architecture (state-driven or queue-based)
- Document state manager subscription patterns for scaling
- Add performance notes (memoization, batching strategies)

Location: `CHANGELOG.md`
- Under "Unreleased" → "Changed":
  - Refactored scaling system to use [declarative state / transaction queue]
  - Undo/redo now handles scaling operations more reliably
- Under "Unreleased" → "Performance":
  - Optimized scaling input latency (document p95 before/after)

Location: `VERSION_HISTORY`
- Add entry: "Major scaling system refactor for improved reliability and undo/redo support"

**Phase 3 (Final Release):**

Location: `CHANGELOG.md`
- Rotate "Unreleased" section to versioned release (e.g., "## [v3.1.0] — 2025-XX-XX")
- Ensure all scaling improvements are grouped under appropriate categories

Location: `src/js/core/version.js`
- Bump `APP_VERSION` to next minor or patch version

Location: `VERSION_HISTORY`
- Finalize release notes with user-facing summary of scaling improvements

Location: `AGENTS.md` (if applicable)
- Update Lab Tech function documentation for `scale_channel_ends_by_percent`
- Add notes on transaction semantics if using orchestrator

**Build Workflow:**

After each phase, run:
```bash
npm run build:agent
```

This regenerates `dist/index.html` and copies to root, ensuring:
- Help system shows updated VERSION_HISTORY
- Bundle includes all scaling improvements
- No parse5 warnings from malformed HTML

---

## Conclusion & Final Recommendations

### Immediate Actions (Week 1) ✅
1. **Fix failing Playwright specs** (per SCALING_IMPROVEMENT_PLANS.md:30)
   - Update `edit-mode-keypoint-scaling.spec.ts` to use state-driven waits
   - Document baked-state expectations that are drifting

2. **Start Track 4 (Test Harness)**
   - Write 10 unit tests for baseline cache logic (lines 89-134 in scaling-utils.js)
   - Add E2E scenario for "scale → edit channel → scale" (regression vector #1)

### Short-Term Goals (Weeks 2-3) ✅
3. **Complete Track 3 (Rescaling Service)**
   - Extract smart-rescaling-service.js
   - Fix normalization gaps and metadata inconsistencies
   - Ship as standalone improvement

4. **Document Current Architecture**
   - Update CLAUDE_ARCHITECTURE.md with scaling data flow diagrams
   - Add inline comments explaining baseline cache guards (scaling-utils.js:114-126)

### Medium-Term Goals (Weeks 4-7) ⚠️
5. **Choose and Execute Refactor Path**
   - **Recommended:** Track 2 (Declarative State) - lower complexity
   - **Alternative:** Track 1 (Orchestrator) - if strict ordering is critical
   - Use feature flags and staged rollout

6. **Monitor Production Metrics**
   - Track input latency (p50, p95, p99)
   - Monitor error rates for scaling operations
   - A/B test new architecture vs. legacy

### Long-Term Considerations (Week 8+) 🔵
7. **Evaluate Track 5 (Event Bus)**
   - Only pursue if clear use case (audit logging, analytics, undo for AI commands)
   - Defer if current architecture meets needs

8. **Continuous Improvement**
   - Maintain test harness as features evolve
   - Document scaling semantics in user-facing guide
   - Consider performance profiling on low-end hardware

---

## Summary Risk Table (UPDATED with Infrastructure Costs)

| Action | Risk | Impact | **Revised Effort** | **Infra Cost** | Priority |
|--------|------|--------|-------------------|----------------|----------|
| Track 4: Test Harness | 🟢 Low | High | 1-2 weeks | None | **P0 (Do First)** |
| Track 3: Rescaling Service | 🟢 Low | Medium | 1 week | None | **P0 (Do First)** |
| Track 1: Orchestrator | 🔴 High | High | **3.5-4.5 weeks** | **+4-7 days** | **P1 (If scaling-only)** |
| Track 2: Declarative State | 🟡 Medium | High | **3.5-5 weeks** | **+7-12 days** | **P1 (If state-mgr planned)** |
| Track 5: Event Bus | 🟡 Medium | Medium | 2-3 weeks | Minimal | **P3 (Defer)** |

**Note:** Original audit underestimated Track 1 & 2 by ~40-60% due to infrastructure debt (state-manager upgrades, history migration tooling, transaction APIs). Revised table reflects true implementation costs.

---

**Final Verdict (UPDATED):**

1. **Start with Tracks 3 + 4** (low risk, high value, ~2-3 weeks total) - **unchanged, still recommended**

2. **Phase 2 refactor choice depends on broader context:**
   - **Track 1 (Orchestrator)** now more attractive if scaling is isolated priority (4-7 days less infrastructure work)
   - **Track 2 (Declarative State)** still best if state-manager improvements benefit other features (presets, debugging, future work)
   - Both options take **~4-5 weeks total** (was estimated 2-4 weeks) once infrastructure costs are included

3. **Defer Track 5** unless clear use case emerges - **unchanged**

**Key Takeaway:** Don't underestimate infrastructure costs. Both major refactors require **1-2 weeks of foundational work** before touching scaling logic. Budget accordingly and choose Track 1 vs Track 2 based on whether state-manager upgrades pay dividends beyond just scaling.

**Success Metrics:**
- ✅ Zero baseline cache drift bugs in production
- ✅ Undo/redo works correctly after rapid scaling
- ✅ All scaling Playwright tests pass deterministically
- ✅ Input latency <50ms p95 after refactor
- ✅ Smart curve rescaling is monotonic and normalized

**Release Requirements (All Phases):**
- ✅ `CHANGELOG.md` updated per phase with user-facing improvements
- ✅ `VERSION_HISTORY` in help system reflects all scaling changes
- ✅ `npm run build:agent` run after each phase to regenerate bundle
- ✅ Regression matrix documents scaled undo/revert test coverage
- ✅ Architecture docs updated (CLAUDE.md, CLAUDE_ARCHITECTURE.md)
- ✅ APP_VERSION bumped and changelog rotated for final release

---

## Audit Revision History

**v1.0 (2025-10-04):** Initial audit with Track 3+4 recommendation, Track 2 over Track 1 preference

**v1.1 (2025-10-04):** Added release workflow, regression matrix, documentation requirements

**v1.2 (2025-10-04):** Updated with infrastructure cost analysis based on user feedback:
- Identified state-manager upgrade costs for Track 2 (+7-12 days): memoization, batching, computed properties, history migration
- Identified history-manager transaction costs for Track 1 (+4-7 days): begin/commit/rollback API
- Revised time estimates: Track 1 now 3.5-4.5 weeks (was 3-4), Track 2 now 3.5-5 weeks (was 2-3)
- Updated recommendation: Track 1 more attractive if scaling is isolated priority; Track 2 better if state-manager improvements benefit multiple features
- Acknowledged weak seams: baseline cache drift (lines 89-134), real-time input bypass (lines 418-450), baked-smart inconsistencies

**v1.3 (2025-10-04):** Added detailed dual-path phasing strategies for safe rollout:
- **Track 1 (Orchestrator):** 4-phase migration with feature flags (`__USE_SCALING_COORDINATOR`)
  - Phase 1: Parallel system (orchestrator + legacy coexist)
  - Phase 2: Migrate low-traffic paths (AI commands first)
  - Phase 3: Migrate high-traffic UI (blur/enter handlers)
  - Phase 4: Remove legacy code
- **Track 2 (Declarative State):** 4-phase migration with dual-write/dual-read patterns (`__USE_SCALING_STATE`)
  - Phase 1: Dual-write (write to both state + globals)
  - Phase 2: Dual-read (consumers read from state, fallback to globals)
  - Phase 3: Remove globals (state becomes source of truth)
  - Phase 4: Clean history migration (remove v1 snapshot support)
- Both tracks include rollback strategies, validation gates, and A/B testing plans

**v1.4 (2025-10-04):** Added comprehensive implementation checklists:
- **[PHASE_0_FOUNDATION.md](checklists/PHASE_0_FOUNDATION.md)** (Tracks 3+4, 2-3 weeks)
  - 20+ unit tests, 5 E2E scenarios, rescaling service extraction
  - Success criteria, deliverables, release checklist, rollback plan
- **[PHASE_1_ORCHESTRATOR.md](checklists/PHASE_1_ORCHESTRATOR.md)** (Track 1, 3.5-4.5 weeks)
  - Pre-work: History transaction API (4 days)
  - 4-phase dual-path migration with validation gates
  - Complete testing requirements, performance benchmarks
- **[PHASE_2_DECLARATIVE_STATE.md](checklists/PHASE_2_DECLARATIVE_STATE.md)** (Track 2, 3.5-5 weeks)
  - Pre-work: State-manager upgrades (10 days) - memoization, batching, computed properties
  - 4-phase dual-write/dual-read migration with schema versioning
  - Complete coverage of infrastructure work often underestimated
- All checklists include: tasks, testing, deliverables, success criteria, release workflow, rollback plans, sign-off sections
- Linked checklists throughout audit at track descriptions and implementation sequence

**User Feedback Incorporated:**
- ✅ Agreement: Tracks 3+4 first (low-risk, fast payoff)
- ✅ Callouts confirmed: Baseline cache drift, input bypass, metadata inconsistencies
- ✅ Caveat addressed: Infrastructure costs for Track 1 & 2 now explicitly budgeted (1-2 weeks pre-work)
- ✅ Release workflow: CHANGELOG.md, VERSION_HISTORY, npm run build:agent, regression matrix entries
- ✅ **Dual-path phasing:** Outlined migration strategies with feature flags, rollback plans, and validation gates
- ✅ **Implementation checklists:** Created detailed phase-by-phase checklists with checkboxes for tracking progress

---

*Report generated by Claude (Lab Tech) on 2025-10-04*
*Audit based on source code inspection and architectural analysis*
*Updated 2025-10-04 (v1.2) to reflect infrastructure costs and release requirements*
