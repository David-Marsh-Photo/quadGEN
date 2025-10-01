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
      const enabled = win.LinearizationState?.isPerChannelEnabled?.('MK');
      return !!data && enabled === true;
    }, null, { timeout: 15_000 });

    await page.locator('#editModeToggleBtn').click();
    await page.locator('#editRecomputeBtn').click();

    await page.waitForFunction(() => {
      const win = window as typeof window & { ControlPoints?: any };
      const points = win.ControlPoints?.get('MK')?.points;
      return Array.isArray(points) && points.length > 5;
    }, null, { timeout: 10_000 });

    const revertButton = page.locator('tr[data-channel="MK"] button.per-channel-revert');
    await expect(revertButton).toBeVisible();
    await expect(revertButton).toBeEnabled();
    await revertButton.click();

    await expect(revertButton).toBeDisabled();

    const revertState = await page.evaluate(() => {
      const win = window as typeof window & {
        ControlPoints?: any;
        getLoadedQuadData?: () => any;
      };
      const cp = win.ControlPoints?.get('MK');
      const points = Array.isArray(cp?.points) ? cp.points : [];
      const meta = win.getLoadedQuadData?.()?.keyPointsMeta?.MK;
      return {
        pointCount: points.length,
        inputs: points.map((p: any) => p.input),
        smartTouched: meta?.smartTouched ?? null,
        seedCount: meta?.measurementSeed?.points?.length ?? null,
      };
    });

    expect(revertState.pointCount).toBe(5);
    expect(revertState.inputs).toEqual([0, 25, 50, 75, 100]);
    expect(revertState.smartTouched).toBeFalsy();
    expect(revertState.seedCount).toBe(5);
  });
});
