import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';
import { getHistoryStackCounts, waitForAppReady } from '../utils/history-helpers';

async function addPoint(page, x, y) {
  await page.click('#inkChart', { position: { x, y } });
  await page.waitForTimeout(100);
}

test.describe('Edit Mode Smart point undo', () => {
  test('adding smart points creates undo history entries', async ({ page }) => {
    await loadHistoryFixture(page);
    await waitForAppReady(page);

    // Enable Edit Mode
    await page.click('#editModeToggleBtn');
    await page.waitForTimeout(100);

    const stacksBefore = await getHistoryStackCounts(page);

    // Add three points roughly across the chart
    await addPoint(page, 120, 220);
    await addPoint(page, 220, 140);
    await addPoint(page, 320, 80);

    const stacksAfter = await getHistoryStackCounts(page);
    expect(stacksAfter.history).toBeGreaterThan(stacksBefore.history);

    // Undo three times
    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) throw new Error('HistoryManager unavailable');
      history.undo();
      history.undo();
      history.undo();
    });

    const stacksAfterUndo = await getHistoryStackCounts(page);
    expect(stacksAfterUndo.history).toBe(stacksBefore.history);
  });
});
