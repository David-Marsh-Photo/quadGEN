import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Edit Mode nudges', () => {
  test('vertical nudge should not shift X coordinate', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn');

    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.setInputFiles('input#linearizationFile', manualLabPath);
    await page.waitForFunction(
      () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
      null,
      { timeout: 15000 },
    );

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });

    // Step once to reach Smart point ordinal 2 (first interior point in MK curve)
    await page.locator('#editPointRight').click();
    await page.waitForFunction(() => (window as any).EDIT?.selectedOrdinal === 2, undefined, { timeout: 2000 });

    const before = await page.evaluate(() => {
      const channel = window.EDIT?.selectedChannel;
      const points = window.ControlPoints?.get(channel)?.points || [];
      const selectedIdx = (window.EDIT?.selectedOrdinal ?? 1) - 1;
      const point = points[selectedIdx];
      return {
        channel,
        ordinal: window.EDIT?.selectedOrdinal ?? 1,
        input: point?.input,
        output: point?.output,
      };
    });

    await page.locator('#editNudgeYUp').click();
    await page.waitForFunction((prev) => {
      const channel = (window as any).EDIT?.selectedChannel;
      const ordinal = (window as any).EDIT?.selectedOrdinal ?? 1;
      const points = (window as any).ControlPoints?.get(channel)?.points || [];
      const point = points[ordinal - 1];
      return point && Math.abs(point.output - prev.output) > 0.01;
    }, before, { timeout: 5000 });

    const after = await page.evaluate(() => {
      const channel = window.EDIT?.selectedChannel;
      const points = window.ControlPoints?.get(channel)?.points || [];
      const selectedIdx = (window.EDIT?.selectedOrdinal ?? 1) - 1;
      const point = points[selectedIdx];
      const xyField = document.getElementById('editXYInput') as HTMLInputElement | null;
      return {
        channel,
        ordinal: window.EDIT?.selectedOrdinal ?? 1,
        input: point?.input,
        output: point?.output,
        xyDisplay: xyField?.value ?? '',
      };
    });

    console.log('[nudge test] before', before);
    console.log('[nudge test] after', after);

    expect(after.channel).toBe(before.channel);
    expect(after.ordinal).toBe(before.ordinal);
    expect(after.output).not.toBeCloseTo(before.output ?? Number.NaN, 3);
    // Expected behaviour: input stays fixed when Y is nudged.
    expect(after.input).toBeCloseTo(before.input ?? Number.NaN, 3);
  });

  test('vertical nudge respects 1% step even when channel end < 100 and zoomed', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn');

    const quadPath = resolve('data/P800_K37_C26_LK25_V1.quad');
    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(
      () => window.loadedQuadData?.channels?.includes?.('LK'),
      undefined,
      { timeout: 15000 },
    );

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    await page.selectOption('#editChannelSelect', 'LK');
    await page.waitForFunction(
      () => window.ControlPoints?.get('LK')?.points?.length >= 3,
      undefined,
      { timeout: 10000 },
    );

    // Move to an interior point to avoid endpoint locks
    await page.locator('#editPointRight').click();
    await page.waitForFunction(() => (window as any).EDIT?.selectedOrdinal === 2, undefined, { timeout: 2000 });

    // Zoom in to mirror the user scenario where scaling was amplified
    await page.locator('#chartZoomInBtn').click();

    const before = await page.evaluate(() => {
      const channel = window.EDIT?.selectedChannel ?? null;
      const ordinal = window.EDIT?.selectedOrdinal ?? 1;
      const points = window.ControlPoints?.get(channel)?.points || [];
      const point = points[ordinal - 1] || null;
      return {
        channel,
        ordinal,
        output: point?.output,
        channelPercent: parseFloat((document.querySelector(`tr[data-channel="${channel}"] .percent-input`) as HTMLInputElement | null)?.value ?? '0') || 0,
      };
    });

    await page.locator('#editNudgeYUp').click();
    await page.waitForFunction((prev) => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const ordinal = (window as any).EDIT?.selectedOrdinal ?? 1;
      const points = (window as any).ControlPoints?.get(channel)?.points || [];
      const point = points[ordinal - 1] || null;
      return point && Math.abs(point.output - prev.output) > 0.01;
    }, before, { timeout: 5000 });

    const after = await page.evaluate(() => {
      const channel = window.EDIT?.selectedChannel ?? null;
      const ordinal = window.EDIT?.selectedOrdinal ?? 1;
      const points = window.ControlPoints?.get(channel)?.points || [];
      const point = points[ordinal - 1] || null;
      return {
        channel,
        ordinal,
        output: point?.output,
        channelPercent: parseFloat((document.querySelector(`tr[data-channel="${channel}"] .percent-input`) as HTMLInputElement | null)?.value ?? '0') || 0,
      };
    });

    const beforeOutput = before.output ?? Number.NaN;
    const afterOutput = after.output ?? Number.NaN;
    const delta = afterOutput - beforeOutput;

    expect(after.channel).toBe(before.channel);
    expect(after.ordinal).toBe(before.ordinal);
    expect(delta).toBeGreaterThan(0.9);
  });
});
