import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { waitForScaleComplete, captureScalingState, compareScalingStates } from '../utils/scaling-test-helpers';

test.describe('Global scale with measurement revert interaction', () => {
  test('scale → measurement load → revert → scale preserves measurement state', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const initialState = await captureScalingState(page);
    expect(initialState.scalePercent).toBe(100);

    await page.evaluate(() => window.applyGlobalScale?.(80));
    await waitForScaleComplete(page, 80);

    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.locator('input#linearizationFile').setInputFiles(manualLabPath);
    await page.waitForFunction(
      () => document.getElementById('globalLinearizationFilename')?.textContent?.includes('Manual-LAB-Data.txt'),
      null,
      { timeout: 20_000 }
    );

    const measurementLabelBefore = (await page.locator('#globalLinearizationFilename').textContent())?.trim();
    expect(measurementLabelBefore).toBeTruthy();

    const measurementState = await captureScalingState(page);

    const statusBefore = await page.evaluate(() => {
      const win = window as typeof window & {
        LinearizationState?: {
          isGlobalEnabled?: () => boolean;
          getGlobalBakedMeta?: () => unknown;
        };
      };
      return {
        isApplied: win.LinearizationState?.isGlobalEnabled?.() ?? null,
        bakedMeta: win.LinearizationState?.getGlobalBakedMeta?.() ?? null,
      };
    });

    await page.evaluate(() => (window as typeof window & { revert_global_to_measurement?: () => void }).revert_global_to_measurement?.());

    await page.evaluate(() => window.applyGlobalScale?.(100));
    await waitForScaleComplete(page, 100);

    const finalState = await captureScalingState(page);
    expect(finalState.scalePercent).toBe(100);

    const measurementLabelAfter = (await page.locator('#globalLinearizationFilename').textContent())?.trim();
    expect(measurementLabelAfter).toBe(measurementLabelBefore);

    const statusAfter = await page.evaluate(() => {
      const win = window as typeof window & {
        LinearizationState?: {
          isGlobalEnabled?: () => boolean;
          getGlobalBakedMeta?: () => unknown;
        };
      };
      return {
        isApplied: win.LinearizationState?.isGlobalEnabled?.() ?? null,
        bakedMeta: win.LinearizationState?.getGlobalBakedMeta?.() ?? null,
      };
    });

    expect(statusAfter.isApplied).toBe(statusBefore.isApplied ?? true);
    expect(statusAfter.bakedMeta).toBeNull();

    const diffFromInitial = compareScalingStates(initialState, finalState);
    expect(diffFromInitial.scaleDelta).toBe(0);
    for (const change of diffFromInitial.channelChanges) {
      expect(Math.abs(change.percentDelta ?? 0)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(change.endDelta ?? 0)).toBeLessThanOrEqual(1);
    }

    const diffFromMeasurement = compareScalingStates(measurementState, finalState);
    expect(diffFromMeasurement.afterScale).toBe(finalState.scalePercent);
  });
});
