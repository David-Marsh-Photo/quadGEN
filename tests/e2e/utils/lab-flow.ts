import { pathToFileURL } from 'url';
import { resolve } from 'path';
import type { Page } from '@playwright/test';

const CURVE_RESOLUTION = 256;

export interface LinearizationDataset {
  quadPath: string;
  labPath: string;
}

export interface CompositeChannelProfile {
  share: number;
  constant: number;
  cumulative: number;
}

export interface CompositeProfile {
  input: number;
  densityDelta: number;
  perChannel: Record<string, CompositeChannelProfile>;
}

export interface LinearizationFlowResult {
  baselineCurves: Record<string, number[]> | null;
  correctedCurves: Record<string, number[]> | null;
  baselineEnd: Record<string, number>;
  normalizedSamples: number[] | null;
  measurementSamples: number[] | null;
  measurementDeltas: number[] | null;
  originalData: Array<{ input: number; lab: number }> | null;
  originalSamples: number[] | null;
  warnings: string[];
  globalMeta: {
    filename: string | null;
    normalizationMode: string | null;
    smoothingPercent: number | null;
    interpolationType: string | null;
  } | null;
  compositeProfiles: Record<number, CompositeProfile | null>;
  channelPeaks: Record<string, number> | null;
}

export interface LinearizationFlowOptions {
  enableComposite?: boolean;
  waitForGlobalAppliedMs?: number;
  waitAfterLoadMs?: number;
  percentages?: number[];
}

export interface ChannelSampleSummary {
  endValue: number;
  baseline: {
    value: number | null;
    normalized: number | null;
  };
  corrected: {
    value: number | null;
    normalized: number | null;
  };
  delta: number | null;
}

export interface SampleTotals {
  baselineInk: number | null;
  correctedInk: number | null;
  deltaInk: number | null;
}

export interface AuditSampleSummary {
  percent: number;
  index: number;
  targetNormalized: number | null;
  measurementNormalized: number | null;
  measurementDelta: number | null;
  compositeProfile: CompositeProfile | null;
  densityDelta: number | null;
  perChannel: Record<string, ChannelSampleSummary>;
  totals: SampleTotals;
}

export async function runLinearizationAudit(
  page: Page,
  dataset: LinearizationDataset,
  options: LinearizationFlowOptions = {}
): Promise<LinearizationFlowResult> {
  const {
    enableComposite = true,
    waitForGlobalAppliedMs = 20000,
    waitAfterLoadMs = 3000,
    percentages = [95]
  } = options;

  const indexUrl = pathToFileURL(resolve('index.html')).href;

  await page.goto(indexUrl);

  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);

  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });

  if (enableComposite) {
    await page.evaluate(() => {
      if (typeof window.enableCompositeLabRedistribution === 'function') {
        window.enableCompositeLabRedistribution(true);
      }
    });
  }

  await page.setInputFiles('#quadFile', resolve(dataset.quadPath));

  await waitForCurves(page);

  await page.setInputFiles('#linearizationFile', resolve(dataset.labPath));

  await page.waitForFunction(
    () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
    null,
    { timeout: waitForGlobalAppliedMs }
  );

  if (waitAfterLoadMs > 0) {
    await page.waitForTimeout(waitAfterLoadMs);
  }

  await waitForCurves(page);

  const auditData = await page.evaluate((percentList: number[]) => {
    const cloneCurveMap = (map?: Record<string, ArrayLike<number>> | null) => {
      if (!map || typeof map !== 'object') return null;
      const out: Record<string, number[]> = {};
      Object.entries(map).forEach(([name, arr]) => {
        if (!Array.isArray(arr) && !(arr && typeof arr.length === 'number')) {
          return;
        }
        try {
          out[name] = Array.from(arr as ArrayLike<number>).map((value) => Number(value) || 0);
        } catch {
          const cloned: number[] = [];
          const length = (arr as ArrayLike<number>).length ?? 0;
          for (let i = 0; i < length; i += 1) {
            cloned.push(Number((arr as ArrayLike<number>)[i]) || 0);
          }
          out[name] = cloned;
        }
      });
      return Object.keys(out).length ? out : null;
    };

    const normalizePercentList = Array.isArray(percentList) ? percentList.filter((value) => Number.isFinite(value)) : [];

    const loadedData = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
    const baselineSnapshot = window.LinearizationState && typeof window.LinearizationState.getGlobalBaselineCurves === 'function'
      ? window.LinearizationState.getGlobalBaselineCurves()
      : null;
    const correctedSnapshot = window.LinearizationState && typeof window.LinearizationState.getGlobalCorrectedCurves === 'function'
      ? window.LinearizationState.getGlobalCorrectedCurves()
      : null;

    const baselineCurves =
      cloneCurveMap(baselineSnapshot) ||
      cloneCurveMap(loadedData?.originalCurves) ||
      cloneCurveMap(loadedData?.plotBaseCurves) ||
      cloneCurveMap(loadedData?.rebasedSources);

    const correctedCurves =
      cloneCurveMap(correctedSnapshot) ||
      cloneCurveMap(loadedData?.curves) ||
      null;

    const baselineEnd = loadedData?.baselineEnd && typeof loadedData.baselineEnd === 'object'
      ? Object.fromEntries(Object.entries(loadedData.baselineEnd).map(([name, value]) => [name, Number(value) || 0]))
      : {};

    const globalData = window.LinearizationState && typeof window.LinearizationState.getGlobalData === 'function'
      ? window.LinearizationState.getGlobalData()
      : null;

    const normalizedSamples = Array.isArray(globalData?.samples)
      ? Array.from(globalData.samples, (value) => Number(value) || 0)
      : null;
    const measurementSamples = Array.isArray(globalData?.measurementSamples)
      ? Array.from(globalData.measurementSamples, (value) => Number(value) || 0)
      : null;
    const measurementDeltas = Array.isArray(globalData?.measurementDeltas)
      ? Array.from(globalData.measurementDeltas, (value) => Number(value) || 0)
      : null;
    const originalSamples = Array.isArray(globalData?.originalSamples)
      ? Array.from(globalData.originalSamples, (value) => Number(value) || 0)
      : null;
    const originalData = Array.isArray(globalData?.originalData)
      ? globalData.originalData.map((entry: any) => ({
        input: Number(entry?.input) || 0,
        lab: Number(entry?.lab) || 0
      }))
      : null;

    const warnings = window.LinearizationState && typeof window.LinearizationState.getGlobalWarnings === 'function'
      ? window.LinearizationState.getGlobalWarnings()
      : [];

    const globalMeta = globalData
      ? {
          filename: globalData.filename || globalData.sourceFilename || null,
          normalizationMode: globalData.normalizationMode || globalData.normalization || null,
          smoothingPercent: typeof globalData.smoothingPercent === 'number' ? globalData.smoothingPercent : null,
          interpolationType: globalData.interpolationType || null
        }
      : null;

    const channelPeaks = loadedData?.channelPeaks && typeof loadedData.channelPeaks === 'object'
      ? Object.fromEntries(Object.entries(loadedData.channelPeaks).map(([name, value]) => [name, Number(value) || 0]))
      : null;

    const compositeProfiles: Record<number, CompositeProfile | null> = {};
    normalizePercentList.forEach((percent) => {
      if (typeof window.getCompositeDensityProfile !== 'function') {
        compositeProfiles[percent] = null;
        return;
      }
      const profile = window.getCompositeDensityProfile(percent);
      if (!profile || typeof profile !== 'object') {
        compositeProfiles[percent] = null;
        return;
      }
      const perChannelRaw = profile.perChannel && typeof profile.perChannel === 'object'
        ? profile.perChannel
        : {};
      const perChannel: Record<string, CompositeChannelProfile> = {};
      Object.entries(perChannelRaw).forEach(([name, info]) => {
        perChannel[name] = {
          share: Number((info as any)?.share) || 0,
          constant: Number((info as any)?.constant) || 0,
          cumulative: Number((info as any)?.cumulative) || 0
        };
      });
      compositeProfiles[percent] = {
        input: Number(profile.input) || 0,
        densityDelta: Number(profile.densityDelta) || 0,
        perChannel
      };
    });

    return {
      baselineCurves,
      correctedCurves,
      baselineEnd,
      normalizedSamples,
      measurementSamples,
      measurementDeltas,
      originalSamples,
      originalData,
      warnings: Array.isArray(warnings) ? warnings.slice() : [],
      globalMeta,
      compositeProfiles,
      channelPeaks
    } as LinearizationFlowResult;
  }, percentages);

  return auditData;
}

export async function waitForCurves(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    if (typeof window.getLoadedQuadData !== 'function') return false;
    const data = window.getLoadedQuadData();
    if (!data || !data.curves) return false;
    const expectedLength = 256;
    return Object.values(data.curves).some(
      (arr: any) => Array.isArray(arr) && arr.length === expectedLength
    );
  }, null, { timeout: 20000 });
}

export function computeSampleIndex(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  const normalized = Math.max(0, Math.min(100, percent)) / 100;
  return Math.max(0, Math.min(CURVE_RESOLUTION - 1, Math.round(normalized * (CURVE_RESOLUTION - 1))));
}

export function buildAuditSummaries(
  flowResult: LinearizationFlowResult,
  percentages: number[]
): AuditSampleSummary[] {
  const correctedCurves = flowResult.correctedCurves || {};
  const baselineCurves = flowResult.baselineCurves || {};
  const channels = Object.keys(correctedCurves);

  return percentages.map((percent) => {
    const index = computeSampleIndex(percent);

    let baselineInk: number | null = channels.length ? 0 : null;
    let correctedInk: number | null = channels.length ? 0 : null;

    const perChannel: Record<string, ChannelSampleSummary> = {};

    channels.forEach((channelName) => {
      const baselineSeries = baselineCurves[channelName] || null;
      const correctedSeries = correctedCurves[channelName] || null;
      const endValue =
        (flowResult.baselineEnd && Number(flowResult.baselineEnd[channelName])) ||
        (Array.isArray(correctedSeries) ? Math.max(...correctedSeries) : 0) ||
        0;

      const baselineValue =
        baselineSeries && baselineSeries.length > index ? Number(baselineSeries[index]) : null;
      const correctedValue =
        correctedSeries && correctedSeries.length > index ? Number(correctedSeries[index]) : null;

      if (baselineInk !== null && baselineValue !== null) {
        baselineInk += baselineValue;
      }
      if (correctedInk !== null && correctedValue !== null) {
        correctedInk += correctedValue;
      }

      perChannel[channelName] = {
        endValue,
        baseline: {
          value: baselineValue,
          normalized:
            baselineValue !== null && endValue > 0 ? clamp01(baselineValue / endValue) : null
        },
        corrected: {
          value: correctedValue,
          normalized:
            correctedValue !== null && endValue > 0 ? clamp01(correctedValue / endValue) : null
        },
        delta:
          baselineValue !== null && correctedValue !== null
            ? correctedValue - baselineValue
            : null
      };
    });

    const targetNormalized =
      flowResult.normalizedSamples && flowResult.normalizedSamples.length > index
        ? clamp01(flowResult.normalizedSamples[index])
        : null;
    const measurementNormalized =
      flowResult.measurementSamples && flowResult.measurementSamples.length > index
        ? clamp01(flowResult.measurementSamples[index])
        : null;
    const measurementDelta =
      flowResult.measurementDeltas && flowResult.measurementDeltas.length > index
        ? flowResult.measurementDeltas[index]
        : null;

    const compositeProfile = flowResult.compositeProfiles[percent] || null;
    const densityDelta = compositeProfile ? compositeProfile.densityDelta : null;

    const totals: SampleTotals = {
      baselineInk,
      correctedInk,
      deltaInk:
        baselineInk !== null && correctedInk !== null ? correctedInk - baselineInk : null
    };

    return {
      percent,
      index,
      targetNormalized,
      measurementNormalized,
      measurementDelta,
      compositeProfile,
      densityDelta,
      perChannel,
      totals
    };
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
