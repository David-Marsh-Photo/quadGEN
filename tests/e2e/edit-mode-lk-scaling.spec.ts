import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// Guard bug: LK end value should increase when percent is raised after toggling Edit Mode
const EXPECTED_END_FROM_37 = Math.round((37 / 100) * 65535);

test.describe('Edit Mode LK scaling', () => {
  test('LK percent increase raises end value after toggling edit mode', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn');

    const quadPath = resolve('data/P800_K37_C26_LK25_V1.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    await page.waitForFunction(
      () => Array.isArray(window.loadedQuadData?.channels) && window.loadedQuadData.channels.includes('LK'),
      undefined,
      { timeout: 15000 },
    );

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => !window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    const lkPercentInput = page.locator('tr.channel-row[data-channel="LK"] .percent-input');
    await expect(lkPercentInput).toHaveValue(/24\.9/);

    await lkPercentInput.fill('37');
    await lkPercentInput.press('Enter');

    await page.waitForFunction(
      () => {
        const manager = window.getStateManager?.();
        const percent = manager?.get('printer.channelValues.LK.percentage');
        return Math.abs((percent ?? 0) - 37) < 0.01;
      },
      undefined,
      { timeout: 5000 },
    );

    const { endValue, maxOutput } = await page.evaluate(() => {
      const stateManager = window.getStateManager?.();
      const end = stateManager?.get('printer.channelValues.LK.endValue') ?? null;
      const points = window.ControlPoints?.get('LK')?.points || [];
      const max = points.reduce((acc, point) => Math.max(acc, point?.output ?? 0), 0);
      return { endValue: end, maxOutput: max };
    });

    expect(endValue).toBe(EXPECTED_END_FROM_37);
    expect(maxOutput).toBeGreaterThan(36.9);
  });
});
