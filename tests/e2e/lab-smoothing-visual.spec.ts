import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/P800_K36C26LK25_V6.quad');
const labPath = resolve('data/P800_K36C26LK25_V6.txt');
const artifactDir = resolve('artifacts', 'lab-smoothing');
const screenshotPath = resolve(artifactDir, 'p800-k36c26lk25-v6-smoothing.png');

async function waitForQuadCurves(page) {
  await page.waitForFunction(
    () => {
      const data = window.getLoadedQuadData?.();
      const curves = data?.curves;
      if (!curves) return false;
      const requiredChannels = ['K', 'C', 'LK'];
      return requiredChannels.every((channel) => {
        const curve = curves[channel];
        return Array.isArray(curve) && curve.length === 256;
      });
    },
    null,
    { timeout: 20000 },
  );
}

async function waitForGlobalApplied(page) {
  await page.waitForFunction(
    () => {
      const state = window.LinearizationState;
      if (!state?.globalApplied) return false;
      const preview = state.getGlobalData?.()?.previewSmoothingPercent;
      return typeof preview === 'number';
    },
    null,
    { timeout: 20000 },
  );
}

async function openOptions(page) {
  await page.click('#optionsBtn');
  await page.waitForSelector('#optionsModal:not(.hidden)', { timeout: 5000 });
}

async function adjustLabSmoothing(page, percent: number) {
  await openOptions(page);

  await page.locator('#labSmoothingPercentSlider').evaluate(
    (slider, value) => {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    },
    percent,
  );

  await page.waitForFunction(
    (expected) => {
      const label = document.getElementById('labSmoothingPercentValue');
      return label?.textContent?.trim().startsWith(`${expected}%`);
    },
    percent,
    { timeout: 5000 },
  );

  await page.click('#closeOptionsBtn');
  await page.waitForFunction(
    () => document.getElementById('optionsModal')?.classList.contains('hidden') === true,
    null,
    { timeout: 5000 },
  );
}

test.describe('LAB smoothing visual capture (P800 K36C26LK25 V6)', () => {
  test('applies smoothing and captures ink chart', async ({ page }) => {
    mkdirSync(artifactDir, { recursive: true });

    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });

    const domDiagnostics = await page.evaluate(() => ({
      quadAccept: document.querySelector<HTMLInputElement>('#quadFile')?.accept ?? null,
      labAccept: document.querySelector<HTMLInputElement>('#linearizationFile')?.accept ?? null,
      optionsVisible: !!document.querySelector('#optionsBtn'),
    }));
    console.log('[diagnostic] initial DOM', JSON.stringify(domDiagnostics));

    await page.setInputFiles('#quadFile', quadPath);
    await waitForQuadCurves(page);

    await page.setInputFiles('#linearizationFile', labPath);
    await waitForGlobalApplied(page);

    const baselineState = await page.evaluate(() => {
      const curve = window.getLoadedQuadData?.()?.curves?.K;
      return {
        smoothingPercent: window.LinearizationState?.getGlobalData?.()?.previewSmoothingPercent ?? null,
        curveSnapshot: Array.isArray(curve) ? curve.slice() : null,
      };
    });
    console.log('[diagnostic] baseline after LAB load', JSON.stringify(baselineState));

    await adjustLabSmoothing(page, 200);

    await page.waitForFunction(
      (previousCurve) => {
        const curve = window.getLoadedQuadData?.()?.curves?.K;
        if (!Array.isArray(curve) || !Array.isArray(previousCurve)) return false;
        if (curve.length !== previousCurve.length) return false;
        return curve.some((value, index) => value !== previousCurve[index]);
      },
      baselineState.curveSnapshot ?? [],
      { timeout: 10000 },
    );

    const smoothingState = await page.evaluate(() => {
      const curve = window.getLoadedQuadData?.()?.curves?.K;
      return {
        smoothingPercent: window.LinearizationState?.getGlobalData?.()?.previewSmoothingPercent ?? null,
        curveSnapshot: Array.isArray(curve) ? curve.slice() : null,
        sessionStatus: document.querySelector('#sessionStatusLine')?.textContent?.trim() ?? '',
      };
    });
    console.log('[diagnostic] state after smoothing', JSON.stringify(smoothingState));

    expect(smoothingState.smoothingPercent).toBe(200);

    await page.waitForTimeout(1000);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    console.log(`[artifact] screenshot saved to ${screenshotPath}`);
  });
});
