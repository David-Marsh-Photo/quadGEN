import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { openGlobalCorrectionTab } from '../utils/history-helpers';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');
const priorCorrectionPath = resolve('testdata/s_curve_256.cube');

async function waitForQuadLoaded(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await page.waitForFunction(
    () => (window.getLoadedQuadData?.()?.curves?.K || []).length === 256,
    null,
    { timeout: 20000 }
  );
}

async function openManualLstarModal(page) {
  await page.click('#manualLstarBtn');
  await page.waitForSelector('#lstarModal', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.lstar-input'));
    return rows.length >= 5;
  }, null, { timeout: 5000 });
}

async function populateManualMeasurements(page, values) {
  const inputs = page.locator('.lstar-input');
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? values[values.length - 1];
    await inputs.nth(index).fill(String(value));
  }
}

async function applyManualMeasurements(page, values) {
  await openManualLstarModal(page);
  await populateManualMeasurements(page, values);
  await page.waitForFunction(() => {
    const button = document.getElementById('generateFromLstar');
    return !!button && button.disabled === false;
  }, null, { timeout: 5000 });
  await page.click('#generateFromLstar');
  await page.waitForFunction(() => {
    const entry = (window as any).LinearizationState?.getGlobalData?.();
    return entry?.format === 'Manual L* Entry';
  }, null, { timeout: 15000 });
  return captureHistorySurface(page);
}

async function settleRenderedOutputs(page) {
  await page.waitForFunction(() => {
    const scope = window as any;
    const preview = document.getElementById('previewFull');
    return typeof scope.buildFile === 'function'
      && !!preview?.dataset.raw
      && preview.dataset.raw === scope.buildFile();
  }, null, { timeout: 10000 });

  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
  }));
}

async function captureHistorySurface(page) {
  await settleRenderedOutputs(page);

  return page.evaluate(() => {
    const scope = window as any;
    const history = scope.getHistoryManager?.();
    const central = scope.getStateManager?.()?.getState?.() || {};
    const linearization = scope.LinearizationState;
    const entry = linearization?.getGlobalData?.() || null;
    const centralEntry = scope.getStateManager?.()?.get?.('linearization.global.data') || null;
    const serializeCorrection = (value: unknown) => value
      ? JSON.parse(JSON.stringify(value))
      : null;
    const probeSmoothing = (value: any) => {
      const type = typeof value?.getSmoothingControlPoints;
      if (type !== 'function') {
        return { type, result: null };
      }
      return {
        type,
        result: serializeCorrection(value.getSmoothingControlPoints(50))
      };
    };
    const row = document.querySelector('tr[data-channel="K"]');
    const curve = scope.getCurveSamplesForChannel?.('K', row)?.values || [];
    const canvas = document.getElementById('inkChart') as HTMLCanvasElement | null;
    const canvasData = canvas?.toDataURL?.() || '';
    let canvasHash = 2166136261;
    for (let index = 0; index < canvasData.length; index += 1) {
      canvasHash ^= canvasData.charCodeAt(index);
      canvasHash = Math.imul(canvasHash, 16777619);
    }

    const filename = document.getElementById('globalLinearizationFilename');
    const details = document.getElementById('globalLinearizationDetails');
    const toggle = document.getElementById('globalLinearizationToggle') as HTMLInputElement | null;
    const info = document.getElementById('globalLinearizationInfo');
    const hint = document.getElementById('globalLinearizationHint');
    const preview = document.getElementById('previewFull');
    const generatedFilename = document.getElementById('filenameInput') as HTMLInputElement | null;
    const lastHistory = history?.history?.[history.history.length - 1] || null;

    return {
      linearization: {
        format: entry?.format ?? null,
        filename: entry?.filename ?? null,
        applied: !!linearization?.globalApplied,
        source: linearization?.getGlobalDataSource?.() ?? null,
        bakedMeta: serializeCorrection(linearization?.getGlobalBakedMeta?.())
      },
      central: {
        format: central.linearization?.global?.data?.format ?? null,
        filename: central.linearization?.global?.filename ?? '',
        applied: !!central.linearization?.global?.applied,
        enabled: !!central.linearization?.global?.enabled,
        source: central.linearization?.global?.source ?? null,
        bakedMeta: serializeCorrection(central.linearization?.global?.baked),
        uiFilename: central.ui?.filenames?.globalLinearization ?? ''
      },
      compatibility: {
        format: scope.linearizationData?.format ?? null,
        applied: !!scope.linearizationApplied
      },
      correctionPayloads: {
        active: serializeCorrection(entry),
        central: serializeCorrection(central.linearization?.global?.data),
        compatibility: serializeCorrection(scope.linearizationData)
      },
      smoothing: {
        active: probeSmoothing(entry),
        central: probeSmoothing(centralEntry),
        compatibility: probeSmoothing(scope.linearizationData)
      },
      ui: {
        filename: filename?.textContent?.trim() ?? '',
        details: details?.textContent ?? '',
        toggleChecked: !!toggle?.checked,
        toggleDisabled: !!toggle?.disabled,
        toggleAriaChecked: toggle?.getAttribute('aria-checked') ?? '',
        toggleAriaDisabled: toggle?.getAttribute('aria-disabled') ?? '',
        toggleDataBaked: toggle?.dataset?.baked ?? '',
        toggleTitle: toggle?.title ?? '',
        infoHidden: info?.classList.contains('hidden') ?? true,
        hintHidden: hint?.classList.contains('hidden') ?? false,
        generatedFilename: generatedFilename?.value ?? ''
      },
      history: {
        count: Array.isArray(history?.history) ? history.history.length : 0,
        redo: Array.isArray(history?.redoStack) ? history.redoStack.length : 0,
        lastKind: lastHistory?.kind ?? null,
        lastDescription: lastHistory?.action?.description ?? lastHistory?.action ?? null,
        undoDisabled: !!(document.getElementById('undoBtn') as HTMLButtonElement | null)?.disabled,
        redoDisabled: !!(document.getElementById('redoBtn') as HTMLButtonElement | null)?.disabled
      },
      curve,
      canvasDigest: `${canvasData.length}:${canvasHash >>> 0}`,
      preview: preview?.dataset.raw ?? '',
      exported: scope.buildFile?.() ?? ''
    };
  });
}

test.describe('Manual L* entry', () => {
  test('replacement, Apply, Undo, and Redo converge state, controls, chart, preview, and export', async ({ browser, page }) => {
    const measuredValues = [98, 94, 80, 45, 10];
    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();
    await cleanPage.goto(indexUrl);
    await cleanPage.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 10000 });
    await waitForQuadLoaded(cleanPage);
    await openGlobalCorrectionTab(cleanPage);
    const cleanApplied = await applyManualMeasurements(cleanPage, measuredValues);
    await cleanContext.close();

    await page.goto(indexUrl);
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 10000 });

    await waitForQuadLoaded(page);
    await openGlobalCorrectionTab(page);
    await page.setInputFiles('#linearizationFile', priorCorrectionPath);
    await page.waitForFunction(() => {
      const entry = (window as any).LinearizationState?.getGlobalData?.();
      return entry?.filename === 's_curve_256.cube' && entry?.format === '1D LUT';
    }, null, { timeout: 15000 });
    await page.evaluate(() => {
      const scope = window as any;
      scope.__quadSetGlobalBakedState?.({ filename: 's_curve_256.cube' }, { skipHistory: true });
      scope.linearizationApplied = false;
    });
    await page.waitForFunction(() => {
      const scope = window as any;
      const toggle = document.getElementById('globalLinearizationToggle') as HTMLInputElement | null;
      return scope.LinearizationState?.isGlobalBaked?.()
        && toggle?.dataset?.baked === 'true'
        && toggle.disabled
        && toggle.checked;
    }, null, { timeout: 10000 });
    await settleRenderedOutputs(page);
    await page.evaluate(() => (window as any).getHistoryManager?.()?.clear?.());

    const before = await captureHistorySurface(page);
    expect(before.linearization).toMatchObject({
      format: '1D LUT',
      filename: 's_curve_256.cube',
      applied: false,
      source: 'baked',
      bakedMeta: { filename: 's_curve_256.cube' }
    });
    expect(before.ui).toMatchObject({
      filename: '*BAKED* s_curve_256.cube',
      toggleChecked: true,
      toggleDisabled: true,
      toggleAriaChecked: 'true',
      toggleAriaDisabled: 'true',
      toggleDataBaked: 'true'
    });
    expect(before.central.bakedMeta).toEqual(before.linearization.bakedMeta);
    expect(before.history).toMatchObject({ count: 0, redo: 0, undoDisabled: true, redoDisabled: true });

    const applied = await applyManualMeasurements(page, measuredValues);

    expect(applied.linearization).toMatchObject({
      format: 'Manual L* Entry',
      applied: true,
      source: 'manual'
    });
    expect(applied.central).toMatchObject({
      format: 'Manual L* Entry',
      filename: 'Manual L* Entry',
      applied: true,
      enabled: true,
      source: 'manual',
      uiFilename: 'Manual L* Entry'
    });
    expect(applied.compatibility).toEqual({ format: 'Manual L* Entry', applied: true });
    expect(applied.linearization.bakedMeta).toBeNull();
    expect(applied.central.bakedMeta).toBeNull();
    expect(applied.correctionPayloads.central).toEqual(applied.correctionPayloads.active);
    expect(applied.correctionPayloads.compatibility).toEqual(applied.correctionPayloads.active);
    expect(applied.smoothing.active.type).toBe('function');
    expect(applied.smoothing.active.result).not.toBeNull();
    expect(applied.smoothing.central).toEqual(applied.smoothing.active);
    expect(applied.smoothing.compatibility).toEqual(applied.smoothing.active);
    expect(applied.ui).toMatchObject({
      filename: 'Manual L* Entry',
      toggleChecked: true,
      toggleDisabled: false,
      toggleAriaChecked: 'true',
      toggleAriaDisabled: '',
      toggleDataBaked: '',
      toggleTitle: '',
      infoHidden: false,
      hintHidden: true
    });
    expect(applied.history).toMatchObject({
      count: 1,
      redo: 0,
      lastKind: 'transaction',
      lastDescription: 'Apply manual L* correction',
      undoDisabled: false,
      redoDisabled: true
    });
    expect(applied.curve).toEqual(cleanApplied.curve);
    expect(applied.exported).toBe(cleanApplied.exported);
    expect(applied.curve).not.toEqual(before.curve);
    expect(applied.canvasDigest).not.toBe(before.canvasDigest);
    expect(applied.exported).not.toBe(before.exported);
    expect(applied.preview).toBe(applied.exported);

    await page.click('#undoBtn');
    await page.waitForFunction(() => {
      const scope = window as any;
      const entry = scope.LinearizationState?.getGlobalData?.();
      const toggle = document.getElementById('globalLinearizationToggle') as HTMLInputElement | null;
      return entry?.filename === 's_curve_256.cube'
        && entry?.format === '1D LUT'
        && scope.LinearizationState?.isGlobalBaked?.()
        && toggle?.dataset?.baked === 'true';
    }, null, { timeout: 15000 });
    const undone = await captureHistorySurface(page);

    expect(undone.linearization).toEqual(before.linearization);
    expect(undone.central).toMatchObject({
      format: '1D LUT',
      filename: before.ui.filename,
      applied: false,
      enabled: false,
      source: before.linearization.source,
      uiFilename: before.ui.filename
    });
    expect(undone.compatibility).toEqual({ format: '1D LUT', applied: false });
    expect(undone.central.bakedMeta).toEqual(before.linearization.bakedMeta);
    expect(undone.correctionPayloads.active).toEqual(before.correctionPayloads.active);
    expect(undone.correctionPayloads.central).toEqual(before.correctionPayloads.active);
    expect(undone.correctionPayloads.compatibility).toEqual(before.correctionPayloads.active);
    expect(undone.ui).toEqual(before.ui);
    expect(undone.history).toMatchObject({ count: 0, redo: 1, undoDisabled: true, redoDisabled: false });
    expect(undone.curve).toEqual(before.curve);
    expect(undone.canvasDigest).toBe(before.canvasDigest);
    expect(undone.preview).toBe(before.preview);
    expect(undone.exported).toBe(before.exported);

    await page.click('#redoBtn');
    await page.waitForFunction(() => {
      const entry = (window as any).LinearizationState?.getGlobalData?.();
      return entry?.format === 'Manual L* Entry';
    }, null, { timeout: 15000 });
    const redone = await captureHistorySurface(page);

    expect(redone.linearization).toEqual(applied.linearization);
    expect(redone.central).toEqual(applied.central);
    expect(redone.compatibility).toEqual(applied.compatibility);
    expect(redone.correctionPayloads).toEqual(applied.correctionPayloads);
    expect(redone.smoothing).toEqual(applied.smoothing);
    expect(redone.ui).toEqual(applied.ui);
    expect(redone.history).toMatchObject({ count: 1, redo: 0, undoDisabled: false, redoDisabled: true });
    expect(redone.curve).toEqual(applied.curve);
    expect(redone.canvasDigest).toBe(applied.canvasDigest);
    expect(redone.preview).toBe(applied.preview);
    expect(redone.exported).toBe(applied.exported);
  });
});
