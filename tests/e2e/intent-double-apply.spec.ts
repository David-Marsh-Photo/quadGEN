import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Intent remap idempotency', () => {
  test('applying the same intent twice does not compound the curve', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const quadPath = resolve('data/Starter_P9000_QCDN_BTNS_copy.quad');

    await page.goto(indexUrl);
    await page.waitForFunction(() => !!(window as typeof window & { elements?: any }).elements?.rows?.children?.length);

    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(() => (window as typeof window & { loadedQuadData?: any }).loadedQuadData?.filename?.includes('Starter_P9000'));

    const initialCurve = await page.evaluate(() => {
      const data = (window as typeof window & { loadedQuadData?: any }).loadedQuadData;
      return Array.isArray(data?.curves?.K) ? data.curves.K.slice() : [];
    });
    expect(initialCurve.length).toBeGreaterThan(0);

    await page.locator('#contrastIntentSelect').selectOption('gamma18');

    await page.click('#applyIntentToQuadBtn');
    await expect.poll(async () => {
      return page.evaluate(() => {
        const data = (window as typeof window & { loadedQuadData?: any }).loadedQuadData;
        return Array.isArray(data?.curves?.K) ? data.curves.K[128] ?? null : null;
      });
    }).not.toBe(initialCurve[128]);

    const afterFirst = await page.evaluate(() => {
      const data = (window as typeof window & { loadedQuadData?: any }).loadedQuadData;
      return Array.isArray(data?.curves?.K) ? data.curves.K.slice() : [];
    });

    await page.click('#applyIntentToQuadBtn');

    const afterSecond = await page.evaluate(() => {
      const data = (window as typeof window & { loadedQuadData?: any }).loadedQuadData;
      return Array.isArray(data?.curves?.K) ? data.curves.K.slice() : [];
    });

    expect(afterFirst).not.toEqual(initialCurve);
    expect(afterSecond).toEqual(afterFirst);
  });
});
