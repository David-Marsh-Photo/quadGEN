import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';
import { getHistoryStackCounts } from '../utils/history-helpers';

test.describe('Batch operations history', () => {
  test('global scale applies as single undo action', async ({ page }) => {
    await loadHistoryFixture(page);

    const stacksBefore = await getHistoryStackCounts(page);

    await page.evaluate(() => {
      const scaleInput = document.getElementById('scaleAllInput') as HTMLInputElement | null;
      if (!scaleInput) throw new Error('Scale input not found');
      scaleInput.value = '90';
      scaleInput.dispatchEvent(new Event('input', { bubbles: true }));
      scaleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const stacksAfterScale = await getHistoryStackCounts(page);
    expect(stacksAfterScale.history).toBeGreaterThan(stacksBefore.history);

    const afterScaleShot = test.info().outputPath('batch-scale-applied.png');
    await page.screenshot({ path: afterScaleShot, fullPage: true });

    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) throw new Error('HistoryManager unavailable');
      history.undo();
    });

    const stacksAfterUndo = await getHistoryStackCounts(page);
    expect(stacksAfterUndo.history).toBe(stacksBefore.history);

    const afterUndoShot = test.info().outputPath('batch-scale-after-undo.png');
    await page.screenshot({ path: afterUndoShot, fullPage: true });
  });
});
