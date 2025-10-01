import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';
import { getHistoryStackCounts } from '../utils/history-helpers';

test.describe('Channel slider history coverage', () => {
  test('percentage changes record undoable entries', async ({ page }) => {
    await loadHistoryFixture(page);

    const stacksBefore = await getHistoryStackCounts(page);

    await page.evaluate(() => {
      const manager = (window as typeof window & { getStateManager?: () => any }).getStateManager?.();
      if (!manager) {
        throw new Error('StateManager not available');
      }
      manager.setChannelValue('K', 'percentage', 25);
    });

    const stacksAfterChange = await getHistoryStackCounts(page);
    expect(stacksAfterChange.history).toBeGreaterThan(stacksBefore.history);

    await page.evaluate(() => {
      const manager = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!manager) {
        throw new Error('HistoryManager not available');
      }
      manager.undo();
    });

    const stacksAfterUndo = await getHistoryStackCounts(page);
    expect(stacksAfterUndo.history).toBe(stacksBefore.history);
  });
});
