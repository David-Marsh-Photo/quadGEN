import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const GLOBAL_PATH = resolve('data/P800_K36C26LK25_V6.txt');
const CHANNELS = ['C', 'LK'] as const;

type ChannelSample = {
  channel: string;
  percentValue: number | null;
  endValue: number | null;
};

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

async function waitForQuadLoad(page: Page) {
  await page.setInputFiles('#quadFile', QUAD_PATH);
  await page.waitForFunction(() => {
    const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
    return !!(data && data.curves && Object.keys(data.curves).length);
  }, null, { timeout: 20000 });
  await page.waitForFunction(
    (channels) => {
      for (const channel of channels) {
        const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel="${channel}"]`);
        if (!row) return false;
        const percentInput = row.querySelector<HTMLInputElement>('.percent-input');
        if (!percentInput) return false;
        const value = Number(percentInput.value);
        if (!(Number.isFinite(value) && value > 0)) return false;
      }
      return true;
    },
    CHANNELS,
    { timeout: 10000 }
  );
}

async function loadGlobalCorrection(page: Page) {
  await page.setInputFiles('#linearizationFile', GLOBAL_PATH);
  await page.waitForFunction(
    () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
    null,
    { timeout: 20000 }
  );
  await page.waitForFunction(
    (channels) => {
      for (const channel of channels) {
        const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel="${channel}"]`);
        if (!row) return false;
        const percentInput = row.querySelector<HTMLInputElement>('.percent-input');
        if (!percentInput) return false;
        const value = Number(percentInput.value);
        if (!(Number.isFinite(value) && value > 0)) return false;
      }
      return true;
    },
    CHANNELS,
    { timeout: 10000 }
  );
}

async function readChannelSamples(page: Page): Promise<ChannelSample[]> {
  return page.evaluate((channels) => {
    const rows = channels.map((channel) => {
      const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel="${channel}"]`);
      const percentInput = row?.querySelector<HTMLInputElement>('.percent-input');
      const endInput = row?.querySelector<HTMLInputElement>('.end-input');
      return {
        channel,
        percentValue: percentInput ? Number(percentInput.value) : null,
        endValue: endInput ? Number(endInput.value) : null
      };
    });
    return rows;
  }, CHANNELS);
}

test.describe('Density ceiling scaling regression guard', () => {
  test('global correction retains coverage-aligned ink limits', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);
    await waitForQuadLoad(page);

    const baseline = await readChannelSamples(page);

    await loadGlobalCorrection(page);
    const after = await readChannelSamples(page);

    const coverageSummary = await page.evaluate(() => {
      return typeof window.getCompositeCoverageSummary === 'function'
        ? window.getCompositeCoverageSummary()
        : null;
    });

    for (const channel of CHANNELS) {
      const beforeSample = baseline.find((entry) => entry.channel === channel);
      const afterSample = after.find((entry) => entry.channel === channel);
      expect(beforeSample, `missing baseline sample for ${channel}`).toBeDefined();
      expect(afterSample, `missing post-load sample for ${channel}`).toBeDefined();

      const beforePercent = beforeSample!.percentValue ?? 0;
      const afterPercent = afterSample!.percentValue ?? 0;
      const beforeEnd = beforeSample!.endValue ?? 0;
      expect(beforePercent).toBeGreaterThan(5);
      expect(afterPercent).toBeGreaterThan(5);
      const expectedPercent = coverageSummary?.[channel]?.bufferedLimit;
      expect(expectedPercent).toBeDefined();
      expect(expectedPercent).not.toBeNull();
      const expectedPercentValue = (expectedPercent ?? 0) * 100;
      expect(expectedPercentValue).toBeGreaterThan(0);
      expect(Math.abs(afterPercent - expectedPercentValue)).toBeLessThan(0.6);
    }
  });
});
