import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const KCLK_QUAD = path.join(DATA_ROOT, 'KCLK.quad');
const FILE_URL = 'file://' + path.join(PROJECT_ROOT, 'index.html');
const TARGET_CHANNEL = 'C';
const TARGET_POINT_INDEX = 10; // 1-based ordinal 11
const POINT_DELTA_EPS = 0.05;

test.use({ headless: false });

async function waitForPointInputChange(page, previousInput) {
  const handle = await page.waitForFunction(
    ({ prev, index, epsilon }) => {
      const entry = window.ControlPoints?.get?.('C');
      if (!entry?.points || entry.points.length <= index) {
        return null;
      }
      const next = Number(entry.points[index].input);
      if (!Number.isFinite(next)) {
        return null;
      }
      if (!Number.isFinite(prev) || Math.abs(next - prev) >= epsilon) {
        return next;
      }
      return null;
    },
    { prev: previousInput, index: TARGET_POINT_INDEX, epsilon: POINT_DELTA_EPS },
    { timeout: 7000 }
  );
  return handle.jsonValue();
}

async function readTargetPointInput(page) {
  return page.evaluate(
    index => window.ControlPoints?.get?.('C')?.points?.[index]?.input ?? null,
    TARGET_POINT_INDEX
  );
}

test.describe('Bell width left slope responsiveness', () => {
  test('point 11 decreases immediately on first left-width minus nudge', async ({ page }, testInfo) => {
    await page.goto(FILE_URL);

    await page.setInputFiles('#quadFile', KCLK_QUAD);

    await page.waitForFunction(() => {
      const win = window;
      const meta = win.getChannelShapeMeta?.();
      const data = win.getLoadedQuadData?.();
      return (
        !!data &&
        /KCLK/i.test(data.filename || '') &&
        meta?.C?.classification === 'bell' &&
        Number.isFinite(meta?.C?.peakIndex)
      );
    });

    await page.click('#editModeToggleBtn');
    await page.waitForFunction(() => document.querySelector('#editModeToggleBtn')?.getAttribute('aria-pressed') === 'true');

    await page.selectOption('#editChannelSelect', TARGET_CHANNEL);
    await expect(page.locator('#editBellWidthContainer')).toBeVisible();

    await page.waitForFunction(
      index => {
        const entry = window.ControlPoints?.get?.('C');
        return !!entry?.points && entry.points.length > index;
      },
      TARGET_POINT_INDEX
    );

    const leftInc = page.locator('#bellWidthLeftInc');
    const leftDec = page.locator('#bellWidthLeftDec');

    const incrementPositions = [];
    let currentInput = Number(await readTargetPointInput(page));
    expect(Number.isFinite(currentInput)).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      await leftInc.click();
      const nextInput = Number(await waitForPointInputChange(page, currentInput));
      incrementPositions.push(nextInput);
      expect(nextInput).toBeGreaterThan(currentInput ?? 0);
      currentInput = nextInput;
    }

    const screenshotPath = testInfo.outputPath('bell-width-point11-before-dec.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach('bell-width-point11-before-dec', { path: screenshotPath, contentType: 'image/png' });
    const artifactDir = path.join(PROJECT_ROOT, 'test-screenshots');
    await fs.promises.mkdir(artifactDir, { recursive: true });
    await fs.promises.copyFile(screenshotPath, path.join(artifactDir, 'bell-width-point11-before-dec.png'));

    const beforeDecrease = currentInput;
    const metaBeforeDecrease = await page.evaluate(() => window.getChannelShapeMeta?.()?.C?.bellWidthScale ?? null);
    await leftDec.click();
    const afterDecrease = Number(await waitForPointInputChange(page, beforeDecrease));
    const metaAfterDecrease = await page.evaluate(() => window.getChannelShapeMeta?.()?.C?.bellWidthScale ?? null);

    await testInfo.attach(
      'bell-width-point11-trace',
      {
        body: JSON.stringify(
          {
            increments: incrementPositions,
            beforeDecrease,
            afterDecrease,
            metaBeforeDecrease,
            metaAfterDecrease
          },
          null,
          2
        ),
        contentType: 'application/json'
      }
    );

    expect(metaBeforeDecrease?.leftFactor ?? 0).toBeGreaterThan(metaAfterDecrease?.leftFactor ?? 0);
    expect(afterDecrease).toBeLessThan(beforeDecrease - POINT_DELTA_EPS);
  });
});
