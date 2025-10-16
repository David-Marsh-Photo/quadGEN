import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');
const labPath = resolve('data/TRIFORCE_V4.txt');
const CURVE_RESOLUTION = 256;
const MAX_PLOT_SMOOTHING = 300;

async function waitForCurves(page) {
  await page.waitForFunction((expectedLength) => {
    const data = window.getLoadedQuadData?.();
    if (!data?.curves) return false;
    return Object.values(data.curves).some((arr) => Array.isArray(arr) && arr.length === expectedLength);
  }, CURVE_RESOLUTION, { timeout: 20000 });
}

async function loadQuad(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await waitForCurves(page);
}

async function loadLab(page) {
  await page.setInputFiles('#linearizationFile', labPath);
  await page.waitForFunction(
    () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
    null,
    { timeout: 20000 }
  );
  await waitForCurves(page);
}

async function setPlotSmoothing(page, percent) {
  await page.waitForSelector('#optionsBtn', { state: 'attached', timeout: 15000 });
  await page.click('#optionsBtn');

  const slider = page.locator('#plotSmoothingPercentSlider');
  await slider.waitFor({ state: 'visible' });
  await slider.evaluate(
    (element, value) => {
      element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    percent
  );

  await page.waitForFunction(
    (expected) => {
      const label = document.getElementById('plotSmoothingPercentValue');
      return label?.textContent?.trim().startsWith(`${expected}%`);
    },
    percent,
    { timeout: 5000 }
  );
  await page.waitForFunction(
    (expected) => {
      const getter = window.getLoadedQuadData;
      if (typeof getter !== 'function') return false;
      const data = getter();
      if (!data) return true;
      if (typeof data.plotSmoothingPercent !== 'number') return true;
      return data.plotSmoothingPercent === expected;
    },
    percent,
    { timeout: 5000 }
  );

  await page.click('#closeOptionsBtn');
  await page.waitForFunction(
    () => document.getElementById('optionsModal')?.classList.contains('hidden'),
    null,
    { timeout: 5000 }
  );
}

async function setCompositeWeighting(page, value) {
  await page.waitForSelector('#optionsBtn', { state: 'attached', timeout: 15000 });
  await page.click('#optionsBtn');
  await page.waitForSelector('#optionsModal:not(.hidden)', { timeout: 5000 });

  const debugToggle = page.locator('#compositeDebugToggle');
  if (await debugToggle.count()) {
    await debugToggle.waitFor({ state: 'visible', timeout: 5000 });
    if (!(await debugToggle.isChecked())) {
      await debugToggle.check();
    }
  }

  const weightingSelect = page.locator('#compositeWeightingSelect');
  await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
  await weightingSelect.selectOption(value);

  await page.waitForFunction(
    (expected) => document.getElementById('compositeWeightingSelect')?.value === expected,
    value,
    { timeout: 5000 }
  );

  await page.click('#closeOptionsBtn');
  await page.waitForFunction(
    () => document.getElementById('optionsModal')?.classList.contains('hidden'),
    null,
    { timeout: 5000 }
  );
}

async function captureChannelSnapshot(page) {
  return page.evaluate(() => {
    const data = window.getLoadedQuadData?.();
    if (!data?.curves) return null;

    const sampleIndices = [16, 64, 128, 192, 240];
    const snapshot = {
      percent: data.plotSmoothingPercent ?? null,
      channels: {}
    };

    for (const [channel, curve] of Object.entries(data.curves)) {
      if (!Array.isArray(curve)) continue;
      const typed = Array.from(curve);
      const max = typed.reduce((acc, value) => (value > acc ? value : acc), Number.NEGATIVE_INFINITY);
      const min = typed.reduce((acc, value) => (value < acc ? value : acc), Number.POSITIVE_INFINITY);
      snapshot.channels[channel] = {
        max,
        min,
        samples: sampleIndices.map((index) => typed[index] ?? null)
      };
    }

    return snapshot;
  });
}

test.describe('TRIFORCE plot smoothing guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
  });

  test('does not reintroduce LK ink past its peak when smoothing is applied', async ({ page }) => {
    const smoothingPercent = 50;
    await setPlotSmoothing(page, smoothingPercent);

    await loadQuad(page);
    await loadLab(page);

    const sampleIndex = Math.round(0.30 * (CURVE_RESOLUTION - 1));
    const snapshot = await page.evaluate((index) => {
      const data = window.getLoadedQuadData?.();
      if (!data?.curves || !data.plotBaseCurves) return null;
      const finalCurves = data.curves;
      const baseCurves = data.plotBaseCurves;
      const recordedPeak = Number.isFinite(data.channelPeaks?.LK) ? data.channelPeaks.LK : null;
      const finalSeries = finalCurves.LK ? Array.from(finalCurves.LK) : [];
      let computedPeakIndex = 0;
      let peakValue = -Infinity;
      finalSeries.forEach((value, idx) => {
        if (value > peakValue) {
          peakValue = value;
          computedPeakIndex = idx;
        }
      });
      return {
        smoothing: window.getLoadedQuadData?.plotSmoothingPercent ?? null,
        final: {
          LK: finalCurves.LK?.[index] ?? null,
          C: finalCurves.C?.[index] ?? null
        },
        base: {
          LK: baseCurves.LK?.[index] ?? null,
          C: baseCurves.C?.[index] ?? null
        },
        computedPeakIndex,
        recordedPeakIndex: recordedPeak
      };
    }, sampleIndex);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.base?.LK).not.toBeNull();
    expect(snapshot?.final?.LK).not.toBeNull();
    expect(snapshot?.final?.LK ?? 0).toBeLessThanOrEqual((snapshot?.base?.LK ?? 0) + 1);
    expect(snapshot?.final?.LK ?? 0).toBeGreaterThanOrEqual(0);
    if (Number.isFinite(snapshot?.recordedPeakIndex)) {
      expect(snapshot?.computedPeakIndex ?? 0).toBeGreaterThanOrEqual(snapshot?.recordedPeakIndex ?? 0);
    }
    expect(snapshot?.final?.C).toBeGreaterThanOrEqual(0);
  });

  test('restores original curves after heavy smoothing adjustments', async ({ page }) => {
    await loadQuad(page);
    await loadLab(page);

    const baseline = await captureChannelSnapshot(page);
    expect(baseline).not.toBeNull();
    expect(baseline?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(baseline?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    await setPlotSmoothing(page, MAX_PLOT_SMOOTHING);
    const afterMax = await captureChannelSnapshot(page);
    expect(afterMax).not.toBeNull();
    expect(afterMax?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(afterMax?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    await setPlotSmoothing(page, 0);
    const afterReset = await captureChannelSnapshot(page);
    expect(afterReset).not.toBeNull();

    const baselineCSamples = baseline?.channels?.C?.samples ?? [];
    const baselineLKSamples = baseline?.channels?.LK?.samples ?? [];
    const resetCSamples = afterReset?.channels?.C?.samples ?? [];
    const resetLKSamples = afterReset?.channels?.LK?.samples ?? [];

    expect(resetCSamples).toEqual(baselineCSamples);
    expect(resetLKSamples).toEqual(baselineLKSamples);
  });

  test('isolated weighting keeps channel amplitudes after max smoothing', async ({ page }, testInfo) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    await setCompositeWeighting(page, 'normalized');

    await loadQuad(page);
    await loadLab(page);
    const before = await captureChannelSnapshot(page);
    expect(before?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(before?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)', { timeout: 5000 });

    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 5000 });
    const isChecked = await debugToggle.isChecked();
    if (!isChecked) {
      await debugToggle.check();
    }

    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
    await weightingSelect.selectOption('isolated');
    await page.waitForFunction(
      () => document.getElementById('compositeWeightingSelect')?.value === 'isolated',
      null,
      { timeout: 5000 }
    );

    const slider = page.locator('#plotSmoothingPercentSlider');
    await slider.waitFor({ state: 'visible', timeout: 5000 });
    await slider.evaluate((element, maxValue) => {
      element.value = String(maxValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, MAX_PLOT_SMOOTHING);
    await page.waitForFunction(
      (maxValue) => document.getElementById('plotSmoothingPercentValue')?.textContent?.trim().startsWith(`${maxValue}%`),
      MAX_PLOT_SMOOTHING,
      { timeout: 5000 }
    );

    await page.click('#closeOptionsBtn');
    await page.waitForFunction(
      () => document.getElementById('optionsModal')?.classList.contains('hidden'),
      null,
      { timeout: 5000 }
    );

    await page.waitForTimeout(500);

    const afterMax = await captureChannelSnapshot(page);
    await testInfo.attach('isolated-weighting-after-max.json', {
      body: JSON.stringify(afterMax, null, 2),
      contentType: 'application/json'
    });

    expect(afterMax?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(afterMax?.channels?.LK?.max ?? -1).toBeGreaterThan(0);
  });

  test('isolated weighting keeps channel amplitudes at 150% smoothing', async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    await loadQuad(page);
    await loadLab(page);

    const baseline = await captureChannelSnapshot(page);
    expect(baseline).not.toBeNull();
    expect(baseline?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(baseline?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    await setCompositeWeighting(page, 'isolated');
    await setPlotSmoothing(page, 150);
    const afterSmoothing = await captureChannelSnapshot(page);

    expect(afterSmoothing?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(afterSmoothing?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    const uiEnds = await page.evaluate(() => {
      const readRowEnd = (channel) => {
        const row = document.querySelector(`tr.channel-row[data-channel="${channel}"]`);
        if (!row) return null;
        const input = row.querySelector('input.end-input');
        return input ? Number(input.value) || 0 : null;
      };
      return {
        C: readRowEnd('C'),
        LK: readRowEnd('LK')
      };
    });
    expect(uiEnds?.C ?? 0).toBeGreaterThan(0);
    expect(uiEnds?.LK ?? 0).toBeGreaterThan(0);
  });

  test('isolated weighting with pre-set 150% smoothing keeps channel amplitudes', async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    await setCompositeWeighting(page, 'isolated');
    await setPlotSmoothing(page, 150);

    await loadQuad(page);
    await loadLab(page);
    const snapshot = await captureChannelSnapshot(page);

    expect(snapshot?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(snapshot?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    const uiEnds = await page.evaluate(() => {
      const readRowEnd = (channel) => {
        const row = document.querySelector(`tr.channel-row[data-channel="${channel}"]`);
        if (!row) return null;
        const input = row.querySelector('input.end-input');
        return input ? Number(input.value) || 0 : null;
      };
      return {
        C: readRowEnd('C'),
        LK: readRowEnd('LK')
      };
    });
    expect(uiEnds?.C ?? 0).toBeGreaterThan(0);
    expect(uiEnds?.LK ?? 0).toBeGreaterThan(0);
  });

  test('switching to isolated weighting after heavy smoothing retains channel amplitudes', async ({ page }, testInfo) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    await loadQuad(page);
    await loadLab(page);

    await setCompositeWeighting(page, 'normalized');
    await page.waitForTimeout(500);

    const baseline = await captureChannelSnapshot(page);
    expect(baseline?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(baseline?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    await setPlotSmoothing(page, MAX_PLOT_SMOOTHING);
    const smoothed = await captureChannelSnapshot(page);
    expect(smoothed?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(smoothed?.channels?.LK?.max ?? -1).toBeGreaterThan(0);

    const baselineCurves = await page.evaluate(() => {
      const getter = window.getLoadedQuadData;
      if (typeof getter !== 'function') return null;
      const data = getter();
      if (!data?.curves) return null;
      return {
        LK: Array.from(data.curves.LK ?? []),
        C: Array.from(data.curves.C ?? [])
      };
    });

    await setCompositeWeighting(page, 'isolated');
    await page.waitForFunction(
      (previous) => {
        const getter = window.getLoadedQuadData;
        if (typeof getter !== 'function') return false;
        const data = getter();
        if (!data?.curves?.LK || !previous?.LK?.length) return false;
        const currentLK = data.curves.LK;
        for (let i = 0; i < currentLK.length; i += 1) {
          if (currentLK[i] !== previous.LK[i]) {
            return true;
          }
        }
        return false;
      },
      baselineCurves,
      { timeout: 10000 }
    );
    const afterIsolated = await captureChannelSnapshot(page);
    const uiEnds = await page.evaluate(() => {
        const readRowEnd = (channel) => {
            const row = document.querySelector(`tr.channel-row[data-channel="${channel}"]`);
            if (!row) return null;
            const endInput = row.querySelector('input.end-value');
            return endInput ? Number(endInput.value) || 0 : null;
        };
        return {
            C: readRowEnd('C'),
            LK: readRowEnd('LK'),
            K: readRowEnd('K')
        };
    });
    await testInfo.attach('switch-isolated-after.json', {
      body: JSON.stringify(afterIsolated, null, 2),
      contentType: 'application/json'
    });

    expect(afterIsolated?.channels?.C?.max ?? -1).toBeGreaterThan(0);
    expect(afterIsolated?.channels?.LK?.max ?? -1).toBeGreaterThan(0);
  });

  test('plot smoothing ignores stale caches when weighting mode changes', async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    await setCompositeWeighting(page, 'normalized');
    await loadQuad(page);
    await loadLab(page);

    await setPlotSmoothing(page, MAX_PLOT_SMOOTHING);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
        const getter = window.getLoadedQuadData;
        if (typeof getter !== 'function') return;
        const data = getter();
        if (!data) return;
        const zero = new Array(256).fill(0);
        if (!data._plotSmoothingOriginalCurves) {
            data._plotSmoothingOriginalCurves = {};
        }
        data._plotSmoothingOriginalCurves.C = zero.slice();
        data._plotSmoothingOriginalCurves.LK = zero.slice();
    });

    await setCompositeWeighting(page, 'isolated');
    await loadLab(page);
    await waitForCurves(page);
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
        const getter = window.getLoadedQuadData;
        if (typeof getter !== 'function') return null;
        const data = getter();
        if (!data || !data.curves) return null;
        const max = (channel) => {
            if (!Array.isArray(data.curves[channel])) return null;
            return data.curves[channel].reduce((acc, value) => Math.max(acc, value), 0);
        };
        return {
            maxC: max('C'),
            maxLK: max('LK')
        };
    });

    expect(result?.maxC ?? 0).toBeGreaterThan(0);
    expect(result?.maxLK ?? 0).toBeGreaterThan(0);
  });
});
