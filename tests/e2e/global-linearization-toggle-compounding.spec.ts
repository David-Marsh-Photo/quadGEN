import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

test.describe('Global correction toggle', () => {
  test('does not reapply scaling when toggled repeatedly', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const quadPath = resolve('data/P800_K35_1440S_V2.quad');
    const labPath = resolve('data/P800_K35_1440S_V2.txt');

    expect(existsSync(quadPath)).toBe(true);
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

    const fileInputOptions = { timeout: 15000, state: 'attached' } as const;
    await page.waitForSelector('#quadFile', fileInputOptions);
    await page.waitForSelector('#linearizationFile', fileInputOptions);

    await page.setInputFiles('#quadFile', quadPath);
    await page.waitForFunction(() => {
      const data = window.loadedQuadData;
      return !!(data && Array.isArray(data.curves?.K) && data.curves.K.length === 256);
    }, {}, { timeout: 20000 });

    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForFunction(() => {
      const applied = !!window.LinearizationState?.globalApplied;
      const entry = window.LinearizationState?.getGlobalData?.();
      return applied && !!(entry && Array.isArray(entry.samples) && entry.samples.length === 256);
    }, {}, { timeout: 20000 });

    const readState = async () => {
      return await page.evaluate(() => {
        const entry = window.LinearizationState?.getGlobalData?.();
        const curves = window.loadedQuadData?.curves || {};
        const kCurve = Array.isArray(curves.K) ? Array.from(curves.K) : null;
        const samples = entry && Array.isArray(entry.samples) ? Array.from(entry.samples) : null;
        return { samples, kCurve };
      });
    };

    const initialState = await readState();
    expect(initialState.samples).not.toBeNull();
    expect(initialState.samples?.length).toBe(256);
    expect(initialState.kCurve).not.toBeNull();
    expect(initialState.kCurve?.length).toBe(256);

    const slider = page.locator('label.slider-toggle[title="Enable/disable global correction"] .slider');
    await expect(slider).toBeVisible();

    const toggleOnce = async () => {
      await slider.click();
      await page.waitForFunction(() => !window.LinearizationState?.globalApplied, null, { timeout: 15000 });
      await slider.click();
      await page.waitForFunction(() => !!window.LinearizationState?.globalApplied, null, { timeout: 15000 });
    };

    await toggleOnce();
    await toggleOnce();
    await toggleOnce();

    const finalState = await readState();
    expect(finalState.samples).not.toBeNull();
    expect(finalState.samples?.length).toBe(256);
    expect(finalState.kCurve).not.toBeNull();
    expect(finalState.kCurve?.length).toBe(256);

    expect(finalState.samples).toEqual(initialState.samples);
    expect(finalState.kCurve).toEqual(initialState.kCurve);
    expect(consoleErrors).toEqual([]);
  });
});
