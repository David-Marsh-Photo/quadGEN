import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/TRIFORCE_V4.quad');
const LAB_PATH = resolve('data/TRIFORCE_V4.txt');

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);

  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

test.describe('Momentum weighting mode', () => {
  test('surface option and renders momentum diagnostics', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');

    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });

    // Diagnostic: capture available weighting modes before interacting
    const availableModes = await page.evaluate(() => {
      const select = document.querySelector('#compositeWeightingSelect');
      if (!select) return [];
      return Array.from(select.querySelectorAll('option')).map((option) => ({
        value: option.value,
        label: option.textContent?.trim() ?? ''
      }));
    });
    const momentumOption = availableModes.find((entry) => entry.value === 'momentum');
    expect(momentumOption?.label.toLowerCase()).toContain('momentum');

    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 5000 });
    await debugToggle.check();

    await weightingSelect.selectOption('momentum');
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 15000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    await page.waitForFunction(() => {
      if (typeof window.getCompositeDebugState !== 'function') return false;
      const state = window.getCompositeDebugState();
      return !!(state?.summary && state?.summary?.weightingMode === 'momentum');
    }, null, { timeout: 20000 });

    const panel = page.locator('#compositeDebugPanel');
    await expect(panel).toBeVisible();
    const momentumLocators = panel.locator('[data-debug-momentum]');
    await expect(momentumLocators.first()).toBeVisible();

    const snapshotMomentum = await page.evaluate(() => {
      if (typeof window.getCompositeDebugState !== 'function') return null;
      const state = window.getCompositeDebugState();
      const index = state?.selection?.index ?? null;
      if (index == null || !state?.snapshots?.[index]) return null;
      const snapshot = state.snapshots[index];
      return snapshot?.perChannel ?? null;
    });

    expect(snapshotMomentum).toBeTruthy();
    if (snapshotMomentum) {
      Object.values(snapshotMomentum).forEach((entry: any) => {
        if (entry && typeof entry === 'object') {
          expect(entry.momentum).toBeGreaterThanOrEqual(0);
        }
      });
    }
  });
});
