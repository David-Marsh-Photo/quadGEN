# Bell Curve Apex Shift

The Bell Apex Shift feature lets Lab Techs re-center bell-shaped ink channels without rebuilding Smart curves or reloading measurements. When Edit Mode is enabled and the selected channel classifies as `bell`, the Edit Curve panel surfaces a **Bell Apex Shift** card that shows the apex input percent alongside ± nudge buttons and a numeric field for direct entry.

## Detection & Metadata
- `src/js/data/curve-shape-detector.js` now reports `apexInputPercent`, `apexOutputPercent`, `apexSampleIndex`, total span estimates, and the newly added left/right span samples + percents for every bell classification. Each result also carries a lightweight `curveHash` so downstream features can tell when the underlying samples change.
- `src/js/core/state.js` persists both the apex shift state and the width-scale metadata under `loadedQuadData.bellCurveShift`, attaching normalized `bellShift` and `bellWidthScale` payloads to `getChannelShapeMeta()` so the UI, Playwright, and console tooling stay in sync. Left/right factors default to 1.0 and carry a persisted `linked` flag per channel.
- When a channel stops classifying as bell (e.g., after revert), the stored shift/width state is cleared automatically.

## Shift Algorithm
- `src/js/core/bell-shift.js` exports `shiftBellCurve(samples, apexIndex, deltaPercent, options)` which:
  - Sanitizes the 256-sample curve and clamps apex movement to the interior of the sample range.
  - Converts the requested apex delta (in input percent) to a sample-index offset.
  - Applies an exponential falloff (`exp(-|x−apex| / span)`) so samples near the apex move most while tails remain anchored.
  - Re-samples via linear interpolation, rounds back to 16-bit ink counts, and preserves endpoints exactly so ink limits stay intact.
- Unit coverage lives in `tests/curves/bell-shift.test.js` (identity shift, left/right movement, clamping guardrails).

## Controller & State Wiring
- `src/js/core/bell-shift-controller.js` exposes `applyBellShiftTarget`, `nudgeBellShift`, and `resetBellShift`, handling:
  - Channel-lock validation with `channel-locks.js`.
  - Undo snapshots via `history-manager.captureState`.
  - UI refreshes (`triggerInkChartUpdate`, `triggerProcessingDetail`, `triggerPreviewUpdate`).
  - Status toasts describing the new apex position.
- `src/js/core/bell-shift-state.js` centralizes persistence helpers (container creation, request tracking, metadata cloning) so both the controller and `state.js` share the same structure.

## UI Behaviour
- `src/js/ui/printer-manager.js` no longer hosts bell controls; the Edit Curve side panel card appears only when Edit Mode is on and the selected channel is bell-classified.
- `src/js/ui/bell-shift-controls.js` wires the Edit panel input field and nudge buttons:
  - Nudge buttons move the apex ±0.5 % (±2 % with Shift).
  - The numeric field accepts any 0–100 input; blur/Enter events commit the target percent.
  - The card hides itself when Edit Mode is off or the selected channel isn’t bell-shaped, keeping the UI minimal.
- Smart key points keep their existing ordinals: after the apex shift, each interior Smart point slides horizontally using the same exponential weighting (endpoints remain fixed and minimum gaps are re-enforced). If Smart points don’t exist yet, the controller silently seeds them from the curve before applying the offset.
- `initializeBellShiftControls` (Edit Mode) wires the Edit panel card once at startup, and `processing-status.updateChannelShapeBadge` calls `updateBellShiftControl()` whenever metadata refreshes so the UI and detector stay aligned.

## Automated Coverage
- `tests/curves/bell-shift.test.js` validates algorithmic invariants (endpoint preservation, clamped offsets).
- `tests/e2e/bell-curve-apex-shift.spec.ts` loads `data/KCLK.quad`, asserts that bell channels expose the control (and monotonic channels do not), nudges/edits the apex, verifies `getChannelShapeMeta()` updates, and captures `test-screenshots/bell-apex-shift-control.png`.
- Playwright smoke (`npm run test:smoke`) still guarantees the bundled app loads without console errors after each build.

## Manual QA
- See “Bell Apex Shift Control” in `docs/manual_tests.md` for the regression flow (visibility, metadata, undo/redo, screenshot requirements).
- The Help → Glossary entry “Bell Apex Shift” plus Version History remind operators that bell channels can be re-centered non-destructively; the ReadMe highlights the control in the channel-table section.

## Bell Width Scale

The Bell Width Scale feature widens or tightens the left and/or right slopes of bell-classified channels without moving the apex or reseeding Smart points.

### Width Algorithm
- `src/js/core/bell-width-scale.js` samples the 256-point curve, clamps the apex to interior indices, and blends the requested left/right factors via the same exponential falloff used by apex shifting (`exp(-|x−apex| / span)`). Each side can tighten (< 100 %) or widen (> 100 %) independently, endpoints remain pinned, and the apex sample/value stays fixed.
- Shared helpers live in `src/js/core/bell-curve-utils.js`, which now exports the sanitize/resample/falloff utilities used by both the apex and width paths.
- Unit coverage lives in `tests/curves/bell-width-scale.test.js` (identity, asymmetric scaling, endpoint preservation).

### Controller & Smart Points
- `src/js/core/bell-width-controller.js` provides `applyBellWidthScale`, `nudgeBellWidthSide`, `resetBellWidthScale`, and `setBellWidthLink`, handling channel locks, undo snapshots, status toasts, and metadata persistence. Width factors are stored per channel (`bellWidthScale`) alongside the existing apex metadata, including the persisted `linked` flag.
- Smart key points reuse the same distance-weighted pipeline: `adjustSmartPointsAfterWidthScale` multiplies each interior point’s distance from the apex by the blended factor (with span-aware falloffs) so ordinals remain stable and overlays stay aligned. The helper seeds Smart points on demand if the user hasn’t edited the curve yet.
- `tests/core/bell-width-controller.test.js` verifies the controller updates width metadata and curve samples for asymmetric edits.

### UI Behaviour
- `src/js/ui/bell-width-controls.js` drives the new **Bell Width** card directly beneath Bell Apex in the Edit Curve panel. The card:
  - Shows left/right percent inputs, ±2 % (Shift=5 %) nudges, and a Reset button when Edit Mode is on and the selected channel classifies as bell.
  - Includes a “Link sides” toggle (⛓ button) that mirrors edits when enabled and persists per channel via `setBellWidthLink`.
  - Pushes tooltip hints that match the minimalist plot-smoothing helper (“Adjust left/right width to widen or tighten the bell without moving its apex…”).
- Inputs are now controlled text fields (no native number spinner) with clamping to 40–250 % plus a short debounce so manual edits apply in order; ± buttons temporarily disable while each mutation runs, and the link toggle applies immediately so the next click always respects the current mode.
- Inputs accept any 40–250 % value; linked mode mirrors both inputs while unlinking allows asymmetric edits. The module refreshes itself after every controller call so the displayed percentages always match metadata.
- Smart-mode edits call `regenerateSmartCurveSamples()` immediately after the controller finishes so the stored 256-sample curve (and all smoothing caches) match the moved Smart handles; this keeps the plotted line, Smart markers, and exported `.quad` perfectly in sync.

### Automated Coverage
- `tests/curves/bell-width-scale.test.js` and `tests/core/bell-width-controller.test.js` cover algorithm and controller behavior.
- `tests/e2e/bell-width-scale.spec.ts` loads `data/KCLK.quad`, seeds Smart key points via Recompute, edits Bell Width, and asserts that the regenerated samples match the Smart interpolation (±1 count tolerance) so chart and handles never drift apart.
- The existing smoke suite (`npm run test:smoke`) guards bundle regressions; screenshot artifacts live under `test-screenshots/bell-width-*.png` for quick visual audits.

### Manual QA
- See “Bell Width Scale Control” in `docs/manual_tests.md` for regression steps (visibility, linked toggle, asymmetric edits, undo/redo, screenshot capture).
- Help → Glossary now lists “Bell Width Scale,” and Version History highlights the addition so Lab Techs know bell channels can be widened/tightened without reseeding curves.
