# Auto-Raise Ink Limits On Import

## Objective
Automatically increase channel End values when an imported correction requires more headroom than the current ink limit provides, preserving the correction’s intended shape without manual tweaking. Target success probability: **≥95 %**.

## Motivation
- Imported LAB/CGATS/manual corrections can request output levels above the configured End, producing flat plateaus at the limit and introducing perceptual banding.
- Operators currently have to notice the plateau and adjust Ends manually, which is easy to miss in busy production runs.
- We already auto-raise Ends for edit-mode drags (`docs/features/drag_past_limit.md`); extending that guardrail to correction imports keeps behaviors consistent and reduces production errors.

## Goals
- Detect when any global/per-channel correction sample exceeds the channel’s plotted ceiling and raise the End just enough to accommodate it.
- Preserve the absolute output of existing Smart key points while adjusting the End so curves don’t collapse or stretch unexpectedly.
- Maintain full undo/redo traceability and the legacy status toast (“K ink limit changed to 60%”) to keep operators informed.
- Block raises when the channel is locked or policy forbids it, surfacing clear messaging so operators understand why a correction flattened.

## Non-Goals
- Changing how operators set initial ink limits or printer baselines.
- Auto-raising during global scale adjustments; those continue to respect cached baselines.
- Reworking the solver to ignore ink limits entirely—this feature keeps limits authoritative but adapts them when corrections demand it.

## User Workflow Impact
0. Operator enables **Auto-raise ink limits after import** in ⚙️ Options (defaults to off while the feature is gated).
1. Operator imports a correction (LAB/CGATS/manual, `.quad` rebasing, recompute).
2. quadGEN detects any channel samples that exceed the stored End.
3. Affected channels auto-raise their End, emit status toasts, and refresh the table inputs.
4. The correction plots without a clipped plateau; undo reverses both the correction and any End increases in one step.
5. If a channel is locked, the correction remains clipped and a status message explains that the lock prevented an End raise.

## Technical Approach
### Feature Flag
- Gate the behavior behind a new `autoRaiseInkLimitsOnImport` runtime flag (default **off**) so QA can validate in isolation. Toggle via the Options debug helpers (`window.enableAutoRaiseInkLimitsOnImport(true/false)`) or the feature flag panel once exposed.
- When disabled, the helper short-circuits after recording audit context, leaving existing correction workflows unchanged.
- Flag state persists with other feature toggles so regression suites can opt-in explicitly.

### Detection & Thresholding
- Sample the final correction curve at the existing 256 evaluation points immediately after smoothing. Compute the maximum absolute output `maxOutput`.
- Translate `maxOutput` into an absolute ink request (`maxOutput * channel.endScale` for End values stored in absolute units).
- Compare to `currentEnd`. If `maxOutputAbsolute` exceeds `currentEnd` by more than an epsilon (0.05 % of End), trigger an auto-raise.
- Aggregate per-channel findings so we can batch updates and write a single history entry per correction load.

### Raising Helper
- Extend the existing `ensureInkLimitForAbsoluteTarget` helper (introduced for drag flows) to accept `source` metadata (e.g., `"correction-import"`).
- Inputs: channel id, desired absolute output, epsilon, and context (locked status, policy flags).
- Outputs: `{ raised: boolean, newEnd, rescaledPoints }`. When `raised` is true, invoke the helper to:
  - Guard against locks/disabled channels, returning `raised: false` with a status reason if blocked.
  - Compute the new End (`Math.max(currentEnd, desired * (1 + buffer))`), clamp to 100 %/65535.
  - Rescale existing Smart key points by `oldScale / newScale` so their absolute values remain unchanged.
  - Update printer-manager baselines so global scale operations stay in sync.

### Integration Points
- Hook detection immediately after each correction import completes:
  - Global LAB/CGATS loaders (`src/js/core/global-linearization.js`).
  - Manual L* generator (`src/js/ui/manual-lstar.js`).
  - Per-channel measurement loads (`src/js/core/per-channel-linearization.js`).
  - Recompute flows in Edit Mode (`src/js/ui/edit-mode.js`).
- Accumulate the channels needing raises before committing history so the resulting undo encompasses both the correction and End changes.
- Surface status via the existing notifier; include source context (“Raised PK ink limit to 64% (correction import)”).
- Update composite debug badges when the End changed so QA can confirm in screenshots.
- Record coverage telemetry (`compositeLabSession.densityCoverage` / `getCompositeCoverageSummary()`) so audits can distinguish coverage-limited raises from buffer usage and confirm smoothing windows honoured the new ceilings.

### History & Persistence
- Capture a single `HistoryManager.captureState` call **after** all raises and curve mutations to maintain a coherent undo checkpoint.
- Refresh `printerManager` inputs and cached baselines (via `setChannelEndValue` / `updateScaleBaselineForChannel`).
- Persist End changes through the normal saving path; no new storage schema required.

### Redistribution Smoothing Interoperability
- Auto-raise now records structured channel adjustments (previous/new percent, ends, target percent) so the composite LAB solver can tag the affected inks without re-running detection.
- When the **Redistribution smoothing window** toggle is on and composite weighting is set to **Normalized**, those adjustments seed taper windows even if the post-raise solve no longer hard-saturates. The composite debug payload exposes both arrays (`summary.autoRaisedEnds` and `summary.smoothingWindows`), with `forced: true` when a window is generated because of auto-raise headroom.
- Forced windows preserve per-sample density while blending the correction back across the same support channels operators expected pre-raise, so screenshots and QA badge captures stay traceable.
- Equal weighting (manual override) continues to hand the remaining delta to the dominant ink; operators should leave the default Normalized mode (or pick Momentum) before import when they want smoothing and auto-raise to cooperate. The Options panel help now calls this out.
- Manual regression: enable auto-raise + smoothing, switch weighting to Normalized, load `P800_K36C26LK25_V6.quad` / `P800_K36C26LK25_V6.txt`, and confirm status toasts list the raises while the composite debug summary reports matching smoothing windows.

## Implementation Plan (Phased)
### Phase 1 – Research & Guard Rails
1. Audit existing correction import paths to ensure they all funnel through a shared “post-import finalize” hook.
2. Review `ensureInkLimitForAbsoluteTarget` to confirm it already handles rescaling, locks, and history integration; identify any gaps for correction contexts.
3. Add diagnostic logging (behind `DEBUG_LOGS`) to report when auto-raises trigger, aiding QA.

### Phase 2 – Helper Enhancements
1. Update the helper to accept a `context` object (`{ source: 'correction-import', emitStatus: true }`).
2. Ensure it returns structured outcomes that callers can batch (channel id, from/to End, blocked reason).
3. Write Vitest coverage for standalone helper behavior (raise vs. locked vs. no-op).

### Phase 3 – Import Pipeline Wiring
1. Insert detection calls after each correction loader resolves new Smart curves.
2. Map over affected channels, call the helper, and collect responses.
3. Emit status notifications and composite badge updates for each successful raise; aggregate blocked reasons for locks.
4. Wrap the entire operation in a single history mutation (existing `CaptureState` call or a dedicated wrapper if needed).

### Phase 4 – UI Sync & Telemetry
1. Refresh the Options/Channels table UI using the existing printer-manager hooks.
2. Update composite debug summary (`window.getCompositeDebugState`) to include an `autoRaisedEnds` array.
3. Add optional telemetry hooks (if enabled) to record frequency of auto-raises for future tuning.

### Phase 5 – Documentation & Help
1. Update `docs/features/channel-density-solver.md` (redistribution smoothing section) and `docs/features/global-correction-loaders.md` with the auto-raise behavior.
2. Add a Glossary entry (“Auto-raised ink limit”) and version-history note when shipping.

### Phase 6 – Testing & Validation
1. Trigger end-to-end Playwright specs covering both raised and locked scenarios.
2. Capture headful screenshot evidence for QA (Options panel + status toast + composite badge).
3. Run the full build (`npm run build:agent`) and smoke suite.

## Testing Strategy
### Automated (Vitest)
- **Helper behavior**: Assert that exceeding the limit raises End, preserves other points’ absolute outputs, and updates baselines.
- **Locked channel**: Ensure the helper returns `raised: false` with an appropriate status key when the channel is locked.
- **Precision guard**: Confirm no raise occurs when the excess is < epsilon, preventing churn from floating-point noise.

### Playwright (Headless + Headed)
- **Import raises End**: Load `P800_K36C26LK25_V6.quad` + `P800_K36C26LK25_V6.txt`, enable normalization and smoothing window, and verify the K channel End increases with a status toast.
- **Locked channel**: Lock K, repeat import, ensure End stays fixed, a “locked” status appears, and the curve plateaus.
- **Undo validation**: After an auto-raise, trigger undo and assert both the End and imported curve revert.
- **Composite debug overlay**: Confirm `autoRaisedEnds` snapshot includes the affected channel and the smoothing window still triggers.

### Manual QA
- Use the Options panel to enable composite debug overlays and normalized weighting.
- Import high-density LAB sets and confirm curves no longer plateau at original limits.
- Verify status messaging, table updates, and undo/redo in the UI.
- Record screenshots for the QA archive showing the toast and updated End values.

## Redistribution Smoothing Interoperability
- When both **Auto-raise ink limits after import** and **Redistribution smoothing window** toggles are enabled, the composite solver treats freshly raised channels as “budget constrained” for the current solve. Smoothing windows may therefore appear even if the new End removes the original saturation.
- Auto-raise now emits structured metadata (`autoRaisedEnds`) that is persisted on `compositeLabSession` and surfaced through `getCompositeDebugState()`. The composite debug overlay pairs each entry with the corresponding smoothing window so QA can confirm both features triggered together.
- Playwright coverage (`tests/e2e/auto-raise-smoothing-interoperability.spec.ts`) exercises the interaction by loading `P800_K36C26LK25_V6` with both toggles active, asserting that smoothing windows remain visible, and verifying status toasts stay concise.
- Operators can trust the debug panel again: raised channels still display smoothing windows when redistribution needed them, and locked channels continue to report when auto-raise was blocked.
- Regression checklist: enable both toggles, import a high-density LAB set, confirm status toasts list the raises, and verify the composite debug summary reports matching smoothing windows.

## Risk Mitigation
- **Undo/redo integrity**: Keep mutation order deterministic (raise Ends before calling `setSmartKeyPoints`) and rely on existing history capture wrappers.
- **Baseline drift**: Immediately update scale baselines to avoid downstream global-scale artifacts.
- **Over-raising**: Apply a minimal buffer and clamp to 100 %/65535 to prevent runaway End values; include telemetry to tune the epsilon.
- **Locked channels**: Surface explicit feedback when raises are blocked so operators can decide whether to unlock and retry.

## Success Criteria (≥95 %)
- Automated tests cover helper logic and Playwright flows for at least one high-density dataset.
- Manual QA checklist (status toast, composite badge, undo, locked behavior) passes without regressions in two independent runs.
- No regressions in existing drag-past-limit or ink-limit Playwright suites.
- Production builds show the same behavior with instrumentation verifying auto-raise triggers when expected.
