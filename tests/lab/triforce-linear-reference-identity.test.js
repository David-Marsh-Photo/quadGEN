import { beforeEach, describe, it, expect } from 'vitest';
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
import { setLabSmoothingPercent } from '../../src/js/core/lab-settings.js';

const QUAD_PATH = 'data/TRIFORCE_V4.quad';
const LAB_PATH = 'testdata/linear_reference_lab.txt';
const CURVE_RESOLUTION = 256;
const SAMPLE_STEP_PERCENT = 5;
const TARGET_TOLERANCE = 5e-3;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function percentToIndex(percent) {
  const clamped = clamp01(percent / 100);
  return Math.round(clamped * (CURVE_RESOLUTION - 1));
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

function loadLabMeasurementText() {
  return fs.readFileSync(path.resolve(LAB_PATH), 'utf8');
}

function buildPercentSamples(step = SAMPLE_STEP_PERCENT) {
  const samples = [];
  for (let percent = 0; percent <= 100; percent += step) {
    samples.push(percent);
  }
  return samples;
}

function computeDeltaAtIndex(baseSeries, correctedSeries, index) {
  const baseValue = baseSeries[index];
  const correctedValue = correctedSeries[index];
  return {
    baseValue,
    correctedValue,
    delta: (correctedValue ?? 0) - (baseValue ?? 0)
  };
}

function runCompositeRedistribution(options = {}) {
  const {
    smoothingPercent = 0,
    channelNames = ['K', 'C', 'LK']
  } = options;

  setLabSmoothingPercent(smoothingPercent);
  const quad = parseQuadFile(QUAD_PATH);
  const measurementText = loadLabMeasurementText();
  const labEntry = parseLabData(measurementText, 'linear_reference_lab.txt');

  expect(labEntry?.samples?.length).toBe(CURVE_RESOLUTION);

  LinearizationState.setGlobalData(labEntry, true);

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
    smoothingPercent
  });

  expect(sessionStarted).toBe(true);

  channelNames.forEach((name) => {
    registerCompositeLabBase(name, quad.curves[name]);
  });

  const result = finalizeCompositeLabRedistribution();
  expect(result?.curves).toBeTruthy();

  return {
    quad,
    labEntry,
    endValues,
    correctedCurves: result?.curves || {},
    measurementSamples: Array.isArray(result?.measurementSamples) ? result.measurementSamples : []
  };
}

describe('TRIFORCE linear reference sanity', () => {
  beforeEach(() => {
    LinearizationState.clear();
    setLoadedQuadData(null);
    ensureLoadedQuadData();
  });

  it('keeps TRIFORCE_V4 curves unchanged when applying linear_reference_lab.txt', () => {
    const {
      quad,
      labEntry,
      endValues,
      correctedCurves,
      measurementSamples
    } = runCompositeRedistribution({
      smoothingPercent: 0,
      channelNames: ['K', 'LK']
    });

    const rawSamples = Array.isArray(labEntry?.rawSamples) ? labEntry.rawSamples : [];
    if (rawSamples.length === CURVE_RESOLUTION) {
      const maxRawDelta = rawSamples.reduce((max, value, index) => {
        const expected = index / (CURVE_RESOLUTION - 1);
        const delta = Math.abs(value - expected);
        return Math.max(max, delta);
      }, 0);
      expect(maxRawDelta).toBeLessThan(0.02);
    }

    const targetSamples = Array.isArray(labEntry.samples) ? labEntry.samples : [];

    buildPercentSamples().forEach((percent) => {
      const index = percentToIndex(percent);
      if (measurementSamples.length === CURVE_RESOLUTION && targetSamples.length === CURVE_RESOLUTION) {
        const measurementNormalized = clamp01(measurementSamples[index]);
        const targetNormalized = clamp01(targetSamples[index]);
        expect(Math.abs(measurementNormalized - targetNormalized)).toBeLessThan(TARGET_TOLERANCE);

        ['K', 'LK'].forEach((name) => {
          const baseValue = quad.curves[name][index];
          const correctedValue = correctedCurves[name][index];
          const endValue = endValues[name] || 1;

          if (measurementNormalized > targetNormalized + TARGET_TOLERANCE) {
            expect(correctedValue).toBeLessThanOrEqual(baseValue);
          } else if (measurementNormalized < targetNormalized - TARGET_TOLERANCE) {
            expect(correctedValue).toBeGreaterThanOrEqual(baseValue);
          }

          expect(correctedValue).toBeGreaterThanOrEqual(0);
          expect(correctedValue).toBeLessThanOrEqual(endValue);
        });
      }
    });
  });

  it('prevents highlight blip when smoothing is extreme', () => {
    const {
      quad,
      correctedCurves,
      endValues
    } = runCompositeRedistribution({
      smoothingPercent: 100,
      channelNames: ['K', 'C', 'LK']
    });

    const index = percentToIndex(5);
    const cDelta = computeDeltaAtIndex(quad.curves.C, correctedCurves.C, index);
    const lkDelta = computeDeltaAtIndex(quad.curves.LK, correctedCurves.LK, index);
    const kDelta = computeDeltaAtIndex(quad.curves.K, correctedCurves.K, index);

    expect(cDelta.delta).toBeLessThanOrEqual(0);
    expect(lkDelta.delta).toBeLessThanOrEqual(0);
    expect(kDelta.delta).toBe(0);

    expect(correctedCurves.C[index]).toBeGreaterThanOrEqual(0);
    expect(correctedCurves.LK[index]).toBeGreaterThanOrEqual(0);
  });
});
