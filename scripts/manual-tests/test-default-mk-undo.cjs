const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'index.html'));

  console.log('\n=== Test: Default MK State + LAB Load + Undo ===\n');
  await page.waitForTimeout(2000);

  // Get default MK state
  const mkState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    if (!mkRow) return { error: 'No MK row found' };

    const percentInput = mkRow.querySelector('.percent-input');
    const endInput = mkRow.querySelector('.end-input');
    const checkbox = mkRow._virtualCheckbox;

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      hasCurve: !!window.loadedQuadData?.curves?.MK,
      curveFirstValue: window.loadedQuadData?.curves?.MK?.[0],
      curveLastValue: window.loadedQuadData?.curves?.MK?.[255]
    };
  });

  console.log('Default MK state:', mkState);

  if (mkState.error) {
    console.log('❌ No MK channel found - test cannot continue');
    await browser.close();
    return;
  }

  // Now load LAB data
  console.log('\n--- Loading LAB data for MK ---');
  const labPath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');

  await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const btn = mkRow?.querySelector('.per-channel-btn');
    if (btn) {
      window._mkFileInput = mkRow.querySelector('input[type="file"]');
    }
  });

  const fileInput = await page.evaluateHandle(() => window._mkFileInput);
  if (!fileInput) {
    console.log('❌ Could not find file input');
    await browser.close();
    return;
  }

  await fileInput.asElement().setInputFiles(labPath);
  await page.waitForTimeout(2500);

  const afterLoad = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');

    const history = window.CurveHistory?.history || [];
    const lastTwo = history.slice(-2);

    return {
      percent: percentInput?.value,
      enabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked,
      historyLength: history.length,
      lastTwoActions: lastTwo.map(e => e.action || e.state?.action)
    };
  });

  console.log('After LAB load:');
  console.log('  Enabled:', afterLoad.enabled);
  console.log('  Percent:', afterLoad.percent);
  console.log('  Per-channel enabled:', afterLoad.perChannelEnabled);
  console.log('  History length:', afterLoad.historyLength);
  console.log('  Last 2 actions:', afterLoad.lastTwoActions);

  const hasBeforeAfter = afterLoad.lastTwoActions?.some(a => a?.includes('Before: Load Per-Channel')) &&
                         afterLoad.lastTwoActions?.some(a => a?.includes('After: Load Per-Channel'));
  console.log('  Has Before/After pair:', hasBeforeAfter ? '✅' : '❌');

  // Now undo
  console.log('\n--- Clicking Undo ---');
  await page.click('#undoBtn');
  await page.waitForTimeout(1500);

  const afterUndo = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');

    return {
      percent: percentInput?.value,
      enabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked
    };
  });

  console.log('After Undo:');
  console.log('  Enabled:', afterUndo.enabled);
  console.log('  Percent:', afterUndo.percent);
  console.log('  Per-channel enabled:', afterUndo.perChannelEnabled);

  console.log('\n=== VERIFICATION ===');
  const channelStillEnabled = afterUndo.enabled === mkState.enabled;
  const percentPreserved = afterUndo.percent === mkState.percent;
  const perChannelCleared = !afterUndo.perChannelEnabled;

  console.log('✓ Channel still enabled:', channelStillEnabled ? '✅' : '❌',
    `(expected: ${mkState.enabled}, got: ${afterUndo.enabled})`);
  console.log('✓ Percent preserved:', percentPreserved ? '✅' : '❌',
    `(expected: ${mkState.percent}, got: ${afterUndo.percent})`);
  console.log('✓ Per-channel cleared:', perChannelCleared ? '✅' : '❌');

  const allPassed = channelStillEnabled && percentPreserved && perChannelCleared;

  if (allPassed) {
    console.log('\n🎉 TEST PASSED - Bug is FIXED!\n');
  } else {
    console.log('\n❌ TEST FAILED - Bug still present\n');
  }

  await page.waitForTimeout(15000);
  await browser.close();
})();