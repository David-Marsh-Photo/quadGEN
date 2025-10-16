import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');
const labPath = resolve('data/TRIFORCE_V4.txt');

async function waitForGlobalApplied(page) {
  await page.waitForFunction(
    () => window.LinearizationState?.globalApplied === true,
    null,
    { timeout: 20000 }
  );
}

async function loadQuad(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await page.waitForFunction(
    () => (window.getLoadedQuadData?.()?.curves?.K || []).length === 256,
    null,
    { timeout: 20000 }
  );
}

async function loadLab(page) {
  await page.setInputFiles('#linearizationFile', labPath);
  await waitForGlobalApplied(page);
  await page.waitForFunction(
    () => (window.getLoadedQuadData?.()?.curves?.K || []).length === 256,
    null,
    { timeout: 20000 }
  );
}

test.describe('Channel density auto-compute fallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
    await loadQuad(page);
  });

  test('blank or zero density triggers solver fallback', async ({ page }) => {
    const densitySelector = '.density-input[data-channel="C"]';

    // Initial state has default density.
    const initial = await page.$eval(densitySelector, (input) => ({
      value: input.value,
      source: input.dataset.densitySource
    }));
    expect(initial.value).toBeTruthy();
    expect(initial.source).toBe('default');

    // Clear to empty (solver should mark pending).
    await page.fill(densitySelector, '0');
    await page.keyboard.press('Tab');

    await page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector);
        if (!input) return false;
        const source = input.getAttribute('data-density-source');
        const value = Number(input.value);
        return source === 'solver' && Number.isFinite(value) && value > 0;
      },
      densitySelector,
      { timeout: 5000 }
    );
  });
});
