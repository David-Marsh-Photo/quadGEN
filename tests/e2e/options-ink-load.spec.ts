import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Options ink-load overlay', () => {
  test('exposes ink-load controls and overlay telemetry', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(
      () => {
        const rows = (window as any).elements?.rows?.children;
        return !!rows && rows.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    await page.click('#optionsBtn');

    const toggle = page.locator('#inkLoadOverlayToggle');
    await expect(toggle).toBeVisible();

    const thresholdInput = page.locator('#inkLoadThresholdInput');
    await expect(thresholdInput).toBeVisible();
    await expect(thresholdInput).toHaveValue('25');

    await toggle.check();

    await page.waitForFunction(() => {
      const debug = (window as any).__quadDebug?.chartDebug;
      const overlay = debug?.lastInkLoadOverlay;
      return (
        overlay &&
        Array.isArray(overlay.curve) &&
        overlay.curve.length === 256 &&
        Number.isFinite(overlay.maxValue)
      );
    });

    const overlay = await page.evaluate(() => {
      const debug = (window as any).__quadDebug?.chartDebug;
      return debug?.lastInkLoadOverlay ?? null;
    });

    expect(overlay).not.toBeNull();
    expect(overlay.curve.length).toBe(256);
    expect(overlay.threshold).toBe(25);
    expect(Number.isFinite(overlay.maxValue)).toBe(true);

    await thresholdInput.fill('60');
    await thresholdInput.press('Enter');

    await page.waitForFunction(() => {
      const overlay = (window as any).__quadDebug?.chartDebug?.lastInkLoadOverlay;
      return overlay && overlay.threshold === 60;
    });
  });
});
