import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const GLOBAL_PATH = resolve('data/P800_K36C26LK25_V6.txt');
const SNAPSHOT_INDEX = 184;
const CHANNELS = ['K', 'C', 'LK'] as const;

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

async function waitForCompositeSnapshot(page, index: number) {
  await page.waitForFunction(
    (idx) => {
      const state = typeof window.getCompositeDebugState === 'function'
        ? window.getCompositeDebugState()
        : null;
      return !!state && Array.isArray(state.snapshots) && !!state.snapshots[idx];
    },
    index,
    { timeout: 20000 }
  );
}

test.describe('Baked LAB analysis', () => {
  test('loading a *BAKED* LAB file preserves baseline curve values', async ({ page }) => {
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

    await waitForCompositeSnapshot(page, SNAPSHOT_INDEX);

    const snapshot = await page.evaluate((idx) => {
      const state = typeof window.getCompositeDebugState === 'function'
        ? window.getCompositeDebugState()
        : null;
      return state?.snapshots?.[idx] || null;
    }, SNAPSHOT_INDEX);

    expect(snapshot, 'composite debug snapshot missing for baked scenario').toBeTruthy();
    expect(snapshot?.deltaDensity ?? 0).toBeCloseTo(0, 6);
    expect(snapshot?.inkDelta ?? 0).toBe(0);

    for (const channel of CHANNELS) {
      const entry = snapshot?.perChannel?.[channel];
      expect(entry, `per-channel data missing for ${channel}`).toBeTruthy();
      expect(Math.abs(entry.valueDelta ?? 0)).toBeLessThan(1e-3);
      expect(Math.abs((entry.normalizedAfter ?? 0) - (entry.normalizedBefore ?? 0))).toBeLessThan(1e-6);
    }
  });
});
