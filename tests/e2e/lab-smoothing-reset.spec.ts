import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');
const labPath = resolve('data/TRIFORCE_V4.txt');

async function waitForCurves(page) {
  await page.waitForFunction(() => {
    const data = window.getLoadedQuadData?.();
    return !!(data?.curves && data.curves.C && data.curves.C.length === 256);
  }, null, { timeout: 20000 });
}

async function loadQuadAndLab(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await waitForCurves(page);
  await page.setInputFiles('#linearizationFile', labPath);
  await page.waitForFunction(
    () => window.LinearizationState?.globalApplied === true,
    null,
    { timeout: 20000 }
  );
  await waitForCurves(page);
}

async function setLabSmoothing(page, percent) {
  await page.click('#optionsBtn');
  await page.waitForSelector('#optionsModal:not(.hidden)', { timeout: 5000 });

  await page.locator('#labSmoothingPercentSlider').evaluate(
    (slider, value) => {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    },
    percent
  );

  await page.waitForFunction(
    (expected) => {
      const label = document.getElementById('labSmoothingPercentValue');
      return label?.textContent?.trim().startsWith(`${expected}%`);
    },
    percent,
    { timeout: 5000 }
  );

  await page.click('#closeOptionsBtn');
  await page.waitForFunction(
    () => {
      const modal = document.getElementById('optionsModal');
      return modal?.classList.contains('hidden');
    },
    null,
    { timeout: 5000 }
  );
}

async function captureChannelState(page, tag) {
  return await page.evaluate((label) => {
    const data = window.getLoadedQuadData?.();
    const rows = Array.from(document.querySelectorAll('tr.channel-row[data-channel]'));
    const rowSnapshot = rows.map((row) => ({
      channel: row.getAttribute('data-channel') ?? '',
      percent: row.querySelector('.percent-input')?.value ?? null,
      end: row.querySelector('.end-input')?.value ?? null
    }));

    const curveSnapshot = {};
    if (data?.curves && typeof window.make256 === 'function') {
      Object.keys(data.curves).forEach((channelName) => {
        const endValue = data.baselineEnd?.[channelName];
        if (typeof endValue === 'number') {
          try {
            curveSnapshot[channelName] = window.make256(endValue, channelName, true)?.slice?.() ?? null;
          } catch (err) {
            curveSnapshot[channelName] = null;
          }
        }
      });
    }

    return {
      tag: label,
      smoothing: window.LinearizationState?.getGlobalData?.()?.previewSmoothingPercent ?? null,
      baselineEnd: data?.baselineEnd ? { ...data.baselineEnd } : null,
      originalBaselineEnd: data?._originalBaselineEnd ? { ...data._originalBaselineEnd } : null,
      rowSnapshot,
      curveSnapshot
    };
  }, tag);
}

function maxCurveDelta(reference = {}, current = {}) {
  const channels = new Set([...Object.keys(reference || {}), ...Object.keys(current || {})]);
  let max = 0;
  channels.forEach((channel) => {
    const baselineCurve = reference?.[channel];
    const currentCurve = current?.[channel];
    if (!Array.isArray(baselineCurve) || !Array.isArray(currentCurve)) {
      return;
    }
    if (baselineCurve.length !== currentCurve.length) {
      max = Infinity;
      return;
    }
    for (let i = 0; i < baselineCurve.length; i += 1) {
      const baselineValue = Number(baselineCurve[i]) || 0;
      const currentValue = Number(currentCurve[i]) || 0;
      const diff = Math.abs(currentValue - baselineValue);
      if (diff > max) {
        max = diff;
      }
    }
  });
  return max;
}

test.describe('LAB smoothing slider', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(indexUrl);
    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
  });

  test('adjusting smoothing reshapes the applied curves', async ({ page }) => {
    await loadQuadAndLab(page);

    const initial = await captureChannelState(page, 'initial');
    expect(initial.baselineEnd?.C).toBeGreaterThan(0);
    expect(initial.rowSnapshot.find((row) => row.channel === 'C')?.percent).not.toBeNull();

    await setLabSmoothing(page, 300);
    await page.waitForFunction(
      (baselineCurve) => {
        const data = window.getLoadedQuadData?.();
        if (!data?.curves?.K || !Array.isArray(baselineCurve)) {
          return false;
        }
        const current = data.curves.K;
        if (!Array.isArray(current) || current.length !== baselineCurve.length) {
          return false;
        }
        for (let i = 0; i < current.length; i += 1) {
          if (current[i] !== baselineCurve[i]) {
            return true;
          }
        }
        return false;
      },
      initial.curveSnapshot?.K ?? null,
      { timeout: 10000 }
    );

    const afterMax = await captureChannelState(page, 'afterMax');
    const maxCurveDelta = Object.entries(afterMax.curveSnapshot || {}).reduce((acc, [channel, curve]) => {
      const baselineCurve = initial.curveSnapshot?.[channel];
      if (!Array.isArray(curve) || !Array.isArray(baselineCurve)) return acc;
      const delta = curve.reduce((max, value, index) => {
        const diff = Math.abs((value ?? 0) - (baselineCurve[index] ?? 0));
        return diff > max ? diff : max;
      }, 0);
      return delta > acc ? delta : acc;
    }, 0);
    expect(maxCurveDelta).toBeGreaterThan(100);
  });

  test('returning smoothing to zero restores baseline curves after reload', async ({ page }) => {
    await loadQuadAndLab(page);

    await setLabSmoothing(page, 0);
    await page.waitForFunction(
      () => window.LinearizationState?.getGlobalData?.()?.previewSmoothingPercent === 0,
      null,
      { timeout: 10000 }
    );
    const zeroState = await captureChannelState(page, 'zero');

    await setLabSmoothing(page, 200);
    await page.waitForFunction(
      (baseline) => {
        const data = window.getLoadedQuadData?.();
        if (!data?.curves) return false;
        const target = baseline?.K;
        const current = data.curves.K;
        if (!Array.isArray(target) || !Array.isArray(current)) return false;
        if (target.length !== current.length) return false;
        return current.some((value, idx) => value !== target[idx]);
      },
      zeroState.curveSnapshot ?? {},
      { timeout: 10000 }
    );

    const widenedState = await captureChannelState(page, 'widened');
    expect(maxCurveDelta(zeroState.curveSnapshot, widenedState.curveSnapshot)).toBeGreaterThan(50);

    await setLabSmoothing(page, 0);
    await page.waitForFunction(
      () => window.LinearizationState?.getGlobalData?.()?.previewSmoothingPercent === 0,
      null,
      { timeout: 10000 }
    );

    await page.setInputFiles('#linearizationFile', []);
    await page.waitForTimeout(50);
    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      null,
      { timeout: 20000 }
    );
    await waitForCurves(page);
    await page.waitForFunction(
      () => window.LinearizationState?.getGlobalData?.()?.previewSmoothingPercent === 0,
      null,
      { timeout: 10000 }
    );

    const resetState = await captureChannelState(page, 'reset');
    const deltaAfterReset = maxCurveDelta(zeroState.curveSnapshot, resetState.curveSnapshot);
    expect(deltaAfterReset).toBeLessThanOrEqual(1);
  });
});
