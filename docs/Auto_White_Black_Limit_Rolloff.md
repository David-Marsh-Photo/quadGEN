# Auto White/Black Limit Rolloff — POPS vs. Industry, and a quadGEN Plan

Author: quadGEN analysis (Senior Lab Tech)
Date: 2025‑09‑16

## Executive Summary
- Problem: Non‑linear contrast intents plus correction can push the curve to the channel ink limit early, creating a flat ceiling before X=100% and destroying separation in the last ~5–10% of inputs.
- POPS (Prints on Paper Studio Profiler v1.24) detects this “early plateau” at both white and black ends and applies a soft rolloff (shoulder/toe) that reaches the limit exactly at the endpoint with zero slope, preserving separation.
- This approach aligns with industry‑standard soft‑knee/toe strategies used in tone mapping, TRCs, and color pipelines (smoothstep, exponential knees, filmic shoulders), and avoids global renormalization.
- quadGEN can reach behavior parity by adding a lightweight endpoint plateau detector and a localized soft‑knee generator, sampled back into PCHIP.

## Background & Plot Semantics
- quadGEN plots printer‑space ink mapping: Y = output ink percent vs X = input percent; Y = X means “no correction”.
- A flat top near 100% (or flat bottom near 0%) means many input values map to the same ink level: lost highlight (white) or shadow (black) separation.
- Non‑linear “intents” (gamma/filmic/soft/hard/custom) stack on top of measurement‑driven corrections; in some cases they push outputs to the channel End early.

## What POPS Does (Observed From Workbook Dumps)

Reference files
- Formula index and dumps: `docs/pops_profiler_formulas/INDEX.md` and per‑sheet CSVs.
- Mapping notes: `docs/POPS_vs_quadGEN_formula_map.md`.

Key elements
- L* to density (shadows emphasized):
  - `BNn = -LOG(((U + 16)/116)^2.978)` on sheet “M MEASUREMENT SMOOTHING and LIM”. The 2.978 exponent ≈ 3 mirrors the CIE inverse (quadGEN uses the exact piecewise inverse to Y, then D = −log10(Y)).
- Layered smoothing and indexing:
  - POPS builds smoothed series via moving averages and blends (e.g., `FO/FP` from `FC/FD` with kernel `FM`, mixing via `FY`), then indexes/normalizes per row (`GMn`, `GYn`).
- Endpoint slope proxy and windowing (high end example):
  - In “CALIBRATION”, POPS computes a smoothed indicator series `Wn` using sliding averages over an array‑formula column `AC`:
    - `W3 = V3`, then `W4 = round(AVERAGE(AC3:AC5), 3)`, `W5 = round(AVERAGE(AC4:AC6), 3)`, … up to `W201`.
  - “TOL LIMITING AND BOOSTING” references `CALIBRATION!W45 .. W3` (reversed) to analyze the last segment approaching X=100%, which strongly suggests it derives “how flat the top is” and sets tolerances/weights accordingly.
- Limit shaping weight and blend:
  - Base amplitude per row: `GZn = round(index(FZ, match(GK)) * GMn, 0)` (and sibling channels `HA..HI`).
  - Limit weight (endpoint rolloff): `HWn = index(H:H, match(Bn, A:A, 0))` → applied as `HKn = ROUND(GZn * HWn, 0)`.
  - Blend against a reference curve using per‑row blend `KPn` (from `KO`):
    - `KQn = round(('BLENDING CHANNELS'!Bn * KPn) + (HKn * (1 − KPn)), 0)`.
  - Floor guard on outputs: `LLn = IFERROR(IF(KQn < 0, 0, KQn), "")`.

Interpretation
- POPS detects sustained approach to the limit with a reduced local slope near endpoints, then reduces a per‑row weight `HW` over a minimum span so the final segment eases into the limit at X=100% with slope 0 (C1‑continuous shoulder/toe). A mirrored process handles the black end.
- The specific knee shape is encoded in array formulas for columns like `H` and `AC` (not exposed in the CSV dump), but behavior matches a soft‑knee that preserves midtones and only reshapes the last segment.

## Industry‑Standard Approaches To Early Clipping
- Soft knee/toe (tone mapping):
  - Smoothstep polynomials: `s(t)=3t^2−2t^3` (or 5th‑order), normalized over t∈[0,1]; guarantees y′(endpoint)=0 and C1 continuity.
  - Exponential/softplus knee: `y = End − (End − y0)·exp(−a(x−x0))`, scaled so `y(1)=End` and `y′(1)=0`; parameter `a` governs knee width.
  - Filmic/Logistic shoulders: Hable/Reinhard/OCIO styles provide tunable shoulder width and toe softness.
- Slope‑bounded monotone splines:
  - Constrain terminal slopes and preserve monotonicity; optionally add a final ease‑to‑limit segment if data push the cap.
- Global renormalization (less favored here):
  - Scale the entire curve so it reaches the limit only at X=100%; simple but compresses midtones unnecessarily.

## Comparison: POPS vs. Industry
- Detection: POPS uses a proximity‑to‑limit + low‑slope heuristic over a window near endpoints (smoothed by moving averages). Same pattern is standard elsewhere, often with robust smoothing to avoid noise triggers.
- Rolloff: POPS replaces only the terminal segment with a soft shoulder/toe that is monotone, C1‑continuous at the knee start, and hits the limit at the endpoint with zero slope. Identical in spirit to smoothstep/exponential/filmic knees.
- Scope: Localized segment replacement preserves midtones. Global rescaling is avoided.
- Interpolation: POPS constructs the final series from a few shaped components, then downstream exports; quadGEN can emulate via Smart key points + PCHIP.

## Recommended quadGEN Algorithm (Parity With PCHIP)

Detection (white and black ends)
- Work in printer space after intent + correction, before final clamp.
- Compute first differences over the last 10% (white) and first 10% (black) of X.
- Find the earliest `x0` (white) where both:
  - Proximity: `Y >= End − εY` (e.g., εY = 0.5–1.0% of End), and
  - Slope collapse: rolling median slope ≤ εSlope (e.g., ≤ 10–20% of the median midtone slope), sustained over ≥ 3–5 samples.
- Mirror for black limit with `Y <= εY` and negative slope magnitude test.

Rolloff (localized soft knee on [x0, 1] or [0, x0])
- Use cubic smoothstep in normalized `t = (x − x0)/(1 − x0)` (white end):
  - `y(x) = y0 + (End − y0) · s(t)`, where `s(t) = 3t^2 − 2t^3`.
  - Properties: y(x0)=y0, y(1)=End, y′(x0)=match incoming slope, y′(1)=0, monotone for y0≤End.
- If knee width < 5% domain, switch to a 5th‑order smoothstep or exponential soft‑knee for a tighter shoulder.

Integration (quadGEN specifics)
- Apply after intents/corrections, before End clamp.
- Insert 2–3 Smart key points across the knee span (e.g., `(x0, y0)`, midpoint, `(1, End)`), keep interpolation `PCHIP`.
- Tag recomputed Smart meta as baked (`bakedGlobal`) to respect double‑apply and Smart‑source guards in Edit Mode.
- Leave midtones unchanged; do not globally renormalize.

Parameters & Defaults (tunable later)
- εY (proximity): 0.5–1.0% of End (white) / 0.5–1.0% absolute (black).
- εSlope: 15% of midtone median slope (robust), sustained over 3–5 samples.
- Min knee width: 5% of domain; under that, escalate to tighter knee function.
- Optional UI checkboxes: Auto white limit / Auto black limit (independent, default OFF/ON); advanced: εY, εSlope, min-width.

## Pros, Cons, and Rationale
- Pros: Localized fix preserves midtone contrast; restores separation in clipped highlights/shadows; predictable, monotone, visually smooth; integrates cleanly with PCHIP.
- Cons: Adds a detector and a small amount of shaping logic; on extremely tight End settings, the knee may be steep unless thresholds are tuned.
- Rationale: Matches POPS’ outcome with fewer moving parts, and mirrors established soft‑knee practices from tone mapping and print TRCs.

## Validation Plan (Manual)
1) Load a case that plateaus early (e.g., last ~10% flat under a non‑linear intent).
2) Enable the desired Auto limit (white, black, or both). Verify:
   - The curve remains unchanged until proximity + low‑slope criteria are met.
   - A smooth shoulder appears, reaching End exactly at X=100% with y′→0.
   - Midtone deltas match the pre‑auto‑limit curve.
3) Mirror test at the black end with a synthetic “flat bottom” case.
4) Optional: Compare against POPS examples or screenshots (see `autolimit.png`, `autolimitAdvancedPOPS.png`).

## Cross‑References
- POPS formula dumps: `docs/pops_profiler_formulas/*.csv` (see especially `M_MEASUREMENT_SMOOTHING_and_LIM.csv`, `CALIBRATION.csv`, `TOL_LIMITING_AND_BOOSTING.csv`).
- quadGEN curve semantics and LAB pipeline: `docs/LAB_LINEARIZATION_WORKFLOW.md`, `docs/LAB_LSTAR_PIPELINE.md`.
- POPS vs quadGEN mapping: `docs/POPS_vs_quadGEN_formula_map.md`.

## Notes
- This document analyses behavior and proposes a minimal, PCHIP‑friendly implementation for quadGEN. It does not alter user‑facing behavior yet.
- If we implement the feature, update in‑app Help (ReadMe/Glossary as needed) and Version History per repository guidelines.
