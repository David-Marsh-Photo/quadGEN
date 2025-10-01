const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  console.log('\n=== Test: MK Channel LAB Load + Undo Fix ===\n');

  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForTimeout(2000);

  // Step 1: Enable MK channel at 100%
  console.log('Step 1: Enabling MK channel at 100%...');
  await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    if (!mkRow) throw new Error('MK channel not found');

    const percentInput = mkRow.querySelector('.percent-input');
    if (!percentInput) throw new Error('MK percent input not found');

    percentInput.value = '100';
    percentInput.dispatchEvent(new Event('input', { bubbles: true }));
    percentInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.waitForTimeout(500);

  const initialState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow.querySelector('.percent-input');
    const endInput = mkRow.querySelector('.end-input');
    const checkbox = mkRow._virtualCheckbox;

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked
    };
  });

  console.log('Initial MK state:', initialState);

  // Step 2: Load LAB data for MK
  console.log('\nStep 2: Loading Manual-LAB-Data.txt for MK...');

  const labPath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');

  // Click the load button to trigger file picker
  await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const loadBtn = mkRow.querySelector('.per-channel-btn');
    if (!loadBtn) throw new Error('MK load button not found');

    // Expose the file input for later use
    window._mkFileInput = mkRow.querySelector('input[type="file"]');
    if (!window._mkFileInput) throw new Error('MK file input not found');
  });

  // Set the file
  const fileInputHandle = await page.evaluateHandle(() => window._mkFileInput);
  await fileInputHandle.asElement().setInputFiles(labPath);

  // Wait for the file to process
  await page.waitForTimeout(3000);

  const afterLoadState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow.querySelector('.percent-input');
    const checkbox = mkRow._virtualCheckbox;
    const toggle = mkRow.querySelector('.per-channel-toggle');

    const history = window.CurveHistory?.history || [];

    return {
      percent: percentInput?.value,
      enabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked,
      perChannelDisabled: toggle?.disabled,
      historyLength: history.length,
      lastTwoActions: history.slice(-2).map(e => e.action || e.state?.action)
    };
  });

  console.log('After LAB load:');
  console.log('  Percent:', afterLoadState.percent);
  console.log('  Enabled:', afterLoadState.enabled);
  console.log('  Per-channel enabled:', afterLoadState.perChannelEnabled);
  console.log('  History length:', afterLoadState.historyLength);
  console.log('  Last 2 actions:', afterLoadState.lastTwoActions);

  const hasBeforeAfter =
    afterLoadState.lastTwoActions?.some(a => String(a).includes('Before: Load Per-Channel')) &&
    afterLoadState.lastTwoActions?.some(a => String(a).includes('After: Load Per-Channel'));

  console.log('  ✓ Has Before/After snapshot pair:', hasBeforeAfter ? '✅ YES' : '❌ NO (BUG)');

  // Step 3: Undo the LAB load
  console.log('\nStep 3: Clicking Undo button...');
  await page.click('#undoBtn');
  await page.waitForTimeout(2000);

  const afterUndoState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow.querySelector('.percent-input');
    const endInput = mkRow.querySelector('.end-input');
    const checkbox = mkRow._virtualCheckbox;
    const toggle = mkRow.querySelector('.per-channel-toggle');

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked
    };
  });

  console.log('After Undo:');
  console.log('  Percent:', afterUndoState.percent);
  console.log('  End Value:', afterUndoState.endValue);
  console.log('  Enabled:', afterUndoState.enabled);
  console.log('  Per-channel enabled:', afterUndoState.perChannelEnabled);

  // Verification
  console.log('\n=== VERIFICATION ===\n');

  const tests = [
    {
      name: 'Channel remains enabled',
      pass: afterUndoState.enabled === true,
      expected: true,
      actual: afterUndoState.enabled
    },
    {
      name: 'Percent value preserved',
      pass: afterUndoState.percent === initialState.percent,
      expected: initialState.percent,
      actual: afterUndoState.percent
    },
    {
      name: 'Per-channel correction cleared',
      pass: afterUndoState.perChannelEnabled === false,
      expected: false,
      actual: afterUndoState.perChannelEnabled
    },
    {
      name: 'Before/After pair created',
      pass: hasBeforeAfter,
      expected: true,
      actual: hasBeforeAfter
    }
  ];

  tests.forEach(test => {
    const status = test.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}: ${test.name}`);
    if (!test.pass) {
      console.log(`      Expected: ${test.expected}, Got: ${test.actual}`);
    }
  });

  const allPassed = tests.every(t => t.pass);

  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED - BUG IS FIXED! 🎉');
  } else {
    console.log('❌ SOME TESTS FAILED - BUG STILL EXISTS');
  }
  console.log('='.repeat(50) + '\n');

  console.log('Browser will stay open for 15 seconds...');
  await page.waitForTimeout(15000);

  await browser.close();
})().catch(err => {
  console.error('\n❌ TEST ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});