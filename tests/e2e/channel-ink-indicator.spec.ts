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

    const percentInput = channelRow(page, 'K').locator('.percent-input');
    const endInput = channelRow(page, 'K').locator('.end-input');
    const initialPercent = await percentInput.inputValue();
    const initialEnd = await endInput.inputValue();

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await expect(endInput).not.toHaveValue(initialEnd);
    const quadPercent = parseFloat(await percentInput.inputValue());
    const quadEnd = parseFloat(await endInput.inputValue());

    await page.setInputFiles('#linearizationFile', CUBE_PATH);
    await expect(channelRow(page, 'K').locator('.processing-label')).toContainText(/negative\.cube/i);

    await expect.poll(async () => parseFloat(await percentInput.inputValue()), { timeout: 2000 })
      .toBeLessThan(quadPercent - 0.5);

    await expect.poll(async () => parseFloat(await endInput.inputValue()), { timeout: 2000 })
      .toBeLessThan(quadEnd - 500);
  });

  test('percent nudge increases effective ink after correction', async ({ page }) => {
    await page.goto(FILE_URL);

    const kRow = channelRow(page, 'K');
    const percentInput = kRow.locator('.percent-input');
    const endInput = kRow.locator('.end-input');

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await expect(percentInput).toBeVisible();
    await expect(endInput).toBeVisible();
    const quadPercent = parseFloat(await percentInput.inputValue());

    await page.setInputFiles('#linearizationFile', CUBE_PATH);
    await expect.poll(async () => parseFloat(await percentInput.inputValue()), { timeout: 2000 })
      .toBeLessThan(quadPercent - 0.5);

    const effectiveBefore = parseFloat(await percentInput.inputValue());

    await percentInput.focus();
    await page.keyboard.press('ArrowUp');

    await expect.poll(async () => parseFloat(await percentInput.inputValue()), { timeout: 2000 })
      .toBeGreaterThan(effectiveBefore - 0.1);

    const effectiveAfter = parseFloat(await percentInput.inputValue());
    expect(effectiveAfter).toBeGreaterThanOrEqual(effectiveBefore);
  });

  test('percent nudges keep expanding the high-end curve', async ({ page }) => {
    await page.goto(FILE_URL);

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.setInputFiles('#linearizationFile', CUBE_PATH);

    const percentSelector = 'tr.channel-row[data-channel="K"] .percent-input';
    const endSelector = 'tr.channel-row[data-channel="K"] .end-input';

    await page.waitForSelector(percentSelector, { state: 'attached' });
    await expect.poll(async () => parseFloat(await page.locator(percentSelector).inputValue()), { timeout: 2000 })
      .toBeLessThan(50);

    const sampleState = async () => {
      return await page.evaluate(({ percentSelector, endSelector }) => {
        const percentInput = document.querySelector(percentSelector);
        const endInput = document.querySelector(endSelector);
        if (!percentInput || !endInput) {
          throw new Error('Channel inputs not found');
        }

        const basePercent = parseFloat(percentInput.getAttribute('data-base-percent') || '0');
        const effectivePercent = parseFloat(percentInput.value || '0');
        const baseEnd = parseFloat(endInput.getAttribute('data-base-end') || '0');
        const effectiveEnd = parseFloat(endInput.value || '0');

        const helpers = window.__quadDebug?.processingPipeline;
        if (!helpers || typeof helpers.make256 !== 'function') {
          throw new Error('processingPipeline.make256 unavailable');
        }

        const curve = helpers.make256(baseEnd, 'K', true) || [];
        const maxValue = curve.length ? Math.max(...curve) : 0;
        const maxPercent = curve.length ? (maxValue / 65535) * 100 : 0;
        const tail = curve.slice(-16);
        const uniqueTail = tail.length ? new Set(tail).size : 0;

        return {
          basePercent,
          effectivePercent,
          baseEnd,
          effectiveEnd,
          maxPercent,
          uniqueTail
        };
      }, { percentSelector, endSelector });
    };

    let snapshot = await sampleState();
    let previousBasePercent = snapshot.basePercent;

    for (let i = 0; i < 10; i += 1) {
      await page.focus(percentSelector);
      await page.keyboard.press('ArrowUp');
      const immediate = await page.evaluate(({ percentSelector, endSelector }) => {
        const percentInput = document.querySelector(percentSelector);
        const endInput = document.querySelector(endSelector);
        return {
          effectivePercent: parseFloat(percentInput?.value || 'NaN'),
          effectiveEnd: parseFloat(endInput?.value || 'NaN'),
          basePercent: parseFloat(percentInput?.getAttribute('data-base-percent') || 'NaN'),
          baseEnd: parseFloat(endInput?.getAttribute('data-base-end') || 'NaN')
        };
      }, { percentSelector, endSelector });

      await expect(immediate.effectivePercent).toBeGreaterThan(snapshot.effectivePercent - 0.1);
      await expect(Math.abs(immediate.basePercent - immediate.effectivePercent)).toBeLessThan(0.5);

      await page.keyboard.press('Tab');

      await expect.poll(async () => (await sampleState()).effectivePercent, { timeout: 2000 })
        .toBeGreaterThan(snapshot.effectivePercent - 0.05);

      await expect.poll(async () => (await sampleState()).maxPercent, { timeout: 2000 })
        .toBeGreaterThan(snapshot.maxPercent - 0.05);

      snapshot = await sampleState();

      expect(snapshot.basePercent).toBeGreaterThan(previousBasePercent + 0.2);

      previousBasePercent = snapshot.basePercent;
    }
  });
});
