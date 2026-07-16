import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { waitForScaleComplete } from '../utils/scaling-test-helpers';

test('the Scale field commits and remains active after a channel edit', async ({ page }) => {
  await navigateToApp(page);
  await waitForAppReady(page);

  const scaleInput = page.locator('#scaleAllInput');
  await scaleInput.fill('87');
  await scaleInput.press('Enter');
  await waitForScaleComplete(page, 87);

  await expect(scaleInput).toHaveValue('87');
  expect(await page.evaluate(() => window.getCurrentScale?.())).toBeCloseTo(87, 1);

  const channelInput = page.locator('tr[data-channel="MK"] .percent-input');
  await channelInput.fill('72');
  await channelInput.blur();
  await waitForScaleComplete(page, 87);

  await expect.poll(async () => Number(await channelInput.inputValue())).toBeCloseTo(87, 1);
  expect(await page.evaluate(() => window.getCurrentScale?.())).toBeCloseTo(87, 1);
});
