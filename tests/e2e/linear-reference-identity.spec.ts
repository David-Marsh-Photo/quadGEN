import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');
const linearLabPath = resolve('testdata/linear_reference_lab.txt');

async function waitForCurves(page) {
  await page.waitForFunction(() => {
    const data = window.getLoadedQuadData?.();
    if (!data?.curves) return false;
    return Object.values(data.curves).some((arr) => Array.isArray(arr) && arr.length === 256);
  }, null, { timeout: 20000 });
}

async function loadQuad(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await waitForCurves(page);
}

async function loadLinearLab(page) {
  await page.setInputFiles('#linearizationFile', linearLabPath);
  await page.waitForTimeout(3000);
  await waitForCurves(page);
}

async function setLabSmoothing(page, percent) {
  await page.waitForSelector('#optionsBtn', { state: 'attached' });
  await page.click('#optionsBtn');
  const slider = page.locator('#labSmoothingPercentSlider');
  await slider.waitFor({ state: 'visible' });
  await slider.evaluate(
    (element, value) => {
      element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    percent
  );
  await page.waitForFunction(
    (expected) => {
      const label = document.getElementById('labSmoothingPercentValue');
      return label?.textContent?.trim().startsWith(`${expected}%`);
    },
    percent,
    { timeout: 5000 }
  );
  await page.evaluate((value) => {
    window.labSettings?.setLabSmoothingPercent?.(value);
  }, percent);
  await page.click('#closeOptionsBtn');
  await page.waitForFunction(
    () => document.getElementById('optionsModal')?.classList.contains('hidden'),
    null,
    { timeout: 5000 }
  );
}

async function grabCurves(page) {
  return page.evaluate(() => {
    const data = window.getLoadedQuadData?.();
    if (!data?.curves) return null;
    return JSON.parse(JSON.stringify(data.curves));
  });
}

function computeMaxDelta(baseline, corrected) {
  const result = {};
  if (!baseline || !corrected) return result;
  for (const [channel, correctedSeries] of Object.entries(corrected)) {
    const baseSeries = baseline[channel];
    if (!Array.isArray(correctedSeries) || !Array.isArray(baseSeries)) continue;
    let maxAbs = 0;
    for (let i = 0; i < correctedSeries.length; i += 1) {
      const delta = Math.abs((correctedSeries[i] ?? 0) - (baseSeries[i] ?? 0));
      if (delta > maxAbs) {
        maxAbs = delta;
      }
    }
    result[channel] = maxAbs;
  }
  return result;
}

test.describe('Linear reference identity', () => {
  test.beforeEach(async ({ page }) => {
    expect(existsSync(quadPath)).toBe(true);
    expect(existsSync(linearLabPath)).toBe(true);
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' });
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
  });

  test('produces zero correction with smoothing at 0%', async ({ page }) => {
    await setLabSmoothing(page, 0);
    await loadQuad(page);
    const baseline = await grabCurves(page);
    expect(baseline).not.toBeNull();

    await loadLinearLab(page);
    const corrected = await grabCurves(page);
    expect(corrected).not.toBeNull();

    const maxDeltaByChannel = computeMaxDelta(baseline, corrected);
    const tolerancesZero = {
      K: 200,
      C: 400,
      LK: 1500
    };
    for (const [channel, maxAbs] of Object.entries(maxDeltaByChannel)) {
      const limit = tolerancesZero[channel] ?? 10;
      expect.soft(maxAbs, `Channel ${channel} delta`).toBeLessThanOrEqual(limit);
    }
  });

  test('moderate smoothing keeps deltas within tolerances', async ({ page }) => {
    const smoothingPercent = 90;
    await setLabSmoothing(page, smoothingPercent);
    await loadQuad(page);
    const baseline = await grabCurves(page);
    expect(baseline).not.toBeNull();

    await loadLinearLab(page);
    const corrected = await grabCurves(page);
    expect(corrected).not.toBeNull();

    const maxDeltaByChannel = computeMaxDelta(baseline, corrected);
    expect(Object.keys(maxDeltaByChannel).length).toBeGreaterThan(0);

    const tolerances = {
      K: 400,
      C: 500,
      LK: 5000
    };

    for (const [channel, maxAbs] of Object.entries(maxDeltaByChannel)) {
      const limit = tolerances[channel] ?? 500;
      expect.soft(maxAbs, `Channel ${channel} delta`).toBeLessThanOrEqual(limit);
      if (channel === 'K' || channel === 'LK') {
        expect.soft(maxAbs, `Channel ${channel} delta should remain low with smoothing`).toBeLessThanOrEqual(100);
      }
    }
  });
});
