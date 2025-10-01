# POPS Profiler v1.24 vs quadGEN — Formula/Computation Mapping

Author: quadGEN analysis
Date: 2025‑09‑11

## Scope & Method
- Source workbook: “Prints on Paper Studio Profiler v1.24.xlsx” (sheets parsed with openpyxl).
- Formula dumps: see docs/pops_profiler_formulas/INDEX.md and per‑sheet CSVs.
- quadGEN reference: quadgen.html (LAB parsing, smoothing, interpolation, make256) and docs/LAB_LSTAR_PIPELINE.md.

## Measurement Smoothing (POPS)
Summary: POPS smooths raw patch series using rolling means and user‑controlled blends, then maps indices across helper columns.

Representative formulas (sheet “M MEASUREMENT SMOOTHING and LIM”):
- Blend by user “Measure Smooth” controls (GENERAL_SETTINGS!C7, C8):
  - `O3 = F3*((100-C7)/100) + H3*(C7/100)`
  - `P3 = O3*((100-C8)/100) + I3*(C8/100)`
  - `Q3 = G3*((100-C7)/100) + J3*(C7/100)`
- Rolling averages (windowed):
  - `F4 = AVERAGE(D3:D5)`, `H4 = AVERAGE(F3:F5)`, `I4 = AVERAGE(H3:H5)`, etc.
- Peak/selector:
  - `M1 = MAX(O2:O132)`, `M2 = INDEX(N:N, MATCH(M1, O:O, 0))`
- Lookups:
  - `Z3 = INDEX(U:U, MATCH(BH3, BG:BG))`

quadGEN equivalent
- Gaussian‑weighted reconstruction over sparse corrections (docs/LAB_LSTAR_PIPELINE.md §3):
  - For position t ∈ [0..1], weight each correction by `w = exp(−d²/(2 r²))` and average, with dynamic radius r.
- Optional smoothing (user slider 0–90%) widens r and resamples to evenly‑spaced control points (typically ≤21).
- Differences:
  - POPS: stacked rolling means + linear blends driven by C7/C8, deterministic windowing.
  - quadGEN: radial basis (Gaussian) weighting continuous in t; fewer knobs; directly produces 256 samples, then optional control‑point downsample.

### What this means in practice
- Noise behavior: POPS’ windowed averages can suppress localized noise well but may flatten very small features if windows are wide; quadGEN’s Gaussian kernel preserves local shape with a tunable radius (larger radius → more smoothing).
- Controls: POPS exposes multiple smoothing dials (measure, iteration, extra, pre/post channel) which can be powerful but interdependent; quadGEN’s single slider is simpler and harder to mis‑tune.
- Convergence: On very noisy targets, POPS can tame spikes quickly; on clean targets, quadGEN’s kernel + PCHIP typically yields equal or smoother curves with fewer moving parts.
- What to look for: Compare residuals and curve “micro‑wiggles” around mid‑tones; POPS may look slightly more plateaued with high smoothing, quadGEN more continuously smooth.

## L* → Density/Ink Mapping (POPS) ✅
Summary: POPS converts L* to a pseudo‑density before further processing.

Formula:
- `BN3 = -LOG(((U3 + 16)/116)^2.978)`  (sheet “M MEASUREMENT SMOOTHING and LIM”)
  - Note: exponent 2.978 ≈ 3 approximates CIE inverse `L* = 116 * Y^(1/3) − 16`; then density = −log₁₀(Y).

quadGEN equivalent (current)
- Uses CIE‑exact luminance → density mapping (piecewise inverse for Y, then D = −log10(Y)) and normalizes by dataset max density:
  - `Y = ((L*+16)/116)^3` if `L*>8`, else `Y = L*/903.3`.
  - `Draw = −log10(Y)`, `actualDensity = Draw / max(Draw)`.
  - `expectedDensity = position`, `correction = expected − actual`.
- Differences:
  - POPS uses exponent 2.978 ≈ 3; quadGEN uses the exact CIE piecewise inverse (visually equivalent). Consequence: near‑identical behavior overall; quadGEN is better‑behaved at very low L* due to the piecewise form.
  - Reconstruction: POPS stacks moving averages + blends; quadGEN uses Gaussian‑weighted regression with a local adaptive bandwidth σ(x) based on median neighbor spacing (robust to uneven spacing and dense datasets), followed by PCHIP.

### What this means in practice
- Where it differs:
  - Shadows (≈90–100% input): Density mapping tends to “weight” deep tones more, often yielding slightly tighter separation and smaller residuals in the darkest steps after the first pass. L* normalization keeps weighting uniform, so shadow changes are less front‑loaded.
  - Highlights (≈0–10% input): Density compresses highlights a bit; early‑pass residuals can be marginally larger near paper white versus uniform L* weighting, which may flatten highlight residuals more evenly.
  - Curve shape and convergence: POPS’ density‑space pipeline may nudge stronger adjustments at the dark end and can converge faster there on UV/negative workflows; quadGEN’s PCHIP + L* normalization typically gives evenly distributed, monotonic corrections and fast neutrality on inkjet.
- When quadGEN’s L* method is sufficient (recommended default):
  - QTR inkjet neutrality on paper; reasonable Dmax/Dmin; measurements without severe endpoint noise. L* is already roughly perceptual, and PCHIP preserves shape without overshoot.
- When POPS‑style density emphasis can help:
  - Digital negatives/photogravure (UV exposure driven by optical density), open‑bite risk or marginal Dmax, or a workflow that prioritizes deep shadow control over highlight uniformity in early passes.
- How to tell quickly (A/B test):
  - Print with each calibrated .quad and measure residuals (ΔL* to a linear target) by ranges: 0–10%, 10–90%, 90–100%. Expect density mapping to do a little better at 90–100% if shadows were problematic; parity elsewhere in typical cases.
  - Check last 3–5 dark patches for distinct separation; count iterations to hit acceptance thresholds (e.g., mean |ΔL*| < 1, max |ΔL*| < 2).
- Optional parity in quadGEN:
  - Hybrid highlight blend (legacy‑like highlights, CIE mid/shadows) available as a design note (see docs/hybrid_density.md) if needed in future.

## Patch Axis / Ramp Construction (POPS)
Summary: GENERAL_SETTINGS builds a 0..100 axis in 128 steps.

Formulas:
- `E28 = E27 - ($E$27/127)`, then repeated; similarly references to `'M SPECTRAL COUNTS'` for patch counts.

quadGEN equivalent
- Builds a 256‑sample ramp for each channel: `arr[i] = round(i * (endValue/255))` when starting from linear (make256).

### What this means in practice
- Resolution: POPS’ process often centers on 128‑step patch logic; quadGEN operates at 256 samples for final curves. In practice the difference is negligible for print smoothness, but 256 gives finer edit granularity.
- Alignment: Ensure your target’s patch count aligns with the tool’s assumptions (POPS’ 128×5 guidance). quadGEN will happily ingest unevenly spaced patches and still produce 256 outputs.
- What to look for: If you scrutinize quantization, quadGEN edits can feel a touch finer when nudging mid‑tone points.

## Segment Interpolation / Calibration Core (POPS)
Summary: Uses 4‑point, segment‑wise cubic calculated by matrix kernels; fallback to precomputed smoothing if disabled.

Representative formula (sheet “CALIBRATION”):
- `H2 = IF(GENERAL_SETTINGS!C15="No",
  SUM((1+1/IRR(MMULT(A, OFFSET(C$5, MATCH(G5, C$5:C$11)-2,,4)-G5 )))^-{0;1;2;3} *
      MMULT(B, OFFSET(E$5, MATCH(G5, C$5:C$11)-2,,4)))/2,
  'T MEASUREMENT SMOOTHING and LIM'!Z4)`
  - Where A and B are fixed 4×4 coefficient matrices.

quadGEN equivalent
- Interpolation for measurement‑driven curves uses PCHIP (monotonic, shape‑preserving) over `lutX`/`samples` (createPCHIPSpline).
- Forward mapping in apply1DLUT: `t = (v/maxValue)*(domain)`, evaluate interpolant, clamp to 0..1, scale back to 0..end.
- Differences:
  - POPS’s cubic can overshoot unless constrained by limiting; PCHIP avoids overshoot/flat segments by construction.

### What this means in practice
- Stability: quadGEN’s PCHIP avoids overshoot, so you shouldn’t see unintended dips/humps after interpolation; POPS’ cubic is smooth but can overshoot around steep changes if limits aren’t tight.
- Detail: Cubics can preserve a bit more micro‑contrast in smooth regions; PCHIP trades that for guaranteed monotonicity (safer with sparse/noisy data).
- Edge cases: If measurements have outliers, POPS may need tolerance limiting to prevent oscillations; quadGEN’s PCHIP typically stays well‑behaved without extra guards.
- What to look for: Inspect the darkest and lightest 10% for wiggles or flattening; PCHIP should appear shape‑preserving without ripples.

## Channel‑Space Smoothing (POPS)
Summary: “Pre‑contrast channel smoothing” and “Post‑contrast channel smoothing” average the per‑channel curve to damp jaggedness.

Formulas:
- Typical: `H5 = AVERAGE(F3:F7)`, `K5 = AVERAGE(J3:J7)`, etc., followed by blended outputs (O/P/Q columns).

quadGEN equivalent
- Not present (by design). Edits occur via Smart key points + PCHIP; no post‑interpolation moving average.
- Parity option: add optional Savitzky–Golay or moving average over the 256‑sample channel after interpolation (guard endpoints), controlled by a percent slider.

### What this means in practice
- Smoothness vs. fidelity: POPS’ channel smoothing can remove residual jaggedness from difficult sources but may soften intentional knees/shoulders; quadGEN preserves whatever shape interpolation yields (crisper but may reveal measurement roughness).
- Use cases: Prefer POPS channel smoothing when importing bumpy legacy curves; prefer quadGEN’s unsmoothed channels when you’re dialing deliberate shape in Edit Mode.
- What to look for: If a calibrated curve looks slightly “matted” or lacks bite, reduce POPS channel smoothing; if quadGEN shows stair‑steps from poor data, consider adding the parity option.

## White/Black Limits and Open‑Bite (POPS)
Summary: Auto and manual limiting; tolerance sheets mirror calibrated series for limit logic.

Signals:
- “TOL LIMITING AND BOOSTING” references `CALIBRATION!W3..W45` in reverse (N282..N240) for tolerance checks.
- GENERAL_SETTINGS H3/I3 pull from measurement‑limiting outputs.

quadGEN equivalent
- No automated limit detection; user sets End (ink limit) and adjusts curve. Parity option: detect slope reversals near endpoints and clamp; expose auto‑limit toggle.

### What this means in practice
- Early‑pass safety: POPS’ auto white/black limits can protect against open‑bite or over‑inking without manual intervention; quadGEN relies on you to watch the ends and set limits appropriately.
- Diagnostics: In POPS, watch luminance near 0% and 100% for reversals; in quadGEN, use the wedge and axis gradients—if darkest steps reverse (get lighter), reduce End or adjust the curve.
- What to look for: Step separation at the last few dark patches and the first few light patches; POPS may “just work” sooner, quadGEN gives you explicit control.

## Contrast Intent (POPS) ✅
Summary: User pastes gloss/matte/uncoated Photoshop curve blocks; green “intent” line drives S‑curve targeting.

quadGEN equivalent
- External `.acv` or `.cube` can impose intent; or edit Smart key points. No built‑in templates yet.

### What this means in practice
- Visual match: POPS calibrates toward a chosen S‑curve (green line), often leading to prints that match your screen’s contrast without soft‑proofing; quadGEN requires importing an `.acv`/`.cube` or hand‑shaping the curve to achieve the same.
- Trade‑off: Intent adds bias—midtone slope and shoulder are pre‑decided. Great for consistency; less neutral than a pure linear target.
- What to look for: Midtone “snap” and highlight roll‑off; with intent enabled you’ll see a gentle S even when residuals are small.


## Final Curve Export (POPS) 🚩 
- “CALIBRATED_CURVE” copies `CALIBRATION!LL2..` into a channel vector; downstream sheets export to QTR/LUT/driver‑specific formats.

quadGEN equivalent
- make256 returns final 256 INTs/channel (0..end); exported as `.quad` in‑app.

### What this means in practice
- Output parity: For QTR, both yield valid `.quad` curves—visual parity depends on the upstream method, not the export step.
- Ecosystem reach: POPS also emits LUTs for non‑QTR workflows (Canon/Gutenprint/Ergosoft). If you need those bridges, quadGEN would need a LUT export feature.
- What to look for: Installation and validation are the same for `.quad`; differences show up only if you also use the LUT/driver exports.

## One‑to‑One Mapping Table (summary)
- Measurement smoothing: POPS O/P/Q blends + AVERAGE windows → quadGEN Gaussian kernel reconstruction with dynamic radius.
- L* mapping: POPS `-LOG(((L*+16)/116)^2.978)` → quadGEN CIE luminance→density with Dmax normalization.
- Interpolation: POPS segment cubic (kernel MMULT/IRR) → quadGEN PCHIP.
- Channel smoothing: POPS pre/post moving averages → quadGEN none (can add).
- Auto limits: POPS white/black/tolerance sheets → quadGEN manual; propose auto.
- Contrast intent: POPS templates pasted as curves → quadGEN via `.acv`/`.cube` or future built‑ins.

## Implications
- POPS’s perceptual L*→Y mapping and segment cubics bias toward smooth, visually coherent midtones; open‑bite/limits safeguard ends.
- quadGEN’s PCHIP and Gaussian kernel emphasize monotonicity and stability with fewer moving parts; edits are explicit and inspectable.

## Task List for POPS Parity (quadGEN) 🚩
1) Add Auto White/Black Limit (endpoint slope detection + clamp window).
2) ✅ Add Contrast Intent templates (parametric S‑curves in Help/Settings).
3) LUT export
4) ✅ CIE mapping. 
