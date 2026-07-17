import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'path';
import { getHistoryStackCounts, navigateToApp, waitForAppReady } from '../utils/history-helpers';

const QUAD_PATH = resolve('data/P800_21K.quad');
const VALID_ACV_PATH = resolve('testdata/midtone_lift.acv');
const VALID_LAB_PATH = resolve('testdata/Manual-LAB-Data.txt');

function makeDuplicatePointAcv(): Buffer {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt16BE(4, 0); // version
  buffer.writeUInt16BE(1, 2); // one composite curve
  buffer.writeUInt16BE(4, 4); // four points

  const points = [
    [0, 0],
    [64, 64],
    [64, 64],
    [255, 255],
  ];
  points.forEach(([output, input], index) => {
    const offset = 6 + (index * 4);
    buffer.writeUInt16BE(output, offset);
    buffer.writeUInt16BE(input, offset + 2);
  });
  return buffer;
}

async function waitForFileInputReset(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((inputSelector) => {
    const input = document.querySelector(inputSelector) as HTMLInputElement | null;
    return !!input && (input.files?.length ?? 0) === 0;
  }, selector);
}

async function startStatusCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as any;
    win.__atomicImportStatusMessages = [];
    const subscribe = win.__quadDebug?.statusService?.subscribeStatus;
    if (typeof subscribe !== 'function') {
      throw new Error('Status service is unavailable');
    }
    subscribe((payload: { message?: string }) => {
      win.__atomicImportStatusMessages.push(String(payload?.message || ''));
    });
  });
}

async function getStatusMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__atomicImportStatusMessages || []);
}

async function loadQuad(page: Page): Promise<void> {
  await page.locator('#quadFile').setInputFiles(QUAD_PATH);
  await page.waitForFunction(() => {
    const loaded = (window as any).getLoadedQuadData?.();
    return loaded?.filename === 'P800_21K.quad' && Array.isArray(loaded?.curves?.K);
  });
}

async function captureGlobalState(page: Page) {
  const history = await getHistoryStackCounts(page);
  return page.evaluate((historyCounts) => {
    const win = window as any;
    const data = win.LinearizationState?.getGlobalData?.();
    const legacy = win.linearizationData;
    const loaded = win.getLoadedQuadData?.();
    const cloneCurveMap = (curveMap: Record<string, number[]> | null | undefined) => Object.fromEntries(
      Object.entries(curveMap || {}).map(([channel, curve]) => [channel, Array.from(curve || [])]),
    );
    const toggle = document.querySelector('#globalLinearizationToggle') as HTMLInputElement | null;

    return {
      modular: {
        filename: data?.filename ?? null,
        format: data?.format ?? null,
        samples: Array.from(data?.samples || []),
        applied: win.LinearizationState?.globalApplied ?? null,
      },
      legacy: {
        filename: legacy?.filename ?? null,
        format: legacy?.format ?? null,
        samples: Array.from(legacy?.samples || []),
        applied: win.linearizationApplied ?? null,
      },
      correctionCurves: {
        baseline: cloneCurveMap(win.LinearizationState?.getGlobalBaselineCurves?.()),
        corrected: cloneCurveMap(win.LinearizationState?.getGlobalCorrectedCurves?.()),
      },
      loaded: {
        curveK: Array.from(loaded?.curves?.K || []),
        baselineEndK: loaded?.baselineEnd?.K ?? null,
        sourceK: loaded?.sources?.K ?? null,
      },
      ui: {
        filename: document.querySelector('#globalLinearizationFilename')?.textContent ?? '',
        details: document.querySelector('#globalLinearizationDetails')?.textContent ?? '',
        toggleDisabled: toggle?.disabled ?? null,
        toggleChecked: toggle?.checked ?? null,
        toggleAriaChecked: toggle?.getAttribute('aria-checked') ?? null,
        infoHidden: document.querySelector('#globalLinearizationInfo')?.classList.contains('hidden') ?? null,
        hintHidden: document.querySelector('#globalLinearizationHint')?.classList.contains('hidden') ?? null,
      },
      history: historyCounts,
    };
  }, history);
}

async function capturePerChannelState(page: Page, channelName: string) {
  const history = await getHistoryStackCounts(page);
  return page.evaluate(({ channel, historyCounts }) => {
    const win = window as any;
    const data = win.LinearizationState?.getPerChannelData?.(channel);
    const appState = win.__quadDebug?.coreState?.getAppState?.();
    const loaded = win.getLoadedQuadData?.();
    const row = document.querySelector(`tr[data-channel="${channel}"]`);
    const toggle = row?.querySelector('.per-channel-toggle') as HTMLInputElement | null;
    const button = row?.querySelector('.per-channel-btn') as HTMLButtonElement | null;

    return {
      modular: {
        filename: data?.filename ?? null,
        format: data?.format ?? null,
        samples: Array.from(data?.samples || []),
        enabled: win.LinearizationState?.isPerChannelEnabled?.(channel) ?? null,
      },
      appState: {
        filename: appState?.perChannelLinearization?.[channel]?.filename ?? null,
        samples: Array.from(appState?.perChannelLinearization?.[channel]?.samples || []),
      },
      loaded: {
        curve: Array.from(loaded?.curves?.[channel] || []),
        baselineEnd: loaded?.baselineEnd?.[channel] ?? null,
        source: loaded?.sources?.[channel] ?? null,
      },
      ui: {
        tooltip: button?.getAttribute('data-tooltip') ?? null,
        toggleDisabled: toggle?.disabled ?? null,
        toggleChecked: toggle?.checked ?? null,
      },
      history: historyCounts,
    };
  }, { channel: channelName, historyCounts: history });
}

test.describe('Correction import atomicity', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);
    await loadQuad(page);
  });

  test('rejects a non-finite ACV without changing the active global correction', async ({ page }) => {
    const input = page.locator('#linearizationFile');
    await input.setInputFiles(VALID_ACV_PATH);
    await page.waitForFunction(() => (
      (window as any).LinearizationState?.getGlobalData?.()?.filename === 'midtone_lift.acv'
    ));
    await waitForFileInputReset(page, '#linearizationFile');

    const before = await captureGlobalState(page);
    await startStatusCapture(page);

    await input.setInputFiles({
      name: 'duplicate-points.acv',
      mimeType: 'application/octet-stream',
      buffer: makeDuplicatePointAcv(),
    });
    await waitForFileInputReset(page, '#linearizationFile');

    expect(await captureGlobalState(page)).toEqual(before);
    expect(await getStatusMessages(page)).toContainEqual(
      expect.stringMatching(/error loading global correction/i),
    );
  });

  test('rejects an empty file without changing the active per-channel correction', async ({ page }) => {
    const input = page.locator('tr[data-channel="K"] input.per-channel-file');
    await input.setInputFiles(VALID_LAB_PATH);
    await page.waitForFunction(() => (
      (window as any).LinearizationState?.getPerChannelData?.('K')?.filename === 'Manual-LAB-Data.txt'
    ));
    await waitForFileInputReset(page, 'tr[data-channel="K"] input.per-channel-file');

    const before = await capturePerChannelState(page, 'K');
    await startStatusCapture(page);

    await input.setInputFiles({
      name: 'empty.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(0),
    });
    await waitForFileInputReset(page, 'tr[data-channel="K"] input.per-channel-file');

    expect(await capturePerChannelState(page, 'K')).toEqual(before);
    expect(await getStatusMessages(page)).toContainEqual(
      expect.stringMatching(/error loading K linearization/i),
    );
  });
});
