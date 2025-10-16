import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { parseLabData } from '../../src/js/data/lab-parser.js';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';
import {
  beginCompositeLabRedistribution,
  registerCompositeLabBase,
  finalizeCompositeLabRedistribution
} from '../../src/js/core/processing-pipeline.js';
import {
  setLoadedQuadData,
  ensureLoadedQuadData
} from '../../src/js/core/state.js';

const CURVE_RESOLUTION = 256;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function sampleArrayAt(samples, t) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return 0;
  }
  if (samples.length === 1) {
    return clamp01(Number(samples[0]) || 0);
  }
  const clampedT = clamp01(Number.isFinite(t) ? t : 0);
  const position = clampedT * (samples.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
  const frac = position - leftIndex;
  const leftValue = clamp01(Number(samples[leftIndex]) || 0);
  const rightValue = clamp01(Number(samples[rightIndex]) || 0);
  return leftValue + ((rightValue - leftValue) * frac);
}

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

describe('Composite LAB redistribution respects channel ceilings', () => {
  beforeEach(() => {
    LinearizationState.clear();
    setLoadedQuadData(null);
    ensureLoadedQuadData();
  });

  it('keeps deep-range corrections aligned with LAB targets for TRIFORCE_V4', () => {
    const quad = parseQuadFile('data/TRIFORCE_V4.quad');
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');
    const labEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt');

    expect(labEntry?.samples?.length).toBe(CURVE_RESOLUTION);

    LinearizationState.setGlobalData(labEntry, true);

    const channelNames = ['K', 'LK'];
    const endValues = {};
    channelNames.forEach((name) => {
      const series = quad.curves[name];
      expect(Array.isArray(series)).toBe(true);
      endValues[name] = Math.max(...series);
    });

    setLoadedQuadData({
      curves: quad.curves,
      sources: {},
      baselineEnd: endValues,
      normalizeToEndChannels: {}
    });

    const sessionStarted = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      interpolationType: 'cubic',
      smoothingPercent: 0
    });

    expect(sessionStarted).toBe(true);

    channelNames.forEach((name) => {
      registerCompositeLabBase(name, quad.curves[name]);
    });

    const result = finalizeCompositeLabRedistribution();
    expect(result?.curves).toBeTruthy();
    expect(result?.peakIndices).toBeTruthy();

    const correctedCurves = result.curves;
    const weights = result.weights instanceof Map
      ? result.weights
      : new Map(Array.isArray(result.weights) ? result.weights : []);
    const measurementSamples = Array.isArray(result.measurementSamples) && result.measurementSamples.length === CURVE_RESOLUTION
      ? result.measurementSamples
      : [];
    const targetSamples = Array.isArray(labEntry.samples) ? labEntry.samples : [];
    const maxCompositeDensity = channelNames.reduce((sum, name) => {
      const weight = weights.get(name) || 0;
      return sum + Math.max(0, weight);
    }, 0);

    const highlightIndices = [
      Math.round(0.80 * 255),
      Math.round(0.85 * 255),
      Math.round(0.90 * 255),
      Math.round(0.95 * 255)
    ];

    highlightIndices.forEach((index) => {
      const inputNormalized = index / (CURVE_RESOLUTION - 1);
      const targetNormalized = targetSamples.length === CURVE_RESOLUTION
        ? clamp01(targetSamples[index])
        : sampleArrayAt(targetSamples, inputNormalized);
      const measurementNormalized = measurementSamples.length === CURVE_RESOLUTION
        ? clamp01(measurementSamples[index])
        : sampleArrayAt(measurementSamples, inputNormalized);

      const baseDensity = channelNames.reduce((sum, name) => {
        const weight = weights.get(name) || 0;
        const endValue = endValues[name] || 0;
        if (endValue <= 0 || weight <= 0) return sum;
        const normalized = clamp01(quad.curves[name][index] / endValue);
        return sum + (weight * normalized);
      }, 0);

      const correctedDensity = channelNames.reduce((sum, name) => {
        const weight = weights.get(name) || 0;
        const endValue = endValues[name] || 0;
        if (endValue <= 0 || weight <= 0) return sum;
        const normalized = clamp01(correctedCurves[name][index] / endValue);
        return sum + (weight * normalized);
      }, 0);

      const directionTolerance = 0.01;

      if (targetNormalized + directionTolerance < baseDensity) {
        expect(correctedDensity).toBeLessThanOrEqual(baseDensity);
      } else if (targetNormalized - directionTolerance > baseDensity) {
        expect(correctedDensity).toBeGreaterThanOrEqual(baseDensity);
      }

      if (measurementSamples.length === CURVE_RESOLUTION) {
        // Ensure we are actually moving away from the original measurement when it diverges from the target.
        const measurementDelta = measurementNormalized - targetNormalized;
        if (measurementDelta > directionTolerance) {
          expect(correctedDensity).toBeLessThanOrEqual(measurementNormalized);
        } else if (measurementDelta < -directionTolerance) {
          expect(correctedDensity).toBeGreaterThanOrEqual(measurementNormalized);
        }
      }

      expect(correctedDensity).toBeGreaterThanOrEqual(0);
      expect(correctedDensity).toBeLessThanOrEqual(maxCompositeDensity + 5e-3);
    });

    const highlightChannel = channelNames.reduce((best, name) => {
      const curve = correctedCurves[name];
      if (!Array.isArray(curve)) return best;
      let peakIndex = 0;
      let peakValue = -Infinity;
      curve.forEach((value, idx) => {
        if (value > peakValue) {
          peakValue = value;
          peakIndex = idx;
        }
      });
      const ratio = peakIndex / (CURVE_RESOLUTION - 1);
      if (!best || ratio < best.ratio) {
        return { name, ratio, curve };
      }
      return best;
    }, null);

    expect(highlightChannel).toBeTruthy();
    if (highlightChannel) {
      const cutoff = Math.round(0.30 * (CURVE_RESOLUTION - 1));
      const registeredPeak = result.peakIndices?.[highlightChannel.name];
      expect(registeredPeak).toBeDefined();
      if (typeof registeredPeak === 'number') {
        expect(registeredPeak).toBeLessThanOrEqual(cutoff);
      }
    }
  });
});
