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

### Docs
- _Nothing yet._

## [4.3.0] — 2025-10-28
### Added
- Bell-classified channels now surface a “Bell Width” card directly beneath Bell Apex in the Edit Curve panel (Edit Mode ON) with left/right percent inputs, ±2 % nudges (Shift=±5 %), a Reset button, and a link toggle so you can widen or tighten either side of the bell without reseeding Smart curves.

### Changed
- Curve-shape metadata now reports left/right span samples plus `bellWidthScale` state (factors + linked flag) and reuses the distance-weighted Smart-point pipeline so scripts/UI can track width edits alongside apex offsets without losing ordinals.

### Fixed
- Bell Width controls react immediately in either direction: the ± buttons temporarily disable while a curve update runs, the link toggle applies instantly, and manual percent inputs clamp to the 40–250 % range so fresh edits can’t “replay” old spinner changes.
- Bell Width Smart curves now factor in the prior width scaling, so the very first nudge in the opposite direction repositions Smart key points immediately instead of continuing in the old direction for a few clicks.
- Bell Width Reset restores the underlying curve samples (not just the Smart points), so the plotted line now snaps back to the baseline bell whenever the card is reset to 100 %.
- Smart-mode Bell Width edits now regenerate the plotted samples, so the blue curve tracks the moved Smart key points instead of leaving the handles floating over an unchanged line until some other refresh kicks in.

### Docs
- Documented the Bell Width Scale workflow (feature spec, manual tests, Help → Glossary/Version History) and noted the shared bell-curve helpers + controller tests covering the new control.

## [4.2.7] — 2025-10-26
### Added
- Bell-classified channels now surface a “Bell Apex” control inside the Edit Curve panel (Edit Mode ON) with nudge buttons and numeric entry so you can shift the detected apex horizontally without redrawing Smart points; the shift reweights samples around the peak and records undo/redo history.

### Changed
- Curve-shape metadata now exposes apex input/output percents plus bell-shift state so scripts and the Help overlay can report the current offset.
- Bell Apex shifts now slide existing Smart key points horizontally (endpoints pinned, gaps preserved) instead of re-simplifying, so key-point ordinals stay consistent after each adjustment.

### Fixed
- _Nothing yet._

### Docs
- Documented the bell-curve apex shift workflow (feature spec, manual tests, Help → ReadMe/Glossary/Version History) and linked the automated Playwright regression that captures the control plus screenshot artifacts.

## [4.2.6] — 2025-10-27
### Added
- Curve shape detector identifies bell vs monotonic channels, exposes the metadata through `window.getChannelShapeMeta()`, and surfaces badges in the channel table for quick highlight audits.

### Changed
- Channel badges now use glyphs (🔔 bell, 📈 monotonic, ➡️ flat) without colored pills so highlight-heavy curves stand out instantly while tooltips carry the context.

### Fixed
- _Nothing yet._

### Docs
- Added a “Curve Shape Detection Badges” regression in `docs/manual_tests.md` plus Glossary/Help updates explaining the new badges, apex readouts, and Playwright coverage.

## [4.2.5] — 2025-10-26
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Loading a new global correction (LAB/CGATS/manual) now reshapes baked `.quad` files immediately; stale `bakedGlobal` metadata can no longer keep the chart linear until you drop correction gain below 100%.

### Docs
- Added a regression checklist entry covering global corrections on baked `.quad` files and documented the `artifacts/linearization_gain_bug.md` investigation.

## [4.2.4] — 2025-10-25
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- “Enter L* Values” once again opens the Manual L* modal; the markup was accidentally dropped during recent layout work and has been restored so manual measurements can be entered without editing the source.

### Docs
- _Nothing yet._

## [4.2.3] — 2025-10-24
### Added
- _Nothing yet._

### Changed
- Session status (top-left) and status notifications (top-right) now live on the chart again and expand to match the plotted width, so they stay aligned while you resize the panel or adjust zoom.

### Fixed
- Restored the legacy `window.elements` helper so automated smoke checks and external scripts can locate channel rows without custom wiring.

### Docs
- _Nothing yet._

## [4.2.2] — 2025-10-23
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Right panel (Edit Curve / Global Correction vertical tabs) now correctly spans full page height with bottom tabs (Channels / Lab Tech / Preview) constrained to the left main content area, fixing HTML structure where panels were incorrectly nested inside tab content wrappers.

### Docs
- Updated `docs/ui/panel-system.md` with implementation notes confirming correct app-layout structure (3 direct children: main-content-area, panelDivider, rightPanel).

## [4.2.1] — 2025-10-20
### Added
- Cumulative ink-load overlay lives under ⚙️ Options, sums every enabled channel, and flips from dashed gray to solid red once totals clear the configurable warning threshold; tooltips now report the per-input total with an overshoot warning.

### Changed
- _Nothing yet._

### Fixed
- _Nothing yet._

### Docs
- Help → ReadMe and Glossary call out the new ink-load overlay toggle, threshold control, and tooltip behaviour.

## [4.2.0] — 2025-10-19
### Added
- Light-blocking overlay can now load a reference `.quad` so you can compare live curves against a saved baseline without leaving the app.

### Changed
- Reorganized the Edit/Options layout to keep curve-edit controls grouped together and surface overlay tools where they’re needed most.

### Fixed
- Smart key point markers (white squares) now stay aligned with the curve when dragging points in Edit Mode, instead of shifting off the line after mouse release.
- Raising a channel’s ink limit by dragging a Smart point now persists the new headroom after you let go, so follow-up edits don’t snap the limit back.

### Docs
- Clarified in the Edit Mode spec that drag-based ink-limit raises remain in effect after the move completes.

## [4.1.0] — 2025-10-17
### Added
- Manual L* modal now remembers the last Patch % layout and row count after you save or generate a correction, so repeat manual entries reopen with the same spacing.
- Measurement spot marker overlay lines badges along a mid-chart rail (~70 %), with green checks inside tolerance and color-coded arrows (red up for darken, blue down for lighten) labeled with percent deltas; the toggle lives in ⚙️ Options and remembers your preference per browser.
- Correction gain slider (⚙️ Options) blends between the identity ramp and the measured correction so you can audition partial mixes while charts, spot markers, previews, and exports stay in sync with the selected percentage.

### Changed
- Auto-raise ink limits now defaults to off; enable it per session when a correction needs automatic headroom.
- The correction overlay once again plots the dashed linear-baseline reference so you can compare corrections against the identity ramp; the light-blocking overlay remains baseline-free until reference `.quad` comparisons return.
- Light-blocking overlay drops the dashed purple guide as well; the measured curve is all that renders until reference `.quad` support ships.
- Measurement spot markers stay pinned to the unzoomed 70 % rail so the badges no longer slide when you change chart zoom.
- Measurement spot markers now scale with the correction gain slider: 0 % shows green checks (no correction applied) while higher percentages grow the arrows and labels to match the applied correction.
- Correction gain slider batches scrubbing updates with a ~150 ms debounce so chart redraws stay responsive; releasing the control (or pausing momentarily) applies the blended curve immediately.

### Fixed
- Reverted the experimental boundary-window tweak in plot smoothing; the base kernel matches prior releases while we address the downstream regressions it caused.

### Docs
- `docs/manual_tests.md` clarifies the current highlight behaviour (including the known LK reversal) and reiterates the auto-raise reminder.
- Added measurement spot marker coverage to `docs/manual_tests.md` and refreshed Help → ReadMe/Version History to explain the new overlay and tolerance badges.
- `docs/features/plot-smoothing-start-protection.md` and `plot-smoothing-tail-protection.md` document the head/tail blend order and cross-link for future rework.
- Help/guide references clarify that the correction overlay shows the linear baseline again, add a glossary entry for the light-blocking overlay, and note the missing comparison `.quad` guide until that loader returns.
- `docs/features/manual-lstar.md` and in-app help now mention that Manual L* patch layouts persist after Save/Generate.

## [4.0.0] — 2025-10-15
### Added
- Overlay controls in the ⚙️ Options panel for light blocking and correction targets, plus default-on curve dragging and snapshot flags to speed Edit Mode edits.
- Channel ink locks, auto-raise import guard, and coverage-aware composite debug overlays keep corrections aligned with ink ceilings.
- Density column with studio presets and one-click Compute flow so manual versus solver constants stay traceable; composite weighting and debug panels surface the same data.
- Simple Scaling is now the default correction method, with an Options toggle to swap back to the density solver at any time.

### Changed
- Light mode now loads by default, LAB smoothing opens at 0 %, and correction overlays scale to the active ink ceiling for clearer comparisons.
- Composite solver reuses normalized coverage ceilings, momentum weighting, and ladder tapers to hand off corrections smoothly while retaining guardrails.
- Auto-raise and the kernel slope smoother coordinate with redistribution smoothing windows, keeping highlight hand-offs curved even after ink limits increase.

### Fixed
- Global `.cube` and `.acv` imports stay monotone and correctly oriented, so default ramps show the intended shape without double flips.
- Resetting LAB or plot smoothing to 0 % restores baseline amplitude and ink limits, and table fields stay synced with rebased curves.
- Smart key points and undo history remain stable after channel-percent nudges or auto-raise adjustments.

### Docs
- Workflow guidance now lives in `docs/quadgen_user_guide.md`, and the print linearization guide consolidates the LAB pipeline, manual density defaults, and Simple Scaling notes.
- Auto-raise, density solver, and ingestion specs document smoothing interoperability, manual density inputs, and hybrid mapping plans; in-app Help and Glossary mirror the changes.

## [v3.1.4] — 2025-10-07
### Added
- Log-density linearization toggle in the Global Correction panel and Manual L* modal, allowing quick switching between perceptual (L*) and optical-density workflows.

### Changed
- Perceptual (L*) normalization remains the default for direct prints; enabling the new toggle converts LAB/CGATS/manual data to CIE log-density with Dmax normalization to match digital-negative workflows.

### Fixed
- Global LAB/CGATS loads no longer mark the correction as baked when toggled on; the Global toggle now remains available for enable/disable testing.

### Removed
- _Nothing yet._

### Docs
- Updated `docs/print_linearization_guide.md`, Help → Version History, and internal guides to explain the L* vs log-density toggle, default behavior, and glossary addendum.

## [v3.1.3] — 2025-10-07
### Added
- Vitest coverage for the rebased ink-limit workflow (`tests/history/restore_snapshot_rebase.test.js`, `tests/ui/edit-mode-baked-state.test.js`) guards undo/redo and baked-status regressions.

### Changed
- `npm run test:smoke` now runs only the Playwright smoke check; the active-range diff diagnostics have been retired while the linearization work is on hold.
- Channel percent/end inputs now update to the effective ink limits when corrections (.cube/.txt) are active, so the table always matches the plotted output.
- Undo/redo and revert flows now restore the rebased ink limits, so manual edits resume from the baked curves instead of the original .quad baselines.

### Fixed
- Processing labels now surface “Global (baked)” details, keeping the graph header aligned with the rebased corrections.
- Global LUT baking now samples each correction once so files like `negative.cube` land at the expected ink maxima (≈87 % of the source curve) instead of collapsing after multiple redraws.

### Removed
- Scaling State audit panel removed from Help → Version History now that the coordinator rollout is complete.

### Docs
- Updated `docs/investigation/INK_LIMIT_BASELINE_SIMPLIFICATION_CHECKLIST.md` to mark the rebase execution and revert-alignment steps complete.
- Documented the density ladder workflow and debug instrumentation in `docs/features/channel-density-solver.md` and `docs/features/density_ladder_plan.md`.

## [v3.1.2] — 2025-10-06
### Added
- Active-range linearization feature flag (`enableActiveRangeLinearization`) remains opt-in with scaffolding and Vitest coverage for delayed-onset, zero-ink, and tiny-span channels.
- 1D LUT endpoint anchoring flag (`setCubeEndpointAnchoringEnabled`) now defaults off, honoring sub-100% LUT maxima while allowing the legacy 0/100 clamp to be re-enabled when required.

### Changed
- `apply1DLUT` routes through shared interpolation prep and supports active-range remapping while preserving the legacy fixed-domain path when the flag is disabled.
- `npm run test:smoke` runs only the Playwright smoke check; active-range diff diagnostics are available separately when the flag work resumes.

### Fixed
- Global LUT application now respects the cube-endpoint anchoring flag, so sub-100% LUTs (e.g., negative density ramps) actually scale exported curves.

### Removed
- _Nothing yet._

### Docs
- Documented the active-range workflow and feature flag usage in the print linearization guide; noted the toggle in CLAUDE.md and AGENTS.md.
- Active-range checklist now records the diagnostics hook status and how to re-enable the diff script when active-range work resumes.
- Help → Version History now explains the default-on active-range behavior and how to disable it for emergency rollbacks.
- CLAUDE.md and AGENTS.md now document the cube-endpoint anchoring flag with the new default-off behavior so internal assistants know how to restore the clamp when required.

## [v3.1.1] — 2025-10-06
### Changed
- Limits summary in exported `.quad` files now reports the true peak ink per channel after corrections instead of the raw UI ink-limit setting.

### Fixed
- Exported `.quad` files only annotate “Linearization Applied” when LAB measurement data is active (global or per-channel), keeping LUT-only exports clean.

## [v3.1.0] — 2025-10-05
### Added
- Targeted Vitest coverage (`tests/ai-actions-scaling.test.js`) asserting AI scaling requests route through the coordinator with proper metadata.
- Help → Version History now includes a Scaling State audit panel with live counters plus refresh/reset controls for the Phase 2 declarative-state rollout.
- Scaling-state workflow coverage: new Vitest reason-counter checks (`tests/core/scaling-utils-audit-reasons.test.js`) and Playwright flows (`tests/e2e/scaling-state-workflows.spec.ts`) exercise flag toggles, rapid scaling, and undo/redo parity under the state flag.

### Changed
- Feature-flagged global scaling coordinator queues Scale operations behind undo-safe history transactions; toggle via `enableScalingCoordinator(true)` during Phase 1 testing.
- Window/global scaling helpers exposed on `window` now enqueue through the coordinator queue and provide `legacy*` fallbacks for diagnostics tooling.
- `scalingStateAudit` now records per-reason counters (flag enable/disable, subscription resync, legacy fallback, history undo/redo) and `scripts/diagnostics/scaling-state-ab.js` aggregates them as `reasonCountsSummary` for A/B telemetry artifacts.
- Dev builds now enable `__USE_SCALING_STATE` by default so the declarative scaling path is active without manual toggles (compat `setScalingStateEnabled(false)` remains for rollback).

### Fixed
- Smart point parity check for preloaded `.quad` files now converts curve samples into relative output, keeping Edit Mode key points in sync with reduced ink-limit curves.
- Lab Tech scaling commands now propagate coordinator failures instead of forcing a success flag when queue operations reject or return `success: false`.
- Scaling state parity no longer fails when clamping back to 100 %—the state slice now resets `maxAllowed` to 1000 alongside legacy globals, keeping coordinator retries green while the flag is enabled.
- Undo/redo history refresh now routes through UI hooks, eliminating the missing trigger warnings surfaced during the scaling-state Playwright workflows.
- Reapplying the same contrast intent no longer compounds the loaded curve—intent remap now reuses the original curve baseline so repeated clicks are idempotent (`tests/e2e/intent-double-apply.spec.ts`).
- Ink limit edits now rescale the original `.quad` samples and skip seeding default Smart ramps while Edit Mode is off, so adjusting a channel no longer collapses the plotted curve into a linear ramp (`tests/e2e/ink-limit-linearization.spec.ts`).

### Removed
- _Nothing yet._

### Docs
- Documented the Phase 0 scaling release handoff (checklist, regression matrix, and in-app Version History entry).
- Added coordinator flag guidance (`enableScalingCoordinator`) to CLAUDE.md and AGENTS.md.
- Noted the coordinator-backed window bridge + legacy helpers in AGENTS.md and marked the scaling UI migration checklist update.
- Marked the AI/programmatic migration milestone complete in `docs/features/SCALING_IMPROVEMENT_PLANS.md`.
- Logged the combined Smart + LAB parity diagnostics run (`scripts/diagnostics/compare-coordinator-combined.js`).
- Recorded the clamp-to-100 parity fix and updated harness metrics in `docs/features/SCALING_IMPROVEMENT_PLANS.md` and `docs/features/checklists/PHASE_2_DECLARATIVE_STATE.md`.
- Captured the help overlay scaling audit panel in the Phase 2 plan and checklist so consumer coverage is fully accounted for before the canary rollout.
- Documented scaling-state reason counters + workflow coverage updates in the Phase 2 plan.
- Logged the undo/redo trigger fix and Playwright coverage update in `docs/features/SCALING_IMPROVEMENT_PLANS.md`.
- Noted the private-lab rollout workflow and single-operator manual acceptance steps in `docs/features/SCALING_IMPROVEMENT_PLANS.md` and `docs/manual_tests.md`.

## [Beta 3.0.4] — 2025-10-04
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Smart curve baking now preserves the full measurement point set and marks the graph status as *BAKED* the moment LAB corrections are converted into Smart curves, preventing the two-point collapse seen in regression tests.
- Global revert button now disables once a correction is baked, steering operators to undo instead of a no-op click.

### Removed
- _Nothing yet._

### Docs
- _Nothing yet._

## [Beta 3.0.3] — 2025-10-03
### Added
- Added a Playwright regression that verifies inserting a Smart point with MK limited to 50% lands on the plotted curve.
- Added a Playwright regression that exercises global Scale with Edit Mode enabled so Smart curves stay aligned after ink-limit changes.

### Changed
- _Nothing yet._

### Fixed
- Smart point insertion and recompute now respect per-channel ink limits, eliminating the double-scaled plots and missing markers introduced after the scaling tweaks.
- Global scale now preserves Smart curve positioning by skipping the redundant relative-output rescale, preventing the 0.8^2 shrink when scaling after edits; manual channel edits immediately reapply the active global Scale so per-channel overrides no longer bypass the multiplier.

### Removed
- _Nothing yet._

### Docs
- _Nothing yet._

## [Beta 3.0.2] — 2025-10-03
### Added
- Added a Playwright regression that deletes an interior Smart key point through the Edit Mode button to guard against regressions.
- Added a Playwright regression that verifies LK ink limits increase correctly after toggling Edit Mode.
- Added a Playwright regression that toggles global LAB corrections on/off to ensure the enable switch reflects state.
- Added a Playwright regression that checks Edit Mode nudges move points by the expected 1% even with non-100% ink limits and zoom.

### Changed
- _Nothing yet._

### Fixed
- Fixed the Edit Mode Delete button so it removes the selected Smart key point instead of failing silently.
- Fixed LK per-channel scaling so increasing the percentage after exiting Edit Mode raises the ink limit instead of reusing the older, lower value.
- Fixed the global correction toggle so disabling it actually removes the LAB correction until re-enabled.
- Fixed Edit Mode nudges so each click adjusts the Smart point by the intended 1% in chart space regardless of channel ink limits or zoom.

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
- Measurement rebuild now defaults to the intent-simulator smoothing recipe (PCHIP, 30% smoothing + 1×30% post smoothing with smoothing splines) and LAB bandwidth overrides K=2, σ_floor=0.036, σ_ceil=0.15, σ_alpha=2.0 across both the app and tuning panel.
- Removed the experimental intent blend slider from the debug tuning panel while we revisit a more faithful legacy blend; tuning now focuses solely on smoothing and LAB bandwidth controls.
- Updated automated intent regression tolerance to 8% to align with the new smoothing defaults.
- Intent dropdown now previews the selected curve on the graph before you apply it to a loaded .quad.
- Centralized all image→printer conversions through the new `DataSpace` helper in `quadgen.html`. ACV/LUT/LAB/manual builders, Smart seeding, intents, and LUT application now tag `sourceSpace` metadata and normalize automation targets across the board.
- Populated the legacy intent simulator with equivalent smoothing defaults so the comparison charts overlay correctly.

### Fixed
- Restored intent dropdown focus after sampling from the legacy simulator or applying manual LAB linearization to a loaded `.quad`.
- Resolved history manager double-pop bug when loading INTENT only adjustments.

### Docs
- Documented density math, smoothing defaults, and intent blending equivalence in the intent pipeline reference notes.

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
