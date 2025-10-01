import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { resolve } from 'path';

test.describe('Global LAB revert after Edit Mode recompute', () => {
  test('restores original measurement points', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    // Load the manual LAB dataset as a global correction
    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.locator('input#linearizationFile').setInputFiles(manualLabPath);
    await page.waitForFunction(
      () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
      null,
      { timeout: 15_000 }
    );

    // Enable Edit Mode and recompute Smart points from the measurement
    await page.locator('#editModeToggleBtn').click();
    await page.locator('#editRecomputeBtn').click();
    await page.waitForTimeout(500);

    // Verify recompute produced more than the original 5 key points
    const recomputeState = await page.evaluate(() => {
      const cp = (window as typeof window & { ControlPoints?: any }).ControlPoints?.get('MK');
      return cp?.points?.length || 0;
    });
    expect(recomputeState).toBeGreaterThan(5);

    // Revert to measurement and confirm Smart points return to originals
    await page.locator('#revertGlobalToMeasurementBtn').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#revertGlobalToMeasurementBtn')).toBeDisabled();

    const revertState = await page.evaluate(() => {
      const win = window as typeof window & {
        ControlPoints?: any;
        LinearizationState?: {
          getGlobalData?: () => any;
          isGlobalEnabled?: () => boolean;
        };
      };
      const cp = win.ControlPoints?.get('MK');
      const points = cp?.points ?? [];
      const globalData = win.LinearizationState?.getGlobalData?.();
      const isApplied = win.LinearizationState?.isGlobalEnabled?.() ?? false;
      return {
        pointCount: points.length,
        inputs: points.map((p: any) => p.input),
        globalFormat: globalData?.format || null,
        dataRows: Array.isArray(globalData?.data) ? globalData.data.length : null,
        isApplied,
      };
    });

    expect(revertState.pointCount).toBe(5);
    expect(revertState.inputs).toEqual([0, 25, 50, 75, 100]);
    expect(revertState.globalFormat).toBe('LAB Data');
    expect(revertState.isApplied).toBeTruthy();
  });
});
