import type { Page } from '@playwright/test';

const SCALE_TOLERANCE = 0.05;

export async function waitForScaleComplete(page: Page, expectedPercent: number, timeout = 20000) {
  await page.waitForFunction(
    ({ expected, tolerance }) => {
      const getter = (window as any).getCurrentScale
        || (window as any).__quadDebug?.scalingUtils?.getCurrentScale;
      const current = typeof getter === 'function' ? getter() : null;
      const input = document.getElementById('scaleAllInput') as HTMLInputElement | null;
      const inputValue = input ? Number(input.value) : NaN;
      const matchesGetter = typeof current === 'number' && Math.abs(current - expected) <= tolerance;
      const matchesInput = Number.isFinite(inputValue) && Math.abs(inputValue - expected) <= tolerance;
      return matchesGetter || matchesInput;
    },
    { expected: expectedPercent, tolerance: SCALE_TOLERANCE },
    { timeout, polling: 100 }
  );
}

export async function waitForPointNearInput(
  page: Page,
  channel: string,
  targetInputPercent: number,
  tolerance = 5,
  timeout = 5000
) {
  await page.waitForFunction(
    ({ ch, target, tol }) => {
      const control = (window as any).ControlPoints?.get?.(ch);
      if (!control || !Array.isArray(control.points)) return false;
      return control.points.some((point) => Math.abs(point.input - target) <= tol);
    },
    { ch: channel, target: targetInputPercent, tol: tolerance },
    { timeout, polling: 100 }
  );
}

export async function captureScalingState(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      getCurrentScale?: () => number;
      __quadDebug?: {
        scalingUtils?: {
          getCurrentScale?: () => number;
        };
      };
    };

    const scaleGetter = win.getCurrentScale || win.__quadDebug?.scalingUtils?.getCurrentScale;
    const scalePercent = typeof scaleGetter === 'function' ? scaleGetter() : null;

    const rows = Array.from(document.querySelectorAll('tr[data-channel]')).map((row) => {
      const channel = row.getAttribute('data-channel') ?? 'unknown';
      const percentInput = row.querySelector('.percent-input') as HTMLInputElement | null;
      const endInput = row.querySelector('.end-input') as HTMLInputElement | null;
      const percentValue = percentInput ? Number(percentInput.value) : NaN;
      const endValue = endInput ? Number(endInput.value) : NaN;
      return {
        channel,
        percentValue,
        endValue,
      };
    });

    return { scalePercent, rows };
  });
}

export function compareScalingStates(
  before: { scalePercent: number | null; rows: { channel: string; percentValue: number; endValue: number }[] },
  after: { scalePercent: number | null; rows: { channel: string; percentValue: number; endValue: number }[] }
) {
  const channelChanges = after.rows.map((afterRow) => {
    const prior = before.rows.find((row) => row.channel === afterRow.channel);
    return {
      channel: afterRow.channel,
      percentDelta: typeof afterRow.percentValue === 'number' && typeof prior?.percentValue === 'number'
        ? afterRow.percentValue - (prior?.percentValue ?? Number.NaN)
        : Number.NaN,
      endDelta: typeof afterRow.endValue === 'number' && typeof prior?.endValue === 'number'
        ? afterRow.endValue - (prior?.endValue ?? Number.NaN)
        : Number.NaN,
      beforePercent: prior?.percentValue ?? null,
      afterPercent: afterRow.percentValue,
      beforeEnd: prior?.endValue ?? null,
      afterEnd: afterRow.endValue,
    };
  });

  return {
    beforeScale: before.scalePercent,
    afterScale: after.scalePercent,
    scaleDelta: typeof before.scalePercent === 'number' && typeof after.scalePercent === 'number'
      ? after.scalePercent - before.scalePercent
      : null,
    channelChanges,
  };
}
