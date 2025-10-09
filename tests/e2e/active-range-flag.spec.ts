import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { waitForUndoRedoReady, getHistoryStackCounts, clickUndo, clickRedo } from '../utils/history-helpers';

test.describe('Active-range feature flag', () => {
  test('remaps delayed-onset channels and updates export metadata', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);
    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });
    await waitForUndoRedoReady(page);

    const structure = await page.evaluate(() => ({
      hasQuadInput: !!document.querySelector('input#quadFile'),
      hasLabInput: !!document.querySelector('input#linearizationFile'),
      hasPrinterSelect: !!document.querySelector('#printerSelect'),
      hasChart: !!document.querySelector('#inkChart')
    }));

    expect(structure.hasQuadInput).toBe(true);
    expect(structure.hasLabInput).toBe(true);
    expect(structure.hasPrinterSelect).toBe(true);
    expect(structure.hasChart).toBe(true);

    const quadPath = resolve('data/P800_K37_C26_LK25_V1.quad');
    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(
      () => window.getLoadedQuadData?.()?.curves?.K,
      undefined,
      { timeout: 20000 }
    );

    const labPath = resolve('data/P800_K37_C26_LK25_V1_correction.txt');
    await page.setInputFiles('input#linearizationFile', labPath);
    await page.waitForFunction(
      () => window.LinearizationState?.isGlobalEnabled?.(),
      undefined,
      { timeout: 20000 }
    );

    await page.evaluate(() => window.enableActiveRangeLinearization?.(false));
    await page.waitForFunction(
      () => !window.isActiveRangeLinearizationEnabled?.(),
      undefined,
      { timeout: 5000 }
    );

    const fixedMetrics = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="K"]');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const values = typeof window.make256 === 'function'
        ? window.make256(endValue, 'K', true)
        : [];

      const findThreshold = (threshold) => {
        for (let i = 0; i < values.length; i++) {
          if ((values[i] ?? 0) >= threshold) return i;
        }
        return -1;
      };

      return {
        firstNonZero: values.findIndex((value) => value > 0),
        threshold5000: findThreshold(5000),
        threshold10000: findThreshold(10000)
      };
    });

    expect(fixedMetrics.firstNonZero).toBeGreaterThanOrEqual(0);

    await page.evaluate(() => window.enableActiveRangeLinearization?.(true));
    await page.waitForFunction(
      () => window.isActiveRangeLinearizationEnabled?.(),
      undefined,
      { timeout: 5000 }
    );

    const activeMetrics = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="K"]');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const values = typeof window.make256 === 'function'
        ? window.make256(endValue, 'K', true)
        : [];

      const findThreshold = (threshold) => {
        for (let i = 0; i < values.length; i++) {
          if ((values[i] ?? 0) >= threshold) return i;
        }
        return -1;
      };

      let quadText = '';
      const compatFileOps = window.__quadDebug?.compat?.fileOperations || null;

      if (compatFileOps && typeof compatFileOps.generateAndDownloadQuadFile === 'function') {
        const originalDownload = compatFileOps.downloadFile;
        const originalBlob = window.Blob;
        try {
          let capturedParts = null;
          window.Blob = function(parts, options) {
            capturedParts = parts;
            return new originalBlob(parts, options);
          };
          compatFileOps.downloadFile = (content) => {
            quadText = typeof content === 'string' ? content : String(content || '');
            return { captured: true };
          };
          compatFileOps.generateAndDownloadQuadFile();
          if (!quadText && Array.isArray(capturedParts)) {
            quadText = capturedParts
              .map((part) => (typeof part === 'string' ? part : String(part || '')))
              .join('');
          }
        } catch (error) {
          quadText = '';
        } finally {
          compatFileOps.downloadFile = originalDownload;
          window.Blob = originalBlob;
        }
      }

      const lines = quadText ? quadText.split('\n') : [];
      const linearizationHeaderIndex = lines.findIndex((line) => line.includes('Linearization Applied (LAB measurements):'));
      const globalLine = lines.find((line) => line.startsWith('# - Global:')) || null;
      const limitLine = lines.find((line) => line.startsWith('#   K:')) || null;
      const maxValue = values.reduce((acc, value) => Math.max(acc, value ?? 0), 0);
      const computedPercent = maxValue > 0 ? (maxValue / 65535) * 100 : 0;

      return {
        firstNonZero: values.findIndex((value) => value > 0),
        threshold5000: findThreshold(5000),
        threshold10000: findThreshold(10000),
        exportData: {
          quadText,
          linearizationHeaderIndex,
          globalLine,
          limitLine,
          computedPercent
        }
      };
    });

    expect(activeMetrics.firstNonZero).toBe(fixedMetrics.firstNonZero);
    expect(activeMetrics.threshold5000).toBeGreaterThanOrEqual(0);
    expect(activeMetrics.threshold10000).toBeGreaterThanOrEqual(0);
    expect(activeMetrics.threshold5000).toBeLessThanOrEqual(fixedMetrics.threshold5000 + 16);
    expect(activeMetrics.threshold10000).toBeLessThanOrEqual(fixedMetrics.threshold10000 + 16);

    const { exportData } = activeMetrics;
    expect(exportData.quadText.length).toBeGreaterThan(0);
    expect(exportData.linearizationHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(exportData.globalLine).toBeTruthy();
    expect(exportData.limitLine).toBeTruthy();

    if (exportData.limitLine) {
      const percentMatch = exportData.limitLine.match(/max\s+([0-9.]+)%/);
      expect(percentMatch).not.toBeNull();
      if (percentMatch) {
        const reportedPercent = parseFloat(percentMatch[1]);
        expect(Math.abs(reportedPercent - exportData.computedPercent)).toBeLessThan(0.5);
      }
    }

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    const recomputeResult = await page.evaluate(() => {
      const smartApi = window.__quadDebug?.compat?.smartCurves;
      if (!smartApi?.simplifySmartKeyPointsFromCurve) {
        throw new Error('smartCurves API unavailable');
      }
      return smartApi.simplifySmartKeyPointsFromCurve('K', {
        maxErrorPercent: 0.5,
        maxPoints: 16
      });
    });

    expect(recomputeResult?.success).toBe(true);

    const metricsAfterRecompute = await page.evaluate(() => {
      const compat = window.__quadDebug?.compat;
      const getLoaded = compat?.stateManager?.getLoadedQuadData ?? window.getLoadedQuadData;
      const data = typeof getLoaded === 'function' ? getLoaded() : null;
      const endValue = data?.baselineEnd?.K ?? 65535;
      const makeFn = compat?.processingPipeline?.make256 ?? window.make256;
      if (typeof makeFn !== 'function') {
        throw new Error('make256 unavailable');
      }
      const values = makeFn(endValue, 'K', true);
      const firstNonZero = values.findIndex((value) => value > 0);
      const sample128 = values[128] ?? null;
      const sample200 = values[200] ?? null;
      return { firstNonZero, sample128, sample200 };
    });

    const historyStacks = await getHistoryStackCounts(page);
    expect(historyStacks.history).toBeGreaterThan(0);

    await clickUndo(page);
    await clickRedo(page);

    const metricsAfterRedo = await page.evaluate(() => {
      const compat = window.__quadDebug?.compat;
      const getLoaded = compat?.stateManager?.getLoadedQuadData ?? window.getLoadedQuadData;
      const data = typeof getLoaded === 'function' ? getLoaded() : null;
      const endValue = data?.baselineEnd?.K ?? 65535;
      const makeFn = compat?.processingPipeline?.make256 ?? window.make256;
      if (typeof makeFn !== 'function') {
        throw new Error('make256 unavailable');
      }
      const values = makeFn(endValue, 'K', true);
      const firstNonZero = values.findIndex((value) => value > 0);
      const sample128 = values[128] ?? null;
      const sample200 = values[200] ?? null;
      return { firstNonZero, sample128, sample200 };
    });

    expect(metricsAfterRedo).toEqual(metricsAfterRecompute);
  });
});
