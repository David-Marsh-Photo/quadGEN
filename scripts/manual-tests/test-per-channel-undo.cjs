const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Navigate to quadGEN
  const appPath = path.join(__dirname, 'index.html');
  await page.goto(`file://${appPath}`);

  console.log('\n=== Test: Per-Channel LAB Load + Undo ===\n');

  // Wait for app to load
  await page.waitForTimeout(1000);

  // Enable DEBUG_LOGS
  await page.evaluate(() => {
    window.DEBUG_LOGS = true;
  });

  // Step 1: Check initial MK channel state
  const initialState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const endInput = mkRow?.querySelector('.end-input');
    const checkbox = mkRow?._virtualCheckbox;

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      hasCurve: !!window.loadedQuadData?.curves?.MK
    };
  });

  console.log('Initial MK state:', initialState);

  // Step 2: Load Manual-LAB-Data.txt for MK channel
  console.log('\n--- Loading Manual-LAB-Data.txt for MK ---');

  const labFilePath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');
  const mkPerChannelInput = await page.locator('[data-channel="MK"] input[type="file"]').elementHandle();

  if (!mkPerChannelInput) {
    console.error('❌ Could not find MK per-channel file input');
    await browser.close();
    return;
  }

  await mkPerChannelInput.setInputFiles(labFilePath);
  await page.waitForTimeout(1500);

  // Step 3: Check state after loading
  const afterLoadState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const endInput = mkRow?.querySelector('.end-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      hasCurve: !!window.loadedQuadData?.curves?.MK,
      perChannelEnabled: toggle?.checked,
      perChannelDisabled: toggle?.disabled,
      historyLength: window.CurveHistory?.history?.length || 0,
      lastHistoryEntry: window.CurveHistory?.history?.[window.CurveHistory.history.length - 1]
    };
  });

  console.log('After load state:', afterLoadState);
  console.log('Last history entry:', afterLoadState.lastHistoryEntry);

  // Step 4: Click undo
  console.log('\n--- Clicking Undo ---');
  await page.click('#undoBtn');
  await page.waitForTimeout(1000);

  // Step 5: Check state after undo
  const afterUndoState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const endInput = mkRow?.querySelector('.end-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      hasCurve: !!window.loadedQuadData?.curves?.MK,
      perChannelEnabled: toggle?.checked,
      perChannelDisabled: toggle?.disabled,
      historyLength: window.CurveHistory?.history?.length || 0,
      redoLength: window.CurveHistory?.redoStack?.length || 0
    };
  });

  console.log('After undo state:', afterUndoState);

  // Analyze results
  console.log('\n=== Analysis ===');

  const undoWorkedCorrectly =
    afterUndoState.enabled === initialState.enabled &&
    afterUndoState.percent === initialState.percent &&
    !afterUndoState.perChannelEnabled;

  if (undoWorkedCorrectly) {
    console.log('✅ Undo worked correctly - restored initial state');
  } else {
    console.log('❌ BUG CONFIRMED:');
    console.log('   Expected enabled:', initialState.enabled);
    console.log('   Actual enabled:', afterUndoState.enabled);
    console.log('   Expected percent:', initialState.percent);
    console.log('   Actual percent:', afterUndoState.percent);
    console.log('   Per-channel should be disabled:', !afterUndoState.perChannelEnabled);
  }

  // Keep browser open for inspection
  console.log('\n--- Press Ctrl+C to close ---');
  await page.waitForTimeout(60000);

  await browser.close();
})();