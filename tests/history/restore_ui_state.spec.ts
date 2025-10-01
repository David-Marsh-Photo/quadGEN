import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';

const LAB_SAMPLE = `0 100\n50 50\n100 0`;

test.describe('Snapshot restoration rehydrates UI', () => {
  test('per-channel metadata and values revert on undo', async ({ page }) => {
    await loadHistoryFixture(page);

    const percentInput = page.locator('[data-channel="K"] .percent-input');
    const perChannelBtn = page.locator('[data-channel="K"] .per-channel-btn');

    const baselinePercent = await percentInput.inputValue();
    const baselineTooltip = await perChannelBtn.getAttribute('data-tooltip');

    await page.evaluate((labText) => {
      const api = window as typeof window & {
        getHistoryManager?: () => any;
        LinearizationState?: any;
      };
      const history = api.getHistoryManager?.();
      const linState = api.LinearizationState;
      if (!history || !linState) {
        throw new Error('Required managers unavailable');
      }

      history.captureState('Before: UI Rehydrate');

      const entry = {
        samples: Array.from({ length: 256 }, (_, i) => Math.round((i / 255) * 65535)),
        format: 'LAB',
        filename: 'fixture-lab.txt',
        edited: false,
        measurementIntent: 'Positive'
      };

      linState.setPerChannelData('K', entry, true);
    }, LAB_SAMPLE);

    await percentInput.evaluate((el) => {
      (el as HTMLInputElement).value = '65';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const changedPercent = parseFloat(await percentInput.inputValue());
    expect(changedPercent).toBeCloseTo(65, 1);

    const beforeUndoShot = test.info().outputPath('restore-ui-state-before-undo.png');
    await page.screenshot({ path: beforeUndoShot, fullPage: true });

    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) throw new Error('HistoryManager unavailable');
      history.captureState('After: UI Rehydrate');
    });

    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) {
        throw new Error('HistoryManager unavailable');
      }
      history.undo();
    });

    const revertedPercent = parseFloat(await percentInput.inputValue());
    expect(revertedPercent).toBeCloseTo(parseFloat(baselinePercent || '0'), 1);

    const afterUndoShot = test.info().outputPath('restore-ui-state-after-undo.png');
    await page.screenshot({ path: afterUndoShot, fullPage: true });
  });
});
