# quadGEN Documentation Index

This directory holds the reference material that ships with the modular quadGEN build. Use this guide to find the right document quickly.

## Product Guides
- `quadgen_user_guide.md` – user-facing overview of the app, terminology, and daily workflows.
- `quadgen_workflow.md` – recommended end-to-end calibration sequence (measurement → correction → verification).
- `manual_tests.md` – regression checklist the lab follows when exercising critical UI paths.
- `print_linearization_guide.md` – ground-truth math for LAB and manual L* calibrations in printer space.

## Technical Reference
- `architecture-map.md` – auto-generated mermaid diagram of module clusters and dependencies (`node scripts/docs/export-architecture-map.js`).
- Legacy intent pipeline notes – legacy analysis retained for historical context.
- `LAB_LINEARIZATION_WORKFLOW.md`, `LAB_LSTAR_PIPELINE.md` – deep dive on measurement ingestion and Smart curve generation.
- `features/` – feature briefs documenting expected behaviour, data flow, and test coverage for:
  - `global-scale.md`, `auto-limit-rolloff.md`, `edit-mode.md`, `revert-controls.md`
  - `contrast-intents.md`, `correction-vs-intent.md`, `apply-intent-to-quad.md`
  - `lab-ingestion.md`, `manual-lstar.md`, `per-channel-measurements.md`
  - `smart-curve-engine.md`, `history-manager.md`, `global-correction-loaders.md`
  - `hybrid-density-proposal.md` (proposal status)

## File Format Specs
- `File_Specs/ACV_SPEC_SUMMARY.md`, `CGATS17_SPEC_SUMMARY.md`, `CUBE_LUT_SPEC_SUMMARY.md`, `LAB_TXT_SPEC_SUMMARY.md`, `QTR_QUAD_SPEC_SUMMARY.md` – parsing rules and edge cases for supported import/export formats.
- `File_Specs/Quad-Ink-Descriptor-Spec-En.pdf` – vendor-provided reference for QuadToneRIP ink descriptors.

## Intent Comparative Data
- Comparative reports and formula maps documenting legacy intent workflows versus quadGEN corrections.
- `pops_profiler_formulas/` – raw CSV artifacts backing the comparison study.

## Developer Resources
- `dev/BUILD_INSTRUCTIONS.md`, `dev/QUADGEN_DEVELOPMENT.md` – setup notes for local development and build process.
- `dev/QUADGEN_DATA_TYPES.md`, `dev/QUADGEN_AI_INTEGRATION.md` – data contracts and Lab Tech automation hooks.
- `dev/CLOUDFLARE_SETUP.md` – instructions for deploying the Cloudflare worker proxy used in production.

## Testing & Tooling
- `playwright_external_runner.md` – how to drive the MCP-adjacent Playwright harness.
- `calibration-targets-untagged-vs-color-space.md` – test target handling notes when ICC metadata is absent.

If you add new documentation, update this index so the team can surface it from a single place.
