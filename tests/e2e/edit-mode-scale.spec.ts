import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { waitForScaleComplete } from '../utils/scaling-test-helpers';

test('global scale rescales Smart key points', async ({ page }) => {
  const indexUrl = pathToFileURL(resolve('index.html')).href;
  await page.goto(indexUrl);

  await page.waitForSelector('#globalLinearizationBtn');
  await page.setInputFiles('input#linearizationFile', resolve('testdata/Manual-LAB-Data.txt'));
  await page.waitForFunction(
    () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
    null,
    { timeout: 15000 },
  );

  await page.locator('#editModeToggleBtn').click();
  await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });

  const before = await page.evaluate(() => ({
    percent: window.ControlPoints?.get('MK')?.points?.map((p: any) => p.output) || [],
    end: (document.querySelector('tr[data-channel="MK"] .end-input') as HTMLInputElement | null)?.value || null,
    channelPercent: parseFloat((document.querySelector('tr[data-channel="MK"] .percent-input') as HTMLInputElement | null)?.value ?? '100') || 100,
  }));

  expect(before.percent.length).toBeGreaterThan(0);

  await page.evaluate(() => window.applyGlobalScale?.(80));
  await waitForScaleComplete(page, 80);

  const after = await page.evaluate(() => ({
    percent: window.ControlPoints?.get('MK')?.points?.map((p: any) => p.output) || [],
    end: (document.querySelector('tr[data-channel="MK"] .end-input') as HTMLInputElement | null)?.value || null,
    channelPercent: parseFloat((document.querySelector('tr[data-channel="MK"] .percent-input') as HTMLInputElement | null)?.value ?? '0') || 0,
  }));

  expect(after.end).not.toBeNull();
  expect(after.end).not.toBe(before.end);
  expect(after.percent[1]).toBeCloseTo(before.percent[1], 3);
  expect(after.channelPercent).toBeCloseTo(80, 1);
});
