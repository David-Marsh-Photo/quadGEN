#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const ARTIFACT_DIR = path.resolve('artifacts/scaling-coordinator-lab');
const LAB_FILE = path.resolve('testdata', 'cgats17_21step_lab.txt');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function toggleCoordinator(page, enabled) {
  await page.evaluate((flag) => {
    if (typeof window.enableScalingCoordinator === 'function') {
      window.enableScalingCoordinator(flag);
    } else {
      window.__USE_SCALING_COORDINATOR = !!flag;
    }
  }, enabled);
}

async function resetTelemetry(page) {
  await page.evaluate(() => {
    const telemetry = window.__quadDebug?.scalingTelemetry;
    telemetry?.clear?.();
  });
}

async function getTelemetry(page) {
  return page.evaluate(() => {
    const telemetry = window.__quadDebug?.scalingTelemetry;
    return telemetry?.getBuffer?.() || [];
  });
}

async function loadLabMeasurement(page) {
  await page.evaluate(() => {
    if (typeof window.LinearizationState?.clearGlobal === 'function') {
      window.LinearizationState.clearGlobal();
    }
  });

  const inputHandle = await page.$('#linearizationFile');
  if (!inputHandle) throw new Error('linearizationFile input not found');
  await inputHandle.setInputFiles(LAB_FILE);

  await page.waitForFunction(() => {
    return !!window.LinearizationState?.getGlobalData?.() && window.LinearizationState.globalApplied === true;
  }, null, { timeout: 20000, polling: 200 });
}

async function resetBaseline(page) {
  await page.evaluate(() => {
    if (typeof window.resetGlobalScale === 'function') {
      window.resetGlobalScale();
    }
  });
  await page.waitForFunction(() => {
    const getter = typeof window.getCurrentScale === 'function'
      ? window.getCurrentScale
      : window.__quadDebug?.scalingUtils?.getCurrentScale;
    if (typeof getter !== 'function') return false;
    const val = getter();
    return Number.isFinite(val) && Math.abs(val - 100) < 0.01;
  }, null, { timeout: 10000, polling: 200 });
}

async function setScale(page, percent) {
  await page.evaluate(async (value) => {
    const useCoordinator = !!window.__USE_SCALING_COORDINATOR;
    const bridgeApply = typeof window.applyGlobalScale === 'function'
      ? window.applyGlobalScale
      : window.__quadDebug?.scalingUtils?.applyGlobalScale;
    const legacyApply = typeof window.legacyApplyGlobalScale === 'function'
      ? window.legacyApplyGlobalScale
      : window.__quadDebug?.scalingUtils?.legacyApplyGlobalScale;
    const validator = typeof window.validateScalingStateSync === 'function'
      ? window.validateScalingStateSync
      : window.__quadDebug?.scalingUtils?.validateScalingStateSync;

    const runDiagnosticsValidation = () => {
      if (typeof validator === 'function') {
        try {
          validator({ throwOnMismatch: false, reason: 'diagnostics' });
        } catch (error) {
          console.warn('[compare-coordinator-lab] validateScalingStateSync failed', error);
        }
      }
    };

    if (useCoordinator && bridgeApply) {
      await bridgeApply(value, { metadata: { trigger: 'lab-sequence' } });
      runDiagnosticsValidation();
    } else if (legacyApply) {
      legacyApply(value);
      runDiagnosticsValidation();
    }
  }, percent);

  await page.waitForTimeout(500);
}

async function captureState(page, label) {
  return page.evaluate((tag) => {
    const getScale = typeof window.getCurrentScale === 'function'
      ? window.getCurrentScale
      : window.__quadDebug?.scalingUtils?.getCurrentScale;
    const scalePercent = typeof getScale === 'function' ? getScale() : null;

    const history = window.getHistoryManager?.();
    const historySummary = history ? {
      length: history.history?.length ?? null,
      lastKind: history.history?.at?.(-1)?.kind ?? null,
      lastDescription: history.history?.at?.(-1)?.action?.description ?? null
    } : null;

    const labData = window.LinearizationState?.getGlobalData?.();
    const labMeta = labData ? {
      filename: labData.filename || null,
      pointCount: Array.isArray(labData.samples) ? labData.samples.length : null,
      applied: window.LinearizationState?.globalApplied ?? null
    } : null;

    const rows = Array.from(document.querySelectorAll('tr[data-channel]')).map((row) => {
      const channel = row.getAttribute('data-channel');
      const percentInput = row.querySelector('.percent-input');
      const endInput = row.querySelector('.end-input');
      return {
        channel,
        percent: percentInput ? Number(percentInput.value) : null,
        end: endInput ? Number(endInput.value) : null
      };
    });

    return {
      label: tag,
      capturedAt: new Date().toISOString(),
      scalePercent,
      rows,
      historySummary,
      labMeta
    };
  }, label);
}

async function runScenario(useCoordinator) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let telemetry = [];

  try {
    await page.goto(`file://${path.resolve('index.html')}`);
    await page.waitForSelector('#scaleAllInput', { timeout: 20000 });
    await toggleCoordinator(page, useCoordinator);
    await resetTelemetry(page);
    await loadLabMeasurement(page);
    await resetBaseline(page);

    const snapshots = [];
    snapshots.push(await captureState(page, 'initial'));

    const sequence = [90, 110, 70, 125, 95];
    for (const percent of sequence) {
      await setScale(page, percent);
      snapshots.push(await captureState(page, `after-${percent}`));
    }

    telemetry = await getTelemetry(page);

    return { snapshots, telemetry };
  } finally {
    await browser.close();
  }
}

async function main() {
  await ensureDir(ARTIFACT_DIR);

  const legacyRun = await runScenario(false);
  const coordinatorRun = await runScenario(true);

  const artifact = {
    generatedAt: new Date().toISOString(),
    labFile: LAB_FILE,
    legacy: legacyRun.snapshots,
    coordinator: coordinatorRun.snapshots,
    legacyTelemetry: legacyRun.telemetry,
    coordinatorTelemetry: coordinatorRun.telemetry
  };

  const filePath = path.join(ARTIFACT_DIR, `lab-parity-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf8');
  console.log('Lab parity artifact written:', filePath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
