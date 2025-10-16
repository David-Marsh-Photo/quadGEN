import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');
const labPath = resolve('data/TRIFORCE_V4.txt');
const CURVE_RESOLUTION = 256;
const MAX_ALLOWED_JUMP = 4000;

async function waitForCurves(page) {
  await page.waitForFunction(
    (expectedLength) => {
      const data = window.getLoadedQuadData?.();
      if (!data?.curves) return false;
      return Object.values(data.curves).some(
        (arr) => Array.isArray(arr) && arr.length === expectedLength
      );
    },
    CURVE_RESOLUTION,
    { timeout: 20000 }
  );
}

test.describe('TRIFORCE V4 global correction spikes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, {
      timeout: 20000
    });
  });

  test('corrected curves remain smooth without spikes', async ({ page }) => {
    await page.setInputFiles('#quadFile', quadPath);
    await waitForCurves(page);

    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );
    await waitForCurves(page);

    const analysis = await page.evaluate((maxAllowedJump) => {
      const result = {
        failures: [],
        inspectedChannels: []
      };

      const data = window.getLoadedQuadData?.();
      if (!data?.curves) {
        result.failures.push({ reason: 'missingCurves' });
        return result;
      }

      for (const [channel, raw] of Object.entries(data.curves)) {
        const values = Array.from(raw);
        if (!values.length) continue;

        const peak = values.reduce((p, value) => (value > p ? value : p), 0);
        if (peak === 0) continue;

        let maxJump = -Infinity;
        let minJump = Infinity;
        let maxIndex = -1;
        let minIndex = -1;
        for (let idx = 1; idx < values.length; idx += 1) {
          const jump = values[idx] - values[idx - 1];
          if (jump > maxJump) {
            maxJump = jump;
            maxIndex = idx;
          }
          if (jump < minJump) {
            minJump = jump;
            minIndex = idx;
          }
        }

        const maxAbsJump = Math.max(Math.abs(maxJump), Math.abs(minJump));
        result.inspectedChannels.push({
          channel,
          maxJump,
          minJump,
          maxIndex,
          minIndex,
          peak,
          maxAbsJump
        });

        if (maxAbsJump > maxAllowedJump) {
          const surrounding = (targetIndex) => {
            if (targetIndex < 0) return [];
            const start = Math.max(0, targetIndex - 3);
            const end = Math.min(values.length, targetIndex + 4);
            const points = [];
            for (let i = start; i < end; i += 1) {
              points.push({
                index: i,
                value: values[i]
              });
            }
            return points;
          };

          result.failures.push({
            channel,
            maxAllowedJump,
            maxJump,
            minJump,
            maxIndex,
            minIndex,
            peak,
            maxSegment: surrounding(maxIndex),
            minSegment: surrounding(minIndex)
          });
        }
      }

      return result;
    }, MAX_ALLOWED_JUMP);

    expect(analysis.failures).toEqual([]);
  });
});
