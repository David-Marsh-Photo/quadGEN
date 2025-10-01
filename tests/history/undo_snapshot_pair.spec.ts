import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';

test.describe('Snapshot pairing behavior', () => {
  test('undo restores the matching "Before" snapshot', async ({ page }) => {
    await loadHistoryFixture(page);

    const baselinePercent = await page.evaluate(() => {
      const api = window as typeof window & { getStateManager?: () => any };
      const stateManager = typeof api.getStateManager === 'function' ? api.getStateManager() : null;
      if (!stateManager) {
        throw new Error('StateManager not available for snapshot test');
      }
      return Number(stateManager.getChannelValue('K', 'percentage') ?? 0);
    });

    await page.evaluate(() => {
      const api = window as typeof window & { getHistoryManager?: () => any };
      const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
      if (!manager) {
        throw new Error('HistoryManager not available for snapshot test');
      }
      manager.captureState('Before: Snapshot Pair Test');
    });

    const newValue = baselinePercent > 10 ? baselinePercent - 10 : baselinePercent + 10;

    await page.evaluate((value) => {
      const api = window as typeof window & { getStateManager?: () => any };
      const stateManager = typeof api.getStateManager === 'function' ? api.getStateManager() : null;
      if (!stateManager) {
        throw new Error('StateManager not available for snapshot test');
      }
      stateManager.setChannelValue('K', 'percentage', value);
    }, newValue);

    await page.evaluate(() => {
      const api = window as typeof window & { getHistoryManager?: () => any };
      const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
      if (!manager) {
        throw new Error('HistoryManager not available for snapshot test');
      }
      manager.captureState('After: Snapshot Pair Test');
    });

    const changedPercent = await page.evaluate(() => {
      const api = window as typeof window & { getStateManager?: () => any };
      const stateManager = typeof api.getStateManager === 'function' ? api.getStateManager() : null;
      if (!stateManager) {
        throw new Error('StateManager not available for snapshot test');
      }
      return Number(stateManager.getChannelValue('K', 'percentage') ?? 0);
    });
    expect(changedPercent).not.toBe(baselinePercent);

    const undoResult = await page.evaluate(() => {
      const api = window as typeof window & { getHistoryManager?: () => any };
      const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
      if (!manager) {
        throw new Error('HistoryManager not available for snapshot test');
      }
      return manager.undo();
    });

    expect(undoResult).toMatchObject({ success: true });

    const redoTopEntry = await page.evaluate(() => {
      const api = window as typeof window & { getHistoryManager?: () => any };
      const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
      if (!manager) {
        throw new Error('HistoryManager not available for snapshot test');
      }
      const top = manager.redoStack?.[manager.redoStack.length - 1];
      return top ?? null;
    });

    expect(redoTopEntry?.kind ?? null).toBe('snapshot_pair');

    const revertedPercent = await page.evaluate(() => {
      const api = window as typeof window & { getStateManager?: () => any };
      const stateManager = typeof api.getStateManager === 'function' ? api.getStateManager() : null;
      if (!stateManager) {
        throw new Error('StateManager not available for snapshot test');
      }
      return Number(stateManager.getChannelValue('K', 'percentage') ?? 0);
    });
    expect(revertedPercent).toBe(baselinePercent);
  });
});
