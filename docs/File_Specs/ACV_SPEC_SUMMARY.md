# Photoshop .acv Curve – Developer Reference (for quadGEN)

Purpose
- Describe how quadGEN parses Photoshop .acv files and converts them to a usable neutral mapping.

Format Overview
- Binary, big‑endian 16‑bit integers.
- Header:
  - `version` (int16)
  - `totalCurves` (int16)
- Curves:
  - For each curve: `pointCount` (int16), then `pointCount` pairs of `(output, input)` as int16.
  - Values are in 0..255 (Photoshop’s 8‑bit curve grid).

quadGEN Parsing Rules
- Reads the header and `totalCurves`.
- Parses the first curve only (assumed to be the RGB composite curve).
- Reads `pointCount` pairs `(output, input)` and normalizes to 0..1.
- Sorts points by input for monotonic interpolation.
- Builds a smooth curve via monotonic PCHIP interpolation across the normalized input domain (prevents overshoot and preserves shape).
- Samples the spline at 256 evenly‑spaced inputs to obtain `samples[0..255]` in [0,1].

Printer‑Space Orientation
- To match quadGEN’s printer‑space coordinate system (and EDN parity), the 256‑sample curve is remapped:
  - Horizontal flip (reverse input coordinate): i → 1 − i.
  - Vertical inversion: v → 1 − v.
- Output object:
  - `{ domainMin: 0, domainMax: 1, samples, originalSamples, format: 'ACV' }`

2025‑09 Update (implementation detail)
- The printer‑space orientation transform is applied once, inside the ACV parser. UI loaders (global/per‑channel/sample) do not reapply any flip/invert step. This prevents double transforms and ensures that a “lighten” hump in Photoshop appears as a down (less‑ink) correction in quadGEN.

Notes & Edge Cases
- If `totalCurves`==0 or `pointCount`==0, parsing fails.
- quadGEN does not use per‑channel ACV curves; only the first (RGB composite) curve is used to create a neutral mapping.
- Spline output is clamped to [0,1].
- The result is a neutral correction curve suitable for global or per‑channel application in quadGEN.

Minimal Valid Skeleton (that quadGEN will load)

Linear identity curve (binary, big‑endian int16 values):
```
version      = 0x0001
totalCurves  = 0x0001
pointCount   = 0x0002
points:
  output=0x0000, input=0x0000   # (0 → 0)
  output=0x00FF, input=0x00FF   # (255 → 255)
```

Hex dump (14 bytes):
```
00 01  00 01  00 02  00 00 00 00  00 FF 00 FF
```

Notes
- Save as `.acv`; quadGEN reads it as ArrayBuffer and uses only the first curve.
- This minimal curve yields an identity mapping prior to quadGEN’s printer‑space orientation (reverse + invert) transform.
