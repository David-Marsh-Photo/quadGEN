import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/TRIFORCE_V3.quad');
const labPath = resolve('data/TRIFORCE_V3.txt');

async function gotoApp(page) {
  await page.goto(indexUrl);
  await page.waitForSelector('#globalLinearizationBtn', { timeout: 15000 });
}

async function ensureChannelVisible(page, channel) {
  await page.waitForSelector(`tr.channel-row[data-channel="${channel}"]`, { timeout: 15000 });
  const isCompact = await page.evaluate((ch) => {
    const row = document.querySelector(`tr.channel-row[data-channel="${ch}"]`);
    if (!row) return false;
    return row.getAttribute('data-compact') === 'true';
  }, channel);

  if (!isCompact) return;

  const chip = page.locator('#disabledChannelsRow .disabled-channel-chip', { hasText: channel });
  await chip.first().click();
  await page.waitForFunction(
    (ch) => {
      const row = document.querySelector(`tr.channel-row[data-channel="${ch}"]`);
      return row && row.getAttribute('data-compact') !== 'true';
    },
    channel,
    { timeout: 5000 }
  );
}

test.describe('Per-channel LAB over Smart curve', () => {
  test('applying per-channel LAB re-bases an edited Smart curve', async ({ page }) => {
    await gotoApp(page);

    await page.setInputFiles('input#quadFile', quadPath);
    await page.waitForFunction(
      () => {
        const data = window.getLoadedQuadData?.();
        return data?.filename?.includes('TRIFORCE_V3.quad') && Array.isArray(data.curves?.K);
      },
      undefined,
      { timeout: 20000 }
    );

    await ensureChannelVisible(page, 'K');

    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });

    await page.selectOption('#editChannelSelect', 'K');
    await page.waitForFunction(
      () => {
        const channel = (window as any).EDIT?.selectedChannel;
        const control = window.ControlPoints?.get?.('K');
        return channel === 'K' && Array.isArray(control?.points) && control.points.length >= 3;
      },
      undefined,
      { timeout: 10000 }
    );

    // Move to an interior Smart point and adjust it to mark the channel as edited
    await page.locator('#editPointRight').click();
    await page.locator('#editPointRight').click();
    await page.waitForFunction(() => (window as any).EDIT?.selectedOrdinal === 3, undefined, { timeout: 5000 });

    await page.locator('#editNudgeYUp').click();
    await page.waitForFunction(
      () => {
        const data = window.getLoadedQuadData?.();
        return data?.sources?.K === 'smart';
      },
      undefined,
      { timeout: 10000 }
    );

    const beforeCurve = await page.evaluate(() => {
      const data = window.getLoadedQuadData?.();
      return data?.curves?.K ? Array.from(data.curves.K) : null;
    });
    expect(beforeCurve, 'baseline Smart curve should exist').toBeTruthy();

    await page.setInputFiles('tr[data-channel="K"] input.per-channel-file', labPath);

    await page.waitForFunction(
      () => {
        const data = window.LinearizationState?.getPerChannelData?.('K');
        const loaded = window.getLoadedQuadData?.();
        return !!data && !!loaded?.curves?.K;
      },
      undefined,
      { timeout: 20000 }
    );

    // Allow queued chart updates to complete before sampling the curve.
    await page.waitForTimeout(250);

    const comparison = await page.evaluate(() => {
      const data = window.getLoadedQuadData?.();
      const values = data?.curves?.K ? Array.from(data.curves.K) : [];
      const tag = data?.sources?.K ?? null;
      const smart = window.isSmartCurve?.('K') ?? false;
      const toggle = document.querySelector('tr[data-channel="K"] .per-channel-toggle') as HTMLInputElement | null;
      return {
        values,
        tag,
        smart,
        toggleDisabled: toggle?.disabled ?? null,
        toggleChecked: toggle?.checked ?? null,
      };
    });

    expect(comparison.values.length).toBe(beforeCurve?.length ?? 0);

    const maxDelta = comparison.values.reduce((max, value, idx) => {
      const before = beforeCurve?.[idx] ?? value;
      return Math.max(max, Math.abs(value - before));
    }, 0);

    expect(maxDelta).toBeGreaterThan(50);
    expect(comparison.tag).toBe('per-lab');
    expect(comparison.smart).toBe(false);
    expect(comparison.toggleDisabled).toBe(true);
    expect(comparison.toggleChecked).toBe(false);
  });
});
