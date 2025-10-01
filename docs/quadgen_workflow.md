# quadGEN Workflow (Beta v2.6.4)

*(The version tag tracks the most recent refresh of this workflow; update it whenever the guide is revised.)*

## Purpose
- Provide a concise, repeatable workflow to build and refine `.quad` curves for QuadToneRIP (QTR).

## Prerequisites
- QTR installed; know where your printer’s “quad” folder is.
- Ability to print a step wedge/target via QTR (Print-Tool on macOS recommended).
- Optional (recommended): Color Muse 2 or equivalent to capture LAB L*.

## 1) Choose Printer and Set Ink Limits
- Open the modular `index.html` build (hosted or local), then pick your Epson printer model.
- Set per‑channel End (ink limits) to safe starting values.
- Tip: Start conservative; you can raise End later if blacks are weak.

## 2) Export a Linear Ramp `.quad`
- From quadGEN, export a linear ramp (identity mapping) with your channel enables/limits.
- Install the `.quad` into QTR’s quad folder for your printer.

## 3) Print a Step Wedge/Target
- Use QTR/Print‑Tool to print a 0–100% step wedge (or Clay Harmon’s 21/25‑step target) with your `.quad`.
- Ensure color management is OFF in Print‑Tool.

## 4) Measure the Print
- Measure each patch’s L* (e.g., Color Muse 2) and export as LAB `.txt`.
- Header should include: GRAY, LAB_L, LAB_A, LAB_B (A/B can be 0.00 and are ignored).

## 5) Load Data into quadGEN
- In quadGEN, Load LAB (`.txt`) (global or per‑channel) to compute a correction.
- Preview shows Y = output ink % vs X = input %; Y = X is “no correction”.
  - Too dark at X → correction dips below diagonal.
  - Too light at X → correction rises above diagonal.

## 6) Enter Edit Mode for Fine Tuning (Optional)
- Toggle Edit Mode ON in the Edit Curves panel to expose Smart key‑point edits.
- Selected channel draws on top; others dim.
- Use:
  - Recompute: regenerate Smart key points from the plotted curve using Max error % and Max points.
  - XY input: type `X,Y` (Y is absolute after End). Up/Down adjusts absolute Y; Left/Right adjusts X.
  - Insert/Delete: click to insert; delete non‑endpoints only.
- Ink‑limit guard: If an edit needs more ink than End and End can’t be raised, the edit is blocked with a status note.

## 7) Export Corrected `.quad` and Re‑Print
- Export the corrected `.quad` and install it in QTR.
- Reprint the step wedge/target and compare.

## 8) Iterate Until Linear
- Repeat measure → load → (optional) Edit Mode → export until tone is acceptably linear.
- Typical target: small mid‑tone deviations; endpoints remain anchored (0→0, 100→100).

## Notes & Tips
- quadGEN plots printer‑space ink mapping with 0% = white at origin. Photoshop Curves and some tools mirror X or plot luminance; compare shapes, not orientation.
- Keep curves monotonic and smooth. Use PCHIP interpolation; avoid kinks near endpoints.
- For alt‑process negatives, build in positive space, then invert the image in your editor for printing.

## References
- QuadToneRIP: https://www.quadtonerip.com/
- QTR Overview: https://www.quadtonerip.com/html/QTRoverview.html
- Print‑Tool (macOS): https://www.quadtonerip.com/html/QTRprinttool.html
- Color Muse 2: https://amzn.to/45R8rof
