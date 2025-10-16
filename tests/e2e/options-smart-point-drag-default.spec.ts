import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const STORAGE_KEY = 'quadgen.smartPointDragEnabled';

test.describe('Options smart point drag default', () => {
  test('smart point drag toggle starts enabled by default', async ({ page }) => {
    await page.addInitScript((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore storage access errors */
      }
    }, STORAGE_KEY);

    await page.goto(INDEX_URL);

    const initialFlag = await page.evaluate(() => {
      const helper = (window as any).isSmartPointDragEnabled;
      if (typeof helper === 'function') {
        return helper();
      }
      const compat = (window as any).__quadDebug?.featureFlags;
      return compat?.smartPointDrag ?? null;
    });

    expect(initialFlag, 'feature flag should report enabled state before opening options').toBe(true);

    const optionsBtn = page.locator('#optionsBtn');
    await expect(optionsBtn).toBeVisible();
    await optionsBtn.click();

    const optionsModal = page.locator('#optionsModal');
    await expect(optionsModal).toBeVisible();

    const toggle = optionsModal.locator('input#smartPointDragToggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();

    await toggle.uncheck();

    const disabledFlag = await page.evaluate(() => {
      const helper = (window as any).isSmartPointDragEnabled;
      return typeof helper === 'function' ? helper() : null;
    });
    expect(disabledFlag, 'disabling toggle should update feature flag').toBe(false);

    await toggle.check();

    const finalFlag = await page.evaluate(() => {
      const helper = (window as any).isSmartPointDragEnabled;
      return typeof helper === 'function' ? helper() : null;
    });
    expect(finalFlag, 're-enabling toggle should restore feature flag').toBe(true);

    await page.screenshot({ path: 'artifacts/options-smart-point-drag-default.png', fullPage: true });
  });
});
