#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file://${resolve('index.html')}`);

  await page.waitForSelector('#globalLinearizationBtn');
  await page.setInputFiles('input#linearizationFile', resolve('testdata/Manual-LAB-Data.txt'));
  await page.waitForFunction(() => document.getElementById('globalLinearizationFilename')?.textContent.trim() === 'Manual-LAB-Data.txt', null, { timeout: 15000 });

  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });
  await page.waitForTimeout(500);

  const initial = await page.$eval('#editPointIndex', el => el.textContent.trim());
  if (initial !== '1') {
    throw new Error(`Expected initial ordinal 1, saw ${initial}`);
  }

  await page.click('#editPointRight');
  await page.waitForTimeout(200);
  const after = await page.$eval('#editPointIndex', el => el.textContent.trim());

  await browser.close();

  if (after !== '2') {
    throw new Error(`Expected ordinal 2 after pressing right arrow, but got ${after}`);
  }

  console.log('Navigation behaves as expected.');
}

main().catch((err) => {
  console.error('[repro-edit-mode-navigation] Failure:', err.message);
  process.exitCode = 1;
});
