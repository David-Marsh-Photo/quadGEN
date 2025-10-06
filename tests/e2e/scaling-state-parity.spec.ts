import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

test.describe('Scaling parity validation', () => {
  test('audit counters stay clean after applying global scale', async ({ page }) => {
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        console.log(`[browser:${message.type()}] ${message.text()}`);
      }
    });

    await navigateToApp(page);
    await waitForAppReady(page);

    const scaleInput = page.locator('#scaleAllInput');
    await scaleInput.waitFor({ state: 'attached' });

    const diagnostics = await scaleInput.evaluate((input) => ({
      id: input.id,
      tagName: input.tagName,
      disabled: input.hasAttribute('disabled'),
      value: (input as HTMLInputElement).value,
      visible: window.getComputedStyle(input).display !== 'none',
    }));
    console.log('scale input diagnostics', diagnostics);

    await page.evaluate(() => {
      const win = window as typeof window & {
        __quadDebug?: {
          compat?: {
            elements?: { scaleAllInput?: HTMLElement | null };
            eventHandlers?: { initializeEventHandlers?: () => void };
            scalingUtils?: { setScalingStateEnabled?: (value: boolean) => void };
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

    const applyScale = async (value: number) => {
      const beforeChecks = await page.evaluate(() => {
        const win = window as typeof window & { scalingStateAudit?: { totalChecks: number } };
        return win.scalingStateAudit?.totalChecks ?? 0;
      });

      await scaleInput.click();
      await scaleInput.fill(String(value));
      await scaleInput.press('Enter');

      await page.waitForFunction((minChecks) => {
        const win = window as typeof window & { scalingStateAudit?: { totalChecks: number } };
        return Boolean(win.scalingStateAudit && win.scalingStateAudit.totalChecks > minChecks);
      }, beforeChecks, { timeout: 10_000 });
    };

    await applyScale(279);
    await applyScale(48);
    await applyScale(28);
    await applyScale(240);

    const audit = await page.evaluate(() => {
      const win = window as typeof window & {
        scalingStateAudit?: {
          totalChecks: number;
          mismatchCount: number;
          lastMismatchDetail?: unknown;
          lastExpectedMaxAllowed?: number | null;
          lastObservedMaxAllowed?: number | null;
        };
      };
      return win.scalingStateAudit ?? null;
    });

    expect(audit).toBeTruthy();
    expect(audit?.totalChecks ?? 0).toBeGreaterThanOrEqual(4);
    expect(audit?.mismatchCount ?? 0).toBe(0);
    expect(audit?.lastMismatchDetail ?? null).toBeNull();
  });
});
