import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Correction overlay options toggle', () => {
  test('options checkbox toggles correction overlay state', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    const optionsButton = page.locator('#optionsBtn');
    await expect(optionsButton, 'Options button should be visible before interacting').toBeVisible();

    const initialState = await page.evaluate(() => {
      const helper =
        window.isChartDebugShowCorrectionTarget ??
        window.__quadDebug?.chartDebug?.isShowCorrectionTargetEnabled;
      return typeof helper === 'function' ? helper() : null;
    });

    expect(initialState ?? false, 'correction overlay should be enabled by default').toBe(true);

    await optionsButton.click();

    const optionsModal = page.locator('#optionsModal');
    await expect(optionsModal, 'Options modal should open after clicking trigger').toBeVisible();

    const overlayToggle = page.locator('input#correctionOverlayToggle');
    await expect(overlayToggle, 'Correction overlay toggle should be present in options modal').toBeVisible();
    await expect(overlayToggle, 'Correction overlay toggle should be checked by default').toBeChecked();

    const labPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.setInputFiles('input#linearizationFile', labPath);

    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      undefined,
      { timeout: 15000 },
    );

    await overlayToggle.uncheck();

    await page.waitForFunction(
      () => {
        const helper =
          window.isChartDebugShowCorrectionTarget ??
          window.__quadDebug?.chartDebug?.isShowCorrectionTargetEnabled;
        return typeof helper === 'function' && helper() === false;
      },
      undefined,
      { timeout: 3000 },
    );

    const overlayState = await page.evaluate(() => {
      const debug = window.__quadDebug?.chartDebug;
      return debug?.lastCorrectionOverlay ?? null;
    });

    expect(overlayState, 'chart debug state should clear overlay metadata once disabled').toBeNull();

    await expect(overlayToggle, 'Correction overlay toggle should reflect unchecked state').not.toBeChecked();

    await overlayToggle.check();

    await page.waitForFunction(
      () => {
        const helper =
          window.isChartDebugShowCorrectionTarget ??
          window.__quadDebug?.chartDebug?.isShowCorrectionTargetEnabled;
        const debug = window.__quadDebug?.chartDebug;
        return typeof helper === 'function' && helper() === true && !!debug?.lastCorrectionOverlay;
      },
      undefined,
      { timeout: 5000 },
    );

    const finalState = await page.evaluate(() => {
      const helper =
        window.isChartDebugShowCorrectionTarget ??
        window.__quadDebug?.chartDebug?.isShowCorrectionTargetEnabled;
      return typeof helper === 'function' ? helper() : null;
    });

    expect(finalState, 'correction overlay should be enabled after rechecking').toBe(true);

    const overlayStateEnabled = await page.evaluate(() => {
      const debug = window.__quadDebug?.chartDebug;
      return debug?.lastCorrectionOverlay ?? null;
    });

    expect(overlayStateEnabled, 'chart debug state should capture overlay metadata when enabled').not.toBeNull();
    expect(overlayStateEnabled?.baseline?.color, 'baseline overlay should use the purple guide color').toBe('#a855f7');
    expect(overlayStateEnabled?.baseline?.points?.[1]?.output, 'baseline endpoint should reflect effective ink ceiling').toBeCloseTo(
      overlayStateEnabled?.effectiveMaxPercent ?? 100,
      3,
    );

    await page.screenshot({ path: 'artifacts/options-correction-overlay-default.png', fullPage: true });
  });
});
