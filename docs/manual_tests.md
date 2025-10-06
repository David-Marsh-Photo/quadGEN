# Manual Regression Tests

## Per-channel Measurement Undo
Goal: ensure undo removes both measurement data and the associated UI toggle state for a channel.

### Manual Steps:
1. Load the modular `index.html` build (hosted or local) and choose any printer (e.g., P700-P900).
2. Load a per-channel measurement file (e.g., `lab_banded_shadow.txt`) onto any channel via the row's **load file** button and ensure the per-channel toggle enables itself.
3. Trigger undo (toolbar Undo button or keyboard shortcut) immediately after the load.
4. Confirm both of the following:
   - The channel processing label no longer lists the measurement source and the plotted curve returns to the prior state.
   - The per-channel toggle beside **load file** is disabled and unchecked.

Record the result in your test log. If either check fails, the regression guard has detected a problem.

### Automated Testing with Shell Playwright

You can automate these manual tests using shell Playwright scripts:

```javascript
// test-undo-regression.js - Automate per-channel undo testing
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading quadGEN...');
  await page.goto(`file://${__dirname}/index.html`);
  await page.waitForTimeout(2000);

  // Check initial state
  const initial = await page.evaluate(() => {
    const firstRow = document.querySelector('[data-channel]');
    const channel = firstRow?.dataset.channel;
    const toggle = firstRow?.querySelector('.per-channel-toggle');
    return {
      channel,
      toggleEnabled: toggle ? !toggle.disabled : false,
      toggleChecked: toggle ? toggle.checked : false
    };
  });

  console.log('Initial state:', JSON.stringify(initial, null, 2));

  // TODO: Add file loading and undo simulation
  // This would require additional UI interaction patterns

  await browser.close();
  console.log('✅ Regression test framework ready');
})();
```

### Running Automated Tests:
```bash
npm install --save-dev playwright
npx playwright install chromium
node test-undo-regression.js
```

**Benefits of Automation**:
- Consistent test execution
- Faster regression detection
- Easy integration with CI/CD
- Clean JSON output for validation

## Global Scale Undo Screenshot Check
Goal: capture before/after artifacts that confirm the global scale batch history entry.

1. Run `npx playwright test tests/history/batch_operations.spec.ts --reporter=line`.
2. The test saves `batch-scale-applied.png` and `batch-scale-after-undo.png` in the Playwright output directory (for example, `test-results/tests-history-batch_operations-spec.ts/`).
3. Attach those PNGs to the release log or manual QA report so a reviewer can visually confirm the pre-scale and post-undo states.
4. If the screenshots show mismatched toggle states or out-of-date filenames, re-run the regression suite; the undo stack may not be recording batch actions correctly.

## Automated Coverage: Global Scaling *(Phase 0 – Foundation)*
Phase 0 Track 4 regression guards now cover the following flows via Playwright (run automatically by `npm run test:e2e`):

- `tests/e2e/global-scale-baseline-drift.spec.ts` – edits under non-100 % scale return to baseline without drifting cached ends.
- `tests/e2e/global-scale-rapid-undo.spec.ts` – rapid slider scrub (100 %→50 %→100 %) retains history entries and undoes cleanly.
- `tests/e2e/edit-mode-keypoint-scaling.spec.ts` (“adding a Smart point after global scale”) – confirms Smart insertions respect scaled absolute outputs.
- `tests/e2e/global-scale-measurement-revert.spec.ts` – verifies measurement loads survive revert + rescale cycles without baseline cache contamination.

Phase 0 – Foundation tags in the regression matrix:
- **Baseline cache** coverage — recorded against the three Vitest scenarios in `tests/core/scaling-utils-baseline.test.js`.
- **Smart rescaling** coverage — mapped to the audit-mode assisted Playwright scenarios above.
- **Undo/Revert** coverage — tied to `global-scale-rapid-undo.spec.ts` and `global-scale-measurement-revert.spec.ts`.

### Coordinator Parity Checks *(Phase 1)*
- `scripts/diagnostics/compare-coordinator-legacy.js` compares legacy vs. feature-flagged coordinator scaling across randomized command streams (default 10 runs × 200 steps; optional extended run of 10 × 1000 for deeper coverage). Artifacts drop under `artifacts/scaling-coordinator-parity/` with per-seed snapshots and a top-level `summary.json`. Use this before widening the coordinator rollout or after significant scaling logic changes.
- `scripts/diagnostics/compare-coordinator-smart.js` validates coordinator behaviour against legacy while a Smart curve is active (`P700-P900_MK50.quad`, Edit Mode ON). Artifacts land in `artifacts/scaling-coordinator-smart/`.
- `scripts/diagnostics/compare-coordinator-lab.js` loads `cgats17_21step_lab.txt`, applies the measurement globally, and drives a five-step sequence (90→110→70→125→95) to confirm parity under LAB corrections. Results are stored in `artifacts/scaling-coordinator-lab/`.
- `scripts/diagnostics/compare-coordinator-ai.js` invokes `scale_channel_ends_by_percent` via the Lab Tech interface (90→110→70→95) and verifies coordinator parity; artifacts live under `artifacts/scaling-coordinator-ai/`.

Manual spot checks are only required if one of these specs fails or a new scenario is introduced.

## Scaling State – Manual Acceptance (Single Operator)
Use this quick pass whenever the scaling-state flag defaults to ON or after making related changes. It complements the automated harness by confirming the UI, history, and telemetry behave as expected in a real session.

1. Launch the latest `index.html` build (post-`npm run build:agent`) and confirm `Help → Version History` loads normally without the former Scaling State audit panel.
2. In the Global Scale panel, enter `135` and press Enter. Expect the field to snap back to `100`, reflecting the guard against values above the cached maximum.
3. Click **Undo** and **Redo** once each. Verify the scale input returns to the prior value (`90` after redo in the current workflow) and that no console warnings/errors appear in DevTools.
4. Open the DevTools console and run `window.validateScalingStateSync()`; ensure it logs success without mismatches.
5. Capture the current scaling audit snapshot (if available) via:
   ```js
   JSON.stringify(window.scalingStateAudit, null, 2)
   ```
   Attach the JSON to your QA notes alongside the harness artifact names used for this release.

If any step fails, toggle the flag off with `window.setScalingStateEnabled(false)`, re-run the harness to capture recovery metrics, and file an issue before re-enabling the flag.
