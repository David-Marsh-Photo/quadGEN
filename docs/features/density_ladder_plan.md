# Density Ladder & Transition Spec

Status: **Canonical addendum** (kept current alongside `channel-density-solver.md`)

This document defines how the composite density solver walks the ladder, manages reserves, and blends promotions between inks. All terminology matches the Composite Density Solver Specification.

---

## 1. Ladder Overview
- **Ordering** — derived from solved density constants (lightest → darkest). Example: P800 uses `LK → C → K`. Ladder indices ship through `ladderOrderIndex`.
- **Modes** — Normalized weighting (default) follows the ladder automatically; Equal, Momentum, and Isolated weighting reuse the same ladder/reserve infrastructure so behaviour stays consistent.
- **Terminology**  
  - *Rung*: a single channel in ladder order.  
  - *Front reserve*: headroom buffer the outgoing rung keeps so highlights remain stable.  
  - *Blend window*: sample span where the incoming rung ramps up while the outgoing rung tapers.

---

## 2. Positive-Delta Promotions
1. While `effectiveHeadroom > reserveAllowanceRemaining`, keep the current rung active.  
2. When headroom falls below the reserve allowance trigger (`FRONT_RESERVE_RELEASE_TRIGGER`, default 1.0 × reserve), activate the next rung.  
3. Limit the newcomer with a per-sample cap (`BLEND_CAP_NORMALIZED = 0.0008`) and track progress via `blendProgress/blendWindow` so its share grows smoothly.  
4. Outgoing rung decays using the release taper (section 4) rather than a hard cut, preventing LK cliffs.
5. Promotion now also kicks in once the lighter rung’s available capacity ≤ 0.0001 normalized (≈0.01 % of its density ceiling), keeping ladder hand-offs ahead of the hard ceiling.

---

## 3. Negative-Delta Behaviour
- Shares remain proportional to baseline plus momentum bias until reserve debt is repaid.  
- Once `reserveAllowanceRemaining <= 0`, darker rungs can assist in lightening via shadow blends (section 5).  
- When a rung regains headroom it resumes with the same blend cap, keeping the curve continuous.

---

## 4. Reserve Handling
- Base reserve (`frontReserveBase = 0.0125` normalized) sits ahead of the current sample.  
- Reserve state per channel: `approaching`, `within`, `exhausted`.  
- `reserveAllowanceRemaining` and `reserveAllowanceNormalized` record outstanding reserve.  
- `effectiveHeadroomNormalized` subtracts the reserve before the solver evaluates promotions.

Tests: `tests/lab/composite-reserve-state.test.js`, `tests/lab/composite-available-capacity.test.js`.

---

## 5. Release Taper
- Outgoing rung decays over `RELEASE_WINDOW = 9` samples with geometric falloff (`RELEASE_DECAY = 0.85`).  
- Applied amount is exported via `blendAppliedNormalized`; active cap via `blendCapNormalized`.  
- Ensures the hand-off between LK and C (and subsequent rungs) is a glide, not a drop.

Tests: `tests/lab/composite-ladder-release.test.js`, `tests/e2e/composite-normalized-density-ladder.spec.ts`.

---

## 6. Shadow Ease-In
- When a darker rung joins, a secondary cap (`shadowBlendCapNormalized`) with window (`SHADOW_BLEND_WINDOW = 11`) limits its initial share.  
- `shadowBlendFromChannel` identifies which rung is lending density.  
- Prevents spikes when dense inks (e.g., K) first appear.

Tests: `tests/lab/composite-negative-ease.test.js`, `tests/e2e/composite-negative-ease.spec.ts`.

---

## 7. Weighting Modes
- **Normalized** — default; relies entirely on ladder order, reserves, and blend caps.  
- **Equal** — ladder guards remain active, so lighter inks stay engaged until their reserve plus headroom is exhausted (`tests/e2e/composite-equal-activation.spec.ts`).  
- **Momentum** — momentum bias layers on top of ladder caps; does not bypass reserve allowance (`tests/e2e/composite-momentum-weighting.spec.ts`, `tests/lab/composite-density-profile.test.js`).  
- **Isolated** — bypasses ladder sequencing intentionally; use only for diagnostics.

---

## 8. Smoothing Interplay
- Ladder promotions may inject `smoothingWindows` when clamps are synthetic or when the options toggle is active.  
- Composite debug panel displays reserve, blend, and shadow metrics per channel; rows follow the base channel order to maintain readability.

---

## 9. Debug & Telemetry
- `ladderSelection` — rungs currently providing density (`normalizedApplied`).  
- `ladderBlocked` — reasons promotions were denied (`reserve`, `capacity`, `shadowGuard`, `endLimit`).  
- `pendingBlendCap`, `blendWindow`, `blendProgress` — per-sample cap status.  
- `reserveReleaseScale`, `reserveAllowanceRemaining` — expose proactive easing before crest.

---

## 10. Maintenance Checklist
Whenever ladder behaviour changes:
1. Update this spec (affected sections).  
2. Update `channel-density-solver.md` if coverage/headroom maths shift.  
3. Refresh targeted unit + Playwright tests listed in sections above.  
4. Record the change in AGENTS.md (solver section) alongside any engineering log entries.  
5. Update the Maintenance & Open Work section in `docs/features/channel-density-solver.md` if new follow-up work is required.

---

## 11. Related Documents
- `docs/features/channel-density-solver.md` — primary solver specification.  
- `docs/features/auto-raise.md` — auto-raise defaults and coverage reporting.  
- `docs/features/solver_diagram.md` — systems diagram and historical analysis.
