import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

test.describe('Light blocking overlay toggle', () => {
  test('options checkbox toggles light blocking render state', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    const optionsButton = page.locator('#optionsBtn');
    await expect(optionsButton, 'Options button should be visible before interacting').toBeVisible();

    const initialState = await page.evaluate(() => {
      const helper =
        window.isLightBlockingOverlayEnabled ??
        window.__quadDebug?.chartDebug?.isLightBlockingOverlayEnabled;
      return typeof helper === 'function' ? helper() : null;
    });

    expect(initialState ?? false, 'light blocking overlay should be disabled by default').toBe(false);

    await optionsButton.click();

    const optionsModal = page.locator('#optionsModal');
    await expect(optionsModal, 'Options modal should open after clicking trigger').toBeVisible();

    const overlayToggle = page.locator('input#lightBlockingOverlayToggle');
    await expect(overlayToggle, 'Light blocking overlay toggle should be present in options modal').toBeVisible();
    await expect(overlayToggle, 'Light blocking overlay toggle should be unchecked by default').not.toBeChecked();

    await overlayToggle.check();

    await page.waitForFunction(
      () => {
        const helper =
          window.isLightBlockingOverlayEnabled ??
          window.__quadDebug?.chartDebug?.isLightBlockingOverlayEnabled;
        return typeof helper === 'function' && helper() === true;
      },
      undefined,
      { timeout: 3000 },
    );

    const quadPath = resolve('data/P800_K36C26LK25_V6.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    await page.waitForFunction(
      () => {
        const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
        const debug = window.__quadDebug?.chartDebug;
        return (
          !!loaded?.curves &&
          Object.keys(loaded.curves).length > 0 &&
          !!debug?.lastLightBlockingCurve &&
          Array.isArray(debug.lastLightBlockingCurve.curve) &&
          debug.lastLightBlockingCurve.curve.length === 256
        );
      },
      undefined,
      { timeout: 10000 },
    );

    const overlayState = await page.evaluate(() => {
      const debug = window.__quadDebug?.chartDebug;
      return debug?.lastLightBlockingCurve ?? null;
    });

    expect(overlayState?.contributingChannels?.length ?? 0, 'at least one channel should contribute').toBeGreaterThan(0);
    expect(overlayState?.maxValue ?? 0, 'max value should reflect combined ink coverage').toBeGreaterThan(0);

    const normalizedOverlay = await page.evaluate(() => {
      return typeof window.computeLightBlockingCurve === 'function'
        ? window.computeLightBlockingCurve({ normalize: true })
        : null;
    });

    expect(normalizedOverlay?.maxValue ?? 0, 'normalized overlay max should reach 100%').toBeGreaterThan(99);

    mkdirSync(resolve('artifacts/light-blocking'), { recursive: true });
    await page.screenshot({
      path: resolve('artifacts/light-blocking/light-blocking-overlay.png'),
      clip: { x: 160, y: 120, width: 960, height: 600 }
    });

    await overlayToggle.uncheck();

    await page.waitForFunction(
      () => {
        const helper =
          window.isLightBlockingOverlayEnabled ??
          window.__quadDebug?.chartDebug?.isLightBlockingOverlayEnabled;
        const debug = window.__quadDebug?.chartDebug;
        return typeof helper === 'function' && helper() === false && !debug?.lastLightBlockingCurve;
      },
      undefined,
      { timeout: 5000 },
    );

    await expect(overlayToggle, 'Light blocking overlay toggle should reflect unchecked state').not.toBeChecked();
  });
});
