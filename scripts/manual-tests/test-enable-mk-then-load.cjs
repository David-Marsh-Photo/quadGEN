const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage();

  console.log('\n=== Test: Enable MK → Load LAB → Undo ===\n');

  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForTimeout(3000);

  // Enable DEBUG_LOGS
  await page.evaluate(() => {
    window.DEBUG_LOGS = true;
  });

  // Capture console logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[UNDO DEBUG]') || text.includes('[STATE]')) {
      logs.push(text);
    }
  });

  // Step 1: Enable MK at 100%
  console.log('Step 1: Enabling MK channel at 100%...');

  await page.evaluate(() => {
    const mkRow = Array.from(document.querySelectorAll('[data-channel]'))
      .find(r => r.getAttribute('data-channel') === 'MK');

    if (!mkRow) throw new Error('MK row not found');

    const percentInput = mkRow.querySelector('.percent-input');
    if (!percentInput) throw new Error('MK percent input not found');

    percentInput.value = '100';
    percentInput.dispatchEvent(new Event('input', { bubbles: true }));
    percentInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.waitForTimeout(1000);

  const afterEnable = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const stateManager = window.getStateManager?.();
    const mkState = stateManager?.get('printer.channelValues.MK');

    return {
      uiPercent: percentInput?.value,
      uiEnabled: checkbox?.checked,
      stateValue: mkState
    };
  });

  console.log('After enabling MK:');
  console.log('  UI Percent:', afterEnable.uiPercent);
  console.log('  UI Enabled:', afterEnable.uiEnabled);
  console.log('  State Manager:', JSON.stringify(afterEnable.stateValue, null, 2));

  // Step 2: Load LAB data
  console.log('\nStep 2: Loading LAB data for MK...');

  const labPath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');

  const fileInputFound = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const fileInput = mkRow?.querySelector('input[type="file"]');
    if (fileInput) {
      window._mkFileInput = fileInput;
      return true;
    }
    return false;
  });

  if (!fileInputFound) {
    console.error('❌ MK file input not found');
    await browser.close();
    return;
  }

  const fileInput = await page.evaluateHandle(() => window._mkFileInput);
  await fileInput.asElement().setInputFiles(labPath);
  await page.waitForTimeout(3000);

  const afterLoad = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');
    const stateManager = window.getStateManager?.();
    const mkState = stateManager?.get('printer.channelValues.MK');
    const history = window.CurveHistory?.history || [];

    return {
      uiPercent: percentInput?.value,
      uiEnabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked,
      stateValue: mkState,
      historyLength: history.length,
      lastTwoActions: history.slice(-2).map(e => ({
        kind: e.kind,
        action: e.action || e.state?.action
      }))
    };
  });

  console.log('\nAfter loading LAB:');
  console.log('  UI Percent:', afterLoad.uiPercent);
  console.log('  UI Enabled:', afterLoad.uiEnabled);
  console.log('  Per-Channel Enabled:', afterLoad.perChannelEnabled);
  console.log('  State Manager:', JSON.stringify(afterLoad.stateValue, null, 2));
  console.log('  History Length:', afterLoad.historyLength);
  console.log('  Last 2 entries:', JSON.stringify(afterLoad.lastTwoActions, null, 2));

  // Step 3: Undo
  console.log('\nStep 3: Clicking Undo...');
  await page.click('#undoBtn');
  await page.waitForTimeout(2000);

  const afterUndo = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');
    const stateManager = window.getStateManager?.();
    const mkState = stateManager?.get('printer.channelValues.MK');

    return {
      uiPercent: percentInput?.value,
      uiEnabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked,
      stateValue: mkState
    };
  });

  console.log('\nAfter Undo:');
  console.log('  UI Percent:', afterUndo.uiPercent);
  console.log('  UI Enabled:', afterUndo.uiEnabled);
  console.log('  Per-Channel Enabled:', afterUndo.perChannelEnabled);
  console.log('  State Manager:', JSON.stringify(afterUndo.stateValue, null, 2));

  console.log('\n=== DEBUG LOGS ===');
  logs.forEach(log => console.log('  ' + log));

  console.log('\n=== RESULT ===');
  const wasEnabled = afterEnable.uiEnabled === true;
  const stillEnabled = afterUndo.uiEnabled === true;
  const labCleared = afterUndo.perChannelEnabled === false;

  console.log('✓ MK was enabled before LAB load:', wasEnabled ? '✅' : '❌');
  console.log('✓ MK still enabled after undo:', stillEnabled ? '✅' : '❌');
  console.log('✓ LAB correction cleared:', labCleared ? '✅' : '❌');

  if (wasEnabled && stillEnabled && labCleared) {
    console.log('\n🎉 TEST PASSED - Undo works correctly!');
  } else {
    console.log('\n❌ TEST FAILED - Bug present');
    if (wasEnabled && !stillEnabled) {
      console.log('   BUG: Channel was disabled by undo');
    }
  }

  await page.waitForTimeout(15000);
  await browser.close();
})().catch(err => {
  console.error('❌ ERROR:', err.message);
  process.exit(1);
});