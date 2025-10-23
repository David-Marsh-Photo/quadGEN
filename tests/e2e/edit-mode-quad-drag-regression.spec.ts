import { test, expect } from '@playwright/test';
import {
  gotoApp,
  loadQuadFixture,
  enableEditMode,
  enableSmartPointDragFlag,
  selectEditChannel,
  waitForSmartPoints,
  selectOrdinal,
  getSelectedPoint,
  getChannelPercentInfo
} from './utils/edit-mode-helpers';

test.describe('Edit Mode .quad ink-limit persistence', () => {
  test('dragging a Smart point preserves the raised ink limit', async ({ page }) => {
    await gotoApp(page);
    await loadQuadFixture(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await selectEditChannel(page, 'K');
    await waitForSmartPoints(page);
    await selectOrdinal(page, 4);

    const baselinePercent = await getChannelPercentInfo(page, 'K');
    expect(Number.isFinite(baselinePercent.value)).toBeTruthy();
    expect(Number.isFinite(baselinePercent.base)).toBeTruthy();
    expect(Number.isFinite(baselinePercent.endValue)).toBeTruthy();
    expect(Number.isFinite(baselinePercent.endBase)).toBeTruthy();

    const before = await getSelectedPoint(page);
    expect(before.channel).toBe('K');

    const targetOutput = Math.min(95, (baselinePercent.base ?? baselinePercent.value ?? 0) + 30);
    const dragResult = await page.evaluate(({ channel, ordinal, target }) => {
      const begin = typeof window.beginSmartPointDrag === 'function'
        ? window.beginSmartPointDrag(channel, ordinal)
        : { success: false, message: 'beginSmartPointDrag unavailable' };
      if (!begin?.success) {
        return { begin };
      }
      const update = typeof window.updateSmartPointDrag === 'function'
        ? window.updateSmartPointDrag(channel, ordinal, { outputPercent: target })
        : { success: false, message: 'updateSmartPointDrag unavailable' };
      const row = document.querySelector(`tr[data-channel="${channel}"]`);
      const percentInput = row?.querySelector('.percent-input') as HTMLInputElement | null;
      const endInput = row?.querySelector('.end-input') as HTMLInputElement | null;
      const percentAfterUpdate = {
        value: percentInput ? Number(percentInput.value ?? NaN) : NaN,
        base: percentInput ? Number(percentInput.getAttribute('data-base-percent') ?? NaN) : NaN,
        endValue: endInput ? Number(endInput.value ?? NaN) : NaN,
        endBase: endInput ? Number(endInput.getAttribute('data-base-end') ?? NaN) : NaN
      };
      const end = typeof window.endSmartPointDrag === 'function'
        ? window.endSmartPointDrag({ commit: true })
        : { success: false, message: 'endSmartPointDrag unavailable' };
      const percentAfterEnd = {
        value: percentInput ? Number(percentInput.value ?? NaN) : NaN,
        base: percentInput ? Number(percentInput.getAttribute('data-base-percent') ?? NaN) : NaN,
        endValue: endInput ? Number(endInput.value ?? NaN) : NaN,
        endBase: endInput ? Number(endInput.getAttribute('data-base-end') ?? NaN) : NaN
      };
      return { begin, update, end, percentAfterUpdate, percentAfterEnd };
    }, { channel: before.channel, ordinal: before.ordinal, target: targetOutput });

    expect(dragResult.begin?.success).toBeTruthy();
    expect(dragResult.update?.success).toBeTruthy();
    expect(dragResult.end?.success).toBeTruthy();

    const mutated = await getSelectedPoint(page);
    expect(mutated.absoluteOutput).toBeGreaterThan(before.absoluteOutput ?? 0);

    // Allow any drag-finalization handlers to run
    await page.waitForTimeout(150);

    const finalPercent = await getChannelPercentInfo(page, 'K');
    const percentIncrease = (finalPercent.value ?? 0) - (baselinePercent.value ?? 0);
    const percentBaseIncrease = (finalPercent.base ?? 0) - (baselinePercent.base ?? 0);
    const endIncrease = (finalPercent.endValue ?? 0) - (baselinePercent.endValue ?? 0);
    const endBaseIncrease = (finalPercent.endBase ?? 0) - (baselinePercent.endBase ?? 0);

    expect(percentIncrease).toBeGreaterThan(0.5);
    expect(percentBaseIncrease).toBeGreaterThan(0.5);
    expect(endIncrease).toBeGreaterThan(4000);
    expect(endBaseIncrease).toBeGreaterThan(4000);
  });
});
