#!/usr/bin/env node

/**
 * Composite redistribution diagnostics
 *
 * Loads representative multi-ink .quad + LAB pairs twice:
 *   1. Composite redistribution disabled (baseline)
 *   2. Composite redistribution enabled
 *
 * Collects total ink sums, per-channel maxima, warning counts, and amplitude ratios.
 * Outputs JSON summary to STDOUT for quick comparison.
 */

const { chromium } = require('playwright');
const { resolve } = require('path');
const { existsSync } = require('fs');

const DATASETS = [
  { name: 'TRIFORCE_V2', quad: 'data/TRIFORCE_V2.quad', lab: 'data/TRIFORCE_V2.txt' },
  { name: 'TRIFORCE_V3', quad: 'data/TRIFORCE_V3.quad', lab: 'data/TRIFORCE_V3.txt' },
  { name: 'TRIFORCE_V4', quad: 'data/TRIFORCE_V4.quad', lab: 'data/TRIFORCE_V4.txt' }
];

function fileUrl(localPath) {
  return 'file://' + resolve(localPath);
}

async function waitForCurves(page) {
  await page.waitForFunction(() => {
    const data = window.getLoadedQuadData?.();
    if (!data?.curves) return false;
    return Object.values(data.curves).some((arr) => Array.isArray(arr) && arr.length === 256);
  }, null, { timeout: 20000 });
}

async function loadScenario(page, dataset, enabled) {
  await page.goto(fileUrl('index.html'));
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
  await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
  await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });

  await page.evaluate((flag) => {
    window.enableCompositeLabRedistribution?.(flag);
  }, enabled);

  await page.setInputFiles('#quadFile', resolve(dataset.quad));
  await waitForCurves(page);

  await page.setInputFiles('#linearizationFile', resolve(dataset.lab));
  await page.waitForTimeout(4000);
  await waitForCurves(page);

  return page.evaluate(() => {
    const data = window.getLoadedQuadData?.();
    const warnings = window.LinearizationState?.getGlobalWarnings?.() || [];
    const totals = new Array(256).fill(0);
    const perChannel = {};

    Object.entries(data?.curves || {}).forEach(([name, arr]) => {
      if (!Array.isArray(arr)) return;
      let max = 0;
      let sum = 0;
      arr.forEach((value, index) => {
        const ink = Number(value) || 0;
        totals[index] += ink;
        if (ink > max) max = ink;
        sum += ink;
      });
      perChannel[name] = { max, sum };
    });

    const totalMax = totals.reduce((m, v) => (v > m ? v : m), 0);
    const totalAvg = totals.reduce((s, v) => s + v, 0) / (totals.length || 1);

    return {
      warnings,
      perChannel,
      totals,
      totalMax,
      totalAvg
    };
  });
}

async function main() {
  for (const dataset of DATASETS) {
    if (!existsSync(dataset.quad) || !existsSync(dataset.lab)) {
      throw new Error(`Missing dataset files for ${dataset.name}`);
    }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const results = [];

  for (const dataset of DATASETS) {
    const baseline = await loadScenario(page, dataset, false);
    const composite = await loadScenario(page, dataset, true);

    const ratios = baseline.totals.map((base, index) => {
      const comp = composite.totals[index] ?? 0;
      if (base < 1 && comp < 1) return 1;
      if (base < 1 && comp >= 1) return Number.POSITIVE_INFINITY;
      return comp / base;
    }).filter((value) => Number.isFinite(value));

    const ratioMin = Math.min(...ratios);
    const ratioMax = Math.max(...ratios);
    const ratioAvg = ratios.reduce((sum, value) => sum + value, 0) / (ratios.length || 1);

    results.push({
      dataset: dataset.name,
      baseline: {
        warnings: baseline.warnings,
        totalMax: baseline.totalMax,
        totalAvg: baseline.totalAvg
      },
      composite: {
        warnings: composite.warnings,
        totalMax: composite.totalMax,
        totalAvg: composite.totalAvg
      },
      ratios: {
        min: ratioMin,
        max: ratioMax,
        avg: ratioAvg
      }
    });
  }

  await browser.close();

  console.log(JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
