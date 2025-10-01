import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Edit Mode smart points align with .quad curves', () => {
  test('starter quad matches plotted curve', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const quadPath = resolve('data/Starter_P9000_QCDN_BTNS_copy.quad');

    await page.goto(indexUrl);
    await page.waitForFunction(() => window.elements?.rows?.children?.length > 0);

    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(() => window.loadedQuadData?.filename?.includes('Starter_P9000'));

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.());

    const mismatches = await page.evaluate(() => {
      const TOTAL = 65535;
      const channels = ['K', 'LK', 'LLK'];
      const deltas: Record<string, number[]> = {};

      channels.forEach(channel => {
        const points = window.ControlPoints?.get(channel)?.points || [];
        const row = document.querySelector(`tr.channel-row[data-channel="${channel}"]`);
        const endVal = Number(row?.querySelector('.end-input')?.value || 0);
        const values = window.make256 ? window.make256(endVal, channel, true) : [];
        const samples = values.map((value, idx) => ({
          input: (idx / (values.length - 1)) * 100,
          output: (value / TOTAL) * 100
        }));

        deltas[channel] = points.map(point => {
          const idx = Math.min(samples.length - 1, Math.round((point.input / 100) * (samples.length - 1)));
          const curveY = samples[idx]?.output ?? 0;
          return Math.abs(point.output - curveY);
        });
      });

      return deltas;
    });

    Object.entries(mismatches).forEach(([channel, diffs]) => {
      diffs.forEach((delta, ordinal) => {
        expect(delta, `${channel} point ${ordinal + 1} mismatch ${delta}`).toBeLessThan(0.2);
      });
    });
  });
});

