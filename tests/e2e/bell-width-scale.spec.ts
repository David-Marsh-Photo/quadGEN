import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Bell width scale behavior', () => {
  test('updates plotted curve when width controls change', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    // Load a sample .quad file with bell-classified channels
    const quadPath = resolve('data/KCLK.quad');
    await page.setInputFiles('#quadFile', quadPath);

    await page.waitForFunction(() => {
      const data = (window as any).loadedQuadData;
      return !!data?.curves && Object.keys(data.curves).length > 0;
    });

    const bellChannel = await page.evaluate(() => {
      const data = (window as any).loadedQuadData;
      if (!data?.channelShapeMeta) return null;
      const entries = Object.entries(data.channelShapeMeta as Record<string, any>);
      for (const [channel, meta] of entries) {
        if (meta?.classification === 'bell') {
          return channel;
        }
      }
      return null;
    });

    expect(bellChannel).not.toBeNull();

    // Enable Edit Mode so bell controls are exposed
    await page.click('#editModeToggleBtn');

    await page.waitForFunction(() => {
      const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
      return !!select && !select.disabled && select.options.length > 0;
    });

    await page.selectOption('#editChannelSelect', bellChannel!);

    await page.waitForSelector('#editBellWidthContainer:not(.hidden)');

    // Capture the plotted samples before changing width
    const baseline = await page.evaluate((channel) => {
      const data = (window as any).loadedQuadData;
      return data?.curves?.[channel]?.slice() ?? null;
    }, bellChannel);

    expect(baseline).not.toBeNull();

    // Nudge the width to trigger a visual change
    await page.click('#bellWidthLeftInc');
    await page.click('#bellWidthLeftInc');

    await page.waitForTimeout(200);

    const after = await page.evaluate((channel) => {
      const data = (window as any).loadedQuadData;
      return data?.curves?.[channel]?.slice() ?? null;
    }, bellChannel);

    expect(after).not.toBeNull();
    expect(after).not.toEqual(baseline);
  });

  test('keeps Smart curve samples in sync with bell-width edits', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    const quadPath = resolve('data/KCLK.quad');
    await page.setInputFiles('#quadFile', quadPath);

    await page.waitForFunction(() => {
      const data = (window as any).loadedQuadData;
      return !!data?.curves && Object.keys(data.curves).length > 0;
    });

    const bellChannel = await page.evaluate(() => {
      const data = (window as any).loadedQuadData;
      if (!data?.channelShapeMeta) return null;
      const entries = Object.entries(data.channelShapeMeta as Record<string, any>);
      for (const [channel, meta] of entries) {
        if (meta?.classification === 'bell') {
          return channel;
        }
      }
      return null;
    });

    expect(bellChannel).not.toBeNull();

    await page.click('#editModeToggleBtn');
    await page.waitForSelector('#editChannelSelect');
    await page.waitForFunction(() => {
      const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
      return !!select && select.options.length > 0;
    });
    await page.selectOption('#editChannelSelect', bellChannel!);
    await page.waitForSelector('#editBellWidthContainer:not(.hidden)');

    // Seed Smart key points from the current curve
    await page.click('#editRecomputeBtn');
    await page.waitForFunction((channel) => {
      const data = (window as any).loadedQuadData;
      const points = data?.keyPoints?.[channel];
      return Array.isArray(points) && points.length > 4;
    }, bellChannel);

    const computeMismatch = async () => {
      return page.evaluate((channel) => {
        const data = (window as any).loadedQuadData;
        const control = (window as any).ControlPoints?.get(channel);
        if (!data?.curves?.[channel] || !control?.points || control.points.length < 2) {
          return null;
        }
        const normalized = (window as any).ControlPoints.normalize(control.points);
        const percentInput = document.querySelector(`[data-channel=\"${channel}\"] .percent-input`) as HTMLInputElement | null;
        const channelPercent = Number(percentInput?.value) || 100;
        const samples = data.curves[channel];
        for (let i = 0; i < samples.length; i += 1) {
          const x = (i / (samples.length - 1)) * 100;
          const relative = (window as any).ControlPoints.sampleY(normalized, control.interpolation || 'smooth', x);
          const absolute = (Math.max(0, relative) / 100) * channelPercent;
          const sample = Math.round((absolute / 100) * 65535);
          if (Math.abs(sample - samples[i]) > 1) {
            return i;
          }
        }
        return -1;
      }, bellChannel);
    };

    await page.fill('#bellWidthLeftInput', '40');
    await page.fill('#bellWidthRightInput', '40');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(200);
    const mismatchAfter = await computeMismatch();
    expect(mismatchAfter).toBe(-1);
  });
});
