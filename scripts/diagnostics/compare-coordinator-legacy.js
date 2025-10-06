#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { chromium } from 'playwright';

const ITERATIONS = process.env.COORDINATOR_TEST_RUNS ? Number(process.env.COORDINATOR_TEST_RUNS) : 10;
const TOTAL_SEQUENCE_LENGTH = process.env.COORDINATOR_SEQUENCE_LENGTH ? Number(process.env.COORDINATOR_SEQUENCE_LENGTH) : 200;
const MAX_PERCENT = 1000;
const MIN_PERCENT = 1;
const ARTIFACT_DIR = path.resolve('artifacts/scaling-coordinator-parity');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function randomPercent(rng) {
  const value = Math.floor(rng() * (MAX_PERCENT - MIN_PERCENT + 1)) + MIN_PERCENT;
  return value;
}

function createSeededRng(seed) {
  let h = createHash('sha256').update(String(seed)).digest();
  let idx = 0;
  return function rng() {
    if (idx >= h.length) {
      h = createHash('sha256').update(h).digest();
      idx = 0;
    }
    const byte = h[idx++];
    return byte / 255;
  };
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
    if (telemetry?.clear) {
      telemetry.clear();
    }
  });
}

async function getTelemetry(page) {
  return page.evaluate(() => {
    const telemetry = window.__quadDebug?.scalingTelemetry;
    if (telemetry?.getBuffer) {
      return telemetry.getBuffer();
    }
    return [];
  });
}

export async function setScaleValue(page, percent, priority = 'normal') {
  return page.evaluate(async ({ percent, priority }) => {
    const coordinatorEnabled = !!window.__USE_SCALING_COORDINATOR;
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
          console.warn('[compare-coordinator] validateScalingStateSync failed', error);
        }
      }
    };

    if (coordinatorEnabled && bridgeApply) {
      try {
        await bridgeApply(percent, { priority, metadata: { trigger: 'parity-sequence' } });
        runDiagnosticsValidation();
        return { success: true };
      } catch (error) {
        return { success: false, message: error?.message || String(error) };
      }
    }

    if (legacyApply) {
      legacyApply(percent);
      runDiagnosticsValidation();
      return { success: true };
    }

    return { success: false, message: 'Scale API unavailable' };
  }, { percent, priority });
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
        smartCount: Array.isArray(smart?.points) ? smart.points.length : null,
        smartPoints: Array.isArray(smart?.points)
          ? smart.points.map((p) => ({ input: p.input, output: p.output }))
          : null
      };
    });

    const history = window.getHistoryManager?.();
    const historySummary = history
      ? {
          historyLength: history.history?.length ?? null,
          redoLength: history.redoStack?.length ?? null,
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

async function runSequence(useCoordinator, seed) {
  const rng = createSeededRng(seed);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let telemetry = [];

  try {
    await page.goto(`file://${path.resolve('index.html')}`);
    await page.waitForSelector('#scaleAllInput', { timeout: 20000 });
    await toggleCoordinator(page, useCoordinator);
    await resetTelemetry(page);

    results.push(await captureState(page, 'initial'));

    for (let i = 0; i < TOTAL_SEQUENCE_LENGTH; i += 1) {
      const percent = randomPercent(rng);
      const priority = rng() < 0.1 ? 'high' : 'normal';
      const outcome = await setScaleValue(page, percent, priority);
      if (!outcome.success) {
        results.push({ label: `error-${i}`, error: outcome.message, percent, priority });
        break;
      }
      const snapshot = await captureState(page, `after-${i}`);
      snapshot.command = { percent, priority };
      results.push(snapshot);
    }

    telemetry = await getTelemetry(page);

    return { snapshots: results, telemetry };
  } finally {
    await browser.close();
  }
}

function compareSequences(legacySnapshots, coordinatorSnapshots) {
  const diffs = [];
  const maxLength = Math.min(legacySnapshots.length, coordinatorSnapshots.length);

  for (let index = 0; index < maxLength; index += 1) {
    const legacy = legacySnapshots[index];
    const coord = coordinatorSnapshots[index];

    const channelDiffs = [];
    if (legacy.rows && coord.rows) {
      for (let rowIdx = 0; rowIdx < legacy.rows.length; rowIdx += 1) {
        const a = legacy.rows[rowIdx];
        const b = coord.rows[rowIdx];
        if (!a || !b) continue;
        const percentDelta = Math.abs((a.percent ?? 0) - (b.percent ?? 0));
        const endDelta = Math.abs((a.end ?? 0) - (b.end ?? 0));
        if (percentDelta > 0.05 || endDelta > 1) {
          channelDiffs.push({
            channel: a.channel,
            percentDelta,
            endDelta
          });
        }
      }
    }

    if (channelDiffs.length > 0
      || legacy.historySummary?.historyLength !== coord.historySummary?.historyLength
      || legacy.historySummary?.redoLength !== coord.historySummary?.redoLength) {
      diffs.push({
        index,
        legacy,
        coordinator: coord,
        channelDiffs
      });
    }
  }

  return diffs;
}

async function main() {
  await ensureDir(ARTIFACT_DIR);

  const summary = [];

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const seed = `${Date.now()}-${iteration}`;
    console.log(`Running parity iteration ${iteration + 1}/${ITERATIONS} with seed ${seed}`);

    const legacyRun = await runSequence(false, seed);
    const coordinatorRun = await runSequence(true, seed);
    const diffs = compareSequences(legacyRun.snapshots, coordinatorRun.snapshots);

    summary.push({
      seed,
      diffCount: diffs.length,
      telemetry: {
        legacy: legacyRun.telemetry.length,
        coordinator: coordinatorRun.telemetry.length
      }
    });

    const artifact = {
      seed,
      legacySnapshots: legacyRun.snapshots,
      coordinatorSnapshots: coordinatorRun.snapshots,
      legacyTelemetry: legacyRun.telemetry,
      coordinatorTelemetry: coordinatorRun.telemetry,
      diffs
    };

    const baseName = `parity-${iteration}-${seed.replace(/[^a-zA-Z0-9-]/g, '')}`;
    const filePath = path.join(ARTIFACT_DIR, `${baseName}.json`);
    await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf8');
  }

  const summaryPath = path.join(ARTIFACT_DIR, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('Parity summary written to', summaryPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
