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

## [5.0.1] — 2026-01-24
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Smart Curve point markers now follow the cursor during drag operations instead of snapping back to the previous curve position

### Docs
- _Nothing yet._

## [5.0.0] — 2026-01-24
### Added
- Channel Builder wizard for creating multi-ink .quad files from L* measurements
  - 4-tab guided workflow: Reference K → Add Channels → Preview → Apply
  - Define reference K channel from measurements or import from current .quad
  - Add secondary channels by entering their density profiles
  - Session state persists across page reloads

### Changed
- _Nothing yet._

### Fixed
- LAB correction now applies at correct input positions for non-linear .quad curves
  - Previously, gain sampling used output ink level instead of input position
  - Spot markers and actual corrections now align for all curve shapes

### Docs
- _Nothing yet._

## [4.3.5] — 2025-01-19
### Added
- Bell curve classifier now reports asymmetry metrics (`asymmetryRatio`, `isLeftSkewed`, `isRightSkewed`) for diagnostic insight into peak shape.
- Bell curve classifier now reports Gaussian fit quality (`gaussianFitQuality`) as R² coefficient measuring how well the curve matches an ideal Gaussian.

### Changed
- Bell apex shift and width scaling now use Gaussian falloff (`exp(-d²/2σ²)`) instead of linear exponential, providing smoother weighting without cusp artifacts at the apex.
- Bell curve resampling now uses PCHIP (monotone cubic Hermite) interpolation instead of linear interpolation, better preserving curve shape during transforms.
- Curve shape classification now uses Savitzky-Golay smoothing by default (configurable), which preserves peak height better than moving average.
- Chart rendering performance improved via static layer caching and RAF batching for update triggers.
- Binary search optimization in interpolation functions reduces lookup complexity from O(n) to O(log n).
- Error handling improvements in LAB redistribution pipeline for more robust correction processing.
- Refactored toggle handlers to use centralized utilities (`syncToggleState`, `initializeToggle`).

### Fixed
- .quad file parser now supports externally-created files that lack the `## QuadToneRIP` header. Channel count is inferred from data (values ÷ 256) and standard channel names are applied for 8-channel (P600/P800) and 10-channel (P700/P900) configurations.
- XSS prevention via HTML escaping in status messages.

### Docs
- Added `docs/features/bell-curve-improvements-plan.md` documenting multi-agent audit results and implementation status.

## [4.3.4] — 2025-10-30
### Added
- _Nothing yet._

### Changed
- LAB smoothing defaults improved for better handling of sparse measurement regions: `K_NEIGHBORS` increased from 2 to 4 (more neighboring points influence smoothing), `SIGMA_CEIL` increased from 0.15 to 0.30 (allows wider Gaussian kernels in sparse regions).
- Plot smoothing and LAB smoothing sliders now support up to 600% (previously capped at 300%) for extreme smoothing cases with noisy data or sparse measurement sets.
- LAB smoothing slider now scales linearly instead of using power curve (exponent changed from 1.35 to 1.0), providing more predictable and monotonic smoothing behavior across the full range.

### Fixed
- LAB smoothing slider no longer produces undulations (ripples that appear and disappear) as you increase the percentage. The combination of linear scaling and raised sigma ceiling prevents differential ceiling saturation across curve regions.

### Docs
- _Nothing yet._

## [4.3.3] — 2025-10-29
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Correction gain at 100% now applies full LAB linearization corrections instead of reverting to baseline curves. The zero-smoothing and normalization code paths no longer overwrite LAB-corrected curves with baseline data.

### Docs
- Updated correction gain, LAB ingestion, and global correction loader documentation with architectural details about Simple Scaling correction method and required guards to prevent baseline overwrite.
- Added regression test coverage (`tests/e2e/correction-gain-100-baseline.spec.ts`) validating that 100% gain applies full LAB corrections and that 99% and 100% gain produce identical results.

## [4.3.2] — 2025-10-30
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Light blocking overlay reference line now remains fully visible at all zoom levels instead of being cut off when zooming past 100%.
- Light blocking overlay now updates immediately when channel density values change instead of requiring focus loss and mouse hover to refresh.

### Docs
- _Nothing yet._

## [4.3.1] — 2025-10-29
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Global Correction tab stays within the right-panel column when activated, preventing the side panel from doubling in width or breaking the layout.

### Docs
- Added a regression checklist item covering the Global Correction tab layout and updated panel-system notes with the new DOM guard.

## [4.3.0] — 2025-10-28
### Added
- Bell-classified channels now surface a "Bell Width" card directly beneath Bell Apex in the Edit Curve panel (Edit Mode ON) with left/right percent inputs, ±2 % nudges (Shift=±5 %), a Reset button, and a link toggle so you can widen or tighten either side of the bell without reseeding Smart curves.

### Changed
- Curve-shape metadata now reports left/right span samples plus `bellWidthScale` state (factors + linked flag) and reuses the distance-weighted Smart-point pipeline so scripts/UI can track width edits alongside apex offsets without losing ordinals.

### Fixed
- Bell Width controls react immediately in either direction: the ± buttons temporarily disable while a curve update runs, the link toggle applies instantly, and manual percent inputs clamp to the 40–250 % range so fresh edits can't "replay" old spinner changes.
- Bell Width Smart curves now factor in the prior width scaling, so the very first nudge in the opposite direction repositions Smart key points immediately instead of continuing in the old direction for a few clicks.
- Bell Width Reset restores the underlying curve samples (not just the Smart points), so the plotted line now snaps back to the baseline bell whenever the card is reset to 100 %.
- Smart-mode Bell Width edits now regenerate the plotted samples, so the blue curve tracks the moved Smart key points instead of leaving the handles floating over an unchanged line until some other refresh kicks in.

### Docs
- Documented the Bell Width Scale workflow (feature spec, manual tests, Help → Glossary/Version History) and noted the shared bell-curve helpers + controller tests covering the new control.

## [4.2.7] — 2025-10-26
### Added
- Bell-classified channels now surface a "Bell Apex" control inside the Edit Curve panel (Edit Mode ON) with nudge buttons and numeric entry so you can shift the detected apex horizontally without redrawing Smart points; the shift reweights samples around the peak and records undo/redo history.

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
- Added a "Curve Shape Detection Badges" regression in `docs/manual_tests.md` plus Glossary/Help updates explaining the new badges, apex readouts, and Playwright coverage.

## [4.2.5] — 2025-10-26
### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- Loading a new global correction (LAB/CGATS/manual) now reshapes baked `.quad` files immediately; stale `bakedGlobal` metadata can no longer keep the chart linear until you drop correction gain below 100%.

### Docs
- Manual regression checklist now includes a "Global Correction Overrides Baked Metadata" test and the investigation lives in `artifacts/linearization_gain_bug.md`.
