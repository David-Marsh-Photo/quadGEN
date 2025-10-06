#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const ARTIFACT_DIR = path.resolve('artifacts/scaling-coordinator-ai');

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

async function callAICommand(page, scalePercent) {
  return page.evaluate(async (percent) => {
    if (!window.chatInterface) {
      window.chatInterface = {};
    }
    if (!window.chatInterface.quadGenActions) {
      window.chatInterface.quadGenActions = window.__quadDebug?.compat?.quadGenActions;
    }
    const quadActions = window.chatInterface.quadGenActions;
    if (!quadActions || typeof quadActions.scaleChannelEndsByPercent !== 'function') {
      throw new Error('quadGenActions.scaleChannelEndsByPercent unavailable');
    }
    if (typeof window.chatInterface.executeFunctionCall !== 'function') {
      window.chatInterface.executeFunctionCall = async function ({ name, parameters }) {
        const map = { scale_channel_ends_by_percent: 'scaleChannelEndsByPercent' };
        const method = map[name] || name;
        const fn = this.quadGenActions?.[method];
        if (typeof fn !== 'function') throw new Error(`Function ${method} missing`);
        if (method === 'scaleChannelEndsByPercent') {
          return await fn.call(this.quadGenActions, parameters?.scalePercent ?? parameters);
        }
        return await fn.call(this.quadGenActions, parameters);
      };
    }
    await window.chatInterface.executeFunctionCall({
      name: 'scale_channel_ends_by_percent',
      parameters: { scalePercent: percent }
    }, 'parity test');
  }, scalePercent);
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

    return {
      label: tag,
      capturedAt: new Date().toISOString(),
      scalePercent,
      historySummary
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

    const snapshots = [];
    snapshots.push(await captureState(page, 'initial'));

    const sequence = [90, 110, 70, 95];
    for (const percent of sequence) {
      await callAICommand(page, percent);
      await page.waitForTimeout(200);
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
    sequence: [90, 110, 70, 95],
    legacy: legacyRun.snapshots,
    coordinator: coordinatorRun.snapshots,
    legacyTelemetry: legacyRun.telemetry,
    coordinatorTelemetry: coordinatorRun.telemetry
  };

  const filePath = path.join(ARTIFACT_DIR, `ai-parity-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf8');
  console.log('AI parity artifact written:', filePath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
