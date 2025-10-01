const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');

const LAB_FILE = path.resolve(__dirname, '..', 'Color-Muse-Data.txt');
const LAB_CONTENT = fs.readFileSync(LAB_FILE, 'utf8');
const MAX_ERROR_PERCENT = 0.25;
const MAX_POINTS = 21;

async function collectState(page, url, label) {
  await page.goto(url);
  await page.waitForTimeout(500);

  return await page.evaluate(async ({ labContent, maxErrorPercent, maxPoints, stateLabel }) => {
    const state = {
      label: stateLabel,
      guards: {},
      before: {},
      after: {},
      meta: {},
      autoLimits: {},
      history: {}
    };

    const parseResult = await window.parseLinearizationFile(labContent, 'Color-Muse-Data.txt');
    const normalized = window.normalizeLinearizationEntry(parseResult);
    window.LinearizationState.setGlobalData(normalized, true);

    const filenameEl = document.getElementById('globalLinearizationFilename');
    if (filenameEl) filenameEl.textContent = 'Color-Muse-Data.txt';

    if (typeof window.updateInkChart === 'function') window.updateInkChart();
    if (typeof window.updateProcessingDetail === 'function') {
      try {
        const printer = typeof window.getCurrentPrinter === 'function' ? window.getCurrentPrinter() : null;
        const channels = printer?.channels || []; // no-op if failed
        channels.forEach((ch) => {
          try { window.updateProcessingDetail(ch); } catch (err) {}
        });
      } catch (err) {}
    }

    const toggleBtn = document.getElementById('editModeToggleBtn');
    if (toggleBtn && typeof window.isEditModeEnabled === 'function' && !window.isEditModeEnabled()) {
      toggleBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const printer = typeof window.getCurrentPrinter === 'function' ? window.getCurrentPrinter() : null;
    const defaultChannel = printer?.channels?.[0] || 'K';
    const selectedChannel = window.EDIT?.selectedChannel || defaultChannel;
    state.selectedChannel = selectedChannel;
    state.initialOrdinal = window.EDIT?.selectedOrdinal || 1;

    const historyBefore = window.CurveHistory?.history?.length || 0;

    if (typeof window.setEditMode === 'function') {
      window.setEditMode(false, { recordHistory: false });
      const guardResult = window.simplifySmartKeyPointsFromCurve(selectedChannel, { maxErrorPercent, maxPoints });
      state.guards.editModeOff = guardResult && guardResult.success === false;
      window.setEditMode(true, { recordHistory: false });
      await new Promise((resolve) => setTimeout(resolve, 150));
    } else {
      state.guards.editModeOff = null;
    }

    const beforeControl = window.ControlPoints?.get ? window.ControlPoints.get(selectedChannel) : null;
    state.before.keyPointCount = beforeControl?.points?.length || 0;
    state.before.points = beforeControl?.points ? beforeControl.points.map((pt) => ({ input: pt.input, output: pt.output })) : [];

    const recomputeResult = window.simplifySmartKeyPointsFromCurve(selectedChannel, { maxErrorPercent, maxPoints }) || {};
    await new Promise((resolve) => setTimeout(resolve, 200));

    const afterControl = window.ControlPoints?.get ? window.ControlPoints.get(selectedChannel) : null;
    state.after.keyPointCount = afterControl?.points?.length || 0;
    state.after.points = afterControl?.points ? afterControl.points.map((pt) => ({ input: pt.input, output: pt.output })) : [];
    state.after.interpolation = afterControl?.interpolation || 'smooth';
    state.after.ordinal = window.EDIT?.selectedOrdinal || null;

    const curveSamples = window.loadedQuadData?.curves?.[selectedChannel];
    state.curveSamples = Array.isArray(curveSamples) ? Array.from(curveSamples) : [];

    const meta = window.loadedQuadData?.keyPointsMeta?.[selectedChannel] || {};
    state.meta = { ...meta };

    state.autoLimits = {
      white: !!document.getElementById('autoWhiteLimitToggle')?.checked,
      black: !!document.getElementById('autoBlackLimitToggle')?.checked
    };

    const historyAfter = window.CurveHistory?.history?.length || 0;
    const lastEntry = window.CurveHistory?.history?.[historyAfter - 1] || null;
    state.history = {
      before: historyBefore,
      after: historyAfter,
      lastEntryType: lastEntry?.kind || null,
      lastActionType: lastEntry?.action?.type || null,
      lastChannel: lastEntry?.action?.channelName || null,
      lastExtras: lastEntry?.action ? {
        newBakedGlobal: lastEntry.action.newBakedGlobal || false,
        oldBakedGlobal: lastEntry.action.oldBakedGlobal || false
      } : null
    };

    state.recomputeResult = recomputeResult;
    state.lastStatus = typeof window.__lastStatusChat === 'object' ? window.__lastStatusChat.text : null;

    return state;
  }, { labContent: LAB_CONTENT, maxErrorPercent: MAX_ERROR_PERCENT, maxPoints: MAX_POINTS, stateLabel: label });
}

function compareKeyPoints(modularPoints, legacyPoints) {
  if (modularPoints.length !== legacyPoints.length) {
    return { match: false, reason: `Key point count mismatch ${modularPoints.length} vs ${legacyPoints.length}` };
  }
  for (let i = 0; i < modularPoints.length; i++) {
    const a = modularPoints[i];
    const b = legacyPoints[i];
    const inputDiff = Math.abs(a.input - b.input);
    const outputDiff = Math.abs(a.output - b.output);
    if (inputDiff > 0.05 || outputDiff > 0.1) {
      return { match: false, reason: `Key point ${i + 1} differs (input Δ=${inputDiff.toFixed(4)}, output Δ=${outputDiff.toFixed(4)})` };
    }
  }
  return { match: true };
}

function compareCurves(modularSamples, legacySamples) {
  if (modularSamples.length !== legacySamples.length) {
    return { match: false, reason: `Curve sample length mismatch ${modularSamples.length} vs ${legacySamples.length}` };
  }
  for (let i = 0; i < modularSamples.length; i++) {
    const diff = Math.abs(modularSamples[i] - legacySamples[i]);
    if (diff > 1) {
      return { match: false, reason: `Curve sample ${i} differs by ${diff}` };
    }
  }
  return { match: true };
}

(async () => {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const modularUrl = 'file://' + path.resolve(process.cwd(), 'dist/index.html');
  const legacyUrl = 'file://' + path.resolve(process.cwd(), 'quadgen.html');

  const modularState = await collectState(page, modularUrl, 'modular');
  const legacyState = await collectState(page, legacyUrl, 'legacy');

  await browser.close();

  let success = true;
  const errors = [];

  if (modularState.guards.editModeOff !== legacyState.guards.editModeOff || !modularState.guards.editModeOff) {
    success = false;
    errors.push('Edit-mode guard mismatch or not enforced.');
  }

  const keyPointComparison = compareKeyPoints(modularState.after.points, legacyState.after.points);
  if (!keyPointComparison.match) {
    success = false;
    errors.push(keyPointComparison.reason);
  }

  const curveComparison = compareCurves(modularState.curveSamples, legacyState.curveSamples);
  if (!curveComparison.match) {
    success = false;
    errors.push(curveComparison.reason);
  }

  const metaFields = ['bakedGlobal', 'bakedAutoLimit', 'bakedAutoWhite', 'bakedAutoBlack'];
  metaFields.forEach((field) => {
    if (!!modularState.meta[field] !== !!legacyState.meta[field]) {
      success = false;
      errors.push(`Metadata field ${field} mismatch (${modularState.meta[field]} vs ${legacyState.meta[field]})`);
    }
  });

  if (modularState.after.ordinal !== legacyState.after.ordinal) {
    success = false;
    errors.push(`Selected ordinal mismatch (${modularState.after.ordinal} vs ${legacyState.after.ordinal}).`);
  }

  const modularHistoryDelta = modularState.history.after - modularState.history.before;
  const legacyHistoryDelta = legacyState.history.after - legacyState.history.before;
  if (modularHistoryDelta !== 1 || legacyHistoryDelta !== 1) {
    success = false;
    errors.push(`History did not record recompute action correctly (Δmodular=${modularHistoryDelta}, Δlegacy=${legacyHistoryDelta}).`);
  }

  if (modularState.history.lastEntryType !== legacyState.history.lastEntryType || modularState.history.lastActionType !== legacyState.history.lastActionType) {
    success = false;
    errors.push('Last history entry type mismatch.');
  }

  if ((modularState.lastStatus || '') !== (legacyState.lastStatus || '')) {
    success = false;
    errors.push(`Status message mismatch (${modularState.lastStatus || 'undefined'} vs ${legacyState.lastStatus || 'undefined'}).`);
  }

  const summary = {
    success,
    modular: modularState,
    legacy: legacyState,
    errors
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!success) {
    process.exitCode = 1;
  }
})();
