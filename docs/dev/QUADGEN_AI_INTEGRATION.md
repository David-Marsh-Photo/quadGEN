# QUADGEN_AI_INTEGRATION.md

AI integration system, Smart Curves, and key‑point operations for quadGEN.

## AI Integration System

### Function Categories

**Per-Channel Operations** (affect individual ink channels):
```javascript
set_ai_key_points(channelName?, keyPoints, interpolationType='smooth')
get_ai_key_points(channelName?)
adjust_ai_key_point_by_index(channelName?, ordinal, { inputPercent?, outputPercent?, deltaInput?, deltaOutput? })
insert_ai_key_point_at(channelName?, inputPercent, outputPercent?)
insert_ai_key_point_between(channelName?, leftOrdinal, rightOrdinal, outputPercent?)
delete_ai_key_point_by_index(channelName?, ordinal, { allowEndpoint=false })
delete_ai_key_point_near_input(channelName?, inputPercent, { tolerance=1.0, allowEndpoint=false })
generate_custom_curve(channelName, keyPoints, interpolationType) // manual numeric curves
set_channel_value(channelName, percentage)
enable_channel(channelName, enabled)
```

**Global Operations** (affect multiple channels):
```javascript
generate_global_custom_curve(keyPoints, interpolationType='smooth', channelFilter='enabled')
generate_and_download_quad_file()
```

### Assistant Functions: Contrast Intent
- The assistant can set and inspect the app's contrast intent.
- Functions (tool calls):
  - `set_contrast_intent(preset, params?)` — presets: `linear | soft | hard | filmic | gamma`; params: `{ gamma }` or `{ filmicGain, shoulder }`. Applies immediately, records undo, updates Δ vs target and filename tag.
  - `apply_custom_intent_sliders(params)` — params: `{ gamma, gain, shoulder }`. If `gain/shoulder` differ from defaults (0.55/0.35), applies Filmic; otherwise Gamma. Persists slider prefs.
  - `apply_custom_intent_paste(text)` — parses CSV/JSON and applies a Custom (pasted) target if valid; persists pasted text.
  - `get_contrast_intent()` — returns `{ id, name, params, hasSavedCustom }`.
- UI parity:
  - App defaults to Linear on load; "Custom (saved)" only appears when a custom exists (pasted valid data or non‑default sliders applied).
  - Endpoints are fixed by design; advise ink limit changes for black/white shifts.

### Smart Application Detection

The AI computes explicit numeric key points and applies them via the functions above. For multi-channel application, prefer `generate_global_custom_curve` when the user mentions multiple specific channels (e.g., "LK and MK").

- Orientation & metadata: When generating sample arrays or anchor points, supply printer-space coordinates if possible. quadGEN's loaders will convert any image-space data through the shared `DataSpace` helper and tag objects with `sourceSpace='printer'`; avoid double-applying flips in assistant-authored logic.

### Visualization & Panels
- Overlays: ACV/LUT/LAB are shown as read‑only overlays on the graph. They use labeled numbered markers only when no Smart key points exist; once Smart points exist, overlays render unlabeled markers to avoid number duplication.
- Labels: Smart key points are always labeled (1‑based), sorted by input. Label chips tint to the channel color with auto black/white text for contrast (dark/light theme aware).
- Processing detail panel: when a Smart Curve is active and a per‑channel source is loaded but disabled, the panel consolidates into a single line showing the source filename (with ✦Edited✦ when modified) and the current Smart key‑point count, e.g., `✦Edited✦ strong_contrast.acv (6 key points)`.

## Testing AI Integration

**Local Development**:
1. Ensure Cloudflare Worker is deployed with `CLAUDE_API_KEY`
2. Worker URL hardcoded in quadgen.html: `https://sparkling-shape-8b5a.marshmonkey.workers.dev/`
3. Test AI functions through the UI or browser console

**Rate Limiting**: Configured in Cloudflare Worker
- 10 requests/minute, 100/hour, 500/day per IP
- KV storage tracks usage (`quadgen_rate_limits` namespace)
- Graceful fallback if KV unavailable

**AI Model**: Claude Sonnet 4 (`claude-sonnet-4-0`)
- Latest snapshot alias - automatically uses newest Sonnet 4 version
- Focused on numeric key‑point computation; natural‑language preset curve generation is deprecated

## Canned LAB Linearization Explanation (for assistant responses)
- Short blurb:
  - quadGEN plots ink mapping: Y = output ink level vs X = input ink level; Y = X means no correction. If a measured patch is too dark at some X, the curve dips below the diagonal there (less ink); if it's too light, the curve rises above (more ink). Some tools mirror X (curves view) or plot luminance instead of ink, so features can appear at 1−X or on the opposite side of the diagonal.
- Longer version (4 bullets):
  - Input: Reads GRAY% and L*; converts L* to CIE‑exact density D = −log10(Y) with Y from the CIE inverse of L*, then normalizes by the dataset's max density; target = GRAY%/100.
  - Correction: expected − actual (positive = lighten/less ink; negative = darken/more ink), then smoothed; endpoints pinned.
  - Plot: Y = output ink vs X = input ink; dips (Y < X) lighten; humps (Y > X) darken.
  - Cross‑tool differences: Curves‑style UIs mirror X (0=black left); luminance plots invert "above/below"; align conventions for equivalence.

## Assistant Function Additions

- revert_global_to_measurement(): Reverts all channels to the loaded global measurement (clears Smart curves/points; undoable). Enabled only when a global measurement is present.
- revert_channel_to_measurement(channelName): Reverts a specific channel to its loaded per‑channel measurement (clears Smart curves/points; undoable). Enabled only when that channel has measurement loaded.

Notes:
- Both functions mirror the UI buttons and call the same internal logic with proper CurveHistory captures, UI refresh (filename/details, Edited flag), and preview updates.
- Natural‑language: The assistant can trigger these via intent (e.g., "revert global", "revert K to measurement", "undo revert"), mapping to the above function calls.

## Manual L* Entry (UI + Algorithm)

### UI
- Modal allows entering measured L* values alongside editable Target L* values in a table:
  - Columns: `#`, `Target L*` (editable numeric), `Target` swatch, `Measured` swatch, `L*` (measured numeric).
  - Target swatches reflect the Target L* color (CIE L* → sRGB grayscale).
  - Measured swatches show a "pending" hatched style with "—" until a valid L* is entered; then show grayscale.
  - Minimum 3 rows. Target and measured inputs validated to 0..100.

### Mapping
- Inputs can be evenly or unevenly spaced (editable Patch %). Monotonic increase required.
- Target density is linear in input position: `targetDensity = x` where `x = GRAY%/100`.
- Actual density from Measured L*: compute CIE luminance `Y` via the CIE inverse of L*, then optical density `D = −log10(Y)`, normalize by `Dmax` across the dataset: `actual = D/Dmax`.
- Build residuals `r_i = target_i − actual_i` at measured positions, then reconstruct the continuous correction by Gaussian kernel regression with a local bandwidth `σ(x)` (median K‑NN, clamps 0.02–0.15, α≈3). Endpoints pinned.
- Sample 256 points and apply PCHIP as the interpolator in apply1DLUT. No extra orientation flips are applied (printer‑space mapping is consistent with LAB).

### Application
- On "Generate Correction", apply as Global Linearization (enables toggle, updates About, refreshes preview).
- Defaults: If Target L* remains evenly spaced 100→0, behavior matches the previous linear target.

### Notes
- The target column defines "desired output tone curve"; measured defines "actual" mapping from input. The correction solves for `c` to make actual ≈ target.
- Validation surfaces bad inputs; live swatches help avoid confusion.

### Assistant tool functions (subset)
- `set_edit_mode(enabled: boolean)`: Toggle Edit Mode (UI state). Use `enabled=true` automatically before performing key‑point edits so UI and overlays are active. Respect user requests to turn it off when done.
- Help popup:
  - Header: matches main app (logo + version).
  - Tabs: ReadMe (embedded overview), Glossary (embedded definition list), Version History (rendered from `VERSION_HISTORY`).
  - About: legacy About dialog and trigger removed; history now lives in Help.
