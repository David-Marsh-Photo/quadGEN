import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Auto-raise ink limits on import (flagged)', () => {
  test('global correction raises channel end when samples exceed limit', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;

    await page.goto(indexUrl);

    await page.waitForSelector('#optionsBtn', { timeout: 15000 });
    await page.click('#optionsBtn');

    const autoRaiseToggle = page.locator('#autoRaiseInkToggle');
    await autoRaiseToggle.waitFor({ state: 'visible', timeout: 15000 });
    if (!(await autoRaiseToggle.isChecked())) {
      await autoRaiseToggle.click();
    }
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 10000 });

    await page.waitForFunction(
      () => typeof window.quadGenActions !== 'undefined',
      null,
      { timeout: 15000 },
    );

    await page.evaluate(() => {
      window.quadGenActions?.setChannelValue('K', 50);
    });

    const beforePercent = await page.evaluate(() => {
      const input = document.querySelector('tr[data-channel="K"] .percent-input') as HTMLInputElement | null;
      return input?.getAttribute('data-base-percent') ?? input?.value ?? null;
    });

    expect(beforePercent).toBeTruthy();
    expect(Number(beforePercent)).toBeCloseTo(50, 1);

    await page.evaluate(() => {
      const samples = Array.from({ length: 256 }, (_, index) => {
        const t = index / 255;
        return Math.min(0.8, t * 0.8);
      });
      samples[samples.length - 1] = 0.8;
      const normalized = {
        samples,
        previewSamples: samples.slice(),
        domainMin: 0,
        domainMax: 1,
        format: 'LAB',
        filename: 'auto-raise-test.txt',
        edited: false,
      };
      window.quadGenActions?._applyGlobalLinearization(normalized, 'auto-raise-test.txt', '256 points', 'Auto-raise test');
    });

    await page.waitForFunction(
      () => {
        const input = document.querySelector('tr[data-channel="K"] .percent-input') as HTMLInputElement | null;
        if (!input) return false;
        const base = input.getAttribute('data-base-percent') ?? input.value ?? '0';
        return parseFloat(base) >= 79.5;
      },
      null,
      { timeout: 15000 },
    );

    const { percentAfter, audit, summaryAutoRaise } = await page.evaluate(() => {
      const input = document.querySelector('tr[data-channel="K"] .percent-input') as HTMLInputElement | null;
      const percentValue = input?.getAttribute('data-base-percent') ?? input?.value ?? null;
      const auditState = window.__quadDebug?.autoRaiseInkLimits?.getAutoRaiseAuditState?.() || null;
      const summaryState = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      const autoRaisedEnds = summaryState?.summary?.autoRaisedEnds || [];
      return {
        percentAfter: percentValue,
        audit: auditState,
        summaryAutoRaise: autoRaisedEnds,
      };
    });

    expect(Number(percentAfter)).toBeGreaterThanOrEqual(79.5);
    expect(audit?.adjustments?.length ?? 0).toBeGreaterThan(0);
    expect(summaryAutoRaise.some((entry: any) => entry?.channel === 'K' && entry?.locked === false)).toBe(true);
  });

  test('global correction does not revive disabled channels with zero baseline', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const quadPath = resolve('data/P800_K36C26LK25_V6.quad');
    const labPath = resolve('data/P800_K36C26LK25_V6.txt');
    const EXPECTED_ACTIVE_CHANNELS = ['K', 'C', 'LK'];

    await page.goto(indexUrl);

    await page.click('#optionsBtn');
    const autoRaiseToggle = page.locator('#autoRaiseInkToggle');
    await autoRaiseToggle.waitFor({ state: 'visible', timeout: 15000 });
    if (!(await autoRaiseToggle.isChecked())) {
      await autoRaiseToggle.click();
    }
    await page.click('#closeOptionsBtn');

    await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

    await page.setInputFiles('#quadFile', quadPath);
    await page.waitForSelector('tr[data-channel="K"]', { timeout: 20000 });

    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      null,
      { timeout: 20000 }
    );

    const channelSnapshot = await page.evaluate(() => {
      const drawMeta = (globalThis.__chartDrawMeta || []).map((entry) => entry.channelName);
      const rows = Array.from(document.querySelectorAll('tr[data-channel]'));
      const uiValues: Record<string, { percent: number; end: number }> = {};
      rows.forEach((row) => {
        const channel = row.getAttribute('data-channel') || '';
        const percentInput = row.querySelector('.percent-input') as HTMLInputElement | null;
        const endInput = row.querySelector('.end-input') as HTMLInputElement | null;
        if (!channel || !percentInput || !endInput) {
          return;
        }
        const percent = parseFloat(percentInput.getAttribute('data-base-percent') ?? percentInput.value ?? '0') || 0;
        const end = parseInt(endInput.getAttribute('data-base-end') ?? endInput.value ?? '0', 10) || 0;
        uiValues[channel] = { percent, end };
      });
      return { drawMeta, uiValues };
    });

    const autoRaiseAudit = await page.evaluate(() => {
      const audit = window.__quadDebug?.autoRaiseInkLimits?.getAutoRaiseAuditState?.();
      if (!audit) return null;
      return {
        adjustments: Array.isArray(audit.adjustments) ? audit.adjustments.map((entry: any) => entry.channelName).sort() : [],
        blocked: Array.isArray(audit.blocked)
          ? audit.blocked.map((entry: any) => ({ channel: entry.channelName, reason: entry.reason || null }))
          : []
      };
    });

    const activeChannels = Object.entries(channelSnapshot.uiValues)
      .filter(([, value]) => value.percent > 0 || value.end > 0)
      .map(([channel]) => channel)
      .sort();

    expect(activeChannels).toEqual([...EXPECTED_ACTIVE_CHANNELS].sort());
    expect(channelSnapshot.drawMeta.sort()).toEqual([...EXPECTED_ACTIVE_CHANNELS].sort());
    expect(autoRaiseAudit).not.toBeNull();
    if (autoRaiseAudit) {
      expect(autoRaiseAudit.adjustments).toEqual([...EXPECTED_ACTIVE_CHANNELS].sort());
      EXPECTED_ACTIVE_CHANNELS.forEach((channel) => {
        expect(autoRaiseAudit.blocked.some((entry) => entry.channel === channel)).toBe(false);
      });
      const blockedChannels = autoRaiseAudit.blocked.filter((entry) => entry.reason === 'disabled-channel').map((entry) => entry.channel).sort();
      expect(blockedChannels).toEqual(['LC', 'LLK', 'LM', 'M', 'Y']);
    }
  });
});
