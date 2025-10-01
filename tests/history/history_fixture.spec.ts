import { test, expect } from '@playwright/test';
import { loadHistoryFixture, saveCurveSnapshot, restoreCurveSnapshot } from '../fixtures/history-state.fixture';
import { getHistoryStackCounts } from '../utils/history-helpers';

const SAMPLE_LAB = `0 100\n50 50\n100 0`;

test.describe('History fixtures', () => {
  test('loads global LAB data and captures snapshot', async ({ page }) => {
    await loadHistoryFixture(page, { globalLab: SAMPLE_LAB });

    const stacks = await getHistoryStackCounts(page);
    expect(stacks.history).toBeGreaterThanOrEqual(0);

    const serialized = await saveCurveSnapshot(page);
    await restoreCurveSnapshot(page, serialized);

    const postStacks = await getHistoryStackCounts(page);
    expect(postStacks.history).toBeGreaterThanOrEqual(stacks.history);
  });
});
