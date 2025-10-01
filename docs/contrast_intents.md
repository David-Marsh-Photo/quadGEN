# Contrast Intent (Implemented)

This document describes quadGEN’s implemented support for pre‑defined and user‑defined contrast intents. Intents shape the target tonal curve that corrections aim to match. The CIE‑exact L*→density ingestion and reconstruction remain unchanged; intents are applied only at the target selection stage.

## Goals
- Provide fine‑art/alt‑process‑friendly presets with sensible defaults.
- Allow users to paste or define their own intent via a lightweight modal.
- Keep the main page minimal; default always Linear on load.
- Recompute correction automatically when the intent changes; ingestion and reconstruction are unchanged.
- Persist custom editor preferences (sliders/paste) locally; selection itself does not persist (always starts Linear).

## Presets
All presets are expressed as relative‑density target curves `T(t) ∈ [0,1]` for `t ∈ [0,1]` (percent input). The solver scales by the current process density range.

- Linear (default): `T(t) = t`.
- Soft (Gamma): `T(t) = t^γ`, adjustable γ (default ≈ 0.85 when chosen from the main dropdown, adjustable in the modal).
- Hard (Gamma): `T(t) = t^γ`, adjustable γ (default ≈ 1.20 when chosen from the main dropdown, adjustable in the modal).
- Filmic (soft shoulder): S‑curve with midtone gain + highlight shoulder parameters.
<!-- POPS‑Compat note: reserved for future versions if needed. -->

Notes
- Defaults are tuned for safe, process‑friendly starting points and can be refined via the modal.
 

## UX Overview
The main UI stays compact; detailed setup lives in a modal.

- Main page: compact dropdown `Intent` with items [Linear, Soft, Hard, Filmic, Custom, Enter Custom…]. Default is Linear on every load.
  - Selecting a preset applies it immediately.
  - Selecting `Custom` applies the last custom intent used in this session; if none, quadGEN prefers a saved pasted intent (if valid), otherwise uses saved sliders.
  - Selecting `Enter Custom…` opens the modal.
- Auto‑update: Changing the intent re‑solves the correction automatically against the selected target (no re‑ingest).
- Readouts: Delta summaries report “Δ vs target”. The .quad filename and comments include a compact intent tag.

## Modal
Tabbed dialog with three tabs: Presets, Custom, and Paste CSV/JSON.

Tabs
- Presets: Apply Soft/Hard (gamma) or Filmic with parameter sliders.
- Custom: Simple sliders for Gamma or Filmic‑like (midtone gain + shoulder).
- Paste CSV/JSON: Paste or type data; parser validates automatically as you type/paste.

Buttons
- Footer: `Reset to Linear`, `Cancel`, and a context‑aware Apply:
  - Presets: `Apply Intent`
  - Custom: `Apply Sliders`
  - Paste: `Apply Pasted`

Behavior & Polish
- Modal height is fixed (512px) to prevent layout jump between tabs; content scrolls inside.
- Dark mode styling matches the Help popup (elevated background, subtle border, consistent scrollbars).
- Backdrop click is guarded to avoid accidental close while selecting text.
- Paste tab shows validation inline with the Parse button and auto‑parses on input.
- Clear note in Paste tab: data apply over a fixed 0–100% input scale; black/white points do not move — adjust endpoints via ink limits, not intent.

## Data Model & Persistence
Runtime intent state contains an `id`, `name` (for custom points), and either parameters (gamma/filmic) or a compiled function from pasted points. The app persists only editor preferences in `localStorage` under `contrastIntentCustomPrefsV1`:

- `gamma`: last gamma used in sliders.
- `gain` and `shoulder`: last Filmic‑like parameters used in sliders.
- `pasteText`: last pasted text (for quick reuse).

Notes
- The active selection always starts at Linear on load; choosing `Custom` prefers the last valid pasted curve from `pasteText`, otherwise the saved sliders.
- Pasted point sets are compiled to a monotone target function with endpoint pinning.

## CSV/JSON & Other Formats
The parser supports several practical input formats. All inputs are normalized to relative density [0,1] on import.

CSV examples
```
percent_input,density_rel
0,0
10,0.05
25,0.20
50,0.55
75,0.85
100,1.0
```

```
percent_input,Lstar
0,95
25,75
50,55
75,35
100,10
```

- `density_abs` is allowed; it will be normalized by the modal’s current `Dmax` preview so that `relative = clamp(abs / Dmax, 0, 1)`.
- `Lstar` values are converted via CIE inverse to `Y`, then `D = −log10(Y)`, then normalized to relative density by the modal’s `Dmax` preview.

JSON example
```json
{
  "id": "filmic_soft_shoulder_v1",
  "name": "Filmic Soft Shoulder",
  "source": "custom",
  "generator": {
    "type": "filmic",
    "params": {"toe": 0.25, "toe_soft": 0.20, "mid_slope": 1.0, "shoulder": 0.35}
  }
}
```

Points example
```json
{
  "id": "anchors_5pt_v1",
  "name": "5‑Point Anchors",
  "source": "custom",
  "points": [[0,0], [0.2,0.12], [0.5,0.55], [0.8,0.88], [1,1]]
}
```

Other accepted formats
- Label‑first CSV: `Matte Inkjet,20,20,12`
- Pipe key/val: `Matte Inkjet | Input=20 Linear=20 Intent=12`
- CGATS‑like blocks: `BEGIN_DATA_FORMAT ... BEGIN_DATA ... END_DATA` (uses `INPUT`/`INTENT` columns)
- Whitespace tables: `0 0 0`, `20 20 12`, …
- One‑value‑per‑line 1D lists (even spacing), optional label as first line
- JSON media/curve schema: `{ Media: "…", Curve: [{Input, Linear, Intent}, …] }`

## Pipeline Placement
- Ingestion: CIE L*→Y→D is invariant. Intents are not applied during ingestion.
- Reconstruction: Gaussian/PCHIP reconstruction of measurements is invariant.
- Target Selection (intent): Compute the relative target `T(t)` from the selected intent and re-solve the correction so the predicted density follows `T(t)`; endpoints are pinned.
- Deltas: UI reports “Δ vs target” using the current intent.

### Applying intent to a loaded `.quad`
- When LAB/Manual data is **not** loaded, the Global card exposes an “Apply Intent” button. This bakes the currently selected preset into the plotted `.quad` (all channels) without re-running the measurement solver.
- The button uses the same target math as the LAB pipeline and honours existing ink limits. If you switch back to Linear, quadGEN restores the original loaded curve.
- Recommended workflow: keep a reference `.quad` that is fully linearized to Linear intent, then branch contrast variants by applying Gamma/Filmic/POPS presets as needed. Store each variant under a new filename.
- Alternative: leave the reference `.quad` untouched, do the contrast move upstream in Photoshop or similar, and print through the Linear reference. Mathematically this produces the same result as baking the preset into the `.quad`; choose the path that fits your production process and version-control practice.
- Guardrails: the Apply button is disabled when LAB/Manual data is active, so measurement corrections remain the primary path for target-driven solves.

## Behavior
- Auto-update: Switching intent or changing its parameters triggers an immediate re-solve from the current measurement reconstruction.
- Undo/Redo: Each Apply constitutes a history step (including intent changes). `Reset to Linear` restores default.
- Endpoints: `(t=0) → 0` and `(t=1) → 1` are held in the relative target. Endpoint shifts should be made via ink limits/end values, not intent.
- Defaults: App starts on Linear every load; sliders and paste text are prefilled from saved preferences.
- Custom selection: First use prefers a valid saved pasted curve; otherwise falls back to saved sliders.

## Export & Traceability
- Filename: Exported `.quad` includes a compact intent tag before `CORRECTED`:
  - `LIN` (Linear), `Gxxx` (Gamma, e.g., `G085 → γ=0.85`), `FILM`, `CUST`.
- .quad comments: Global section includes `Intent: <name>` and `Intent tag: <tag>`.
- Console/labels: Deltas and summaries refer to the selected target.

## Validation
- Monotonicity: Enforced for pasted/constructed curves with endpoint pinning.
- Range: Inputs are clamped to [0,1] relative density.
- Sparsity: Pasted data with too few distinct interior points may be rejected; use gamma/filmic sliders instead.

## Shipped Summary
- Main dropdown + modal (Presets, Custom sliders, Paste CSV/JSON).
- Auto‑parse pasted data; inline validation; clear endpoint note.
- Default to Linear on load; prefill saved sliders/paste text.
- Deltas vs target; filename intent tags; .quad comments include intent name/tag.
- Undo/Redo integration for intent changes.

## Open Questions
- Add optional target overlay on the main chart?
- Remember last active intent on load (behind a preference toggle)?
- Consider adding additional preset families in the future as coefficients become available.

## Appendix: Generators
Gamma
- Formula: `D_target = Dmax · t^γ`.
- Param: `γ ∈ [0.6, 1.6]` (UI slider).

Filmic (soft shoulder)
- Implemented with midtone gain and shoulder parameters in the UI; compiled to a smooth, monotone S‑curve internally with endpoint pinning.

<!-- POPS‑Compat section removed from current preset set; may return in future versions. -->

## Appendix: JSON Schema (Custom Intent)
```json
{
  "$schema": "https://quadgen.app/schemas/intent-v1.json",
  "id": "string",
  "name": "string",
  "source": "preset|custom|import",
  "generator": {
    "type": "gamma|filmic|pops_compat",
    "params": {
      "gamma": 1.0,
      "toe": 0.25,
      "toe_soft": 0.2,
      "mid_slope": 1.0,
      "shoulder": 0.35
    }
  },
  "points": [[0.0,0.0],[0.5,0.55],[1.0,1.0]],
  "domain": "percent_input_0_1",
  "range": "relative_density_0_1",
  "version": 1
}
```

Notes
- Either `generator` or `points` must be present, but not both.
- When `points` are provided, `generator` is ignored.
- The solver scales the relative target by the current `Dmax` at solve time.

## Appendix: CSV Header Rules
- Header row required; case‑insensitive; recognized names:
  - `percent_input`, `t`, `%input` (domain)
  - `density_rel`, `d_rel`, `rel_density` (range, relative)
  - `density_abs`, `d_abs`, `abs_density` (range, absolute)
  - `lstar`, `L*` (range in L*)
- Exactly one range column must be provided alongside a domain column.
- Extra columns are ignored; label columns are allowed but optional.

## Rollout
- Phase 1: Presets + modal (Gamma, Filmic, CSV/JSON). Linear remains default. No per‑channel overrides.
- Phase 2: Library management (rename, delete), optional σ(t) finesse per intent.
- Phase 3: Per‑channel overrides and advanced expression editor (optional).
