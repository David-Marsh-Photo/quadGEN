import { chromium } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const LAB_PATH = resolve('data/TRIFORCE.txt');
const QUAD_PATH = resolve('data/TRIFORCE_V4.quad');

async function waitForAppReady(page) {
  await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
  await page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' });
  await page.waitForFunction(() => typeof window.LinearizationState !== 'undefined', null, { timeout: 15000 });
}

async function sampleMake256(page, applyLinearization) {
  return page.evaluate(({ applyLinearization }) => {
    const end = 65535;
    const channel = 'K';
    if (typeof window.make256 !== 'function') return null;
    const arr = window.make256(end, channel, applyLinearization);
    if (!Array.isArray(arr)) return null;
    return {
      first: arr[0],
      mid: arr[Math.floor(arr.length / 2)],
      last: arr[arr.length - 1]
    };
  }, { applyLinearization });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = window.getLoadedQuadData?.();
      return !!(data && data.curves && data.curves.K && data.curves.K.length === 256);
    }, null, { timeout: 20000 });

    console.log('Baseline make256 (no correction):', await sampleMake256(page, false));
    console.log('Baseline make256 (apply=true):', await sampleMake256(page, true));

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(() => !!window.LinearizationState?.globalApplied, null, { timeout: 20000 });
    await page.waitForTimeout(1000);

    console.log('After load make256 (apply=true):', await sampleMake256(page, true));

    await page.evaluate(() => {
      const toggle = document.getElementById('globalLinearizationToggle');
      if (!toggle) throw new Error('toggle not found');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    console.log('After toggle off make256 (apply=true):', await sampleMake256(page, true));

    await page.evaluate(() => {
      const toggle = document.getElementById('globalLinearizationToggle');
      if (!toggle) throw new Error('toggle not found');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    console.log('After toggle on make256 (apply=true):', await sampleMake256(page, true));
  } finally {
    await browser.close();
  }
})();
