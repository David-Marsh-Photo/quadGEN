import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = resolve('data/P800_K36C26LK25_V6.txt');

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

test.describe('Composite coverage ceilings', () => {
  test('redistribution respects buffered coverage limit', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    // Enable composite debug overlay to access coverage summary
    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');
    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 10000 });
    await debugToggle.check();
    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
    await weightingSelect.selectOption('normalized');
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
      const state = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      if (!state || !state.summary) return false;
      const coverage = state.summary.coverageSummary;
      const snapshots = state.snapshots;
      return !!(
        coverage &&
        coverage.K &&
        Number.isFinite(coverage.K.bufferedLimit) &&
        Array.isArray(snapshots) &&
        snapshots.length > 184 &&
        snapshots[184]?.perChannel?.K?.normalizedAfter != null
      );
    }, null, { timeout: 20000 });

    const diagnostics = await page.evaluate(() => {
      const state = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      if (!state || !state.summary) return null;
      const coverage = state.summary.coverageSummary?.K;
      const snapshot = state.snapshots?.[184];
      if (!coverage || !snapshot) return null;
      return {
        bufferedLimit: coverage.bufferedLimit,
        limit: coverage.limit,
        overflow: coverage.overflow,
        maxNormalized: coverage.maxNormalized,
        clampedSamples: Array.isArray(coverage.clampedSamples) ? coverage.clampedSamples.length : 0,
        normalizedAfter: snapshot.perChannel?.K?.normalizedAfter ?? null
      };
    });

    expect(diagnostics).not.toBeNull();
    const { bufferedLimit, limit, overflow, maxNormalized, clampedSamples, normalizedAfter } = diagnostics!;
    expect(bufferedLimit).toBeGreaterThan(0);
    expect(limit).toBeGreaterThan(0);
    expect(maxNormalized).toBeLessThanOrEqual(bufferedLimit + 1e-6);
    expect(normalizedAfter).toBeLessThanOrEqual(bufferedLimit + 1e-6);
    expect(clampedSamples).toBeGreaterThan(0);
    expect(overflow).toBeGreaterThan(0);
  });
});
