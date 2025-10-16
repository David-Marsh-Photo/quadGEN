import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const GLOBAL_PATH = resolve('data/P800_K36C26LK25_V6.txt');
const CHANNELS = ['C', 'LK'] as const;

async function waitForApp(page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 }),
    page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 })
  ]);
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

async function loadQuad(page) {
  await page.setInputFiles('#quadFile', QUAD_PATH);
  await page.waitForFunction(
    () => {
      const data = window.getLoadedQuadData?.();
      return !!data?.curves?.K && data.curves.K.length === 256;
    },
    null,
    { timeout: 20000 }
  );
}

test.describe('Baked measurement coverage', () => {
  test('composite coverage summary still computes for *BAKED* files', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForApp(page);
    await loadQuad(page);

    const buffer = fs.readFileSync(GLOBAL_PATH);
    await page.setInputFiles('#linearizationFile', {
      name: '*BAKED* P800_K36C26LK25_V6.txt',
      mimeType: 'text/plain',
      buffer
    });

    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      null,
      { timeout: 20000 }
    );

    const summary = await page.evaluate(() => {
      return typeof window.getCompositeCoverageSummary === 'function'
        ? window.getCompositeCoverageSummary()
        : null;
    });

    expect(summary).toBeTruthy();

    for (const channel of CHANNELS) {
      expect(summary?.[channel], `coverage summary missing for ${channel}`).toBeTruthy();
      const maxNormalized = summary?.[channel]?.maxNormalized ?? 0;
      expect(maxNormalized).toBeGreaterThan(0.05);
    }
  });
});
