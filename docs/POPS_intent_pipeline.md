# POPS Profiler Intent Pipeline — Formula Trace

This note captures the core POPS Profiler v1.24 formulas that shape a calibrated curve toward a user-selected tonal intent (gloss/matte/uncoated). Source references are the parsed workbook CSVs under `docs/pops_profiler_formulas/`.

## 1. Intent Curves
- Stored in `FULL CMYK LUTS` sheet (columns A… for gloss/matte/uncoated).
- Downstream sheets pull the desired intent sample via `INDEX(... MATCH(...))`.

Example:
```
FZ5 = ROUND(FO5 * (FY2 / 100) + FC5 * (FY1 / 100), 0)
FY1 = 100 − FY2
FY2 = 'GENERAL SETTINGS'!C10   (user “intent strength”)
```
`FZ` is the intent-target sample after blending two lookups from the LUT sheet.

## 2. Measurement Smoothing (density space)
- `M MEASUREMENT SMOOTHING and LIM` converts L* to a pseudo-density and runs rolling averages plus user blends.
- Key density conversion (approximate CIE inverse):
  `BN3 = −LOG(((U3 + 16) / 116)^2.978)`
- Multiple moving averages (e.g. `F4 = AVERAGE(D3:D5)`), then user blends controlled by `GENERAL_SETTINGS!C7`, `C8`.

## 3. Calibration Sheet Flow (`CALIBRATION`)
1. **Smoothed measurement curve (`FO`)**
   - Rolling weighted average of the measurement curve (columns `FC`, weights `FMx`):
     `FO5 = ROUND((FC3*FM11 + FC4*FM12 + ... + FC7*FM15) / SUM(FM11:FM15), 0)`

2. **Intent smoothing blend (`FZ`)**
   - Mix `FO` with preset intent values using the global strength (FY1/FY2):
     `FZ5 = ROUND(FO5 * (FY2/100) + FC5 * (FY1/100), 0)`

3. **Intent lookup + scaling (`GZ` and `HK`)**
   - `GZ5 = ROUND(INDEX(FZ:FZ, MATCH($GK6, $GJ:$GJ)) * $GM5, 0)`
     - `$GK6` is the grey level index, `$GM5` is per-channel limit scaling.
   - `HW5 = INDEX(H:H, MATCH($B5, $A:$A, 0))` (channel weighting).
   - `HK5 = ROUND(GZ5 * HW5, 0)`.

4. **Final per-channel blend (`KQ`, `LL`)**
   - `KP5 = INDEX(KO:KO, MATCH($B5, $A:$A, 0))` → per-row intent blend weight.
   - `KQ5 = ROUND(('BLENDING CHANNELS'!B5 * $KP5) + (HK5 * (1 − $KP5)), 0)`
     - `'BLENDING CHANNELS'!B5` = measurement-driven correction.
     - `HK5` = intent target at same level.
   - `LL5 = IFERROR(IF(KQ5 < 0, 0, KQ5), "")` clamps to [0, 255].
   - `CALIBRATED_CURVE!A5 = CALIBRATION!LL5` (exported `.quad`).

5. **Auto white/black limits** happen in `TOL_LIMITING_AND_BOOSTING` and feed back into the blend if endpoints need flattening.

## 4. Summary Workflow
1. Import measurements → convert to density → smooth via rolling averages.
2. Retrieve intent curve sample for each input level.
3. Blend smoothed measurements with intent using global strength (GENERAL_SETTINGS!C10) and per-channel weights (`KP`/`HW`).
4. Clamp to allowable ink range and export to `CALIBRATED_CURVE` for QTR.

## Usage Notes
- POPS emphasises density-space smoothing and explicit intent blending on every row. Changing the “intent strength” or channel weights (KP) directly biases the output toward the desired S-curve.
- The same formulas repeat for each channel, differing only by column references in the blending step (`B`, `C`, … for the various inks).

