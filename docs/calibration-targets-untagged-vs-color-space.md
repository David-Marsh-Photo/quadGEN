# Calibration Targets: Untagged vs Color‑Managed Workflows

This note explains why most calibration wedges/targets are untagged (no embedded ICC profile) and how to use them with quadGEN/QuadToneRIP for robust linearization. It also clarifies the roles of X% (device input) and L* (measured output).

## TL;DR
- Use untagged targets and print with “No Color Management”.
- X% is device input (0–100). L* is measured output (perceptual). Don’t derive X% from L*. 
- For straightforward calibration: set Measured X% to your wedge inputs and link Target X% to Measured X%.
- Enter desired Target L* (usually a ramp 100→0) and generate the correction.

## Why Untagged Targets Are Standard
- **Device input, not Lab**: Linearization maps numeric device codes (X%) to printed response. ICC transforms in a color‑managed path change those numbers before they hit the printer.
- **TRCs and intents**: Color spaces (sRGB/AdobeRGB) add tone response curves, intents, and black‑point compensation. Those reshape the tonal response unpredictably for calibration.
- **Reproducibility**: Untagged + “No Color Management” ensures identical numbers reach the device every time — critical for reliable linearization.

## Recommended Calibration Workflow (quadGEN / QTR)
1. **Target file**
   - Build a neutral wedge (e.g., 0, 5, 10, …, 100%) as untagged grayscale or neutral RGB (R=G=B), no embedded ICC profile.
2. **Print path**
   - Print with “No Color Management” (Photoshop: Printer manages color + driver CMS off; OS print pipeline off; or QTR’s tools). The goal: raw numbers → device.
3. **Measure**
   - Measure L* (CIE L*) for each patch.
4. **Enter in quadGEN (Manual L*)**
   - Measured X%: wedge inputs (e.g., 0,5,10,…). 
   - Link Target X% to Measured (the default toggle) for straightforward calibration.
   - Target L*: desired output tone (usually a smooth ramp 100→0 or your house curve).
5. **Generate**
   - Generate the correction, export .quad, and print a verification wedge using the same no‑CMS pipeline.

## Can I Use a Color Space?
- **Only in a fully locked, controlled workflow**: You would have to fix the source/destination profiles, intent, BPC, driver settings, and always print with the exact same pipeline. Any change invalidates the mapping.
- **In practice**: For device linearization (.quad), untagged + no CMS is the robust approach.

## quadGEN UI Mapping (Manual L*)
- **Measured X%**: device input positions for your wedge. Must match how you actually printed.
- **Target X%**: input positions where you place target anchors (desired outputs). 
  - Link Target X% = Measured X% for “calibrate to the wedge” workflows.
  - Unlink when you want more control in toe/shoulder (place more target anchors where you care most).
- **Target L%**: desired output tone (Lab L*) at each Target X% anchor.
- **Measured L***: what you actually measured.
- **Correction**: quadGEN solves for c such that actualDensity(c) ≈ targetDensity(x). 

## Common Pitfall
- “L* 95 → X% 5?” No. L* is output (perceptual), X% is input (device). Don’t derive X% from L*. Use your wedge inputs for X%, and L* for measured outputs.

## Advanced: Non‑Even Input Spacing
- **Measured X%**: enter the wedge’s true inputs (non‑even steps OK).
- **Target X%**: keep linked (simple) or un‑link and place more target anchors in highlights/shadows for finer control.
- **Why**: Concentrate control where it matters most, or match non‑even patch layouts without adding rows.

## Checklist
- [ ] Target file untagged, neutral.
- [ ] Print with “No Color Management”.
- [ ] Measured X% = wedge inputs; L* measured per patch.
- [ ] Link Target X% to Measured for standard calibration; un‑link only for advanced shaping.
- [ ] Target L* = desired tone curve; generate and verify.

---

If you need a “Reset X% to even” or “Snap Target X% to Measured” helper in the UI, those can be added to accelerate setup for common workflows.
