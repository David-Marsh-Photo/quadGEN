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

test.describe('Chart zoom guard', () => {
  test('zoom in stays available after MK100 quad + correction', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    const initialButtons = await page.evaluate(() => {
      const zoomIn = document.querySelector<HTMLButtonElement>('#chartZoomInBtn');
      const zoomOut = document.querySelector<HTMLButtonElement>('#chartZoomOutBtn');
      return {
        hasZoomIn: !!zoomIn,
        hasZoomOut: !!zoomOut,
        zoomInDisabled: zoomIn?.disabled ?? null,
        zoomOutDisabled: zoomOut?.disabled ?? null
      };
    });
    expect(initialButtons.hasZoomIn).toBe(true);
    expect(initialButtons.hasZoomOut).toBe(true);

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#rows tr[data-channel]'));
      if (!rows.length) return false;
      return rows.some((row) => {
        const endInput = row.querySelector<HTMLInputElement>('.end-input');
        if (!endInput) return false;
        const numeric = parseInt(endInput.value, 10);
        return Number.isFinite(numeric);
      });
    }, null, { timeout: 20000 });

    const stateAfterQuad = await page.evaluate(() => {
      const zoomIn = document.querySelector<HTMLButtonElement>('#chartZoomInBtn');
      const zoomOut = document.querySelector<HTMLButtonElement>('#chartZoomOutBtn');
      const highestPercent = (() => {
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#rows tr[data-channel]'));
        let max = 0;
        for (const row of rows) {
          const endInput = row.querySelector<HTMLInputElement>('.end-input');
          if (!endInput) continue;
          const numeric = parseInt(endInput.value, 10);
          if (!Number.isFinite(numeric)) continue;
          max = Math.max(max, (numeric / 65535) * 100);
        }
        return Math.round(max * 10) / 10;
      })();

      return {
        zoomInDisabled: zoomIn?.disabled ?? null,
        zoomOutDisabled: zoomOut?.disabled ?? null,
        highestPercent
      };
    });
    console.log(`[diagnostic] after quad ${JSON.stringify(stateAfterQuad)}`);

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(() => !!(window.LinearizationState && window.LinearizationState.globalApplied), null, {
      timeout: 20000
    });

    const stateAfterCorrection = await page.evaluate(() => {
      const zoomIn = document.querySelector<HTMLButtonElement>('#chartZoomInBtn');
      const zoomOut = document.querySelector<HTMLButtonElement>('#chartZoomOutBtn');
      const displayPercent = (() => {
        const compat = window.__quadDebug?.compat;
        if (compat?.chartManager?.getChartZoomPercent) {
          return compat.chartManager.getChartZoomPercent();
        }
        const manager = compat?.stateManager?.getStateManager?.();
        const state = manager?.getState ? manager.getState() : null;
        if (state && typeof state.app?.chartZoomIndex === 'number') {
          const levels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
          return levels[state.app.chartZoomIndex] ?? null;
        }
        return null;
      })();
      return {
        zoomInDisabled: zoomIn?.disabled ?? null,
        zoomOutDisabled: zoomOut?.disabled ?? null,
        displayPercent
      };
    });
    console.log(`[diagnostic] after correction ${JSON.stringify(stateAfterCorrection)}`);

    expect(stateAfterCorrection.zoomInDisabled).toBe(false);

    await page.click('#chartZoomInBtn');
    await page.waitForFunction(() => {
      const compat = window.__quadDebug?.compat;
      if (!compat?.chartManager?.getChartZoomPercent) return false;
      return compat.chartManager.getChartZoomPercent() === 90;
    }, null, { timeout: 10000 });

    const stateAfterZoom = await page.evaluate(() => {
      const compat = window.__quadDebug?.compat;
      const zoomPercent = compat?.chartManager?.getChartZoomPercent
        ? compat.chartManager.getChartZoomPercent()
        : null;
      const zoomIn = document.querySelector<HTMLButtonElement>('#chartZoomInBtn');
      return {
        zoomPercent,
        zoomInDisabled: zoomIn?.disabled ?? null
      };
    });
    console.log(`[diagnostic] after zoom ${JSON.stringify(stateAfterZoom)}`);

    expect(stateAfterZoom.zoomPercent).toBe(90);
  });
});
