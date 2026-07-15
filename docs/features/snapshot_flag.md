# Snapshot Flag Detection

## Goal
Detect snapshots where ink levels exhibit abrupt, visually unsmooth changes so solver checks can identify suspect correction data.

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

## Implementation Notes
- Detection remains an internal solver diagnostic; the dormant chart marker and composite debug panel were removed in July 2026.
- `compositeDebug.getFlaggedSnapshots()` exposes the latest internal flag metadata for focused diagnostics.
- Snapshot metadata bundles store `snapshotFlags` alongside snapshots; undo/redo/history playback reuse the same payload so flags survive navigation.

## Testing Strategy
- **Unit tests**: Feed synthetic channel data through the detection helper to ensure flags fire at ≥7 % deltas and remain quiet for smooth curves.  
- **Solver regression**: Verify retained composite curves remain below the 7 % slope guard.

## Open Questions (Guidance)
- **Multiple channels spiking**: Treat simultaneous spikes as a single flag. Capture all affected channels in the metadata so one red marker carries a tooltip listing every channel and its delta.
- **Threshold configurability**: Ship with the fixed 7 % cutoff. Revisit configurability only if operator feedback suggests the default is noisy or too conservative. If added later, bound user input (e.g., 3–15 %) and surface it in ⚙️ Options.
- **Auto-raise transients**: Skip flagging snapshots generated while the auto-raise pipeline is actively recalculating. Once the pass completes, recompute flags on the stabilized data so only steady-state spikes trigger markers.
