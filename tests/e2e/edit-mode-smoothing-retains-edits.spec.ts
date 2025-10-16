import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import {
  gotoApp,
  enableEditMode,
  enableSmartPointDragFlag,
  waitForSmartPoints,
  selectOrdinal,
  getSelectedPoint
} from './utils/edit-mode-helpers';

async function setRangeValue(page, selector: string, value: number) {
  await page.locator(selector).evaluate((input, nextValue) => {
    const slider = input as HTMLInputElement;
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function waitForPlotSmoothingPercent(page, expected: number) {
  await page.waitForFunction(
    (target) => {
      const valueText = document.getElementById('plotSmoothingPercentValue')?.textContent ?? '';
      return valueText.startsWith(`${target}%`);
    },
    expected,
    { timeout: 5000 }
  );
}

async function captureSelectedChannelCurve(page) {
  return page.evaluate(() => {
    const channel = (window as any).EDIT?.selectedChannel ?? null;
    if (!channel) return null;
    const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
    if (!loaded || !loaded.curves || !Array.isArray(loaded.curves[channel])) {
      return null;
    }
    return Array.from(loaded.curves[channel], (value) => Number(value) || 0);
  });
}

test.describe('Plot smoothing during Smart edits', () => {
  test('Smart-point edits persist after smoothing toggles back to zero', async ({ page }) => {
    await gotoApp(page);
    await page.setInputFiles('#quadFile', resolve('data/P800_K36C26LK25_V6.quad'));
    await page.waitForFunction(
      () => {
        const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
        return data && data.curves && Object.keys(data.curves).length > 0;
      },
      undefined,
      { timeout: 10000 }
    );
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);
    await selectOrdinal(page, 4);

    await setRangeValue(page, '#plotSmoothingPercentSlider', 50);
    await waitForPlotSmoothingPercent(page, 50);
    await setRangeValue(page, '#plotSmoothingPercentSlider', 0);
    await waitForPlotSmoothingPercent(page, 0);

    const baselineCurve = await captureSelectedChannelCurve(page);
    expect(baselineCurve).not.toBeNull();

    const before = await getSelectedPoint(page);
    expect(before.channel).not.toBeNull();
    const channel = before.channel!;

    const mutation = await page.evaluate(() => {
      const selectedChannel = (window as any).EDIT?.selectedChannel ?? null;
      const selectedOrdinal = (window as any).EDIT?.selectedOrdinal ?? 1;
      if (!selectedChannel) {
        return { success: false, before: null, after: null };
      }
      const points = (window as any).ControlPoints?.get(selectedChannel)?.points || [];
      const beforePoint = points[selectedOrdinal - 1] || null;
      const result = typeof (window as any).adjustSmartKeyPointByIndex === 'function'
        ? (window as any).adjustSmartKeyPointByIndex(selectedChannel, selectedOrdinal, { deltaOutput: -8 })
        : { success: false };
      const refreshed = (window as any).ControlPoints?.get(selectedChannel)?.points || [];
      const afterPoint = refreshed[selectedOrdinal - 1] || null;
      return { success: !!result?.success, before: beforePoint, after: afterPoint, channel: selectedChannel, ordinal: selectedOrdinal };
    });

    expect(mutation.success).toBeTruthy();
    expect(mutation.after).not.toBeNull();
    expect(mutation.before).not.toBeNull();
    expect(mutation.after?.output).not.toBeCloseTo(mutation.before?.output ?? NaN, 4);

    const editedCurve = await captureSelectedChannelCurve(page);
    expect(editedCurve).not.toBeNull();
    expect(editedCurve).not.toEqual(baselineCurve);

    await setRangeValue(page, '#plotSmoothingPercentSlider', 80);
    await waitForPlotSmoothingPercent(page, 80);

    await setRangeValue(page, '#plotSmoothingPercentSlider', 0);
    await waitForPlotSmoothingPercent(page, 0);

    const restoredCurve = await captureSelectedChannelCurve(page);
    expect(restoredCurve).not.toBeNull();
    expect(restoredCurve).toEqual(editedCurve);
    expect(restoredCurve).not.toEqual(baselineCurve);
  });
});
