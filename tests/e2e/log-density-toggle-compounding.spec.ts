import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

test.describe('Log-density mode toggle', () => {
  test('does not accumulate scaling when switching modes', async ({ page }) => {
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
    await page.waitForSelector('#labDensityModeToggle', { timeout: 15000 });

    const initialDiagnostics = await page.evaluate(() => {
      const toggle = document.querySelector('#labDensityModeToggle') as HTMLInputElement | null;
      const style = toggle ? window.getComputedStyle(toggle) : null;
      return {
        exists: !!toggle,
        visible: !!toggle && style?.display !== 'none' && style?.visibility !== 'hidden' && style?.opacity !== '0',
        checked: toggle?.checked ?? null,
        labelHtml: toggle?.closest('label')?.outerHTML ?? null
      };
    });

    expect(initialDiagnostics.exists).toBe(true);
    expect(initialDiagnostics.visible).toBe(true);

    await page.setInputFiles('#quadFile', quadPath);
    await page.waitForFunction(() => {
      const data = window.loadedQuadData;
      return !!(data && Array.isArray(data.curves?.K) && data.curves.K.length === 256);
    }, {}, { timeout: 15000 });

    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForFunction(() => {
      const entry = window.LinearizationState?.getGlobalData?.();
      return !!(entry && Array.isArray(entry.baseSamples) && entry.baseSamples.length === 256);
    }, {}, { timeout: 15000 });

    const sampleState = async () => {
      return await page.evaluate(() => {
        const toggle = document.querySelector('#labDensityModeToggle') as HTMLInputElement | null;
        const curves = window.loadedQuadData?.curves || {};
        const kCurve = Array.isArray(curves?.K) ? Array.from(curves.K) : null;
        const mid = kCurve && kCurve.length ? kCurve[Math.floor(kCurve.length / 2)] : null;
        const baseSamples = window.LinearizationState?.getGlobalData?.()?.baseSamples;
        const baseMid = Array.isArray(baseSamples) ? baseSamples[128] : null;
        return {
          toggleChecked: !!toggle?.checked,
          kCurve,
          kMid: mid,
          baseMid
        };
      });
    };

    const initialState = await sampleState();
    expect(initialState.kCurve).not.toBeNull();
    expect(initialState.kMid).not.toBeNull();

    const densityToggle = page.locator('#labDensityModeToggle');

    await densityToggle.click();
    await page.waitForFunction((initialBaseMid) => {
      const toggle = document.querySelector('#labDensityModeToggle') as HTMLInputElement | null;
      const baseSamples = window.LinearizationState?.getGlobalData?.()?.baseSamples;
      const baseMid = Array.isArray(baseSamples) ? baseSamples[128] : null;
      if (!toggle || baseMid === null || initialBaseMid === null) {
        return false;
      }
      return toggle.checked && Math.abs(baseMid - initialBaseMid) > 1e-4;
    }, initialState.baseMid ?? null, { timeout: 15000 });
    const densityState1 = await sampleState();
    expect(densityState1.kCurve).not.toBeNull();
    expect(densityState1.kMid).not.toBeNull();

    await densityToggle.click();
    await page.waitForFunction((expectedBaseMid) => {
      const toggle = document.querySelector('#labDensityModeToggle') as HTMLInputElement | null;
      const baseSamples = window.LinearizationState?.getGlobalData?.()?.baseSamples;
      const baseMid = Array.isArray(baseSamples) ? baseSamples[128] : null;
      if (!toggle || baseMid === null || expectedBaseMid === null) {
        return false;
      }
      return !toggle.checked && Math.abs(baseMid - expectedBaseMid) <= 1e-4;
    }, initialState.baseMid ?? null, { timeout: 15000 });
    const restoredState = await sampleState();

    await densityToggle.click();
    await page.waitForFunction((expectedBaseMid) => {
      const toggle = document.querySelector('#labDensityModeToggle') as HTMLInputElement | null;
      const baseSamples = window.LinearizationState?.getGlobalData?.()?.baseSamples;
      const baseMid = Array.isArray(baseSamples) ? baseSamples[128] : null;
      if (!toggle || baseMid === null || expectedBaseMid === null) {
        return false;
      }
      return toggle.checked && Math.abs(baseMid - expectedBaseMid) <= 1e-4;
    }, densityState1.baseMid ?? null, { timeout: 15000 });
    const densityState2 = await sampleState();

    expect(restoredState.kCurve).not.toBeNull();
    expect(densityState2.kCurve).not.toBeNull();

    expect(densityState1.kCurve).not.toEqual(initialState.kCurve);
    expect(Math.abs(densityState1.kMid - (initialState.kMid ?? 0))).toBeGreaterThan(5);

    expect(restoredState.kCurve).toEqual(initialState.kCurve);
    expect(Math.abs(restoredState.kMid - (initialState.kMid ?? 0))).toBeLessThanOrEqual(1);

    expect(densityState2.kCurve).toEqual(densityState1.kCurve);
    expect(Math.abs(densityState2.kMid - (densityState1.kMid ?? 0))).toBeLessThanOrEqual(1);

    expect(consoleErrors).toEqual([]);
  });
});
