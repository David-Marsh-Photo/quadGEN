# Auto-Raise Ink Limits on Import

## Feature Overview
Auto-raise preserves the shape of imported corrections by lifting channel ink limits just enough to match the requested output. When a LAB/CGATS/manual dataset, recompute, or `.quad` rebake asks for more ink than a channel’s current **End** allows, quadGEN can increase the limit automatically instead of clipping the curve to a flat plateau.

## Operator Workflow
- Toggle the behaviour from ⚙️ Options → **Auto-raise ink limits after import** (defaults to **off** so studios control when headroom can move).
- Load a correction source. If any channel needs more ink than its End permits, quadGEN:
  1. Raises the affected End to the minimum value that clears the peak (respecting 100 % / 65535 clamps).
  2. Emits a status toast (`Raised PK ink limit to 64% (correction import)`), updates the channel table, and keeps Smart point outputs steady by rescaling them against the new limit.
  3. Records the change in history so a single Undo restores both the correction and the previous End values.
- Locked channels, disabled channels, or policy guards block auto-raise; the correction remains clipped and the status toast explains why.

## Implementation Details
- The feature flag lives in persisted app settings (`autoRaiseInkLimitsOnImport`). Runtime helpers (and dev console toggles) read from `FeatureFlags.autoRaiseInkLimitsOnImport`.
- After each correction load finishes smoothing, the pipeline samples all 256 points and asks `ensureInkLimitForAbsoluteTarget()` to validate maximum ink levels per channel.
- `ensureInkLimitForAbsoluteTarget()`:
  - Skips work when the channel is locked or when the measured peak stays within `currentEnd` + epsilon (0.05 %).
  - Computes the minimal required End, clamps it, rescales existing Smart key points so their absolute outputs stay constant, and refreshes `printerManager` baselines for global scaling.
  - Returns metadata that the caller batches into a single history entry and toast payload.
- Composite/debug caches, spot markers, and previews invalidate automatically after the End update so downstream views reflect the new ceiling.

## Safeguards
- Raises never exceed 100 % (65 535 in absolute units) and honour channel lock state.
- Undo/Redo works because the auto-raise call is captured inside the same history transaction as the correction import.
- Telemetry funnels (`compositeCoverageSummary`) track why channels raised so QA can spot repeated headroom adjustments.

## Validation
- Vitest coverage (`tests/core/auto-raise-default-flag.test.js`) confirms flag defaults and guard rails.
- Existing ink-limit integration suites exercise drag-past-limit and auto-raise flows; Playwright smoke ensures no console errors when toggling the feature.
- Manual regression matrix (`docs/manual_tests.md`) includes the “auto-raise off by default” check plus verification that status toasts appear and Undo restores the previous End.
