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

async function getChannelState(page, channel = 'K') {
  return page.evaluate((ch) => {
    const row = document.querySelector(`tr.channel-row[data-channel="${ch}"]`);
    const percentInput = row?.querySelector('.percent-input') as HTMLInputElement | null;
    const endInput = row?.querySelector('.end-input') as HTMLInputElement | null;
    const helpers = (window as typeof window & { __quadDebug?: any; make256?: any }).__quadDebug?.processingPipeline;
    const makeFn = helpers?.make256 || (window as typeof window & { make256?: any }).make256;
    const effectiveEnd = parseFloat(endInput?.value || 'NaN');
    const curve = typeof makeFn === 'function' ? makeFn(effectiveEnd, ch, true) : [];
    const maxValue = curve.length ? Math.max(...curve) : 0;
    const maxPercent = curve.length ? (maxValue / 65535) * 100 : 0;
    return {
      effectivePercent: parseFloat(percentInput?.value || 'NaN'),
      basePercent: parseFloat(percentInput?.getAttribute('data-base-percent') || 'NaN'),
      effectiveEnd,
      baseEnd: parseFloat(endInput?.getAttribute('data-base-end') || 'NaN'),
      maxPercent,
    };
  }, channel);
}

test.describe('Channel ink limit indicators', () => {
  test('reflect effective ink after applying global correction', async ({ page }) => {
    await page.goto(FILE_URL);

    const percentInput = channelRow(page, 'K').locator('.percent-input');
    const endInput = channelRow(page, 'K').locator('.end-input');
    const initialPercent = parseFloat(await percentInput.inputValue());
    const initialEnd = parseFloat(await endInput.inputValue());

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await expect(percentInput).not.toHaveValue(initialPercent.toString());
    await expect(endInput).not.toHaveValue(initialEnd.toString());
    const quadPercent = parseFloat(await percentInput.inputValue());
    const quadEnd = parseFloat(await endInput.inputValue());

    await page.setInputFiles('#linearizationFile', CUBE_PATH);
    await expect(channelRow(page, 'K').locator('.processing-label')).toContainText(/negative\.cube/i);

    await expect.poll(async () => parseFloat(await percentInput.inputValue()), { timeout: 2_000 })
      .toBeLessThan(quadPercent - 0.5);

    await expect.poll(async () => parseFloat(await endInput.inputValue()), { timeout: 2_000 })
      .toBeLessThan(quadEnd - 500);
  });

  test('percent nudge lowers effective ink but remains in sync with base curve', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.setInputFiles('#linearizationFile', CUBE_PATH);

    const percentInput = channelRow(page, 'K').locator('.percent-input');
    const endInput = channelRow(page, 'K').locator('.end-input');

    await expect(percentInput).toBeVisible();
    await expect(endInput).toBeVisible();

    const beforeState = await getChannelState(page);

    await percentInput.focus();
    await page.keyboard.press('ArrowUp');

    await page.waitForTimeout(200);
    const afterState = await getChannelState(page);

    expect(afterState.effectivePercent).toBeLessThan(beforeState.effectivePercent + 0.2);
    expect(afterState.basePercent).toBeLessThan(beforeState.basePercent - 0.2);
    expect(afterState.effectiveEnd).toBeLessThan(beforeState.effectiveEnd - 1000);
    expect(afterState.baseEnd).toBeLessThan(beforeState.baseEnd - 1000);
  });

  test('percent nudges keep reducing the high-end curve', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.setInputFiles('#linearizationFile', CUBE_PATH);

    const percentSelector = 'tr.channel-row[data-channel="K"] .percent-input';

    await page.waitForTimeout(200);
    const initialPercent = parseFloat(await page.locator(percentSelector).inputValue());
    expect(initialPercent).toBeLessThan(50);

    let snapshot = await getChannelState(page);

    for (let i = 0; i < 10; i += 1) {
      await page.focus(percentSelector);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Tab');

      await page.waitForTimeout(200);
      snapshot = await getChannelState(page);

      expect(snapshot.basePercent).toBeLessThan(initialPercent - (i + 1));
      expect(snapshot.effectivePercent).toBeLessThan(initialPercent - (i + 1));
      expect(snapshot.maxPercent).toBeLessThanOrEqual(initialPercent);
    }
  });
});
