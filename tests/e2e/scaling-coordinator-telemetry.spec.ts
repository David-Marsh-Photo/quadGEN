import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Scaling coordinator telemetry', () => {
  test('captures queue lifecycle when coordinator scales', async ({ page }) => {
    await page.goto(`file://${path.resolve('index.html')}`);

    await page.waitForFunction(() => !!document.querySelector('#scaleAllInput'));
    await page.evaluate(() => {
      window.enableScalingCoordinator?.(true);
    });

    await page.waitForFunction(() => {
      const telemetry = window.__quadDebug?.scalingTelemetry;
      return telemetry && typeof telemetry.getBuffer === 'function';
    });

    await page.evaluate(() => {
      const telemetry = window.__quadDebug?.scalingTelemetry;
      telemetry?.clear?.();
    });

    await page.evaluate(async () => {
      await window.scalingCoordinator?.scale(82, 'telemetry-e2e', {
        metadata: { trigger: 'e2e' }
      });
    });

    const events = await page.evaluate(() => {
      return window.__quadDebug?.scalingTelemetry?.getBuffer?.() || [];
    });

    expect(events.length).toBeGreaterThan(0);
    const phases = events.map((event: any) => event.phase);
    expect(phases).toContain('enqueue');
    expect(phases).toContain('start');
    expect(phases).toContain('success');

    const successEvent = events.find((event: any) => event.phase === 'success');
    expect(successEvent?.operation?.source).toBe('telemetry-e2e');
    expect(successEvent?.operation?.percent).toBe(82);
    expect(successEvent?.metrics?.processed).toBeGreaterThanOrEqual(1);
  });
});
