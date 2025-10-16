#!/usr/bin/env node

/**
 * Diagnostic script to capture the initial chart zoom state
 * without interacting with the UI. Outputs the computed zoom
 * percentage, zoom index, and highest active channel percent.
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;

async function waitForAppReady(page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);

  await page.waitForFunction(
    () => !!(window.ControlPoints && typeof window.ControlPoints.get === 'function'),
    null,
    { timeout: 20000 }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    const diagnostic = await page.evaluate(() => {
      const compat = window.__quadDebug?.compat;
      const zoomPercent = compat?.chartManager?.getChartZoomPercent
        ? compat.chartManager.getChartZoomPercent()
        : null;
      const zoomIndex = compat?.chartManager?.getChartZoomIndex
        ? compat.chartManager.getChartZoomIndex()
        : null;
      const minZoomIndex = compat?.chartManager?.getMinimumAllowedZoomIndex
        ? compat.chartManager.getMinimumAllowedZoomIndex()
        : null;
      const highestActive = compat?.chartManager?.__test?.getHighestActivePercent
        ? compat.chartManager.__test.getHighestActivePercent()
        : null;

      return {
        zoomPercent,
        zoomIndex,
        minZoomIndex,
        highestActive
      };
    });

    console.log(JSON.stringify(diagnostic, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

