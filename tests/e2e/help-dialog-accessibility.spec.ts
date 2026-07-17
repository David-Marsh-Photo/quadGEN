import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;

test('contains Help focus and restores the actual trigger on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(INDEX_URL);

  const dialog = page.getByRole('dialog', { name: /quadGEN/ });
  const closeButton = page.locator('#closeHelpBtn');
  const mainTrigger = page.locator('#helpBtn');

  await mainTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(closeButton).toBeFocused();

  const focusable = dialog.locator(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  );
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(focusable.last()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(mainTrigger).toBeFocused();

  const editModeTrigger = page.locator('#editModeHelpBtn');
  await editModeTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editModeTrigger).toBeFocused();
});
