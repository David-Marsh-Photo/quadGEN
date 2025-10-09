# QUADGEN_DATA_TYPES.md

Data type classifications and processing rules for quadGEN.

## Data Type Reference and Processing Rules

### Overview

quadGEN processes multiple data types with different characteristics and processing requirements. This reference defines how each data type should be handled to prevent data corruption and maintain consistent behavior.

All parsed data objects now include a `sourceSpace` field that records whether their samples live in printer space (`printer`) or image space (`image`). Loaders convert image-space datasets to printer space through the shared `DataSpace` helper before they are consumed by interpolation, Smart seeding, or curve generation.

### Data Type Classifications

#### 1. Loaded .quad Files (Complete Curves)
```javascript
// Storage: window.loadedQuadData.curves[channelName]
{
  source: "QuadToneRIP .quad file",
  pointCount: 256,
  valueRange: "0-65535 (QuadToneRIP range)",
  sourceSpace: "printer",
  treatment: "DIRECT_USE", // Use exactly as-is, no scaling
  processingStage: "BASE_CURVE",
  scalingBehavior: "NEVER_SCALE", // Critical: these are final values
  interpolationNeeds: "NONE", // Already complete curves
  uiRepresentation: "File info panel + curve preview",
  processingPriority: 1, // Applied first as base
  notes: "Complete 256-point channel response curves. These represent the final output and should NEVER be scaled or interpolated."
}
```

#### 2. Smart Curves (Complete Curves)
```javascript
// Storage: window.loadedQuadData.curves[channelName] (same as .quad)
{
  source: "Smart Curve generation",
  pointCount: 256,
  valueRange: "0-65535 (scaled to endValue)",
  sourceSpace: "printer",
  treatment: "DIRECT_USE", // Pre-generated complete curves
  processingStage: "BASE_CURVE",
  scalingBehavior: "PRE_SCALED", // Already scaled during generation
  interpolationNeeds: "NONE", // Generated with PCHIP interpolation
  uiRepresentation: "Processing detail: 'Smart Curve (256 points)'",
  processingPriority: 1, // Applied first as base
  notes: "Generated from Smart key points using PCHIP interpolation to create complete 256‑point curves."
}
```

#### 3. LAB Measurement Data (Key Points)
```javascript
// Storage: linearizationData or perChannelLinearization[channelName]
{
  source: "L* lightness measurements (ColorMuse/manual)",
  pointCount: "Variable (typically 21)",
  valueRange: "0-100 (L* lightness values)",
  sourceSpace: "printer",
  treatment: "INTERPOLATE_AND_SMOOTH", // Requires processing
  processingStage: "LINEARIZATION_LAYER",
  scalingBehavior: "DOMAIN_SCALE", // Scale to 0-1 domain
  interpolationNeeds: "REQUIRED", // Use PCHIP or user-selected method
  uiRepresentation: "File load + smoothing controls",
  processingPriority: 2, // Applied after base curves
  notes: "Measurement data represents key sampling points that need interpolation to create smooth correction curves."
}
```

#### 4. LUT Files (.cube) - 1D and 3D
```javascript
// Storage: linearizationData or perChannelLinearization[channelName]
{
  source: "1D/3D LUT .cube files",
  pointCount: "Variable - 1D: (often 33, 65, 256), 3D: (256 extracted points)",
  valueRange: "0.0-1.0 (normalized)",
  sourceSpace: "printer", // Converted from image space via DataSpace helper
  treatment: "INTERPOLATE_AND_SMOOTH", // Requires processing
  processingStage: "LINEARIZATION_LAYER",
  scalingBehavior: "DOMAIN_SCALE", // Already normalized
  interpolationNeeds: "REQUIRED", // Use PCHIP or user-selected method
  uiRepresentation: "File load + smoothing controls",
  processingPriority: 2, // Applied after base curves
  notes: "Professional LUT data - 1D LUTs used directly, 3D LUTs have neutral axis (R=G=B diagonal) extracted via trilinear interpolation to create 256-point correction curves."
}
```

#### 5. Adobe Curve Files (.acv)
```javascript
// Storage: linearizationData or perChannelLinearization[channelName]
{
  source: "Adobe Photoshop curve files",
  pointCount: "Variable (typically 2-16 key points)",
  valueRange: "0-255 (8-bit values)",
  sourceSpace: "printer", // ACV anchors converted through DataSpace helper
  treatment: "INTERPOLATE_AND_SMOOTH", // Requires processing
  processingStage: "LINEARIZATION_LAYER",
  scalingBehavior: "RANGE_CONVERT", // Convert 0-255 to 0-1 domain
  interpolationNeeds: "REQUIRED", // Use PCHIP or user-selected method
  uiRepresentation: "File load + smoothing controls",
  processingPriority: 2, // Applied after base curves
  notes: "Photoshop curve anchor points that define tone adjustments. Always requires interpolation."
}
```

#### 6. Linear Ramps (Generated)
```javascript
// Storage: Generated in make256() function
{
  source: "Programmatically generated",
  pointCount: 256,
  valueRange: "0-endValue (scaled to channel limit)",
  sourceSpace: "printer",
  treatment: "DIRECT_USE", // Complete curves
  processingStage: "BASE_CURVE",
  scalingBehavior: "SCALED_TO_END", // Scaled to channel's endValue
  interpolationNeeds: "NONE", // Perfect linear progression
  uiRepresentation: "Default state (no file loaded)",
  processingPriority: 1, // Fallback when no other base curve exists
  notes: "Default linear progression when no curve data is loaded. Generated as: value[i] = i * (endValue / 255)."
}
```

### Processing Pipeline Rules

#### Stage 1: Base Curve (Priority 1)
1. **Loaded .quad data** → Uniform scaling by currentEnd/baselineEnd (baseline captured on .quad load)
2. **Smart Curves** → Scaled to channel End (ink limit)
3. **Linear ramps** → Generated and scaled to channel End

#### Stage 2: Linearization Layers (Priority 2)
1. **Per-channel corrections** → Apply with interpolation
2. **Global corrections** → Apply with interpolation

## Key Functions and Data Structures

### Core Processing Functions

**`make256(channelName, isQuadData)`**: Generates final 256-point curve
- Applies all processing layers in correct order
- Handles loaded .quad data (scaled uniformly by currentEnd/baselineEnd), Smart Curves (scaled to channel End), and linear ramps (scaled to End)
- Returns curve scaled to 0-65535 range for QuadToneRIP

Edit Mode × Linearization interplay (recent fixes):
- Global linearization now applies even when Smart points exist (Edit Mode ON). Previously, a Smart-curve guard skipped global application.
- Recompute (Edit panel) always samples from the currently plotted curve via `make256(end, ch, true)` so Smart points align with any active global/per-channel corrections and End.
- Double-apply guard: When Smart points are recomputed while a global correction is active, we tag `keyPointsMeta[channel].bakedGlobal = true`. `make256()` checks this and avoids applying the global correction a second time on top of the recomputed Smart curve.
- Linear detector tightened: "near-linear" collapse threshold reduced (0.5%→0.2%, sampled at 11 positions) to prevent lightly corrected curves from collapsing to endpoints during simplification.
- Smart‑source guard: Plotting skips global re‑application for channels whose source is `smart` (treated as already baked), preventing double scaling when toggling Edit Mode OFF/ON even if `bakedGlobal` metadata is missing.
- Per‑channel application guard: Skip per‑channel linearization only when a Smart curve is actually applied (source tag `smart`), not merely because Smart key points exist for overlay. This preserves the plotted curve when Edit Mode primes key points without applying a Smart curve.
- Metadata preservation: `ControlPoints.persist()` preserves existing `keyPointsMeta` (e.g., `bakedGlobal`) when updating interpolation; undo/redo restores `bakedGlobal` alongside interpolation so plots and overlays stay aligned across history operations.
- Ordinal overlay stability: When priming Edit Mode for disabled channels (End=0), sample Smart key‑point outputs at full scale (End=TOTAL) so stored pre‑scale outputs are valid. The overlay renderer also samples Y from the plotted curve when a key point lacks an explicit output, preventing collapsed labels at the X‑axis.
- Revert behavior: Global/Per‑channel Revert clears any lingering Smart source tags and preserves the current Edit selection (if still enabled) so the post‑revert overlays/labels and colors reflect the intended channel instead of defaulting to MK.

LUT → Smart key‑point seeding:
- On first edit, if LUT data is present (global or per‑channel), seed Smart key points from LUT samples.
- Direct‑seed threshold: If sample count ≤ DIRECT_SEED_MAX_POINTS (default: 25), seed samples directly at even X. Otherwise, derive a compact set via the adaptive simplifier (defaults: 0.25% max error, 21 max points).

Direct‑seed threshold (all sources):
- Variable: `DIRECT_SEED_MAX_POINTS` (default: 25)
- ACV: If number of anchors ≤ threshold, seed ACV anchors as AI points; otherwise simplify from the plotted curve.
- LAB/Manual L*: If number of original measurements ≤ threshold, seed at measured Patch % positions by sampling the plotted (current) curve for Y; otherwise simplify from the plotted curve.
- LUT: See above (≤ threshold = direct; > threshold = simplify).

LAB Gaussian‑weighted reconstruction (local bandwidth):
- parseLabData(fileContent):
  - Reads measured Patch % and L*; computes correctionPoints where correction = expectedDensity(x) − actualDensity(L*).
  - Reconstructs a continuous correction via Gaussian kernel regression with a local bandwidth σ(x) derived from the median distance to the K nearest measured positions (K≈6), clamped to [0.02, 0.15], with α≈3. Endpoints are anchored. Returns `{ domainMin:0, domainMax:1, samples, originalData, format:'LAB Data', getSmoothingControlPoints }`.
  - `getSmoothingControlPoints(smoothingPercent)`: widens σ(x) by a factor (1+%/100) and returns evenly spaced control points `{ samples, xCoords }` for apply1DLUT.
  - Rationale: Robust to uneven spacing and dense/noisy datasets; avoids spline oscillations and preserves monotonic shape with PCHIP.

LAB → Smart conversion preserves plotted shape:
- On first edit, extract Smart key points from the current plotted 256‑sample curve (respecting interpolation + smoothing). Use the configurable key‑point simplifier (defaults: 0.25% max error, 21 max points) to make an editable, faithful curve.
- Benefits: Visually identical handoff pre/post conversion; no path shifts between adjacent anchors.

**`parseQuadFile(content)`**: Parses .quad file format
- Extracts QuadToneRIP header: `## QuadToneRIP K,C,M,Y,LC,LM,LK,LLK`
- Validates 256 data points per channel (0-65535 range)
- Returns structured data with channel curves and metadata

**`_pchipInterpolate(x, y, xi)`**: PCHIP implementation
- Monotonic interpolation preserving curve characteristics
- Used for all Smart Curves
- Critical: Do not replace with other interpolation methods

**Smoothing Control**:
- LAB/LUT processing uses an adaptive Gaussian reconstruction (defaults to 50 % ≈1.5× widen). The Options panel exposes a 0–300 % slider that feeds the same kernel; values persist across sessions.
- Fidelity is still governed by Recompute (Max error %, Max points) for Smart curves. To iterate from measurement, use the Revert buttons (global/per‑channel) then Recompute, adjusting smoothing if needed.

**EDN Intent + ACV/LUT Parity**
- Problem: ACV curves loaded from EDN did not match 1D LUTs at midtones; .acv path missed the orientation transforms applied in the .cube path. Print Intent toggle did not refresh the effective mapping.
- Solution: Apply the same orientation to .acv as .cube (horizontal flip + vertical inversion for positive-domain EDN data). Store positive-domain base samples and recompute effective samples on Print Intent changes for global and per-channel EDN-style corrections.
- Impact: ACV vs LUT curves now match closely (e.g., ~40% ink at 50% input), and toggling intent updates the graph/preview immediately.

**Measurement Traceability (LAB data)**
- LAB measurement imports now record the current Print Intent as "measured: Positive/Negative" in the UI details and in .quad comments.
- Changing Print Intent later does not modify LAB data (printer-space). If intent changes, reprint and remeasure to maintain pipeline consistency.
- Intent mismatch warning: When the current Print Intent differs from a loaded LAB dataset's recorded measurement intent, the UI shows a small warning banner to prompt reprint/remeasure or switching intent.
