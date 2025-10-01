const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n=== Test: Per-Channel LAB Load + Undo (Bug Fix Verification) ===\n');

  // Navigate to quadGEN
  const appPath = path.join(__dirname, 'index.html');
  await page.goto(`file://${appPath}`);
  await page.waitForTimeout(1500);

  // Enable DEBUG_LOGS
  await page.evaluate(() => {
    window.DEBUG_LOGS = true;
  });

  // Step 1: Load a .quad file first (so we have curves to start with)
  console.log('Step 1: Loading base .quad file...');
  const quadPath = path.join(__dirname, 'testdata', 'humped_shadow_dip.quad');
  const quadInput = await page.locator('#quadFile').elementHandle();
  await quadInput.setInputFiles(quadPath);
  await page.waitForTimeout(1500);

  // Step 2: Check initial MK channel state
  const initialState = await page.evaluate(() => {
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
      curveLength: window.loadedQuadData?.curves?.MK?.length,
      perChannelEnabled: toggle?.checked,
      perChannelDisabled: toggle?.disabled,
      historyLength: window.CurveHistory?.history?.length || 0
    };
  });

  console.log('\nInitial MK state (after .quad load):');
  console.log('  Percent:', initialState.percent);
  console.log('  End Value:', initialState.endValue);
  console.log('  Enabled:', initialState.enabled);
  console.log('  Has Curve:', initialState.hasCurve);
  console.log('  Curve Length:', initialState.curveLength);
  console.log('  Per-Channel Enabled:', initialState.perChannelEnabled);
  console.log('  History Length:', initialState.historyLength);

  // Step 3: Load Manual-LAB-Data.txt for MK channel
  console.log('\nStep 2: Loading Manual-LAB-Data.txt for MK channel...');

  const labFilePath = path.join(__dirname, 'testdata', 'Manual-LAB-Data.txt');
  const mkPerChannelInput = await page.locator('[data-channel="MK"] input[type="file"]').elementHandle();

  if (!mkPerChannelInput) {
    console.error('❌ Could not find MK per-channel file input');
    await browser.close();
    return;
  }

  await mkPerChannelInput.setInputFiles(labFilePath);
  await page.waitForTimeout(2000);

  // Step 4: Check state after loading LAB data
  const afterLoadState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const percentInput = mkRow?.querySelector('.percent-input');
    const endInput = mkRow?.querySelector('.end-input');
    const checkbox = mkRow?._virtualCheckbox;
    const toggle = mkRow?.querySelector('.per-channel-toggle');

    const history = window.CurveHistory?.history || [];
    const lastTwo = history.slice(-2);

    return {
      percent: percentInput?.value,
      endValue: endInput?.value,
      enabled: checkbox?.checked,
      hasCurve: !!window.loadedQuadData?.curves?.MK,
      curveLength: window.loadedQuadData?.curves?.MK?.length,
      perChannelEnabled: toggle?.checked,
      perChannelDisabled: toggle?.disabled,
      historyLength: history.length,
      lastTwoEntries: lastTwo.map(e => ({
        kind: e.kind,
        action: e.action
      }))
    };
  });

  console.log('\nAfter LAB load:');
  console.log('  Percent:', afterLoadState.percent);
  console.log('  End Value:', afterLoadState.endValue);
  console.log('  Enabled:', afterLoadState.enabled);
  console.log('  Per-Channel Enabled:', afterLoadState.perChannelEnabled);
  console.log('  History Length:', afterLoadState.historyLength);
  console.log('  Last 2 History Entries:', afterLoadState.lastTwoEntries);

  // Check if we have Before/After pair
  const hasBeforeAfterPair = afterLoadState.lastTwoEntries.length === 2 &&
    afterLoadState.lastTwoEntries[0]?.action?.startsWith('Before: Load Per-Channel') &&
    afterLoadState.lastTwoEntries[1]?.action?.startsWith('After: Load Per-Channel');

  if (hasBeforeAfterPair) {
    console.log('  ✅ Found Before/After snapshot pair');
  } else {
    console.log('  ❌ Missing Before/After snapshot pair');
  }

  // Step 5: Click undo
  console.log('\nStep 3: Clicking Undo...');
  await page.click('#undoBtn');
  await page.waitForTimeout(1500);

  // Step 6: Check state after undo
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
      curveLength: window.loadedQuadData?.curves?.MK?.length,
      perChannelEnabled: toggle?.checked,
      perChannelDisabled: toggle?.disabled,
      historyLength: window.CurveHistory?.history?.length || 0,
      redoLength: window.CurveHistory?.redoStack?.length || 0
    };
  });

  console.log('\nAfter Undo:');
  console.log('  Percent:', afterUndoState.percent);
  console.log('  End Value:', afterUndoState.endValue);
  console.log('  Enabled:', afterUndoState.enabled);
  console.log('  Has Curve:', afterUndoState.hasCurve);
  console.log('  Curve Length:', afterUndoState.curveLength);
  console.log('  Per-Channel Enabled:', afterUndoState.perChannelEnabled);
  console.log('  History Length:', afterUndoState.historyLength);
  console.log('  Redo Stack Length:', afterUndoState.redoLength);

  // Step 7: Verify the fix worked
  console.log('\n=== VERIFICATION ===\n');

  const channelStillEnabled = afterUndoState.enabled === initialState.enabled;
  const percentPreserved = afterUndoState.percent === initialState.percent;
  const curveRestored = afterUndoState.hasCurve === initialState.hasCurve;
  const perChannelCleared = !afterUndoState.perChannelEnabled;
  const canRedo = afterUndoState.redoLength > 0;

  console.log('✓ Channel enabled state preserved:', channelStillEnabled ? '✅' : '❌');
  console.log('✓ Percent value preserved:', percentPreserved ? '✅' : '❌');
  console.log('✓ Curve restored to original:', curveRestored ? '✅' : '❌');
  console.log('✓ Per-channel correction cleared:', perChannelCleared ? '✅' : '❌');
  console.log('✓ Can redo operation:', canRedo ? '✅' : '❌');

  const allTestsPassed = channelStillEnabled && percentPreserved && curveRestored && perChannelCleared && canRedo;

  if (allTestsPassed) {
    console.log('\n🎉 ALL TESTS PASSED - Bug is FIXED!\n');
  } else {
    console.log('\n❌ SOME TESTS FAILED - Bug still present\n');
  }

  // Step 8: Test redo
  console.log('Step 4: Testing Redo...');
  await page.click('#redoBtn');
  await page.waitForTimeout(1500);

  const afterRedoState = await page.evaluate(() => {
    const mkRow = document.querySelector('[data-channel="MK"]');
    const toggle = mkRow?.querySelector('.per-channel-toggle');

    return {
      perChannelEnabled: toggle?.checked,
      historyLength: window.CurveHistory?.history?.length || 0,
      redoLength: window.CurveHistory?.redoStack?.length || 0
    };
  });

  console.log('\nAfter Redo:');
  console.log('  Per-Channel Enabled:', afterRedoState.perChannelEnabled);
  console.log('  History Length:', afterRedoState.historyLength);
  console.log('  Redo Stack Length:', afterRedoState.redoLength);

  const redoWorked = afterRedoState.perChannelEnabled === true;
  console.log('✓ Redo restored LAB correction:', redoWorked ? '✅' : '❌');

  console.log('\n--- Test complete. Browser will stay open for 30 seconds ---');
  await page.waitForTimeout(30000);

  await browser.close();
})();