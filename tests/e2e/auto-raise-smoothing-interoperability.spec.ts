import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = resolve('data/P800_K36C26LK25_V6.txt');

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' }),
  ]);

  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

test.describe('Auto-raise + smoothing interoperability', () => {
  test('both guards enabled still trigger redistribution smoothing windows', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    // Enable toggles before data load
    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');

    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 10000 });
    if (!(await debugToggle.isChecked())) {
      await debugToggle.check();
    }

    const autoRaiseToggle = page.locator('#autoRaiseInkToggle');
    await autoRaiseToggle.waitFor({ state: 'visible', timeout: 10000 });
    if (!(await autoRaiseToggle.isChecked())) {
      await autoRaiseToggle.check();
    }

    const smoothingToggle = page.locator('#redistributionSmoothingToggle');
    await smoothingToggle.waitFor({ state: 'visible', timeout: 10000 });
    if (!(await smoothingToggle.isChecked())) {
      await smoothingToggle.check();
    }

    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
    await weightingSelect.selectOption('normalized');

    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    // Load data set
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 20000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 },
    );

    // Expect both auto-raise and smoothing diagnostics to appear
    const diagnosticsHandle = await page.waitForFunction(() => {
      if (typeof window.getCompositeDebugState !== 'function') return null;
      const state = window.getCompositeDebugState();
      if (!state || !state.summary) return null;
      const { summary } = state;
      if (!Array.isArray(summary.autoRaisedEnds) || summary.autoRaisedEnds.length === 0) {
        return null;
      }
      if (!Array.isArray(summary.smoothingWindows) || summary.smoothingWindows.length === 0) {
        return null;
      }
      return {
        autoRaised: summary.autoRaisedEnds.length,
        smoothingWindows: summary.smoothingWindows.length,
      };
    }, null, { timeout: 15000 });

    const diagnostics = await diagnosticsHandle?.jsonValue();
    expect(diagnostics?.autoRaised).toBeGreaterThan(0);
    expect(diagnostics?.smoothingWindows).toBeGreaterThan(0);
  });
});
