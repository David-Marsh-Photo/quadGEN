import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';
import { getHistoryStackCounts, setChannelPercentage } from '../utils/history-helpers';

const LAB_SAMPLE = `0 100\n50 50\n100 0`;

test.describe('Per-channel measurement undo', () => {
  test('undo unloads per-channel LAB data and restores toggle state', async ({ page }) => {
    await loadHistoryFixture(page);

    await setChannelPercentage(page, 'K', 50);

    await page.waitForTimeout(50);

    await page.evaluate(() => {
      const api = window as typeof window & {
        setEditMode?: (on: boolean, opts?: any) => void;
        getStateManager?: () => any;
        EDIT?: { selectedChannel?: string | null; selectedOrdinal?: number };
      };

      api.setEditMode?.(true, { recordHistory: false });

      const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
      if (select && Array.from(select.options).some(opt => opt.value === 'K')) {
        select.value = 'K';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (api.EDIT) {
        api.EDIT.selectedChannel = 'K';
        api.EDIT.selectedOrdinal = 1;
      }

      const manager = api.getStateManager?.();
      if (manager && typeof manager.setEditSelection === 'function') {
        manager.setEditSelection('K', 1);
      }
    });

    const channelRow = page.locator('tr[data-channel="K"]');
    const percentInput = channelRow.locator('.percent-input');
    const perChannelToggle = channelRow.locator('.per-channel-toggle');

    const baselinePercent = await percentInput.inputValue();
    const baselineCompact = await channelRow.getAttribute('data-compact');
    const baselineUserDisabled = await channelRow.getAttribute('data-user-disabled');
    const baselineToggleDisabled = await perChannelToggle.isDisabled();
    const baselineToggleChecked = await perChannelToggle.isChecked();

    const stacksBefore = await getHistoryStackCounts(page);

    const fileInput = page.locator('[data-channel="K"] .per-channel-file');
    await fileInput.setInputFiles({ name: 'k_lab.txt', mimeType: 'text/plain', buffer: Buffer.from(LAB_SAMPLE) });

    await page.waitForFunction(() => {
      const state = (window as typeof window & { LinearizationState?: any }).LinearizationState;
      return state?.getPerChannelData ? !!state.getPerChannelData('K') : false;
    }, { timeout: 15000 });

    const stacksAfterLoad = await getHistoryStackCounts(page);
    expect(stacksAfterLoad.history).toBeGreaterThan(stacksBefore.history);

    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) throw new Error('HistoryManager unavailable');
      history.undo();
    });

    const undoScreenshot = test.info().outputPath('channel-K-after-undo.png');
    await channelRow.screenshot({ path: undoScreenshot });

    const selectedChannel = await page.evaluate(() => {
      const edit = (window as typeof window & { EDIT?: any }).EDIT;
      return edit?.selectedChannel || null;
    });

    expect(selectedChannel).toBe('K');

    const row = await channelRow.elementHandle();
    const opacity = await page.evaluate((el) => (
      typeof window !== 'undefined' ? window.getComputedStyle(el).opacity : '1'
    ), row);

    expect(opacity).toBe('1');

    const isDisabledAfter = await perChannelToggle.isDisabled();
    expect(isDisabledAfter).toBe(baselineToggleDisabled);

    const isCheckedAfter = await perChannelToggle.isChecked();
    expect(isCheckedAfter).toBe(baselineToggleChecked);

    const percentAfterUndo = await percentInput.inputValue();
    expect(percentAfterUndo).toBe(baselinePercent);

    const endAfterUndo = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="K"]');
      const endInput = row?.querySelector<HTMLInputElement>('.end-input');
      return endInput ? Number(endInput.value) : 0;
    });
    expect(endAfterUndo).toBeGreaterThan(0);

    const compactAttr = await channelRow.getAttribute('data-compact');
    const userDisabledAttr = await channelRow.getAttribute('data-user-disabled');
    expect(compactAttr === 'false' || compactAttr === null).toBe(true);
    expect(userDisabledAttr === null || userDisabledAttr === 'false').toBe(true);

    const perChannelData = await page.evaluate(() => {
      const state = (window as typeof window & { LinearizationState?: any }).LinearizationState;
      return state?.getPerChannelData ? !!state.getPerChannelData('K') : null;
    });

    expect(perChannelData).toBe(false);

    const stacksAfterUndo = await getHistoryStackCounts(page);
    expect(stacksAfterUndo.history).toBe(stacksBefore.history);
  });
});
