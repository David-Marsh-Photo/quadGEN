# Post-Pass Slope Limiter

## Purpose
Blend abrupt per-channel jumps that slip through composite allocation guards by capping the frame-to-frame delta after redistribution finishes. The limiter rides on the same 7 % “unsmooth” threshold used by snapshot flagging, so any segment that would have raised a 🚩 now gets eased into a gradual ramp instead.

## Implementation Overview
- **Hook timing**: Runs after redistribution completes but before coverage summaries are recomputed and the debug payload is cached. This means the limited curves feed every downstream consumer: chart rendering, composite debug snapshots, coverage audits, and history playback.
- **Algorithm**: For each active channel the raw curve is normalized, passed through a symmetric two-pass Lipschitz filter (forward/backward) that enforces `|Δ| ≤ threshold`, then remapped to absolute ink values. The pass never touches disabled/zero-length curves and clamps results to [0, 1].
- **Snapshot sync**: When debug capture is enabled we rewite `normalizedAfter`, `correctedValue`, `valueDelta`, density shares, and aggregate ink totals so the overlay and tooling reflect the limited curves. Cached maxima in the debug summary update at the same time.
- **Guards**: The limiter skips runs while auto-raise is still evaluating, avoids channels without end values, and leaves series shorter than two samples untouched. Existing `computeSnapshotFlags` runs on the post-limiter data, wiping any previous flag counts when the spikes disappear.

## Data & State Impacts
- No new session fields; the limiter edits the in-memory `correctedCurves` object and any captured snapshots before they’re stored.
- Coverage usage and summaries are rebuilt immediately after the curves change, keeping capacity numbers in sync with the smoothed ink.
- Undo/redo automatically reapply the limiter because the composite pass replays in full each time.

## Testing
- **Unit**: `tests/core/slope-limiter.test.js` feeds synthetic rise/drop scenarios through `applySnapshotSlopeLimiter` and validates both slope enforcement and snapshot resynchronization.
- **Integration**: `tests/lab/composite-slope-limiter.test.js` runs the composite pipeline against `P800_K36C26LK25_V6` and asserts that no snapshot flags remain.
- **Unit (kernel)**: `tests/core/slope-kernel.test.js` verifies that Gaussian smoothing preserves endpoints, respects monotonicity, and bails out when debug metadata marks a region as locked.
- **Integration (kernel)**: `tests/lab/composite-slope-kernel.test.js` enables the feature flag for the P800 dataset and inspects the eased roll-off deltas to ensure the mid-window slope is higher than the shoulders without exceeding the 7 % ceiling.
- **Regression Gate**: Standard build + smoke remains the release gate (`npm run build:agent`, `npm run test:smoke`), alongside the new unit and lab tests above.

## Kernel Smoothing (feature flag)
- **Scope**: `applySnapshotSlopeKernel` runs before the linear limiter when `slopeKernelSmoothing` is enabled. It only activates once auto-raise completes and normalizes the curve into [0, 1] so the kernel can work in normalized space.
- **Detection**: The helper scans for deltas exceeding the shared 7 % threshold, merges adjacent spikes, and grows a window up to ±6 samples around the region (clamped by available data). Runs that park within ≈95 % of the guard for three or more samples now count as smoothing candidates so the staircase cases in the highlights get resurfaced.
- **Kernel**: Each window is rebuilt with a symmetric Gaussian weight profile (cosine fallback) that preserves the original endpoints while concentrating the slope change near the center. The total change equals the original drop/rise so ink totals stay intact.
- **Guards**: The window is skipped if debug metadata marks any sample as locked (`blendLimited`, exhausted reserve, zero headroom, disabled channel, or active blend clamps). Post-pass validation enforces monotonicity with a two-iteration cap; residual spikes fall back to the linear limiter.
- **Telemetry**: When `DEBUG_LOGS` is true, the helper reports skipped windows and rejected residuals under the `[SLOPE_KERNEL]` tag.

### Activation & Rollback
- Runtime toggle: `setSlopeKernelSmoothingEnabled(true | false)` (paired `isSlopeKernelSmoothingEnabled()`), exposed on `window` and the `featureFlags` debug namespace. The smoother now starts **enabled**.
- Headless tooling: set `QUADGEN_ENABLE_SLOPE_KERNEL=0` (or `false`) before running `scripts/capture-composite-debug.mjs` to force-disable the smoother in offline analysis; omit the variable to run with the default-on state.
- Default is now **enabled**; removing the feature is still a two-line change (remove the import/call) because all data wiring reuses the limiter’s sync path.

### Multi-pass Curved Roll-off
- **Goal**: eliminate the linear 7 % staircase entirely by widening the smoothing window, blending its anchors, and cascading lower-threshold passes while still respecting blend/reserve guards. The linear limiter remains a safety net only when residual spikes survive the kernel.
- **Window selection**:
  - Detect the dominant overshoot as today, but expand the window to cover ±10 samples (clamped to array bounds).
  - Permit the start/end anchors to move inward (blend 25 % toward the nearest unlocked neighbour) so the first delta can drop below the guard.
  - Stop expansion at the first locked sample (blend cap, exhausted reserve, zero headroom, disabled channel); record the reason for telemetry.
- **Pass cascade**:
  1. Pass A uses the existing 7 % threshold to keep the first reshaping safe.
  2. Pass B immediately re-runs on the same window with a synthetic `targetThreshold = min(guard * 0.6, 0.04)` to smear the residual slope into a curved ramp.
  - Each pass reuses the same kernel weights but rebalances them after anchor adjustments; we keep per-pass deltas so DEBUG logs can report how much each pass reduced the peak.
- **Limiter safety**:
  - After Pass B, scan the window. If any delta still exceeds the real guard, the helper runs another kernel pass that clamps just the window endpoints (and, if needed, the immediately-adjacent samples) before falling back to the linear limiter. `[SLOPE_KERNEL] fallback` only fires when the extra pass still fails.
  - Otherwise the limiter step is skipped for the smoothed channel so we preserve the curved profile.
- **State sync**:
  - `normalizedSeriesByChannel` remains populated so `syncSnapshotsWithSlopeLimiter` refreshes the debug payload alongside density totals.
  - Telemetry lives in `window.getSlopeKernelStats?.()` (`guardThreshold`, per-channel windows, passes applied, delta before/after, fallback flags).
- **Testing**:
  - **Unit**
    - `tests/core/slope-kernel.test.js` covers widened windows, anchor blending, two-pass progression, and limiter fallback when locks block smoothing.
  - **Integration**
    - `tests/lab/composite-slope-kernel.test.js` validates hard roll-offs with tails tapering below 0.02 while staying ≤7 % overall, plus blend-cap fixtures that force fallbacks.
  - **Playwright (visual)**
    - Optional headful capture (`tests/e2e/composite-flagged-snapshots.spec.ts`) can snapshot the curved highlight to compare against the legacy staircase baseline.

## Future Considerations
- **Configurability**: Threshold still tracks `SNAPSHOT_FLAG_THRESHOLD_PERCENT`; we can layer a dedicated UI control if operators need to widen/narrow the kernel window.
- **Diagnostics**: Extend the debug namespace with explicit kernel stats (window span, peak delta) if field reports surface edge cases that need deeper tracing.
