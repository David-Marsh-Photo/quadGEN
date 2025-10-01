
# CGATS.17 Support — quadGEN Implementation Report (Revised)

**Date:** 2025-09-20  
**Scope:** Add robust CGATS.17 ingest for both minimal Lab-only workflows and rich i1Pro2/i1Profiler/Argyll-grade files (Lab + device + full spectra).

---

## Deliverables (Test Artifacts)
- **Lab-only 21-step CGATS.17**: [cgats17_21step_lab.txt](sandbox:/mnt/data/cgats17_21step_lab.txt)  
- **Rich Tier B 21-step CGATS.17** (Lab + CMYK + spectra 380–730nm @ 10nm): [cgats17_21step_rich.txt](sandbox:/mnt/data/cgats17_21step_rich.txt)

Both files use the same 21-step wedge (L* = 100→0 in 5-point steps) to simplify comparison.

---

## CGATS.17 Structure — What to Parse
- **Header**: `ORIGINATOR`, `CREATED`, `DESCRIPTOR`, instrument info, `ILLUMINANT`, `OBSERVER`, plus spectral descriptors (`SPECTRAL_BANDS`, `SPECTRAL_START_NM`, `SPECTRAL_END_NM`).
- **Schema**: `NUMBER_OF_FIELDS`, `BEGIN_DATA_FORMAT` … `END_DATA_FORMAT` listing all column names.
- **Data**: `NUMBER_OF_SETS`, `BEGIN_DATA` … `END_DATA`, one line per patch.

### Minimal (Tier A) Example
```txt
CGATS.17
ORIGINATOR "Synthetic Generator"
CREATED "2025-09-20"
DESCRIPTOR "21-step wedge Lab-only"
NUMBER_OF_FIELDS 4
BEGIN_DATA_FORMAT
SAMPLE_ID LAB_L LAB_A LAB_B
END_DATA_FORMAT
NUMBER_OF_SETS 21
BEGIN_DATA
1 100.0 0.0 0.0
2 95.0 0.0 0.0
3 90.0 0.0 0.0
4 85.0 0.0 0.0
5 80.0 0.0 0.0
6 75.0 0.0 0.0
7 70.0 0.0 0.0
8 65.0 0.0 0.0
9 60.0 0.0 0.0
10 55.0 0.0 0.0
11 50.0 0.0 0.0
12 45.0 0.0 0.0
13 40.0 0.0 0.0
14 35.0 0.0 0.0
15 30.0 0.0 0.0
16 25.0 0.0 0.0
17 20.0 0.0 0.0
18 15.0 0.0 0.0
19 10.0 0.0 0.0
20 5.0 0.0 0.0
21 0.0 0.0 0.0
END_DATA

```

### Rich (Tier B) Example
```txt
CGATS.17
ORIGINATOR "Synthetic Generator"
CREATED "2025-09-20"
DESCRIPTOR "21-step wedge rich (Lab + CMYK + full spectrum)"
INSTRUMENT "Synthetic i1Pro2"
ILLUMINANT D50
OBSERVER 2
SPECTRAL_BANDS 36
SPECTRAL_START_NM 380
SPECTRAL_END_NM 730
NUMBER_OF_FIELDS 44
BEGIN_DATA_FORMAT
SAMPLE_ID CMYK_C CMYK_M CMYK_Y CMYK_K LAB_L LAB_A LAB_B SPEC_380 SPEC_390 SPEC_400 SPEC_410 SPEC_420 SPEC_430 SPEC_440 SPEC_450 SPEC_460 SPEC_470 SPEC_480 SPEC_490 SPEC_500 SPEC_510 SPEC_520 SPEC_530 SPEC_540 SPEC_550 SPEC_560 SPEC_570 SPEC_580 SPEC_590 SPEC_600 SPEC_610 SPEC_620 SPEC_630 SPEC_640 SPEC_650 SPEC_660 SPEC_670 SPEC_680 SPEC_690 SPEC_700 SPEC_710 SPEC_720 SPEC_730
END_DATA_FORMAT
NUMBER_OF_SETS 21
BEGIN_DATA
1 2.0 2.0 2.0 0.0 100.0 0.0 0.0 0.9000 0.9000 0.9001 0.9001 0.9003 0.9006 0.9012 0.9022 0.9039 0.9065 0.9102 0.9151 0.9212 0.9282 0.9353 0.9419 0.9469 0.9496 0.9496 0.9469 0.9419 0.9353 0.9282 0.9212 0.9151 0.9102 0.9065 0.9039 0.9022 0.9012 0.9006 0.9003 0.9001 0.9001 0.9000 0.9000
2 2.0 2.0 2.0 5.0 95.0 0.0 0.0 0.8506 0.8506 0.8507 0.8507 0.8509 0.8512 0.8517 0.8527 0.8543 0.8567 0.8602 0.8649 0.8707 0.8772 0.8840 0.8902 0.8950 0.8975 0.8975 0.8950 0.8902 0.8840 0.8772 0.8707 0.8649 0.8602 0.8567 0.8543 0.8527 0.8517 0.8512 0.8509 0.8507 0.8507 0.8506 0.8506
3 2.0 2.0 2.0 10.0 90.0 0.0 0.0 0.8015 0.8015 0.8016 0.8016 0.8018 0.8020 0.8026 0.8035 0.8050 0.8073 0.8106 0.8150 0.8204 0.8266 0.8330 0.8388 0.8433 0.8457 0.8457 0.8433 0.8388 0.8330 0.8266 0.8204 0.8150 0.8106 0.8073 0.8050 0.8035 0.8026 0.8020 0.8018 0.8016 0.8016 0.8015 0.8015
4 2.0 2.0 2.0 15.0 85.0 0.0 0.0 0.7527 0.7527 0.7527 0.7528 0.7529 0.7532 0.7537 0.7545 0.7559 0.7581 0.7612 0.7653 0.7704 0.7762 0.7822 0.7877 0.7919 0.7942 0.7942 0.7919 0.7877 0.7822 0.7762 0.7704 0.7653 0.7612 0.7581 0.7559 0.7545 0.7537 0.7532 0.7529 0.7528 0.7527 0.7527 0.7527
5 2.0 2.0 2.0 20.0 80.0 0.0 0.0 0.7041 0.7041 0.7042 0.7042 0.7043 0.7046 0.7050 0.7058 0.7071 0.7092 0.7121 0.7159 0.7207 0.7261 0.7318 0.7369 0.7408 0.7430 0.74…
```
*(truncated for readability; use the downloadable file for the full spectrum columns)*

---

## Ingest Tiers & Expectations

### Tier A — Minimal (Parity with current)
- Accept **L\***-only or **Lab** (`LAB_L/LAB_A/LAB_B`) CGATS files.
- Typical for QTR-style linearization and PiezoDN 21/51/129-step targets.
- Ignore missing device/spectral fields.

### Tier B — Rich (i1Pro2/i1Profiler/Argyll)
- Accept files that include any combination of: **device values** (`RGB_*` or `CMYK_*`), **Lab/XYZ**, and **full spectral** columns (`SPEC_380 … SPEC_730` or equivalent naming).
- **Validate** spectral descriptors vs. actual columns (bands/start/end).
- **Preserve** spectra in storage even if linearizer uses only L* today (future-proof: recompute Lab under different illuminants, build ICCs, etc.).

---

## Parser Requirements (Spec → Code)

1. **Tolerance & Normalization**
   - Case-insensitive keywords; support tabs or spaces.
   - Handle duplicated headers; last-one-wins or canonical merge.
   - Map variants: `SAMPLE_ID`/`SAMPLE_NAME`; `SPEC_###` / `NM###` / `SPECTRAL_NM###`.
   - Don’t assume column order; rely on `BEGIN_DATA_FORMAT` names.

2. **Field Detection**
   - Patch ID: prefer `SAMPLE_NAME`, else `SAMPLE_ID`.
   - Device: collect any `RGB_*`/`CMYK_*` seen.
   - Colorimetric: `LAB_*`, `XYZ_*` (optional).
   - Spectra: identify numeric-wavelength columns; sort by wavelength if needed.

3. **Consistency Checks**
   - `NUMBER_OF_FIELDS` == parsed field count.
   - `NUMBER_OF_SETS` == row count between `BEGIN_DATA`/`END_DATA`.
   - If spectral metadata present, verify wavelength count and endpoints.

4. **Data Model**
```json
MeasurementSet {
  patches: [ {
    id, name,
    device: { RGB?:{R,G,B}, CMYK?:{C,M,Y,K} },
    lab: {L,a,b},
    xyz: {X,Y,Z},
    spectrum: { nm:[…], values:[…] }
  } ],
  meta: { originator, created, instrument, illuminant, observer, geometry?, aperture?, backing? }
}
```

5. **Round-Trip & Storage**
   - Store raw CGATS payload alongside parsed JSON (helps debugging, export).
   - Preserve `ILLUMINANT`/`OBSERVER` for future conversions.

---

## Integration Plan (quadGEN)

**Phase 1 — Parser & Unit Tests**
- Implement parser module with schema-driven column mapping.
- Unit tests using the two provided files (Lab-only & Rich).

**Phase 2 — Linearization**
- Use `LAB_L` when available; or compute L* from XYZ; or derive from spectra later.
- Allow wedge **mapping** (21/51/129 presets) when row order is ambiguous.

**Phase 3 — Spectral Utilities (Optional)**
- Store spectra; add helper to recompute Lab for D50/2°, D65/10°, etc.
- Expose illuminant/observer in UI when rich data is present.

**Phase 4 — Profiling Interop (Stretch)**
- Export normalized CGATS.
- Consider Argyll `.ti3` export/import to unlock ICC workflows.

---

## Acceptance Criteria (for Codex tests)

- ✅ Parses both **cgats17_21step_lab.txt** and **cgats17_21step_rich.txt** with no warnings.
- ✅ Produces `MeasurementSet` with 21 patches; rich file includes 36 spectral bands (380–730nm).
- ✅ Validates field counts and spectral bands; fails gracefully on mismatch.
- ✅ Round-trips field naming (preserve raw text; normalized JSON view available).

---

## Notes on Synthetic Data
- LAB values are neutral (a=b=0) with **L\*** from 100→0 in 5-point steps.
- Device CMYK is a simple neutral model for testing (CMY=2% except max black; K increases as L decreases).
- Spectra are generated via a mild bell-shaped reflectance peaking near 560 nm, scaled by L\*^(1.1). This is **not** colorimetrically accurate; it’s intended to stress-test parsing and data plumbing.

---

**End of Report**
