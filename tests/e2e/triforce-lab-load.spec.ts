import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

test.describe('TRIFORCE LAB import', () => {
  test('applies global correction when TRIFORCE.txt is loaded', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const labPath = resolve('data/TRIFORCE.txt');

    expect(existsSync(labPath)).toBe(true);

    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`console error: ${message.text()}`);
      }
    });

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });

    const initialState = await page.evaluate(() => ({
      globalApplied: !!window.LinearizationState?.globalApplied,
      hasSamples: Array.isArray(window.linearizationData?.samples) && window.linearizationData.samples.length > 0,
      lastLabSource: window.linearizationData?.filename || window.linearizationData?.sourceFilename || null
    }));

    expect(initialState.globalApplied).toBe(false);
    expect(initialState.hasSamples).toBe(false);

    await page.setInputFiles('#linearizationFile', labPath);

    await page.waitForTimeout(5000);

    const postLoadState = await page.evaluate(() => ({
      globalApplied: !!window.LinearizationState?.globalApplied,
      normalizationMode: window.LinearizationState?.labNormalizationMode || null,
      lastLabSource: window.linearizationData?.filename || window.linearizationData?.sourceFilename || null,
      sampleCount: window.linearizationData?.samples?.length || 0,
      loaderDiagnostics: window.LinearizationState?.getLabLoaderDiagnostics?.() || null,
      statusLog: window.quadGEN?.statusLog?.slice?.(-5) || null
    }));

    expect(postLoadState.sampleCount).toBeGreaterThan(0);
    expect(postLoadState.globalApplied).toBe(true);
    expect(postLoadState.lastLabSource).toMatch(/TRIFORCE\.txt$/);
    expect(consoleErrors).toEqual([]);
  });
});
