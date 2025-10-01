import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Legacy global exports', () => {
  test('does not expose deprecated debug helpers on window', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;

    await page.goto(indexUrl);
    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    const legacyGlobals = await page.evaluate(() => ({
      quadGenDebug: typeof window.quadGenDebug,
      hasCompareKeyPoints: typeof window.quadGenDebug?.compareKeyPointsToPlot,
    }));

    expect(legacyGlobals.quadGenDebug).toBe('undefined');
    expect(legacyGlobals.hasCompareKeyPoints).toBe('undefined');
  });
});
