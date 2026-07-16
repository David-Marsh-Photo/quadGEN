import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Page load smoke check', () => {
  test('loads index.html without errors or an assistant surface', async ({ page }) => {
    const indexPath = resolve('index.html');
    const indexUrl = pathToFileURL(indexPath).href;
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
    await page.waitForSelector('#globalLinearizationBtn', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(
      () => {
        const rows = (window as any).elements?.rows?.children;
        return !!rows && rows.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    await expect(page.locator('#autoBlackLimitToggle')).not.toBeChecked();
    await expect(page.locator('.tab-nav .tab-btn')).toHaveCount(2);
    await expect(page.locator('.tab-btn[data-tab="preview"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="lab"]')).toHaveCount(0);
    await expect(page.locator('[data-tab-content="lab"]')).toHaveCount(0);
    await expect(page.locator('#aiInputCompact')).toHaveCount(0);
    await expect(page.locator('#sendMessageBtnCompact')).toHaveCount(0);

    const assistantGlobals = await page.evaluate(() => {
      return ['aiConfig', 'chatInterface', 'chatUI', 'sendChatMessage']
        .filter((name) => name in window);
    });

    expect(assistantGlobals).toEqual([]);
    expect(readFileSync(indexPath, 'utf8')).not.toContain(
      'sparkling-shape-8b5a.marshmonkey.workers.dev'
    );
    expect(consoleErrors).toEqual([]);
  });
});
