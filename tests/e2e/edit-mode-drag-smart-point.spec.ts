import { test, expect } from '@playwright/test';
import {
  gotoApp,
  loadManualLab,
  enableEditMode,
  enableSmartPointDragFlag,
  waitForSmartPoints,
  selectOrdinal,
  getSelectedPoint,
  getClientCoordinates,
  waitForPointMutation,
  readStatusText
} from './utils/edit-mode-helpers';

test.describe('Edit Mode Smart point dragging', () => {
    test('dragging a Smart point adjusts its coordinates', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    const flagStatus = await enableSmartPointDragFlag(page);
    expect(flagStatus.probe).not.toBeNull();
    await waitForSmartPoints(page);
    await selectOrdinal(page, 3);

    const before = await getSelectedPoint(page);
    expect(before.channel).not.toBeNull();
    expect(before.input).not.toBeNull();
    expect(before.output).not.toBeNull();

    const target = await getClientCoordinates(page, before.channel, before.ordinal);
    await page.mouse.move(target.clientX, target.clientY);
    await page.mouse.down();
    await page.mouse.move(target.clientX + 12, target.clientY - 80, { steps: 8 });
    await page.mouse.up();

    const after = await waitForPointMutation(page, before);
    expect(after).not.toBeFalsy();
    if (after) {
      expect(after.channel).toBe(before.channel);
      expect(after.ordinal).toBe(before.ordinal);
      expect(Math.abs(after.output - (before.output ?? 0))).toBeGreaterThan(0.05);
    }
  });

  test('dragging across a neighbour respects monotonic ordering and updates status', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);
    await selectOrdinal(page, 3);

    const neighbour = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const points = (window as any).ControlPoints?.get(channel)?.points || [];
      return {
        channel,
        previousInput: points[1]?.input ?? null
      };
    });

    expect(neighbour.previousInput).not.toBeNull();

    const before = await getSelectedPoint(page);
    const target = await getClientCoordinates(page, before.channel, before.ordinal);
    await page.mouse.move(target.clientX, target.clientY);
    await page.mouse.down();
    await page.mouse.move(target.clientX - 200, target.clientY + 30, { steps: 10 });
    await page.mouse.up();

    const after = await waitForPointMutation(page, before);
    expect(after).not.toBeFalsy();
    if (after) {
      const minAllowed = (neighbour.previousInput ?? 0) + 0.009;
      expect(after.input).toBeGreaterThanOrEqual(minAllowed);
    }

  });

  test('horizontal drag keeps other Smart points stable', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);
    await selectOrdinal(page, 6);

    const baselineBefore = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const row = channel ? document.querySelector(`tr[data-channel="${channel}"]`) : null;
      const percentInput = row?.querySelector('.percent-input') as HTMLInputElement | null;
      const endInput = row?.querySelector('.end-input') as HTMLInputElement | null;
      return {
        percentValue: percentInput?.value ?? null,
        percentBase: percentInput?.getAttribute('data-base-percent') ?? null,
        endValue: endInput?.value ?? null,
        endBase: endInput?.getAttribute('data-base-end') ?? null
      };
    });

    const snapshotBefore = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const points = (window as any).ControlPoints?.get(channel)?.points || [];
      const compat = (window as any).__quadDebug?.compat;
      const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
      return points.map((point, idx) => ({
        ordinal: idx + 1,
        input: point.input,
        output: point.output,
        absolute: typeof toAbsolute === 'function' ? toAbsolute(channel, point.output) : point.output
      }));
    });

    const before = await getSelectedPoint(page);
    const coords = await getClientCoordinates(page, before.channel, before.ordinal);
    await page.mouse.move(coords.clientX, coords.clientY);
    await page.mouse.down();
    await page.mouse.move(coords.clientX + 60, coords.clientY, { steps: 12 });
    await page.mouse.up();

    const mutated = await waitForPointMutation(page, before);
    expect(mutated).not.toBeFalsy();
    if (!mutated) {
      throw new Error('Smart point did not report mutation');
    }

    const snapshotAfter = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const points = (window as any).ControlPoints?.get(channel)?.points || [];
      const compat = (window as any).__quadDebug?.compat;
      const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
      return points.map((point, idx) => ({
        ordinal: idx + 1,
        input: point.input,
        output: point.output,
        absolute: typeof toAbsolute === 'function' ? toAbsolute(channel, point.output) : point.output
      }));
    });

    const changedOrdinals = snapshotAfter.filter((point, index) => {
      if (point.ordinal === mutated.ordinal) return false;
      const baseline = snapshotBefore[index];
      if (!baseline) return false;
      const dx = Math.abs(point.input - baseline.input);
      const dy = Math.abs(point.absolute - baseline.absolute);
      return dx > 0.05 || dy > 0.5;
    }).map((point) => point.ordinal);

    expect(changedOrdinals).toEqual([]);

    const baselineAfter = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const row = channel ? document.querySelector(`tr[data-channel="${channel}"]`) : null;
      const percentInput = row?.querySelector('.percent-input') as HTMLInputElement | null;
      const endInput = row?.querySelector('.end-input') as HTMLInputElement | null;
      return {
        percentValue: percentInput?.value ?? null,
        percentBase: percentInput?.getAttribute('data-base-percent') ?? null,
        endValue: endInput?.value ?? null,
        endBase: endInput?.getAttribute('data-base-end') ?? null
      };
    });

    const percentBefore = Number(baselineBefore.percentBase ?? baselineBefore.percentValue ?? NaN);
    const percentAfter = Number(baselineAfter.percentBase ?? baselineAfter.percentValue ?? NaN);
    const endBefore = Number(baselineBefore.endBase ?? baselineBefore.endValue ?? NaN);
    const endAfter = Number(baselineAfter.endBase ?? baselineAfter.endValue ?? NaN);

    expect(Number.isFinite(percentBefore)).toBeTruthy();
    expect(Number.isFinite(percentAfter)).toBeTruthy();
    expect(Math.abs(percentAfter - percentBefore)).toBeLessThanOrEqual(0.25);
    if (Number.isFinite(endBefore) && Number.isFinite(endAfter)) {
      expect(Math.abs(endAfter - endBefore)).toBeLessThanOrEqual(10);
    }
  });

  test('drag cancels when pointer leaves the chart', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);
    await selectOrdinal(page, 6);

    const beforePoint = await getSelectedPoint(page);
    const beforeSample = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const row = document.querySelector(`tr[data-channel="${channel}"]`);
      const endInput = row?.querySelector('.end-input');
      const endValue = (window as any).InputValidator?.clampEnd(endInput?.value ?? 0) ?? 0;
      const curve = typeof (window as any).make256 === 'function'
        ? (window as any).make256(endValue, channel, (window as any).LinearizationState?.globalApplied ?? false)
        : [];
      return curve.length > 128 ? curve[128] : null;
    });

    const coords = await getClientCoordinates(page, beforePoint.channel, beforePoint.ordinal);
    await page.mouse.move(coords.clientX, coords.clientY);
    await page.mouse.down();
    await page.mouse.move(coords.clientX + 1500, coords.clientY - 900, { steps: 8 });

    await page.waitForFunction(() => !(window as any).isSmartPointDragActive?.(), undefined, { timeout: 5000 });

    await page.mouse.up();

    const afterPoint = await getSelectedPoint(page);
    const afterSample = await page.evaluate(() => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const row = document.querySelector(`tr[data-channel="${channel}"]`);
      const endInput = row?.querySelector('.end-input');
      const endValue = (window as any).InputValidator?.clampEnd(endInput?.value ?? 0) ?? 0;
      const curve = typeof (window as any).make256 === 'function'
        ? (window as any).make256(endValue, channel, (window as any).LinearizationState?.globalApplied ?? false)
        : [];
      return curve.length > 128 ? curve[128] : null;
    });

    expect(afterPoint.input).toBeCloseTo(beforePoint.input ?? 0, 3);
    expect(afterPoint.absoluteOutput).toBeCloseTo(beforePoint.absoluteOutput ?? 0, 3);
    if (beforeSample !== null && afterSample !== null) {
      expect(Math.abs(afterSample - beforeSample)).toBeLessThanOrEqual(1);
    }
  });

  test('drag history supports undo and redo', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);
    await selectOrdinal(page, 5);

    const before = await getSelectedPoint(page);
    expect(before.input).not.toBeNull();
    expect(before.output).not.toBeNull();

    const coords = await getClientCoordinates(page, before.channel, before.ordinal);
    await page.mouse.move(coords.clientX, coords.clientY);
    await page.mouse.down();
    await page.mouse.move(coords.clientX + 40, coords.clientY - 60, { steps: 12 });
    await page.mouse.up();

    const mutated = await waitForPointMutation(page, before);
    expect(mutated).not.toBeFalsy();
    if (!mutated) return;

    await page.waitForFunction(() => {
      const undoBtn = document.getElementById('undoBtn');
      return !!undoBtn && !undoBtn.disabled;
    }, undefined, { timeout: 5000 });
    await page.locator('#undoBtn').click();

    await page.waitForFunction(
      (expected) => {
        const points = (window as any).ControlPoints?.get(expected.channel)?.points || [];
        const point = points[(expected.ordinal ?? 1) - 1] || null;
        if (!point) return false;
        const dx = Math.abs(point.input - (expected.input ?? 0));
        const dy = Math.abs(point.output - (expected.output ?? 0));
        return dx < 0.05 && dy < 0.05;
      },
      before,
      { timeout: 5000 }
    );

    const afterUndo = await getSelectedPoint(page);
    expect(afterUndo.input).toBeCloseTo(before.input ?? 0, 3);
    expect(afterUndo.output).toBeCloseTo(before.output ?? 0, 3);

    await page.waitForFunction(() => {
      const redoBtn = document.getElementById('redoBtn');
      return !!redoBtn && !redoBtn.disabled;
    }, undefined, { timeout: 5000 });
    await page.locator('#redoBtn').click();

    await page.waitForFunction(
      (expected) => {
        const points = (window as any).ControlPoints?.get(expected.channel)?.points || [];
        const point = points[(expected.ordinal ?? 1) - 1] || null;
        if (!point) return false;
        const dx = Math.abs(point.input - (expected.input ?? 0));
        const dy = Math.abs(point.output - (expected.output ?? 0));
        return dx < 0.05 && dy < 0.05;
      },
      mutated,
      { timeout: 5000 }
    );

    const afterRedo = await getSelectedPoint(page);
    expect(afterRedo.input).toBeCloseTo(mutated.input ?? 0, 3);
    expect(afterRedo.output).toBeCloseTo(mutated.output ?? 0, 3);
  });

  test('locked channel rejects Smart point dragging', async ({ page }) => {
    await gotoApp(page);
    await loadManualLab(page);
    await enableEditMode(page);
    await enableSmartPointDragFlag(page);
    await waitForSmartPoints(page);
    await selectOrdinal(page, 4);

    await page.evaluate(() => {
      const row = document.querySelector('tr.channel-row[data-channel="MK"]');
      if (row) {
        row.style.display = 'table-row';
        row.setAttribute('data-compact', 'false');
      }
    });

    const lockButton = page.locator('tr.channel-row[data-channel="MK"] .channel-lock-btn');
    await lockButton.click({ force: true });
    await expect(lockButton).toHaveAttribute('data-locked', 'true');

    const before = await getSelectedPoint(page);
    expect(before.channel).toBe('MK');
    expect(before.absoluteOutput).not.toBeNull();

    const coords = await getClientCoordinates(page, before.channel, before.ordinal);
    await page.mouse.move(coords.clientX, coords.clientY);
    await page.mouse.down();
    await page.mouse.move(coords.clientX + 30, coords.clientY - 160, { steps: 8 });
    await page.mouse.up();

    const after = await getSelectedPoint(page);
    expect(after.channel).toBe('MK');
    expect(Math.abs((after.absoluteOutput ?? 0) - (before.absoluteOutput ?? 0))).toBeLessThan(0.5);
  });
});
