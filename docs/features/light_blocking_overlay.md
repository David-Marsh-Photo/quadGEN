# Light-Blocking Overlay

The light-blocking overlay plots a purple density-weighted composite that estimates how much optical density the active channel mix delivers across the input range. Use it to gauge where the print transitions to heavier inks or to compare against a reference baseline.

## Behaviour

- **Source data**: Samples each enabled channel with `make256()` (respecting linearization, Smart curves, and ink limits), normalises each sample to the channel’s end value, then applies the configured channel weights to sum a 256-point composite curve.
- **Rendering**: Drawn on the chart’s reference layer with a solid purple stroke that ignores Y-axis zoom so coverage is always shown on a full 0–100% scale. A label in the upper-right corner reports the peak coverage; when a reference `.quad` is loaded, a dashed comparison curve and secondary max label appear alongside it.
- **Controls**: Toggle visibility from ⚙️ Options → “Show light blocking overlay.” The setting persists per browser via `quadgen.lightBlockingOverlayEnabled.v1`.
- **Reference comparison**: Loading a reference `.quad` populates a dashed overlay generated from the reference curves and the current channel weight configuration, enabling quick “current vs baseline” comparisons.
- **Tooltip integration**: When the overlay is active, chart tooltips append “Light Block …%” so you can read the composite coverage at the cursor; if a reference curve is present the tooltip also reports the reference value.
- **Debug access**: The last computed curve and metadata are mirrored to `__quadDebug.chartDebug.lastLightBlockingCurve` to support diagnostics and automated tests.

## Related Code

- `src/js/core/light-blocking.js`: Core sampling, weighting, caching, and persistence helpers.
- `src/js/ui/chart-manager.js`: Rendering, tooltip integration, reference comparison, and debug wiring.
- `src/js/ui/event-handlers.js`: Options-modal toggle binding and initial state synchronisation.
