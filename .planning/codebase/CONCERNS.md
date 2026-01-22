# Codebase Concerns

**Analysis Date:** 2026-01-22

## Tech Debt

### Incomplete AI Integration

**Issue:** Multiple placeholder implementations in AI chat interface blocking full feature utilization
- Files: `src/js/ai/chat-interface.js` (lines 425, 463, 560, 578, 617, 631, 646, 745)
- `src/js/ai/ai-config.js` (line 161)
- `src/js/ai/ai-actions.js` (lines 861, 1141)
- Impact: Chat assistant functionality is stubbed out; API key storage has no secure implementation; contrast intent application not functional; function definitions incomplete
- Fix approach: Implement persistent secure storage for API keys (IndexedDB or encrypted localStorage), complete QuadGenActions method stubs, integrate contrast intent curve loading and application into Smart curve pipeline

### Incomplete Intent Paste Parser

**Issue:** Intent paste functionality is placeholder-only
- Files: `src/js/parsers/file-parsers.js` (line 802)
- Impact: Users cannot paste natural language curve descriptions or AI-generated curve specs
- Fix approach: Connect to full parseIntentPaste implementation that tokenizes curve keywords and maps to control points; integrate with Smart curve seeding

### Missing User-Visible Error Messages

**Issue:** Linearization file loading silently fails without feedback to user
- Files: `src/js/ui/event-handlers.js` (line 5228)
- Impact: Users attempting to load invalid LAB/CGATS files receive no explanation for failure; error is only in console
- Fix approach: Dispatch status-service error messages (`showError()`) when linearization parsing fails, including validation details (file format, expected columns, parse error location)

## Known Issues

### Scaling System Complexity

**Issue:** Global scaling implementation has debug logging scattered throughout indicating active problem-solving
- Files: `src/js/core/scaling-utils.js` (lines 658-930 have 50+ console.log calls prefixed with 🔍)
- `src/js/ui/event-handlers.js` (lines 2581-2778 scale input handler with 40+ debug logs)
- Symptoms: Excessive console noise; indicates recent refactoring or active bug investigation; may indicate brittle behavior with edge cases
- Workaround: Enable `DEBUG_LOGS` and observe console output for scaling operations; watch for scaling not applying or applying incorrectly at boundary values
- Safe modification: When touching scale input logic, preserve all `console.log` statements for now; add unit test coverage for boundary cases (0%, 1%, 99%, 100%, invalid input)

## Security Considerations

### API Key Storage Unimplemented

**Risk:** AI API keys are mentioned throughout chat interface but storage mechanism is not implemented
- Files: `src/js/ai/chat-interface.js` (lines 617, 631)
- Current mitigation: None - API keys are not actually persisted, so they're cleared on page reload
- Recommendations:
  - Implement encrypted localStorage or IndexedDB storage with encryption layer
  - Add API key rotation/expiration support
  - Never log API keys to console (currently not violated, but add guards in DEBUG_LOGS)
  - Consider service worker for additional security isolation

### XSS Prevention via HTML Escaping

**Risk:** Status messages use HTML escaping to prevent injection
- Files: Fixed in version 4.3.5 per CHANGELOG.md
- Current mitigation: HTML escaping now applied in status messages
- Recommendations: Audit all user-facing text that could be HTML-rendered; maintain escaping discipline in future status message updates

## Performance Bottlenecks

### Processing Pipeline Scale

**Problem:** Core pipeline file is very large and complex
- Files: `src/js/core/processing-pipeline.js` (6,737 lines)
- Cause: Single file handles multiple data transformation stages (PCHIP interpolation, LAB correction, composite density solving, auto-limit detection, 256-point curve generation)
- Improvement path:
  1. Extract LAB correction logic into separate module (`src/js/core/lab-correction-pipeline.js`)
  2. Extract composite density solving into `src/js/core/composite-solver.js`
  3. Extract auto-limit detection into `src/js/core/auto-limit-detector.js`
  4. Keep main pipeline as orchestrator/coordinator between modules

### Event Handler Monolith

**Problem:** Event handler registry is largest single file in UI layer
- Files: `src/js/ui/event-handlers.js` (6,757 lines)
- Cause: Single file binds handlers for 30+ UI elements across chart, edit mode, file loading, scaling, and revert workflows
- Improvement path:
  1. Extract scaling input handlers → `src/js/ui/handlers/scale-input-handler.js`
  2. Extract revert button handlers → `src/js/ui/handlers/revert-handler.js`
  3. Extract file input handlers → `src/js/ui/handlers/file-input-handler.js`
  4. Keep registry as delegator with clear entry points

### Chart Manager Complexity

**Problem:** Chart rendering manager handles too many concerns
- Files: `src/js/ui/chart-manager.js` (3,842 lines)
- Cause: Combines canvas drawing, overlay rendering, zoom state, correction target display, LAB spot markers, and edit-mode overlays
- Improvement path:
  1. Extract canvas rendering into `src/js/ui/renderers/canvas-renderer.js`
  2. Extract overlay rendering into `src/js/ui/renderers/overlay-renderer.js`
  3. Extract zoom logic into `src/js/ui/zoom-controller.js`
  4. Keep manager as coordinator

## Fragile Areas

### Revert Control State Machine

**Files:** `src/js/ui/revert-controls.js`, `src/js/ui/event-handlers.js` (revert handler section)
- Why fragile: Revert button enabled/disabled state depends on complex guard logic checking measurement status, edit state, global scale application, and per-channel edits. Per CLAUDE.md guardrails, the revert operation must clear `linearizationData = null` completely or LAB data remains active and causes scaling artifacts.
- Safe modification: When touching revert logic, trace full data lifecycle via DEBUG_LOGS (`[DEBUG REVERT]` logs). Verify `linearizationData` is fully cleared (not just `linearizationData.edited = false`). Test revert after loading LAB, scaling, editing Smart curves, then reverting — chart must return to baseline not scaled state.
- Test coverage: `tests/e2e/edit-mode-kclk-plateau.spec.ts`, `tests/ui/edit-mode-measurement-seed.test.js` cover partial revert workflows; add test for "load LAB → scale → revert → verify curves are baseline not scaled"

### Bell Curve Scaling Interactions

**Files:** `src/js/core/bell-width-controller.js`, `src/js/core/bell-shift-controller.js`, `src/js/curves/smart-curves.js`
- Why fragile: Bell apex shift and width scaling reweight samples around peak using Gaussian falloff. Global scaling can interact unexpectedly if applied after bell edits — the endpoint changes alter bell scale factors. Smart-point ordinals must remain consistent across operations.
- Safe modification: Bell width/apex edits update `bellWidthScale` state separately from curve scaling. When modifying either, verify Smart-point ordinals don't shift. Test sequence: load curve → detect bell → shift apex → scale globally → verify points still ordered correctly.
- Test coverage: `tests/e2e/help-tabs-uppercase.spec.ts` covers bell controls; add test for "shift apex → scale 120% → verify no point reordering"

### Smart Curve Simplification After Edits

**Files:** `src/js/curves/smart-curves.js`, `src/js/data/curve-simplification.js`
- Why fragile: Smart curve seeding from LAB data can use direct points (≤25 points) or simplified subset. After user edits, if source data changes, simplification parameters may differ, causing point count to shift.
- Safe modification: When re-seeding after edits, preserve ordinal mapping by comparing old/new point counts. If simplification output count changes, use linear interpolation to map old key points to new positions before allowing further edits.
- Test coverage: Manual test "load LAB (100 points) → simplify to 8 key points → edit point 3 → reload similar LAB (110 points) → verify point 3 still at expected position"

### Auto-Limit Endpoint Rolloff

**Files:** `src/js/core/processing-pipeline.js` (auto-limit section), `src/js/core/auto-limit-config.js`
- Why fragile: Auto-limit detection looks for flat ceilings/floors near endpoints (last 20% white, first 10% black). Window size and threshold are hardcoded. If curves naturally flatten near endpoints, auto-limit may incorrectly trigger or fail to detect legit overflows.
- Safe modification: When adjusting thresholds, test with real printer curves (P600 K channel, P700 multiink). Verify that smooth endpoint rolloffs aren't misidentified as "flat". Consider making threshold configurable via debug flag.
- Test coverage: Add tests with curves that legitimately have shallow slopes near endpoints but aren't flat

## Scaling Limits

### Monolithic Single-Page Application

**Current capacity:** All state (curves, history, linearization data) lives in `window` scope; no worker offloading
- Limit: Large .quad files (10+ channels) + complex LAB correction + history snapshots can cause UI thread blocking. Undo/redo snapshots accumulate memory.
- Scaling path:
  1. Move curve processing to Web Worker (interpolation, LAB redistribution, make256)
  2. Implement IndexedDB history snapshots instead of in-memory array
  3. Lazy-load Help content instead of pre-parsing all markdown on startup

### Chart Canvas Rendering

**Current capacity:** Single canvas element redrawn on every curve edit
- Limit: With deep zoom (zoomed to bottom 2%) and 100+ visible points, rendering can lag on slower devices
- Scaling path:
  1. Implement viewport-based rendering (only draw visible region, cull points outside viewport)
  2. Use WebGL for point rendering instead of canvas 2D context
  3. Batch chart updates with RAF throttling (already partially implemented)

## Dependencies at Risk

### No Formal Dependency on PCHIP Implementation

**Risk:** PCHIP interpolation is critical to curve fidelity but lives in single file with no version tracking
- Files: `src/js/math/interpolation.js`
- Impact: If PCHIP implementation has bugs (overshooting, monotonicity violations), all curves using Smart curves are affected
- Migration plan:
  1. Add comprehensive unit tests for PCHIP edge cases (flat regions, sharp peaks, endpoint behavior)
  2. Consider vendoring an external PCHIP library with active maintenance (e.g., Numeric.js)
  3. Add regression test comparing PCHIP output to reference implementations for known curves

### Reliance on Internal LAB Data Format

**Risk:** LAB measurement data format (`src/js/data/lab-parser.js`) is not formally specified
- Files: Parser assumes CGATS/LAB .txt format but error messages are generic
- Impact: Invalid measurement files fail silently or with unclear feedback
- Migration plan:
  1. Formalize LAB data format specification in `docs/File_Specs/LAB_FORMAT_SPEC.md` with examples
  2. Add detailed validation error messages (e.g., "Expected column 'L*' at position 1, found 'luminance'")
  3. Add format auto-detection (try CGATS, fall back to LAB .txt, try legacy formats)

## Missing Critical Features

### No Measurement Validation Report

**Problem:** Users can load invalid LAB data that silently produces nonsense curves
- Blocks: Can't verify measurement consistency; can't catch typos in channel names; no feedback on measurement coverage (sparse vs dense)
- Implementation: Add pre-import validation report showing point count, min/max L* range, channel coverage, and warnings for unusual patterns (all K channel same L*, isolated measurement points)

### No Multi-Channel Revert History

**Problem:** Revert controls are per-channel OR global; no "revert this one edit I just made" for multi-channel operations
- Blocks: If you load LAB globally and it impacts all channels badly, you must revert all channels together or none
- Implementation: Extend undo/redo to track multi-channel snapshots as atomic units with per-channel revert metadata

### No Keyboard Shortcuts Documentation

**Problem:** Help system doesn't list keyboard shortcuts for common operations
- Blocks: Power users can't discover keyboard acceleration for scaling, point editing, undo/redo
- Implementation: Add Keyboard Shortcuts section to Help menu listing Ctrl+Z (undo), Ctrl+Y (redo), Shift+Enter (apply scale), Arrow keys (nudge values)

## Test Coverage Gaps

### Bell Curve Interactions with Global Scaling

**What's not tested:** Sequence of load curve → detect bell → shift apex → apply global scale → verify Smart points
- Files: `src/js/core/bell-shift-controller.js`, `src/js/core/bell-width-controller.js`
- Risk: Bell operations and global scaling may interact in unexpected ways if ordinals get reordered
- Priority: High (bell controls are new feature)

### API Key Persistence in Chat Interface

**What's not tested:** Setting API key → reload page → verify key persists (currently can't test because storage is unimplemented)
- Files: `src/js/ai/chat-interface.js`
- Risk: Once storage is implemented, regression could cause API keys to be lost on reload
- Priority: High (security relevant)

### Contrast Intent Application

**What's not tested:** Applying contrast presets and verifying curve adjustments
- Files: `src/js/ai/ai-actions.js` (line 861)
- Risk: When implemented, edge cases like "apply contrast to flat curve" may fail
- Priority: Medium (feature is stubbed but not yet functional)

### Large File Parser Edge Cases

**What's not tested:** .quad files without QuadToneRIP header; CGATS files with extra columns; LAB files with blank rows
- Files: `src/js/parsers/file-parsers.js`, `src/js/data/lab-parser.js`
- Risk: Files that are valid to other tools may fail to parse in quadGEN with generic errors
- Priority: Medium (affects user workflow if they use mixed tools)

### Linearization State After Revert

**What's not tested:** Load LAB → apply scaling → revert global → verify linearizationData and linearizationApplied are both cleared
- Files: `src/js/ui/event-handlers.js`, `src/js/core/state.js`
- Risk: LAB data could remain active after revert, causing curves to scale differently than expected
- Priority: High (CLAUDE.md guardrails explicitly warn about this)

---

*Concerns audit: 2026-01-22*
