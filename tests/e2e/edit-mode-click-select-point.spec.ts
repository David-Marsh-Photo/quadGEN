import { expect, test } from '@playwright/test';
import {
  gotoApp,
  loadManualLab,
  enableEditMode,
  waitForSmartPoints,
  enableSmartPointDragFlag
} from './utils/edit-mode-helpers.js';

async function getPointCount(page) {
  return page.evaluate(() => {
    const channel = (window as any).EDIT?.selectedChannel ?? null;
    const points = (window as any).ControlPoints?.get(channel)?.points;
    return Array.isArray(points) ? points.length : 0;
  });
}

async function simulateSelection(page, channel: string, ordinal: number) {
  return page.evaluate(({ ch, ord }) => {
    const helper = (window as any).__quadDebug?.chartDebug;
    if (!helper || typeof helper.simulateSmartPointSelection !== 'function') {
      throw new Error('simulateSmartPointSelection helper unavailable');
    }
    return helper.simulateSmartPointSelection(ch, ord);
  }, { ch: channel, ord: ordinal });
}

async function waitForSelectedOrdinal(page, ordinal: number) {
  await page.waitForFunction(
    (target) => (window as any).EDIT?.selectedOrdinal === target,
    ordinal,
    { timeout: 5000 }
  );
}

test.describe('Edit Mode Smart point selection via click', () => {
  test('simulated click selects Smart points without inserting new ones', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);

    const channel = await page.evaluate(() => (window as any).EDIT?.selectedChannel as string | null);
    if (!channel) throw new Error('No channel selected after enabling Edit Mode');

    await waitForSelectedOrdinal(page, 1);
    const initialCount = await getPointCount(page);
    expect(initialCount).toBeGreaterThan(3);

    const firstTarget = Math.min(Math.max(2, Math.floor(initialCount / 2)), initialCount - 1);
    const secondTarget = Math.min(initialCount, Math.max(firstTarget + 1, Math.min(initialCount, firstTarget + 2)));

    await simulateSelection(page, channel, firstTarget);
    await waitForSelectedOrdinal(page, firstTarget);
    expect(await getPointCount(page)).toBe(initialCount);

    await page.locator('#optionsBtn').click();
    await page.waitForSelector('#smartPointDragToggle', { timeout: 5000 });
    if (await page.locator('#smartPointDragToggle').isChecked()) {
      await page.locator('#smartPointDragToggle').uncheck();
    }
    await page.locator('#closeOptionsBtn').click();

    await simulateSelection(page, channel, secondTarget);
    await waitForSelectedOrdinal(page, secondTarget);
    expect(await getPointCount(page)).toBe(initialCount);
  });
});
