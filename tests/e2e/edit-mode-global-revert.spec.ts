import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { resolve } from 'path';

test.describe('Global LAB revert after Edit Mode recompute', () => {
  test('restores measurement-seeded Smart points', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.locator('input#linearizationFile').setInputFiles(manualLabPath);
    await page.waitForFunction(
      () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
      null,
      { timeout: 15_000 }
    );

    await page.locator('#editModeToggleBtn').click();
    await page.locator('#editRecomputeBtn').click();
    await page.waitForFunction(() => {
      const win = window as typeof window & { ControlPoints?: any };
      const points = win.ControlPoints?.get('MK')?.points;
      return Array.isArray(points) && points.length > 5;
    }, null, { timeout: 10_000 });

    const recomputeState = await page.evaluate(() => {
      const win = window as typeof window & { ControlPoints?: any; getLoadedQuadData?: () => any };
      const points = win.ControlPoints?.get('MK')?.points ?? [];
      const seedPoints = win.getLoadedQuadData?.()?.keyPointsMeta?.MK?.measurementSeed?.points ?? [];
      return {
        pointCount: points.length,
        seedCount: seedPoints.length,
      };
    });
    expect(recomputeState.seedCount).toBeGreaterThan(5);
    expect(recomputeState.pointCount).toBeGreaterThan(5);

    if (await page.isEnabled('#revertGlobalToMeasurementBtn')) {
      await page.locator('#revertGlobalToMeasurementBtn').click();
    }

    const revertState = await page.evaluate(() => {
      const win = window as typeof window & {
        ControlPoints?: any;
        LinearizationState?: {
          getGlobalData?: () => any;
          isGlobalEnabled?: () => boolean;
        };
        getLoadedQuadData?: () => any;
      };
      const points = win.ControlPoints?.get('MK')?.points ?? [];
      const seedPoints = win.getLoadedQuadData?.()?.keyPointsMeta?.MK?.measurementSeed?.points ?? [];
      return {
        pointCount: points.length,
        sampleInputs: points.slice(0, seedPoints.length).map((p: any) => p.input),
        seedInputs: seedPoints.map((p: any) => p.input),
        buttonDisabled: !!document.getElementById('revertGlobalToMeasurementBtn')?.disabled,
        isApplied: win.LinearizationState?.isGlobalEnabled?.() ?? false,
      };
    });

    expect(revertState.pointCount).toBe(recomputeState.pointCount);
    expect(revertState.sampleInputs[0]).toBeCloseTo(0, 3);
    expect(revertState.sampleInputs[revertState.sampleInputs.length - 1]).toBeCloseTo(100, 3);
    expect(revertState.buttonDisabled).toBeTruthy();
    expect(revertState.isApplied).toBeFalsy();
  });
});
