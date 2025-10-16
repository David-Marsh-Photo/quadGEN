import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { parseLabData } from '../../src/js/data/lab-parser.js';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';
import {
  beginCompositeLabRedistribution,
  finalizeCompositeLabRedistribution,
  make256
} from '../../src/js/core/processing-pipeline.js';
import { setLoadedQuadData, ensureLoadedQuadData } from '../../src/js/core/state.js';
import {
  setCompositeWeightingMode,
  getCompositeWeightingMode
} from '../../src/js/core/composite-settings.js';
import { setCompositeDebugEnabled, getCompositeDebugSnapshot } from '../../src/js/core/composite-debug.js';
import { getCompositeDebugState } from '../../src/js/core/composite-debug.js';
import {
  setRedistributionSmoothingWindowEnabled,
  configureRedistributionSmoothingWindow,
  getRedistributionSmoothingWindowConfig,
  isRedistributionSmoothingWindowEnabled
} from '../../src/js/core/feature-flags.js';

const CURVE_RESOLUTION = 256;

function parseQuadFile(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const headerLine = lines.find((line) => line.startsWith('## QuadToneRIP '));
  if (!headerLine) {
    throw new Error(`Quad header missing in ${relativePath}`);
  }
  const channels = headerLine.replace('## QuadToneRIP ', '').trim().split(',');
  const curves = {};
  channels.forEach((name) => {
    curves[name] = new Array(CURVE_RESOLUTION);
  });

  let currentChannel = null;
  let pointer = 0;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      const maybeChannel = trimmed.replace(/^#+/, '').trim();
      if (maybeChannel.endsWith('curve')) {
        const [name] = maybeChannel.split(/\s+/);
        if (Object.prototype.hasOwnProperty.call(curves, name)) {
          currentChannel = name;
          pointer = 0;
        } else {
          currentChannel = null;
        }
      }
      return;
    }
    if (/^-?\d+$/.test(trimmed) && currentChannel) {
      if (pointer < CURVE_RESOLUTION) {
        curves[currentChannel][pointer] = parseInt(trimmed, 10) || 0;
        pointer += 1;
      }
    }
  });

  channels.forEach((name) => {
    const series = curves[name];
    if (!Array.isArray(series)) return;
    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
      if (typeof series[i] !== 'number') {
        series[i] = 0;
      }
    }
  });

  return { channels, curves };
}

describe('Composite weighting modes', () => {
  beforeEach(() => {
    LinearizationState.clear();
    setLoadedQuadData(null);
    ensureLoadedQuadData();
    setCompositeWeightingMode('normalized');
    setCompositeDebugEnabled(true);
  });

  it('falls back to normalized weighting when provided an unknown mode', () => {
    const applied = setCompositeWeightingMode('unknown-mode');
    expect(applied).toBe('normalized');
  });

  function runComposite(weightingMode, options = {}) {
    const { enableSmoothingWindow = false } = options;
    let smoothingRestore = null;
    if (enableSmoothingWindow) {
      const previousEnabled = isRedistributionSmoothingWindowEnabled();
      const previousConfig = getRedistributionSmoothingWindowConfig();
      smoothingRestore = { previousEnabled, previousConfig };
      setRedistributionSmoothingWindowEnabled(true);
      configureRedistributionSmoothingWindow({ targetSpan: 0.07, maxSamples: 9, minSamples: 3, alpha: 1.5 });
    }

    if (weightingMode) {
      setCompositeWeightingMode(weightingMode);
    }

    const quad = parseQuadFile('data/TRIFORCE_V4.quad');
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');
    const labEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt');

    LinearizationState.setGlobalData(labEntry, true);

    const channelNames = ['K', 'C', 'LK'];
    const endValues = {};
    channelNames.forEach((channelName) => {
      const curve = quad.curves[channelName];
      endValues[channelName] = Math.max(...curve);
    });

    setLoadedQuadData({
      curves: quad.curves,
      baselineEnd: { ...endValues },
      sources: {},
      normalizeToEndChannels: {}
    });
    const loadedData = ensureLoadedQuadData();

    const sessionStarted = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      interpolationType: 'cubic',
      smoothingPercent: 0,
      weightingMode: weightingMode || getCompositeWeightingMode()
    });
    expect(sessionStarted).toBe(true);

    channelNames.forEach((channelName) => {
      const endValue = endValues[channelName];
      const base = make256(endValue, channelName, true);
      loadedData.plotBaseCurves[channelName] = base.slice();
    });

    finalizeCompositeLabRedistribution();
    const snapshot = getCompositeDebugSnapshot(67);
    const state = getCompositeDebugState();
    if (enableSmoothingWindow) {
      const prevConfig = smoothingRestore?.previousConfig || getRedistributionSmoothingWindowConfig();
      const prevEnabled = typeof smoothingRestore?.previousEnabled === 'boolean' ? smoothingRestore.previousEnabled : false;
      configureRedistributionSmoothingWindow(prevConfig);
      setRedistributionSmoothingWindowEnabled(prevEnabled);
    }
    return {
      snapshot,
      summary: state?.summary ?? null
    };
  }

  it('defaults to normalized weighting', () => {
    const { summary } = runComposite();
    expect(summary?.weightingMode).toBe('normalized');
    const weights = summary?.densityWeights ?? {};
    const kWeight = Number(weights?.K ?? 0);
    const cWeight = Number(weights?.C ?? 0);
    const lkWeight = Number(weights?.LK ?? 0);
    expect(Number.isFinite(kWeight)).toBe(true);
    expect(Number.isFinite(cWeight)).toBe(true);
    expect(Number.isFinite(lkWeight)).toBe(true);
    expect(kWeight).toBeGreaterThan(cWeight);
    expect(cWeight).toBeGreaterThan(lkWeight);
    expect(lkWeight).toBeGreaterThan(0);
  });

  it('normalized weighting retains cyan contribution', () => {
    const { summary } = runComposite('normalized');
    expect(summary).toBeTruthy();
    expect(summary?.densityWeights?.C ?? 0).toBeGreaterThan(0);
    expect(summary?.coverageLimits?.C ?? 0).toBeGreaterThan(0);
  });

  it('equal weighting assigns matching shares to each active channel', () => {
    const { summary } = runComposite('equal');
    expect(summary?.densityWeights).toBeTruthy();
    const weights = summary?.densityWeights ?? {};
    const channels = ['K', 'C', 'LK'];
    const values = channels.map((name) => Number(weights?.[name] ?? 0));
    expect(values.every((value) => Number.isFinite(value))).toBe(true);
    const total = values.reduce((acc, value) => acc + value, 0);
    const average = channels.length ? total / channels.length : 0;
    values.forEach((value) => {
      expect(value).toBeCloseTo(average, 4);
    });
  });

  it('momentum weighting exposes momentum diagnostics and biases toward high-momentum channels', () => {
    const { snapshot: isolatedSnapshot } = runComposite('isolated');
    const { snapshot: momentumSnapshot, summary } = runComposite('momentum');

    expect(momentumSnapshot).toBeTruthy();
    expect(summary?.weightingMode).toBe('momentum');
    expect(summary?.momentumPeaks).toBeTruthy();
    const peakValues = Object.values(summary?.momentumPeaks ?? {});
    expect(peakValues.length).toBeGreaterThan(0);
    expect(peakValues.some((value) => (value ?? 0) > 0)).toBe(true);

    const perChannelMomentum = momentumSnapshot?.perChannel ?? {};
    Object.entries(perChannelMomentum).forEach(([channel, entry]) => {
      if ((entry?.shareAfter ?? 0) > 0) {
        expect(entry?.momentum).toBeGreaterThanOrEqual(0);
      }
    });

    const momentumEntries = Object.values(perChannelMomentum);
    expect(momentumEntries.some((entry) => (entry?.momentum ?? 0) > 0)).toBe(true);
    const isolatedMomentumEntries = Object.values(isolatedSnapshot?.perChannel ?? {});
    expect(isolatedMomentumEntries.every((entry) => (entry?.momentum ?? 0) === 0)).toBe(true);
  });

  it('captures coverage ceiling diagnostics when smoothing is enabled', () => {
    expect(typeof setRedistributionSmoothingWindowEnabled).toBe('function');
    expect(typeof configureRedistributionSmoothingWindow).toBe('function');
    const { summary } = runComposite('normalized', { enableSmoothingWindow: true });
    const coverageSummary = summary?.coverageSummary ?? {};
    expect(Object.keys(coverageSummary).length).toBeGreaterThan(0);
    Object.entries(coverageSummary).forEach(([channel, entry]) => {
      expect(typeof entry?.limit).toBe('number');
      expect(typeof entry?.buffer).toBe('number');
      expect(typeof entry?.bufferedLimit).toBe('number');
      // clampedSamples may be empty under floating ceilings, but should still be an array
      expect(Array.isArray(entry?.clampedSamples)).toBe(true);
      entry.clampedSamples.forEach((truncation) => {
        expect(typeof truncation.index).toBe('number');
        expect(typeof truncation.inputPercent).toBe('number');
        expect(typeof truncation.bufferedLimit).toBe('number');
        if (truncation.limit !== null) {
          expect(typeof truncation.limit).toBe('number');
        }
      });
    });
  });

});
