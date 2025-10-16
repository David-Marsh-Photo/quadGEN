# Composite Density Solver Specification

Status: **Canonical spec** (kept current with every solver change)

Companion material:
- `docs/features/channel-density-solver-report.pdf` — analytic appendix with figures.
- `docs/features/density_ladder_plan.md` — ladder transitions and reserve handling (see cross‑references below).

---

## 1. Purpose & Scope
The composite density solver transforms measured LAB data plus `.quad` channel draws into an ink redistribution that respects:
- each channel’s demonstrated darkening capacity (coverage ceiling + buffer),
- sequential ladder handoffs from light inks to dark inks,
- active feature guards (auto-raise, highlight protection, reserve taper, shadow easing),
- user weighting modes (Normalized, Equal, Momentum, Isolated) without reintroducing “consumable density” behaviour.

This document is the single source of truth for the solver’s inputs, outputs, guard rails, and expected telemetry. Ladder‑specific behaviour is summarised here and detailed in the dedicated ladder spec. The solver runs when operators switch ⚙️ Options → **Correction method** to **Density Solver**; Simple Scaling remains the default pipeline for LAB corrections.

---

## 2. Inputs & Terminology
| Term | Definition | Source |
|------|------------|--------|
| `labEntry` | Normalised LAB/L* measurement samples (0–100 input, 0–1 delta target) | Uploaded LAB `.txt` or manual L* |
| `.quad` curves | 256-sample draw ratios per channel | Loaded printer layout |
| `densityConstants` | Per-channel coverage ceilings (0–1) inferred from measurement + `.quad` shares | Solver |
| `coverageUsage` | Running sum of each channel’s contribution across the ramp | Solver |
| `densityLadder` | Channel ordering from lightest effective density to darkest | Solver |
| `availableCapacity` | Effective headroom after buffers/reserves | Solver |
| `perSampleCeilingEnabled` | Toggle for composite coverage guard | UI option (auto-enabled) |

All normalised values live in printer space: 0 represents paper white, 1 represents the darkest achievable density.

---

## 3. Core Flow
1. **Share extraction** — normalise `.quad` curves (`make256`) and generate per-channel share tables.
2. **Measurement deltas** — compute L* darkening between consecutive samples (respecting log-density toggle).
3. **Density constant solve**  
   - Identify “solo” regions where a channel dominates; record the cumulative darkening achieved there.  
   - Propagate that ceiling forward, clamping overshoots in mixed regions.  
   - Store constants as both raw coverage limits and ladder cues.
4. **Redistribution loop** (per sample):  
   - Evaluate target minus measurement to get required delta (`deltaDensity`).  
   - Feed into weighting mode (Normalized, Equal, Momentum, Isolated) to produce provisional shares.  
   - Apply ladder/guard logic (front reserve, blend caps, shadow easing).  
   - Clamp against available capacity / buffered ceilings, update coverage usage.  
   - Emit corrected per-channel curve deltas (converted back to 16‑bit ink steps).
5. **Debug capture** — persist summary + per-sample snapshots for UI, tests, and downstream telemetry.

---

## 4. Coverage Ceilings & Headroom
### 4.1 Ceiling computation
- `coverageLimit = densityConstants[channel]`
- `buffer = coverageLimit > 0 ? 0.005 : 0` (0.5 % absolute buffer)
- `thresholdAbsolute = coverageLimit + buffer`

Manual overrides (fixed density entries, end-value constraints) supersede solved constants; the solver reuses the smaller of the override and measured ceiling.

### 4.2 Available Capacity
`availableCapacity = thresholdAbsolute - coverageUsage[channel]`
- Negative deltas increase headroom (channel is lightening); positive deltas consume headroom.
- When per-sample reserve is active (see ladder spec) we subtract reserve requirements before exposing capacity to shares.
- Capacity snapshots are exported via `capacityBeforeNormalized`, `capacityAfterNormalized`, and `effectiveHeadroomNormalized`.

---

## 5. Smoothing, Ceilings & Release
### 5.1 Per-sample Ceiling Guard
- Enabled by default (`compositePerSampleCeiling`).  
- When disabled, solver still tracks usage but does not clamp; intended only for diag sessions.

### 5.2 Redistribution Smoothing Windows
- Window sizing constants: `REDISTRIBUTION_WINDOW_MIN = 3`, `REDISTRIBUTION_WINDOW_MAX = 9`, `REDISTRIBUTION_WINDOW_TARGET_SPAN = 0.07` (fraction of input domain).  
- The solver captures a backwards-looking ring buffer per channel; when a rung would clamp but residual delta remains, it builds a window spanning up to the target span/max samples.  
- Blend factors ease outgoing vs. incoming shares (power easing with α ≈ 1.5) while preserving per-sample delta sum.  
- Windows originate either from explicit smoothing toggles or synthetic triggers; the payload exports `{ startIndex, endIndex, inputStart, inputEnd, outgoingChannel, incomingChannels[], synthetic }`.
- Ladder promotions now trigger as soon as the outgoing rung’s remaining normalized headroom drops below 0.01 %, so darker inks only join once the lighter rung is essentially exhausted while highlights stay buffered ahead of the ceiling.

### 5.3 Release Taper
- Once headroom approaches zero the solver scales contributions using the ladder reserve release slope (see ladder spec) to avoid step discontinuities.  
- Exported via `reserveReleaseScale`, `blendCapNormalized`, and `blendAppliedNormalized`.

---

## 6. Auto-Raise & Coverage Feedback
- Auto-raise reads `coverageSummary` to decide whether a channel can absorb more ink limit; solver must refresh the summary *after* redistribution to avoid stale limits.
- Coverage diagnostics include:
  - `maxNormalized` (peak coverage usage as fraction of the ceiling),
  - `overflow` (aggregate overflow if per-sample clamp triggered),
  - `clampedSamples` (indices, input %, overflow per sample).
- UI shows coverage badge + channel table density column from this data.

---

## 7. Debug & Telemetry
- **Summary payload** exposes: weighting mode, density maxima, coverage summary map, ladder order, momentum windows, smoothing config, and auto-raise context.  
- **Snapshot payload** exposes: per-channel normalized before/after, shares, delta contributions, coverage floors/layers/allowed, reserve and blend metrics, capacity, and ladder selection/blocked reasons.
- Composite debug panel renders channel rows in `channelNames` order (see tests listed below).

---

## 8. Test Coverage
Maintainers must update/extend the following when changing solver logic:
- Unit:  
  - `tests/lab/composite-density-ladder.test.js`  
  - `tests/lab/composite-available-capacity.test.js`  
  - `tests/lab/composite-reserve-state.test.js`  
  - `tests/lab/composite-ladder-release.test.js`  
  - `tests/lab/composite-redistribution-scaling.test.js`
- Playwright:  
  - `tests/e2e/composite-normalized-density-ladder.spec.ts`  
  - `tests/e2e/composite-density-ceiling-monotonic.spec.ts`  
  - `tests/e2e/channel-density-baked-ceiling.spec.ts`  
  - `tests/e2e/composite-debug-panel.spec.ts`

Any new guard or toggle must land alongside targeted coverage.

---

## 9. Cross-References
- **Density Ladder Spec:** `docs/features/density_ladder_plan.md` (ladder addendum).  
- **Maintenance & Open Work:** see the final section of this spec for outstanding items and change-control steps.  
- **Auto-Raise defaults:** `docs/features/auto-raise.md`.

---

## 10. Change Management
- Any solver behaviour change requires:
  1. Updating this spec (describe change, rationale, new telemetry).  
  2. Updating ladder spec if reserve/ladder behaviour shifts.  
  3. Capturing any follow-up notes in AGENTS.md (solver section) so assistant workflows stay in sync.  
  4. Re-running smoke + targeted tests listed above.

Failure to update this doc counts as regression debt.
| 90 % | 1.41 | K 73.5 %, LK 24.3 %, C 2.3 % | Shadows are driven by K, so the remaining density is credited to the black channel while LK contributes a smaller share. |

Walking the full ramp and attributing each positive ΔL* to the channels according to their shares yields approximate cumulative contributions of **LK 63.5 %**, **K 20.9 %**, and **C 15.6 %** of the total darkening. The solver treats the 65 % step—where the print briefly lightens—as noise, so it does not reduce any channel’s accumulated credit. These percentages become the working weights: LK keeps the largest headroom thanks to its dominant highlight performance, K inherits most of the shadow density, and C is capped to the midtone support it actually provided.

## Density Constant Calibration
To tighten the attribution, we add a second pass that estimates a standalone density constant for each channel—the maximum share of darkening that ink can deliver when it is the dominant contributor. The calibration proceeds in the order channels enter the mix:

1. **Lock the highlight anchor.** Identify highlight steps where a single ink exceeds the dominance threshold (≥90 % share). The cumulative ΔL* demonstrated there defines that channel’s density ceiling. For TRIFORCE, LK alone produces roughly 8 % of the total darkening, so its constant lands near 0.08.
2. **Solve for midtone entrants.** Move to the next channel that accumulates meaningful share (C in TRIFORCE). At each candidate step, subtract the contribution the already-calibrated ink (LK) could provide at its ceiling, then attribute the remainder to the newcomer. Across the 25–40 % input range, that residual accounts for roughly another 15 % of the total density, so C inherits a constant close to 0.15.
3. **Assign the shadow anchor.** The remaining density is credited to the late-arriving channel (K). Past 70 % input the residual after subtracting LK and C approaches the full darkening required for maximum black, so K’s constant settles near 0.77, effectively capturing the rest of the tonal budget.

These constants act as hard ceilings when redistributing LAB corrections: an ink can never be assigned more output density than it has demonstrated in isolation, even if its share spikes later in the ramp. They also provide a richer signal than cumulative weights because they capture how aggressively each channel darkens the print when given free rein. The solver adds a 0.5 % normalized darkness buffer before marking a channel “at ceiling” so measurement noise or tiny over-shoots do not cause a false cutoff.

## Core Measurements per Channel
- **Channel share** `channelShare(i)` – per-input fraction of total ink draw (`draw_channel(i) / Σ draw_all(i)`), capped at 0 when the total is zero.
- **Dominance windows** – contiguous input spans where `channelShare ≥ dominanceThreshold` (default 0.85–0.90) indicating the channel is effectively solo.
- **Solo ceiling** `soloMaxDensity` – sum of incremental density (`ΔDensity`) within dominance windows; represents the maximum darkening the channel has demonstrated on its own.
- **Coverage ceiling / buffer** – rolling cap of how much density the channel can claim when it appears with others. Allocations are clamped so `assignedDensity + allocation ≤ soloMaxDensity + 0.005`, and any value above `soloMaxDensity` is treated as buffer-only overflow that never compounds in later steps.
- **Cumulative density** – running total of assigned contributions so later samples respect per-channel ceilings and overall measured density.

## Solver Outline
1. **Compute incremental density**  
   - Calculate `ΔDensity(i)` from the measured L* sequence (or log-density) as the change from the previous input. Treat measurement noise with a small deadband.
2. **Identify dominance windows**  
   - Scan inputs; when a channel’s share exceeds the dominance threshold, accumulate that interval’s `ΔDensity` into `soloMaxDensity`.
   - If no dominance window exists, seed the ceiling with a minimal epsilon to keep the solver stable.
3. **Distribute mixed intervals**  
   - Form the corrective delta as `ΔDensity_target(i) = targetDensity(i) − measuredDensity(i)`; the weighted baseline density is no longer the driver.
   - Apportion that delta across active channels in proportion to their shares/weights.
   - Clamp each channel’s allocation so `assignedDensity + allocation ≤ soloMaxDensity`; any leftover density goes to channels that still have headroom (e.g., shadow channels like K).
4. **Track cumulative totals**  
   - Maintain `assignedDensity[channel]` across the ramp; this prevents midtone-only inks from exceeding the density they have already proven.
5. **Derive weights**  
   - Normalize each channel’s cumulative contribution against the total measured density to form weights for redistribution or guard-rail logic. During correction application, a zero delta remains zero for every channel even if a weight is large.

## Safeguards & Considerations
- **Threshold tuning** – Dominance cutoff should be configurable; 0.85 handles highlight splits, while lower thresholds capture softer transitions.
- **Zero-draw intervals** – Skip steps where all draws are zero; they carry no density signal.
- **Measurement noise** – Apply smoothing or hysteresis to `ΔDensity` so small L* fluctuations do not imply phantom density.
- **Late-arriving channels** – If a channel never dominates, use its highest share interval as a proxy ceiling, but keep weight minimal.
- **Black anchor** – When the shadow channel (e.g., K) dominates near 100 % input, it legitimately absorbs nearly all remaining density—this is the reference for full black.
- **Highlight guard toggle** – A legacy safeguard that fell back to live ink shares when a channel’s normalized draw was ≤ 12 % is now optional. Use `enableCompositeHighlightGuard(true|false)` (default `false`) if you need the original guard behaviour for extremely sparse highlight ramps.
- **Identity guard** – When operators set the LAB smoothing slider to 0 %, the parser skips Gaussian blending so perfectly linear references stay linear (`ΔDensity_target = 0`), making it easy to confirm the redistribution leaves neutral fixtures untouched.

## Coverage Tracking & Telemetry
- `compositeLabSession.densityCoverage` stores per-channel `{ limit, buffer, bufferedLimit, used, remaining, bufferedRemaining, overflow }` so downstream tooling can reason about handoffs.
- `getCompositeCoverageSummary()` (also available via `LinearizationState.getCompositeCoverageSummary()` and `window.getCompositeCoverageSummary`) returns a cloned snapshot for UI panels, agents, or manual QA scripts.
- The composite debug summary mirrors the same data under `coverageSummary`, `coverageLimits`, and `coverageBuffers`, enabling Playwright specs and console diagnostics to verify when an ink hits its ceiling.
- Overflow is tracked separately from limit usage—operators can audit whether a channel consumed buffer-only headroom (good for noise absorption) or legitimately hit its declared ceiling.

## Manual Density Inputs & Compute Flow
- The channel table exposes optional Density fields (0–2 range). Defaults load with K/MK at 1.00, C at 0.21, LK at 0.054; other channels start blank so the solver can infer them.
- Each entry records `{ value, source }`, where `source` is `manual`, `solver`, or `computed`. Manual edits immediately override solver-derived constants and persist through undo/redo.
- The **Compute** button runs the density-constant solver for any channels whose field is blank or zero, writing back the inferred value and tagging `source = 'solver'`.
- Manual edits while global scale is active refresh scaling baselines so downstream End adjustments remain accurate.
- Undo/redo and “Revert to measurement” flows capture density input changes alongside curve history; clearing a `.quad` or loading a new measurement resets unspecified fields to blank.
- Telemetry: `compositeLabSession.densityCoverage.manualSources` and the composite debug panel annotate which channels used manual vs solver constants so QA screenshots capture context.
- Automated coverage: Vitest suite `tests/core/composite-density-inputs.test.ts` exercises manual overrides and compute behavior; Playwright spec `tests/e2e/channel-density-auto-compute.spec.ts` verifies the UI flow.

## Integration Hooks
- Feed the resulting per-channel weights into `finalizeCompositeLabRedistribution` (or equivalent) instead of equal-share or pure-density heuristics.
- Persist `soloMaxDensity` and `assignedDensity` metadata so Edit Mode and undo/redo preserve context.
- Surface diagnostics in the LAB import panel (e.g., “LK demonstrated 12 % of total density; capped during composite redistribution”).
- Debug helper: `getCompositeDensityProfile(inputPercent)` (also exposed on `window.getCompositeDensityProfile`) reports the normalized per-channel shares, cumulative usage, and density constants for any input step.

## Maintenance & Open Work

### Delivered to date
- Unified `availableCapacity` telemetry threaded through redistribution and the composite debug panel.
- Floating ceilings, reserve-aware headroom, front-reserve release taper, and blend caps for ladder promotions/shadow easing.
- Weighting modes (Normalized, Equal, Momentum, Isolated) consolidated on the same ladder/reserve infrastructure.
- Composite debug panel upgraded with capacity/reserve/blend telemetry and stable channel ordering, plus expanded Vitest + Playwright coverage.

### Outstanding items
1. **Guard precedence cleanup** — enforce clamp order `availableCapacity → release taper → momentum → end limit`, delete legacy guard code paths, and assert the precedence via unit tests and updated diagrams.
2. **Shadow reserve deep dive** — probe aggressive negative-delta datasets to confirm reserve easing never overcompensates; add fixtures if real workloads expose gaps.
3. **Documentation touch-ups** — keep the manual regression matrix, Help → Version History, and this spec aligned; remove any lingering references to the retired consumable-density model.
4. **Validation cadence** — continue periodic headful verification on `P800_K36C26LK25_V6` and TRIFORCE fixtures after significant solver tweaks, and ensure `scripts/headful-capture-normalized-ladder.mjs` matches the snapshot ranges referenced in tests.
5. **Exploratory tooling** — extend `scripts/analyze_composite_weighting.cjs` and companion analysis scripts to cover new datasets, highlight dominance thresholds, and surface per-channel ceilings before enabling optional UI affordances.

### Change control
When tackling an outstanding item:
1. Update this spec (and `docs/features/density_ladder_plan.md` or `docs/features/solver_diagram.md` when applicable).
2. Extend or adjust automated coverage (Vitest + Playwright) so regressions stay caught.
  3. Capture results in AGENTS.md (solver section) and note milestone completion in the relevant engineering log.
4. Run the solver release gate: `npm run build:agent`, `npm run test`, `npm run test:e2e`, and `npm run test:smoke`.
5. Refresh headful captures and composite debug artifacts for studio review.

Once the outstanding items are resolved, the roadmap folds entirely into this canonical spec.
