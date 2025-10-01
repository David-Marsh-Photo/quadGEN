const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n=== Undo Bug Test with Debug Logging ===\n');

  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForTimeout(3000);

  // Enable DEBUG_LOGS
  await page.evaluate(() => {
    window.DEBUG_LOGS = true;
  });

  // Check initial MK state
  const initialMK = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const stateManager = window.getStateManager?.();
    const stateValue = stateManager?.get('printer.channelValues.MK');

    return {
      uiPercent: percentInput?.value,
      uiEnabled: checkbox?.checked,
      stateManagerValue: stateValue,
      hasStateManager: !!stateManager
    };
  });

  console.log('Initial MK state:');
  console.log('  UI Percent:', initialMK.uiPercent);
  console.log('  UI Enabled:', initialMK.uiEnabled);
  console.log('  State Manager Value:', JSON.stringify(initialMK.stateManagerValue, null, 2));
  console.log('  Has State Manager:', initialMK.hasStateManager);

  // Set up console log capture
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[UNDO DEBUG]')) {
      consoleLogs.push(text);
      console.log('  📝', text);
    }
  });

  // Load LAB data for MK
  console.log('\n--- Loading Manual-LAB-Data.txt for MK ---\n');

  const labPath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');

  await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    window._mkFileInput = mkRow?.querySelector('input[type="file"]');
  });

  const fileInput = await page.evaluateHandle(() => window._mkFileInput);
  if (!fileInput) {
    console.error('❌ Could not find MK file input');
    await browser.close();
    return;
  }

  await fileInput.asElement().setInputFiles(labPath);
  await page.waitForTimeout(3000);

  // Check state after loading
  const afterLoad = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');
    const stateManager = window.getStateManager?.();
    const stateValue = stateManager?.get('printer.channelValues.MK');
    const history = window.CurveHistory?.history || [];

    return {
      uiPercent: percentInput?.value,
      uiEnabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked,
      stateManagerValue: stateValue,
      historyLength: history.length,
      lastTwoActions: history.slice(-2).map(e => e.action || e.state?.action)
    };
  });

  console.log('\nAfter LAB load:');
  console.log('  UI Percent:', afterLoad.uiPercent);
  console.log('  UI Enabled:', afterLoad.uiEnabled);
  console.log('  Per-Channel Enabled:', afterLoad.perChannelEnabled);
  console.log('  State Manager Value:', JSON.stringify(afterLoad.stateManagerValue, null, 2));
  console.log('  History Length:', afterLoad.historyLength);
  console.log('  Last 2 Actions:', afterLoad.lastTwoActions);

  // Click Undo
  console.log('\n--- Clicking Undo ---\n');
  await page.click('#undoBtn');
  await page.waitForTimeout(2000);

  // Check state after undo
  const afterUndo = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');
    const stateManager = window.getStateManager?.();
    const stateValue = stateManager?.get('printer.channelValues.MK');

    return {
      uiPercent: percentInput?.value,
      uiEnabled: checkbox?.checked,
      perChannelEnabled: toggle?.checked,
      stateManagerValue: stateValue
    };
  });

  console.log('\nAfter Undo:');
  console.log('  UI Percent:', afterUndo.uiPercent);
  console.log('  UI Enabled:', afterUndo.uiEnabled);
  console.log('  Per-Channel Enabled:', afterUndo.perChannelEnabled);
  console.log('  State Manager Value:', JSON.stringify(afterUndo.stateManagerValue, null, 2));

  // Analysis
  console.log('\n=== ANALYSIS ===\n');

  console.log('Debug logs captured:');
  if (consoleLogs.length === 0) {
    console.log('  ⚠️  No debug logs captured! DEBUG_LOGS might not be working.');
  } else {
    consoleLogs.forEach(log => console.log('  ' + log));
  }

  console.log('\nKey findings:');
  console.log('  1. Initial state manager had MK at:', JSON.stringify(initialMK.stateManagerValue));
  console.log('  2. After load, state manager has MK at:', JSON.stringify(afterLoad.stateManagerValue));
  console.log('  3. After undo, state manager has MK at:', JSON.stringify(afterUndo.stateManagerValue));

  const bugPresent = afterUndo.uiEnabled === false && initialMK.uiEnabled === true;

  if (bugPresent) {
    console.log('\n❌ BUG CONFIRMED:');
    console.log('   Channel was disabled by undo when it should have stayed enabled');
    console.log('   Initial enabled:', initialMK.uiEnabled);
    console.log('   After undo enabled:', afterUndo.uiEnabled);
  } else {
    console.log('\n✅ Bug appears to be fixed or issue is elsewhere');
  }

  console.log('\n--- Browser will stay open for 20 seconds ---');
  await page.waitForTimeout(20000);

  await browser.close();
})().catch(err => {
  console.error('\n❌ TEST ERROR:', err);
  process.exit(1);
});