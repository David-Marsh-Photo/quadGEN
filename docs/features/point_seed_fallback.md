# Smart Key Point Seeding Guardrails

## Overview
Operators have reported that loading monotonic `.quad` curves (e.g., `data/KCLK.quad`) and toggling Edit Mode can collapse the plotted channel to a straight ramp from `(0, 0)` to `(100, inkLimit)`. The behavior stems from fallback seeding paths that emit only the default two endpoints when primary sampling fails or cached Smart metadata suppresses reseeding. This document captures the guard clauses, fallbacks, and verification steps required to deliver a 95 % confidence fix without disrupting normal Smart-curve workflows.

## Failure Modes
- **Sample acquisition failure** – `sampleLinearizedCurve()` can’t resolve `make256` and returns `null`. `initializeEditModeForChannels()` then falls back to `createDefaultKeyPoints()` (see `src/js/ui/edit-mode.js:1910-2010`), producing a straight ramp.
- **Over-permissive “linear” detection** – `extractAdaptiveKeyPointsFromValues()` normalizes samples against `TOTAL` instead of the channel peak. For low-limit curves the plateau looks linear, so the simplifier keeps only endpoints (see `src/js/curves/smart-curves.js:642-710`).
- **Stale Smart metadata** – `smartTouched=true` combined with default-ramp points blocks reseeding (`initializeEditModeForChannels()` skips regeneration at `src/js/ui/edit-mode.js:1661-1684`).
- **Percent/end desync** – If `persistSmartPoints()` stores relative points while the channel’s percent baseline is zero, `regenerateSmartCurveSamples()` rebuilds a ramp even though the underlying data was non-linear.

## Implementation Plan
1. **Reliable sample capture**
   - Harden `sampleLinearizedCurve()` by importing `make256` directly as a last resort and emitting a warning when the helper lookup fails.
   - When sampling returns `null`, copy `getLoadedQuadData().curves[channel]` as the source array before reverting to defaults.
2. **Adaptive simplifier accuracy**
   - Pass the channel’s actual max (baseline end or peak) as `scaleMax` so plateau segments remain visible to RDP simplification.
   - If the simplifier yields ≤ 2 points, recompute with a smaller error tolerance; only accept the default ramp after logging a warning.
3. **Metadata sanity checks**
   - Detect `smartTouched` channels whose stored points equal `createDefaultKeyPoints()`. Clear `smartTouched` and reseed when the loaded `.quad` curve deviates beyond a small delta (e.g., > 0.5 % absolute).
   - Ensure percent/end baselines are restored before persisting Smart points; if the resolved percent is `0`, abort the persist and surface a status message.
4. **Post-seed validation**
   - After persisting points, regenerate Smart samples and compare against the source curve. If max deviation exceeds tolerance, trigger a reseed attempt with stricter settings or embed the missing plateau point explicitly (sample mid-tones and append if absent).
5. **Telemetry & user feedback**
   - Add console warnings for each fallback (null sample, default ramp, metadata skip) to aid future diagnostics without impacting UI.

## Verification Strategy
- **Automated** – Add a Playwright smoke test that loads `data/KCLK.quad`, toggles Edit Mode, and asserts the first 128 Smart samples remain zero while the endpoint equals the ink limit.
- **Unit/Integration** – Extend Smart-curve extraction tests to cover low-limit plateau datasets and confirm the simplifier returns ≥ 3 points.
- **Manual** – Run `docs/manual_tests.md` Edit Mode checklist with a monotonic `.quad` and verify the plateau survives recompute/undo.

## Risk Mitigation
- Gate new logs behind `DEBUG_LOGS` for noise control.
- Keep fallback logic additive; default ramp remains only as a last resort after all recovery attempts fail.
- Maintain current Smart metadata shape to avoid breaking undo history or existing save files.

Following this plan keeps the Smart seeding pipeline resilient and gives a 95 % confidence fix window without altering expected day-to-day editing flow.

## Implementation Status
- **Completed (staged)**:
  - Hardened `resolveSeedingSamples()` to fall back to stored `.quad` samples when `make256` bridges are missing and rewired `sampleLinearizedCurve()` to prefer plateau data when helper output diverges.
  - Extended `deriveSeedPointsFromSamples()` with plateau anchor injection so monotonic plateaus now yield richer Smart sets instead of collapsing to a 2-point ramp.
  - Added a linearity guard in `seedChannelFromSamples()` to reject 2-point extractions when the source samples are non-linear, plus debug surfacing via `__EDIT_LAST_SEED`.
  - Playwright regression (`tests/e2e/edit-mode-kclk-plateau.spec.ts`) now passes, confirming the K plateau survives Edit Mode even with `make256` removed.
  - `seedChannelFromSamples()` now runs through the same KP_SIMPLIFY parameters used by the UI “Compute” flow (max error / max points) and only retries with a tighter tolerance when the regenerated curve drifts, eliminating the dense 256-point fallback while keeping plateau fidelity.
  - Converts Smart key points to absolute ink percentages using the original `.quad` samples (fallback-first) so re-sampled curves mirror the source even when channel limits are far below 100%, and captures per-channel seeding metadata in `__EDIT_SEED_AUDIT` for diagnostics.
  - Added the ceiling regression Playwright test (`tests/e2e/edit-mode-kclk-ceiling-regression.spec.ts`) and tightened Vitest coverage (`tests/ui/edit-mode-persist-seeding.test.js`) to ensure absolute amplitudes stay locked to the channel ink limit instead of drifting toward 100%.
- **Next actions**:
  - Backfill unit coverage around `ensurePlateauAnchors()` / `isSampleApproximatelyLinear()` to document the fallback math.
  - Review percent/end baseline reconciliation and `smartTouched` clearing once additional seeds (LAB/per-channel) are exercised.
