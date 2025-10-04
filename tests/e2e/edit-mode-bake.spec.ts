import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

const LAB_FIXTURE = resolve('data/Color-Muse-Data.txt');

test('baking measurement seeds Smart curves and marks status', async ({ page }, testInfo) => {
  await navigateToApp(page);
  await waitForAppReady(page);

  await page.setInputFiles('#linearizationFile', LAB_FIXTURE);
  await page.waitForFunction(() => !!window.linearizationData, null, { timeout: 15000 });

  await page.click('#editModeToggleBtn');

  await page.waitForFunction(() => {
    const controlPoints = window.ControlPoints?.get?.('MK')?.points;
    return Array.isArray(controlPoints) && controlPoints.length >= 20;
  }, null, { timeout: 15000 });

  await page.evaluate(() => {
    if (typeof window.updateProcessingDetail === 'function') {
      window.updateProcessingDetail('MK');
    }
  });

  const state = await page.evaluate(() => {
    const controlPoints = window.ControlPoints?.get?.('MK')?.points || [];
    const meta = window.loadedQuadData?.keyPointsMeta?.MK || null;
    const bakedMeta = window.LinearizationState?.getGlobalBakedMeta?.() || null;
    const sessionStatus = document.getElementById('sessionStatus')?.textContent || '';
    const processingHtml = document.querySelector('.processing-label[data-channel="MK"]')?.innerHTML || '';
    return { smartCount: controlPoints.length, meta, bakedMeta, sessionStatus, processingHtml };
  });

  expect(state.smartCount).toBeGreaterThanOrEqual(20);
  expect(state.meta?.bakedGlobal).toBe(true);
  expect(state.meta?.bakedFilename).toBe('Color-Muse-Data.txt');
  expect(state.bakedMeta?.filename).toBe('Color-Muse-Data.txt');
  expect(state.sessionStatus).toContain('*BAKED*');
  expect(state.processingHtml).toContain('*BAKED*');

  const screenshotPath = testInfo.outputPath('smart-baked-status.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach('baked-status', { path: screenshotPath, contentType: 'image/png' });
});
