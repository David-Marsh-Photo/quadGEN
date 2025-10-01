import { test, expect } from '@playwright/test';
import { loadHistoryFixture } from '../fixtures/history-state.fixture';

const LAB_SAMPLE = `0 100\n50 50\n100 0`;

test.describe('Linearization undo restores toggle metadata', () => {
  test('global toggle and filename revert after undo', async ({ page }) => {
    await loadHistoryFixture(page);

    const toggle = page.locator('#globalLinearizationToggle');
    const filenameLabel = page.locator('#globalLinearizationFilename');

    const baselineChecked = await toggle.isChecked();
    const baselineText = await filenameLabel.textContent();

    await page.evaluate((labText) => {
      const api = window as typeof window & {
        getHistoryManager?: () => any;
        LinearizationState?: any;
      };
      const history = api.getHistoryManager?.();
      const linState = api.LinearizationState;
      if (!history || !linState) {
        throw new Error('Managers unavailable');
      }

      history.captureState('Before: Global LAB Load');

      const entry = {
        samples: Array.from({ length: 256 }, (_, i) => Math.round((i / 255) * 65535)),
        format: 'LAB',
        filename: 'global-fixture.txt',
        edited: false,
        measurementIntent: 'Positive'
      };

      linState.setGlobalData(entry, true);
      history.captureState('After: Global LAB Load');
    }, LAB_SAMPLE);

    await page.evaluate(() => {
      const toggle = document.getElementById('globalLinearizationToggle') as HTMLInputElement | null;
      const filename = document.getElementById('globalLinearizationFilename');
      const info = document.getElementById('globalLinearizationInfo');
      const hint = document.getElementById('globalLinearizationHint');
      if (toggle) {
        toggle.disabled = false;
        toggle.checked = true;
      }
      if (filename) {
        filename.textContent = 'global-fixture.txt';
      }
      if (info) info.classList.remove('hidden');
      if (hint) hint.classList.add('hidden');
    });

    await expect(toggle).toBeChecked();
    await expect(filenameLabel).toHaveText(/global-fixture/);

    await page.evaluate(() => {
      const history = (window as typeof window & { getHistoryManager?: () => any }).getHistoryManager?.();
      if (!history) throw new Error('HistoryManager unavailable');
      history.undo();
    });

    if (baselineChecked) {
      await expect(toggle).toBeChecked();
    } else {
      await expect(toggle).not.toBeChecked();
    }

    await expect(filenameLabel).toHaveText(baselineText ?? '');
  });
});
