import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test('bell apex controls shift a bell-classified channel', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.setInputFiles('#quadFile', resolve('data/KCLK.quad'));
  await page.waitForFunction(() => {
    const meta = window.getChannelShapeMeta?.();
    return meta?.C?.classification === 'bell' && meta?.K?.classification === 'monotonic';
  });

  await page.locator('#editModeToggleBtn').click();
  await page.selectOption('#editChannelSelect', 'C');

  const controls = page.locator('#editBellShiftContainer');
  const input = page.locator('#editBellShiftInput');
  await expect(controls).toBeVisible();

  await page.selectOption('#editChannelSelect', 'K');
  await expect(controls).toBeHidden();
  await page.selectOption('#editChannelSelect', 'C');

  const initial = Number(await input.inputValue());
  await page.locator('#editBellShiftDec').click();
  await expect.poll(async () => Number(await input.inputValue())).toBeLessThan(initial);

  const afterNudge = Number(await input.inputValue());
  const target = afterNudge + 2;
  await input.fill(target.toFixed(1));
  await input.press('Enter');

  await expect.poll(async () => page.evaluate((expected) => {
    const actual = window.getChannelShapeMeta?.()?.C?.bellShift?.shiftedApexInputPercent;
    return Number.isFinite(actual) ? Math.abs(actual - expected) : Infinity;
  }, target)).toBeLessThan(0.2);
});
