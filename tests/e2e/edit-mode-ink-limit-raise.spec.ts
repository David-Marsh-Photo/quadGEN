import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V4.quad');

async function gotoApp(page) {
  await page.goto(indexUrl);
  await page.waitForSelector('#quadFile', { state: 'attached' });
}

async function loadQuadFile(page) {
  await page.setInputFiles('#quadFile', quadPath);
  await page.waitForFunction(
    () => (window.getLoadedQuadData?.()?.curves?.K || []).length === 256,
    undefined,
    { timeout: 15000 }
  );
}

async function enableEditMode(page) {
  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });
}

async function selectChannel(page, channel) {
  await page.waitForFunction(
    (ch) => !!document.querySelector(`#editChannelSelect option[value="${ch}"]`),
    channel,
    { timeout: 10000 }
  );
  await page.selectOption('#editChannelSelect', channel);
  await page.waitForFunction(
    (ch) => (window.EDIT?.selectedChannel ?? null) === ch,
    channel,
    { timeout: 5000 }
  );
}

async function ensureSmartPoints(page, channel) {
  await page.evaluate((ch) => {
    if (typeof window.reinitializeChannelSmartCurves === 'function') {
      window.reinitializeChannelSmartCurves(ch, { forceIfEditModeEnabling: true });
    }
  }, channel);
  await page.waitForFunction(
    (ch) => {
      const pts = window.ControlPoints?.get(ch)?.points || [];
      return Array.isArray(pts) && pts.length > 4;
    },
    channel,
    { timeout: 10000 }
  );
}

async function getChannelPercent(page, channel) {
  return page.evaluate((ch) => {
    const row = document.querySelector(`tr[data-channel="${ch}"]`);
    const input = row?.querySelector('.percent-input');
    return {
      value: Number(input?.value ?? NaN),
      base: Number(input?.getAttribute('data-base-percent') ?? NaN)
    };
  }, channel);
}

async function getEndpointSnapshot(page) {
  return page.evaluate(() => {
    const channel = 'C';
    const points = window.ControlPoints?.get(channel)?.points || [];
    const ordinal = points.length;
    const compat = window.__quadDebug?.compat;
    const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
    const point = points[ordinal - 1] || null;
    const absolute = point && typeof toAbsolute === 'function'
      ? toAbsolute(channel, point.output)
      : point?.output ?? null;
    return {
      ordinal,
      absolute
    };
  });
}

test.describe('Edit mode ink-limit drag behaviour', () => {
  test('dragging a Smart point past ink limit raises the channel end', async ({ page }) => {
    await gotoApp(page);
    await loadQuadFile(page);
    await enableEditMode(page);

    await selectChannel(page, 'C');
    await ensureSmartPoints(page, 'C');

    const initialPercent = await getChannelPercent(page, 'C');
    expect(initialPercent.value).toBeGreaterThan(0);
    expect(initialPercent.value).toBeLessThan(30);

    const before = await getEndpointSnapshot(page);
    expect(before.absolute).not.toBeNull();

    const adjustResult = await page.evaluate((ordinal) => {
      return window.quadGenActions?.adjustSmartKeyPointByIndex('C', ordinal, { outputPercent: 40 });
    }, before.ordinal);
    expect(adjustResult?.success).toBeTruthy();

    await page.waitForFunction(
      (initial) => {
        const row = document.querySelector('tr[data-channel="C"]');
        const input = row?.querySelector('.percent-input');
        return input && Number(input.value) > initial + 0.5;
      },
      initialPercent.value,
      { timeout: 5000 }
    );

    const after = await getEndpointSnapshot(page);
    expect(after.absolute).toBeGreaterThan(before.absolute ?? 0);

    const finalPercent = await getChannelPercent(page, 'C');
    expect(finalPercent.value).toBeGreaterThan(initialPercent.value + 0.5);
    expect(finalPercent.base).toBeGreaterThan(initialPercent.base + 0.5);
  });
});
