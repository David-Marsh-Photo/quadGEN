import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');

async function waitForQuadLoaded(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await page.waitForFunction(
    () => (window.getLoadedQuadData?.()?.curves?.K || []).length === 256,
    null,
    { timeout: 20000 }
  );
}

async function openManualLstarModal(page) {
  await page.click('#manualLstarBtn');
  await page.waitForSelector('#lstarModal', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.lstar-input'));
    return rows.length >= 5;
  }, null, { timeout: 5000 });
}

async function populateManualMeasurements(page, values) {
  const inputs = page.locator('.lstar-input');
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? values[values.length - 1];
    await inputs.nth(index).fill(String(value));
  }
}

test.describe('Manual L* entry', () => {
  test('applying manual measurements enables global correction', async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 10000 });

    await waitForQuadLoaded(page);
    await openManualLstarModal(page);

    const measuredValues = [95, 75, 55, 35, 15];
    await populateManualMeasurements(page, measuredValues);

    await page.waitForFunction(() => {
      const button = document.getElementById('generateFromLstar');
      return !!button && button.disabled === false;
    }, null, { timeout: 5000 });

    await page.click('#generateFromLstar');

    await page.waitForFunction(() => window.LinearizationState?.globalApplied === true, null, { timeout: 15000 });

    const manualResult = await page.evaluate(() => {
      const entry = window.LinearizationState?.getGlobalData?.();
      return {
        modalHidden: document.getElementById('lstarModal')?.classList.contains('hidden') ?? false,
        filenameText: document.getElementById('globalLinearizationFilename')?.textContent?.trim() ?? '',
        format: entry?.format ?? null,
        valid: entry?.valid ?? false,
        sampleCount: Array.isArray(entry?.samples) ? entry.samples.length : 0
      };
    });

    expect(manualResult.modalHidden).toBeTruthy();
    expect(manualResult.filenameText).toContain('Manual L* Entry');
    expect(manualResult.format).toBe('Manual L* Entry');
    expect(manualResult.valid).toBeTruthy();
    expect(manualResult.sampleCount).toBe(256);
  });
});
