#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { chromium } from 'playwright';

const DEFAULT_ITERATIONS = Number.parseInt(process.env.SCALING_STATE_ITERATIONS || '5', 10);
const DEFAULT_SEQUENCE = Number.parseInt(process.env.SCALING_STATE_SEQUENCE || '100', 10);
const DEFAULT_MAX_PERCENT = Number.parseInt(process.env.SCALING_STATE_MAX_PERCENT || '1000', 10);
const DEFAULT_MIN_PERCENT = Number.parseInt(process.env.SCALING_STATE_MIN_PERCENT || '1', 10);
const DEFAULT_PRIORITY_RATE = Number.parseFloat(process.env.SCALING_STATE_HIGH_PRIORITY_RATE || '0.1');
const DEFAULT_SEED = process.env.SCALING_STATE_SEED || `${Date.now()}`;
const ARTIFACT_ROOT = process.env.SCALING_STATE_OUTPUT_DIR || 'artifacts/scaling-state-ab';

function parseArgs(argv) {
  const options = {
    iterations: DEFAULT_ITERATIONS,
    sequence: DEFAULT_SEQUENCE,
    minPercent: DEFAULT_MIN_PERCENT,
    maxPercent: DEFAULT_MAX_PERCENT,
    highPriorityRate: DEFAULT_PRIORITY_RATE,
    seed: DEFAULT_SEED,
    enableState: false,
    enableCoordinator: true,
    artifactDir: ARTIFACT_ROOT
  };

  argv.forEach((token) => {
    if (!token.startsWith('--')) return;
    const [rawKey, rawValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    const value = rawValue ?? '';

    switch (key) {
      case 'iterations':
        options.iterations = Number.parseInt(value || '0', 10) || options.iterations;
        break;
      case 'sequence':
        options.sequence = Number.parseInt(value || '0', 10) || options.sequence;
        break;
      case 'min':
        options.minPercent = Number.parseInt(value || '0', 10) || options.minPercent;
        break;
      case 'max':
        options.maxPercent = Number.parseInt(value || '0', 10) || options.maxPercent;
        break;
      case 'seed':
        options.seed = value && value.length > 0 ? value : options.seed;
        break;
      case 'state':
        options.enableState = value === '' ? true : value === 'true';
        break;
      case 'no-state':
        options.enableState = false;
        break;
      case 'coordinator':
        options.enableCoordinator = value === '' ? true : value === 'true';
        break;
      case 'no-coordinator':
        options.enableCoordinator = false;
        break;
      case 'priority-rate':
        options.highPriorityRate = Number.parseFloat(value || '0');
        if (!Number.isFinite(options.highPriorityRate) || options.highPriorityRate < 0 || options.highPriorityRate > 1) {
          options.highPriorityRate = DEFAULT_PRIORITY_RATE;
        }
        break;
      case 'output':
        options.artifactDir = value && value.length > 0 ? value : options.artifactDir;
        break;
      default:
        break;
    }
  });

  if (options.minPercent < 1) options.minPercent = 1;
  if (options.maxPercent <= options.minPercent) options.maxPercent = options.minPercent + 1;
  if (options.sequence < 1) options.sequence = 1;
  if (options.iterations < 1) options.iterations = 1;

  return options;
}

function createSeededRng(seed) {
  let buffer = crypto.createHash('sha256').update(String(seed)).digest();
  let index = 0;
  return function rng() {
    if (index >= buffer.length) {
      buffer = crypto.createHash('sha256').update(buffer).digest();
      index = 0;
    }
    const value = buffer[index];
    index += 1;
    return value / 255;
  };
}

function pickPercent(rng, min, max) {
  const range = max - min + 1;
  const value = Math.floor(rng() * range) + min;
  return Math.max(min, Math.min(max, value));
}

function computeStats(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, min: null, max: null, avg: null, p95: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const count = values.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sum / count;
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const p95 = sorted[idx];
  return { count, min, max, avg, p95 };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function evaluateOnPage(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function toggleFlags(page, { enableState, enableCoordinator }) {
  await evaluateOnPage(page, ({ stateFlag, coordinatorFlag }) => {
    if (typeof window.enableScalingCoordinator === 'function') {
      window.enableScalingCoordinator(coordinatorFlag);
    } else {
      window.__USE_SCALING_COORDINATOR = !!coordinatorFlag;
    }

    if (typeof window.setScalingStateEnabled === 'function') {
      window.setScalingStateEnabled(stateFlag);
    } else {
      window.__USE_SCALING_STATE = !!stateFlag;
    }
  }, { stateFlag: enableState, coordinatorFlag: enableCoordinator });
}

async function resetHarnessState(page) {
  await evaluateOnPage(page, () => {
    const scalingDebug = window.__quadDebug?.scalingUtils;
    const telemetry = window.__quadDebug?.scalingTelemetry;

    if (typeof window.resetGlobalScale === 'function') {
      window.resetGlobalScale();
    } else if (scalingDebug?.resetGlobalScale) {
      scalingDebug.resetGlobalScale();
    }

    telemetry?.clear?.();

    if (typeof window.resetScalingStateAudit === 'function') {
      window.resetScalingStateAudit();
    } else if (scalingDebug?.resetScalingStateAudit) {
      scalingDebug.resetScalingStateAudit();
    }
  });
}

async function clearIterationTelemetry(page) {
  await evaluateOnPage(page, () => {
    const telemetry = window.__quadDebug?.scalingTelemetry;
    telemetry?.clear?.();
  });
}

async function captureTelemetry(page) {
  return evaluateOnPage(page, () => {
    const telemetry = window.__quadDebug?.scalingTelemetry;
    return telemetry?.getBuffer?.() || [];
  });
}

async function captureAudit(page) {
  return evaluateOnPage(page, () => {
    if (!window.scalingStateAudit) return null;
    try {
      return JSON.parse(JSON.stringify(window.scalingStateAudit));
    } catch (error) {
      return {
        totalChecks: window.scalingStateAudit.totalChecks,
        mismatchCount: window.scalingStateAudit.mismatchCount,
        lastMismatchDelta: window.scalingStateAudit.lastMismatchDelta,
        lastMismatchDetail: window.scalingStateAudit.lastMismatchDetail,
        lastCheckTimestamp: window.scalingStateAudit.lastCheckTimestamp,
        lastCheckReason: window.scalingStateAudit.lastCheckReason,
        lastExpectedMaxAllowed: window.scalingStateAudit.lastExpectedMaxAllowed,
        lastObservedMaxAllowed: window.scalingStateAudit.lastObservedMaxAllowed,
        lastReason: window.scalingStateAudit.lastReason,
        reasonCounts: { ...(window.scalingStateAudit.reasonCounts || {}) }
      };
    }
  });
}

async function captureCoordinatorDebug(page) {
  return evaluateOnPage(page, () => {
    const coordinator = window.scalingCoordinator;
    if (!coordinator) return null;
    return coordinator.getDebugInfo?.() || null;
  });
}

function summarizeTelemetry(events) {
  const summary = {
    counts: {},
    durationStats: { count: 0, min: null, max: null, avg: null, p95: null },
    queue: {
      maxLength: 0,
      lastDurationMs: null,
      processed: null,
      failed: null,
      enqueued: null
    },
    errors: []
  };

  if (!Array.isArray(events)) {
    return summary;
  }

  const durationSamples = [];

  for (const event of events) {
    if (!event || !event.phase) continue;
    summary.counts[event.phase] = (summary.counts[event.phase] || 0) + 1;

    if (event.metrics) {
      if (typeof event.metrics.maxQueueLength === 'number') {
        summary.queue.maxLength = Math.max(summary.queue.maxLength, event.metrics.maxQueueLength);
      }
      if (typeof event.metrics.lastDurationMs === 'number') {
        summary.queue.lastDurationMs = event.metrics.lastDurationMs;
      }
      if (typeof event.metrics.processed === 'number') {
        summary.queue.processed = event.metrics.processed;
      }
      if (typeof event.metrics.failed === 'number') {
        summary.queue.failed = event.metrics.failed;
      }
      if (typeof event.metrics.enqueued === 'number') {
        summary.queue.enqueued = event.metrics.enqueued;
      }
    }

    if (event.phase === 'fail' && event.error) {
      summary.errors.push(event.error);
    }

    if (event.operation && typeof event.operation.durationMs === 'number') {
      durationSamples.push(event.operation.durationMs);
    }
  }

  summary.durationStats = computeStats(durationSamples);
  return summary;
}

function summarizeOperationDurations(operations) {
  const durations = operations
    .filter((entry) => typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs))
    .map((entry) => entry.durationMs);
  return computeStats(durations);
}

function accumulateReasonCounts(target, counts) {
  if (!counts || typeof counts !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(counts)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    target[key] = (target[key] || 0) + numeric;
  }
}

function summarizeReasonCounts(results, finalAudit) {
  const summary = {};

  if (Array.isArray(results)) {
    for (const entry of results) {
      accumulateReasonCounts(summary, entry?.auditSnapshot?.reasonCounts);
    }
  }

  accumulateReasonCounts(summary, finalAudit?.reasonCounts);

  return summary;
}

async function performScale(page, { percent, priority, iterationIndex, operationIndex }) {
  return evaluateOnPage(page, async (payload) => {
    const {
      percent: rawPercent,
      priority: desiredPriority,
      iterationIndex: iter,
      operationIndex: op
    } = payload || {};

    const coordinatorEnabled = !!window.__USE_SCALING_COORDINATOR;
    const bridgeApply = typeof window.applyGlobalScale === 'function'
      ? window.applyGlobalScale
      : window.__quadDebug?.scalingUtils?.applyGlobalScale;
    const legacyApply = typeof window.legacyApplyGlobalScale === 'function'
      ? window.legacyApplyGlobalScale
      : window.__quadDebug?.scalingUtils?.legacyApplyGlobalScale;

    const metadata = {
      trigger: 'scaling-state-ab',
      iteration: iter,
      operation: op
    };

    const options = {
      priority: desiredPriority,
      metadata
    };

    const start = performance.now();
    let success = true;
    let errorMessage = null;

    try {
      if (coordinatorEnabled && typeof bridgeApply === 'function') {
        await bridgeApply(rawPercent, options);
      } else if (typeof legacyApply === 'function') {
        legacyApply(rawPercent);
      } else {
        throw new Error('Scaling bridges unavailable');
      }
    } catch (error) {
      success = false;
      errorMessage = error?.message || String(error);
    }

    const durationMs = performance.now() - start;

    return {
      success,
      errorMessage,
      durationMs,
      usedCoordinator: coordinatorEnabled
    };
  }, { percent, priority, iterationIndex, operationIndex });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rng = createSeededRng(options.seed);
  const artifactDir = path.resolve(options.artifactDir);
  await ensureDir(artifactDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const projectRoot = process.cwd();
  const results = [];

  try {
    await page.goto(`file://${path.join(projectRoot, 'index.html')}`);
    await page.waitForSelector('#scaleAllInput', { timeout: 20000 });

    await toggleFlags(page, {
      enableState: options.enableState,
      enableCoordinator: options.enableCoordinator
    });

    await resetHarnessState(page);

    const initialAudit = await captureAudit(page);

    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      await clearIterationTelemetry(page);

      const operations = [];

      for (let opIndex = 0; opIndex < options.sequence; opIndex += 1) {
        const percent = pickPercent(rng, options.minPercent, options.maxPercent);
        const priority = rng() < options.highPriorityRate ? 'high' : 'normal';

        const outcome = await performScale(page, {
          percent,
          priority,
          iterationIndex: iteration,
          operationIndex: opIndex
        });

        operations.push({
          index: opIndex,
          percent,
          priority,
          ...outcome
        });

        if (!outcome.success) {
          console.warn(`Operation ${iteration}:${opIndex} failed:`, outcome.errorMessage);
        }
      }

      const telemetry = await captureTelemetry(page);
      const auditSnapshot = await captureAudit(page);
      const coordinatorDebug = await captureCoordinatorDebug(page);
      const currentScale = await evaluateOnPage(page, () => {
        const getter = typeof window.getCurrentScale === 'function'
          ? window.getCurrentScale
          : window.__quadDebug?.scalingUtils?.getCurrentScale;
        return typeof getter === 'function' ? getter() : null;
      });

      const telemetrySummary = summarizeTelemetry(telemetry);
      const operationDurationStats = summarizeOperationDurations(operations);

      results.push({
        iteration,
        operations,
        telemetrySummary,
        telemetry,
        auditSnapshot,
        coordinatorDebug,
        currentScale
      });
    }

    const finalAudit = await captureAudit(page);
    const finalCoordinatorDebug = await captureCoordinatorDebug(page);

    const aggregateDurations = summarizeOperationDurations(results.flatMap((entry) => entry.operations));
    const aggregateTelemetry = summarizeTelemetry(results.flatMap((entry) => entry.telemetry));
    const reasonCountsSummary = summarizeReasonCounts(results, finalAudit);

    const payload = {
      capturedAt: new Date().toISOString(),
      options,
      flagState: {
        coordinatorEnabled: options.enableCoordinator,
        scalingStateEnabled: options.enableState
      },
      initialAudit,
      results,
      aggregateDurations,
      aggregateTelemetry,
      reasonCountsSummary,
      finalAudit,
      finalCoordinatorDebug
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `scaling-state-ab-${timestamp}`;
    const artifactPath = path.join(artifactDir, `${baseName}.json`);
    await fs.writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(`Scaling state metrics captured → ${artifactPath}`);
  } finally {
    await browser.close();
  }
}

export {
  parseArgs,
  summarizeTelemetry,
  summarizeOperationDurations,
  summarizeReasonCounts,
  main
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Scaling state metrics harness failed:', error);
    process.exitCode = 1;
  });
}
