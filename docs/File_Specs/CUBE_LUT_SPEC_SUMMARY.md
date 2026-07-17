# .cube LUT – Developer Reference (for quadGEN)

Purpose
- Describe how quadGEN parses and uses .cube LUT files (1D and 3D) for linearization/correction.

Supported Variants
- 1D LUT (`LUT_1D_SIZE`, or a documented headerless 2–256-row form) – treated as a single-channel tone mapping.
- 3D LUT (.cube with `LUT_3D_SIZE`) – neutral axis extraction (R=G=B) via trilinear interpolation.

General Parsing Rules
- Lines starting with `#` are comments and ignored.
- One optional quoted `TITLE` declaration is ignored after validation. It and
  all size/domain declarations must precede the data table; malformed,
  duplicate, or late declarations are rejected.
- Data values are strict whitespace-separated finite floats. A malformed or
  non-finite component rejects the whole row; components are never filtered or
  shifted into a different column.
- DOMAIN handling (optional):
  - `DOMAIN_MIN` and `DOMAIN_MAX` each accept either one scalar or three RGB
    values. Both declarations must use matching arity.
  - Scalar domains are broadcast across RGB. Every declared component must be
    finite, and each maximum must be strictly greater than its corresponding
    minimum. Missing declarations default to `[0,0,0]` and `[1,1,1]`; invalid
    declarations are rejected rather than replaced.
  - 1D tone mapping uses the first component. 3D normalization uses all three
    components independently.

1D LUT Details
- Headers:
  - `LUT_1D_SIZE N` is optional but recommended. If present, the file must
    contain exactly `N` rows; short or long declarations are rejected.
  - Declared 1D LUTs must contain exactly 2–65,536 rows. The ambiguous
    headerless compatibility form is capped at 2–256 rows; 3D interpretation
    always requires an explicit `LUT_3D_SIZE` declaration.
  - Optional `DOMAIN_MIN/DOMAIN_MAX` (defaults to 0.0 / 1.0 when absent).
- Data lines:
  - Accepts 1–3 finite floats per line; the first value is used only after every
    supplied component passes validation.
  - Samples collected in order of appearance.
- Post-processing (printer-space orientation):
- Horizontal flip: reverse the input coordinate (index mapping i → 1−i scaled to index).
- Vertical inversion: sample value v → 1 − v.
- Monotonic interpolation: quadGEN resamples LUT values with a PCHIP interpolator so smooth, non-decreasing image-space curves stay monotonic after orientation.
- Output to quadGEN:
  - `{ domainMin, domainMax, domainMinRGB, domainMaxRGB, samples, originalSamples, format: '1D LUT' }`
  - `domainMin/domainMax` retain the first-component scalar contract used by
    the correction pipeline; the RGB fields preserve the complete declaration.
  - `samples` are normalized floats in [0,1].

3D LUT Details
- Headers:
  - `LUT_3D_SIZE N` is required and accepts sizes from 2–256.
  - Optional `DOMAIN_MIN/DOMAIN_MAX` (defaults to 0.0 / 1.0 when absent).
- Data lines:
  - Exactly 3 finite floats per line (R G B) – total lines must equal `N^3`.
  - Entries use standard CUBE red-fastest order: R changes fastest, then G,
    then B.
- Neutral axis extraction:
  - For 256 evenly spaced inputs t ∈ [0..1], form RGB=(t,t,t).
  - Use trilinear interpolation within the RGB cube to sample the LUT.
  - Convert to a neutral luminance by simple average: L = (R+G+B)/3.
- Post-processing (printer-space orientation):
  - Horizontal flip (reverse input coordinate) and vertical inversion (v → 1−v).
- Monotonic interpolation: the extracted neutral axis is resampled with the same PCHIP interpolator to avoid cubic overshoot when applying the correction to printer-space ramps.
- Output to quadGEN:
  - `{ domainMin, domainMax, domainMinRGB, domainMaxRGB, samples, is3DLUT: true, lutSize }`
  - Per-axis RGB domains are applied during trilinear evaluation; the scalar
    fields remain for downstream correction compatibility.
  - `samples` is a 256-length array of normalized floats.

Edge Handling & Validation
- Direct 3D parsing fails when `LUT_3D_SIZE` is missing. The public loader treats
  an undeclared 2–256-row `.cube` file as the supported headerless 1D form.
- A file cannot contain both 1D and 3D size declarations.
- 1D declarations are exact and accept 2–65,536 samples; headerless files are
  limited to 2–256 samples.
- 3D data must contain exactly `N³` rows.
- Duplicate size/domain declarations, malformed rows, non-finite values,
  mismatched domain arity, and non-ascending domain components are rejected.
- Lowercase declarations and headerless 1D files follow the same live loader
  path as uppercase declared files.

Implementation Notes
- Orientation transforms (flip + invert) align EDN-style LUTs to quadGEN’s printer-space coordinate system.
- 1D inputs that list RGB triplets are common; quadGEN uses the first column to build a neutral curve.
- 3D neutral-axis approach ignores hue and uses only the grayscale path for linearization.

2025‑09 Update (implementation detail)
- The printer‑space orientation is applied inside the 1D and 3D parsers. Global/per‑channel loaders no longer perform an additional reverse+invert step. This guarantees that Photoshop/EDN “lighten” mappings render as less‑ink (downward) corrections in quadGEN and avoids double‑application when importing multiple sources.

Minimal Valid Skeletons (that quadGEN will load)

1D LUT (.cube)
```
# Identity 1D LUT with 17 samples
TITLE "Example 1D"
LUT_1D_SIZE 17
DOMAIN_MIN 0.0
DOMAIN_MAX 1.0
0.0000
0.0625
0.1250
0.1875
0.2500
0.3125
0.3750
0.4375
0.5000
0.5625
0.6250
0.6875
0.7500
0.8125
0.8750
0.9375
1.0000
```

3D LUT (.cube)
```
# Identity 3D LUT with LUT_3D_SIZE 2 (8 RGB triplets)
TITLE "Example 3D"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0
# Order: r in {0,1}, g in {0,1}, b in {0,1} with r fastest
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
```

Notes
- The examples above are identity mappings in LUT space. quadGEN will apply printer‑space orientation (reverse + invert) internally after parsing.
- Declared 1D LUTs may exceed the 256-row headerless safeguard, up to the CUBE
  limit of 65,536 rows.
