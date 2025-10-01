#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';

async function main() {
  const outputBefore = resolve('tests/manual/before-nudge.png');
  const outputAfter = resolve('tests/manual/after-nudge.png');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`file://${resolve('index.html')}`);
  await page.waitForSelector('#globalLinearizationBtn');

  const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
  await page.setInputFiles('input#linearizationFile', manualLabPath);
  await page.waitForFunction(() => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt', null, { timeout: 15000 });

  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });

  // step once to select point 2
  await page.click('#editPointRight');
  await page.waitForTimeout(200);

  // ensure chart up-to-date
  await page.evaluate(() => {
    if (typeof window.updateInkChart === 'function') window.updateInkChart();
  });
  await page.waitForTimeout(200);

  const chart = page.locator('#inkChart');
  await chart.screenshot({ path: outputBefore });

  await page.click('#editNudgeYUp');
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    if (typeof window.updateInkChart === 'function') window.updateInkChart();
  });
  await page.waitForTimeout(200);

  await chart.screenshot({ path: outputAfter });

  await browser.close();
  console.log('Saved screenshots:', outputBefore, outputAfter);
}

main().catch((err) => {
  console.error('[capture-nudge-screenshots] Failure:', err);
  process.exitCode = 1;
});
