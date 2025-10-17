import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { pathToFileURL } from 'url';

test.describe('LAB spot marker overlay', () => {
  test('renders tolerance badges and directional markers for LAB measurements', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    const optionsButton = page.locator('#optionsBtn');
    await expect(optionsButton, 'options button should be visible before opening overlay toggles').toBeVisible();

    await optionsButton.click();

    const optionsModal = page.locator('#optionsModal');
    await expect(optionsModal, 'options modal should appear after clicking the trigger').toBeVisible();

    const overlayToggle = page.locator('input#labSpotMarkersToggle');
    await expect(overlayToggle, 'spot marker toggle should be present in the overlays section').toBeVisible();
    await expect(overlayToggle, 'spot marker toggle should be disabled until LAB data is active').toBeDisabled();

    const quadPath = resolve('data/P800_K36C26LK25_V19.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    const labPath = resolve('data/P800_K36C26LK25_V19.txt');
    await page.setInputFiles('input#linearizationFile', labPath);

    await expect(overlayToggle, 'spot marker toggle should enable after LAB data loads').toBeEnabled({ timeout: 10000 });

    await overlayToggle.check();

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        return !!helpers?.isLabSpotMarkerOverlayEnabled?.() && helpers.isLabSpotMarkerOverlayEnabled();
      },
      undefined,
      { timeout: 3000 },
    );

    const readMarkers = async () => page.evaluate(() => {
      const helpers = window.__quadDebug?.chartDebug;
      return helpers?.getLabSpotMarkers?.() ?? null;
    });

    const markers = await readMarkers();
    expect(Array.isArray(markers)).toBe(true);
    expect(markers!.some((marker) => marker.action === 'darken')).toBe(true);
    expect(markers!.some((marker) => marker.action === 'lighten')).toBe(true);

    const initialRailY = markers![0].canvasY;
    expect(Number.isFinite(initialRailY)).toBe(true);

    await page.evaluate(() => {
      window.__quadDebug?.chartDebug?.setCorrectionGainPercent?.(0);
    });

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        return helpers?.getCorrectionGainPercent?.() === 0;
      },
      undefined,
      { timeout: 3000 },
    );

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        const currentMarkers = helpers?.getLabSpotMarkers?.();
        return Array.isArray(currentMarkers) && currentMarkers.length > 0;
      },
      undefined,
      { timeout: 3000 },
    );

    const zeroGainMarkers = await readMarkers();
    expect(zeroGainMarkers!.every((marker: any) => marker.action === 'within')).toBe(true);

    await page.evaluate(() => {
      window.__quadDebug?.chartDebug?.setCorrectionGainPercent?.(100);
    });

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        return helpers?.getCorrectionGainPercent?.() === 100;
      },
      undefined,
      { timeout: 3000 },
    );

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        const currentMarkers = helpers?.getLabSpotMarkers?.();
        return Array.isArray(currentMarkers) && currentMarkers.some((marker) => marker?.action !== 'within');
      },
      undefined,
      { timeout: 3000 },
    );

    await page.evaluate(() => {
      window.__quadDebug?.compat?.chartManager?.setChartZoomPercent?.(60, { persist: false, refresh: true });
    });

    await page.waitForFunction(
      () => {
        const compat = window.__quadDebug?.compat?.chartManager;
        return compat?.getChartZoomPercent?.() === 60;
      },
      undefined,
      { timeout: 3000 },
    );

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        const currentMarkers = helpers?.getLabSpotMarkers?.();
        return Array.isArray(currentMarkers) && currentMarkers.length > 0;
      },
      undefined,
      { timeout: 3000 },
    );

    const zoomedMarkers = await readMarkers();
    expect(Array.isArray(zoomedMarkers)).toBe(true);
    const zoomedRailY = zoomedMarkers![0].canvasY;
    expect(Number.isFinite(zoomedRailY)).toBe(true);
    expect(Math.abs(zoomedRailY - initialRailY)).toBeLessThan(2);

    await page.evaluate(() => {
      window.__quadDebug?.compat?.chartManager?.setChartZoomPercent?.(100, { persist: false, refresh: true });
    });

    await page.waitForFunction(
      () => {
        const compat = window.__quadDebug?.compat?.chartManager;
        return compat?.getChartZoomPercent?.() === 100;
      },
      undefined,
      { timeout: 3000 },
    );

    await page.waitForFunction(
      () => {
        const helpers = window.__quadDebug?.chartDebug;
        const currentMarkers = helpers?.getLabSpotMarkers?.();
        return Array.isArray(currentMarkers) && currentMarkers.length > 0;
      },
      undefined,
      { timeout: 3000 },
    );

    mkdirSync(resolve('artifacts/spot-markers'), { recursive: true });
    await page.screenshot({
      path: resolve('artifacts/spot-markers/lab-spot-markers-overlay.png'),
      clip: { x: 160, y: 120, width: 960, height: 600 },
    });
  });
});
