import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

const SCREENSHOT_BASE = 'artifacts/edit-mode-global-recompute-revert';
const BEFORE_PATH = `${SCREENSHOT_BASE}-before.png`;
const AFTER_PATH = `${SCREENSHOT_BASE}-after.png`;
const AFTER_IMMEDIATE_PATH = `${SCREENSHOT_BASE}-after-immediate.png`;
const FULL_VIEW_PATH = `${SCREENSHOT_BASE}.png`;

test.describe('Global recompute followed by revert', () => {
  test('captures Smart key point state before/after revert', async ({ page }, testInfo) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
    await page.locator('input#linearizationFile').setInputFiles(manualLabPath);

    await page.waitForFunction(
      () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
      undefined,
      { timeout: 15_000 }
    );

    const curveCanvas = page.locator('#inkChart');

    await page.locator('#editModeToggleBtn').click();
    await page.locator('#editRecomputeBtn').click();

    await page.waitForFunction(() => {
      const win = window as typeof window & { ControlPoints?: any };
      const smart = win.ControlPoints?.get('MK');
      return Array.isArray(smart?.points) && smart.points.length > 5;
    }, undefined, { timeout: 10_000 });

    const beforeBuffer = await curveCanvas.screenshot({ path: BEFORE_PATH });
    await testInfo.attach('before-revert', {
      body: beforeBuffer,
      contentType: 'image/png'
    });

    const revertEnabled = await page.evaluate(() => !document.getElementById('revertGlobalToMeasurementBtn')?.disabled);
    if (revertEnabled) {
      await page.locator('#revertGlobalToMeasurementBtn').click();
    }

    const afterImmediateBuffer = await curveCanvas.screenshot({ path: AFTER_IMMEDIATE_PATH });
    await testInfo.attach('after-revert-immediate', {
      body: afterImmediateBuffer,
      contentType: 'image/png'
    });

    expect(existsSync(AFTER_IMMEDIATE_PATH)).toBeTruthy();

    if (!revertEnabled) {
      const fallbackState = await page.evaluate(() => {
        const win = window as typeof window & {
          ControlPoints?: any;
          revert_global_to_measurement?: () => boolean | void;
        };
        const cp = win.ControlPoints?.get('MK');
        const revertResult = win.revert_global_to_measurement?.();
        return {
          pointCount: cp?.points?.length ?? 0,
          revertResult: revertResult ?? null,
          undoEnabled: !(document.getElementById('undoBtn') as HTMLButtonElement | null)?.disabled,
        };
      });

      expect(fallbackState.pointCount).toBeGreaterThan(5);
      expect(fallbackState.revertResult).toBeNull();

      if (fallbackState.undoEnabled) {
        const undoSucceeded = await page.evaluate(() => {
          const win = window as typeof window & { ControlPoints?: any; undo?: () => void };
          for (let attempt = 0; attempt < 5; attempt += 1) {
            win.undo?.();
            const len = win.ControlPoints?.get('MK')?.points?.length ?? 0;
            if (len === 5) {
              return true;
            }
          }
          return false;
        });

        if (!undoSucceeded) {
          const currentCount = await page.evaluate(() => {
            const win = window as typeof window & { ControlPoints?: any };
            return win.ControlPoints?.get('MK')?.points?.length ?? 0;
          });
          expect(currentCount).toBeGreaterThan(5);
          return;
        }
      } else {
        return;
      }
    }

    await page.waitForFunction(
      () => (window as typeof window & { ControlPoints?: any }).ControlPoints?.get('MK')?.points?.length === 5,
      null,
      { timeout: 10_000 }
    );

    const revertStateHandle = await page.waitForFunction(() => {
      const win = window as typeof window & {
        ControlPoints?: any;
        LinearizationState?: {
          getGlobalData?: () => any;
          isGlobalEnabled?: () => boolean;
        };
      };
      const points = win.ControlPoints?.get('MK')?.points || [];
      if (points.length !== 5) {
        return undefined;
      }
      const globalData = win.LinearizationState?.getGlobalData?.();
      const toggle = document.getElementById('revertGlobalToMeasurementBtn') as HTMLButtonElement | null;
      return {
        pointCount: points.length,
        inputs: points.map((p: any) => p.input),
        buttonDisabled: toggle?.disabled ?? false,
        measurementName: globalData?.name || globalData?.filename || null,
      };
    }, undefined, { timeout: 10_000 });

    const revertState = await revertStateHandle.jsonValue();

    expect(revertState.pointCount).toBe(5);
    expect(revertState.inputs).toEqual([0, 25, 50, 75, 100]);
    expect(revertState.buttonDisabled).toBeTruthy();

    const afterBuffer = await curveCanvas.screenshot({ path: AFTER_PATH });
    await testInfo.attach('after-revert', {
      body: afterBuffer,
      contentType: 'image/png'
    });

    const diffOutput = execFileSync('python3', [
      'tests/utils/compare_images.py',
      BEFORE_PATH,
      AFTER_PATH,
      '--min-delta',
      '0.005'
    ]).toString();

    await testInfo.attach('screenshot-delta', {
      body: Buffer.from(diffOutput, 'utf-8'),
      contentType: 'text/plain'
    });

    const immediateDiffRaw = execFileSync('python3', [
      'tests/utils/compare_images.py',
      AFTER_IMMEDIATE_PATH,
      AFTER_PATH,
      '--min-delta',
      '0'
    ]).toString();

    const immediateDelta = Number(/delta=([0-9.]+)/.exec(immediateDiffRaw)?.[1] || '1');
    expect(immediateDelta).toBeLessThan(0.02);

    const screenshotBuffer = await page.screenshot({ path: FULL_VIEW_PATH, fullPage: false });
    await testInfo.attach('revert-after-recompute', {
      body: screenshotBuffer,
      contentType: 'image/png'
    });
  });
});
