import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { openGlobalCorrectionTab } from '../utils/history-helpers';

async function setLabSmoothing(page, percent: number) {
  const slider = page.locator('#labSmoothingPercentSlider');
  await slider.evaluate((element, value) => {
    (element as HTMLInputElement).value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, percent);
  await expect(page.locator('#labSmoothingPercentValue')).toContainText(`${percent}%`);
}

async function correctedCurves(page) {
  return page.evaluate(() => {
    const curves = window.LinearizationState?.getGlobalCorrectedCurves?.() || {};
    return Object.fromEntries(
      Object.entries(curves)
        .filter(([, curve]) => Array.isArray(curve))
        .map(([channel, curve]) => [channel, Array.from(curve as number[])])
    );
  });
}

function maxDelta(left: Record<string, number[]>, right: Record<string, number[]>) {
  let maximum = 0;
  for (const [channel, leftCurve] of Object.entries(left)) {
    const rightCurve = right[channel];
    if (!Array.isArray(rightCurve) || rightCurve.length !== leftCurve.length) continue;
    leftCurve.forEach((value, index) => {
      maximum = Math.max(maximum, Math.abs(value - rightCurve[index]));
    });
  }
  return maximum;
}

test('LAB smoothing changes corrected curves and resets cleanly', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await openGlobalCorrectionTab(page);
  await page.setInputFiles('#quadFile', resolve('data/TRIFORCE_V4.quad'));
  await page.setInputFiles('#linearizationFile', resolve('data/TRIFORCE_V4.txt'));
  await page.waitForFunction(() => {
    const curves = window.LinearizationState?.getGlobalCorrectedCurves?.();
    return window.LinearizationState?.globalApplied === true && Array.isArray(curves?.K);
  });

  const baseline = await correctedCurves(page);
  await setLabSmoothing(page, 300);
  await expect.poll(async () => maxDelta(baseline, await correctedCurves(page))).toBeGreaterThan(50);

  await setLabSmoothing(page, 0);
  await expect.poll(async () => maxDelta(baseline, await correctedCurves(page))).toBeLessThanOrEqual(1);
});
