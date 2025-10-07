# Global Scale Feature Specification

## Purpose
- Provide a single multiplier that uniformly scales every enabled ink channel’s End value so print density can be trimmed or boosted without touching per-channel shape edits.
- Maintain parity with legacy quadGEN behavior while accommodating Smart-curve editing (relative key points) and history/undo requirements in the modular build.

## User-Facing Entry Points
- **Scale field** (`#scaleAllInput`) in the channel table header accepts integers 1–1000. Values above the maximum safe multiplier are clamped to the highest channel that would hit 65 535.
- **Lab Tech command** `scale_channel_ends_by_percent` (and natural-language delegates) invoke the same core routine via `ai-actions.js`.
- When the field is empty the UI defaults back to 100 %. Leaving the page or resetting the printer also resets to 100 %.

## Core State & Helpers
- `src/js/core/scaling-utils.js`
  - `scaleAllPercent`: canonical multiplier (default 100).
  - `scaleBaselineEnds`: lazily populated map of each channel’s 65 535-based End value captured before scaling. Used to prevent multi-apply drift.
  - `scaleChannelEndsByPercent(percent, { skipHistory })`: central scaling routine shared by UI and AI integration.
  - `applyGlobalScale(rawPercent)`: UI handler that parses input, delegates to `scaleChannelEndsByPercent`, raises toast/status, and triggers chart/session refreshes.
- `src/js/ui/event-handlers.js`
  - `handlePercentInput` / `handleEndInput` recompute `scaleBaselineEnds` when a row changes.
  - After any per-channel edit, `setTimeout` re-invokes `scaleChannelEndsByPercent(currentScale, { skipHistory: true })` so manual tweaks respect the active global Scale.
- State manager keys (`printer.channelValues.*`) keep percentage and End values in sync for undo and Lab Tech flows.

## Expected Behavior
1. **Applying a new scale**
   - Input is clamped (1–1000). Invalid or non-positive values return an error message without mutating state.
   - Baselines are captured the first time scale ≠ 100 % is applied. Subsequent calls reuse those baselines so 90 % → 95 % is relative to the original End, not the previously scaled output.
   - Each enabled channel recomputes `newEnd = round(baseline * scaleFactor)` and updates both the raw End field (0–65 535) and percentage display.
   - Smart curves are rescaled via `rescaleSmartCurveForInkLimit(channel, prevPercent, newPercent, { mode: 'preserveRelative' })` so the plotted curve matches the new limit without double-applying global corrections.
   - History records a batch action unless `skipHistory` is passed.

2. **Per-channel overrides with global Scale active**
   - Editing the percentage or End field updates baselines and then schedules a silent `scaleChannelEndsByPercent(currentScale)` to reapply the global multiplier.
   - Result: Even if a user types 100 % for MK while Scale is 80 %, the field snaps back to 80 % and the plotted endpoint remains 80 %.

3. **Rebased baselines after corrections**
   - When `.cube`/LAB/manual corrections are baked, `rebaseChannelsToCorrectedCurves` refreshes both the visible ink-limit fields and the cached scale baselines. Subsequent scale edits operate on the rebased maxima so nudging a channel resumes from the baked curve rather than the original `.quad` value.

4. **Returning to 100 %**
   - When the user sets the Scale to 100 %, baselines are cleared so subsequent adjustments capture fresh unscaled values.

5. **Clamping**
   - If a baseline would exceed 65 535 at the requested multiplier, the operation clamps to the maximum safe percent and reports “already maxed” in the status message.

## Interactions & Edge Cases
- **Smart curves:** All Smart curve rescale paths use `mode: 'preserveRelative'` so the stored relative outputs stay untouched (preventing the 0.8² shrink regression). During recompute, metadata flags propagate the `bakedGlobal` status.
- **Auto white/black limit toggles:** Scaling preserves the current auto-limit flags. Recompute routines set `bakedAutoWhite/Black` metadata so UI hints stay accurate.
- **Measurement data (LAB/CGATS/manual):** Global Scale operates on printer-space End values only; measurement datasets remain unchanged. Undo/redo restores both scale percent and per-channel End values.
- **Disabled channels:** Channels with End ≤ 0 are skipped. Re-enabling a channel after scaling triggers baseline capture so the next scale call includes it.
- **History:** `skipHistory: true` is used for automatic reapply flows (per-channel edits, post-load normalization) to avoid noisy undo stacks.
- **Baseline drift guard:** When baselines are already cached and the user modifies a channel manually, `updateScaleBaselineForChannel` recomputes the baseline in-place using `scaleAllPercent` so future scales stay accurate.

## Testing
- Automated: `tests/e2e/edit-mode-keypoint-scaling.spec.ts`
  - `global scale preserves Smart curve absolute outputs` exercises 80 % scale + manual override, verifying the value snaps back and curve data match 80 %.
  - Other scenarios in the same suite cover Smart point insertion and recompute interactions after scaling.
- Manual: `docs/manual_tests.md` → “Global Scale Undo Screenshot Check” ensures batch history entries produce correct before/after artifacts.
- Smoke: `npm run test:smoke` catches console errors during load, including failures in global-scale initialization.

## Diagnostics & Debugging
- `scalingUtils` debug namespace (available via global window helpers in dev builds) exposes `applyGlobalScale`, `scaleChannelEndsByPercent`, and related helpers.
- Console logs (gated by dev builds) print each scale invocation, requested percent, baselines, and clamping decisions.
- To inspect baselines, run in dev tools: `window.__quadDebug.scalingUtils`.

## Known Limitations / Follow-ups
- Scaling currently operates synchronously on DOM inputs; future refactors may centralize End/percent state in a dedicated store to reduce DOM reads.
- No explicit progress indicator for long clamp operations; all scaling is near instant but large baseline sets could benefit from a microtask defer.
- Additional documentation candidates: **Global Revert**, **Auto white/black limits**, **LAB global correction toggle**, **Edit Mode recompute**, and **Contrast intent presets**.

## References
- Source: `src/js/core/scaling-utils.js`, `src/js/ui/event-handlers.js`
- Tests: `tests/e2e/edit-mode-keypoint-scaling.spec.ts`
- Docs: `docs/manual_tests.md`, `src/js/ui/help-content-data.js` (Version History)
