# quadGEN vs. Prints on Paper Studio Profiler v1.24 — Technical Comparison

Author: quadGEN analysis
Date: 2025‑09‑11

## Executive Summary
- Both tools calibrate QuadToneRIP (.quad) curves from measured tone response.
- quadGEN is an interactive, single‑file web app focused on fast linearization, per‑channel/global corrections, and in‑graph editing with PCHIP. It accepts LAB `.txt`, LUT `.cube`, and Photoshop `.acv`, and exports `.quad` directly.
- Prints on Paper Studio Profiler (POPS) is an Excel‑based system with a larger surface area: measurement smoothing and iterations, pre/post contrast channel smoothing, auto white/black ink limiting (open‑bite), contrast‑intent templates, spectral splitting/averaging, curve blending, channel remapping, CGATS generator, toned curves, and LUT exports for multiple ecosystems.
- For photogravure/digital negative shops, POPS provides a comprehensive, studio‑style pipeline. quadGEN offers a simpler, code‑driven core that can be extended to close targeted gaps.

## Inputs, Targets, and Parsing
- quadGEN
  - Inputs: LAB `.txt` (GRAY/L*), 1D/3D LUT `.cube`, Photoshop `.acv`, existing `.quad`.
  - LAB parsing: trims/validates rows, sorts by GRAY%, keeps anchors, reconstructs 256‑point “required output %” curve.
  - Orientation: Positive‑only mapping (EDN `.cube` / `.acv` auto reverse+invert at ingest to align printer‑space).
  - Targeting: Any wedge; built‑in sample (Color Muse format) provided.

- POPS (xlsx)
  - Inputs: `.quad` (STARTING QTR CURVE), measurements via CGATS (MEASUREMENTS, CGATS sheets). Transcript specifies i1Profiler export with spectral range 380–730nm.
  - Target: Designed around a “128×5” measurement target (pre‑averaged patches) per video.
  - Many adjunct sheets: `CGATS GENERATOR`, `CGATS`, `_MEASUREMENTS`, spectral splits/averaging, etc.

## Smoothing and Noise Control
- quadGEN
  - Measurement smoothing: Gaussian‑weighted reconstruction with user slider (0–90%).
  - Interpolation: PCHIP (monotonic) for measurement‑driven curves; Linear optional.
  - Edit Mode: “Recompute” reduces dense curves to Smart key points with max‑error and max‑points constraints for stability.

- POPS
  - Measurement smoothing controls: Measure Smooth, Measure Smooth Iteration, Measure Smooth Extra (per video and GENERAL SETTINGS).
  - Channel‑space smoothing: Pre‑contrast channel smoothing, Post‑contrast channel smoothing (the latter commonly set to 100% on first pass per video).
  - Additional: Spectral averaging/splitting/counts sheets (`M/T SPECTRAL AVERAGING`, `M/T SPECTRAL SPLIT`, `M/T SPECTRAL COUNTS`) point to deeper noise controls over spectral axes.

## Ink Limits, Open‑Bite, and White/Black Handling
- quadGEN
  - Ink limits: Per-channel End (0–65,535) and percent; user-driven. No automatic open-bite/white-fog detection; users set limits or adjust curves.
  - Labels and helpers: axis gradients, per‑channel end‑value labels, graph overlays.

- POPS
  - Auto/Manual White Limit; Auto/Manual Black Limit for open‑bite/over‑inking detection and correction (video).
  - “TOL LIMITING AND BOOSTING” and “M/T MEASUREMENT SMOOTHING and LIMITING” sheets hint at formula‑based limiting ranges and policies.

## Contrast Intent and Tone Shaping
- quadGEN
  - Contrast can be imposed via: loading an `.acv` curve, applying a LUT, or editing Smart key points in Edit Mode. No built‑in “contrast intent templates”; users can store presets externally or via `.acv`/`.cube`.

- POPS
  - Input Contrast Intent: selectable curve families (Gloss, Matte, Uncoated Alt Process) pasted as Photoshop‑style number blocks (video). Green target line drives calibration toward a defined S‑curve rather than strictly linear.
  - “TONE CONTROL”, “NEW TONED CURVE”, and “NEW TONED GUTENPRINT” sheets indicate additional tone‑shaping pipelines and cross‑driver support.

## Curve Combination, Channel Ops, Ecosystem Bridges
- quadGEN
  - Global vs per‑channel application; copy/clone curves across channels; curve recompute/simplify; per‑channel enable/disable and ink‑limit scaling; export `.quad`.
  - Bridges: EDN and Photoshop via `.cube`/`.acv`. No Gutenprint/Canon‑PLA specific sheets.

- POPS
  - Blending: `BLENDING SETTINGS`, `BLENDING QTR CURVE`, `CURVE BLENDING`, `BLENDING CHANNELS`.
  - Channels: `CHANNELS`, `CHANNEL REMAPPING` for alternate mappings.
  - Ecosystem bridges: `.CUBE` LUT generators for calibration and digital negatives (`CALIBRATION .CUBE LUT`, `DIG NEG .CUBE LUT`), `Gutenprint Ink LUTs`, `Canon Dig Neg PLA`, `Canon Print PLA`, `Ergosoft Target Density`.
  - CMYK support: `FULL CMYK LUTS` sheet suggests beyond QTR monochrome.

## Spectral Tooling (POPS only)
- POPS includes multiple spectral modules (split/average/counts). The intro and step‑3 videos mandate i1Profiler exports at 380–730nm and emphasize patch‑averaged targets, aligning with spectral sheets.
- quadGEN does not operate on spectral bands; it consumes scalar L* and produces printer‑space corrections.

## UI/UX and Workflow
- quadGEN (single HTML app)
  - Live canvas graph with overlays, tooltips, and Edit Mode.
  - Tabbed in‑app Help with ReadMe, Glossary, Version History, Detailed Workflow.
  - Direct file I/O in browser; one‑click export of `.quad`.

- POPS (Excel workbook)
  - Many worksheets segment tasks: settings, measurements, smoothing, spectral, blending, LUTs, tone controls, driver‑specific outputs.
  - Workflow in videos: zero smoothing → paste `.quad` and measurements → set smoothing and post‑contrast smoothing → choose contrast intent → check luminance/open‑bite → calibrate curve → install & validate.

## Algorithmic Notes (as seen/inferrable)
- quadGEN
  - LAB path: Gaussian‑weighted reconstruction to 256 samples; user smoothing radius; PCHIP interpolation to dense curve; optional dual transform for industry plot semantics; monotonicity enforced.
  - Smart key points: numerical control points per channel; monotonic PCHIP for shape‑preserving edits.

- POPS
  - Spreadsheet computes: multi‑stage smoothing (measure + channel), limiting (white/black/tolerance), contrast remapping, blending, and multi‑ecosystem LUTs. Exact formulas locked in sheets; behavior evidenced by named tabs and the instructor’s steps.

## Feature Parity Matrix (summary)
- Common
  - Import measurements and `.quad`
  - Smoothing of measured data (approach differs)
  - Generate calibrated `.quad`
  - Support LUTs (quadGEN: ingest; POPS: generate)

- POPS‑only (observed)
  - Auto white/black limits (open‑bite handling)
  - Contrast intents (gloss/matte/uncoated templates)
  - Spectral split/average/counts workflows
  - Curve/channel blending and remapping modules
  - CGATS generator and multi‑driver LUT outputs (Gutenprint, Canon PLA, Ergosoft density)
  - Full CMYK paths

- quadGEN‑only
  - In‑graph Edit Mode with Smart key points (insert/delete/recompute), Undo/Redo
  - Single‑file, offline‑capable UI with built‑in docs and lab assistant (scriptable actions)
  - Positive‑space EDN/ACV/LUT ingestion adapters

## Gaps and Opportunities for quadGEN
1) Auto white/black limit (open‑bite/over‑ink)
   - Add measurement‑space reversal detection near endpoints; compute limiting threshold; expose auto/manual toggle.
2) Contrast intents
   - Add preset S‑curves as first‑class templates (gloss/matte/uncoated) selectable before calibration; or import `.acv` onto the intent lane.
3) Channel‑space smoothing
   - Offer optional post‑interpolation per‑channel smoothing (low‑pass on 256 samples) to dampen jagged sources.
4) Spectral workflows (optional)
   - If needed, accept CGATS with spectral bands, offer band‑averaging and illuminant selection, then collapse to L*.
5) Blending/Remapping toolset
   - Provide a “blend two curves” tool and channel remapper for advanced users.
6) LUT export
   - Add calibrated `.cube` LUT export (in addition to ingest) for external workflows.

## Implementation Considerations (quadGEN)
- Auto Limit Detection
  - Compute ΔL* slope near extremes; detect reversals; clamp output curve where slope sign flips; expose threshold UI.
- Contrast Intents
  - Store parametric S‑curves (bezier or 4‑point PCHIP) and show a green “intent” overlay; solve calibration toward intent instead of strict linear.
- Channel Smoothing
  - Apply Savitzky–Golay or moving‑average over 256‑point per‑channel outputs after interpolation; guard endpoints.
- LUT Export
  - Map final 0..1 outputs to 1D cube (11–33 entries) or 3D neutral axis with appropriate domain; include metadata.
- Spectral (optional)
  - Parse CGATS spectral blocks (380–730nm), convert to L* under chosen illuminant, persist white/black anchors.

## References Used
- Excel workbook sheets (partial list):
  - GENERAL SETTINGS, STARTING QTR CURVE, TOL LIMITING AND BOOSTING, BLENDING SETTINGS/CHANNELS, CALIBRATION, DIG NEG SETTINGS, MEASUREMENTS, M/T SPECTRAL SPLIT/AVERAGING/COUNTS, CALIBRATED CURVE, CGATS GENERATOR/CGATS, CURVE BLENDING, FULL CMYK LUTS, TONE CONTROL, NEW TONED CURVE/NEW TONED GUTENPRINT, CHANNEL REMAPPING, CALIBRATION .CUBE LUT, DIG NEG .CUBE LUT, Gutenprint Ink LUTs, Canon PLA, Ergosoft Target Density, LICENSE.
- Video transcripts (selected points):
  - Measurement smoothing (base/iteration/extra); pre/post contrast channel smoothing (common to set post=100%).
  - Auto/Manual white & black limits (open‑bite, fogging/over‑inking handling).
  - Contrast intent templates (Gloss/Matte/Uncoated) pasted as Photoshop curves; target S‑curve (green line).
  - i1Profiler usage, spectral range 380–730nm export; 128×5 averaged target.
  - Calibration loop: paste `.quad` + measurements → set smoothing/intent → auto‑limit if needed → export calibrated `.quad`.
