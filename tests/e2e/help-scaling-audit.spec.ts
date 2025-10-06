import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

test.describe('Help overlay scaling audit panel', () => {
  test('reflects scaling state flag and audit counters', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const helpButton = page.locator('#helpBtn');
    await helpButton.click();

    const helpPopup = page.locator('#helpPopup');
    await expect(helpPopup).toBeVisible();

    const historyTab = page.locator('#helpTabHistory');
    await historyTab.click();

    const panel = page.locator('#helpDebugPanel');
    await expect(panel).toBeVisible();

    const field = (name: string) => panel.locator(`[data-scaling-debug-field="${name}"]`);

    await expect(field('flag')).toHaveText(/disabled/i);
    await expect(field('totalChecks')).toHaveText('0');
    await expect(field('mismatchCount')).toHaveText('0');

    await page.evaluate(() => {
      const win = window as typeof window & { setScalingStateEnabled?: (value: boolean) => void };
      if (typeof win.setScalingStateEnabled !== 'function') {
        throw new Error('setScalingStateEnabled helper missing on window');
      }
      win.setScalingStateEnabled(true);
    });

    await expect(field('flag')).toHaveText(/enabled/i);

    const refreshButton = page.locator('#helpDebugRefreshBtn');
    await refreshButton.click();

    await expect.poll(async () => (await field('totalChecks').textContent())?.trim() ?? '').not.toBe('0');
    await expect(field('lastReason')).toContainText(/help-refresh/i);

    await page.evaluate(() => {
      const win = window as typeof window & { applyGlobalScale?: (percent: number) => void };
      if (typeof win.applyGlobalScale !== 'function') {
        throw new Error('applyGlobalScale helper missing on window');
      }
      win.applyGlobalScale(142);
    });

    await expect.poll(async () => Number((await field('totalChecks').textContent())?.trim() || '0')).toBeGreaterThan(1);
    await expect(field('mismatchCount')).toHaveText('0');
    await expect(field('status')).toHaveText(/status: ok/i);
    await expect(field('lastReason')).toContainText(/scaleChannelEndsByPercent:/i);
  });
});
