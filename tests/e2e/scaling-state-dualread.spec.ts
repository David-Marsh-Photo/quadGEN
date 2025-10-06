import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

test.describe('Scaling dual-read readiness', () => {
  test('scale input reflects state-managed percent when flag enabled', async ({ page }) => {
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        console.log(`[browser:${message.type()}] ${message.text()}`);
      }
    });

    await navigateToApp(page);
    await waitForAppReady(page);

    await page.evaluate(() => {
      const win = window as typeof window & {
        __quadDebug?: {
          compat?: {
            elements?: { scaleAllInput?: HTMLElement | null };
            eventHandlers?: { initializeEventHandlers?: () => void };
          };
        };
      };

      (win as any).__USE_SCALING_STATE = true;

      const scaleInputEl = document.getElementById('scaleAllInput');
      if (scaleInputEl && win.__quadDebug?.compat?.elements) {
        win.__quadDebug.compat.elements.scaleAllInput = scaleInputEl;
      }

      win.__quadDebug?.compat?.eventHandlers?.initializeEventHandlers?.();
      win.__quadDebug?.compat?.scalingUtils?.setScalingStateEnabled?.(true);
    });

    await page.waitForFunction(() => (window as typeof window & { __scalingStateSubscribed?: boolean }).__scalingStateSubscribed === true);

    const scaleInput = page.locator('#scaleAllInput');
    await scaleInput.waitFor({ state: 'attached' });

    await page.evaluate(() => {
      const win = window as typeof window & {
        getStateManager?: () => { set: (path: string, value: unknown, options?: Record<string, unknown>) => void };
      };

      (win as any).__scalingStateEvents = 0;
      win.addEventListener('quadgen:scaling-state-flag-changed', () => {
        (win as any).__scalingStateEvents = ((win as any).__scalingStateEvents || 0) + 1;
      }, { once: false });

      win.getStateManager?.().set('scaling.globalPercent', 142, { skipHistory: true });
    });

    const { statePercent, currentScale, flag, eventCount, subscribed } = await page.evaluate(() => {
      const win = window as typeof window & {
        getStateManager?: () => { get: (path: string) => unknown };
        getCurrentScale?: () => number;
        __USE_SCALING_STATE?: boolean;
      };

      return {
        statePercent: win.getStateManager?.().get('scaling.globalPercent'),
        currentScale: win.getCurrentScale?.(),
        flag: win.__USE_SCALING_STATE ?? null,
        eventCount: (win as any).__scalingStateEvents ?? 0,
        subscribed: (win as any).__scalingStateSubscribed ?? null,
      };
    });

    await expect(scaleInput).toHaveValue('142');
  });
});
