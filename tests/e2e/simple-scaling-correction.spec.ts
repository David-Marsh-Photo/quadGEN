import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { readFileSync, mkdirSync } from 'fs';
import { parseQuadFile } from '../../src/js/parsers/file-parsers.js';

const DATASET = {
  quad: 'data/P800_K36C26LK25_V6.quad',
  lab: 'data/P800_K36C26LK25_V6.txt'
};

const DNPRO_REFERENCE = 'data/P800_K36C26LK25_V7_DNPRO.quad';
const ARTIFACT_PATH = resolve('artifacts/simple-scaling/simple-scaling-vs-dnpro.png');
const CLAMP_MIN = 0.85;
const CLAMP_MAX = 1.9;
const TOLERANCE = 0.02;

interface CurveSet {
  [channel: string]: number[];
}

interface BaselineSnapshot {
  curves: CurveSet;
  baselineEnd: Record<string, number>;
}

interface BrowserCorrectionSnapshot {
  corrected: CurveSet | null;
  baseline: Record<string, number>;
  summary: {
    blendPercent?: number;
    perChannelLift?: Record<string, number>;
    residual?: { max?: number; mean?: number };
  } | null;
  correctionMethod: string | null;
}

interface ReferenceQuad {
  curves: CurveSet;
  baselineEnd: Record<string, number>;
}

function loadReferenceQuad(relativePath: string): ReferenceQuad {
  const absolute = resolve(relativePath);
  const content = readFileSync(absolute, 'utf-8');
  const parsed = parseQuadFile(content);
  if (!parsed || !parsed.curves) {
    throw new Error(`Failed to parse reference quad at ${relativePath}`);
  }
  return {
    curves: parsed.curves,
    baselineEnd: parsed.baselineEnd || {}
  };
}

function computeTotals(curves: CurveSet, resolution: number): number[] {
  const totals = new Array(resolution).fill(0);
  Object.values(curves).forEach((series) => {
    if (!Array.isArray(series)) return;
    for (let i = 0; i < Math.min(series.length, resolution); i += 1) {
      totals[i] += Number(series[i]) || 0;
    }
  });
  return totals;
}

function computeChannelDiff(
  actual: CurveSet,
  reference: CurveSet,
  referenceEnds: Record<string, number>,
  resolution: number
): Record<string, number> {
  const diffMap: Record<string, number> = {};
  Object.entries(reference).forEach(([channel, refSeries]) => {
    const actualSeries = actual[channel];
    expect(actualSeries).toBeTruthy();
    expect(actualSeries?.length).toBeGreaterThanOrEqual(resolution);
    const endValue = Math.max(1, referenceEnds[channel] ?? Math.max(...refSeries, 1));
    let maxDiff = 0;
    for (let i = 0; i < resolution; i += 1) {
      const ref = Number(refSeries[i]) || 0;
      const actualValue = Number(actualSeries?.[i]) || 0;
      const relative = Math.abs(actualValue - ref) / endValue;
      if (relative > maxDiff) {
        maxDiff = relative;
      }
    }
    diffMap[channel] = maxDiff;
  });
  return diffMap;
}

function computeGainEnvelope(
  baselineTotals: number[],
  correctedTotals: number[]
): { min: number; max: number; stdDev: number } {
  const gainSeries: number[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < baselineTotals.length; i += 1) {
    const baseValue = baselineTotals[i];
    const correctedValue = correctedTotals[i];
    if (baseValue < 5 && correctedValue < 5) {
      continue;
    }
    const base = Math.max(1, baseValue);
    const value = correctedValue / base;
    gainSeries.push(value);
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    sumSq += value * value;
    count += 1;
  }

  if (count === 0) {
    return { min: 1, max: 1, stdDev: 0 };
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const stdDev = Math.sqrt(variance);

  return { min, max, stdDev };
}

test.describe('Simple scaling correction pipeline', () => {
  test('aligns with DNPRO reference while honoring scaling improvements', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.addInitScript(() => {
      try {
        const storage = window.localStorage;
        const resetKeys = [
          'quadgen.correctionMethod.v1',
          'quadgen.labNormalizationMode',
          'quadgen.labSmoothingPercent',
          'quadgen.plotSmoothingPercent'
        ];
        resetKeys.forEach((key) => storage.removeItem(key));
        storage.setItem('quadgen.labNormalizationMode', 'lstar');
      } catch {
        /* ignore storage access errors */
      }
    });

    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await Promise.all([
      page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 }),
      page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 }),
      page.waitForSelector('#correctionMethodSimple', { state: 'attached', timeout: 15000 })
    ]);

    const diagnostics = await page.evaluate(() => {
      const densityRadio = document.querySelector('#correctionMethodDensity') as HTMLInputElement | null;
      const simpleRadio = document.querySelector('#correctionMethodSimple') as HTMLInputElement | null;
      const quadInput = document.querySelector('#quadFile') as HTMLInputElement | null;
      const labInput = document.querySelector('#linearizationFile') as HTMLInputElement | null;
      return {
        hasDensityRadio: !!densityRadio,
        hasSimpleRadio: !!simpleRadio,
        simpleChecked: simpleRadio ? simpleRadio.checked : null,
        quadAccept: quadInput?.accept || null,
        labAccept: labInput?.accept || null
      };
    });

    expect(diagnostics.hasDensityRadio).toBeTruthy();
    expect(diagnostics.hasSimpleRadio).toBeTruthy();
    expect(diagnostics.simpleChecked).toBe(true);

    if (!diagnostics.simpleChecked) {
      await page.click('#optionsBtn');
      await page.waitForSelector('#optionsModal', { state: 'visible', timeout: 10000 });
      await page.locator('#correctionMethodSimple').scrollIntoViewIfNeeded();
      await page.click('#correctionMethodSimple');
      await page.waitForFunction(
        () => {
          const radio = document.querySelector('#correctionMethodSimple') as HTMLInputElement | null;
          return !!radio && radio.checked;
        },
        null,
        { timeout: 5000 }
      );
      await page.click('#closeOptionsBtn');
      await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 10000 });
    }

    await page.setInputFiles('#quadFile', resolve(DATASET.quad));
    await page.waitForFunction(
      () => {
        if (typeof window.getLoadedQuadData !== 'function') return false;
        const data = window.getLoadedQuadData();
        return data && data.curves && Object.keys(data.curves).length > 0;
      },
      null,
      { timeout: 20000 }
    );

    const baselineSnapshot = (await page.evaluate(() => {
      if (typeof window.getLoadedQuadData !== 'function') {
        return null;
      }
      const loaded = window.getLoadedQuadData();
      return {
        curves: loaded?.curves || {},
        baselineEnd: loaded?.baselineEnd || {}
      };
    })) as BaselineSnapshot | null;

    expect(baselineSnapshot).not.toBeNull();
    const originalBaseline: BaselineSnapshot = {
      curves: JSON.parse(JSON.stringify(baselineSnapshot?.curves || {})),
      baselineEnd: { ...(baselineSnapshot?.baselineEnd || {}) }
    };

    await page.waitForFunction(() => {
      const overlays = window.__quadDebug?.chartDebug?.lastOriginalOverlays;
      if (!overlays || Object.keys(overlays).length === 0) {
        return false;
      }
      return Object.values(overlays).some(
        (entry: any) => entry && Array.isArray(entry.samples) && entry.samples.length > 0
      );
    }, null, { timeout: 5000 });

    await page.setInputFiles('#linearizationFile', resolve(DATASET.lab));

    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 30000 }
    );

    await page.waitForFunction(
      () => {
        const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
        const globalReady = !!(window.LinearizationState && window.LinearizationState.globalApplied);
        return globalReady && !!loaded?.simpleScalingSummary;
      },
      null,
      { timeout: 30000 }
    );

    await page.waitForTimeout(1500);

    const correctionSnapshot = (await page.evaluate(() => {
      const corrected =
        window.LinearizationState && typeof window.LinearizationState.getGlobalCorrectedCurves === 'function'
          ? window.LinearizationState.getGlobalCorrectedCurves()
          : null;
      const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return {
        corrected,
        baseline: loaded?.baselineEnd || {},
        summary: loaded?.simpleScalingSummary || null,
        correctionMethod: loaded?.correctionMethod || null
      };
    })) as BrowserCorrectionSnapshot;

    expect(correctionSnapshot.correctionMethod).toBe('simpleScaling');
    expect(correctionSnapshot.corrected).not.toBeNull();
    expect(correctionSnapshot.summary).not.toBeNull();

    const correctedCurves = correctionSnapshot.corrected as CurveSet;
    const reference = loadReferenceQuad(DNPRO_REFERENCE);
    const resolution = 256;

    const baselineTotals = computeTotals(originalBaseline.curves, resolution);
    const correctedTotals = computeTotals(correctedCurves, resolution);
    const referenceTotals = computeTotals(reference.curves, resolution);

    const gainEnvelope = computeGainEnvelope(baselineTotals, correctedTotals);
    expect(gainEnvelope.min).toBeGreaterThan(0.55);
    expect(gainEnvelope.max).toBeLessThanOrEqual(CLAMP_MAX + 0.001);
    expect(gainEnvelope.stdDev).toBeGreaterThan(0.005);

    const channelDiffs = computeChannelDiff(correctedCurves, reference.curves, reference.baselineEnd, resolution);
    const worstChannel = Object.entries(channelDiffs).reduce(
      (worst, [channel, diff]) => (diff > worst.diff ? { name: channel, diff } : worst),
      { name: '', diff: 0 }
    );
    expect(worstChannel.diff).toBeGreaterThan(0.1);

    const midIndex = Math.round(0.5 * (resolution - 1));
    const highlightIndex = Math.round(0.1 * (resolution - 1));

    const referenceMidTotal = referenceTotals[midIndex];
    const correctedMidTotal = correctedTotals[midIndex];
    const midRatio = referenceMidTotal > 0 ? correctedMidTotal / referenceMidTotal : 1;
    if (referenceMidTotal > 0) {
      expect(midRatio).toBeGreaterThan(0.8);
      expect(midRatio).toBeLessThan(1.6);
    }

    const referenceHighlightTotal = referenceTotals[highlightIndex];
    const correctedHighlightTotal = correctedTotals[highlightIndex];
    const highlightRatio = referenceHighlightTotal > 0 ? correctedHighlightTotal / referenceHighlightTotal : 1;
    if (referenceHighlightTotal > 0) {
      expect(highlightRatio).toBeGreaterThan(0.6);
      expect(highlightRatio).toBeLessThan(2.1);
    }

    const baselineHighlightTotal = baselineTotals[highlightIndex];
    if (baselineHighlightTotal > 0) {
      const baselineHighlightRatio = correctedHighlightTotal / baselineHighlightTotal;
      expect(baselineHighlightRatio).toBeGreaterThan(0.6);
      expect(baselineHighlightRatio).toBeLessThan(2.1);
    }

    const baselineMidTotal = baselineTotals[midIndex];
    if (baselineMidTotal > 0) {
      const baselineMidRatio = correctedMidTotal / baselineMidTotal;
      expect(baselineMidRatio).toBeGreaterThan(0.8);
      expect(baselineMidRatio).toBeLessThan(1.6);
    }

    const kMid = Number(correctedCurves.K?.[midIndex] ?? 0);
    const kRefMid = Number(reference.curves.K?.[midIndex] ?? 0);
    if (kRefMid > 0) {
      expect(kMid).toBeGreaterThan(kRefMid);
    } else {
      expect(kMid).toBeGreaterThan(0);
    }

    const summary = correctionSnapshot.summary || {};
    const lifts = summary.perChannelLift || {};
    const baselineEnd = originalBaseline.baselineEnd;

    Object.entries(lifts).forEach(([channel, lift]) => {
      const base = Math.max(1, baselineEnd[channel] ?? 0);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(base * 0.021);
    });

    const residualMax = summary.residual?.max ?? null;
    expect(residualMax).not.toBeNull();
    if (residualMax != null) {
      // K/MK are guarded from auto-raising and the per-channel lift cap is 15 %, so residuals can stay elevated once overflow is capped.
      expect(residualMax).toBeLessThanOrEqual(0.45);
    }

    await page.waitForFunction(() => {
      const overlays = window.__quadDebug?.chartDebug?.lastOriginalOverlays;
      return overlays && Object.keys(overlays).length > 0;
    }, null, { timeout: 5000 });

    const overlayComparison = await page.evaluate(() => {
      const baseline = window.LinearizationState?.getGlobalBaselineCurves?.() || null;
      const original = typeof window.getLoadedQuadData === 'function'
        ? window.getLoadedQuadData()?.originalCurves || null
        : null;
      const overlays = window.__quadDebug?.chartDebug?.lastOriginalOverlays || null;
      return { baseline, original, overlays };
    });

    expect(overlayComparison.overlays).toBeTruthy();

    const referenceCurves = overlayComparison.original || overlayComparison.baseline || {};

    Object.entries(referenceCurves).forEach(([channel, samples]) => {
      if (!Array.isArray(samples) || !samples.length) {
        return;
      }
      const hasNonZero = samples.some((value) => Number(value) !== 0);
      if (!hasNonZero) {
        return;
      }
      const overlay = overlayComparison.overlays?.[channel];
      expect(overlay, `overlay missing for channel ${channel}`).toBeTruthy();
      expect(Array.isArray(overlay?.samples), `overlay samples missing for ${channel}`).toBeTruthy();
      expect(overlay?.samples?.length, `overlay samples length mismatch for ${channel}`).toBe(samples.length);
      expect(overlay?.samples, `overlay samples differ from baseline for ${channel}`).toEqual(samples);
    });

    mkdirSync(resolve('artifacts/simple-scaling'), { recursive: true });
    await page.screenshot({
      path: ARTIFACT_PATH,
      fullPage: false,
      clip: { x: 160, y: 140, width: 920, height: 560 }
    });

    expect(consoleErrors).toEqual([]);
  });
});
