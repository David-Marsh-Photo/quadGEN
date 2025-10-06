import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';
import { waitForScaleComplete } from '../utils/scaling-test-helpers';

async function enableCoordinatorAndReset(page: Page) {
  await page.waitForSelector('#scaleAllInput');
  await page.evaluate(() => {
    const win = window as typeof window & {
      enableScalingCoordinator?: (enabled: boolean) => void;
      scalingCoordinator?: { flushQueue?: (reason: string) => void };
      __quadDebug?: { scalingTelemetry?: { clear?: () => void } };
    };
    win.enableScalingCoordinator?.(true);
    win.scalingCoordinator?.flushQueue?.('test-reset');
    win.__quadDebug?.scalingTelemetry?.clear?.();
  });
}

async function getScaleInput(page: Page) {
  const locator = page.locator('#scaleAllInput');
  await locator.waitFor({ state: 'visible' });
  return locator;
}

async function clearTelemetry(page: Page) {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __quadDebug?: { scalingTelemetry?: { clear?: () => void } };
    };
    win.__quadDebug?.scalingTelemetry?.clear?.();
  });
}

async function getTelemetryBuffer(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __quadDebug?: { scalingTelemetry?: { getBuffer?: () => any[] } };
    };
    return win.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
  });
}

test.describe('Scaling coordinator UI interactions', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);
    await enableCoordinatorAndReset(page);
  });

  test('Enter commit routes typed scale through coordinator', async ({ page }) => {
    const scaleInput = await getScaleInput(page);

    await scaleInput.click();
    await scaleInput.press('ControlOrMeta+A');
    await scaleInput.type('87', { delay: 20 });
    await clearTelemetry(page);

    await scaleInput.press('Enter');
    await waitForScaleComplete(page, 87);

    await page.waitForFunction(() => {
      const win = window as typeof window & {
        __quadDebug?: { scalingTelemetry?: { getBuffer?: () => any[] } };
      };
      const buffer = win.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
      return buffer.some((event) => {
        const trigger = event?.operation?.metadata?.trigger;
        const percent = event?.operation?.percent;
        return event?.operation?.source === 'ui'
          && trigger === 'commitScaleAllImmediate'
          && typeof percent === 'number'
          && Math.abs(percent - 87) < 0.1;
      });
    }, null, { timeout: 7000 });

    const buffer = await getTelemetryBuffer(page);
    const commitEvent = buffer.find((event) => event?.operation?.metadata?.trigger === 'commitScaleAllImmediate');
    expect(commitEvent?.operation?.source).toBe('ui');

    const inputValue = await scaleInput.inputValue();
    expect(Number(inputValue)).toBeCloseTo(87, 1);

    const currentScale = await page.evaluate(() => {
      const win = window as typeof window & { getCurrentScale?: () => number };
      return win.getCurrentScale?.() ?? null;
    });
    expect(currentScale).toBeCloseTo(87, 1);
  });

  test('Arrow key repeats enqueue sequential coordinator operations', async ({ page }) => {
    const scaleInput = await getScaleInput(page);

    await scaleInput.click();
    await scaleInput.press('ControlOrMeta+A');
    await scaleInput.type('94', { delay: 20 });
    await clearTelemetry(page);
    await scaleInput.press('Enter');
    await waitForScaleComplete(page, 94);

    await clearTelemetry(page);

    await scaleInput.click();
    for (let i = 0; i < 3; i += 1) {
      await scaleInput.press('ArrowDown');
    }

    await waitForScaleComplete(page, 91);

    await page.waitForFunction(() => {
      const win = window as typeof window & {
        __quadDebug?: { scalingTelemetry?: { getBuffer?: () => any[] } };
      };
      const buffer = win.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
      return buffer.some((event) => {
        const trigger = event?.operation?.metadata?.trigger;
        const percent = event?.operation?.percent;
        return event?.operation?.source === 'ui'
          && trigger === 'commitScaleAllDebounce'
          && typeof percent === 'number'
          && Math.abs(percent - 91) < 0.1;
      });
    }, null, { timeout: 7000 });

    const buffer = await getTelemetryBuffer(page);
    const arrowEvents = buffer.filter((event) => event?.operation?.metadata?.trigger === 'commitScaleAllDebounce');
    expect(arrowEvents.length).toBeGreaterThan(0);

    const inputValue = await scaleInput.inputValue();
    expect(Number(inputValue)).toBeCloseTo(91, 1);

    const currentScale = await page.evaluate(() => {
      const win = window as typeof window & { getCurrentScale?: () => number };
      return win.getCurrentScale?.() ?? null;
    });
    expect(currentScale).toBeCloseTo(91, 1);
  });

  test('Per-channel percentage edits resync the current global scale', async ({ page }) => {
    const scaleInput = await getScaleInput(page);

    await scaleInput.click();
    await scaleInput.press('ControlOrMeta+A');
    await scaleInput.type('92', { delay: 20 });
    await clearTelemetry(page);
    await scaleInput.press('Enter');
    await waitForScaleComplete(page, 92);

    await page.waitForFunction(() => {
      const win = window as typeof window & {
        __quadDebug?: { scalingTelemetry?: { getBuffer?: () => any[] } };
      };
      const buffer = win.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
      return buffer.some((event) => event?.operation?.metadata?.trigger === 'commitScaleAllImmediate');
    }, null, { timeout: 7000 });

    await clearTelemetry(page);

    const channelInput = page.locator('tr[data-channel="MK"] .percent-input');
    await channelInput.waitFor({ state: 'visible' });

    await channelInput.click();
    await channelInput.press('ControlOrMeta+A');
    await channelInput.type('72', { delay: 20 });

    const percentValue = parseFloat(await channelInput.inputValue());
    expect(percentValue).toBeCloseTo(72, 1);

    await waitForScaleComplete(page, 92);

    await page.waitForFunction(() => {
      const win = window as typeof window & {
        __quadDebug?: { scalingTelemetry?: { getBuffer?: () => any[] } };
      };
      const buffer = win.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
      return buffer.some((event) => {
        const trigger = event?.operation?.metadata?.trigger;
        return event?.operation?.source === 'ui-resync' && trigger === 'percentInputResync';
      });
    }, null, { timeout: 7000 });

    const resyncEvents = await page.evaluate(() => {
      const win = window as typeof window & {
        __quadDebug?: { scalingTelemetry?: { getBuffer?: () => any[] } };
      };
      const buffer = win.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
      return buffer.filter((event) => event?.operation?.source === 'ui-resync');
    });
    expect(resyncEvents.length).toBeGreaterThan(0);

    const currentScale = await page.evaluate(() => {
      const win = window as typeof window & { getCurrentScale?: () => number };
      return win.getCurrentScale?.() ?? null;
    });
    expect(currentScale).toBeCloseTo(92, 1);
  });
});
