import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', 'data');
const QUAD_PATH = path.join(FIXTURE_ROOT, 'master.quad');
const CUBE_PATH = path.join(FIXTURE_ROOT, 'negative.cube');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', '..', 'index.html');

function channelRow(page, channel: string) {
  return page.locator(`tr.channel-row[data-channel="${channel}"]`);
}

test.describe('Channel ink limit indicators', () => {
  test('reflect effective ink after applying global correction', async ({ page }) => {
    await page.goto(FILE_URL);

    // Initial load has zeroed channels; ensure effective indicators are hidden
    const percentInput = channelRow(page, 'K').locator('.percent-input');
    const endInput = channelRow(page, 'K').locator('.end-input');
    const initialPercent = await percentInput.inputValue();
    const initialEnd = await endInput.inputValue();

    // Load the base .quad so inputs populate with source ink limits
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await expect(endInput).not.toHaveValue(initialEnd);
    const quadPercent = parseFloat(await percentInput.inputValue());
    const quadEnd = parseFloat(await endInput.inputValue());

    // Apply the negative cube correction
    await page.setInputFiles('#linearizationFile', CUBE_PATH);
    await expect(channelRow(page, 'K').locator('.processing-label')).toContainText(/negative\.cube/i);
    await expect.poll(async () => parseFloat(await percentInput.inputValue()), { timeout: 2000 })
      .toBeLessThan(quadPercent - 0.5);

    await expect.poll(async () => parseFloat(await endInput.inputValue()), { timeout: 2000 })
      .toBeLessThan(quadEnd - 500);
  });
});
