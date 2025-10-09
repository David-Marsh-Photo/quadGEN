import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { waitForScaleComplete, captureScalingState, compareScalingStates } from '../utils/scaling-test-helpers';

const MK_CHANNEL_SELECTOR = 'tr[data-channel="MK"]';

async function ensurePercentValue(page, selector, expected) {
  await expect
    .poll(
      async () => {
        return page.evaluate((sel) => {
          const input = document.querySelector(sel) as HTMLInputElement | null;
          if (!input) return Number.NaN;
          return parseFloat(input.value);
        }, selector);
      },
      { timeout: 10_000, message: `Waiting for ${selector} to reach ~${expected}` }
    )
    .toBeCloseTo(expected, 1);
}

test.describe('Global scale baseline drift', () => {
  test('manual edit under scaled state preserves baseline when returning to 100%', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const initialState = await captureScalingState(page);

    await page.evaluate(() => window.applyGlobalScale?.(80));
    await waitForScaleComplete(page, 80);
    await ensurePercentValue(page, `${MK_CHANNEL_SELECTOR} .percent-input`, 80);

    const postEditState = await captureScalingState(page);

    await page.evaluate(() => window.applyGlobalScale?.(100));
    await waitForScaleComplete(page, 100);
    await ensurePercentValue(page, `${MK_CHANNEL_SELECTOR} .percent-input`, 100);

    const finalState = await captureScalingState(page);
    const baselineDiff = compareScalingStates(initialState, finalState);
    const editDiff = compareScalingStates(postEditState, finalState);

    expect(baselineDiff.afterScale).toBe(100);
    expect(baselineDiff.scaleDelta).toBe(0);

    const mkFinal = finalState.rows.find((row) => row.channel === 'MK');
    expect(mkFinal).toBeTruthy();
    expect(mkFinal?.percentValue).toBeCloseTo(100, 1);

    const mkPostEdit = postEditState.rows.find((row) => row.channel === 'MK');
    expect(mkPostEdit).toBeTruthy();
    expect(mkPostEdit?.percentValue).toBeCloseTo(80, 1);

    const mkBaselineChange = baselineDiff.channelChanges.find((change) => change.channel === 'MK');
    expect(mkBaselineChange?.percentDelta).toBeCloseTo(0, 1);

    const mkEditChange = editDiff.channelChanges.find((change) => change.channel === 'MK');
    expect(mkEditChange?.percentDelta).toBeCloseTo(20, 1);

    // Other channels should return to original values after the 100% scale
    for (const change of baselineDiff.channelChanges) {
      if (change.channel === 'MK') continue;
      expect(Math.abs(change.endDelta)).toBeLessThanOrEqual(1);
      expect(Math.abs(change.percentDelta)).toBeLessThanOrEqual(0.1);
    }

    for (const change of editDiff.channelChanges) {
      if (change.channel === 'MK') continue;
      expect(Math.abs(change.percentDelta)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(change.endDelta)).toBeLessThanOrEqual(1);
    }
  });
});
