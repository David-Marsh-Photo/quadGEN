# QUADGEN_DEVELOPMENT.md

Development workflow, testing methodologies, and debugging guidelines for quadGEN.

## Development Workflow

### File Structure

quadGEN now ships from the modular Vite build. Authoring happens in `src/`, organised by feature domain, and the build step emits a single-page bundle into `dist/`.
- `src/main.js` bootstraps application state, UI wiring, and theme setup.
- `src/js/` hosts ES module folders: `core/` (state + versioning), `ui/` (panels, chart), `utils/` (helpers), `data/` & `parsers/` (LAB/CGATS/LUT loaders), `ai/` (Lab Tech integration), etc.
- `src/styles/` contains theme-aware CSS, with custom properties for light/dark mode.
- `src/styles/main.css` is the only authored stylesheet—treat it as the single source of truth.
- `src/js/ui/help-content-data.js` centralises Help/Version History copy consumed by the Help popup.
- `dist/index.html` is generated via `npm run build`; copy it to the repository root when publishing.
- `index.template.html` is the markup-only development shell that imports `src/main.js`; build scripts hydrate it into `index.html` before bundling.
- The outer layout width is handled by `.main-container` in `main.css`; avoid re-introducing Tailwind `max-w-*` helpers or the app shell will collapse on larger viewports.

For build and deployment details (dev server, production build, preview, and copy step), follow `BUILD_INSTRUCTIONS.md`.

### Testing Methodology

#### Default Post-build Smoke Check

- After every production build (`npm run build:agent`), run `npm run test:smoke`.
- The smoke test (`tests/e2e/page-load-smoke.spec.ts`) opens `index.html` with Playwright and fails if any console errors or page exceptions occur during load.
- Keep this as the minimum regression gate; run deeper suites (`npm run test:e2e`, `npm run test`) only when you need broader coverage for a change.

#### Browser Testing with Shell Playwright

**Primary Method**: Shell Playwright for UI and integration testing:

1. **Installation**: `npm install --save-dev playwright && npx playwright install chromium`
2. **Create Test Scripts**: Write `.js` files with Playwright automation
3. **Run Tests**: Execute `node test-script.js` for clean JSON output
4. **Benefits**: Full Playwright API without 38k+ token MCP limitations

**Shell Playwright Test Pattern**:
```javascript
// test-edit-mode.js - Example browser testing
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`file://${__dirname}/index.html`);
  await page.waitForTimeout(1000);

  // Test edit mode functionality
  const initial = await page.evaluate(() => ({
    editMode: window.isEditModeEnabled?.() ?? false,
    panelDisabled: document.getElementById('editPanelBody')?.classList.contains('edit-panel-disabled')
  }));

  console.log('Initial:', JSON.stringify(initial, null, 2));

  // Toggle edit mode
  await page.click('#editModeToggleBtn');
  await page.waitForTimeout(500);

  const afterToggle = await page.evaluate(() => ({
    editMode: window.isEditModeEnabled?.() ?? false,
    panelDisabled: document.getElementById('editPanelBody')?.classList.contains('edit-panel-disabled')
  }));

  console.log('After toggle:', JSON.stringify(afterToggle, null, 2));

  await browser.close();
})();
```

**When to Use Browser Testing**:
- UI state validation (edit mode, theme switching)
- User interaction workflows (button clicks, form fills)
- CSS class and visual state verification
- Integration testing across components
- File load/save operations

#### Headful Simple Scaling Capture Tool

- Use the purpose-built runner to validate the full Simple Scaling stack with real quad/LAB inputs.
- Command: `npm run capture:simple-scaling -- --quad data/P800_K36C26LK25_V6.quad --lab data/P800_K36C26LK25_V6.txt`
  - Optional flags: `--json`, `--screenshot`, `--range start,end`, `--headless`.
- Output: JSON snapshot under `analysis/` plus a screenshot in `artifacts/simple-scaling/`; both paths can be overridden.
- The JSON includes per-channel deltas for the requested range and surfaces any console errors encountered during the run.
- Scaling runs now report both the applied +15 % channel lift guard (with K/MK locked) and any overflow redistributed to darker reserves; expect the snapshot’s `perChannelLift` to top out at 0.15 × the baseline End while `residualOverflow`/redistribution stats capture the backfill work.
- Prefer this tool whenever verifying solver behavior so we capture any UI/regression issues triggered by the real app shell.

#### Standalone Function Testing

**For Logic-Only Changes**: Create isolated Node.js test scripts to verify behavior before browser testing:

1. **Create Test Script**: Write a `.js` file that simulates the function logic with realistic data
2. **Run with Node.js**: Execute `node test_script.js` to validate changes
3. **Compare Old vs New**: Test both old and new logic with same inputs to demonstrate improvements
4. **Clean Up**: Remove test files after validation

**Example Test Pattern**:
```javascript
// test_fix.js - Example testing pattern for .quad file parsing
function testParseLogic() {
  // Simulate realistic curve data from actual .quad files
  const simulatedCurve = [0, 100, 500, ...13925, ...4557];

  // OLD LOGIC: Test existing behavior
  const oldResult = simulatedCurve[255]; // final value

  // NEW LOGIC: Test improved behavior
  const newResult = Math.max(...simulatedCurve); // max value

  // COMPARISON: Show improvement
  console.log('OLD LOGIC:', oldResult, '→', Math.round((oldResult/65535)*100) + '%');
  console.log('NEW LOGIC:', newResult, '→', Math.round((newResult/65535)*100) + '%');
  console.log('IMPROVEMENT:', 'More accurate representation');
}
```

**When to Use**:
- Critical parsing logic changes (file format handling)
- Mathematical algorithm modifications
- Complex data transformation functions
- Before/after comparisons for bug fixes

### Debugging Common Issues

**NaN Values in Curves**: Usually interpolation-related
- Check PCHIP function calls use correct signature: `_pchipInterpolate(x, y, xi)`
- Verify key points structure: `[{input: number, output: number}, ...]`
- Look for malformed data in console logs

**AI Function Errors**: Validate parameters and key‑point arrays
- Ensure ordinals and inputPercent are in valid ranges
- Check interpolation type (`smooth`/PCHIP or `linear`)
- Confirm channel resolution when `channelName` omitted (first enabled channel)
- Deletion: endpoints blocked by default; set allowEndpoint=true to permit. near_input uses ±tolerance (default 1.0%); return graceful error if no match

**File Processing Issues**:
- .quad files: Validate QuadToneRIP header format
- .cube files: Check 1D vs 3D detection logic
- LAB data: Verify L* value parsing and transformation
- Orientation: Use the `DataSpace` helper (`convertSamples`, `convertControlPoints`) so imported data lands in printer space before downstream use.

**Data Object Integrity & Regression Scripts**: Ensure proper object passing
- LAB data objects must preserve `getSmoothingControlPoints()` method
- Use `apply1DLUT(arr, dataObject, ...)` not `apply1DLUT(arr, dataObject.samples, ...)`
- Check console for `🔍 apply1DLUT DEBUG:` messages to verify object structure
- Confirm `sourceSpace` metadata reads `'printer'` before passing samples to curve generation; call `DataSpace.convertSamples` when in doubt.
- Run `node tests/dataspace.spec.js` to exercise `DataSpace`/`normalizeLinearizationEntry` and ensure legacy data stays in printer space.
- Run `node tests/make256_helpers.spec.js` to verify the factored `make256` helpers gate per-channel/global corrections and auto endpoint rolloff as expected.

### Version History Integration

Version information lives in the `VERSION_HISTORY` object exported from `src/js/ui/help-content-data.js`:
- Automated changelog generation
- Feature tracking and documentation
- Rendered under Help → Version History tab

Authoring guidance for Version History notes:
- Keep entries concise, direct, factual, and short.
- Prefer plain, user-facing language over internal jargon.
- Group related changes under ADDED/CHANGED/FIXED/REMOVED when useful; otherwise use a single bullet.

### Dark Mode UI Polish (relevant to dev inspection)
- Input fields (percent/end, filename, L*, edit XY, thresholds) use darker backgrounds and light text under `[data-theme="dark"]`.
- Toggle sliders: darker OFF track, muted accent ON track, high-contrast knob, softer focus ring.
- Key-point ordinal labels render with theme text color for legibility in dark and light themes.
