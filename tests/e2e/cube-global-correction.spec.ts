import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { gotoApp } from './utils/edit-mode-helpers';

test.describe('.cube global correction', () => {
  test('applies LUT directly even when Simple Scaling is default', async ({ page }) => {
    await gotoApp(page);

    await page.setInputFiles('#quadFile', resolve('data/P800_K36C26LK25_V6.quad'));
    await page.waitForFunction(
      () => {
        const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
        return !!(data && data.curves && Object.keys(data.curves).length);
      },
      undefined,
      { timeout: 10000 }
    );

    await page.setInputFiles('#linearizationFile', resolve('testdata/test_s_curve.cube'));
    await page.waitForFunction(
      () => {
        const state = window.LinearizationState;
        const data = state && typeof state.getGlobalData === 'function' ? state.getGlobalData() : null;
        if (!data) return false;
        const applied = state ? !!state.globalApplied : false;
        return applied && /lut/i.test(data.format || '');
      },
      undefined,
      { timeout: 15000 }
    );

    const lutDiff = await page.evaluate(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      const globalData = window.LinearizationState?.getGlobalData?.();
      let diffSum = null;
      if (typeof window.make256 === 'function') {
        const currentEnd = Number(data?.baselineEnd?.K) || 65535;
        const withLut = window.make256(currentEnd, 'K', true);
        const withoutLut = window.make256(currentEnd, 'K', false);
        if (Array.isArray(withLut) && Array.isArray(withoutLut) && withLut.length === withoutLut.length) {
          diffSum = withLut.reduce((acc, value, index) => acc + Math.abs((value || 0) - (withoutLut[index] || 0)), 0);
        }
      }
      return diffSum;
    });

    expect(lutDiff, 'LUT should modify the generated 256-sample curve').toBeGreaterThan(0);
  });
});
