import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

let baselineWarnings: string[] = [];

test.describe('TRIFORCE LAB import', () => {
  test('applies global correction when TRIFORCE.txt is loaded', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const labPath = resolve('data/TRIFORCE.txt');

    expect(existsSync(labPath)).toBe(true);

    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`console error: ${message.text()}`);
      }
    });

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });

    const initialState = await page.evaluate(() => ({
      globalApplied: !!window.LinearizationState?.globalApplied,
      hasSamples: Array.isArray(window.linearizationData?.samples) && window.linearizationData.samples.length > 0,
      lastLabSource: window.linearizationData?.filename || window.linearizationData?.sourceFilename || null
    }));

    expect(initialState.globalApplied).toBe(false);
    expect(initialState.hasSamples).toBe(false);

    await page.setInputFiles('#linearizationFile', labPath);

    await page.waitForTimeout(5000);

    const postLoadState = await page.evaluate(() => ({
      globalApplied: !!window.LinearizationState?.globalApplied,
      normalizationMode: window.LinearizationState?.labNormalizationMode || null,
      lastLabSource: window.linearizationData?.filename || window.linearizationData?.sourceFilename || null,
      sampleCount: window.linearizationData?.samples?.length || 0,
      loaderDiagnostics: window.LinearizationState?.getLabLoaderDiagnostics?.() || null,
      statusLog: window.quadGEN?.statusLog?.slice?.(-5) || null,
      warnings: window.LinearizationState?.getGlobalWarnings?.() || []
    }));

    baselineWarnings = postLoadState.warnings;

    expect(postLoadState.sampleCount).toBeGreaterThan(0);
    expect(postLoadState.globalApplied).toBe(true);
    expect(postLoadState.lastLabSource).toMatch(/TRIFORCE\.txt$/);
    expect(consoleErrors).toEqual([]);
  });

  test('composite redistribution suppresses saturation warnings', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const labPath = resolve('data/TRIFORCE_V4.txt');
    const quadPath = resolve('data/TRIFORCE_V4.quad');

    expect(existsSync(labPath)).toBe(true);
    expect(existsSync(quadPath)).toBe(true);

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
    await page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    const waitForCurves = async () => {
      await page.waitForFunction(() => {
        const data = window.getLoadedQuadData?.();
        if (!data?.curves) return false;
        return Object.values(data.curves).some((arr: any) => Array.isArray(arr) && arr.length === 256);
      }, null, { timeout: 20000 });
    };

    const loadQuad = async () => {
      await page.setInputFiles('#quadFile', quadPath);
      await waitForCurves();
    };

    const loadLab = async () => {
      await page.setInputFiles('#linearizationFile', labPath);
      await page.waitForTimeout(4000);
      await waitForCurves();
    };

    const grabTotals = async () => {
      return page.evaluate(() => {
        const data = window.getLoadedQuadData?.();
        if (!data?.curves) return null;
        const totals = new Array(256).fill(0);
        Object.values(data.curves as Record<string, number[]>).forEach((arr) => {
          if (!Array.isArray(arr)) return;
          for (let i = 0; i < arr.length; i += 1) {
            totals[i] += arr[i] || 0;
          }
        });
        return totals;
      });
    };

    await loadQuad();
    await loadLab();

    const baselineTotals = await grabTotals();
    expect(Array.isArray(baselineTotals)).toBe(true);

    const baselineCompositeWarnings = await page.evaluate(
      () => window.LinearizationState?.getGlobalWarnings?.() || []
    );
    expect(Array.isArray(baselineCompositeWarnings)).toBe(true);
    baselineWarnings = baselineCompositeWarnings;

    await page.evaluate(() => {
      window.enableCompositeLabRedistribution?.(true);
    });

    await loadQuad();
    await loadLab();

    const compositeTotals = await grabTotals();
    expect(Array.isArray(compositeTotals)).toBe(true);

    const compositeWarnings = await page.evaluate(
      () => window.LinearizationState?.getGlobalWarnings?.() || []
    );
    expect(Array.isArray(compositeWarnings)).toBe(true);
    expect(compositeWarnings.length).toBeLessThanOrEqual(baselineWarnings.length);

    const ratios = (baselineTotals || []).map((base, index) => {
      const compositeValue = compositeTotals?.[index] ?? 0;
      if (base < 1 && compositeValue < 1) return 1;
      if (base < 1 && compositeValue >= 1) return Number.POSITIVE_INFINITY;
      return compositeValue / base;
    }).filter((value) => Number.isFinite(value));

    expect(ratios.length).toBeGreaterThan(0);
    const ratioMin = Math.min(...ratios);
    const ratioMax = Math.max(...ratios);
    expect(ratioMin).toBeGreaterThan(0.85);
    expect(ratioMax).toBeLessThan(1.15);
  });

  test('density constants steer shadow corrections toward K', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const labPath = resolve('data/TRIFORCE_V4.txt');
    const quadPath = resolve('data/TRIFORCE_V4.quad');

    expect(existsSync(labPath)).toBe(true);
    expect(existsSync(quadPath)).toBe(true);

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
    await page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    const waitForCurves = async () => {
      await page.waitForFunction(() => {
        const data = window.getLoadedQuadData?.();
        if (!data?.curves) return false;
        return Object.values(data.curves).some((arr: any) => Array.isArray(arr) && arr.length === 256);
      }, null, { timeout: 20000 });
    };

    await page.setInputFiles('#quadFile', quadPath);
    await waitForCurves();
    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForTimeout(4000);
    await waitForCurves();

    await page.evaluate(() => {
      window.enableCompositeLabRedistribution?.(true);
    });

    await page.setInputFiles('#quadFile', quadPath);
    await waitForCurves();
    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForTimeout(4000);
    await waitForCurves();

    const profile = await page.evaluate(() => {
      return window.getCompositeDensityProfile?.(95) || null;
    });

    expect(profile).not.toBeNull();
    expect(profile?.input).toBe(95);
    expect(profile?.perChannel?.K?.share ?? 0).toBeGreaterThan(0.85);
    expect(profile?.perChannel?.C?.share ?? 1).toBeLessThan(0.15);
    expect(profile?.perChannel?.LK?.share ?? 1).toBeLessThan(0.05);
  });

  test('composite finalize marks global baked state', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const labPath = resolve('data/TRIFORCE_V4.txt');
    const quadPath = resolve('data/TRIFORCE_V4.quad');

    expect(existsSync(labPath)).toBe(true);
    expect(existsSync(quadPath)).toBe(true);

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
    await page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    const waitForCurves = async () => {
      await page.waitForFunction(() => {
        const data = window.getLoadedQuadData?.();
        if (!data?.curves) return false;
        return Object.values(data.curves).some((arr: any) => Array.isArray(arr) && arr.length === 256);
      }, null, { timeout: 20000 });
    };

    await page.setInputFiles('#quadFile', quadPath);
    await waitForCurves();
    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForTimeout(4000);
    await waitForCurves();

    await page.evaluate(() => {
      window.enableCompositeLabRedistribution?.(true);
    });

    await page.setInputFiles('#quadFile', quadPath);
    await waitForCurves();
    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForTimeout(4000);
    await waitForCurves();

    const stateProbe = await page.evaluate(() => {
      const bakedMeta = window.LinearizationState?.getGlobalBakedMeta?.() || null;
      const corrected = window.LinearizationState?.getGlobalCorrectedCurves?.() || null;
      const baseline = window.LinearizationState?.getGlobalBaselineCurves?.() || null;
      const data = window.getLoadedQuadData?.();
      const sampleIndex = 180;
      const curveSample = data?.curves?.K?.[sampleIndex] ?? null;
      const correctedSample = corrected?.K?.[sampleIndex] ?? null;
      const baselineSample = baseline?.K?.[sampleIndex] ?? null;
      return {
        bakedMeta,
        hasCorrected: !!corrected,
        hasBaseline: !!baseline,
        curveSample,
        correctedSample,
        baselineSample
      };
    });

    expect(stateProbe.bakedMeta).toBeTruthy();
    expect(stateProbe.bakedMeta?.channels || []).toEqual(expect.arrayContaining(['K', 'LK']));
    expect(stateProbe.hasCorrected).toBe(true);
    expect(stateProbe.hasBaseline).toBe(true);
    expect(stateProbe.curveSample).toBe(stateProbe.correctedSample);
    expect(stateProbe.baselineSample).not.toBeNull();
  });

  test('composite clamp guard is toggleable for diagnostics', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
    await page.waitForFunction(() => typeof window.isCompositeClampGuardEnabled === 'function', null, { timeout: 20000 });

    const initialState = await page.evaluate(() => ({
      clampGuard: window.isCompositeClampGuardEnabled?.() ?? null,
      redistribution: window.isCompositeLabRedistributionEnabled?.() ?? null
    }));

    expect(initialState.clampGuard).toBe(true);
    expect(initialState.redistribution).toBe(true);

    await page.evaluate(() => {
      window.enableCompositeClampGuard?.(false);
    });

    const afterDisable = await page.evaluate(() => ({
      clampGuard: window.isCompositeClampGuardEnabled?.() ?? null
    }));
    expect(afterDisable.clampGuard).toBe(false);

    await page.evaluate(() => {
      window.enableCompositeClampGuard?.(true);
    });

    const afterReEnable = await page.evaluate(() => ({
      clampGuard: window.isCompositeClampGuardEnabled?.() ?? null
    }));
    expect(afterReEnable.clampGuard).toBe(true);
  });

  test('composite clamp guard preserves endpoints when disabled', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const labPath = resolve('data/TRIFORCE_V4.txt');
    const quadPath = resolve('data/TRIFORCE_V4.quad');

    await page.goto(indexUrl);
    await page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' });
    await page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    const waitForCurves = async () => {
      await page.waitForFunction(() => {
        const data = window.getLoadedQuadData?.();
        return data && data.curves && data.curves.K && data.curves.K.length === 256;
      }, null, { timeout: 20000 });
    };

    const loadAll = async () => {
      await page.setInputFiles('#quadFile', quadPath);
      await waitForCurves();
      await page.setInputFiles('#linearizationFile', labPath);
      await page.waitForTimeout(4000);
      await waitForCurves();
    };

    await page.evaluate(() => {
      window.enableCompositeLabRedistribution?.(true);
      window.enableCompositeClampGuard?.(true);
    });

    await loadAll();

    const baseline = await page.evaluate(() => {
      const data = window.getLoadedQuadData?.();
      if (!data?.curves?.K) return null;
      const endpointIndex = data.curves.K.length - 1;
      const totalEnd = Object.values(data.curves).reduce((sum, arr) => {
        if (!Array.isArray(arr)) return sum;
        return sum + (arr[endpointIndex] || 0);
      }, 0);
      return {
        totalEnd,
        kEnd: data.curves.K[endpointIndex]
      };
    });

    expect(baseline).not.toBeNull();

    await page.evaluate(() => window.enableCompositeClampGuard?.(false));
    await loadAll();

    const unclamped = await page.evaluate(() => {
      const data = window.getLoadedQuadData?.();
      if (!data?.curves?.K) return null;
      const endpointIndex = data.curves.K.length - 1;
      const totals = Object.values(data.curves).reduce((sum, arr) => sum + (arr?.[endpointIndex] || 0), 0);
      return {
        totalEnd: totals,
        kEnd: data.curves.K[endpointIndex]
      };
    });

    expect(unclamped).not.toBeNull();
    expect(unclamped?.kEnd).toBe(baseline?.kEnd ?? NaN);
    expect(unclamped?.totalEnd).toBe(baseline?.totalEnd ?? NaN);
  });
});
