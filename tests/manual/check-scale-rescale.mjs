#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`file://${resolve('index.html')}`);
  await page.waitForSelector('#globalLinearizationBtn');

  const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
  await page.setInputFiles('input#linearizationFile', manualLabPath);
  await page.waitForFunction(
    () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
    null,
    { timeout: 15000 },
  );

  await page.locator('#editModeToggleBtn').click();
  await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });

  const before = await page.evaluate(() => {
    const pts = window.ControlPoints?.get('MK')?.points || [];
    const clone = pts.map(p => ({ ...p }));
    const endInput = document.querySelector('tr[data-channel="MK"] .end-input');
    const percentInput = document.querySelector('tr[data-channel="MK"] .percent-input');
    return {
      points: clone,
      end: endInput?.value || null,
      percent: percentInput?.value || null,
    };
  });

  await page.evaluate(() => {
    if (typeof window.applyGlobalScale === 'function') {
      window.applyGlobalScale(80);
    }
  });

  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const pts = window.ControlPoints?.get('MK')?.points || [];
    const clone = pts.map(p => ({ ...p }));
    const endInput = document.querySelector('tr[data-channel="MK"] .end-input');
    const percentInput = document.querySelector('tr[data-channel="MK"] .percent-input');
    return {
      points: clone,
      end: endInput?.value || null,
      percent: percentInput?.value || null,
    };
  });

  console.log('Before scale:', before);
  console.log('After scale:', after);

  await browser.close();
}

main().catch((err) => {
  console.error('[check-scale-rescale] Failure:', err);
  process.exitCode = 1;
});
