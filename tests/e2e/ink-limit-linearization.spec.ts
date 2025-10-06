import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Ink limit adjustments', () => {
  test('per-channel ink limit edits preserve curve shape', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    const quadPath = resolve('testdata/humped_shadow_dip.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    await page.waitForFunction(
      () => window.getLoadedQuadData?.()?.curves?.K?.length === 256,
      undefined,
      { timeout: 20000 },
    );

    const before = await page.evaluate(() => {
      const quad = window.getLoadedQuadData?.();
      const curve = quad?.curves?.K || [];
      const end = curve.length > 0 ? curve[curve.length - 1] : 0;
      return { curve, end };
    });

    expect(before.curve.length).toBe(256);
    expect(before.end).toBeGreaterThan(0);

    const percentInput = page.locator('tr[data-channel="K"] input.percent-input');
    await percentInput.click();
    await percentInput.fill('80');
    await percentInput.press('Enter');
    await expect(percentInput).toHaveValue('80');

    await page.waitForFunction(() => {
      const quad = window.getLoadedQuadData?.();
      const curve = quad?.curves?.K || [];
      return curve.length === 256 && curve[curve.length - 1] > 0;
    }, undefined, { timeout: 10000 });

    const after = await page.evaluate(() => {
      const quad = window.getLoadedQuadData?.();
      const curve = quad?.curves?.K || [];
      const end = curve.length > 0 ? curve[curve.length - 1] : 0;
      return { curve, end };
    });

    expect(after.curve.length).toBe(256);
    expect(after.end).toBeGreaterThan(before.end);

    const expectedRatio = after.end / before.end;
    const fractions = [0.25, 0.5, 0.75];
    const sampleIndices = fractions
      .map((fraction) => Math.round((before.curve.length - 1) * fraction))
      .filter((index) => index > 0 && index < before.curve.length - 1 && before.curve[index] > 0);

    expect(sampleIndices.length).toBeGreaterThan(0);

    const tolerance = 0.02;
    for (const index of sampleIndices) {
      const beforeValue = before.curve[index];
      const afterValue = after.curve[index];
      const ratio = afterValue / beforeValue;
      expect(Math.abs(ratio - expectedRatio)).toBeLessThanOrEqual(tolerance);
    }
  });
});
