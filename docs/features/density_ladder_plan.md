# Density Ladder & Transition Spec

Status: **Canonical addendum** (kept current alongside `channel-density-solver.md`)

This document defines how the composite density solver walks the ladder, manages reserves, and blends promotions between inks. All terminology matches the Composite Density Solver Specification.

---

## 1. Ladder Overview
- **Ordering** — derived from solved density constants (lightest → darkest). Example: P800 uses `LK → C → K`. Ladder indices ship through `ladderOrderIndex`.
- **Shares** — the single normalized path starts from the baseline `.quad` mix, then follows the density ladder automatically as channels exhaust capacity.
- **Terminology**  
  - *Rung*: a single channel in ladder order.  
  - *Front reserve*: headroom buffer the outgoing rung keeps so highlights remain stable.  
  - *Blend window*: sample span where the incoming rung ramps up while the outgoing rung tapers.

---

## 2. Positive-Delta Promotions
1. While `effectiveHeadroom > reserveAllowanceRemaining`, keep the current rung active.  
2. When the lighter rung reaches its reserve/capacity threshold, activate the next rung.
3. Limit the newcomer with a per-sample cap (`BLEND_CAP_NORMALIZED = 0.0008`) and track progress via `blendProgress/blendWindow` so its share grows smoothly.  
4. Outgoing rung decays using the release taper (section 4) rather than a hard cut, preventing LK cliffs.
5. Promotion now also kicks in once the lighter rung’s available capacity ≤ 0.0001 normalized (≈0.01 % of its density ceiling), keeping ladder hand-offs ahead of the hard ceiling.

---

## 3. Negative-Delta Behaviour
- Shares remain proportional to the baseline mix until reserve debt is repaid.
- Once `reserveAllowanceRemaining <= 0`, darker rungs can assist in lightening via shadow blends (section 5).  
- When a rung regains headroom it resumes with the same blend cap, keeping the curve continuous.

---

## 4. Reserve Handling
- Dynamic base reserve (`frontReserveBase`, capped at `0.035` normalized) sits ahead of the current sample.
- Reserve state per channel: `approaching`, `within`, `exhausted`.  
- `reserveAllowanceRemaining` and `reserveAllowanceNormalized` record outstanding reserve.  
- `effectiveHeadroomNormalized` subtracts the reserve before the solver evaluates promotions.

Tests: `tests/lab/composite-reserve-state.test.js`, `tests/lab/composite-available-capacity.test.js`.

---

## 5. Release Taper
- Reserve release tapers between roughly 9× and 1× the dynamic base reserve; reserve history decays by `0.9` when headroom contracts.
- Applied amount is exported via `blendAppliedNormalized`; active cap via `blendCapNormalized`.  
- Ensures the hand-off between LK and C (and subsequent rungs) is a glide, not a drop.

Test: `tests/lab/composite-ladder-release.test.js`.

---

## 6. Shadow Ease-In
- When a darker rung joins during negative redistribution, a secondary cap (`shadowBlendCapNormalized`) grows over a six-sample window and limits its initial share.
- `shadowBlendFromChannel` identifies which rung is lending density.  
- Prevents spikes when dense inks (e.g., K) first appear.

Test: `tests/lab/composite-negative-ease.test.js`.

---

## 7. Normalized Shares
The supported solver mirrors the baseline channel mix, then lets ladder order, reserves, capacity, and blend caps determine handoffs. There is no user-selectable or persisted weighting mode.

---

## 8. Smoothing Interplay
- Ladder promotions may inject `smoothingWindows` when clamps are synthetic or when the options toggle is active.  
- Headless composite snapshots expose reserve, blend, and shadow metrics per channel for slope-kernel locking and focused diagnostics.

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
3. Adjust the lowest existing test only when the behavior contract changes.
4. Update the Maintenance & Open Work section in `docs/features/channel-density-solver.md` if a concrete follow-up remains.

---

## 11. Related Documents
- `docs/features/channel-density-solver.md` — primary solver specification.  
- `docs/features/auto-raise.md` — auto-raise defaults and coverage reporting.  
- `docs/features/solver_diagram.md` — systems diagram and historical analysis.
