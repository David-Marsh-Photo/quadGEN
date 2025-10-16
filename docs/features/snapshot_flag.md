# Snapshot Flagging Plan

## Goal
Detect snapshots where ink levels exhibit abrupt, visually “unsmooth” changes so operators can spot suspect correction data quickly. Each qualifying snapshot should carry a `flagged` status and render with a red flag marker on the canvas.

## Detection Criteria
- **Metric**: Absolute delta in effective ink percent between consecutive snapshots (post-scaling, per channel).  
- **Threshold**: Initial cutoff of ≥7 percentage points. This sits in the middle of the 6–8 % range that reads as an obvious step on the current charts and stays above routine noise from smoothing or redistribution hand-offs.  
- **Scope**: Evaluate every active channel; snapshots flagged when any channel exceeds the threshold.  
- **Future tuning**: Keep room to add derivative/second-derivative checks or multi-sample windows if noisy datasets create false positives.

## Data Model
- Extend composite snapshot state (see `src/js/core/composite-debug.js`) with a `flags` map keyed by snapshot index.  
- Each flag entry stores `{ channels: string[], magnitude: number, kind: 'rise' | 'drop' }` to describe the trigger.  
- Persist flags through history captures (`CurveHistory.captureState`), undo/redo, and composite reseeds.

## Processing Pipeline
1. Hook into the composite snapshot generation path after per-channel ink values are finalized.  
2. For each snapshot/index pair, compare ink levels with the previous snapshot.  
3. Record a `drop` or `rise` flag when the absolute delta ≥7 % and stash the metadata.  
4. Expose helper selectors (`getSnapshotFlags()`, `isSnapshotFlagged(index)`) for UI layers and tests.

## UI Rendering
- **Chart marker**: Update `chart-manager` to draw a red flag emoji (📍 substitute if emoji rendering fails) at the flagged sample’s X position. Respect zoom/device pixel ratio so the icon stays crisp.  
- **Tooltip**: Add accessible tooltip text reporting channel(s) and delta magnitude.  
- **Debug panel**: Surface a “Flagged snapshots” list in the composite debug overlay with quick-jump buttons to center the chart on the snapshot.

## Implementation Notes
- Chart rendering draws the flag directly on the canvas and mirrors it in an absolute-positioned overlay (`#snapshotFlagOverlay`) so hover tooltips and automated tests can target individual snapshots. Each marker carries `data-flagged-snapshot="<index>"` and exposes the max delta plus impacted channels in the tooltip.
- Composite Debug panel now includes a **Flagged snapshots** capsule that lists every flagged index (rise/drop arrows plus magnitude). Clicking a badge jumps the selection to that snapshot and highlights it with a 🚩 suffix in the panel header.
- Debug helpers expose `chartDebug.getFlaggedSnapshots()` and `compositeDebug.getFlaggedSnapshots()` so scripts/tests can assert flag positions without scraping the canvas.
- Snapshot metadata bundles store `snapshotFlags` alongside snapshots; undo/redo/history playback reuse the same payload so flags survive navigation.

## Documentation Updates
- Add a Glossary entry (“Flagged snapshot”) describing the red flag marker and the 7 % threshold.  
- Extend `docs/manual_tests.md` with steps to confirm flag rendering and tooltip accuracy.  
- Note the feature in `CHANGELOG.md` (Unreleased) and Help → Version History once implemented.

## Testing Strategy
- **Unit tests**: Feed synthetic channel data through the detection helper to ensure flags fire at ≥7 % deltas and remain quiet for smooth curves.  
- **Playwright**: Load a curated dataset that includes a sharp drop, verify the flag icon appears on-canvas, and assert tooltip content through DOM evaluation.  
- **Regression gate**: Run `npm run build:agent`, `npm run test:smoke`, and the new Playwright spec as part of the verification checklist.

## Open Questions (Guidance)
- **Multiple channels spiking**: Treat simultaneous spikes as a single flag. Capture all affected channels in the metadata so one red marker carries a tooltip listing every channel and its delta.
- **Threshold configurability**: Ship with the fixed 7 % cutoff. Revisit configurability only if operator feedback suggests the default is noisy or too conservative. If added later, bound user input (e.g., 3–15 %) and surface it in ⚙️ Options.
- **Auto-raise transients**: Skip flagging snapshots generated while the auto-raise pipeline is actively recalculating. Once the pass completes, recompute flags on the stabilized data so only steady-state spikes trigger markers.
