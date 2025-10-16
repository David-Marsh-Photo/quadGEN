# .cube LUT – Developer Reference (for quadGEN)

Purpose
- Describe how quadGEN parses and uses .cube LUT files (1D and 3D) for linearization/correction.

Supported Variants
- 1D LUT (.cube with `LUT_1D_SIZE`) – treated as a single-channel tone mapping.
- 3D LUT (.cube with `LUT_3D_SIZE`) – neutral axis extraction (R=G=B) via trilinear interpolation.

General Parsing Rules
- Lines starting with `#` are comments and ignored.
- `TITLE` lines are ignored.
- Values are read as whitespace-separated floats.
- DOMAIN handling (optional):
  - `DOMAIN_MIN a [b c]` and `DOMAIN_MAX x [y z]` accepted; quadGEN uses the first value for 1D and all three for 3D normalization.

1D LUT Details
- Headers:
  - `LUT_1D_SIZE N` (optional but recommended). If present, quadGEN trims to N samples.
  - Optional `DOMAIN_MIN/DOMAIN_MAX` (defaults to 0.0 / 1.0 when absent).
- Data lines:
  - Accepts 1–3 floats per line; the first value is used.
  - Samples collected in order of appearance.
- Post-processing (printer-space orientation):
- Horizontal flip: reverse the input coordinate (index mapping i → 1−i scaled to index).
- Vertical inversion: sample value v → 1 − v.
- Monotonic interpolation: quadGEN resamples LUT values with a PCHIP interpolator so smooth, non-decreasing image-space curves stay monotonic after orientation.
- Output to quadGEN:
  - `{ domainMin, domainMax, samples, originalSamples, format: '1DLUT' }`
  - `samples` are normalized floats in [0,1].

3D LUT Details
- Headers:
  - `LUT_3D_SIZE N` is required.
  - Optional `DOMAIN_MIN/DOMAIN_MAX` (defaults to 0.0 / 1.0 when absent).
- Data lines:
  - Exactly 3 floats per line (R G B) – total lines must equal `N^3`.
- Neutral axis extraction:
  - For 256 evenly spaced inputs t ∈ [0..1], form RGB=(t,t,t).
  - Use trilinear interpolation within the RGB cube to sample the LUT.
  - Convert to a neutral luminance by simple average: L = (R+G+B)/3.
- Post-processing (printer-space orientation):
  - Horizontal flip (reverse input coordinate) and vertical inversion (v → 1−v).
- Monotonic interpolation: the extracted neutral axis is resampled with the same PCHIP interpolator to avoid cubic overshoot when applying the correction to printer-space ramps.
- Output to quadGEN:
  - `{ domainMin, domainMax, samples, is3DLUT: true, lutSize, originalDataPoints }`
  - `samples` is a 256-length array of normalized floats.

Edge Handling & Validation
- If `LUT_3D_SIZE` is missing, parsing fails.
- For 1D: up to 256 samples are accepted. If more are present without a `LUT_1D_SIZE` header, quadGEN will flag the file as suspicious to avoid misreading a 3D LUT.
- If `DOMAIN_MIN/MAX` produce invalid ranges, quadGEN defaults to 0.0..1.0.

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
# Order: r in {0,1}, g in {0,1}, b in {0,1} with b fastest
0.0 0.0 0.0
0.0 0.0 1.0
0.0 1.0 0.0
0.0 1.0 1.0
1.0 0.0 0.0
1.0 0.0 1.0
1.0 1.0 0.0
1.0 1.0 1.0
```

Notes
- The examples above are identity mappings in LUT space. quadGEN will apply printer‑space orientation (reverse + invert) internally after parsing.
- For 1D, keep `LUT_1D_SIZE` modest; the current parser raises an error for unusually large sample counts to catch format mix‑ups.
