# Composite Redistribution Solver – Systems Map

This report inventories every active rule that shapes the composite redistribution pass so we can see where overlapping policies introduce the “fix one cliff, reveal another” behavior the studio keeps encountering.

## 1. High-Level Flow

```
LAB delta / ink delta request
            │
            ▼
  Weighting mode & ladder assembly
    (normalized default, manual overrides, momentum)
            │
            ▼
  Candidate preparation
    • Baseline shares (if > ε)
    • Ladder fallbacks (light → dark)
    • Negative deltas reverse ladder
            │
            ▼
  Per-channel guards
    • End limit clamp
    • Coverage limit + buffer
    • Floating ceiling (cumulative coverage)
            │
            ▼
  Reserve system
    • Front reserve base (≈3.5%)
    • Applied reserve + darker-headroom
    • Effective headroom (raw − reserve)
    • Release taper coefficient
            │
            ▼
  Redistribution loop
    • applyNormalizedDelta (per rung)
    • Momentum (optional)
    • Per-sample ceiling (global flag)
            │
            ▼
  Post-pass smoothing
    • Smoothing windows (if enabled)
    • Reserve release bookkeeping
            │
            ▼
  Debug snapshot + coverage summary
```

## 2. Active Constraints (Today)

| Layer | Mechanism | Purpose | Interaction Hotspots |
| --- | --- | --- | --- |
| Weighting | Equal / Normalized / Momentum modes | Choose starting shares | Normalized now default; zero-share rungs immediately ladder to next ink. |
| Ladder ordering | Density ladder (light → dark) | Enforce LK → C → K ordering | Shares jump when a rung saturates because next rung takes full remainder. |
| Floating ceiling | `coverageFloorNormalized + layerNormalized <= buffered limit` | Prevent consumable-density regression | Requires per-sample bookkeeping; combines with reserve to produce sharp cutovers. |
| Front reserve | `frontReserveBase` (≈0.035) + `frontReserveApplied` | Hold highlight headroom to soften exits | When raw headroom < reserve, effective headroom hits zero even if raw > 0. |
| Effective headroom | `headroomNormalized − active reserve` | Gate ladder promotion | Creates sudden “no capacity” state the moment reserve outweighs remaining headroom. |
| Reserve release taper | Scale LK delta once effective headroom < ~9× reserve | Slow the fall-off after crest | Works only after ladder already saturated; doesn’t mitigate front-side surge. |
| Release smoothing | Optional window (`isRedistributionSmoothingWindowEnabled`) | Even out sudden changes over ~3 samples | No effect when guard forces delta to zero (e.g., effective headroom = 0). |
| Per-sample ceiling flag | `isCompositePerSampleCeilingEnabled` | Keep clamps active even in equal weighting | If disabled, floating ceiling still clamps due to ladder bookkeeping. |
| Momentum | `computeChannelMomentum` | Maintain directionality | Adds another gate that can fight ladder decisions during sign flips. |
| Auto-raise / End limits | `scaleChannelEndsByPercent`, end guard | Ensure End isn’t exceeded | When global scale is active, can reduce available headroom before ladder runs. |

### Key overlaps

1. **Front reserve vs. floating ceiling** – Reserve consumes the same headroom the floating ceiling is trying to manage, so the effective allowance can collapse even though cumulative coverage has not actually touched the buffered limit. Result: the ladder promotes the next rung in a single step (sharp rise for C at snapshots 17–18).
2. **Reserve taper vs. idle samples** – Once effective headroom hits zero the redistribution loop no longer applies any delta, so smoothing/tapering has nothing to work with; the plotted curve simply inherits the baked baseline (snapshots 37+).
3. **Negative delta logic vs. reserve state** – The moment deltas turn negative (snapshot 148) the guard swings to the darkest rung (K) because lighter rungs are blocked by “heavier usage.” The downstream curve sees another discontinuity even though K’s headroom changed only slightly.

## 3. Why Fixes Keep Surfacing New Cliffs

- **Sequential clamps with different priorities**: each subsystem (floating ceiling, reserve, taper, momentum) owns its own decision point. When one subsystem gets adjusted, another one still fires with its original thresholds, so we simply move the discontinuity down the pipeline.
- **All-or-nothing handoffs**: normalized weighting plus ladder fallbacks deposit the full residual delta into the next channel instead of ramping it. The system lacks a notion of “blend” between rungs, so even with floating ceilings in place, the first sample after a ceiling breach is still abrupt.
- **Reserve bookkeeping duplicates coverage math**: we now track both `headroomNormalized` and `effectiveHeadroomAfter`, but only the latter controls promotion. When they diverge, the UI shows remaining headroom yet the solver declares the channel done, which feels like a regression to consumable-density logic.
- **Sign-change asymmetry**: positive deltas obey the ladder order and reserves, but negative deltas pivot straight to the darkest ink with minimal buffering. Each fix on the highlight side can produce a fresh cliff on the shadow side.

## 4. Suggested Next Steps

1. **Unify headroom accounting** – Define a single “available capacity” value (e.g., `capacity = min(buffered limit − cumulative coverage, effective headroom)`) and drive every guard off that. That removes the reserve vs. floating ceiling tug-of-war.
2. **Blend ladder promotions** – Instead of handing the full residual delta to the next rung, gradually increase its share while simultaneously tapering the current rung (e.g., via a short moving average or controlled ramp). This would eliminate the sample-to-sample spikes at snapshots 17–18 without relying on ad-hoc reserve math.
3. **Tri-state reserve behavior** – Distinguish between “approaching reserve,” “within reserve,” and “exhausted.” Allow limited positive deltas while inside the reserve band so clamps don’t drop to zero instantly.
4. **Mirror smoothing on sign flips** – Before negative deltas trigger the darkest rung, run a quick easing step that reduces lighter-channel contributions over a few samples. That should suppress the K spike at snapshot 148.
5. **Document guard precedence** – Capture a definitive order (e.g., `capacity` → release taper → momentum → end-limit) so future changes can reason about the single place where a clamp happens, instead of guessing which subsystem won.

With this map we can now trim redundant guards and design a unified ladder solver instead of continuing to layer additional safety nets that fight each other. Let me know if you’d like follow-up experiments along those five recommendations.
