import type { Page } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
const CHART_ZOOM_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

export async function gotoApp(page: Page) {
  await page.goto(indexUrl);
  await page.waitForSelector('#globalLinearizationBtn');
}

export async function loadManualLab(page: Page) {
  await page.setInputFiles('input#linearizationFile', manualLabPath);
  await page.waitForFunction(
    () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
    undefined,
    { timeout: 15000 }
  );
}

export async function enableEditMode(page: Page) {
  await page.locator('#editModeToggleBtn').click();
  await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });
}

export async function enableSmartPointDragFlag(page: Page) {
  return page.evaluate(() => {
    const enable = (window as any).enableSmartPointDrag;
    if (typeof enable !== 'function') {
      throw new Error('Smart point drag feature flag is unavailable');
    }
    const result = enable(true);
    const probe = (window as any).isSmartPointDragEnabled?.();
    return { result, probe: probe === undefined ? null : !!probe };
  });
}

export async function waitForSmartPoints(page: Page) {
  await page.waitForFunction(
    () => {
      const channel = (window as any).EDIT?.selectedChannel;
      const points = (window as any).ControlPoints?.get(channel)?.points;
      return Array.isArray(points) && points.length > 5;
    },
    undefined,
    { timeout: 10000 }
  );
}

export async function selectOrdinal(page: Page, targetOrdinal: number) {
  const current = await page.evaluate(() => (window as any).EDIT?.selectedOrdinal ?? 1);
  if (current === targetOrdinal) return;
  const delta = targetOrdinal - current;
  const locator = delta > 0 ? '#editPointRight' : '#editPointLeft';
  const steps = Math.abs(delta);
  for (let i = 0; i < steps; i += 1) {
    await page.locator(locator).click();
  }
  await page.waitForFunction(
    (ordinal) => (window as any).EDIT?.selectedOrdinal === ordinal,
    targetOrdinal,
    { timeout: 2000 }
  );
}

export async function getSelectedPoint(page: Page) {
  return page.evaluate(() => {
    const channel = (window as any).EDIT?.selectedChannel ?? null;
    const ordinal = (window as any).EDIT?.selectedOrdinal ?? 1;
    const cp = (window as any).ControlPoints?.get(channel)?.points || [];
    const point = cp[ordinal - 1] || null;
    const compat = (window as any).__quadDebug?.compat;
    const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
    const absoluteOutput = point && typeof toAbsolute === 'function'
      ? toAbsolute(channel, point.output)
      : point?.output ?? null;
    return {
      channel,
      ordinal,
      input: point?.input ?? null,
      output: point?.output ?? null,
      absoluteOutput
    };
  });
}

type CoordinateOptions = {
  absoluteOverride?: number | null;
};

export async function getClientCoordinates(
  page: Page,
  channel: string | null,
  ordinal: number,
  options: CoordinateOptions = {}
) {
  return page.evaluate(
    ({ channel: ch, ordinal: ord, override, levels }) => {
      const canvas = document.getElementById('inkChart') as HTMLCanvasElement | null;
      if (!canvas) {
        throw new Error('ink chart canvas missing');
      }

      const controlPoints = (window as any).ControlPoints?.get(ch)?.points || [];
      const point = controlPoints[ord - 1];
      if (!point) {
        throw new Error('Selected Smart point not found');
      }

      const compat = (window as any).__quadDebug?.compat;
      const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
      const stateHelper = (window as any).__quadDebug?.coreState;
      const appState = stateHelper && typeof stateHelper.getAppState === 'function'
        ? stateHelper.getAppState()
        : null;
      let zoomIndex = Number(appState?.chartZoomIndex ?? levels.length - 1);
      if (!Number.isFinite(zoomIndex)) {
        zoomIndex = levels.length - 1;
      }
      zoomIndex = Math.max(0, Math.min(levels.length - 1, Math.round(zoomIndex)));
      const displayMax = levels[zoomIndex] ?? 100;

      const devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
      const topPadding = 12 * devicePixelRatio;
      const bottomPadding = 40 * devicePixelRatio;
      const leftPadding = (36 + 26) * devicePixelRatio;
      const rightPadding = (36 + 34) * devicePixelRatio;
      const chartWidth = Math.max(0, canvas.width - leftPadding - rightPadding);
      const chartHeight = Math.max(0, canvas.height - topPadding - bottomPadding);

      const effectiveAbsolute = typeof override === 'number' && Number.isFinite(override)
        ? override
        : (typeof toAbsolute === 'function' ? toAbsolute(ch, point.output) : point.output);

      const clampedOutput = Math.max(0, Math.min(displayMax > 0 ? displayMax : 100, effectiveAbsolute ?? 0));
      const xCanvas = leftPadding + chartWidth * (point.input / 100);
      const yCanvas = canvas.height - bottomPadding - (chartHeight * (clampedOutput / (displayMax || 100)));

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        clientX: rect.left + xCanvas / scaleX,
        clientY: rect.top + yCanvas / scaleY,
        displayMax
      };
    },
    { channel, ordinal, override: options.absoluteOverride ?? null, levels: CHART_ZOOM_LEVELS }
  );
}

export async function waitForPointMutation(page: Page, before: { input: number | null; output: number | null }) {
  const handle = await page.waitForFunction(
    (initial) => {
      const channel = (window as any).EDIT?.selectedChannel ?? null;
      const ordinal = (window as any).EDIT?.selectedOrdinal ?? 1;
      const cp = (window as any).ControlPoints?.get(channel)?.points || [];
      const point = cp[ordinal - 1] || null;
      if (!point) return false;
      const dx = Math.abs(point.input - (initial.input ?? 0));
      const dy = Math.abs(point.output - (initial.output ?? 0));
      if (dx < 0.05 && dy < 0.05) {
        return false;
      }
      const compat = (window as any).__quadDebug?.compat;
      const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
      const absoluteOutput = point && typeof toAbsolute === 'function'
        ? toAbsolute(channel, point.output)
        : point?.output ?? null;
      return {
        channel,
        ordinal,
        input: point.input,
        output: point.output,
        absoluteOutput
      };
    },
    before,
    { timeout: 5000 }
  );
  return handle.jsonValue();
}

export async function readStatusText(page: Page) {
  return page.evaluate(() => document.getElementById('status')?.textContent ?? '');
}

export async function getChartZoomState(page: Page) {
  return page.evaluate(({ levels }) => {
    const helper = (window as any).__quadDebug?.coreState;
    const appState = helper && typeof helper.getAppState === 'function'
      ? helper.getAppState()
      : null;
    let zoomIndex = Number(appState?.chartZoomIndex ?? levels.length - 1);
    if (!Number.isFinite(zoomIndex)) {
      zoomIndex = levels.length - 1;
    }
    zoomIndex = Math.max(0, Math.min(levels.length - 1, Math.round(zoomIndex)));
    const percent = levels[zoomIndex] ?? 100;
    return { index: zoomIndex, percent };
  }, { levels: CHART_ZOOM_LEVELS });
}

