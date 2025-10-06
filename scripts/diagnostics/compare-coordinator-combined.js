#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const ARTIFACT_DIR = path.resolve('artifacts/scaling-coordinator-combined');
const QUAD_FILE = path.resolve('data', 'P700-P900_MK50.quad');
const LAB_FILE = path.resolve('testdata', 'cgats17_21step_lab.txt');
const SCALE_SEQUENCE = [92, 78, 115, 101];

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

async function loadQuad(page) {
  const inputHandle = await page.$('#quadFile');
  if (!inputHandle) {
    throw new Error('quadFile input not found');
  }
  await inputHandle.setInputFiles(QUAD_FILE);
  await page.waitForFunction((expected) => {
    return window.loadedQuadData?.filename?.endsWith?.(expected.split('/').pop());
  }, QUAD_FILE, { timeout: 20000, polling: 200 });
}

async function enableEditMode(page) {
  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => {
    return typeof window.isEditModeEnabled === 'function' && window.isEditModeEnabled();
  }, null, { timeout: 10000, polling: 200 });
}

async function loadLabMeasurement(page) {
  await page.evaluate(() => {
    if (window.LinearizationState?.clearGlobalData) {
      window.LinearizationState.clearGlobalData();
    }
  });

  const inputHandle = await page.$('#linearizationFile');
  if (!inputHandle) {
    throw new Error('linearizationFile input not found');
  }
  await inputHandle.setInputFiles(LAB_FILE);
  await page.waitForFunction(() => {
    return !!window.LinearizationState?.getGlobalData?.() && window.LinearizationState.globalApplied === true;
  }, null, { timeout: 20000, polling: 200 });
}

async function resetScaleBaseline(page) {
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
    const value = getter();
    return Number.isFinite(value) && Math.abs(value - 100) < 0.05;
  }, null, { timeout: 10000, polling: 200 });
}

async function setScale(page, percent) {
  await page.evaluate(async (value) => {
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
          console.warn('[compare-coordinator-combined] validateScalingStateSync failed', error);
        }
      }
    };

    if (window.__USE_SCALING_COORDINATOR && bridgeApply) {
      await bridgeApply(value, { metadata: { trigger: 'combined-parity' } });
      runDiagnosticsValidation();
    } else if (legacyApply) {
      legacyApply(value);
      runDiagnosticsValidation();
    }
  }, percent);

  await page.waitForFunction((target) => {
    const getter = typeof window.getCurrentScale === 'function'
      ? window.getCurrentScale
      : window.__quadDebug?.scalingUtils?.getCurrentScale;
    if (typeof getter !== 'function') return false;
    const current = getter();
    return Number.isFinite(current) && Math.abs(current - target) < 0.05;
  }, percent, { timeout: 20000, polling: 200 });
}

async function captureState(page, label) {
  return page.evaluate((tag) => {
    const getter = typeof window.getCurrentScale === 'function'
      ? window.getCurrentScale
      : window.__quadDebug?.scalingUtils?.getCurrentScale;
    const scalePercent = typeof getter === 'function' ? getter() : null;

    const labData = window.LinearizationState?.getGlobalData?.();
    const labMeta = labData ? {
      filename: labData.filename ?? null,
      sampleCount: Array.isArray(labData.samples) ? labData.samples.length : null,
      applied: window.LinearizationState?.globalApplied ?? null
    } : null;

    const rows = Array.from(document.querySelectorAll('tr[data-channel]')).map((row) => {
      const channel = row.getAttribute('data-channel');
      const percent = Number(row.querySelector('.percent-input')?.value ?? NaN);
      const end = Number(row.querySelector('.end-input')?.value ?? NaN);
      const control = window.ControlPoints?.get?.(channel);
      const smartPoints = Array.isArray(control?.points)
        ? control.points.map((point) => ({ input: point.input, output: point.output }))
        : null;
      return { channel, percent, end, smartPoints };
    });

    const history = window.getHistoryManager?.();
    const historySummary = history ? {
      length: history.history?.length ?? null,
      lastKind: history.history?.at?.(-1)?.kind ?? null,
      lastDescription: history.history?.at?.(-1)?.action?.description ?? null
    } : null;

    return {
      label: tag,
      capturedAt: new Date().toISOString(),
      scalePercent,
      rows,
      labMeta,
      historySummary
    };
  }, label);
}

export async function runCombinedScenario(useCoordinator) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let telemetry = [];
  const snapshots = [];

  try {
    await page.goto(`file://${path.resolve('index.html')}`);
    await page.waitForSelector('#scaleAllInput', { timeout: 20000 });

    await toggleCoordinator(page, useCoordinator);
    await resetTelemetry(page);

    await loadQuad(page);
    await enableEditMode(page);
    await loadLabMeasurement(page);
    await resetScaleBaseline(page);

    snapshots.push(await captureState(page, 'after-loads'));

    for (const percent of SCALE_SEQUENCE) {
      await setScale(page, percent);
      snapshots.push(await captureState(page, `after-${percent}`));
    }

    await page.evaluate(() => {
      if (window.scalingCoordinator) {
        window.scalingCoordinator.flushQueue('combined-parity');
      }
    });

    telemetry = await getTelemetry(page);
  } finally {
    await browser.close();
  }

  return { snapshots, telemetry };
}

export async function generateCombinedParityArtifact() {
  await ensureDir(ARTIFACT_DIR);

  const legacyRun = await runCombinedScenario(false);
  const coordinatorRun = await runCombinedScenario(true);

  const payload = {
    generatedAt: new Date().toISOString(),
    quadFile: QUAD_FILE,
    labFile: LAB_FILE,
    scaleSequence: SCALE_SEQUENCE,
    legacy: legacyRun.snapshots,
    coordinator: coordinatorRun.snapshots,
    legacyTelemetry: legacyRun.telemetry,
    coordinatorTelemetry: coordinatorRun.telemetry
  };

  const filePath = path.join(ARTIFACT_DIR, `combined-parity-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Combined parity artifact written:', filePath);
  return filePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateCombinedParityArtifact().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export default generateCombinedParityArtifact;
