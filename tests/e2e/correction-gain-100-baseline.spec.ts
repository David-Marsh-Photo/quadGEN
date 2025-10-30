/**
 * Test: LAB Correction Gain 100% Baseline Bug
 *
 * This test verifies that LAB correction at 100% gain properly applies
 * corrections in the highlight region (0-23% input range).
 *
 * BUG: Currently fails because baseline curves are initialized AFTER
 * the first chart update, causing 100% gain to use wrong baseline.
 *
 * Expected to FAIL before fix, PASS after fix.
 */

import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

test.describe('LAB Correction Gain 100% Baseline Bug', () => {
  test('should apply full correction at 100% gain in highlight region', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    // Wait for app to initialize
    await Promise.all([
      page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
      page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
    ]);

    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    // Step 1: Load .quad file
    const quadPath = resolve('data/P800_K24_TOYOBOPM_V1.quad');
    await page.setInputFiles('#quadFile', quadPath);

    // Wait for load to complete
    await page.waitForTimeout(1000);

    // Step 2: Capture baseline curve values for K channel (first 60 points cover 0-23% range)
    const baselineCurve = await page.evaluate(() => {
      const channelName = 'K';
      // Get baseline from LinearizationState if available, otherwise from loadedData
      const baselineSnapshot = window.LinearizationState?.getGlobalBaselineCurves?.();
      const loadedData = window.getLoadedQuadData();

      const curves = baselineSnapshot || loadedData?.curves;
      if (!curves || !curves[channelName]) {
        throw new Error('K channel curve not found');
      }
      return Array.from(curves[channelName]).slice(0, 60); // First 60 of 256 points (~23%)
    });

    console.log('Baseline K curve (first 60 points):', baselineCurve);

    // Step 3: Load LAB correction file
    const labPath = resolve('data/P800_K24_TOYOBOPM_V1.txt');
    await page.setInputFiles('#linearizationFile', labPath);

    // Wait for LAB correction to be applied
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );
    await page.waitForTimeout(1000);

    // Step 4: Verify correction gain is at 100% (default)
    const gainValue = await page.evaluate(() => {
      const slider = document.getElementById('correctionGainSlider') as HTMLInputElement;
      return {
        sliderValue: slider?.value
      };
    });

    console.log('Correction gain:', gainValue);
    expect(gainValue.sliderValue).toBe('100');

    // Step 5: Get corrected curve values for K channel
    const correctedCurve = await page.evaluate(() => {
      const channelName = 'K';
      // Get corrected curves from LinearizationState
      const correctedSnapshot = window.LinearizationState?.getGlobalCorrectedCurves?.();
      const loadedData = window.getLoadedQuadData();

      const curves = correctedSnapshot || loadedData?.curves;
      if (!curves || !curves[channelName]) {
        throw new Error('K channel curve not found after correction');
      }
      return Array.from(curves[channelName]).slice(0, 60); // First 60 of 256 points (~23%)
    });

    console.log('Corrected K curve (first 60 points):', correctedCurve);

    // Step 6: Calculate correction magnitude in highlight region
    let totalDifference = 0;
    let maxDifference = 0;
    const differences: number[] = [];

    for (let i = 0; i < 60; i++) {
      const diff = Math.abs(correctedCurve[i] - baselineCurve[i]);
      differences.push(diff);
      totalDifference += diff;
      maxDifference = Math.max(maxDifference, diff);
    }

    const avgDifference = totalDifference / 60;
    const percentChange = (avgDifference / Math.max(...baselineCurve)) * 100;

    console.log('Correction analysis:');
    console.log('  Average difference:', avgDifference.toFixed(2));
    console.log('  Max difference:', maxDifference.toFixed(2));
    console.log('  Percent change:', percentChange.toFixed(2) + '%');
    console.log('  First 10 differences:', differences.slice(0, 10));

    // Step 7: Assert meaningful correction was applied
    // At 100% gain, the correction should significantly change the highlight region
    // If average difference is < 100 (out of ~14000 range), correction didn't apply

    expect(avgDifference).toBeGreaterThan(100);
    expect(maxDifference).toBeGreaterThan(200);
    expect(percentChange).toBeGreaterThan(1.0);

    // Additional check: at least 80% of points should show some correction
    const pointsWithCorrection = differences.filter(d => d > 10).length;
    const correctionRate = (pointsWithCorrection / 60) * 100;
    console.log('  Points with correction (>10 diff):', pointsWithCorrection, `(${correctionRate.toFixed(1)}%)`);

    expect(correctionRate).toBeGreaterThan(80);
  });

  test('should match 99% gain behavior (which works by accident)', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    // Wait for app to initialize
    await Promise.all([
      page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
      page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
    ]);

    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    // Load .quad file
    const quadPath = resolve('data/P800_K24_TOYOBOPM_V1.quad');
    await page.setInputFiles('#quadFile', quadPath);

    await page.waitForTimeout(1000);

    // Load LAB correction
    const labPath = resolve('data/P800_K24_TOYOBOPM_V1.txt');
    await page.setInputFiles('#linearizationFile', labPath);

    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );
    await page.waitForTimeout(1000);

    // Set gain to 99%
    await page.evaluate(() => {
      const slider = document.getElementById('correctionGainSlider') as HTMLInputElement;
      slider.value = '99';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForTimeout(500);

    // Get corrected curve at 99%
    const curve99 = await page.evaluate(() => {
      const correctedSnapshot = window.LinearizationState?.getGlobalCorrectedCurves?.();
      const loadedData = window.getLoadedQuadData();
      const curves = correctedSnapshot || loadedData?.curves;
      return Array.from(curves['K']).slice(0, 60);
    });

    // Set gain to 100%
    await page.evaluate(() => {
      const slider = document.getElementById('correctionGainSlider') as HTMLInputElement;
      slider.value = '100';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForTimeout(500);

    // Get corrected curve at 100%
    const curve100 = await page.evaluate(() => {
      const correctedSnapshot = window.LinearizationState?.getGlobalCorrectedCurves?.();
      const loadedData = window.getLoadedQuadData();
      const curves = correctedSnapshot || loadedData?.curves;
      return Array.from(curves['K']).slice(0, 60);
    });

    // Calculate difference between 99% and 100%
    let totalDiff = 0;
    for (let i = 0; i < 60; i++) {
      totalDiff += Math.abs(curve100[i] - curve99[i]);
    }
    const avgDiff = totalDiff / 60;

    console.log('99% vs 100% comparison:');
    console.log('  Average difference:', avgDiff.toFixed(2));
    console.log('  First 10 points at 99%:', curve99.slice(0, 10));
    console.log('  First 10 points at 100%:', curve100.slice(0, 10));

    // At 100% gain, curves should be VERY similar to 99% (within ~1% difference)
    // If they differ significantly, the baseline bug is present
    const maxExpectedDiff = Math.max(...curve99) * 0.02; // 2% tolerance

    expect(avgDiff).toBeLessThan(maxExpectedDiff);
  });
});
