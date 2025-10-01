# CGATS.17 Color Measurement – Developer Reference (for quadGEN)

Purpose
- Define how quadGEN parses CGATS.17 format files to extract monochrome measurement data for LAB linearization workflows.

## CGATS.17 Format Overview
- Industry-standard format developed by Committee for Graphic Arts Technology Standards
- Used by professional spectrophotometers and colorimeters for color measurement data exchange
- Structured text format with metadata headers and tabular measurement data
- Commonly exported by tools like X-Rite i1Pro, DataColor SpyderPrint, and similar devices

## Expected File Structure
```
CGATS.17

CREATED "MM/DD/YYYY #Time: HH:MM:SS"
INSTRUMENTATION "Device Name ; Serial number X"
ILLUMINATION_NAME "D50"
OBSERVER_ANGLE "2"

NUMBER_OF_FIELDS N
BEGIN_DATA_FORMAT
SAMPLE_ID SAMPLE_NAME CMYK_C CMYK_M CMYK_Y CMYK_K LAB_L LAB_A LAB_B
END_DATA_FORMAT

NUMBER_OF_SETS N
BEGIN_DATA
1 A1 0.00000 0.00000 0.00000 0.00000 95.23 -0.12 2.34
2 A2 0.00000 0.00000 0.00000 10.00000 87.45 0.23 1.12
...
N AN 0.00000 0.00000 0.00000 100.0000 8.12 0.45 0.89
END_DATA
```

## Parsing Rules for quadGEN

### File Detection
- File must begin with "CGATS.17" header (exact match, case-sensitive)
- Must contain both `BEGIN_DATA_FORMAT`/`END_DATA_FORMAT` and `BEGIN_DATA`/`END_DATA` sections

### Required Fields
- **LAB_L**: Lightness values (0-100) - required for linearization
- **CMYK_K**: Black channel percentage (0-100) - required for monochrome extraction
- **Sample identification**: SAMPLE_ID or SAMPLE_NAME (for error reporting)

### Optional Fields (ignored)
- CMYK_C, CMYK_M, CMYK_Y: Color channel data
- LAB_A, LAB_B: Chromaticity data
- Other measurement data (spectral, density, etc.)

## Monochrome Data Extraction

### K-Only Workflow (Preferred)
- Filter samples where C=M=Y=0 (pure black channel progression)
- Extract K% as input percentage, LAB_L as measured lightness
- Requires minimum 3 samples spanning 0-100% K range
- Example valid progression: K=0%/L*=95, K=50%/L*=45, K=100%/L*=8

### Composite Grayscale Workflow (Fallback)
- When insufficient K-only data, calculate total ink density: `Total = C + M + Y + K`
- Extract Total% as input, LAB_L as output
- Filter for neutral color samples (A* and B* near zero, if available)
- Requires monotonic relationship between Total% and LAB_L

### Data Validation
- LAB_L values must be numeric and within 0-100 range
- Input percentages (K or Total) must be 0-100
- Minimum 3 valid sample points required
- Samples must form monotonic decreasing LAB_L vs increasing ink progression
- Maximum 64 samples retained (matches existing LAB workflow limits)

## Integration with LAB Pipeline

### Data Transformation
- Normalize monochrome samples into `{ input: %, lab: L* }` records (0–100 ranges) and sort ascending by input.
- Feed the dataset into `buildInkInterpolatorFromMeasurements`, which converts L* into printer-space ink via adaptive Gaussian smoothing tuned by `LAB_TUNING`.
- Invert the smoothed printer-space curve against the active contrast intent with a monotone PCHIP solver; clamp outputs to [0,1] and anchor endpoints at 0 % / 100 %.
- Emit 256 printer-space samples plus a smoothing evaluator that simply widens the helper's sigma to preview softer fits without breaking monotonicity.

### Error Handling
- **Format errors**: Invalid CGATS structure, missing required sections
- **Data errors**: No suitable monochrome progression found
- **Range errors**: LAB_L or ink values outside 0-100% range
- **Insufficient data**: Fewer than 3 valid measurement points

### User Feedback
- Status: "Loaded CGATS measurement data (N points K-only) from filename.cgats"
- Status: "Loaded CGATS measurement data (N points composite) from filename.cgats"
- Error: "CGATS file contains no suitable monochrome measurement data"

## File Extension Support
- Primary: `.cgats`, `.CGATS`
- Secondary: `.txt`, `.TXT` (when header contains "CGATS.17")
- Auto-detection based on file content, not extension

## Minimal Valid Example (K-only)
```
CGATS.17

NUMBER_OF_FIELDS 6
BEGIN_DATA_FORMAT
SAMPLE_ID CMYK_C CMYK_M CMYK_Y CMYK_K LAB_L
END_DATA_FORMAT

NUMBER_OF_SETS 3
BEGIN_DATA
1 0.00 0.00 0.00 0.00 95.0
2 0.00 0.00 0.00 50.00 45.0
3 0.00 0.00 0.00 100.0 8.0
END_DATA
```

## Implementation Notes
- CGATS parsing is additive to existing LAB.txt workflow and now uses the exact same printer-space inversion helper as manual LAB entry / LAB.txt imports.
- Smoothing previews widen the shared helper's Gaussian neighborhood before reinverting, so the chart, Smart points, and exports all reflect the same monotone PCHIP fit.
- No changes to Smart Curves, Edit Mode, or .quad export processes
- Maintains full compatibility with existing quadGEN workflows
- Performance considerations: Large CGATS files (>100 samples) simplified using existing point reduction logic

## Limitations
- Only monochrome/grayscale progressions supported
- Color measurement data (full CMYK combinations) not used for linearization
- Spectral data and advanced colorimetric features ignored
- Focus on K-channel or neutral axis extraction only
