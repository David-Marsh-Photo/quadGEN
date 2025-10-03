# Smart Curve Engine Specification

## Purpose
- Provide a consistent API for generating, editing, and persisting Smart key points derived from any curve source (LAB, manual, .quad, LUT, ACV).
- Ensure Edit Mode, Lab Tech commands, and internal recompute flows share the same data structures and history semantics.

## User-Facing Entry Points
- Edit Mode UI (click/drag, XY input, nudge buttons, insert/delete actions).
- Lab Tech commands: `set_smart_key_points`, `adjust_smart_key_point_by_index`, `insert_smart_key_point_at`, `simplify_smart_key_points_from_curve`, etc.
- Recompute button in Edit Mode panel.

## Core Modules
- `src/js/curves/smart-curves.js` – ControlPoints management, PCHIP sampling, metadata, history wiring.
- `src/js/ui/edit-mode.js` – selection state, seeding, UI refresh.
- `src/js/core/history-manager.js` – channel action logging for undo/redo.

## Key Components
1. **ControlPoints Facade**
   - `ControlPoints.get(channel)` → { points (relative), interpolation }.
   - `ControlPoints.normalize(points)` clamps, sorts, enforces min gap.
   - Persisted in `loadedQuadData.keyPoints` as relative outputs (0–100) scaled against channel End during sampling.

2. **Set / Insert / Adjust / Delete**
   - `setSmartKeyPoints(channel, points, interpolation, options)` validates, applies, samples new 256-value curve, updates metadata (`keyPointsMeta`), triggers chart/UI refresh, and records history unless `skipHistory`.
   - Insertion/adjustment functions convert requested absolute outputs to relative values, handle End raising, and maintain selection ordinals.

3. **Simplification (Recompute)**
   - `extractAdaptiveKeyPointsFromValues` uses RDP simplification (configurable error max and point cap) to fit the plotted curve.
   - `simplifySmartKeyPointsFromCurve` calls `make256`, rebuilds relative points, and tags metadata (`bakedGlobal`, auto-limit flags) when global corrections or auto limits were active.

4. **Metadata Preservation**
   - `keyPointsMeta[channel]` stores interpolation type, `smartTouched` flag, and baked markers (`bakedGlobal`, `bakedAutoWhite`, `bakedAutoBlack`).
   - Undo/redo restores both key points and metadata so Edit Mode overlay stays accurate.

5. **Seeding Logic**
   - On first edit, Smart points seeded from source curve: direct mapping when ≤25 points, otherwise simplified sample of plotted curve.
   - Measurement seeds stored for revert; `ControlPoints.persist()` invoked without immediate UI refresh when needed.

6. **Global Scale Integration**
   - `rescaleSmartCurveForInkLimit(channel, fromPercent, toPercent, { mode })` handles End changes. `preserveRelative` mode keeps stored relative outputs (used when global scale reapplies), `preserveAbsolute` multiplies relative outputs (used when raised via key-point edit).

## Edge Cases & Constraints
- Minimum X gap (`ControlPolicy.minGap`) enforced on set/insert/adjust; blocking errors returned to UI.
- End=0 or disabled channels skip Smart operations unless explicitly allowed.
- Attempting to edit when Edit Mode is off returns guard errors unless `allowWhenEditModeOff` is set (used for global scale reapply).
- Metadata accuracy critical for double-apply guard (prevents global correction from reapplying over baked Smart curves).

## Testing
- Playwright: `tests/e2e/edit-mode-keypoint-scaling.spec.ts`, recompute regression, insertion accuracy with low ink limits.
- Manual matrix: `docs/manual_tests.md` → Smart curves section (insert/move/delete, recompute, undo/redo).

## Debugging Aids
- `window.ControlPoints` exposes get/normalize for quick inspection.
- `DEBUG_LOGS` prints key-point operations, sample values, metadata annotation details.
- `registerDebugNamespace('smartCurves', …)` allows manual invocation in dev builds.

## References
- Edit Mode spec: `docs/features/edit-mode.md`.
- Auto-limit rolloff spec: `docs/features/auto-limit-rolloff.md` (metadata interplay).
- Global scale spec: `docs/features/global-scale.md`.
