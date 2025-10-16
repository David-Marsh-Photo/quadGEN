#!/usr/bin/env node

/**
 * Captures a screenshot showing that the saved zoom preference is restored
 * after loading a 100% dataset and returning to the blank canvas.
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const MK50_QUAD = resolve('data/P700-P900_MK50.quad');
const MK100_QUAD = resolve('data/P700-P900_MK100-3.quad');
const LAB_PATH = resolve('testdata/lab_banded_shadow.txt');
const SCREENSHOT_PATH = resolve('artifacts/zoom-preference-restored.png');

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

async function waitForZoom(page, percent) {
  await page.waitForFunction(
    (expected) => {
      const compat = window.__quadDebug?.compat;
      return compat?.chartManager?.getChartZoomPercent?.() === expected;
    },
    percent,
    { timeout: 20000 }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    await page.setInputFiles('#quadFile', MK50_QUAD);
    await page.waitForFunction(
      () => {
        const rows = Array.from(document.querySelectorAll('#rows tr[data-channel]'));
        if (!rows.length) return false;
        return rows.some((row) => {
          const percentInput = row.querySelector('.percent-input');
          if (!percentInput) return false;
          const numeric = parseFloat(percentInput.value);
          return Number.isFinite(numeric) && Math.round(numeric) === 50;
        });
      },
      null,
      { timeout: 20000 }
    );

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('#chartZoomInBtn');
        return !!btn && !btn.disabled;
      },
      null,
      { timeout: 10000 }
    );

    await page.click('#chartZoomInBtn');
    await waitForZoom(page, 90);
    await page.click('#chartZoomInBtn');
    await waitForZoom(page, 80);

    await page.setInputFiles('#quadFile', MK100_QUAD);
    await page.waitForFunction(
      () => !!document.querySelector('#rows tr[data-channel]'),
      null,
      { timeout: 20000 }
    );

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await waitForZoom(page, 90);

    await page.reload();
    await waitForAppReady(page);
    await waitForZoom(page, 80);

    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: true
    });

    console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

