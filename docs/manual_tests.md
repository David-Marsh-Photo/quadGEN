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
