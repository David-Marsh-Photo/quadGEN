# Correction vs. Intent Guidance

## Purpose
- Clarify the distinction between **corrections** (measurement-driven tuning) and **intents** (target tone shaping) to prevent workflow confusion.
- Provide quick talking points for onboarding techs and Lab Tech automations.

## Conceptual Summary
- **Correction** = tuning: measurement ingestion (LAB/Manual L*, CGATS) adjusts curves so the printer behaves predictably in a neutral space.
- **Intent** = interpretation: once tuned, presets or custom targets reshape tone response for creative goals without re-ingesting measurements.

## User-Facing Entry Points
- Corrections: Global Corrections panel (`Load Data File`, `Enter L* Values`), per-channel measurement toggles, Smart recompute.
- Intents: `Intent` dropdown, Intent modal, `apply_intent_to_loaded_quad` button when measurement data is absent.

## Practical Workflow Guidance
1. Linearize first (apply corrections) to achieve a neutral baseline.
2. Choose an intent to express the desired tonal feel (Linear, Soft, Hard, Filmic, Custom).
3. If additional contrast shaping is desired inside an image editor, do so after correction/intent decisions.

## Teaching Analogy
- **Correction** – the orchestra tuning their instruments to an evenly spaced, accurate scale.
- **Intent** – the conductor choosing how the score is interpreted (literal, rubato, marcato). The interpretation sits on top of the tuned foundation.

## Reminders for Support/Documentation
- Changing intent does **not** modify measurement data or ink limits.
- Loading a correction while an intent is active re-solves the curve using the current target (no need to “reset” intent first).
- Applying an intent to a `.quad` is optional; you can keep the reference file linear and perform intent-like adjustments upstream if preferred.

## References
- Feature specs: `docs/features/contrast-intents.md`, `docs/features/revert-controls.md`.
- User guide: `docs/quadgen_user_guide.md` (Contrast Intent section).
- Manual training: `docs/manual_tests.md` (Contrast intent matrix).
