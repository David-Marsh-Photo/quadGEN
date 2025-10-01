## Documentation Policy
- Help is now centralized in a tabbed Help popup (ReadMe, Glossary, Version History). When you change user‑facing behavior, update Help (ReadMe/Glossary as needed).
- Glossary: The Help → Glossary markup lives in `src/js/ui/help-content-data.js`. Keep entries strictly ordered alphabetically, and preserve the current formatting style (definition list with short, plain descriptions) unless a change is explicitly requested.
- Reference documention resides in /docs. File format specs for .quad, .acv curves, .cube LUT, and LAB / L* definition txt files are in docs/File_Specs
- Manual regression matrix lives at `docs/manual_tests.md` (covers per-channel undo toggle check).

## Assistant Behavior

- you are a Senior Lab Tech at a fine art print studio offering museum-quality digital prints, historical alternative photographic processes, and hand-pulled photogravures. quadGEN is a program the studio uses to calibrate print processes
- when making a large structural change, present a plan for implementation and ask for confirmation first
- when making any change, at a minimum run a headless test that ensures that the app loads without errors in the console.
- begin every fix by attempting to capture the regression with a targeted automated test; verify the test fails before iterating on the solution and finish only once the test suite passes
- after implementing a fix, create or use an existing test to verify. Only explicitly ask the user to confirm the fix (e.g., provide a simple repro they can run) if you cannot verify through an autmated test. If the user confirms, document the fix in the appropriate places (CHANGELOG.md for developer notes; CLAUDE.md and AGENTS.md for engineering details)
- when a bug or issue has any visible component, capture and include relevant screenshots with the testing artifacts so visual regressions stay traceable
- Minor UI-only tweaks (e.g., simple layout or style adjustments with no behavioral change) do not require a plan, doc updates, or tests unless the user explicitly asks.

### Edit Mode × Linearization (Behavior Notes)
- Global linearization now applies even when Smart points exist (Edit Mode ON). Previously, Smart guard could prevent global corrections from taking effect.
- Global correction panel replaces the helper hint with the loaded filename plus measured-point count (e.g., `Manual-LAB-Data.txt - 5 points (LAB)`) as soon as a LAB/CGATS/manual dataset is applied, matching the legacy status row.
- Loading a new global LAB/CGATS correction while Edit Mode is enabled now triggers an immediate Smart-point reseed from the measurement so the chart refreshes without toggling Edit Mode.
- Point-selector arrows in Edit Mode advance through Smart key points sequentially (1→2→3…), matching the sorted curve order.
- Recompute (Edit panel) samples from the currently plotted curve (respects global/per-channel corrections and End) to regenerate Smart points that match what you see.
- Double-apply guard: If you recompute while a global correction is active, the Smart meta is tagged `bakedGlobal`; plotting skips reapplying global on top of the recomputed Smart curve to avoid exaggerated results.
- Linear detector tightened: “near-linear” collapse threshold reduced and sampled at more positions to avoid collapsing lightly corrected curves to endpoints.
- Smart‑source guard: Channels whose source is `smart` are treated as already baked for plotting; global is not re‑applied on top. This prevents double scaling when toggling Edit Mode OFF→ON.
- Per‑channel guard: Skip per‑channel linearization only when a Smart curve is actually applied (source tag), not just because Smart key points exist. This avoids the “plot reverted to ramp” case when Edit Mode primes key points for overlays only.
- Metadata preservation in edits and history: `ControlPoints.persist()` preserves `keyPointsMeta` (e.g., `bakedGlobal`), and undo/redo restores it alongside interpolation.
- Undo restores per-channel measurement toggles: when a linearization is removed via undo or revert, the per-channel slider is now disabled/unchecked to match the cleared data.
 - Revert UX: Global/Per-channel Revert preserves the current Edit Mode selection (if still enabled) and clears any lingering Smart source tags so overlays and label colors continue to match the selected channel after revert.


# Repository Guidelines

## Project Structure & Module Organization
- currently no git 
- Working codebase policy: Make app/UI changes in the `src/` directory. The root `index.html` is now the build output (generated from `dist/index.html`). Do not modify historical variants unless explicitly requested.
- Legacy reference: `quadgen.html` hosts the pre-modular build; treat it as the source of truth when matching legacy Manual L* entry behavior.
- The `index.template.html` file, which is the source for all builds, is located in the `src` directory.
- After altering any source files that feed the bundle (typically under `src/`), run `npm run build:agent` to regenerate `dist/index.html` and copy it to the project root. Mention the refreshed build in your final reply.
- **Modular Architecture**: Application now uses ES6 modules with organized directory structure:
  - `src/js/core/` - Core state management, data processing, validation
  - `src/js/ui/` - UI components, theme management, chart handling
  - `src/js/utils/` - Utility functions and helpers
  - `src/main.js` - Application entry point with module initialization
- **Theme System**: Comprehensive light/dark mode support via `theme-manager.js`:
  - CSS custom properties for all UI elements
  - localStorage persistence with system preference detection
  - Theme toggle button with accessibility features
  - Chart and scrollbar styling that adapts to theme
- Utilities: `apply_lut_to_image.py`, `apply_lut_non_inverted.py`, `plot_lut.py`.
- Proxies: `cors-proxy.js` (local Node proxy), `cloudflare-worker.js` (Edge proxy with rate limits).
- Data/assets: `*.quad`, `*.cube`, `*.acv`, `*.tif`, LAB `*.txt`, images.
- Docs: docs directory
- Legacy `index.html` helper text keeps attributes properly quoted so the Vite single-file build stage stays warning-free.

## File Format Reference
- QuadToneRIP .quad format summary: `docs/File_Specs/QTR_QUAD_SPEC_SUMMARY.md`
- .cube LUT (1D/3D) parsing & orientation: `docs/File_Specs/CUBE_LUT_SPEC_SUMMARY.md`
- Photoshop .acv curve parsing: `docs/File_Specs/ACV_SPEC_SUMMARY.md`
- LAB (.txt) measurement data format: `docs/File_Specs/LAB_TXT_SPEC_SUMMARY.md`
- CGATS.17 importer zeros CMY channels whose absolute value is ≤2.5%, so neutral ramps with minor tints stay on the K-only extraction path while the raw measurement metadata preserves original values.
- Loader accepts Argyll CTI3 (.ti3) files and treats them as CGATS.17 data during LAB linearization import.

## Canned LAB Linearization Explanation
- Short blurb (for quick answers):
  - quadGEN plots ink mapping: Y = output ink level vs X = input ink level; Y = X means no correction. If a measured patch is too dark at some X, the curve dips below the diagonal there (less ink); if it’s too light, the curve rises above (more ink). Some tools mirror X (curves view) or plot luminance instead of ink, so features can appear at 1−X or on the opposite side of the diagonal.
- Longer version (4 bullets):
  - Input: Reads GRAY% and L*; converts L* to CIE‑exact density D = −log10(Y) with Y from the CIE inverse of L*, normalized by the dataset’s max density; target = GRAY%/100.
  - Correction: expected − actual (positive = lighten/less ink; negative = darken/more ink), then smoothed; endpoints pinned.
  - Plot: Y = output ink vs X = input ink; dips (Y < X) lighten; humps (Y > X) darken.
  - Cross‑tool differences: Curves‑style UIs mirror X (0=black left); luminance plots invert “above/below”; align conventions for equivalence.

## Build, Test, and Development Commands
```bash
npm run build:agent
```
- Runs the production build and copies `dist/index.html` to the project root
- Use this after changing files in `src/` so `index.html` matches the latest bundle
- Follow the build with the Playwright smoke check to ensure the bundle loads without console errors:
  ```bash
  npm run test:smoke
  ```
- The smoke test opens `index.html` headlessly and fails if any page or console errors fire during load. Use it as the default regression gate; run broader suites (`npm run test:e2e`, `npm run test`) only when deeper coverage is required.
- You can extend the build script with lint or additional tests before `vite build` if you want a stricter gate before shipping

### Browser Testing Strategy
- **Primary Method**: Playwright tools (`playwright__browser_*`) for all automated browser checks—use them by default for navigation, interaction, screenshots, and console capture.
- **Screenshots/Console**: MCP screenshot and console helpers remain the first choice for single-artifact captures.


**CRITICAL Playwright Testing Rules**:
1. **Inspect before interact**: ALWAYS create a diagnostic script FIRST to examine the actual DOM structure before attempting to interact with elements
   - Check what elements exist, their visibility, their actual structure
   - Don't assume elements are accessible just because they exist in the HTML
   - Example: Check if inputs are invisible/disabled by default
   - Use the Bash tool to run simple diagnostic scripts yourself - don't ask the user
2. **Wait for initialization properly**: Use `page.waitForFunction()` to wait for app-specific readiness conditions, not arbitrary timeouts
   - Wait for specific elements to exist AND be in the expected state
   - Check for app-specific markers (e.g., `_virtualCheckbox`, fully rendered rows)
3. **Match the user workflow**: Interact with UI exactly as a user would
   - Use checkboxes, buttons, file pickers - not direct DOM manipulation
   - Dispatch events the way the app expects them
   - Respect the app's virtual/proxy patterns (e.g., `_virtualCheckbox`)
4. **One working test beats many broken ones**: If a test fails, FIX IT before trying variations
   - Understand WHY it failed by examining the DOM with a diagnostic script
   - Don't create 10 similar tests hoping one will work
5. **Better error messages**: When elements aren't found, log what WAS found to help diagnose
6. **Know when to escalate**: After 2-3 failed test attempts, provide clear manual test instructions rather than asking the user to debug your scripts
   - Only escalate to manual testing when automated testing is genuinely blocked (e.g., needs real file picker interaction)
   - Don't ask user to run diagnostic scripts - run them yourself with the Bash tool
7. **User's time is precious**: Automated tests should save time, not waste it. Every request for manual testing should be justified

### MCP Playwright Approach
- **Access**: Use `playwright__browser_*` calls (navigate, click, type, evaluate) for scripted flows; keep DOM queries and evaluate payloads tight to avoid large snapshots.
- **Snapshots/Artifacts**: `playwright__browser_take_screenshot` and `playwright__browser_console_messages` provide point-in-time assets without additional scripting.
- **Runtime notes**: MPC responses include auto-collected snapshots/console output; mind the 25K token ceiling by targeting specific sections of the DOM.


### Browser Testing Notes
- **File creation**: Create temporary `.js` files for complex testing workflows
- **Reusable scripts**: Save common test patterns as `test-*.js` files in project root
- **Debug access**: All `window.*` functions and console commands available in shell scripts
- **Performance**: Shell Playwright much faster than MCP (no snapshot overhead)
- **Module Testing**: Each ES6 module can be tested independently
- **Theme Testing**: Toggle themes via UI button or console: `window.toggleTheme()`
- Use debugging statements and ask user to provide log

## Coding Style & Naming Conventions
- HTML/JS: 2‑space indent; camelCase for functions/variables; keep logic grouped by feature; avoid global leaks.
- Algorithms: PCHIP is mandatory for smooth interpolation. Do not substitute other splines.
- Python: 4‑space indent; snake_case; minimize deps (NumPy, Pillow). Scripts should run from repo root.
- Files: Source code is in the `src/` directory. The root `index.html` is the build output. Do not edit historical variants unless explicitly requested; keep experimental variants clearly suffixed (e.g., `quadgen copy 4.html`).

## Debug Flags
- `DEBUG_LOGS` (default: false): Gates general console logging (curve generation decisions, make256/apply1DLUT traces, ink‑limit changes, undo/redo flow, chart snapshots). Enable/disable in the browser DevTools console:
  - `DEBUG_LOGS = true` (on), `DEBUG_LOGS = false` (off)
- `DEBUG_AI` (default: false) / `DEBUG_SMART` (alias): Gates assistant/smart-curve logging (tool/function calls, provider decisions, retry notices, API key validation logs). Useful for diagnosing Lab Tech behavior:
  - `DEBUG_AI = true` (on), `DEBUG_AI = false` (off). `DEBUG_SMART` mirrors `DEBUG_AI`.
- Both flags only affect local console output. They do not change processing or send additional context to the AI unless the user explicitly chats and console context is injected.

### External Playwright Runner (Fallback)
- Prefer direct `node tests/...` runs first; use the watcher only if escalated commands are unavailable or you need unattended reruns
- Launch `runner/watch-runner.mjs` outside Codex with `node runner/watch-runner.mjs`; it waits for trigger files and executes `npm run test:e2e`
- Write `runner/trigger.json` to start a run; include `args` and `env` when you need custom scripts or environment tweaks
- Results land in `runner/results/`; `node runner/wait-for-status.mjs --follow` tails progress and exits with the Playwright status code
- See `docs/playwright_external_runner.md` for detailed setup and troubleshooting

## Version History Notes
- Keep entries concise, direct, factual, and short.
- Prefer plain, user-facing language; avoid internal jargon.
- Add only what’s necessary to inform users about changes.
- Do not assume a change “worked” without proof. For every feature or behavior fix, run the relevant tests (Playwright, unit, or manual script) or explain why they’re unnecessary. Only minor copy/layout tweaks may skip this.

## Changelog Workflow
- Primary release notes live in `CHANGELOG.md` under an “Unreleased” section until a version bump.
- On release:
  - Bump `APP_VERSION` in `src/js/core/version.js`.
  - Move “Unreleased” items into a new `## [vX.Y.Z] — YYYY‑MM‑DD` section; start a fresh “Unreleased” at the top.
- Update `VERSION_HISTORY` in `src/js/ui/help-content-data.js` so Help → Version History reflects the same summary.
- Keep scope separation:
  - `CHANGELOG.md`: user‑facing highlights (Added/Changed/Fixed/Removed/Docs).
  - `AGENTS.md`: architectural / pipeline notes, assistant behaviors, function contracts, routing rules, editing defaults.

## Manual L* Entry (Agent Guidance)
- When guiding users through manual L* corrections:
  - Explain the table: `Target L*` (editable desired tone), `Target` swatch, `Measured` swatch (pending until valid), `L*` (measured values).
  - Clarify that Target L* defines the desired output tone curve; Measured L* defines the actual mapping. The correction finds inputs so actual ≈ target.
  - Validate at least 3 rows; all Target and Measured values must be within 0..100.
  - Remind that inputs are evenly spaced by row order (top→bottom) for now.
  - Recommend clicking “Generate Correction” to apply the global linearization; confirm the result and document the change if the user approves.
- Treat `docs/print_linearization_guide.md` as the ground truth for how quadGEN and assistants should derive correction curves from measured L*:
  - Target is a straight line in printer space (0 % ink at input 0, 100 % ink at input 100) unless the user explicitly selects another intent.
  - Build the correction by inverting the measured response so that neutral midpoints remain fixed (e.g., 50 % input with balanced data must remain at 50 % output).
  - Stay in printer space; optional log-density conversion is allowed for stability but must still yield endpoints (0,0) and (100,100) and preserve the 50 % crossing when the measurements are symmetric.
  - Enforce monotone interpolation/inversion (PCHIP or equivalent), clamp endpoints, and export 256 samples.
  - When questions about the math arise, reference the guide before deferring to legacy behavior.

- Helper: `buildInkInterpolatorFromMeasurements(points, options)` centralizes the printer-space inversion used by manual L* entry and LAB `.txt` imports.
  - Each point must provide `input` (0–100) and `lab` (L* 0–100); the helper sorts, converts L* into normalized ink (dark = 1), smooths with location-aware Gaussian weights, enforces monotonicity, and builds a PCHIP spline.
  - The return shape is `{ evaluate(t), createEvaluator(widenFactor), positions }`; `evaluate` expects normalized input (0–1) and yields normalized ink, so callers can sample 256 points and scale to 0–100 or 0–65535.
  - `options` exposes smoothing controls (`neighbors`, `sigmaFloor`, `sigmaCeil`, `sigmaAlpha`) plus an optional `widenFactor` override; keep defaults unless the user explicitly requests a softer or more aggressive fit.

## Security & Configuration Tips
- Do not hardcode API keys. For workers use `CLAUDE_API_KEY`; for local dev, prefer environment variables or a non‑committed `apikey.txt`.

## Agent Integration
- Reference: see `CLAUDE.md` for full agent capabilities, function names, and prompts.
- Usage: compute explicit numeric key points; apply via `set_smart_key_points` (AI aliases still accepted). For edits use `adjust_smart_key_point_by_index`, `insert_smart_key_point_at`, and `insert_smart_key_point_between`. Keep interpolation `PCHIP` for smooth results unless linear is explicitly requested.
- Connectivity: local dev via `cors-proxy.js`; production via `cloudflare-worker.js` with KV rate limits and `CLAUDE_API_KEY`.

### Key-Point Editing Defaults
- “point N” refers to Smart key‑point ordinal N (1-based, endpoints included).
- Channel default: if unspecified, use the first enabled channel (percentage > 0 or endValue > 0 or enabled=true). Ask only if none enabled.
- Silent conversion on first edit: if Smart key points don’t exist yet, edit/insert/delete calls will auto-create them from loaded ACV/LUT/LAB or from the currently displayed curve (no user prompt).
- Disambiguation policy: if the user mentions “point N … %”, interpret as a key-point output change (not a channel ink limit). Example: “set point 5 to 90%” → `adjust_smart_key_point_by_index(ordinal=5, outputPercent=90)`.
- Endpoint behavior: ordinals include endpoints; deletions of endpoints are blocked unless `allowEndpoint=true`.
 - UI note: Selected point XY input shows X (input %) and Y (absolute % after End). Up/Down nudges adjust absolute Y; Left/Right adjust X.

### Key-Point Edits vs Ink Limit (Expected Behavior)
- `outputPercent` is absolute chart percent (0–100) after End scaling. The assistant should compute the required pre‑scale value so the plotted point lands at the requested absolute Y.
- If the requested point would exceed what the current End allows, raise the channel End just enough to reach it. When End increases due to a key‑point edit, scale all other key points down pre‑scale by oldScale/newScale so their absolute values remain unchanged — only the edited point moves.
- Changing the channel End (percent or value fields in the table) uniformly scales the entire curve by design; use that path when the user intends a global amplitude change.
- Global Scale control multiplies every channel’s End against its cached baseline. Setting 90% then 95% reuses the original End values instead of compounding; returning to 100% clears the cache, and manual percent/End edits refresh the stored baseline before the next scale.
  - The Scale input accepts up to 1000%; scaling stops automatically once any channel would hit 100% (65,535). The assistant can rely on `scale_channel_ends_by_percent` to handle the clamp.
- For .quad data: Smart key points are precomputed on load using an adaptive simplifier so first edits do not re‑seed points and “jump”. Defaults (1.0% max error, 16 points) are user‑tunable in the UI, and “Recompute .quad key points” regenerates per‑channel Smart points without modifying loaded base curves.
- Emit a concise status when End is raised, e.g., “K ink limit changed to 60%”.
 - Blocking behavior: If End is effectively locked (channel disabled or inputs disabled) and an absolute edit would exceed the limit, the edit is blocked and a status alert appears in the graph header.

### Tool Semantics
- `get_smart_key_points(channelName?)`: returns stored Smart key points. If none exist yet, returns success with an empty list plus suggested next actions; any edit call will auto-create points (silent conversion). Legacy `get_ai_key_points` remains available.

### Visualization & Panels
- Overlays: ACV/LUT/LAB data are shown as read-only overlays in the chart. They display numbered labels only when no Smart key points exist; once Smart points exist, overlays render as unlabeled markers to avoid duplicate numbering.
- Smart overlay: Smart key points always show labeled 1-based ordinals.
- Channel info panel: single-line label is always visible. When a Smart Curve is active and a per-channel source is loaded but disabled, the panel shows a consolidated line with the source filename and the current Smart key-point count, for example: `✦Edited✦ strong_contrast.acv (6 key points)`.
- Zoom controls: the +/− buttons in the lower-left of the graph rescale the Y-axis (0–displayed max). Use `set_chart_zoom` or `nudge_chart_zoom` to mirror that behavior programmatically; session status reports the current max when it’s below 100%. Natural-language triggers include “zoom in/out,” “zoom way in/out,” and “zoom [in/out] as far as possible.” Zoom requests clamp to the highest active ink limit—if a call would crop a 100% curve, the helper returns the enforced maximum instead.
- Chart canvas listens to a ResizeObserver (with rAF throttling and zero-size guards) so resizing the window or panel automatically triggers a DPR-correct redraw without redundant work.
- Axis and ink labels scale their font sizes using devicePixelRatio once the chart is at least ~300px wide, and their positioning adapts so text remains readable on high-density displays without overlapping.

### Print Intent & EDN/QTR
- quadGEN applies all corrections in printer-space (.quad). A required Print Intent controls interpretation:
  - Positive (default): EDN-style LUT/.acv applied as-is as global linearization G(x) = EDN(x).
  - Negative: EDN-style LUT/.acv applied inverted G(x) = 1 − EDN(x) to emulate “apply to positive then invert image” without an editor.
- Measurement (LAB/step wedge) linearization remains unchanged (PCHIP) regardless of intent.
- Stacking EDN + measurement is allowed but may double-shape; prefer one or confirm intentionally.
- LAB traceability & warning: LAB imports record the current Print Intent as “measured: …”. If the selected Print Intent later differs from that, the UI displays a small warning banner recommending reprint/remeasure or switching intent to match.

### References & Web Access
- No bookmarks or auto-citations are injected. The assistant will only include links if the user provides them or explicitly requests references.
- No web search/fetch tools are enabled; use the configured proxy only for AI responses.

Traceability:
- LAB measurement imports record the current Print Intent as “measured: Positive/Negative” in the UI and .quad comments.
- Changing Print Intent later does not alter LAB data. Recalibrate (reprint/remeasure) if you change intent.

### Agent Commands
 - Per‑channel (preferred): `set_smart_key_points(channelName?, keyPoints, interpolationType)`, `get_smart_key_points(channelName?)`, `adjust_smart_key_point_by_index(channelName?, ordinal, params)`, `insert_smart_key_point_at(channelName?, inputPercent, outputPercent?)`, `insert_smart_key_point_between(channelName?, leftOrdinal, rightOrdinal, outputPercent?)`, `insert_smart_key_points_batch(channelName, inserts[])`, `delete_smart_key_point_by_index(channelName?, ordinal, {allowEndpoint})`, `delete_smart_key_point_near_input(channelName?, inputPercent, {tolerance, allowEndpoint})`, `generate_custom_curve(channelName, keyPoints, interpolationType)`, `set_channel_value(channelName, percentage)`, `enable_channel(channelName, enabled)`.
 - Legacy aliases still supported: `set_ai_key_points`, `get_ai_key_points`, `adjust_ai_key_point_by_index`, `insert_ai_key_point_at`, `insert_ai_key_point_between`, `insert_ai_key_points_batch`, `delete_ai_key_point_by_index`, `delete_ai_key_point_near_input`.
 - Global: `generate_global_custom_curve(keyPoints, interpolationType, channelFilter)`, `generate_and_download_quad_file()`, `set_auto_white_limit(enabled)`, `set_auto_black_limit(enabled)`, `set_chart_zoom(percent)`, `nudge_chart_zoom(direction)`.
  - Global scaling: `scale_channel_ends_by_percent({ scalePercent })` — multiplies every enabled channel's End against its cached baseline (see notes above).
  - Global intent remap: `apply_intent_to_loaded_quad()` — bakes the currently selected intent into the loaded `.quad` when no LAB/manual data is active.

### Contrast Intent Controls
- `set_contrast_intent(preset, params?)`
  - Presets: `linear | soft | hard | filmic | gamma`
  - Params (optional):
    - `gamma` when `preset='gamma'` (e.g., 0.85, 1.20)
    - `filmicGain` (default 0.55), `shoulder` (default 0.35) when `preset='filmic'`
  - Notes: Applies immediately and records undo. Also updates filename intent tag and Δ vs target.
- `apply_custom_intent_sliders(params)`
  - Params: `gamma`, `gain`, `shoulder`
  - Behavior: if `gain/shoulder` differ from defaults, applies Filmic; otherwise applies Gamma. Persists slider prefs.
- `apply_custom_intent_paste(text)`
  - Parses CSV/JSON (same formats as the modal) and applies a Custom (pasted) intent if valid; persists pasted text.
- `get_contrast_intent()`
  - Returns `{ id, name, params, hasSavedCustom }` for status/UI logic.

Usage examples
- Soft preset: `set_contrast_intent("soft")`
- Filmic tuned: `set_contrast_intent("filmic", { filmicGain: 0.58, shoulder: 0.30 })`
- Explicit gamma: `set_contrast_intent("gamma", { gamma: 0.92 })`
- Custom sliders: `apply_custom_intent_sliders({ gamma: 1.05 })` or `apply_custom_intent_sliders({ gain: 0.60, shoulder: 0.28 })`
- Paste data: `apply_custom_intent_paste("percent_input,density_rel\n0,0\n50,0.5\n100,1.0")`

Notes
- App always defaults to Linear on load; only slider/paste prefs persist. Selecting or applying a custom will surface “Custom (saved)” in the Intent dropdown.

### Revert Functions (Assistant-Callable)
- `revert_global_to_measurement()` — Revert all channels to the loaded global measurement (clears Smart curves/points; undoable). Enabled only when a global measurement is present.
- `revert_channel_to_measurement(channelName)` — Revert the specified channel to its loaded per‑channel measurement (clears Smart curves/points; undoable). Enabled only when that channel has measurement loaded.

Notes:
- Both functions mirror UI behavior and record history via `CurveHistory.captureState(...)`. Labels and Edited flags refresh accordingly.
- Natural language: map intents like “revert global”, “revert K to measurement” to these functions rather than simulating UI steps.

### .quad Adaptive Simplifier Controls
- UI exposes Max error % (0.05–5.0, default 1.0) and Max points (2–20, default 16) with a “Recompute .quad key points” button.
- Precompute on load and recompute action both use these settings; they do not change the underlying loaded .quad data.

### Direct‑Seed Threshold (All Sources)
- Variable: `DIRECT_SEED_MAX_POINTS` (default: 25). When a source has ≤ 25 points, seed those points directly into Smart key points; above this threshold, sample the plotted curve and simplify to an edit‑friendly subset.
- ACV: If anchors ≤ 25, seed anchors directly; otherwise simplify from the plotted curve.
- LAB/Manual L*: If original measurement rows ≤ 25, seed at measured Patch % positions (sample Y from current plotted curve); otherwise simplify.
- LUT: If samples ≤ 25, seed directly at even X; otherwise simplify.

### Routing Rules
- Prefer `generate_global_custom_curve` when user mentions multiple specific channels; otherwise use per‑channel functions. Do not use deprecated natural‑language curve generators.

### Interpolation & Smoothing
- Interpolation: PCHIP is mandatory for smooth curves; only use Linear for technical cases. Do not use Catmull‑Rom, cubic splines, smoothstep, or cosine.
- Smoothing: “Smoothing Splines” (auto lambda) and “Uniform Sampling” are available; selection affects both `.cube` and LAB data processing and works with LAB measurement data.

### Cloudflare Worker & Model
- Worker: `cloudflare-worker.js` proxy with KV namespace rate limits (`quadgen_rate_limits`); environment variable `CLAUDE_API_KEY` must be set.
- Default rate limits: 10/minute, 100/hour, 500/day per IP (see `CLAUDE.md`).
- Model: Claude Sonnet 4 (`claude-sonnet-4-5`, latest snapshot alias).

### Testing AI Integration
- Local: deploy worker and point the app to it; use the UI or shell Playwright scripts to exercise commands.
- Browser Testing: Use shell Playwright (`node test-playwright.js`) for reliable state validation without MCP token limits.
- Validation: follow the standalone test pattern in `CLAUDE.md` for logic changes; compare old vs new behavior and remove ad‑hoc scripts afterward.
- Printer-space regression: load the curated samples in `testdata/` (`FEATURE_EXPECTATIONS.md` lists outcomes) to confirm image-space inputs land in the expected printer-space regions after any pipeline change.

- For pure copy/wording/website text updates where executable behavior is unchanged, skip running test suites unless the user explicitly requests it.

## 2025-03-02 — CGATS/LAB parser port

- **Modules**: `src/js/data/lab-parser.js`, `src/js/data/cgats-parser.js`, `src/js/parsers/file-parsers.js`
- **Summary**: Ported the legacy LAB Gaussian reconstruction and CGATS.17 neutral-axis extraction into the modular build. Parsers now return printer-space samples, measurement metadata, default filenames, and intent tags so `LinearizationState` wiring works without fallback placeholders. Rebuilt production bundle to ensure the new logic ships with `dist/index.html`.
- **Notes for Assistants**:
  - Use `parseLabData`/`parseCGATS17` from their new modules; they set `valid`, `measurementIntent`, and expose `getSmoothingControlPoints`.
  - Per-channel loads rely on `LinearizationState`; ensure `setPerChannelData(channelName, parsed, true)` is called after parsing.
- LUT/LAB/CGATS parsers now run `anchorSamplesToUnitRange()` so all returned curves hit 0→0 and 100→100; no manual endpoint fixes needed before interpolation.
- LAB and CGATS parsers share `enforceMonotonicSamples()` from `src/js/data/linearization-utils.js`, keeping reconstructed curves monotonic before Smart conversion or smoothing.
- Lab Tech function calls `load_lab_data_global` / `load_lab_data_per_channel` reuse `parseLabData` + `LinearizationState`, so assistant-initiated loads mirror the UI workflow (smoothing, metadata, state sync).
- `apply_manual_lstar_values` lets Lab Tech build manual corrections directly from L* arrays (optional patch %), reusing `parseManualLstarData` and the same global/per-channel wiring as the modal.
  - When debugging the UI, confirm the build (`npm run build`) has been refreshed so `dist/index.html` includes the latest parser changes.
