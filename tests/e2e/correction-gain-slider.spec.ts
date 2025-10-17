import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Correction gain slider', () => {
  test('mixes correction strength and updates overlays', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    const optionsBtn = page.locator('#optionsBtn');
    await expect(optionsBtn).toBeVisible();
    await optionsBtn.click();

    const optionsModal = page.locator('#optionsModal');
    await expect(optionsModal).toBeVisible();

    const gainSlider = page.locator('input#correctionGainSlider');
    const gainValueLabel = page.locator('#correctionGainValue');
    await gainSlider.waitFor({ state: 'attached' });
    await expect(gainSlider).toBeVisible();
    await expect(gainSlider).toHaveValue('100');
    await expect(gainValueLabel).toHaveText('100%');

    const quadPath = resolve('data/P800_K36C26LK25_V19.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    const labPath = resolve('data/P800_K36C26LK25_V19.txt');
    await page.setInputFiles('input#linearizationFile', labPath);

    const overlayToggle = page.locator('input#labSpotMarkersToggle');
    await expect(overlayToggle).toBeEnabled({ timeout: 10000 });
    await overlayToggle.check();

    await page.waitForFunction(() => {
      const helpers = window.__quadDebug?.chartDebug;
      const markers = helpers?.getLabSpotMarkers?.();
      return Array.isArray(markers) && markers.length > 0;
    }, { timeout: 5000 });

    await page.waitForFunction(() => {
      const helpers = window.__quadDebug?.chartDebug;
      const overlay = helpers?.getLastCorrectionOverlay?.();
      return overlay && Array.isArray(overlay.samples) && overlay.samples.length > 0;
    }, { timeout: 5000 });

    const readMarkers = async () => page.evaluate(() => {
      const helpers = window.__quadDebug?.chartDebug;
      return helpers?.getLabSpotMarkers?.() ?? [];
    });

    const readChartCurve = async () => page.evaluate(() => {
      const state = window.LinearizationState?.getGlobalCorrectedCurves?.();
      if (!state || !Array.isArray(state.LK)) {
        return null;
      }
      return state.LK.slice(0, 32);
    });

    const readOverlay = async () => page.evaluate(() => {
      const helpers = window.__quadDebug?.chartDebug;
      const overlay = helpers?.getLastCorrectionOverlay?.() ?? helpers?.lastCorrectionOverlay ?? null;
      if (!overlay || !Array.isArray(overlay.samples)) {
        return null;
      }
      return {
        effectiveMaxPercent: Number(overlay.effectiveMaxPercent),
        samples: overlay.samples.map((sample: any) => ({
          input: Number(sample?.input ?? sample?.x ?? 0),
          output: Number(sample?.output ?? sample?.y ?? 0)
        }))
      };
    });

    const fullGainMarkers = await readMarkers();
    expect(fullGainMarkers.length).toBeGreaterThan(0);
    const fullGainAbs = fullGainMarkers.map((marker: any) => Math.abs(marker?.deltaPercent ?? 0));
    const fullGainMax = fullGainAbs.reduce((max: number, value: number) => Math.max(max, value), 0);
    const fullGainOverlay = await readOverlay();
    expect(fullGainOverlay).not.toBeNull();
    expect(fullGainOverlay?.samples?.length ?? 0).toBeGreaterThan(0);
    const fullGainCurve = await readChartCurve();
    expect(fullGainCurve).not.toBeNull();

    await gainSlider.evaluate((el, value) => { (el as HTMLInputElement).value = value; }, '0');
    await gainSlider.dispatchEvent('input');
    await gainSlider.dispatchEvent('change');
    await page.evaluate(() => {
      window.__quadDebug?.chartDebug?.setCorrectionGainPercent?.(0);
    });
    await page.waitForTimeout(200);

    await page.waitForFunction(() => {
      const helpers = window.__quadDebug?.chartDebug;
      return helpers?.getCorrectionGainPercent?.() === 0;
    }, { timeout: 3000 });

    await expect(gainValueLabel).toHaveText('0%');

    await page.waitForTimeout(200);

    const zeroGainMarkers = await readMarkers();
    const zeroGainCorrection = zeroGainMarkers[0]?.correctionGain ?? null;
    const zeroGainMax = zeroGainMarkers.reduce((max: number, marker: any) => {
      const value = Math.abs(marker?.deltaPercent ?? 0);
      return value > max ? value : max;
    }, 0);
    expect(zeroGainCorrection).not.toBeNull();
    expect(zeroGainCorrection as number).toBeLessThan(0.01);
    expect(zeroGainMax).toBeLessThan(0.05);
    const zeroGainOverlay = await readOverlay();
    expect(zeroGainOverlay).not.toBeNull();
    expect(zeroGainOverlay?.samples?.length ?? 0).toBeGreaterThan(0);

    const overlayDiffers = zeroGainOverlay!.samples!.some((sample, index) => {
      const baseline = fullGainOverlay!.samples![index];
      if (!baseline) return true;
      return Math.abs(sample.output - baseline.output) > 0.25;
    });
    expect(overlayDiffers).toBe(true);
    const zeroGainCurve = await readChartCurve();
    expect(zeroGainCurve).not.toBeNull();
    expect(zeroGainCurve).not.toBeNull();
    const chartDelta = zeroGainCurve!.map((value, index) => Math.abs(value - fullGainCurve![index] ?? 0));
    const maxChartDelta = chartDelta.reduce((max, value) => Math.max(max, value), 0);
    expect(maxChartDelta).toBeGreaterThan(0);

    await gainSlider.evaluate((el, value) => { (el as HTMLInputElement).value = value; }, '75');
    await gainSlider.dispatchEvent('input');
    await gainSlider.dispatchEvent('change');
    await page.evaluate(() => {
      window.__quadDebug?.chartDebug?.setCorrectionGainPercent?.(75);
    });
    await page.waitForTimeout(200);

    await page.waitForFunction(() => {
      const helpers = window.__quadDebug?.chartDebug;
      return helpers?.getCorrectionGainPercent?.() === 75;
    }, { timeout: 3000 });

    await expect(gainValueLabel).toHaveText('75%');

    await page.waitForTimeout(200);

    const partialMarkers = await readMarkers();
    const partialAbs = partialMarkers.map((marker: any) => Math.abs(marker?.deltaPercent ?? 0));
    const partialMax = partialAbs.reduce((max: number, value: number) => Math.max(max, value), 0);

    expect(partialMax).toBeLessThanOrEqual(fullGainMax + 0.05);
    expect(partialMax).toBeGreaterThanOrEqual(zeroGainMax - 0.01);

    if (fullGainMax > 0.1) {
      expect(partialMax).toBeGreaterThan(0.05);
      expect(partialMax).toBeLessThan(fullGainMax);
      const expectedPartial = fullGainMax * 0.75;
      expect(Math.abs(partialMax - expectedPartial)).toBeLessThan(Math.max(0.15 * fullGainMax, 0.1));
    }
  });
});
