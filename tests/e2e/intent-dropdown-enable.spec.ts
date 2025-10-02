import { test, expect } from '@playwright/test';

test('intent dropdown enables after loading quad', async ({ page }) => {
  await page.goto('file:///media/psf/quadGEN/index.html');
  const dropdown = page.locator('#contrastIntentSelect');
  await expect(dropdown).toBeDisabled();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('#loadQuadBtn');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('testdata/humped_shadow_dip.quad');

  await expect(dropdown).toBeEnabled();
});
