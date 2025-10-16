import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const DATASET = {
  quad: 'data/P800_K36C26LK25_V6.quad',
  lab: 'data/P800_K36C26LK25_V6.txt'
};

async function setRangeValue(page, selector: string, value: number) {
  await page.locator(selector).evaluate((input, nextValue) => {
    const slider = input as HTMLInputElement;
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function waitForPlotSmoothingPercent(page, expected: number) {
  await page.waitForFunction(
    (target) => {
      const valueText = document.getElementById('plotSmoothingPercentValue')?.textContent ?? '';
      return valueText.startsWith(`${target}%`);
    },
    expected,
    { timeout: 5000 }
  );
}

async function waitForLabSmoothingPercent(page, expected: number) {
  await page.waitForFunction(
    (target) => {
      const valueText = document.getElementById('labSmoothingPercentValue')?.textContent ?? '';
      return valueText.startsWith(`${target}%`);
    },
    expected,
    { timeout: 5000 }
  );
}

async function captureCurveSnapshot(page) {
  return page.evaluate(() => {
    const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
    const corrected =
      window.LinearizationState && typeof window.LinearizationState.getGlobalCorrectedCurves === 'function'
        ? window.LinearizationState.getGlobalCorrectedCurves()
        : null;

    const targetCurves = corrected || (loaded && loaded.curves) || {};
    const maxima: Record<string, number> = {};

    Object.entries(targetCurves || {}).forEach(([channel, values]) => {
      if (!Array.isArray(values)) return;
      let max = 0;
      for (let i = 0; i < values.length; i += 1) {
        const numeric = Number(values[i]);
        if (Number.isFinite(numeric) && numeric > max) {
          max = numeric;
        }
      }
      maxima[channel] = max;
    });

    const baselineEnd: Record<string, number> = {};
    if (loaded && loaded.baselineEnd && typeof loaded.baselineEnd === 'object') {
      Object.entries(loaded.baselineEnd).forEach(([channel, value]) => {
        baselineEnd[channel] = Number(value) || 0;
      });
    }

    return {
      maxima,
      baselineEnd
    };
  });
}

test.describe('LAB smoothing regression', () => {
  test('plot smoothing slider returns to baseline when reset', async ({ page }) => {
    page.on('console', (message) => {
      const text = message.text();
      if (
        text.includes('LabNormalization') ||
        text.includes('zero snapshot') ||
        text.includes('afterLabReset')
      ) {
        console.log('[browser]', message.type(), text);
      }
    });
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await Promise.all([
      page.waitForSelector('#quadFile', { state: 'attached' }),
      page.waitForSelector('#linearizationFile', { state: 'attached' })
    ]);

    await page.evaluate(() => {
      window.DEBUG_LOGS = true;
    });

    const sliderDiagnostics = await page.evaluate(() => {
      const slider = document.querySelector('#plotSmoothingPercentSlider') as HTMLInputElement | null;
      return slider
        ? {
            min: slider.min,
            max: slider.max,
            value: slider.value,
            step: slider.step,
            disabled: slider.disabled
          }
        : null;
    });

    expect(sliderDiagnostics).not.toBeNull();
    expect(sliderDiagnostics?.min).toBe('0');
    expect(sliderDiagnostics?.max).toBe('300');
    expect(sliderDiagnostics?.value).toBe('0');
    expect(sliderDiagnostics?.disabled).toBeFalsy();

    await page.setInputFiles('#quadFile', resolve(DATASET.quad));

    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return data && data.curves && Object.keys(data.curves).length > 0;
    });

    await page.setInputFiles('#linearizationFile', resolve(DATASET.lab));

    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    await page.waitForTimeout(750);

    const baselineSnapshot = await captureCurveSnapshot(page);
    const initialChannels = Object.keys(baselineSnapshot.baselineEnd);
    expect(initialChannels.length).toBeGreaterThan(0);

    await setRangeValue(page, '#labSmoothingPercentSlider', 300);
    await waitForLabSmoothingPercent(page, 300);
    await page.waitForTimeout(750);

    const afterLabSmoothing = await captureCurveSnapshot(page);
    expect(Object.keys(afterLabSmoothing.baselineEnd)).toEqual(initialChannels);
    await page.screenshot({
      path: resolve('artifacts/lab-smoothing/slope-kernel-smoothing-300.png'),
      clip: { x: 180, y: 120, width: 900, height: 580 }
    });

    await setRangeValue(page, '#labSmoothingPercentSlider', 0);
    await waitForLabSmoothingPercent(page, 0);
    await page.waitForTimeout(750);

    const afterLabReset = await captureCurveSnapshot(page);
    console.log('[debug] afterLabReset baselineEnd:', afterLabReset.baselineEnd);
    console.log('[debug] afterLabReset maxima:', afterLabReset.maxima);
    const zeroSnapshotStatus = await page.evaluate(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return {
        restored: !!data?._zeroSmoothingRestored,
        hasSnapshot: !!data?._zeroSmoothingCurves,
        signature: data?._zeroSmoothingSignature || null,
        reapplied: !!data?._zeroSmoothingReapplied
      };
    });
    console.log('[debug] zero snapshot after lab reset:', zeroSnapshotStatus);
    const zeroSnapshotMax = await page.evaluate(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      const curves = data?._zeroSmoothingCurves || {};
      const maxByChannel = {};
      Object.entries(curves).forEach(([name, values]) => {
        if (Array.isArray(values)) {
          maxByChannel[name] = values.reduce((max, value) => (value > max ? value : max), 0);
        }
      });
      return maxByChannel;
    });
    console.log('[debug] zero snapshot maxima:', zeroSnapshotMax);
    const originalBaselineEnd = await page.evaluate(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return data?._originalBaselineEnd || null;
    });
    console.log('[debug] original baseline end:', originalBaselineEnd);
    const originalCurveMax = await page.evaluate(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      const original = data?.originalCurves?.K;
      return Array.isArray(original) ? Math.max(...original) : null;
    });
    console.log('[debug] original curve max (K):', originalCurveMax);

    initialChannels.forEach((channel) => {
      const expectedBaseline = baselineSnapshot.baselineEnd[channel] ?? 0;
      const restoredBaseline = afterLabReset.baselineEnd[channel] ?? 0;
      expect(restoredBaseline).toBeCloseTo(expectedBaseline, 0);

      const expectedMax = baselineSnapshot.maxima[channel] ?? 0;
      const restoredMax = afterLabReset.maxima[channel] ?? 0;
      expect(restoredMax).toBeCloseTo(expectedMax, 0);
    });

    await setRangeValue(page, '#plotSmoothingPercentSlider', 300);
    await waitForPlotSmoothingPercent(page, 300);
    await page.waitForTimeout(750);

    const afterSmoothingSnapshot = await captureCurveSnapshot(page);
    expect(Object.keys(afterSmoothingSnapshot.baselineEnd)).toEqual(initialChannels);

    await setRangeValue(page, '#plotSmoothingPercentSlider', 0);
    await waitForPlotSmoothingPercent(page, 0);
    await page.waitForTimeout(750);

    const restoredSnapshot = await captureCurveSnapshot(page);

    initialChannels.forEach((channel) => {
      const expectedBaseline = baselineSnapshot.baselineEnd[channel] ?? 0;
      const restoredBaseline = restoredSnapshot.baselineEnd[channel] ?? 0;
      expect(restoredBaseline).toBeCloseTo(expectedBaseline, 0);

      const expectedMax = baselineSnapshot.maxima[channel] ?? 0;
      const restoredMax = restoredSnapshot.maxima[channel] ?? 0;
      expect(restoredMax).toBeCloseTo(expectedMax, 0);
    });
  });
});
