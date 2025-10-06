import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady, clickUndo, clickRedo, setChannelPercentage } from '../utils/history-helpers';

test.describe('Scaling state workflows', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        console.log(`[browser:${message.type()}] ${message.text()}`);
      }
    });
  });

  async function prepare(page) {
    await navigateToApp(page);
    await waitForAppReady(page);

    const diagnostics = await page.evaluate(() => {
      const scaleInput = document.getElementById('scaleAllInput') as HTMLInputElement | null;
      const undoBtn = document.getElementById('undoBtn');
      const redoBtn = document.getElementById('redoBtn');
      return {
        scaleInputPresent: !!scaleInput,
        scaleInputDisabled: scaleInput?.disabled ?? null,
        scaleInputValue: scaleInput?.value ?? null,
        undoPresent: !!undoBtn,
        redoPresent: !!redoBtn,
        compatExports: {
          setScalingStateEnabled: typeof (window as typeof window & { setScalingStateEnabled?: unknown }).setScalingStateEnabled,
          resetScalingStateAudit: typeof (window as typeof window & { resetScalingStateAudit?: unknown }).resetScalingStateAudit,
          validateScalingStateSync: typeof (window as typeof window & { validateScalingStateSync?: unknown }).validateScalingStateSync,
        }
      };
    });

    expect(diagnostics.scaleInputPresent).toBe(true);
    expect(typeof diagnostics.scaleInputValue).toBe('string');
    expect(diagnostics.undoPresent).toBe(true);
    expect(diagnostics.redoPresent).toBe(true);
    expect(diagnostics.compatExports.setScalingStateEnabled).toBe('function');
    expect(diagnostics.compatExports.resetScalingStateAudit).toBe('function');
    expect(diagnostics.compatExports.validateScalingStateSync).toBe('function');
  }

  async function getReasonCount(page, reason: string) {
    return page.evaluate(({ reason }) => {
      const audit = (window as typeof window & { scalingStateAudit?: any }).scalingStateAudit;
      if (!audit || !audit.reasonCounts) {
        return 0;
      }
      const value = audit.reasonCounts[reason];
      return typeof value === 'number' ? value : 0;
    }, { reason });
  }

  test('flag disabled path logs legacy reason counts', async ({ page }) => {
    await prepare(page);

    await page.evaluate(() => {
      const win = window as typeof window & {
        setScalingStateEnabled?: (value: boolean) => void;
        resetScalingStateAudit?: (reason?: string) => void;
      };
      win.resetScalingStateAudit?.('playwright-flag-disabled');
      win.setScalingStateEnabled?.(false);
    });

    await expect.poll(() => getReasonCount(page, 'flag:disable')).toBeGreaterThan(0);
    await setChannelPercentage(page, 'K', 50);

    await page.evaluate((percent) => {
      const api = window as typeof window & {
        __quadDebug?: { scalingUtils?: { scaleChannelEndsByPercent?: (value: number) => unknown } };
      };
      api.__quadDebug?.scalingUtils?.scaleChannelEndsByPercent?.(percent);
    }, 135);

    await expect.poll(() => getReasonCount(page, 'legacy:no-change')).toBeGreaterThan(0);
    await expect.poll(() => getReasonCount(page, 'flag:disable')).toBeGreaterThan(0);

    const scaleInput = page.locator('#scaleAllInput');
    await expect(scaleInput).toHaveValue('100');

    const audit = await page.evaluate(() => (window as typeof window & { scalingStateAudit?: any }).scalingStateAudit);
    expect(audit.reasonCounts['legacy:no-change']).toBeGreaterThan(0);
    expect(audit.reasonCounts['flag:disable']).toBeGreaterThan(0);
  });

  test('mid-session toggle resubscribes and records reasons', async ({ page }) => {
    await prepare(page);

    await page.evaluate(() => {
      const win = window as typeof window & {
        setScalingStateEnabled?: (value: boolean) => void;
        resetScalingStateAudit?: (reason?: string) => void;
      };
      win.resetScalingStateAudit?.('playwright-mid-session');
      win.setScalingStateEnabled?.(false);
    });

    await setChannelPercentage(page, 'K', 45);

    await page.evaluate(() => {
      const win = window as typeof window & {
        setScalingStateEnabled?: (value: boolean) => void;
      };
      win.setScalingStateEnabled?.(true);
    });

    await page.waitForFunction(() => (window as typeof window & { __scalingStateSubscribed?: boolean }).__scalingStateSubscribed === true);

    await page.evaluate(() => {
      const win = window as typeof window & {
        setScalingStateEnabled?: (value: boolean) => void;
      };
      win.setScalingStateEnabled?.(false);
      win.setScalingStateEnabled?.(true);
    });

    await expect.poll(() => getReasonCount(page, 'flag:enable')).toBeGreaterThan(0);
    await expect.poll(() => getReasonCount(page, 'subscription:resync')).toBeGreaterThan(0);

    const audit = await page.evaluate(() => (window as typeof window & { scalingStateAudit?: any }).scalingStateAudit);
    expect(audit.reasonCounts['flag:enable']).toBeGreaterThan(0);
    expect(audit.reasonCounts['subscription:resync']).toBeGreaterThan(0);
  });

  test('rapid scaling sequences record applied counts', async ({ page }) => {
    await prepare(page);

    await page.evaluate(() => {
      const win = window as typeof window & {
        setScalingStateEnabled?: (value: boolean) => void;
        resetScalingStateAudit?: (reason?: string) => void;
      };
      win.setScalingStateEnabled?.(true);
      win.resetScalingStateAudit?.('playwright-rapid');
    });

    await page.waitForFunction(() => (window as typeof window & { __scalingStateSubscribed?: boolean }).__scalingStateSubscribed === true);
    await setChannelPercentage(page, 'K', 55);

    const sequence = ['112', '124', '138', '149', '161'];
    for (const value of sequence) {
      await page.evaluate((percent) => {
        const api = window as typeof window & {
          __quadDebug?: { scalingUtils?: { scaleChannelEndsByPercent?: (value: number) => unknown } };
        };
        api.__quadDebug?.scalingUtils?.scaleChannelEndsByPercent?.(Number(percent));
      }, value);
    }

    await expect.poll(() => getReasonCount(page, 'scaleChannelEndsByPercent:no-change')).toBeGreaterThanOrEqual(sequence.length);

    const scaleInput = page.locator('#scaleAllInput');
    await expect(scaleInput).toHaveValue('100');

    const audit = await page.evaluate(() => (window as typeof window & { scalingStateAudit?: any }).scalingStateAudit);
    expect(audit.reasonCounts['scaleChannelEndsByPercent:no-change']).toBeGreaterThanOrEqual(sequence.length);
  });

  test('undo/redo parity logs history reasons', async ({ page }) => {
    const consoleWarnings: string[] = [];
    const listener = (message: any) => {
      const type = message.type();
      if (type === 'warning' || type === 'error') {
        consoleWarnings.push(`[${type}] ${message.text()}`);
      }
    };
    page.on('console', listener);

    await prepare(page);

    await page.evaluate(() => {
      const win = window as typeof window & {
        setScalingStateEnabled?: (value: boolean) => void;
        resetScalingStateAudit?: (reason?: string) => void;
      };
      win.setScalingStateEnabled?.(true);
      win.resetScalingStateAudit?.('playwright-history');
    });

    await page.waitForFunction(() => (window as typeof window & { __scalingStateSubscribed?: boolean }).__scalingStateSubscribed === true);
    await setChannelPercentage(page, 'K', 60);

    await page.evaluate(() => {
      const api = window as typeof window & {
        __quadDebug?: { scalingUtils?: { scaleChannelEndsByPercent?: (value: number) => unknown } };
      };
      api.__quadDebug?.scalingUtils?.scaleChannelEndsByPercent?.(90);
    });

    await expect.poll(() => getReasonCount(page, 'scaleChannelEndsByPercent:applied')).toBeGreaterThan(0);

    await clickUndo(page);
    await expect.poll(() => getReasonCount(page, 'history:undo')).toBeGreaterThan(0);

    await clickRedo(page);
    await expect.poll(() => getReasonCount(page, 'history:redo')).toBeGreaterThan(0);

    const scaleInput = page.locator('#scaleAllInput');
    const values = await scaleInput.inputValue();
    expect(values).toBe('90');

    const audit = await page.evaluate(() => (window as typeof window & { scalingStateAudit?: any }).scalingStateAudit);
    expect(audit.reasonCounts['history:undo']).toBeGreaterThan(0);
    expect(audit.reasonCounts['history:redo']).toBeGreaterThan(0);

    const sanitizedWarnings = consoleWarnings.filter((entry) => !entry.includes('cdn.tailwindcss.com'));
    expect(sanitizedWarnings).toEqual([]);

    page.off('console', listener);
  });
});
