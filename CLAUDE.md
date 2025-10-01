# CLAUDE.md

This file provides core guidance to Claude Code (claude.ai/code) when working with code in this repository.


## Assistant Behavior

- you are a Senior Lab Tech at a fine art print studio offering museum-quality digital prints, historical alternative photographic processes, and hand-pulled photogravures. quadGEN is a program the studio uses to calibrate print processes
- walk me through your thought process step by step
- before you get started with a prompt, ask me for any information you need to do a good job
- when making a big change, present a plan of action and ask for approval
- when a major bug is fixed, ask user if they would like it to be documented in the appropriate places
- **NEVER assume a fix works**: Only state something is fixed after verifying the fix through testing (Playwright scripts, console commands, or direct observation). If you cannot verify a change yourself, explicitly instruct the user on what test they need to perform to confirm the fix works as expected.

## Debugging Strategy

**Test-Driven Bug Fixing**:
- **Always start by building a test** that replicates the bug/issue before attempting any fix
- Use Playwright scripts to create reproducible test cases that demonstrate the problem
- **For bugs with visible components** (UI, chart rendering, styling, layout): include screenshots in the test workflow using Playwright's `page.screenshot()` to capture before/after states
- Write the test to fail initially (confirming the bug exists)
- After implementing the fix, verify the test passes and capture a post-fix screenshot for comparison
- This ensures: (1) the bug is real and understood, (2) the fix actually works, (3) we have regression protection, (4) visual proof of the fix

**Visual Bug Diagnosis Principles**:
- Trust user visual evidence first - screenshots often reveal real bugs that unit tests miss
- Test complete user workflows, not isolated functions - bugs often exist in the data pipeline between components
- Look for mathematical patterns in wrong outputs (e.g., 70% → 49% suggests 70% × 70% double application)
- Trace the full data flow from user input to visual display rather than defending individual component functionality

## Project Overview

quadGEN is a web-based tool for creating and editing QuadToneRIP .quad files used for high-precision inkjet printing. It's a single-page application built in vanilla JavaScript with Claude AI integration for key‑point driven curve generation (no pre‑defined/preset natural‑language curves).

- Undo now restores per-channel measurement state strictly from snapshots: when a channel's measurement is removed, the toggle beside "load file" is disabled/unchecked automatically so UI always mirrors internal state.
- Undo/redo snapshots preserve LAB and Manual L* smoothing helpers so scripted smoothing (and historical undo entries that expect it) still works even though the old UI slider was removed.
- For manual L* linearization, treat `docs/print_linearization_guide.md` as authoritative: stay in printer space with a straight-line target, keep symmetric midpoints fixed (e.g., 50 % input → 50 % output), build the correction by inverting the measured response (L* or optional log-density), enforce monotone interpolation/inversion, clamp endpoints to 0/100, and export 256 samples before answering or coding.
- Helper: `buildInkInterpolatorFromMeasurements(points, options)` centralizes that inversion pipeline. Pass points with `input` (0–100) and `lab` (L* 0–100); it sorts, converts L* to normalized ink, applies location-aware Gaussian smoothing, enforces monotonicity, and constructs a PCHIP spline.
  - The helper returns `{ evaluate(t), createEvaluator(widenFactor), positions }`. `evaluate` consumes normalized input 0–1 and yields normalized ink, so callers sample 256 steps and scale back to 0–100 or 0–65535 for LUT export.
  - Tuning lives behind `options` (`neighbors`, `sigmaFloor`, `sigmaCeil`, `sigmaAlpha`, plus `widenFactor`); keep defaults unless the user explicitly requests a different smoothing profile.
- CGATS.17 importer tolerates CMY offsets up to 2.5% as neutral so K-only progressions keep their original input axis while the measurementSet still stores raw device values.
- File loader accepts Argyll CTI3 (.ti3) measurement files and routes them through the CGATS parser.
- Global Scale input caches each channel’s baseline End; successive edits (e.g., 90% → 95%) multiply the saved baseline rather than compounding prior adjustments, and returning to 100% clears the cache.
- `hasLoadedQuadCurves()` centralizes the “quad loaded” check so intent guards and printer setup run safely before any .quad data exists.
- Lab Tech can invoke the Scale control via `scale_channel_ends_by_percent({ scalePercent })`, which reuses the cached baselines noted above.
- Global Scale clamps automatically once any channel would hit 100% (65,535) and allows entries up to 1000% so proportional boosts can take a low-limit .quad all the way to full scale in one step.
- Legacy `index.html` Help copy now keeps attribute quotes unescaped so Vite single-file builds parse without raising parse5 warnings.
- When Edit Mode is active and a global LAB/CGATS correction loads, Smart key points are immediately reseeded from the measurement so the plotted curve updates without toggling Edit Mode off/on.
- Global correction panel hides the "LUT (.cube), LAB data (.txt), or curves (.acv)" hint after load and replaces it with `<filename> - <point count> (format)` so the modular UI matches the legacy status summary.
- Chart canvas uses a ResizeObserver (with rAF throttling) plus DPR-aware dimension caching so window resizes keep the plot sharp without redundant redraws.
- Axis and ink labels scale their font sizes using the current device pixel ratio (once the chart is at least ~300px wide) so high-DPI canvases stay legible without manual zoom, and label positioning adapts to the added size.
- Global revert button ("↺ Revert to Measurement" in Global Correction panel) now has complete modular implementation in `src/js/ui/event-handlers.js:1003-1194`, achieving full parity with legacy code. The handler clears Smart Curves, restores original .quad curves and baseline End values, completely clears LAB data (`linearizationData = null`), updates all UI components, and preserves Edit Mode channel selection. See `docs/REVERT_BUTTON_FUNCTIONALITY.md` for detailed behavior documentation and `docs/REVERT_PARITY_REPORT.md` for parity analysis.

## Critical Requirements

**PCHIP Interpolation**: ALL smooth curve generation MUST use PCHIP (Piecewise Cubic Hermite Interpolating Polynomial):
- Never use smoothstep, cosine, Catmull-Rom, or cubic splines for photography curves
- PCHIP prevents overshooting and maintains monotonic curves
- Only exception: Linear interpolation for technical applications

**Data Processing Order** (critical for debugging):
1. Base curves (loaded .quad data OR linear ramps 0-65535)
2. Smart Curves (per-channel)
3. Per-channel linearization corrections
4. Global linearization (system-wide effects)
5. Final 256-point output curves

**Working Codebase Policy**:
- Make app/UI changes in the `src/` directory. The root `index.html` is now the build output (generated from `dist/index.html`). Do not modify historical variants (`quadgen copy*.html`) unless explicitly requested by the user.
- The `index.template.html` file, which is the source for all builds, is located in the `src` directory.
- After modifying any files under `src/` (or other bundle inputs), run `npm run build:agent` to regenerate `dist/index.html` and copy it to the root. Call out the refreshed build in your final response so the user knows the artifact is current.
- don't change the APP_VERSION unless I ask you to
- if you are making a big change, present a plan and any other options and then ask for my approval to continue

**Browser Testing Strategy**:
- **Primary Method**: Playwright via Node.js scripts for all automated checks
- **Installation**: Ensure Playwright is installed with `npm install --save-dev playwright && npx playwright install chromium`
- **Test patterns**: Use inline node scripts or saved `.js` files for reusable test workflows
- **Debug access**: All `window.*` functions and console commands available in scripts

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

**Playwright Testing Patterns**:

*Edit Mode State Check:*
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://$PWD/index.html');
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => ({
    editModeEnabled: window.isEditModeEnabled?.(),
    panelDisabled: document.getElementById('editPanelBody')?.classList.contains('edit-panel-disabled')
  }));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
"
```

*Toggle Edit Mode and Verify:*
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://$PWD/index.html');
  await page.waitForTimeout(1000);

  // Toggle and check
  await page.click('#editModeToggleBtn');
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    editMode: window.isEditModeEnabled?.(),
    panelDisabled: document.getElementById('editPanelBody')?.classList.contains('edit-panel-disabled'),
    selectedChannel: window.EDIT?.selectedChannel
  }));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
"
```

*Channel State Check:*
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://$PWD/index.html');
  await page.waitForTimeout(1000);
  const channels = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-channel]');
    return Array.from(rows).map(row => ({
      channel: row.dataset.channel,
      percent: row.querySelector('.percent-input')?.value,
      end: row.querySelector('.end-input')?.value
    }));
  });
  console.log(JSON.stringify(channels, null, 2));
  await browser.close();
})();
"
```

**Browser Testing Notes**:
- **File creation**: Create temporary `.js` files for complex testing workflows
- **Reusable scripts**: Save common test patterns as `test-*.js` files in project root
- **Debug access**: All `window.*` functions and console commands available in shell scripts
- **Performance**: Shell Playwright much faster than MCP (no snapshot overhead)

## Key‑Point Editing Defaults
- "point N" means the Smart key‑point ordinal N (1‑based, endpoints included) on the selected channel.
- Channel selection: if unspecified, use the first enabled channel from state (percentage > 0 or endValue > 0 or enabled=true). Ask only if none enabled.
- Silent conversion on first edit: if no Smart key points exist, edit/insert/delete calls will auto‑create them from any loaded ACV/LUT/LAB or from the currently displayed curve; do not ask the user to "generate a curve first".
- Disambiguation: if the user mentions "point N … %", interpret as a key‑point change, not a channel ink limit. Example: "set point 5 to 90%" → `adjust_smart_key_point_by_index(ordinal=5, outputPercent=90)` (absolute Y).
- Endpoints are included in ordinal indexing; endpoint deletions are blocked unless `allowEndpoint=true`.
- get_ai_key_points: if none exist yet, returns an empty list with suggestions for next actions; perform any edit to auto‑create points.

## Smart Key‑Point Edit Semantics (Absolute Targets + End Management)
- All edit/insert functions interpret `outputPercent` as absolute chart percent (post‑End). If the target exceeds the current End, raise End minimally. When End increases, scale other points pre‑scale by `oldScale/newScale` so their absolute plotted values do not shift — only the edited/inserted point moves.

## Ink Limit vs Key‑Point Editing (Expected Behavior)

These rules define how edits affect the curve vs. the channel's ink limit (End):

- Key‑point edits (any ordinal, endpoints included):
  - `outputPercent` is absolute chart percent (0–100) after End scaling.
  - The app converts to the required pre‑scale output so the plotted point lands exactly at the requested value.
  - If reaching the requested value would require pre‑scale > 100, the channel End is increased just enough to accommodate the request.
  - When End increases for a key‑point edit, all other key points are scaled down pre‑scale by oldScale/newScale so their absolute plotted values remain unchanged. Only the edited point moves.
  - Debug/status: when End is raised, a message like `[INK] K channel ink limit changed to 60%` is logged and shown.

- Channel End edits (table fields: % or value):
  - Uniformly scale the entire curve (all 256 points) as a whole.
  - Use this path when you explicitly want to change overall amplitude, independent of moving a single key point.

## Critical Rules for Developers

```javascript
// ❌ NEVER DO THIS with .quad or Smart Curve data:
const scaleFactor = endValue / maxValue;
curve = curve.map(v => v * scaleFactor); // BUG!

// ✅ CORRECT: Use loaded curves with uniform scaling by End relative to baseline; Smart Curves and linear ramps are scaled to End
if (window.loadedQuadData?.curves?.[channelName]) {
  const baseline = window.loadedQuadData.baselineEnd?.[channelName] ?? Math.max(...window.loadedQuadData.curves[channelName]);
  const scale = baseline > 0 ? (endValue / baseline) : 0;
  arr = window.loadedQuadData.curves[channelName].map(v => Math.round(v * scale));
}

// ✅ CORRECT: Only interpolate measurement data
if (requiresInterpolation(dataSource)) {
  arr = apply1DLUT(arr, data, domainMin, domainMax, endValue, interpolationType);
}
```

## Changelog Workflow

- Location: keep user‑facing release notes in `CHANGELOG.md` at the repo root. Keep engineering details in `CLAUDE.md`; keep assistant/tool semantics in `AGENTS.md`.
- During development: append items under the "Unreleased" section in `CHANGELOG.md` (Added/Changed/Fixed/Removed/Docs).
- On release:
  - Bump `APP_VERSION` (single source) in `src/js/core/version.js`.
  - Rotate "Unreleased" into a new section named with the release version and date (e.g., `## [v1.8.6] — YYYY‑MM‑DD`).
  - Start a fresh "Unreleased" section at the top for ongoing changes.
  - Update `VERSION_HISTORY` in `src/js/ui/help-content-data.js` (used to render the About dialog) to match the release notes summary.
- Do not embed raw release notes text outside of the structured `VERSION_HISTORY` block (prevents footer bleed‑through).
- Scope split:
  - `CHANGELOG.md`: concise, user‑facing highlights.
  - `CLAUDE.md`: pipeline rules, algorithms, constraints, rationale.
  - `AGENTS.md`: AI function contracts, routing rules, editing defaults.

## Debug Flags
- `DEBUG_LOGS` (default: false)
  - Gates general console logging (curve generation decisions, make256/apply1DLUT traces, ink‑limit changes, undo/redo flow, chart snapshots).
  - Toggle in DevTools console: `DEBUG_LOGS = true` (on), `DEBUG_LOGS = false` (off).
- `DEBUG_AI` (default: false) / `DEBUG_SMART` (alias)
  - Gates assistant/smart‑curve logging (tool/function calls, provider decisions, retry notices, API key validation logs).
  - Toggle in DevTools console: `DEBUG_AI = true` (on), `DEBUG_AI = false` (off). `DEBUG_SMART` mirrors `DEBUG_AI`.
- Notes: These flags only affect console output. They do not change processing or send additional context to the AI; no background prompts are made unless the user explicitly sends a chat message.

## LAB Data Lifecycle & State Management

**Critical Rule**: The "Revert to Measurement" button must **completely clear** LAB linearization data to restore original .quad state.

### Data Flow
1. **Load .quad**: `baselineEnd` captured, `originalCurves` stored
2. **Load LAB**: `linearizationData` set, `linearizationApplied = true`
3. **Edit Mode**: Smart Curves generated from LAB-corrected data
4. **Revert**: MUST clear `linearizationData = null` and `linearizationApplied = false`

### Revert Operation Requirements
```javascript
// ✅ CORRECT revert workflow:
linearizationData = null;           // Clear LAB data completely
linearizationApplied = false;       // Disable corrections
// Restore original curves and baseline End values

// ❌ WRONG - causes scaling artifacts:
linearizationData.edited = false;   // Keeps LAB data active
linearizationApplied = !!linearizationData;  // Still true!
```

### Why This Matters
If LAB data remains active during revert, it gets reapplied when edit mode re-enables, causing:
- Smart Curves generated from LAB-corrected (scaled) data
- Ink limits appear correct (22%) but curve range is wrong (259-3172 vs 0-14418)
- Measurement scaling artifacts persist through revert

### Debugging Revert Issues
Use `DEBUG_LOGS = true` and look for:
- `[DEBUG REVERT] Button clicked:` - confirms revert triggered
- `[DEBUG REVERT] Clearing linearization data` - confirms LAB data cleared
- `[DEBUG BASELINE] Captured initial baseline:` - confirms original values preserved
- Missing baseline restoration logs indicate revert guard failure

## Auto Endpoint Rolloff (White/Black)

Purpose
- Prevents early flat ceilings/floors caused by stacked intent + corrections near endpoints by applying a localized, smooth shoulder/toe that reaches the ink limit at 100% (white) or 0% (black) with slope 0.

Pipeline Stage
- Applied in `make256(endValue, channelName, applyLinearization)` after per-channel and global linearization, before returning the 256 values.
- Skips per side when a Smart curve is actively applied and marked as baked (`bakedGlobal`) and when that side’s rolloff was baked via Recompute (`bakedAutoWhite` / `bakedAutoBlack`; legacy `bakedAutoLimit`).

Detection (default thresholds)
- Work in printer space with integers in [0..End].
- Proximity: `epsY = max(1, round(0.03 * End))` (3% of End).
- Slope collapse: sustained low first‑difference across a short window (default 4 samples) relative to median midtone slope (15%).
- Windows: scan last 20% (white), first 10% (black). Require minimum knee width (~5% of domain).
- Fallback anchors: if the near‑cap/floor point is too close to the bound, force the join earlier/later (~5% of domain) and enforce amplitude ≥ 2×epsY.

Rolloff Construction
- Use cubic Hermite (C1 continuous, monotone) over the knee span:
  - White shoulder: join value y0 at startIndex with incoming slope m0; end is End with slope m1 = 0.
  - Black toe: start at 0 with m0 = 0; join value y1 at endIndex with outgoing slope m1 (forward difference).
- Guards: enforce monotone non‑decreasing (white) and non‑negative clamped (black), do not exceed End.

UI/State
- Toggles: `#autoWhiteLimitToggle` (default OFF) and `#autoBlackLimitToggle` (default ON) in Global Correction, persisted as `autoWhiteLimitV1` / `autoBlackLimitV1`. Legacy `autoEndpointRolloffV1` hydrates both on first run.
- Assistant control: Lab Tech exposes `set_auto_white_limit(enabled)` and `set_auto_black_limit(enabled)` for toggling these checkboxes via chat.
- Processing label: adds `Auto limit: W xx.x%` and/or `B xx.x%` when the corresponding side is active.
- Debug markers: dashed red (white end) / blue (black end) verticals while the respective Auto limit is enabled.
- Recompute: sampling with a side enabled bakes that knee into Smart points; tag `keyPointsMeta[channel].bakedAutoWhite` / `bakedAutoBlack` (plus `bakedGlobal` when applicable). Baking prevents double-apply on subsequent renders.

Debug Logging
- With `DEBUG_LOGS = true`:
  - `[AUTO LIMIT] begin` — thresholds, head/tail of values
  - `[AUTO LIMIT] detected indices` — candidate whiteStart/blackEnd
  - `[AUTO LIMIT] white segment`/`black segment` — start/end index, width, before/after slice
  - `[AUTO LIMIT] result` — per‑channel meta `{ white, black, debug }`

Notes
- This feature is local and does not globally renormalize the curve; midtones remain unchanged.
- The 3% default is tuned for visibility with long plateau tails; adjust only if needed for specific devices/processes.

## File Format Reference

- QuadToneRIP .quad format developer summary: `docs/QTR_QUAD_SPEC_SUMMARY.md`
- .cube LUT (1D/3D) parsing & neutral‑axis extraction: `docs/CUBE_LUT_SPEC_SUMMARY.md`
- Photoshop .acv curve parsing and remapping: `docs/ACV_SPEC_SUMMARY.md`
- LAB (.txt) measurement data format and Gaussian correction: `docs/LAB_TXT_SPEC_SUMMARY.md`
- LAB linearization workflow and plotting semantics (ink vs luminance, curves vs wedge): `docs/LAB_LINEARIZATION_WORKFLOW.md`

## Extended Documentation

See these files for detailed technical information:

- `CLAUDE_ARCHITECTURE.md` - System architecture, data flow, components
- `QUADGEN_AI_INTEGRATION.md` - AI functions, Smart Curves, key‑point operations
- `QUADGEN_DATA_TYPES.md` - Data type classifications and processing rules
- `QUADGEN_DEVELOPMENT.md` - Development workflow, testing, debugging
- `CLAUDE_RECENT_FIXES.md` - Recent critical fixes and solutions

## Assistant Reference Policy

- No embedded bookmarks or auto-citation. The assistant does not inject external links or always-cite; links appear only if the user provides them or explicitly asks for references.
- No web browsing tools are enabled in this app. All network calls are limited to the configured AI proxy.
- when creating a plan for changes, ask me for approval before starting implementation

## Parser Notes

- `parseCube1D` and `parseCube3D` (in `src/js/data/cube-parser.js`) mirror the legacy LUT loaders, including DOMAIN_MIN/MAX enforcement and neutral-axis extraction.
- `parseLabData` (in `src/js/data/lab-parser.js`) now ports the full Gaussian-weighted LAB reconstruction with contrast-intent aware density mapping and smoothing helper.
- `parseCGATS17` (in `src/js/data/cgats-parser.js`) ports the tiered CGATS importer (K-only, composite, LAB fallbacks) with measurement metadata and printer-space conversion.
- `enforceMonotonicSamples` exported from `src/js/data/linearization-utils.js` keeps LAB-derived curves monotonic across manual entry, global loads, and channel loads (shared by the CGATS parser).
- `load_lab_data_global` / `load_lab_data_per_channel` delegate to `parseLabData` + `LinearizationState`, so Lab Tech now loads measurements through the same pipeline as the UI.
- `apply_manual_lstar_values` accepts bare L* arrays (optional patch percents) and routes them through `parseManualLstarData`, matching the manual-entry modal without clicking through the UI.
