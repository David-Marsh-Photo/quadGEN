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

    const beforeState = await page.evaluate(() => {
      const win = window as typeof window & { ControlPoints?: any; getLoadedQuadData?: () => any };
      const points = win.ControlPoints?.get('MK')?.points ?? [];
      const seedPoints = win.getLoadedQuadData?.()?.keyPointsMeta?.MK?.measurementSeed?.points ?? [];
      return {
        pointCount: points.length,
        seedCount: seedPoints.length,
        seedPoints,
      };
    });

    expect(beforeState.seedCount).toBeGreaterThan(5);
    expect(beforeState.pointCount).toBeGreaterThan(5);

    const beforeBuffer = await curveCanvas.screenshot({ path: BEFORE_PATH });
    await testInfo.attach('before-revert', {
      body: beforeBuffer,
      contentType: 'image/png'
    });

    if (await page.isEnabled('#revertGlobalToMeasurementBtn')) {
      await page.locator('#revertGlobalToMeasurementBtn').click();
    }

    const afterImmediateBuffer = await curveCanvas.screenshot({ path: AFTER_IMMEDIATE_PATH });
    await testInfo.attach('after-revert-immediate', {
      body: afterImmediateBuffer,
      contentType: 'image/png'
    });
    expect(existsSync(AFTER_IMMEDIATE_PATH)).toBeTruthy();

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
      const globalData = win.LinearizationState?.getGlobalData?.();
      return {
        pointCount: points.length,
        sampleInputs: points.slice(0, seedPoints.length).map((p: any) => p.input),
        seedInputs: seedPoints.map((p: any) => p.input),
        buttonDisabled: !!document.getElementById('revertGlobalToMeasurementBtn')?.disabled,
        globalFormat: globalData?.format || null,
        isApplied: win.LinearizationState?.isGlobalEnabled?.() ?? false,
      };
    });

    expect(revertState.pointCount).toBe(beforeState.pointCount);
    expect(revertState.sampleInputs[0]).toBeCloseTo(0, 3);
    expect(revertState.sampleInputs[revertState.sampleInputs.length - 1]).toBeCloseTo(100, 3);
    expect(revertState.buttonDisabled).toBeTruthy();
    expect(revertState.globalFormat).toBe('LAB Data');
    expect(revertState.isApplied).toBeFalsy();

    const afterBuffer = await curveCanvas.screenshot({ path: AFTER_PATH });
    await testInfo.attach('after-revert', {
      body: afterBuffer,
      contentType: 'image/png'
    });

    try {
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
    } catch (error) {
      const stdout = (error as any)?.stdout;
      const stderr = (error as any)?.stderr;
      const message = [stdout, stderr]
        .map((stream) => (typeof stream === 'string' ? stream : Buffer.isBuffer(stream) ? stream.toString('utf-8') : ''))
        .join('\n');
      if (!message.includes('Images too similar')) {
        throw error;
      }
    }

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
