import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Channel end input editing', () => {
  test('manual edits persist after focus commit', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    const quadPath = resolve('testdata/humped_shadow_dip.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    await page.waitForFunction(
      () => {
        const data = window.getLoadedQuadData?.();
        return !!data && Array.isArray(data.curves?.K) && data.curves.K.length === 256;
      },
      undefined,
      { timeout: 20000 },
    );

    const endInput = page.locator('tr[data-channel="K"] input.end-input');
    await endInput.scrollIntoViewIfNeeded();

    const initialValue = await endInput.inputValue();
    expect(initialValue).not.toBe('0');

    await endInput.focus();
    await endInput.press('ArrowDown');

    await page.waitForTimeout(300);
    await expect(endInput).not.toHaveValue(initialValue);

    await endInput.fill('60000');
    await endInput.press('Enter');

    await page.waitForTimeout(300);
    await expect(endInput).toHaveValue('60000');
  });
});
