import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const STORAGE_KEY = 'quadgen.channelDensity.v1';

test.describe('Channel density defaults', () => {
  test('restores studio defaults when stored values collapse to zero', async ({ page }) => {
    const seededPayload = JSON.stringify({
      auto: true,
      channels: {
        C: { value: 0.002, source: 'solver' },
        LK: { value: 0.002, source: 'solver' }
      }
    });

    await page.addInitScript(([key, value]) => {
      window.localStorage.setItem(key, value);
    }, [STORAGE_KEY, seededPayload]);

    await page.goto(indexUrl);

    await page.waitForSelector('.disabled-channel-chip[data-channel="C"]');
    await page.waitForSelector('.disabled-channel-chip[data-channel="LK"]');

    await page.click('.disabled-channel-chip[data-channel="C"]');
    await page.click('.disabled-channel-chip[data-channel="LK"]');

    const cDensity = await page.$eval(
      'tr.channel-row[data-channel="C"] .density-input',
      (input) => ({ value: input.value, source: input.dataset.densitySource })
    );
    const lkDensity = await page.$eval(
      'tr.channel-row[data-channel="LK"] .density-input',
      (input) => ({ value: input.value, source: input.dataset.densitySource })
    );

    expect(cDensity.value).toBe('0.21');
    expect(cDensity.source).toBe('default');
    expect(lkDensity.value).toBe('0.054');
    expect(lkDensity.source).toBe('default');
  });
});
