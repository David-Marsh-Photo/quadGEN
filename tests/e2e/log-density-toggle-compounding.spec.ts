import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { openGlobalCorrectionTab } from '../utils/history-helpers';

async function baseSamples(page) {
  return page.evaluate(() => Array.from(
    window.LinearizationState?.getGlobalData?.()?.baseSamples || []
  ));
}

test('log-density mode is reversible and does not compound', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await openGlobalCorrectionTab(page);
  await page.setInputFiles('#quadFile', resolve('data/P800_K35_1440S_V2.quad'));
  await page.setInputFiles('#linearizationFile', resolve('data/P800_K35_1440S_V2.txt'));
  await page.waitForFunction(() => (
    window.LinearizationState?.getGlobalData?.()?.baseSamples?.length === 256
  ));

  const toggle = page.locator('#labDensityModeToggle');
  const direct = await baseSamples(page);
  await toggle.check();
  await expect.poll(async () => await baseSamples(page)).not.toEqual(direct);
  const density = await baseSamples(page);

  await toggle.uncheck();
  await expect.poll(async () => await baseSamples(page)).toEqual(direct);

  await toggle.check();
  await expect.poll(async () => await baseSamples(page)).toEqual(density);
});
