# Global Correction Loader Specification

## Purpose
- Define ingestion behavior for `.quad`, `.cube` (LUT), `.acv` (Photoshop curves), and related overlay formats loaded via the Global Correction panel.
- Ensure overlays, Smart seeding, and undo integrate consistently regardless of file type.

## User-Facing Entry Points
- Global Corrections → `Load Data File` (accepts `.quad`, `.cube`, `.acv`).
- Lab Tech commands: `load_quad_file`, `load_lut_file`, `load_acv_file` (future expansions).

## Core State & Helpers
- Parsers: `src/js/parsers/file-parsers.js`, `src/js/data/quad-parser.js`, LUT/ACV helpers under `src/js/data/`.
- State integration: `setLoadedQuadData`, overlay registries in `src/js/ui/chart-renderer.js`.
- History: `history.recordGlobalLoad`.

## Expected Behavior
1. **.quad Files**
   - Parse ink curves, metadata, channel list; store raw curves in `loadedQuadData.curves`, keep immutable copy in `originalCurves` and `originalCurvesBaseline`.
   - Capture ink limit baselines for global scale, auto limit, and revert integration.
   - Seed Smart curves from `.quad` data on first Edit Mode activation.
   - Update filename label, channel table, and revert/intent button states.

2. **.cube LUT (1D/3D)**
   - Normalize orientation, map to printer-space samples, convert per-channel curves, and store as overlays (read-only) while keeping `.quad` base intact.
   - Provide smoothing control points when sample counts ≤25 (for Smart seeding).
   - Metadata notes LUT size, orientation, and anchoring flags; undo reverts overlay application.
   - Baking a LUT into the baseline samples the correction once and caches the rebased curve so repeated redraws maintain the expected peak ink (e.g., 87 % for `negative.cube`).

3. **.acv Curves**
   - Parse Photoshop curve anchors; when ≤25 anchors, seed Smart points directly; otherwise simplify plotted curve.
   - File can be global or per-channel; UI labels the source accordingly.

4. **General UI Updates**
   - Chart overlays display as dimmed markers (no ordinal labels when Smart points exist).
   - Status toasts confirm load success; errors flagged with descriptive messages.
   - After any correction is applied, `rebaseChannelsToCorrectedCurves` updates the channel table so the visible percent and End fields match the corrected maxima (`make256` peak) instead of the original `.quad` baseline. The stored baselines (`loadedQuadData.baselineEnd`) and rebased curves mirror those effective values for exports and undo.

5. **Global Baked State**
   - When global data is rebased (e.g., `.cube`, LAB, manual table), the processing detail row switches to “Global (baked)” and records the originating filename/reason. This prevents the correction from double-applying on subsequent redraws and signals to operators that the baseline now includes the correction.
   - History snapshots label the state transition (`CurveHistory.captureState('After: Load Global Linearization (rebased)')`) so undo returns to the pre-baked curves, including original ink limits.

## Edge Cases & Guards
- Non-grayscale channels: warn and ignore unsupported ones; maintain channel ordering consistent with current printer profile.
- Incomplete data: fall back to linear ramp, inform user via status toast.
- Loading new `.quad` clears measurement state, history, and Smart metadata; user confirmation may be required (future enhancement).

## Testing
- Manual matrix: load each format, verify overlays, Smart seeding, and Undo behavior.
- Scripts: `scripts/compare_quad_versions.py` validates parsing accuracy (internal tooling).

## Debugging Aids
- `DEBUG_LOGS` outputs parser context, sample counts, and overlay metadata.
- Developer tools: `window.getLoadedQuadData()` to inspect curves, overlays, filenames.

## References
- Apply intent spec: `docs/features/apply-intent-to-quad.md`.
- Revert spec: `docs/features/revert-controls.md`.
