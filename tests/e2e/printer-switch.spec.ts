import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INITIAL_CHANNELS = ['K', 'C', 'M', 'Y', 'LC', 'LM', 'LK', 'LLK', 'V', 'MK'];
const SWITCHED_CHANNELS = ['K', 'C', 'M', 'Y', 'LC', 'LM', 'LK', 'LLK', 'OR', 'GR'];

async function getChannelOrder(page) {
  return page.$$eval('#rows tr[data-channel]', rows =>
    rows.map(row => row.getAttribute('data-channel') || ''),
  );
}

test.describe('Printer switching', () => {
  test('rebuilds channel rows and updates filename', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#rows tr[data-channel]');

    const initialChannels = await getChannelOrder(page);
    expect(initialChannels).toEqual(INITIAL_CHANNELS);

    await page.selectOption('#printerSelect', 'P5-7-9000');

    await page.waitForFunction(() => {
      const rows = Array.from(
        document.querySelectorAll('#rows tr[data-channel]'),
      );
      if (rows.length !== 10) return false;
      return rows.at(-1)?.getAttribute('data-channel') === 'GR';
    });

    const switchedChannels = await getChannelOrder(page);
    expect(switchedChannels).toEqual(SWITCHED_CHANNELS);

    const legendText = await page.locator('#channelInfo').innerText();
    expect(legendText).toContain('OR');
    expect(legendText).toContain('GR');

    const filenameValue = await page.locator('#filenameInput').inputValue();
    expect(filenameValue.startsWith('P5-7-9000_K100')).toBeTruthy();
  });
});
