import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const GLOBAL_PATH = resolve('data/P800_K36C26LK25_V6.txt');
const CHANNELS = ['C', 'LK'] as const;

type ChannelReadings = Record<typeof CHANNELS[number], { percent: number; end: number }>;

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 }),
    page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 })
  ]);
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

async function loadQuad(page: Page) {
  await page.setInputFiles('#quadFile', QUAD_PATH);
  await page.waitForFunction(() => {
    const data = window.getLoadedQuadData?.();
    if (!data || !data.curves) return false;
    return ['C', 'LK'].every((channel) => {
      const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel=\"${channel}\"]`);
      if (!row) return false;
      const percentInput = row.querySelector<HTMLInputElement>('.percent-input');
      if (!percentInput) return false;
      const value = Number(percentInput.value);
      return Number.isFinite(value) && value > 0;
    });
  }, null, { timeout: 20000 });
}

async function loadGlobal(page: Page) {
  await page.setInputFiles('#linearizationFile', GLOBAL_PATH);
  await page.waitForFunction(() => {
    const applied = !!window.LinearizationState?.globalApplied;
    const summaryReady = typeof window.getCompositeCoverageSummary === 'function'
      ? window.getCompositeCoverageSummary() !== null
      : true;
    return applied && summaryReady;
  }, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    return ['C', 'LK'].every((channel) => {
      const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel=\"${channel}\"]`);
      if (!row) return false;
      const percentInput = row.querySelector<HTMLInputElement>('.percent-input');
      if (!percentInput) return false;
      const value = Number(percentInput.value);
      return Number.isFinite(value) && value > 0;
    });
  }, null, { timeout: 20000 });
}

async function readChannelData(page: Page): Promise<ChannelReadings> {
  return page.evaluate((channels) => {
    const readings: ChannelReadings = {
      C: { percent: 0, end: 0 },
      LK: { percent: 0, end: 0 }
    };
    channels.forEach((channel) => {
      const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel=\"${channel}\"]`);
      const percentInput = row?.querySelector<HTMLInputElement>('.percent-input');
      const endInput = row?.querySelector<HTMLInputElement>('.end-input');
      readings[channel] = {
        percent: percentInput ? Number(percentInput.value) : NaN,
        end: endInput ? Number(endInput.value) : NaN
      };
    });
    return readings;
  }, CHANNELS);
}

test.describe('Channel density coverage stays aligned with quad baselines', () => {
  test('global correction preserves highlight ink availability', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    await loadQuad(page);
    const baseline = await readChannelData(page);

    CHANNELS.forEach((channel) => {
      expect(baseline[channel].percent, `baseline percent for ${channel}`).toBeGreaterThan(5);
      expect(baseline[channel].end, `baseline end for ${channel}`).toBeGreaterThan(0);
    });

    await loadGlobal(page);
    await page.waitForTimeout(200); // allow redistributor to settle
    const after = await readChannelData(page);

    CHANNELS.forEach((channel) => {
      const beforePercent = baseline[channel].percent;
      const afterPercent = after[channel].percent;
      expect(Number.isFinite(afterPercent)).toBe(true);
      const minimumExpected = beforePercent * 0.9;
      expect(afterPercent, `${channel} percent dropped more than 10% (baseline ${beforePercent.toFixed(1)} → ${afterPercent.toFixed(1)})`).toBeGreaterThanOrEqual(minimumExpected);
    });
  });
});
