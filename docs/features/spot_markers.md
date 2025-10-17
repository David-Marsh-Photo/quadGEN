# Measurement Spot Marker Overlay

## Purpose
The measurement spot marker overlay offers a quick visual audit of LAB measurements directly on the curve. Each patch is represented along a fixed mid-chart rail so printers can see, at a glance, which readings fall within tolerance and where additional ink or lightening is required.

## Operator Experience
- Toggle from ⚙️ Options → **Show measurement spot markers** once a LAB dataset is loaded. The preference persists per browser and reactivates automatically the next time compatible data is present.
- Badges sit on a rail aligned with the unzoomed 70 % height, keeping the overlay clear of plotted channels even when you zoom in or out.
- Interpret the markers:
  - **Green check**: |Δ| ≤ 1 % (no action needed).
  - **Red upward arrow**: patch must darken; arrow length and label grow with the required percent lift.
  - **Blue downward arrow**: patch must lighten; length/label shrink proportionally.
- Faint circular dots still mark the actual measured output so you can correlate the correction to the curve shape.
- Hovering a badge updates the chart tooltip with input percent, measured L*, delta, and recommended action.

## Implementation Highlights
- `LinearizationState` caches `labMeasurementCorrections` (input, delta, normalized magnitude) after each LAB load, skipping the 0 % and 100 % anchors.
- Rendering lives in `chart-manager.js`, which projects markers into canvas space using the existing DPI-aware helpers and draws the rail-aligned badges before Smart point overlays.
- Arrow length clamps to ±8 % visual range to reduce overlap; labels remain legible at standard zoom levels.
- When the correction gain slider reduces overall correction strength, marker deltas and arrow lengths scale automatically to match the blended curve.
- Datasets above 256 samples skip the overlay to avoid clutter; operators see the tooltip summary instead.

## Validation
- Vitest coverage (`tests/core/lab-spot-markers-summary.test.js`) verifies action/delta derivation and the 1 % tolerance threshold.
- Playwright (`tests/e2e/lab-spot-markers-overlay.spec.ts`) enables the overlay, captures the mid-rail arrows/checks, and confirms hover tooltips.
- Manual regression steps live under **Measurement Spot Markers Overlay** in `docs/manual_tests.md` and require screenshots demonstrating both an in-tolerance check and an out-of-tolerance arrow.
