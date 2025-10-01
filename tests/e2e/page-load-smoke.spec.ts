import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Page load smoke check', () => {
  test('loads index.html without console errors', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
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
    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    expect(consoleErrors).toEqual([]);
  });
});
