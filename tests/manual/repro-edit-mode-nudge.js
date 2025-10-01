#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';

async function readXY(page) {
  const raw = await page.$eval('#editXYInput', el => el.value.trim());
  const [xStr, yStr] = raw.split(',');
  return { raw, x: parseFloat(xStr), y: parseFloat(yStr) };
}

async function dumpPoints(page) {
  return page.evaluate(() => window.ControlPoints?.get('MK')?.points || []);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));

  await page.goto(`file://${resolve('index.html')}`);

  await page.waitForSelector('#globalLinearizationBtn');
  await page.setInputFiles('input#linearizationFile', resolve('testdata/Manual-LAB-Data.txt'));
  await page.waitForFunction(() => document.getElementById('globalLinearizationFilename')?.textContent.trim() === 'Manual-LAB-Data.txt', null, { timeout: 15000 });

  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });
  await page.waitForTimeout(500);

  await page.click('#editPointRight');
  await page.click('#editPointRight');
  await page.waitForTimeout(200);

  const before = await readXY(page);
  const pointsBefore = await dumpPoints(page);
  console.log('Before:', before, pointsBefore);

  await page.click('#editNudgeYUp');
  await page.waitForTimeout(250);
  const afterUp = await readXY(page);
  const pointsAfter = await dumpPoints(page);
  console.log('After Y up:', afterUp, pointsAfter);

  await browser.close();
}

main().catch((err) => {
  console.error('[repro-edit-mode-nudge] Failure:', err.message);
  process.exitCode = 1;
});
