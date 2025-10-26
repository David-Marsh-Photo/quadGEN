# Bell Curve Apex Shift

The Bell Apex Shift feature lets Lab Techs re-center bell-shaped ink channels without rebuilding Smart curves or reloading measurements. When Edit Mode is enabled and the selected channel classifies as `bell`, the Edit Curve panel surfaces a **Bell Apex Shift** card that shows the apex input percent alongside ± nudge buttons and a numeric field for direct entry.

## Detection & Metadata
- `src/js/data/curve-shape-detector.js` now reports `apexInputPercent`, `apexOutputPercent`, `apexSampleIndex`, and span estimates for every classification result.
- `src/js/core/state.js` persists the shift state under `loadedQuadData.bellCurveShift` and attaches a normalized `bellShift` payload (baseline, shifted apex, offset, timestamps) to `getChannelShapeMeta()` so the UI, Playwright, and console tooling share the same data.
- When a channel stops classifying as bell (e.g., after revert), the stored shift state is cleared automatically.

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
