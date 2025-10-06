import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Edit Mode delete button', () => {
  test('deletes the selected interior Smart point', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn');

    const quadPath = resolve('testdata/humped_shadow_dip.quad');
    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(
      () => window.loadedQuadData?.channels?.length === 6,
      undefined,
      { timeout: 15000 },
    );

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    await page.waitForFunction(() => window.ControlPoints?.get('K')?.points?.length >= 5);

    // Advance to first interior key point (ordinal 2)
    await page.locator('#editPointRight').click();
    await page.waitForFunction(() => (window as any).EDIT?.selectedOrdinal === 2, undefined, { timeout: 2000 });

    const before = await page.evaluate(() => {
      const points = window.ControlPoints?.get('K')?.points || [];
      const ordinal = window.EDIT?.selectedOrdinal ?? 1;
      const channel = window.EDIT?.selectedChannel ?? null;
      return {
        channel,
        ordinal,
        count: points.length,
        point: points[ordinal - 1] || null,
      };
    });

    expect(before.channel).toBe('K');
    expect(before.ordinal).toBe(2);
    expect(before.point).not.toBeNull();

    await page.locator('#editDeleteBtn').click();

    await page.waitForFunction(
      (previousCount) => {
        const points = window.ControlPoints?.get('K')?.points || [];
        return points.length === previousCount - 1;
      },
      before.count,
      { timeout: 2000 },
    );

    const after = await page.evaluate(() => {
      const points = window.ControlPoints?.get('K')?.points || [];
      const ordinal = window.EDIT?.selectedOrdinal ?? 1;
      const channel = window.EDIT?.selectedChannel ?? null;
      return {
        channel,
        ordinal,
        count: points.length,
        points,
      };
    });

    expect(after.count).toBe(before.count - 1);
    expect(after.channel).toBe('K');
    expect(after.ordinal).toBeLessThanOrEqual(after.count);
  });
});
