import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';
import { getHistoryStackCounts, waitForAppReady } from '../utils/history-helpers';

async function addPoint(page, x, y) {
  await page.click('#inkChart', { position: { x, y } });
  await page.waitForTimeout(50);
}

async function getSmartPointCount(page) {
  return page.evaluate(() => {
    const channel = (window as typeof window & { EDIT?: any }).EDIT?.selectedChannel;
    if (!channel || !(window as any).ControlPoints) return 0;
    const pts = (window as any).ControlPoints.get(channel)?.points || [];
    return Array.isArray(pts) ? pts.length : 0;
  });
}

async function clickUndo(page) {
  await page.evaluate(() => {
    const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
    if (!history) throw new Error('HistoryManager unavailable');
    history.undo();
  });
  await page.waitForTimeout(50);
}

async function clickRedo(page) {
  await page.evaluate(() => {
    const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
    if (!history) throw new Error('HistoryManager unavailable');
    history.redo();
  });
  await page.waitForTimeout(50);
}

test.describe('Edit Mode undo/redo loop', () => {
  test('undo/redo stack remains intact after mixed operations', async ({ page }) => {
    await loadHistoryFixture(page);
    await waitForAppReady(page);

    await page.click('#editModeToggleBtn');
    await page.waitForTimeout(50);

    const baselineCount = await getSmartPointCount(page);

    await addPoint(page, 140, 220);
    await addPoint(page, 240, 160);
    await addPoint(page, 320, 100);

    const countAfterAdd = await getSmartPointCount(page);
    expect(countAfterAdd).toBe(baselineCount + 3);

    await clickUndo(page);
    const countAfterUndo1 = await getSmartPointCount(page);
    expect(countAfterUndo1).toBe(baselineCount + 2);

    await clickUndo(page);
    const countAfterUndo2 = await getSmartPointCount(page);
    expect(countAfterUndo2).toBe(baselineCount + 1);

    await clickRedo(page);
    const countAfterRedo1 = await getSmartPointCount(page);
    expect(countAfterRedo1).toBe(baselineCount + 2);

    await clickRedo(page);
    const countAfterRedo2 = await getSmartPointCount(page);
    expect(countAfterRedo2).toBe(baselineCount + 3);

    await clickUndo(page);
    const countAfterUndo3 = await getSmartPointCount(page);
    expect(countAfterUndo3).toBe(baselineCount + 2);

    await clickRedo(page);
    const countAfterRedo3 = await getSmartPointCount(page);
    expect(countAfterRedo3).toBe(baselineCount + 3);

  });
});
