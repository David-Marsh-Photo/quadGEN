# Ink-Load Overlay

The ink-load overlay adds a cumulative ink percentage trace to the main ink chart so operators can see how much total ink the printer will lay down at every input level. The line sits alongside existing reference overlays (e.g., light blocking, correction mix), respecting the full chart height regardless of zoom. An Options-panel toggle controls visibility, and a companion input exposes the alert threshold (defaults to 25 %, matching the January legacy build). When the overlay is active, chart tooltips report the cumulative percentage at the cursor and flag positions that exceed the threshold.

## Implementation Details

- Sampling: `computeInkLoadCurve()` gathers 256-point samples from every enabled channel via the existing `make256()` pipeline (respecting linearization, Smart curves, and end scaling), converts them to percent-of-total ink, and sums them per input slot.  
- State & persistence: `showInkLoadOverlay` and `inkLoadThreshold` live in the application state with localStorage persistence keys (`quadgen.inkLoadOverlayEnabled.v1`, `quadgen.inkLoadThreshold.v1`) so operator preferences survive reloads.  
- Rendering: the overlay draws on the chart’s reference layer with dashed gray segments below the warning threshold and solid red segments above it. A labeled badge reports the max total percentage, adopting the red accent whenever the threshold is exceeded.  
- UX: operators toggle the overlay and edit the threshold in ⚙️ Options → “Show cumulative ink load overlay.” Tooltips append “Ink Load …%” with a warning icon when the sampled point clears the threshold, and the debug panel exposes the curve via `__quadDebug.chartDebug.lastInkLoadOverlay`.  
- Testing: Playwright coverage (`tests/e2e/options-ink-load.spec.ts`) asserts the controls, overlay telemetry, and threshold edits; `tests/e2e/capture-ink-load-overlay.mjs` captures a screenshot for regression artifacts.
