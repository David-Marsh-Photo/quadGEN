const path = require('path');
const fs = require('fs/promises');
const { existsSync, mkdirSync } = require('fs');
const crypto = require('crypto');
const { chromium } = require('playwright');

const LABELS = {
  initial: 'initial',
  afterSetup: 'after-setup',
  afterScale: 'after-scale',
  afterUndo: 'after-undo',
  afterRedo: 'after-redo'
};

async function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

async function captureScalingState(page, label) {
  return page.evaluate((stateLabel) => {
    const getter = (window.getCurrentScale
      || window.__quadDebug?.scalingUtils?.getCurrentScale
      || null);

    const scalePercent = typeof getter === 'function' ? getter() : null;
    const scaleInput = document.getElementById('scaleAllInput');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    const channelRows = Array.from(document.querySelectorAll('#rows tr[data-channel]')).map((row) => {
      const channelName = row.getAttribute('data-channel');
      const percentInput = row.querySelector('.percent-input');
      const endInput = row.querySelector('.end-input');
      const statusCell = row.querySelector('[data-status]') || row.querySelector('td:nth-child(4)');
      const smartData = window.ControlPoints?.get?.(channelName) || null;

      return {
        channelName,
        percentValue: percentInput ? percentInput.value : null,
        endValue: endInput ? endInput.value : null,
        statusText: statusCell ? statusCell.textContent.trim() : null,
        smartPointCount: Array.isArray(smartData?.points) ? smartData.points.length : null,
        smartPoints: Array.isArray(smartData?.points)
          ? smartData.points.map((p) => ({ input: p.input, output: p.output }))
          : null,
        interpolation: smartData?.interpolation || null
      };
    });

    const historyManager = window.getHistoryManager?.();
    const historySummary = historyManager
      ? {
          undoDepth: Array.isArray(historyManager.history) ? historyManager.history.length : null,
          redoDepth: Array.isArray(historyManager.redoStack) ? historyManager.redoStack.length : null,
          lastDescription: Array.isArray(historyManager.history) && historyManager.history.length > 0
            ? historyManager.history[historyManager.history.length - 1]?.description || null
            : null
        }
      : null;

    const editMode = typeof window.isEditModeEnabled === 'function'
      ? window.isEditModeEnabled()
      : null;

    const appVersion = window.APP_VERSION || null;
    const scalingFlagEnabled = !!window.__USE_SCALING_STATE;
    const scalingSnapshotGetter = window.getLegacyScalingSnapshot
      || window.__quadDebug?.scalingUtils?.getLegacyScalingSnapshot
      || null;
    let scalingSnapshot = null;
    if (typeof scalingSnapshotGetter === 'function') {
      try {
        scalingSnapshot = scalingSnapshotGetter();
      } catch (snapshotError) {
        console.warn('Failed to capture scaling snapshot', snapshotError);
      }
    }

    let scalingAudit = null;
    if (window.scalingStateAudit) {
      try {
        scalingAudit = JSON.parse(JSON.stringify(window.scalingStateAudit));
      } catch (auditError) {
        console.warn('Failed to serialize scalingStateAudit', auditError);
        scalingAudit = {
          totalChecks: window.scalingStateAudit.totalChecks,
          mismatchCount: window.scalingStateAudit.mismatchCount,
          lastMismatchDelta: window.scalingStateAudit.lastMismatchDelta,
          lastMismatchDetail: window.scalingStateAudit.lastMismatchDetail,
          lastCheckTimestamp: window.scalingStateAudit.lastCheckTimestamp,
          lastCheckReason: window.scalingStateAudit.lastCheckReason,
          lastExpectedMaxAllowed: window.scalingStateAudit.lastExpectedMaxAllowed,
          lastObservedMaxAllowed: window.scalingStateAudit.lastObservedMaxAllowed
        };
      }
    }

    return {
      label: stateLabel,
      capturedAt: new Date().toISOString(),
      appVersion,
      scalingFlagEnabled,
      scalePercent,
      scaleInputValue: scaleInput ? scaleInput.value : null,
      undoButtonEnabled: undoBtn ? !undoBtn.disabled : null,
      redoButtonEnabled: redoBtn ? !redoBtn.disabled : null,
      historySummary,
      editMode,
      globalLinearizationActive: !!window.LinearizationState?.globalApplied,
      channelRows,
      scalingSnapshot,
      scalingAudit
    };
  }, label);
}

async function main() {
  const projectRoot = process.cwd();
  const artifactDir = path.join(projectRoot, 'artifacts', 'scaling-baseline');
  await ensureDir(artifactDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactBaseName = `baseline-${timestamp}`;
  const artifactPath = path.join(artifactDir, `${artifactBaseName}.json`);
  const hashPath = path.join(artifactDir, `${artifactBaseName}.sha256`);

  const consoleEntries = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', (msg) => {
    console.log(`[page:${msg.type()}] ${msg.text()}`);
    consoleEntries.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      timestamp: Date.now()
    });
  });

  try {
    const fileUrl = `file://${path.join(projectRoot, 'index.html')}`;
    await page.goto(fileUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 20000 });

    await page.waitForFunction(() => document.querySelector('tr[data-channel]'), null, { timeout: 20000, polling: 200 });

    const scaleInputInspection = await page.evaluate(() => {
      const input = document.getElementById('scaleAllInput');
      if (!input) {
        return { exists: false };
      }
      return {
        exists: true,
        disabled: input.disabled,
        value: input.value,
        type: input.type,
        min: input.min,
        max: input.max
      };
    });

    console.log('Scale input inspection:', scaleInputInspection);

    if (!scaleInputInspection.exists) {
      throw new Error('scaleAllInput not found; cannot capture baseline');
    }

    const snapshots = {};
    snapshots[LABELS.initial] = await captureScalingState(page, LABELS.initial);
    console.log('Initial scale percent:', snapshots[LABELS.initial]?.scalePercent);

    const setupChannels = [
      { channel: 'MK', percent: 100 }
    ];

    for (const spec of setupChannels) {
      console.log(`Preparing channel ${spec.channel} to ${spec.percent}%`);
      const inspection = await page.evaluate((channelName) => {
        const row = document.querySelector(`tr[data-channel="${channelName}"]`);
        if (!row) return { exists: false };
        return {
          exists: true,
          percentValue: row.querySelector('.percent-input')?.value ?? null,
          endValue: row.querySelector('.end-input')?.value ?? null
        };
      }, spec.channel);
      console.log(`Inspection for ${spec.channel}:`, inspection);

      const locator = page.locator(`tr[data-channel="${spec.channel}"] input.percent-input`);
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await locator.fill(String(spec.percent));
      await locator.press('Enter');

      await page.waitForFunction((payload) => {
        const { channelName, targetPercent } = payload || {};
        const row = channelName ? document.querySelector(`tr[data-channel="${channelName}"]`) : null;
        if (!row) return false;
        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        const percentValue = Number(percentInput?.value);
        const endValue = Number(endInput?.value);
        return Number.isFinite(percentValue) && Math.abs(percentValue - targetPercent) < 0.01
          && Number.isFinite(endValue) && endValue > 0;
      }, { channelName: spec.channel, targetPercent: spec.percent }, { timeout: 20000, polling: 100 });
    }

    snapshots[LABELS.afterSetup] = await captureScalingState(page, LABELS.afterSetup);
    console.log('After setup scale percent:', snapshots[LABELS.afterSetup]?.scalePercent);
    console.log('After setup history summary:', snapshots[LABELS.afterSetup]?.historySummary);
    const baselineUndoDepth = snapshots[LABELS.afterSetup]?.historySummary?.undoDepth ?? 0;

    const scaleInput = page.locator('#scaleAllInput');
    await scaleInput.click();
    await scaleInput.fill('80');

    await page.waitForFunction(() => {
      const getter = (window.getCurrentScale || window.__quadDebug?.scalingUtils?.getCurrentScale);
      if (typeof getter !== 'function') return false;
      const rawValue = getter();
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      return Number.isFinite(value) && Math.abs(value - 80) < 0.01;
    }, null, { timeout: 20000, polling: 100 });

    snapshots[LABELS.afterScale] = await captureScalingState(page, LABELS.afterScale);
    console.log('After scale history summary:', snapshots[LABELS.afterScale]?.historySummary);

    await page.evaluate(() => {
      if (typeof window.resetGlobalScale === 'function') {
        window.resetGlobalScale();
      } else if (typeof window.applyGlobalScale === 'function') {
        window.applyGlobalScale(100);
      }
    });

    await page.waitForFunction(() => {
      const getter = (window.getCurrentScale || window.__quadDebug?.scalingUtils?.getCurrentScale);
      if (typeof getter !== 'function') return false;
      const rawValue = getter();
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      return Number.isFinite(value) && Math.abs(value - 100) < 0.01;
    }, null, { timeout: 20000, polling: 100 });

    snapshots[LABELS.afterUndo] = await captureScalingState(page, LABELS.afterUndo);

    await page.evaluate(() => {
      if (typeof window.applyGlobalScale === 'function') {
        window.applyGlobalScale(80);
      }
    });

    await page.waitForFunction(() => {
      const getter = (window.getCurrentScale || window.__quadDebug?.scalingUtils?.getCurrentScale);
      if (typeof getter !== 'function') return false;
      const rawValue = getter();
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      return Number.isFinite(value) && Math.abs(value - 80) < 0.01;
    }, null, { timeout: 20000, polling: 100 });

    snapshots[LABELS.afterRedo] = await captureScalingState(page, LABELS.afterRedo);

    const payload = {
      generatedAt: new Date().toISOString(),
      artifactBaseName,
      snapshots,
      consoleEntries
    };

    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.writeFile(artifactPath, serialized, 'utf8');

    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    await fs.writeFile(hashPath, `${hash}  ${path.basename(artifactPath)}\n`, 'utf8');

    console.log('Baseline artifact saved:', artifactPath);
    console.log('SHA256:', hash);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
