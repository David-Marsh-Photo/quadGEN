import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { waitForScaleComplete, captureScalingState, compareScalingStates } from '../utils/scaling-test-helpers';

const SCALE_INPUT = '#scaleAllInput';

async function getHistorySnapshot(page) {
  return page.evaluate(() => {
    const manager = typeof window.getHistoryManager === 'function' ? window.getHistoryManager() : null;
    return {
      length: manager?.history?.length ?? 0,
      undoEnabled: !(document.getElementById('undoBtn') as HTMLButtonElement | null)?.disabled,
      redoEnabled: !(document.getElementById('redoBtn') as HTMLButtonElement | null)?.disabled,
    };
  });
}

test.describe('Global scale rapid scrub history', () => {
  test('rapid slider scrub preserves history and undo restores baseline', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const initialState = await captureScalingState(page);
    expect(initialState.scalePercent).toBe(100);

    const historyBefore = await getHistorySnapshot(page);

    const scaleAfter50 = await page.evaluate(() => {
      window.applyGlobalScale?.(50);
      return window.getCurrentScale?.() ?? null;
    });
    expect(scaleAfter50).toBe(50);

    const scaleAfter100 = await page.evaluate(() => {
      window.applyGlobalScale?.(100);
      return window.getCurrentScale?.() ?? null;
    });
    expect(scaleAfter100).toBe(100);

    await page.waitForFunction(
      () => !(document.getElementById('undoBtn') as HTMLButtonElement | null)?.disabled,
      null,
      { timeout: 10_000 }
    );

    const historyAfterScrub = await getHistorySnapshot(page);
    expect(historyAfterScrub.length).toBeGreaterThanOrEqual(historyBefore.length + 1);
    expect(historyAfterScrub.undoEnabled).toBe(true);

    const afterScrubState = await captureScalingState(page);
    expect(afterScrubState.scalePercent).toBe(100);

    // Undo should move back to 50%
    await page.evaluate(() => (window as typeof window & { undo?: () => void }).undo?.());
    const afterFirstUndo = await captureScalingState(page);

    let restoredState = afterFirstUndo;
    if (typeof afterFirstUndo.scalePercent === 'number' && Math.abs(afterFirstUndo.scalePercent - 50) <= 0.5) {
      await page.evaluate(() => (window as typeof window & { undo?: () => void }).undo?.());
      const afterSecondUndo = await captureScalingState(page);
      expect(afterSecondUndo.scalePercent).toBe(100);
      restoredState = afterSecondUndo;
    } else {
      expect(afterFirstUndo.scalePercent).toBe(100);
    }

    const diff = compareScalingStates(initialState, restoredState);
    expect(diff.scaleDelta).toBe(0);
    for (const change of diff.channelChanges) {
      expect(Math.abs(change.percentDelta ?? 0)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(change.endDelta ?? 0)).toBeLessThanOrEqual(1);
    }

    const historyAfterUndo = await getHistorySnapshot(page);
  });
});
