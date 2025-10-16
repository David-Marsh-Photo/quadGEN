import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const LAB_SMOOTHING_STORAGE_KEY = 'quadgen.labSmoothingPercent';

async function waitForOptionsReady(page) {
  await Promise.all([
    page.waitForSelector('#labSmoothingPercentSlider', { state: 'attached', timeout: 15000 }),
    page.waitForSelector('#plotSmoothingPercentSlider', { state: 'attached', timeout: 15000 })
  ]);
}

test.describe('Options smoothing defaults', () => {
  test('initial load starts all smoothing sliders at 0%', async ({ page }) => {
    await page.addInitScript((storageKey) => {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore storage failures (private mode, etc.) */
      }
    }, LAB_SMOOTHING_STORAGE_KEY);

    await page.goto(INDEX_URL);
    await waitForOptionsReady(page);

    const labSliderValue = await page.$eval('#labSmoothingPercentSlider', (input: HTMLInputElement) => input.value);
    const labLabelText = await page.$eval('#labSmoothingPercentValue', (node) => node.textContent?.trim() ?? '');

    expect(labSliderValue).toBe('0');
    expect(labLabelText.startsWith('0%')).toBeTruthy();
    expect(labLabelText).toContain('×1.00');

    const plotSliderValue = await page.$eval('#plotSmoothingPercentSlider', (input: HTMLInputElement) => input.value);
    const plotLabelText = await page.$eval('#plotSmoothingPercentValue', (node) => node.textContent?.trim() ?? '');

    expect(plotSliderValue).toBe('0');
    expect(plotLabelText.startsWith('0%')).toBeTruthy();
    expect(plotLabelText).toContain('×1.00');

    const debugLabPercent = await page.evaluate(() => window.__quadDebug?.labSettings?.getLabSmoothingPercent?.());
    const debugPlotPercent = await page.evaluate(() => window.__quadDebug?.compat?.stateManager?.getStateManager?.()?.getState?.().app?.plotSmoothingPercent ?? null);

    expect(debugLabPercent).toBe(0);
    if (debugPlotPercent != null) {
      expect(Math.round(debugPlotPercent)).toBe(0);
    }
  });
});
