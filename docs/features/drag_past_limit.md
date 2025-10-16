# Drag-Past-Limit Support (Modular Build)

## Objective
Restore the legacy “drag above ink limit” behavior in the modular architecture. When an operator drags or edits a Smart key point past the current channel limit (End), the system automatically raises the End just enough to honor the requested absolute output—provided the channel isn’t locked—and rescales other points so their absolute outputs remain unchanged. This eliminates flat plateaus without manual post-edit ink-limit tweaks.

Target success probability: **≥95 %** (achieved)

---

## Preconditions & References
- Legacy implementation reference: `jan/quadGEN Beta 3.1Jan.html`, `adjustAIKeyPointByIndex` & drag handlers.
- Modular entry points:
  - `src/js/ui/edit-mode.js` — drag logic (`handleDragMove`, `adjustSmartKeyPointByIndex` usage).
  - `src/js/curves/smart-curves.js` — Smart curve mutations (`adjustSmartKeyPointByIndex`, inserts).
  - `src/js/ui/printer-manager.js` + `src/js/core/channel-densities.js` — ink limit persistence, locks, scaling baseline.
  - `src/js/core/history-manager.js` — undo/redo capture for End & key-point edits.
  - `src/js/core/scaling-utils.js` — base End normalization.

---

## Phase Plan

### Phase 0 – Research & Guardrails
1. **Audit Current Path:** Map every call to `adjustSmartKeyPointByIndex` (and related insert helpers) in `src/js/curves/smart-curves.js`. Confirm edit-mode drag invokes the same helper.
2. **Ink-Limit Dependencies:** Review `channel-locks`/`printer-manager` to understand when End edits are blocked, and how baseline percent/end values are cached for scaling.
3. **History Expectations:** Ensure raising End and rescaling other points records a single undo stack entry (matching legacy behavior).
4. **Testing Inventory:** Identify existing tests that assert End stability or drag constraints, so we don’t break them unexpectedly.

### Phase 1 – API Design
1. **Helper Draft:** Sketch a new helper (`raiseChannelEndForAbsoluteTarget`) that:
   - Guards against locks/disabled channels.
   - Computes new End from desired absolute output.
   - Returns scaling factor + updated End.
2. **Integration Points:** Decide where to call the helper (inside `adjustSmartKeyPointByIndex`, `insertSmartKeyPointAt`, `insertSmartKeyPointBetween`, and Playwright drag flow).
3. **Rescaling Strategy:** Match legacy approach: when End increases, multiply all other key points’ pre-scale values by `oldScale / newScale` so they preserve absolute outputs.
4. **Status & Telemetry:** Define user feedback (status toast) mirroring legacy (“K ink limit changed to 60%”) and ensure channel row inputs update.

Deliverable: inline docstring or ADR-style comment summarizing the API contract.

### Phase 2 – Implementation
1. **Utility Addition:** Implement the raising helper inside `smart-curves.js` or a shared module (avoid duplication).
2. **Adjust & Insert Logic:**
   - Modify `adjustSmartKeyPointByIndex` to:
     - Convert absolute output to pre-scale.
     - Invoke the raise helper when needed.
     - Rescale other points before calling `setSmartKeyPoints`.
   - Apply the same for insert helpers so direct placement past the limit also lifts End.
3. **Drag Pipeline:** Ensure the edit-mode drag handler continues passing absolute chart percentages; confirm the new logic handles them correctly.
4. **UI Sync:** Update `event-handlers.js`/`printer-manager.js` to refresh percent/end inputs after auto-raise so the UI reflects new limits.
5. **History Integration:** Wrap changes so combined End + key-point updates yield a single undo entry; update `HistoryManager` if needed.

### Phase 3 – Testing & Validation
1. **Unit Tests (Vitest):**
   - New cases in `tests/lab/...` or `tests/core/...` verifying End raises when a target exceeds limit.
   - Ensure channels marked as locked block the raise.
   - Confirm rescaling keeps other points’ absolute values unchanged.
2. **Playwright:**
   - Add/extend an edit-mode drag spec to drag above the limit and assert the End field increases, curve smoothes, and undo reverts both.
   - Regression check for locked channel scenario (drag attempt fails with status message).
3. **Manual/QA:**
   - Load TRIFORCE data, trigger drag to fill bell-top, observe smooth transition.
   - Verify per-channel debug panel and composite overlays still behave.

### Phase 4 – Documentation & Flagging
1. **Docs Update:** Record behavior in:
   - `docs/features/manual-lstar.md` (if relevant to manual corrections).
   - `docs/print_linearization_guide.md` or `docs/features/lab-ingestion.md` for operator guidance.
   - Help glossary/version history if this is user-facing.
2. **Changelog & Version History:** Note the smarter drag behavior.
3. **Feature Flag (Optional):** If we need a roll-out gate, introduce `ENABLE_DRAG_PAST_LIMIT` in `feature-flags.js` defaulted to `true` once validated.

### Phase 5 – Release Checklist
1. `npm run build:agent` to refresh `dist/index.html`.
2. Run smoke + targeted Playwright suites (drag spec, density tests, manual-lstar, etc.).
3. Verify undo/redo stacks manually for at least one channel.
4. Capture before/after screenshot for QA (optional but useful).

### Phase 6 – Post-Implementation Monitoring
1. Keep an eye on user reports around auto-raised limits (ensure they aren’t surprised by End changes).
2. If composite solver relies on static End baselines, ensure the baseline cache is updated after the raise (monitor logs).

---

## Risk Mitigation
- **Undo Regression:** Validate undo/redo up front to prevent history stack desync.
- **Locked Channels:** Explicitly check lock state before raising End; surface clear status message to avoid confusion.
- **Scaling Baseline Drift:** After raising End, call `updateScaleBaselineForChannel` so later global-scale operations have correct baselines.
- **Automation Coverage:** Fail fast with tests before manual QA to catch edge cases (e.g., 0-End channels, 100% End).

---

## Effort Estimate
| Phase | Duration |
|-------|----------|
| 0     | 0.5 day  |
| 1     | 0.5 day  |
| 2     | 1.5 days |
| 3     | 1 day    |
| 4     | 0.5 day  |
| 5–6   | 0.5 day  |
**Total:** ~4.5 days (focused engineering + review)

## Implementation Notes

- `ensureInkLimitForAbsoluteTarget` (src/js/curves/smart-curves.js) now raises the channel End, updates UI/state manager baselines, records history transactions, and rescales neighbouring points when an edit targets an absolute level above the current limit.
- `adjustSmartKeyPointByIndex` and the Smart-point insert helpers call the helper, so both direct edits and new point insertions inherit the behavior.
- `quadGenActions.adjustSmartKeyPointByIndex` exposes the same path, enabling Playwright coverage (`tests/e2e/edit-mode-ink-limit-raise.spec.ts`).
- Dragging or scripted adjustments while the channel lock is enabled still respect the lock and surface the existing status messaging.

With the plan above—mirroring legacy logic, gating via tests, and keeping dependencies synchronized—we should hit the 95 % success target.***
