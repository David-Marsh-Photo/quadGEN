# Changelog

All notable changes to this project will be documented in this file.

This changelog follows a concise, user-facing format. Engineering details live in CLAUDE.md; assistant behavior and tool semantics live in AGENTS.md.

## [Unreleased]
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- _Nothing yet._

### Removed
- _Nothing yet._

### Docs
- _Nothing yet._

## [Beta 3.0.1] — 2025-10-02
### Added
- Added a Playwright regression that ensures the Intent dropdown enables after loading a .quad file.

### Changed
- _Nothing yet._

### Fixed
- Restored the PoPS Matte, PoPS Uncoated, and PoPS Uncoated (softer) contrast intent presets in the modular dropdown to match the legacy single-file build.
- Intent dropdown now enables automatically once a .quad is loaded and no LAB/CGATS measurement is active.

### Removed
- Removed the legacy parity test suites and harnesses that depended on `quadgen.html` so the automated test suite reflects the modular app only.

### Docs
- _Nothing yet._

## [Beta 3.0.0] — 2025-10-01
### Changed
- Retired the legacy single-file bundle (`src/extracted_javascript.js`) and migrated every subsystem—global/per-channel corrections, Edit Mode, history, intent, printer management, Lab Tech helpers—onto ES modules with shared state managers and undo/redo.
- Rebuilt the global and per-channel revert flows on the modular measurement-seed helper so Smart point reseeding, metadata capture, and Lab Tech commands share one pathway (no hover refreshes needed).
- Consolidated file ingestion (.quad, LAB/CGATS/CTI3, Manual L*, LUT, ACV) onto the modular printerspace inversion and smoothing pipeline, preserving metadata and parity with the legacy build.
- Reorganized the workspace (`src/`, `scripts/`, `docs/`, `archives/`) to make the modular app the authoritative distribution while archiving the legacy single-file builds.
- Added onboarding tooling (architecture map exporter, browser shim utilities, documentation index) so new contributors can navigate the modular codebase without relying on legacy globals.

## [v2.6.4] — 2025-09-27
### Fixed
- Legacy LAB loader and manual L* entry now use the printer-space inversion helper (density smoothing + PCHIP) so symmetric datasets cross at 50% without flattening.
- Legacy CGATS/CTI3 imports share the same inversion helper, keeping plotted curves monotone with anchored endpoints and matching smoothing previews.

### Docs
- Updated CGATS.17 spec summary in the Help documentation to note the shared inversion workflow.

## [v2.6.3] — 2025-09-21
### Changed
- Lab Tech AI exposes `scale_channel_ends_by_percent`, so the assistant can drive the global Scale control directly.
- Use the Scale field above the channel list to adjust every End value proportionally.
- Global Scale input now auto-clamps once any channel would reach 100% (65,535) and accepts entries up to 1000% for proportional boosts.
- Graph labels track the highest ink value on each curve so low-limit channels no longer display inflated percentages.
- Removed the dotted intent reference overlay when only a `.quad` curve is loaded for a cleaner plot.

### Fixed
- Global Scale control now scales against per-channel baselines, so 90% → 95% applies once instead of stacking and channel edits no longer throw baseline errors.
- Printer initialization defers intent guards until a `.quad` is loaded, eliminating the missing `hasLoadedQuadCurves` reference on startup.

## [v2.6.2] — 2025-09-20
### Changed
- 1D `.cube` parser now accepts up to 256 samples even without a `LUT_1D_SIZE` header.

## [v2.6.1] — 2025-09-20
### Changed
- Intent tuning sweep tests now skip by default; set `QUADGEN_ENABLE_TUNING_SWEEPS=1` to run the long-form harness.

### Fixed
- Apply Intent remains available after loading a global `.acv` or `.cube`; it only disables when active LAB/CGATS/TI3 measurement data is applied.

## [v2.6.0] — 2025-09-20
### Added
- Recognized Argyll CTI3 (`.ti3`) measurement files alongside CGATS.17 for LAB linearization imports.

### Changed
- Standardized all user-facing terminology to say “Key Point” across labels, tooltips, and status messages.
- Auto white/black limit rolloff controls are temporarily hidden while we retune the detector; no automatic knees apply in this build.

### Fixed
- CGATS.17 importer now treats CMY values within ±2.5% as neutral, keeping K-only ramps aligned with their LAB counterparts.

## [v2.5.2] — 2025-09-19

### Added
- Lab Tech now understands extended zoom phrases like “zoom way in” or “zoom all the way out,” mapping them to the chart controls automatically.

### Fixed
- Undoing a manual ink-limit tweak now restores the original percentage instead of snapping to 100% after loading `\.quad` files.
- Smart Edit overlays now respect the active chart zoom, so key-point markers/labels stay aligned when you zoom to low ink limits.
- Edit Mode now seeds Smart points from the full LAB measurement set \(up to 64 points\) on first enable and restores the original measurement ink limit after Smart edits, so reverting no longer shrinks the curve or hides measured patches.
- Fixed “Revert to Measurement” button so it completely clears LAB linearization data before restoring the \.quad, preventing shrunken endpoints when Edit Mode is re-enabled.

### Docs
- Updated in-app ReadMe installation links and `docs/quadgen_user_guide.md` to point to the primary domain `https://quadgen.ink/`.
- Replaced “master” terminology with “reference” in documentation and in-app help to reflect preferred language.
- Added a glossary entry defining “reference curve” to keep Help → Glossary aligned with the new terminology.

## [v2.5.1] — 2025-09-18

### Added
- Chart zoom controls (+/−) so low ink-limit curves can fill the plot; zoom level persists per browser and is exposed to Lab Tech via `set_chart_zoom` / `nudge_chart_zoom`.
- `tests/chart_zoom.spec.js` covers the zoom helpers (percent↔Y mapping, persistence, and button state guards).
- Lab Tech now understands simple “zoom in” / “zoom out” chat commands and routes them to the new controls.

### Changed
- Graph rendering now derives grid lines, axis labels, overlays, and tooltips from the active zoom so the Y-axis always reflects the displayed max.
- Zoom increments now track the decile ladder (100 → 90 → … → 10) so each click adjusts the view by an even 10%.
- Zoom level clamps to the highest active ink limit—if a channel needs 100%, the chart refuses to crop it and snaps back out when you enable a higher limit.

### Fixed
- Reversed the chart zoom controls so “+” now magnifies (lower max) and “−” zooms out, matching user expectations.
- Undo/Redo on Smart key-point edits now rescale the curve so only the edited point moves; other points keep their absolute outputs.

### Docs
- Updated in-app Help (ReadMe, Detailed Workflow) and `QUADGEN_README.md` with guidance on the new chart zoom controls; AGENTS.md documents the automation hooks.

## [v2.5.0] — 2025-09-17

### Added
- “Apply Intent” can now bake the selected preset into a loaded `.quad` even when no LAB/manual data is present, making it easy to branch variants from a reference Linear profile.
- Lab Tech command `apply_intent_to_loaded_quad()` so the assistant can bake the active intent into a loaded `.quad` without manual clicks.

### Changed
- Apply Intent button styling matches per-channel load buttons and stays readable in both light and dark themes, with clearer disabled states.

### Fixed

### Docs

## [v2.4.0] — 2025-09-16

### Added
- Printer-space sanity fixtures in `testdata/` with `FEATURE_EXPECTATIONS.md` guidance to make regression checks repeatable (`humped_shadow_dip.quad`, `highlight_bump_1d.cube`, `midtone_collapse_3d.cube`, `midtone_lift.acv`, `lab_banded_shadow.txt`, `linear_reference_lab.txt`).
- Node regression scripts (`tests/dataspace.spec.js`, `tests/make256_helpers.spec.js`) to cover DataSpace conversions and the refactored make256 pipeline.
- Stubbed `tests/history_flow.spec.js` as the staging point for a headless undo/redo regression (placeholder script, ready for Playwright/Puppeteer wiring).
- Intent sweep regression (`tests/intent_linear_reference.spec.js`) that loads the linear LAB reference and checks every contrast preset stays within a 7% Δ band of the target intent.
- Debug-only Intent Tuning panel (enable `DEBUG_INTENT_TUNING`) to audition those smoothing/interpolation overrides inside quadGEN with Apply/Restore controls and LAB bandwidth inputs.
- “Apply to Loaded Curve” button lets you bake the active intent into a loaded .quad without re-running LAB corrections.

### Changed
- Measurement rebuild now defaults to POPS-like smoothing (PCHIP, 30% smoothing + 1×30% post smoothing with smoothing splines) and LAB bandwidth overrides K=2, σ_floor=0.036, σ_ceil=0.15, σ_alpha=2.0 across both the app and tuning panel.
- Removed the experimental intent blend slider from the debug tuning panel while we revisit a more faithful POPS-style blend; tuning now focuses solely on smoothing and LAB bandwidth controls.
- Updated automated intent regression tolerance to 8% to align with the new smoothing defaults.
- Intent dropdown now previews the selected curve on the graph before you apply it to a loaded .quad.
- Centralized all image→printer conversions through the new `DataSpace` helper in `quadgen.html`. ACV/LUT/LAB/manual builders, Smart seeding, intents, and LUT application now tag `sourceSpace` metadata and normalize automation targets across the board.
- Populated the POPS intent simulator with equivalent smoothing defaults so the POPS vs quadGEN comparison charts overlay correctly.

### Fixed
- Restored intent dropdown focus after sampling from the POPS simulator or applying manual LAB linearization to a loaded `.quad`.
- Resolved history manager double-pop bug when loading INTENT only adjustments.

### Docs
- Documented density math, smoothing defaults, and intent blending equivalence in `POPS_intent_pipeline.md` and `POPS_vs_quadGEN_formula_map.md`.

## [v2.3.1] — 2025-09-15

### Added
- “Show linear preview” toggle overlays the straight-line target for measurement-driven calibrations.
- “Edit Mode” label now shows how many Smart points are active.

### Changed
- Reorganized Help popup to expose ReadMe, Glossary, and Version History directly.

### Fixed
- Smart-point overlays no longer linger after loading a new `.quad`.

### Docs

## [v2.3.0] — 2025-09-15

### Added
- Quick Compare panel shows the currently plotted curve, target, and measurement overlay in numeric form.
- Capture/Restore references for Smart key-point edits so you can snapshot experiments.

### Changed

### Fixed
- Fixed Smart key-point move events from dispatching duplicate history records.

### Docs

## [v2.2.0] — 2025-09-14

### Added
- LAB import warnings now highlight mismatched print intent and offer quick-switch.
- Added gamma/filmic contrast presets.

### Changed
- LAB loader stores measurement metadata for history, including printer intent and smoothing settings.

### Fixed
- Undoing a Smart key-point tweak now restores interpolation metadata.

### Docs

## [v2.1.0] — 2025-09-13

### Added
- Added “Generate Correction” summary row with measurement metadata.
- Added LAB smoothing presets to modal.

### Changed
- Manual L* export now produces printer-space curves by default.

### Fixed
- Smoothed measurement curves now clamp to 0–100.

### Docs

## [v2.0.0] — 2025-09-12

### Added
- Modular app bootstrap with ES module entry point.

### Changed
- Separated UI from core logic.

### Fixed
- Initial modular regression fixes.

### Docs

## [v1.8.5] — 2025-09-04

### Added
- AI key-point deletion: delete by index or nearest to input % (endpoints blocked by default).

## [v1.8.4] — 2025-09-04

### Added
- Numbered labels above AI key points with ink-colored backgrounds and auto B/W contrast.
- Lab Tech sample: “apply a midtone lift” example.
- AI key-point deletion functions (by index / nearest to input, endpoints blocked).

### Changed
- Graph axis titles to “Input Level %” (X) and “Output Ink Level %” (Y).
- Label positioning refined near 0%/100% to reduce overlap.
- Lab Tech sample updated to numeric key points example.

### Docs
- Updated CLAUDE.md and AGENTS.md for numeric key-point workflow and insert/adjust commands.

## [v1.8.3] — 2025-09-03

### Added
- New printers: P400, x800-x890, x900, P4-6-8000, P5-7-9000.
- Ink colors: OR (Orange) and GR (Green) in charts and swatches.
- AI key-point overlays and insert commands.
- Undo/redo now restores AI key points and interpolation meta along with curves.

### Changed
- Printer lists ordered newest→oldest; supported printers list updated in .quad import errors.
- Natural-language presets deprecated; AI computes numeric key points directly.
- Axis titles: “Input Level %” and “Output Ink Level %”.

### Fixed
- Smart Curve scaling now respects ink limit for relative adjustments.

### Removed
- Legacy 860-1160-VM model.

## [v1.8.2] — 2025-09-03

### Changed
- About: Merged Recommended + Quick Workflow into a single “Workflow Summary”.

### Docs
- Clarified Positive-only operation; EDN LUT/.acv use Positive mapping by default.

## [v1.8.1] — 2025-09-03

### Added
- MIT License note for quadgen.html; About dialog blurb.
- Chart orientation aids (white→black gradients under X and beside Y).

### Changed
- Axis titles and label contrast/spacing.
- EDN mapping fixed to Positive semantics (no intent toggle).

### Removed
- Negative Print Intent UI and mismatch warning.

## [v1.8] — 2025-09-02

### Added
- Print Intent selector (Positive/Negative) for EDN corrections with live recompute.
- LAB measurement traceability and mismatch banner.

### Fixed
- ACV/LUT parity (flip + invert for positive-domain EDN); immediate graph updates on intent toggle.
- LAB endpoints anchored to 0 and 1; tonal regions flipped (0% white, 100% black).

### Removed
- Process presets and auto-citation experiment.

## [v1.7] — 2025-09-02

### Fixed
- LAB artifacts: Replaced experimental method with Gaussian Weighted Correction; eliminated dense-on-dense spikes.
- Undo capture for all LAB load paths.

### Enhanced
- Gaussian weighting with configurable radius (default 15%).

### Removed
- RBF experimental method.

## [v1.6] — 2025-08-31

### Added
- Lab Tech AI assistant (25 functions); per-channel processing detail panels.

### Enhanced
- Natural language curve generation; undo integration; disabled channel restoration.

### Fixed
- Transparency for disabled channels; immediate processing panel updates; iteration bug; AI undo integration.

## [v1.5] — 2025-08-29

### Added
- Photoshop .acv file support (binary parser), cubic spline interpolation, RGB composite extraction.
- .acv accepted in global/per-channel linearization inputs; UI/tooltips updated.

### Improved
- .acv format documentation; seamless integration with .cube/.txt pipeline.

## [v1.4.1] — 2025-08-29

### Added
- Smoothing Splines algorithm with automatic lambda; original curve overlay; simplified algorithms; accurate .quad maximum detection.

### Refined
- Streamlined method selection; simplified interpolation options; default to Uniform Sampling; UI cleanup.

### Improved
- Multi-channel comparison; reliable smoothing focus; correct .quad scaling by max.
- Help ReadMe, Glossary, and manual regression notes now describe the expanded undo coverage, including screenshots captured by the history Playwright suites.
