import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test('LAB spot-marker overlay shows correction directions', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.locator('#optionsBtn').click();

  const overlayToggle = page.locator('#labSpotMarkersToggle');
  await expect(overlayToggle).toBeVisible();
  await expect(overlayToggle).toBeDisabled();

  await page.setInputFiles('#quadFile', resolve('data/P800_K36C26LK25_V19.quad'));
  await page.setInputFiles('#linearizationFile', resolve('data/P800_K36C26LK25_V19.txt'));

  await expect(overlayToggle).toBeEnabled({ timeout: 10000 });
  await overlayToggle.check();
  await page.waitForFunction(() => {
    const chart = window.__quadDebug?.chartDebug;
    const markers = chart?.getLabSpotMarkers?.();
    return chart?.isLabSpotMarkerOverlayEnabled?.() === true && Array.isArray(markers) && markers.length > 0;
  });

  const markers = await page.evaluate(() => window.__quadDebug?.chartDebug?.getLabSpotMarkers?.() ?? []);
  expect(markers.some((marker: any) => marker.action === 'darken')).toBe(true);
  expect(markers.some((marker: any) => marker.action === 'lighten')).toBe(true);
  expect(markers.every((marker: any) => Number.isFinite(marker.canvasY))).toBe(true);
});
