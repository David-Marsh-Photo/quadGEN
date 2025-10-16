import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/TRIFORCE_V4.quad');

test.describe('Quad ink limit display', () => {
  test('preserves channel end percentages when loading quad files', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

  await page.setInputFiles('#quadFile', QUAD_PATH);
  await page.waitForFunction(() => {
    const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
    return !!(data && data.curves && Object.keys(data.curves).length);
  }, null, { timeout: 15000 });

  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('tr.channel-row[data-channel]');
    for (const row of rows) {
      const channel = row.getAttribute('data-channel');
      if (channel !== 'C' && channel !== 'LK') continue;
      const input = row.querySelector('.percent-input');
      if (!input) return false;
      const value = Number(input.value);
      if (!(value > 0 && value < 100)) {
        return false;
      }
    }
    return true;
  }, null, { timeout: 5000 });

    const channelRows = await page.$$eval('tr.channel-row[data-channel]', (rows) => rows.map((row) => {
      const channel = row.getAttribute('data-channel');
      const percentInput = row.querySelector('.percent-input');
      const endInput = row.querySelector('.end-input');
      return {
        channel,
        percentValue: percentInput ? Number(percentInput.value) : null,
        endValue: endInput ? Number(endInput.value) : null
      };
    }));

    const relevant = channelRows.filter((row) => ['C', 'LK'].includes(row.channel || ''));
    expect(relevant.length).toBeGreaterThan(0);

    for (const row of relevant) {
      expect(row.percentValue).toBeGreaterThan(0);
      expect(row.percentValue).toBeLessThan(100);
      expect(row.endValue).toBeGreaterThan(0);
      expect(row.endValue).toBeLessThan(65535);
    }
  });
});
