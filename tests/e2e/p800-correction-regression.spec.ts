import { expect, test } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

type ChartSample = { input: number; percent: number };

async function captureChartSamples(page: import('@playwright/test').Page): Promise<ChartSample[] | null> {
  return page.evaluate(() => {
    const helpers = window.__quadDebug?.chartDebug;
    const row = document.querySelector('tr.channel-row[data-channel="K"]');
    const payload = helpers?.getCurveSamplesForChannel?.('K', row);
    if (!payload?.values?.length || !payload.endValue) {
      return null;
    }
    const endValue = Number(payload.endValue) || 1;
    const { values } = payload;
    return values.map((value: number, index: number) => ({
      input: (index / (values.length - 1)) * 100,
      percent: endValue > 0 ? (Number(value) / endValue) * 100 : 0
    }));
  });
}

async function captureOverlaySamples(page: import('@playwright/test').Page): Promise<ChartSample[] | null> {
  return page.evaluate(() => {
    const helpers = window.__quadDebug?.chartDebug;
    const overlay = helpers?.getLastCorrectionOverlay?.();
    if (!overlay?.samples?.length) {
      return null;
    }
    const effectiveMax = Number(overlay.effectiveMaxPercent) || 100;
    return overlay.samples.map((sample: any) => {
      const input = Number(sample?.input ?? sample?.x ?? 0);
      const rawOutput = Number(sample?.output ?? sample?.y ?? 0);
      const percent = effectiveMax > 0 ? (rawOutput / effectiveMax) * 100 : rawOutput;
      return { input, percent };
    });
  });
}

function pickSample(samples: ChartSample[] | null, targetInput: number): ChartSample | null {
  if (!Array.isArray(samples) || samples.length === 0) {
    return null;
  }
  return samples.reduce((closest, sample) => {
    return Math.abs(sample.input - targetInput) < Math.abs(closest.input - targetInput) ? sample : closest;
  }, samples[0]);
}

test.describe('P800_21K global correction regression', () => {

  test('full correction gain should reshape the whole curve', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    const quadPath = resolve('data/P800_21K.quad');
    await page.setInputFiles('#quadFile', quadPath);

    const baselineSamples = await captureChartSamples(page);
    expect(baselineSamples).not.toBeNull();

    const labPath = resolve('data/P800_21K.txt');
    await page.setInputFiles('#linearizationFile', labPath);

    await page.waitForFunction(() => {
      const filename = document.getElementById('globalLinearizationFilename')?.textContent || '';
      const overlayReady = window.__quadDebug?.chartDebug?.getLastCorrectionOverlay?.();
      return filename.includes('P800_21K.txt') && overlayReady;
    }, { timeout: 15000 });

    const correctedSamples = await captureChartSamples(page);
    const overlaySamples = await captureOverlaySamples(page);

    expect(correctedSamples).not.toBeNull();
    expect(overlaySamples).not.toBeNull();

    const targetInput = 40;
    const baselinePoint = pickSample(baselineSamples, targetInput);
    const correctedPoint = pickSample(correctedSamples, targetInput);
    const overlayPoint = pickSample(overlaySamples, targetInput);

    expect(baselinePoint).not.toBeNull();
    expect(correctedPoint).not.toBeNull();
    expect(overlayPoint).not.toBeNull();

    // Sanity check: overlay requests a noticeably different output than the base .quad.
    expect(Math.abs((overlayPoint!.percent ?? 0) - (baselinePoint!.percent ?? 0))).toBeGreaterThan(5);

    // The corrected curve should track the overlay at full gain.
    const overlayGap = Math.abs((correctedPoint!.percent ?? 0) - (overlayPoint!.percent ?? 0));
    expect(overlayGap).toBeLessThan(1);
  });
});
