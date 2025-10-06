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
    await expect(channelRow(page, 'K').locator('[data-effective-percent]')).toBeHidden();
    await expect(channelRow(page, 'K').locator('[data-effective-end]')).toBeHidden();

    // Load the base .quad so inputs populate with source ink limits
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await expect(channelRow(page, 'K').locator('.end-input')).toHaveValue(/\d+/);

    // Effective indicators are still hidden because no correction applied yet
    await expect(channelRow(page, 'K').locator('[data-effective-percent]')).toBeHidden();

    // Apply the negative cube correction
    await page.setInputFiles('#linearizationFile', CUBE_PATH);
    await expect(channelRow(page, 'K').locator('.processing-label')).toContainText(/negative\.cube/i);

    const effectivePercent = channelRow(page, 'K').locator('[data-effective-percent]');
    const effectiveEnd = channelRow(page, 'K').locator('[data-effective-end]');

    await expect(effectivePercent).toBeVisible();
    await expect(effectivePercent).toContainText('Effective:');
    await expect(effectiveEnd).toBeVisible();
    await expect(effectiveEnd).toContainText('Effective:');

    // The tooltip on the percent input should advertise base vs effective totals
    await expect(channelRow(page, 'K').locator('.percent-input')).toHaveAttribute('title', /Effective:/);
    await expect(channelRow(page, 'K').locator('.end-input')).toHaveAttribute('title', /Effective:/);
  });
});
