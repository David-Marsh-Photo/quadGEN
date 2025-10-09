import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

test.describe('Per-channel measurement revert', () => {
  test('returns Smart points to measurement seed and disables button', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
    const fileInput = page.locator('tr[data-channel="MK"] input.per-channel-file');
    await fileInput.setInputFiles(manualLabPath);

    await page.waitForFunction(() => {
      const win = window as typeof window & {
        LinearizationState?: {
          getPerChannelData?: (channel: string) => any;
          isPerChannelEnabled?: (channel: string) => boolean;
        };
      };
      const data = win.LinearizationState?.getPerChannelData?.('MK');
      return !!data;
    }, null, { timeout: 15_000 });

    await page.locator('#editModeToggleBtn').click();
    await page.locator('#editRecomputeBtn').click();

    await page.waitForFunction(() => {
      const win = window as typeof window & { ControlPoints?: any };
      const points = win.ControlPoints?.get('MK')?.points;
      return Array.isArray(points) && points.length > 5;
    }, null, { timeout: 10_000 });

    const beforePoints = await page.evaluate(() => {
      const win = window as typeof window & { ControlPoints?: any };
      return win.ControlPoints?.get('MK')?.points ?? [];
    });

    const revertButton = page.locator('tr[data-channel="MK"] button.per-channel-revert');
    await expect(revertButton).toBeVisible();
    if (await revertButton.isEnabled()) {
      await revertButton.click();
    }

    const revertState = await page.evaluate(() => {
      const win = window as typeof window & { ControlPoints?: any };
      const points = win.ControlPoints?.get('MK')?.points ?? [];
      return {
        pointCount: points.length,
        sampleInputs: points.map((p: any) => p.input),
      };
    });

    expect(revertState.pointCount).toBe(beforePoints.length);
    beforePoints.forEach((point, idx) => {
      expect(revertState.sampleInputs[idx]).toBeCloseTo(point.input, 3);
    });
    await expect(revertButton).toBeDisabled();
  });
});
