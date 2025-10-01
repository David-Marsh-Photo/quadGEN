import { test, expect } from '@playwright/test';
import path from 'node:path';

const INDEX_URL = 'file://' + path.resolve('index.html');

test.describe('Help Version History', () => {
  test('shows modularization and benefits bullets for 3.0.0', async ({ page }) => {
    await page.goto(INDEX_URL);

    const helpButton = page.locator('#helpBtn');
    await helpButton.waitFor({ state: 'visible' });
    await helpButton.click();
    await expect(page.locator('#helpPopup')).toBeVisible();

    const historyTab = page.locator('#helpTabHistory');
    await historyTab.click();

    const helpContent = page.locator('#helpContent');
    await expect(helpContent).toContainText('Modularization work: retired `src/extracted_javascript.js`;');
    await expect(helpContent).toContainText('Benefits: file handling parity across sources enables');
  });
});
