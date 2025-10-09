import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

async function waitForSmartPoints(page, channel: string) {
  await page.waitForFunction(
    (ch) => {
      const ctrl = (window as any).ControlPoints?.get?.(ch);
      return Array.isArray(ctrl?.points) && ctrl.points.length > 1;
    },
    channel,
    { timeout: 20000 },
  );
}

async function computeMaxSmartDelta(page, channel: string) {
  return page.evaluate((ch) => {
    const ctrl = (window as any).ControlPoints?.get?.(ch);
    if (!ctrl || !Array.isArray(ctrl.points) || ctrl.points.length === 0) {
      return null;
    }

    const row = document.querySelector(`tr[data-channel="${ch}"]`);
    const percentInput = row?.querySelector<HTMLInputElement>('.percent-input');
    const endInput = row?.querySelector<HTMLInputElement>('.end-input');
    if (!percentInput || !endInput) {
      return null;
    }

    const channelPercent = Number(percentInput.value);
    const endValue = Number(endInput.value);
    if (!Number.isFinite(channelPercent) || !Number.isFinite(endValue)) {
      return null;
    }

    const compat = (window as any).__quadDebug?.compat || {};
    const make256 = compat.processingPipeline?.make256;
    const constants = compat.processingPipeline?.PROCESSING_CONSTANTS;
    const toAbsoluteOutput = compat.smartCurves?.toAbsoluteOutput;

    if (typeof make256 !== 'function' || !constants || typeof constants.TOTAL !== 'number') {
      return null;
    }

    const curveValues = make256(endValue, ch, true, { normalizeToEnd: false }) || [];
    const total = constants.TOTAL;

    let maxDelta = 0;
    ctrl.points.forEach((pt: { input: number; output: number }) => {
      const xNorm = Math.max(0, Math.min(1, (pt.input || 0) / 100));
      const index = Math.round(xNorm * (curveValues.length - 1));
      const curvePercent = (curveValues[index] / total) * 100;
      const absolute = typeof toAbsoluteOutput === 'function'
        ? toAbsoluteOutput(ch, pt.output)
        : (pt.output / 100) * channelPercent;
      const delta = Math.abs(curvePercent - absolute);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
    });

    return {
      channelPercent,
      endValue,
      maxDelta,
    };
  }, channel);
}

function formatUrl(path: string) {
  return pathToFileURL(resolve(path)).href;
}

function percentInputSelector(channel: string) {
  return `tr[data-channel="${channel}"] .percent-input`;
}

async function setPercent(page, channel: string, value: string) {
  const locator = page.locator(percentInputSelector(channel));
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(value);
  await locator.press('Enter');
  await page.waitForTimeout(200);
}

test('channel percent nudge preserves Smart curve alignment', async ({ page }) => {
  await page.goto(formatUrl('index.html'));
  await page.waitForSelector('#loadQuadBtn', { timeout: 15000 });

  await page.click('#loadQuadBtn');
  await page.setInputFiles('#quadFile', resolve('data/TRIFORCE_V2.quad'));

  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
  await page.click('#editModeToggleBtn');
  await page.waitForFunction(() => (window as any).isEditModeEnabled?.(), null, { timeout: 15000 });

  await waitForSmartPoints(page, 'C');

  await page.evaluate(() => {
    const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
    if (select) {
      select.value = 'C';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  const baseline = await computeMaxSmartDelta(page, 'C');
  expect(baseline).not.toBeNull();
  expect(baseline?.maxDelta ?? 0).toBeLessThan(1);

  await setPercent(page, 'C', '31');
  const afterIncrease = await computeMaxSmartDelta(page, 'C');
  expect(afterIncrease).not.toBeNull();
  expect(afterIncrease?.maxDelta ?? 0).toBeLessThan(1);

  await setPercent(page, 'C', '30');
  const afterDecrease = await computeMaxSmartDelta(page, 'C');
  expect(afterDecrease).not.toBeNull();
  expect(afterDecrease?.maxDelta ?? 0).toBeLessThan(1);
});
