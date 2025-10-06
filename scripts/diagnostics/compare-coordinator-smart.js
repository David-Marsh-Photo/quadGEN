#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const ARTIFACT_DIR = path.resolve('artifacts/scaling-coordinator-smart');

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

async function loadQuad(page, filename) {
  const inputHandle = await page.$('#quadFile');
  if (!inputHandle) throw new Error('quadFile input not found');
  await inputHandle.setInputFiles(path.resolve('data', filename));
  await page.waitForFunction((expected) => {
    return window.loadedQuadData?.filename?.endsWith(expected);
  }, filename, { timeout: 20000, polling: 200 });
}

async function enableEditMode(page) {
  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => typeof window.isEditModeEnabled === 'function' && window.isEditModeEnabled(), null, { timeout: 10000 });
}

async function captureState(page, label) {
  return page.evaluate((tag) => {
    const getScale = typeof window.getCurrentScale === 'function'
      ? window.getCurrentScale
      : window.__quadDebug?.scalingUtils?.getCurrentScale;
    const scalePercent = typeof getScale === 'function' ? getScale() : null;

    const rows = Array.from(document.querySelectorAll('tr[data-channel]')).map((row) => {
      const channel = row.getAttribute('data-channel');
      const percentInput = row.querySelector('.percent-input');
      const endInput = row.querySelector('.end-input');
      const smart = window.ControlPoints?.get?.(channel);
      return {
        channel,
        percent: percentInput ? Number(percentInput.value) : null,
        end: endInput ? Number(endInput.value) : null,
        smartPoints: Array.isArray(smart?.points)
          ? smart.points.map((p) => ({ input: p.input, output: p.output }))
          : null
      };
    });

    const history = window.getHistoryManager?.();
    const historySummary = history
      ? {
          length: history.history?.length ?? null,
          lastKind: history.history?.at?.(-1)?.kind ?? null,
          lastDescription: history.history?.at?.(-1)?.action?.description ?? null
        }
      : null;

    return {
      label: tag,
      capturedAt: new Date().toISOString(),
      scalePercent,
      rows,
      historySummary
    };
  }, label);
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
          console.warn('[compare-coordinator-smart] validateScalingStateSync failed', error);
        }
      }
    };

    if (useCoordinator && bridgeApply) {
      await bridgeApply(value, { metadata: { trigger: 'smart-sequence' } });
      runDiagnosticsValidation();
    } else if (legacyApply) {
      legacyApply(value);
      runDiagnosticsValidation();
    }
  }, percent);

  await page.waitForFunction((target) => {
    const getScale = typeof window.getCurrentScale === 'function'
      ? window.getCurrentScale
      : window.__quadDebug?.scalingUtils?.getCurrentScale;
    if (typeof getScale !== 'function') return false;
    const value = getScale();
    return Number.isFinite(value) && Math.abs(value - target) < 0.01;
  }, percent, { timeout: 20000, polling: 200 });
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
    await loadQuad(page, 'P700-P900_MK50.quad');
    await enableEditMode(page);

    const snapshots = [];
    snapshots.push(await captureState(page, 'initial'));

    const scaleSequence = [80, 60, 120, 95];
    for (const percent of scaleSequence) {
      await setScale(page, percent);
      snapshots.push(await captureState(page, `after-${percent}`));
    }

    await page.evaluate(() => {
      if (window.scalingCoordinator) {
        window.scalingCoordinator.flushQueue('scenario-complete');
      }
    });

    telemetry = await getTelemetry(page);

    return { snapshots, telemetry };
  } finally {
    await browser.close();
  }
}

async function main() {
  await ensureDir(ARTIFACT_DIR);

  const legacyRun = await runScenario(false, 'legacy');
  const coordinatorRun = await runScenario(true, 'coordinator');

  const artifact = {
    generatedAt: new Date().toISOString(),
    legacy: legacyRun.snapshots,
    coordinator: coordinatorRun.snapshots,
    legacyTelemetry: legacyRun.telemetry,
    coordinatorTelemetry: coordinatorRun.telemetry
  };

  const filePath = path.join(ARTIFACT_DIR, `smart-parity-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf8');
  console.log('Smart parity artifact written:', filePath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
