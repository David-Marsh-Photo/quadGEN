import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P700-P900_MK100-3.quad');
const LAB_PATH = resolve('testdata/lab_banded_shadow.txt');

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);

  await page.waitForFunction(
    () => !!(window.ControlPoints && typeof window.ControlPoints.get === 'function'),
    null,
    { timeout: 20000 }
  );
}

async function getChartZoomPercent(page: Page) {
  return page.evaluate(() => {
    const compat = window.__quadDebug?.compat;
    if (compat?.chartManager?.getChartZoomPercent) {
      return compat.chartManager.getChartZoomPercent();
    }
    const state = window.__quadDebug?.compat?.stateManager?.getStateManager?.()?.getState?.();
    if (state && typeof state.app?.chartZoomIndex === 'number') {
      const levels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      return levels[state.app.chartZoomIndex] ?? null;
    }
    return null;
  });
}

test.describe('Chart zoom persistence', () => {
  test('auto clamp does not overwrite stored preference', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    const initialZoom = await getChartZoomPercent(page);
    expect(initialZoom).toBe(100);

    const mk50QuadPath = resolve('data/P700-P900_MK50.quad');
    await page.setInputFiles('#quadFile', mk50QuadPath);
    await page.waitForFunction(
      () => {
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#rows tr[data-channel]'));
        if (!rows.length) return false;
        return rows.some((row) => {
          const percentInput = row.querySelector<HTMLInputElement>('.percent-input');
          if (!percentInput) return false;
          const numeric = parseFloat(percentInput.value);
          return Number.isFinite(numeric) && Math.round(numeric) === 50;
        });
      },
      null,
      { timeout: 20000 }
    );

    await page.waitForFunction(
      () => {
        const btn = document.querySelector<HTMLButtonElement>('#chartZoomInBtn');
        return !!btn && !btn.disabled;
      },
      null,
      { timeout: 10000 }
    );

    await page.click('#chartZoomInBtn'); // 100 -> 90
    await page.waitForFunction(
      () => {
        const compat = window.__quadDebug?.compat;
        return compat?.chartManager?.getChartZoomPercent?.() === 90;
      },
      null,
      { timeout: 10000 }
    );

    await page.click('#chartZoomInBtn'); // 90 -> 80 (allowed because MK50 quad caps at 50%)
    await page.waitForFunction(
      () => {
        const compat = window.__quadDebug?.compat;
        return compat?.chartManager?.getChartZoomPercent?.() === 80;
      },
      null,
      { timeout: 10000 }
    );

    const zoomAfterManual = await getChartZoomPercent(page);
    expect(zoomAfterManual).toBe(80);

    const storedAfterManual = await page.evaluate(() => window.localStorage.getItem('quadgen_chart_zoom_v1'));
    expect(storedAfterManual).toBeNull();

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(
      () => !!document.querySelector('#rows tr[data-channel]'),
      null,
      { timeout: 20000 }
    );

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => {
        const compat = window.__quadDebug?.compat;
        return compat?.chartManager?.getChartZoomPercent?.() === 90;
      },
      null,
      { timeout: 20000 }
    );

    const storedAfterClamp = await page.evaluate(() => window.localStorage.getItem('quadgen_chart_zoom_v1'));
    expect(storedAfterClamp).toBeNull();

    await page.reload();
    await waitForAppReady(page);

    const zoomAfterReload = await getChartZoomPercent(page);
    expect(zoomAfterReload).toBe(100);

    const storedAfterReload = await page.evaluate(() => window.localStorage.getItem('quadgen_chart_zoom_v1'));
    expect(storedAfterReload).toBeNull();
  });
});
