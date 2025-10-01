const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n=== Simple Test: Per-Channel Undo Fix ===\n');

  const appPath = path.join(__dirname, 'index.html');
  await page.goto(`file://${appPath}`);
  await page.waitForTimeout(1500);

  // Test with K channel
  const channelName = 'K';

  // Step 1: Set K channel to 100%
  console.log(`Step 1: Enabling ${channelName} channel at 100%...`);
  await page.evaluate((ch) => {
    const row = document.querySelector(`[data-channel="${ch}"]`);
    const percentInput = row?.querySelector('.percent-input');
    if (percentInput) {
      percentInput.value = '100';
      percentInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, channelName);
  await page.waitForTimeout(500);

  const initialState = await page.evaluate((ch) => {
    const row = document.querySelector(`[data-channel="${ch}"]`);
    const percentInput = row?.querySelector('.percent-input');
    const endInput = row?.querySelector('.end-input');
    const checkbox = row?._virtualCheckbox;

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      historyLength: window.CurveHistory?.history?.length || 0
    };
  }, channelName);

  console.log('Initial state:', initialState);

  // Step 2: Load LAB data
  console.log(`\nStep 2: Loading LAB data for ${channelName}...`);
  const labFilePath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');

  try {
    // Find and click the per-channel load button
    await page.evaluate((ch) => {
      const row = document.querySelector(`[data-channel="${ch}"]`);
      const fileInput = row?.querySelector('input[type="file"]');
      if (!fileInput) {
        throw new Error(`No file input found for channel ${ch}`);
      }
      // Expose it for file selection
      window._testFileInput = fileInput;
    }, channelName);

    const fileInput = await page.evaluateHandle(() => window._testFileInput);
    await fileInput.asElement().setInputFiles(labFilePath);
    await page.waitForTimeout(2000);

    const afterLoadState = await page.evaluate((ch) => {
      const row = document.querySelector(`[data-channel="${ch}"]`);
      const toggle = row?.querySelector('.per-channel-toggle');
      const history = window.CurveHistory?.history || [];

      return {
        perChannelEnabled: toggle?.checked,
        historyLength: history.length,
        lastTwoActions: history.slice(-2).map(e => e.action || e.state?.action)
      };
    }, channelName);

    console.log('After LAB load:', afterLoadState);
    console.log('Has Before/After pair:',
      afterLoadState.lastTwoActions?.some(a => a?.includes('Before: Load Per-Channel')) &&
      afterLoadState.lastTwoActions?.some(a => a?.includes('After: Load Per-Channel'))
    );

    // Step 3: Undo
    console.log('\nStep 3: Clicking Undo...');
    await page.click('#undoBtn');
    await page.waitForTimeout(1500);

    const afterUndoState = await page.evaluate((ch) => {
      const row = document.querySelector(`[data-channel="${ch}"]`);
      const percentInput = row?.querySelector('.percent-input');
      const endInput = row?.querySelector('.end-input');
      const checkbox = row?._virtualCheckbox;
      const toggle = row?.querySelector('.per-channel-toggle');

      return {
        percent: percentInput?.value,
        endValue: endInput?.value,
        enabled: checkbox?.checked,
        perChannelEnabled: toggle?.checked,
        redoLength: window.CurveHistory?.redoStack?.length || 0
      };
    }, channelName);

    console.log('After Undo:', afterUndoState);

    // Verification
    console.log('\n=== VERIFICATION ===');
    const channelStillEnabled = afterUndoState.enabled === initialState.enabled;
    const percentPreserved = afterUndoState.percent === initialState.percent;
    const perChannelCleared = !afterUndoState.perChannelEnabled;
    const canRedo = afterUndoState.redoLength > 0;

    console.log('✓ Channel still enabled:', channelStillEnabled ? '✅' : '❌',
      `(expected: ${initialState.enabled}, got: ${afterUndoState.enabled})`);
    console.log('✓ Percent preserved:', percentPreserved ? '✅' : '❌',
      `(expected: ${initialState.percent}, got: ${afterUndoState.percent})`);
    console.log('✓ Per-channel cleared:', perChannelCleared ? '✅' : '❌');
    console.log('✓ Can redo:', canRedo ? '✅' : '❌');

    const allPassed = channelStillEnabled && percentPreserved && perChannelCleared && canRedo;

    if (allPassed) {
      console.log('\n🎉 TEST PASSED - Bug is FIXED!\n');
    } else {
      console.log('\n❌ TEST FAILED - Bug still present\n');
    }

  } catch (err) {
    console.error('Test error:', err.message);
  }

  console.log('--- Browser will stay open for 20 seconds ---');
  await page.waitForTimeout(20000);

  await browser.close();
})();