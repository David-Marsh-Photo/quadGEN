# Hybrid Highlight–Legacy + CIE‑Exact Density Mapping

Status: proposal (ready to implement)

This document specifies a hybrid mapping for converting measured L* to an “actual density” domain used by quadGEN’s LAB/Manual L* ingestion. The hybrid preserves current highlight behavior while adopting a CIE‑exact luminance→density mapping for midtones and shadows. It addresses the concern that pure CIE density can slow highlight convergence relative to the existing min/max L* normalization.

See also: docs/POPS_vs_quadGEN_formula_map.md (L* → Density/Ink Mapping)

## Goals

- Preserve present highlight “arrival” and smoothness (0–~10% inputs).
- Gain POPS‑style shadow emphasis and faster convergence in 90–100%.
- Maintain continuity and monotonicity (no kinks or hinge artifacts).
- Keep existing Gaussian/RBF smoothing and interpolation unchanged.

## Summary

Compute two “actual density” values from each measured L* and blend them by a smooth, position‑based weight w(pos):

- Legacy L* normalization (current behavior):
  - D_L* = 1 − (L − L_min) / (L_max − L_min).
- CIE‑exact density (POPS‑like):
  - Y = ((L+16)/116)^3 if L > 8, else Y = L/903.3.
  - D = −log10(clamp(Y, ε, 1)).
  - D_CIE = D / D_max, where D_max is the max D across the measurement set.
- Hybrid actual density at input position pos ∈ [0,1]:
  - actual(pos) = w(pos)·D_L* + (1 − w(pos))·D_CIE.

Choose w(pos) = 1 in highlights, smoothly transitioning to 0 by midtones to hand control over to CIE density for the rest of the range.

## Weight Function

Use a C1‑continuous “smootherstep” blend to avoid a visible hinge:

- Parameters:
  - threshold τ: start of transition (default 0.12 → 12% input).
  - rolloff ρ: width of transition (default 0.10 → 10% span).
- Definition:
  - x = clamp((pos − τ)/ρ, 0, 1)
  - s(x) = x^3·(x·(6x − 15) + 10)   // smootherstep
  - w(pos) = 1 − s(x)

Properties: w = 1 for pos ≤ τ; w = 0 for pos ≥ τ+ρ; continuous 1st derivative across the blend.

Alternative (optional): logistic w = 1 / (1 + exp((pos − τ)/k)), with k ≈ 0.06.

## Algorithm (pipeline‑agnostic)

Inputs: measured pairs P = {(x_i in %, L_i in [0,100])}, i=1..N, sorted by x.

1) Precompute context from the measured set:
   - L_min = min_i L_i, L_max = max_i L_i, r_L = max(ε, L_max − L_min).
   - For each L_i, compute Y_i via CIE inverse; D_i = −log10(clamp(Y_i, ε, 1)).
   - D_max = max_i D_i; r_D = max(ε, D_max).

2) For each measured point i:
   - pos_i = clamp(x_i/100, 0, 1)
   - D_L*_i = 1 − (L_i − L_min)/r_L
   - D_CIE_i = D_i / r_D
   - w_i = w(pos_i; τ, ρ)
   - actual_i = w_i·D_L*_i + (1 − w_i)·D_CIE_i

3) Target (expected) density is linear in input position:
   - expected_i = pos_i

4) Build correction across the continuous 0..1 domain using Gaussian kernel regression with a local bandwidth:
   - For any position t ∈ [0,1]:
     - residuals r_i = expected_i − actual_i
     - Local bandwidth σ(t) = clamp(0.02, α · s_local(t), 0.15), α≈3; s_local(t) is the median distance to the K nearest measured positions (K≈6).
     - weight kernel K_t(d) = exp(−d²/(2σ(t)²)), d = |t − pos_i|.
     - correction(t) = Σ_i r_i·K_t(|t − pos_i|) / Σ_i K_t(|t − pos_i|)
   - corrected(t) = clamp01(t + correction(t))
   - Sample corrected(t) for t = i/255 to produce 256 control values.

5) Anchor endpoints: samples[0] = 0, samples[255] = 1.

Notes:
- Steps 4–5 are already present in quadGEN’s LAB pipeline; this proposal only changes the “actual” computation in step 2.
- Manual L* path may use a bracket/invert step today; see Implementation Options for unification.

## Implementation Options in quadGEN

Common helper (new):

```js
const EPS = 1e-6;
function lstarToY(L) { return (L > 8) ? Math.pow((L + 16) / 116, 3) : (L / 903.3); }
function yToDensity(Y) { return -Math.log10(Math.max(EPS, Math.min(1, Y))); }
function densityLegacy(L, Lmin, Lmax) { const r = Math.max(EPS, Lmax - Lmin); return 1 - (L - Lmin) / r; }
function densityCieNorm(L, Dmax) { const D = yToDensity(lstarToY(L)); return (Dmax > EPS) ? (D / Dmax) : 0; }
function wHighlight(pos, threshold = 0.12, rolloff = 0.10) {
  const x = Math.max(0, Math.min(1, (pos - threshold) / Math.max(EPS, rolloff)));
  const s = x*x*x*(x*(6*x - 15) + 10);
  return 1 - s;
}
function hybridDensity(L, pos, ctx) {
  const DL = densityLegacy(L, ctx.Lmin, ctx.Lmax);
  const DC = densityCieNorm(L, ctx.Dmax);
  const w = wHighlight(pos, ctx.threshold, ctx.rolloff);
  return w*DL + (1 - w)*DC;
}
```

Context (compute once per import):

```js
function buildHybridContext(measuredLValues, opts = {}) {
  const Lmin = Math.min(...measuredLValues);
  const Lmax = Math.max(...measuredLValues);
  const Dmax = Math.max(...measuredLValues.map(L => yToDensity(lstarToY(L))));
  const threshold = (opts.threshold ?? 0.12);
  const rolloff   = (opts.rolloff   ?? 0.10);
  return { Lmin, Lmax, Dmax, threshold, rolloff };
}
```

### Option A — Minimal change

- LAB .txt path (around quadgen.html ~12295–12325):
  - Replace `actualDensity = 1 - ((L - minLab)/labRange)` with `actualDensity = hybridDensity(L, pos, ctx)`.
  - Compute `ctx = buildHybridContext(labValues)` once.

- Manual L* path (around ~15270–15305):
  - Build `actualDensity[i] = hybridDensity(L_i, pos_i, ctx)` and feed the existing bracket/invert logic.

Pros: smallest diff; preserves current Manual L* inversion.

### Option B — Unified engine (recommended)

- Introduce a shared `computeCorrectionFromLabPairs(pairs, opts)` that implements the Algorithm section and returns the standard `{ domainMin, domainMax, samples, originalData, format }` object.
- Wire both LAB .txt and Manual L* to this function with `opts.mapping = 'hybrid'` and pass `opts.threshold/rolloff`.
- Benefits: identical smoothing, anchoring, and metadata across both ingestion modes.

## Parameters & Defaults

- `threshold τ`: 0.12 (12% input) — start blend after deep highlights.
- `rolloff ρ`: 0.10 (10% span) — complete hand‑off by ~22% input.
- `EPS`: 1e−6 — clamp to avoid division by zero and log(0).
- Gaussian radius σ: keep the current default (≈0.15) used by the adaptive kernel; no additional UI slider required.

Expose τ and ρ as advanced controls in Global Corrections; persist via localStorage. Recommended defaults above.

## Edge Cases & Guards

- Degenerate L*: if `Lmax ≈ Lmin`, set `DL = 0.5` (or fall back to CIE branch); show a warning about insufficient range.
- Very low Y: clamp Y with `EPS` before `log10` to avoid `Infinity`.
- Out‑of‑order inputs: sort by x% prior to processing (already done).
- Sparse data (N < 3): Gaussian/RBF still works; consider increasing σ or warn user.

## UI/UX

- Mapping label: “Hybrid (Legacy highlights + CIE density)”.
- Advanced: sliders for “Highlight threshold” and “Transition width”.
- Badge near Global Corrections info: `Mapping: Hybrid (τ=12%, ρ=10%)`.
- Persist UI choices to `LAB_MAPPING_METHOD='hybrid'`, `LAB_MAPPING_THRESHOLD`, `LAB_MAPPING_ROLLOFF`.

## Expected Impact

- Highlights (0–~10%): parity with current behavior; same “arrival” speed.
- Mid/shadows (≥~20%): stronger emphasis, faster shadow convergence; slightly firmer last 3–5 steps.
- Noise: highlight noise unchanged; shadow noise may be more visible in raw residuals but remains controlled by Gaussian smoothing.

## Validation Plan

- Numeric A/B on a measured wedge:
  - Compute residuals ΔL* (or Δdensity) per range: 0–10%, 10–90%, 90–100%.
  - Expect similar highlights, reduced residuals in 90–100% vs legacy.
- Visual overlays:
  - Compare corrected curves; confirm no hinge around τ and smooth transition.
- Regression:
  - Undo/redo sequences; `.quad` export unchanged; Edit Mode overlays and ordinal labels uninfluenced.

## Validation Results (Color-Muse-Data.txt)

Reproduced with the comparison tool:

- Script: `scripts/compare_density_mappings.py`
- Dataset: `data/Color-Muse-Data.txt`
- Parameters: `sigma=0.15`, `threshold=0.12`, `rolloff=0.10`

Results summary:

- Residuals (mean |expected − actual|) at measured points:
  - legacy: highlights 0.04446, mid 0.08846, shadows 0.01738
  - hybrid: highlights 0.04446, mid 0.05799, shadows 0.00558
  - cie:    highlights 0.03939, mid 0.05795, shadows 0.00558

- Correction curve magnitude (mean |corrected(t) − t|):
  - legacy: highlights 0.06008, mid 0.06150, shadows 0.04913
  - hybrid: highlights 0.07195, mid 0.04502, shadows 0.00544
  - cie:    highlights 0.06135, mid 0.04354, shadows 0.00544

- Midtone slope at t≈0.5 (1.0 = identity):
  - legacy 0.62416, hybrid 0.69270, cie 0.69455

- Pairwise RMS difference between corrected curves:
  - legacy vs hybrid: 0.070461
  - legacy vs cie:    0.069769
  - hybrid vs cie:    0.004280

Interpretation:

- Highlights: Hybrid matches legacy residuals by design; CIE is slightly less corrective in this region (as expected).
- Midtones: Hybrid/CIE reduce mid correction magnitudes and increase midtone slope toward identity.
- Shadows: Hybrid/CIE substantially reduce shadow residuals and required corrections versus legacy.


## Worked Example (indicative)

Given L_min=95, L_max=15; L* at 5% = 92, at 50% = 55, at 95% = 20.

- Legacy densities: D_L*(5%)≈0.075, D_L*(50%)≈0.52, D_L*(95%)≈0.94.
- CIE Y via piecewise, D via −log10(Y); normalize by D_max from the set.
- w(5%)≈1 → actual≈D_L*; w(50%)≈~0.2 → mostly CIE; w(95%)≈0 → pure CIE.
- Net result: highlights identical; deeper tones favor CIE density.

## Pseudocode (end‑to‑end)

```js
function computeHybridCorrection(pairs, opts={}) {
  const sorted = pairs.slice().sort((a,b) => a.input - b.input);
  const Ls = sorted.map(p => p.lab);
  const ctx = buildHybridContext(Ls, opts);
  const positions = sorted.map(p => Math.max(0, Math.min(1, p.input/100)));
  const actual = sorted.map((p, i) => hybridDensity(p.lab, positions[i], ctx));
  const expected = positions.slice();
  const residuals = expected.map((e, i) => e - actual[i]);
  const sigma = opts.radius ?? 0.15;
  const samples = new Array(256);
  for (let k = 0; k < 256; k++) {
    const t = k/255;
    let num = 0, den = 0;
    for (let i = 0; i < sorted.length; i++) {
      const d = Math.abs(t - positions[i]);
      const w = Math.exp(-(d*d) / (2*sigma*sigma));
      num += residuals[i] * w;
      den += w;
    }
    const corr = den > 0 ? num/den : 0;
    samples[k] = Math.max(0, Math.min(1, t + corr));
  }
  samples[0] = 0; samples[255] = 1;
  return { domainMin: 0, domainMax: 1, samples, originalData: sorted, format: 'LAB (hybrid mapping)' };
}
```

## Performance

- O(N·256) reconstruction as today; no extra asymptotic cost. Helper calculations are O(N).
- Can share precomputed arrays (positions, residuals) between updates; kernel radius changes reweight only.

## Risks & Mitigations

- Parameter sensitivity: defaults τ=0.12, ρ=0.10 empirically safe. Expose as advanced.
- Extremely weak dynamic range: warn and fall back to legacy mapping for stability.
- User confusion: display mapping badge and document behavior in Help.
