import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';

const LAB_SAMPLE = `0 100\n50 50\n100 0`;

test.describe('Per-channel measurement undo (chart observation)', () => {
  test('undo clears selected channel and chart focus (captures screenshot)', async ({ page }, testInfo) => {
    await loadHistoryFixture(page);

    await page.evaluate(() => {
      const api = window as typeof window & {
        setEditMode?: (on: boolean, opts?: any) => void;
        getStateManager?: () => any;
        EDIT?: { selectedChannel?: string | null; selectedOrdinal?: number };
      };

      api.setEditMode?.(true, { recordHistory: false });

      const manager = api.getStateManager?.();
      if (manager && typeof manager.setEditSelection === 'function') {
        manager.setEditSelection('K', 1);
      }

      if (api.EDIT) {
        api.EDIT.selectedChannel = 'K';
        api.EDIT.selectedOrdinal = 1;
      }
    });

    const channelRow = page.locator('tr[data-channel="K"]');
    const fileInput = channelRow.locator('.per-channel-file');

    await fileInput.setInputFiles({
      name: 'k_lab.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(LAB_SAMPLE)
    });

    await page.waitForFunction(() => {
      const state = (window as typeof window & { LinearizationState?: any }).LinearizationState;
      return state?.getPerChannelData ? !!state.getPerChannelData('K') : false;
    }, { timeout: 15000 });

    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) throw new Error('HistoryManager unavailable');
      history.undo();
    });

    await page.waitForTimeout(250);

    const chartScreenshotPath = testInfo.outputPath('chart-after-undo.png');
    await page.locator('#inkChart').screenshot({ path: chartScreenshotPath });
    await testInfo.attach('chart-after-undo', { path: chartScreenshotPath, contentType: 'image/png' });

    const selectedAfterUndo = await page.evaluate(() => {
      const edit = (window as typeof window & { EDIT?: any }).EDIT;
      return edit?.selectedChannel || null;
    });

    await testInfo.attach('selected-channel-after-undo', {
      body: Buffer.from(String(selectedAfterUndo ?? 'null'), 'utf-8'),
      contentType: 'text/plain'
    });
  });
});
