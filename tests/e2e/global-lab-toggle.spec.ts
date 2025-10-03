import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Global LAB toggle', () => {
  test('enabling and disabling global correction updates application state', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn');

    const quadPath = resolve('data/P800_K37_C26_LK25_V1.quad');
    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(
      () => window.loadedQuadData?.channels?.includes?.('LK'),
      undefined,
      { timeout: 15000 },
    );

    const labPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.setInputFiles('input#linearizationFile', labPath);

    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      undefined,
      { timeout: 15000 },
    );

    const toggleSlider = page.locator('label.slider-toggle span.slider').first();
    await toggleSlider.click();

    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === false,
      undefined,
      { timeout: 5000 },
    );

    await toggleSlider.click();

    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      undefined,
      { timeout: 5000 },
    );

    const finalState = await page.evaluate(() => ({
      enabled: window.LinearizationState?.globalApplied ?? null,
      checkbox: document.getElementById('globalLinearizationToggle')?.checked ?? null,
    }));

    expect(finalState).toEqual({ enabled: true, checkbox: true });
  });
});
