import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { waitForScaleComplete, waitForPointNearInput } from '../utils/scaling-test-helpers';

test.describe('Edit Mode key point scaling', () => {
  test('inserting a Smart point follows the plotted curve after scaling', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    const mkPercent = page.locator('tr[data-channel="MK"] input.percent-input');
    await mkPercent.click();
    await mkPercent.fill('50');
    await mkPercent.press('Enter');
    await expect(mkPercent).toHaveValue('50');

    await page.locator('#editModeToggleBtn').click();
    await expect(page.locator('#editModeLabel')).toHaveText(/ON/);

    await page.waitForFunction(() => {
      const control = window.ControlPoints?.get?.('MK');
      return Array.isArray(control?.points) && control.points.length >= 2;
    });

    const rect = await page.evaluate(() => {
      const canvas = document.querySelector('canvas#inkChart');
      if (!canvas) {
        throw new Error('ink chart canvas not found');
      }
      const r = canvas.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });

    const clickX = rect.left + rect.width * 0.5;
    const clickY = rect.top + rect.height * 0.5;
    await page.mouse.click(clickX, clickY);

    await waitForPointNearInput(page, 'MK', 50, 5);

    const analysis = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="MK"]');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const channelPercent = parseFloat(row?.querySelector('.percent-input')?.value ?? '100') || 100;
      const control = window.ControlPoints?.get?.('MK');
      const points = control?.points ?? [];
      const inserted = points.reduce((best, point) => {
        if (!best) return point;
        return Math.abs(point.input - 50) < Math.abs(best.input - 50) ? point : best;
      }, points[0] ?? null);

      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, 'MK', window.LinearizationState?.globalApplied ?? false)
        : null;

      let samplePercent: number | null = null;
      if (curve && inserted) {
        const idx = Math.round((inserted.input / 100) * (curve.length - 1));
        samplePercent = (curve[idx] / 65535) * 100;
      }

      const tooltip = document.querySelector('#chartCursorTooltip');

      const insertedAbsolute = inserted
        ? {
            input: inserted.input,
            output: (inserted.output / 100) * channelPercent,
          }
        : null;

      return {
        insertedRelative: inserted,
        inserted: insertedAbsolute,
        samplePercent,
        delta:
          insertedAbsolute && samplePercent !== null
            ? samplePercent - insertedAbsolute.output
            : null,
        tooltipText: tooltip?.textContent?.trim() ?? null,
      };
    });

    expect(analysis.inserted).toBeTruthy();
    expect(analysis.samplePercent).not.toBeNull();
    expect(Math.abs((analysis.delta ?? Number.NaN))).toBeLessThanOrEqual(0.5);
    expect(analysis.tooltipText).toBeTruthy();
  });

  test('recompute regenerates Smart points without double-scaling', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    const quadPath = resolve('testdata/humped_shadow_dip.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    await page.waitForFunction(() => window.getLoadedQuadData?.()?.curves?.K, undefined, { timeout: 20000 });

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.ControlPoints?.get?.('K')?.points?.length >= 3, undefined, { timeout: 20000 });

    const beforeSnapshot = await page.evaluate(() => JSON.stringify(window.ControlPoints?.get?.('K')?.points || []));

    await page.locator('#editRecomputeBtn').click();
    await page.waitForFunction((previous) => {
      const points = window.ControlPoints?.get?.('K')?.points || [];
      return points.length > 0 && JSON.stringify(points) !== previous;
    }, beforeSnapshot, { timeout: 20000, polling: 100 });

    const analysis = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="K"]');
      const percentInput = row?.querySelector('.percent-input');
      const channelPercent = parseFloat(percentInput?.value ?? '100') || 100;
      const control = window.ControlPoints?.get?.('K');
      const points = control?.points ?? [];
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, 'K', window.LinearizationState?.globalApplied ?? false)
        : null;

      const comparisons = points.map((point) => {
        const absolute = (point.output / 100) * channelPercent;
        if (!curve || curve.length === 0) {
          return { input: point.input, relative: point.output, absolute, delta: null };
        }
        const idx = Math.round((point.input / 100) * (curve.length - 1));
        const samplePercent = (curve[idx] / 65535) * 100;
        return {
          input: point.input,
          relative: point.output,
          absolute,
          samplePercent,
          delta: samplePercent - absolute
        };
      });

      return {
        channelPercent,
        comparisons
      };
    });

    expect(analysis.comparisons.length).toBeGreaterThanOrEqual(3);
    for (const comparison of analysis.comparisons.slice(1, -1)) {
      expect(comparison.relative).toBeGreaterThanOrEqual(0);
      expect(comparison.relative).toBeLessThanOrEqual(100);
      if (comparison.delta !== null) {
        expect(Math.abs(comparison.delta)).toBeLessThanOrEqual(0.75);
      }
    }
  });

  test('global scale preserves Smart curve absolute outputs', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    await page.locator('#editModeToggleBtn').click();
    await expect(page.locator('#editModeLabel')).toHaveText(/ON/);

    await page.waitForFunction(() => {
      const control = window.ControlPoints?.get?.('MK');
      return Array.isArray(control?.points) && control.points.length >= 2;
    }, undefined, { timeout: 15000 });

    await page.evaluate(() => window.applyGlobalScale?.(80));
    await waitForScaleComplete(page, 80);

    await expect(page.locator('tr[data-channel="MK"] input.percent-input')).toHaveValue(/80/);

    const artifactsDir = resolve('artifacts');
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true });
    }
    await page.screenshot({ path: resolve('artifacts', 'global-scale-smart.png') });

    const analysis = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="MK"]');
      const percentInput = row?.querySelector('.percent-input');
      const channelPercent = parseFloat(percentInput?.value ?? '0') || 0;
      const control = window.ControlPoints?.get?.('MK');
      const points = control?.points ?? [];
      const lastPoint = points.length > 0 ? points[points.length - 1] : null;

      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, 'MK', window.LinearizationState?.globalApplied ?? false)
        : null;

      let lastSamplePercent: number | null = null;
    if (curve && curve.length > 0) {
      const denominator = curve.length - 1;
      const lastValue = curve[denominator];
        lastSamplePercent = (lastValue / 65535) * 100;
      }

      return {
        channelPercent,
        lastSamplePercent,
        lastPointOutput: lastPoint?.output ?? null,
        pointCount: points.length
      };
    });

    expect(analysis.pointCount).toBeGreaterThanOrEqual(2);
    expect(analysis.lastPointOutput).not.toBeNull();
    expect(Math.abs((analysis.lastPointOutput ?? 0) - 100)).toBeLessThan(0.05);
    expect(analysis.channelPercent).toBeGreaterThan(0);
    expect(analysis.lastSamplePercent).not.toBeNull();
    expect(Math.abs((analysis.lastSamplePercent ?? 0) - analysis.channelPercent)).toBeLessThan(0.5);

    const mkPercent = page.locator('tr[data-channel="MK"] input.percent-input');
    await mkPercent.click({ clickCount: 3 });
    await mkPercent.type('100');
    await mkPercent.press('Enter');
    await expect(mkPercent).toHaveValue(/80/);

    const postAdjustment = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="MK"]');
      const percentInput = row?.querySelector('.percent-input');
      const channelPercent = parseFloat(percentInput?.value ?? '0') || 0;
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, 'MK', window.LinearizationState?.globalApplied ?? false)
        : null;

      let lastSamplePercent: number | null = null;
      if (curve && curve.length > 0) {
        const lastValue = curve[curve.length - 1];
        lastSamplePercent = (lastValue / 65535) * 100;
      }

      return {
        channelPercent,
        lastSamplePercent
      };
    });

    expect(postAdjustment.channelPercent).toBeCloseTo(80, 1);
    expect(postAdjustment.lastSamplePercent).not.toBeNull();
    expect(Math.abs((postAdjustment.lastSamplePercent ?? 0) - postAdjustment.channelPercent)).toBeLessThan(0.5);
  });

  test('entering edit mode preserves global correction curve shape', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    const quadPath = resolve('data/P800_K37_C26_LK25_V1.quad');
    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(
      () => window.getLoadedQuadData?.()?.curves?.K,
      undefined,
      { timeout: 20000 }
    );

    const correctionPath = resolve('data/P800_K37_C26_LK25_V1_correction.txt');
    await page.setInputFiles('input#linearizationFile', correctionPath);
    await page.waitForFunction(
      () => window.LinearizationState?.isGlobalEnabled?.(),
      undefined,
      { timeout: 20000 }
    );

    const beforeSamples = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="K"]');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const values = typeof window.make256 === 'function'
        ? window.make256(endValue, 'K', window.LinearizationState?.globalApplied ?? false)
        : null;
      return values ? Array.from(values) : null;
    });

    expect(beforeSamples).not.toBeNull();

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(
      () => window.ControlPoints?.get?.('K')?.points?.length >= 2,
      undefined,
      { timeout: 20000 }
    );

    const pointCount = await page.evaluate(() => window.ControlPoints?.get?.('K')?.points?.length ?? 0);
    expect(pointCount).toBeGreaterThan(0);
    expect(pointCount).toBeLessThanOrEqual(256);

    const bakedUiState = await page.evaluate(() => {
      const toggle = document.getElementById('globalLinearizationToggle');
      const label = document.getElementById('globalLinearizationFilename');
      const meta = window.LinearizationState?.getGlobalBakedMeta?.() || null;
      return {
        toggleDisabled: toggle?.disabled ?? null,
        ariaDisabled: toggle?.getAttribute('aria-disabled') || null,
        labelText: label?.textContent?.trim() || null,
        bakedFilename: meta?.filename || null
      };
    });

    expect(bakedUiState.toggleDisabled).toBe(true);
    expect(bakedUiState.ariaDisabled).toBe('true');
    expect(bakedUiState.labelText || '').toMatch(/^\*BAKED\*/);

    const afterSamples = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="K"]');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const values = typeof window.make256 === 'function'
        ? window.make256(endValue, 'K', window.LinearizationState?.globalApplied ?? false)
        : null;
      return values ? Array.from(values) : null;
    });

    expect(afterSamples).not.toBeNull();

    const before = beforeSamples ?? [];
    const after = afterSamples ?? [];

    expect(after.length).toBe(before.length);

    let maxDelta = 0;
    for (let i = 0; i < before.length; i += 1) {
      const delta = Math.abs((after[i] ?? 0) - (before[i] ?? 0));
      if (delta > maxDelta) {
        maxDelta = delta;
      }
    }

    expect(maxDelta).toBeLessThanOrEqual(1000);

    const undoBtn = page.locator('#undoBtn');
    for (let i = 0; i < 6; i += 1) {
      if (!(await undoBtn.isEnabled())) {
        break;
      }
      await undoBtn.click();
      const bakedMeta = await page.evaluate(() => window.LinearizationState?.getGlobalBakedMeta?.() || null);
      if (!bakedMeta) {
        break;
      }
    }

    await page.waitForFunction(
      () => !window.LinearizationState?.getGlobalBakedMeta?.(),
      undefined,
      { timeout: 20000 }
    );

    const postUndoState = await page.evaluate(() => {
      const toggle = document.getElementById('globalLinearizationToggle');
      const label = document.getElementById('globalLinearizationFilename');
      const meta = window.LinearizationState?.getGlobalBakedMeta?.() || null;
      return {
        toggleDisabled: toggle?.disabled ?? null,
        labelText: label?.textContent?.trim() || null,
        bakedMeta: meta
      };
    });

    expect(postUndoState.bakedMeta).toBeNull();
    expect(postUndoState.toggleDisabled).toBe(false);
    expect(postUndoState.labelText || '').not.toMatch(/^\*BAKED\*/);
  });

  test('adding a Smart point after global scale keeps absolute output aligned', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });

    await page.locator('#editModeToggleBtn').click();
    await expect(page.locator('#editModeLabel')).toHaveText(/ON/);

    await page.waitForFunction(() => {
      const control = window.ControlPoints?.get?.('MK');
      return Array.isArray(control?.points) && control.points.length >= 2;
    }, undefined, { timeout: 15000 });

    await page.evaluate(() => window.applyGlobalScale?.(80));
    await waitForScaleComplete(page, 80);
    await expect(page.locator('tr[data-channel="MK"] input.percent-input')).toHaveValue(/80/);

    const rect = await page.evaluate(() => {
      const canvas = document.querySelector('canvas#inkChart');
      if (!canvas) {
        throw new Error('ink chart canvas not found');
      }
      const r = canvas.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });

    const clickX = rect.left + rect.width * 0.5;
    const clickY = rect.top + rect.height * 0.45;
    await page.mouse.click(clickX, clickY);

    await waitForPointNearInput(page, 'MK', 50, 5);

    const analysis = await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="MK"]');
      const control = window.ControlPoints?.get?.('MK');
      const endInput = row?.querySelector('.end-input');
      const percentInput = row?.querySelector('.percent-input');
      const channelPercent = parseFloat(percentInput?.value ?? '0') || 0;
      const endValue = window.InputValidator?.clampEnd?.(endInput?.value ?? 0) ?? 0;
      const points = control?.points ?? [];
      const inserted = points.reduce((best, point) => {
        if (!best) return point;
        return Math.abs(point.input - 50) < Math.abs(best.input - 50) ? point : best;
      }, points[0] ?? null);

      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, 'MK', window.LinearizationState?.globalApplied ?? false)
        : null;

      let samplePercent: number | null = null;
      if (curve && inserted) {
        const idx = Math.round((inserted.input / 100) * (curve.length - 1));
        samplePercent = (curve[idx] / 65535) * 100;
      }

      return {
        channelPercent,
        inserted,
        samplePercent,
        delta: inserted && samplePercent !== null
          ? samplePercent - ((inserted.output / 100) * channelPercent)
          : null,
      };
    });

    expect(analysis.channelPercent).toBeCloseTo(80, 1);
    expect(analysis.inserted).toBeTruthy();
    expect(analysis.samplePercent).not.toBeNull();
    expect(Math.abs(analysis.delta ?? Number.NaN)).toBeLessThanOrEqual(0.6);
    expect(analysis.inserted?.output).toBeGreaterThanOrEqual(0);
    expect(analysis.inserted?.output).toBeLessThanOrEqual(100);
  });

  test('editing X via XY input preserves surrounding curve shape', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const quadPath = resolve('data/TRIFORCE_V3.quad');

    await page.goto(indexUrl);
    await page.waitForSelector('#globalLinearizationBtn', { timeout: 20000 });

    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(() => window.getLoadedQuadData?.()?.curves?.K, undefined, { timeout: 20000 });

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    await page.waitForFunction(() => {
      const control = window.ControlPoints?.get?.('K');
      return Array.isArray(control?.points) && control.points.length >= 6;
    }, undefined, { timeout: 20000 });

    await page.waitForSelector('#editChannelSelect', { timeout: 10000 });
    await page.selectOption('#editChannelSelect', 'K');

    for (let i = 1; i < 6; i += 1) {
      await page.locator('#editPointRight').click();
      await page.waitForFunction(
        (expected) => (window.EDIT?.selectedOrdinal ?? 1) === expected,
        i + 1,
        { timeout: 2000 }
      );
    }

    const beforeState = await page.evaluate(() => {
      const channel = window.EDIT?.selectedChannel;
      const ordinal = window.EDIT?.selectedOrdinal ?? 1;
      const row = document.querySelector('tr[data-channel="K"]');
      const percentInput = row?.querySelector('.percent-input');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd(endInput?.value ?? 0) ?? 0;
      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, channel, window.LinearizationState?.globalApplied ?? false)
        : [];
      const control = window.ControlPoints?.get(channel)?.points || [];
      const compat = window.__quadDebug?.compat;
      const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
      const point = control[(ordinal ?? 1) - 1] || null;
      const nextPoint = control[ordinal] || null;
      return {
        xyValue: document.getElementById('editXYInput')?.value ?? '',
        sample128: curve.length > 128 ? curve[128] : null,
        percentValue: percentInput?.value ?? null,
        ordinal,
        selected: point
          ? {
              input: point.input,
              relative: point.output,
              absolute: typeof toAbsolute === 'function' ? toAbsolute(channel, point.output) : point.output
            }
          : null,
        nextInput: nextPoint?.input ?? null
      };
    });

    expect(beforeState.xyValue).toContain(',');
    expect(beforeState.sample128).not.toBeNull();
    expect(beforeState.selected).not.toBeNull();

    const [rawX, rawY] = beforeState.xyValue.split(',');
    const xBefore = parseFloat(rawX);
    const relativeY = beforeState.selected?.relative ?? Number.NaN;
    expect(Number.isFinite(xBefore)).toBeTruthy();
    expect(Number.isFinite(relativeY)).toBeTruthy();

    let xTarget = xBefore + 1.5;
    if (Number.isFinite(beforeState.nextInput)) {
      xTarget = Math.min(xTarget, beforeState.nextInput - 0.5);
    }
    xTarget = Math.min(xTarget, 98);

    const formattedX = xTarget.toFixed(1);
    const formattedY = Number.isFinite(relativeY)
      ? relativeY.toFixed(1)
      : (Number.isFinite(parseFloat(rawY)) ? parseFloat(rawY).toFixed(1) : rawY.trim());
    const targetString = `${formattedX},${formattedY}`;

    await page.fill('#editXYInput', targetString);
    await page.press('#editXYInput', 'Enter');

    await page.waitForFunction(
      ({ target, ordinal }) => {
        const channel = window.EDIT?.selectedChannel;
        const control = window.ControlPoints?.get(channel)?.points || [];
        const point = control[(ordinal ?? 1) - 1] || null;
        if (!point) return false;
        return Math.abs(point.input - target) < 0.3;
      },
      { target: parseFloat(formattedX), ordinal: beforeState.ordinal },
      { timeout: 5000 }
    );

    const afterState = await page.evaluate(() => {
      const channel = window.EDIT?.selectedChannel;
      const row = document.querySelector('tr[data-channel="K"]');
      const percentInput = row?.querySelector('.percent-input');
      const endInput = row?.querySelector('.end-input');
      const endValue = window.InputValidator?.clampEnd(endInput?.value ?? 0) ?? 0;
      const curve = typeof window.make256 === 'function'
        ? window.make256(endValue, channel, window.LinearizationState?.globalApplied ?? false)
        : [];
      const compat = window.__quadDebug?.compat;
      const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
      const point = window.ControlPoints?.get(channel)?.points?.[(window.EDIT?.selectedOrdinal ?? 1) - 1] || null;
      return {
        xyValue: document.getElementById('editXYInput')?.value ?? '',
        sample128: curve.length > 128 ? curve[128] : null,
        percentValue: percentInput?.value ?? null,
        selectedAbsolute: point && typeof toAbsolute === 'function'
          ? toAbsolute(channel, point.output)
          : point?.output ?? null
      };
    });

    expect(afterState.xyValue).not.toEqual('');
    expect(afterState.sample128).not.toBeNull();

    const beforeSample = Number(beforeState.sample128);
    const afterSample = Number(afterState.sample128);
    expect(Number.isFinite(beforeSample)).toBeTruthy();
    expect(Number.isFinite(afterSample)).toBeTruthy();

    const delta = Math.abs(afterSample - beforeSample);
    expect(delta).toBeLessThanOrEqual(1000);
  });
});
