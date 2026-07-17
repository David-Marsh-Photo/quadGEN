# quadGEN Data Pipeline

PCHIP interpolation, LAB data lifecycle, linearization, and key-point editing.

## Data Processing Order (Critical for Debugging)

1. **Base curves** - Loaded .quad data OR linear ramps 0-65535
2. **Smart Curves** - Per-channel
3. **Per-channel linearization** corrections
4. **Global linearization** - System-wide effects
5. **Final 256-point output curves**

## PCHIP Interpolation (MANDATORY)

ALL smooth curve generation MUST use PCHIP (Piecewise Cubic Hermite Interpolating Polynomial):
- Prevents overshooting
- Maintains monotonic curves
- **Never** use smoothstep, cosine, Catmull-Rom, or cubic splines
- Missing, unknown, or legacy Cubic/Catmull interpolation labels normalize to PCHIP at the processing boundary
- Explicit Linear interpolation is the only supported technical exception

### Helper Function
`buildInkInterpolatorFromMeasurements(points, options)` centralizes the inversion pipeline:
- Input: points with `input` (0–100) and `lab` (L* 0–100)
- Returns: `{ evaluate(t), createEvaluator(widenFactor), positions }`
- `evaluate` consumes normalized input 0–1, yields normalized ink

Options:
- `neighbors=4`, `sigmaFloor=0.036`, `sigmaCeil=0.30`, `sigmaAlpha=2.0`
- LAB smoothing slider: `widenFactor = 1 + (percent/600) × 3` (range [1.0, 4.0])

## LAB Data Lifecycle & State Management

### Correction Import Atomicity

- Global and per-channel correction files must report parser success and pass
  shared validation before history capture or any state, curve, baseline, cache,
  or UI mutation.
- Imported corrections require at least two finite samples, a finite ascending
  domain, and a recognized source space.
- Rejecting an invalid file preserves the active correction and its history/UI
  state; only the file input is reset and an error status is reported.

### Data Flow
1. **Load .quad**: `baselineEnd` captured, `originalCurves` stored
2. **Load LAB**: `linearizationData` set, `linearizationApplied = true`
3. **Edit Mode**: Smart Curves generated from LAB-corrected data
4. **Revert**: remove Smart/edited/baked state, restore the measurement-derived curves and baselines, and keep the loaded measurement applied

### Revert Operation (Critical)
```javascript
// CORRECT revert workflow:
linearizationData.edited = false;   // Mark the loaded measurement clean
linearizationApplied = true;        // Keep the measurement correction enabled
// Clear Smart/baked state, restore measurement-derived curves and baselines,
// then reapply the canonical global scale.

// WRONG - unloads the measurement instead of reverting edits:
linearizationData = null;
linearizationApplied = false;
```

### Debugging Revert Issues
With `DEBUG_LOGS = true`, look for:
- `[DEBUG REVERT] Button clicked:` - confirms revert triggered
- `[DEBUG REVERT] Smart points restored during global revert` - confirms editable state reset
- `[DEBUG REVERT] Baselines restored for channels` - confirms measurement baselines restored

## Key-Point Editing

### Defaults
- "point N" means Smart key-point ordinal N (1-based, endpoints included)
- Channel selection: if unspecified, use first enabled channel
- Silent conversion: if no Smart key points exist, edit/insert/delete calls auto-create them

### Edit Semantics (Absolute Targets)
- `outputPercent` is absolute chart percent (post-End)
- If target exceeds current End, raise End minimally
- When End increases, scale other points by `oldScale/newScale` so their absolute values don't shift

### Ink Limit vs Key-Point Editing
- Key-point edits: absolute chart percent, may raise End
- Channel End edits: uniformly scale the entire curve

## Smart Curves Relative/Absolute Conversion

Control points stored as "relative" but presented as "absolute":
```javascript
relative = (absolute / channelPercent) * 100
absolute = (relative / 100) * channelPercent
```

Critical locations: `toRelativeOutput()`, `toAbsoluteOutput()`, `ControlPoints.normalize()`, `adjustSmartKeyPointByIndex()`, `setSmartKeyPoints()`, `insertSmartKeyPointAt()`

## Auto Endpoint Rolloff

Prevents early flat ceilings/floors caused by stacked intent + corrections near endpoints.

### Pipeline Stage
Applied in `make256()` after per-channel and global linearization, before returning 256 values.

### Detection
- Proximity: `epsY = max(1, round(0.03 * End))` (3% of End)
- Windows: scan last 20% (white), first 10% (black)
- Minimum knee width: ~5% of domain

### UI Controls
- `#autoWhiteLimitToggle` (default OFF)
- `#autoBlackLimitToggle` (default OFF)
- Assistant functions: `set_auto_white_limit(enabled)`, `set_auto_black_limit(enabled)`

## Print Intent & EDN/QTR

quadGEN applies all corrections in printer-space (.quad):
- **Positive (default)**: EDN-style LUT/.acv applied as-is
- **Negative**: EDN-style LUT/.acv applied inverted

LAB imports record the current Print Intent as "measured: Positive/Negative".

## Direct-Seed Threshold

`DIRECT_SEED_MAX_POINTS` (default: 25):
- Sources with ≤ 25 points: seed directly into Smart key points
- Above threshold: sample plotted curve and simplify to edit-friendly subset
