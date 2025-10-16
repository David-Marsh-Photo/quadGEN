import { describe, expect, test } from 'vitest';
import {
  configureSimpleScaling,
  generateSimpleScalingGain,
  applyGainToChannels,
  runSimpleScalingCorrection
} from '../../src/js/core/simple-scaling/index.js';
import { LAB_NORMALIZATION_MODES } from '../../src/js/core/lab-settings.js';
import fs from 'fs';
import path from 'path';

function loadLabMeasurements(relativePath) {
  const absolute = path.resolve(process.cwd(), relativePath);
  const raw = fs.readFileSync(absolute, 'utf-8').trim().split(/\r?\n/);
  return raw.slice(1).map((line) => {
    const [gray, labL] = line.split(/\s+/).map(Number);
    return { input: gray, lab: labL };
  });
}

function densityToLstar(density) {
  const Y = 10 ** (-density);
  if (Y > 0.008856) {
    return 116 * Math.cbrt(Y) - 16;
  }
  return 903.3 * Y;
}

function createMeasurementSet(mapper) {
  const MIN_DENSITY = 0.02;
  const MAX_DENSITY = 0.8;
  const STEP = 10;
  const entries = [];
  for (let input = 0; input <= 100; input += STEP) {
    const position = input / 100;
    const shaped = Math.max(0, Math.min(1, mapper(position)));
    const density = MIN_DENSITY + shaped * (MAX_DENSITY - MIN_DENSITY);
    const lab = densityToLstar(density);
    entries.push({ input, lab });
  }
  return entries;
}

function createChannelSamples(resolution, mapper) {
  const samples = new Array(resolution);
  for (let i = 0; i < resolution; i += 1) {
    const t = resolution > 1 ? i / (resolution - 1) : 0;
    samples[i] = Math.round(mapper(t));
  }
  return samples;
}

describe('simple scaling correction scaffolding', () => {
  test('configureSimpleScaling returns defaults merged with overrides', () => {
    const result = configureSimpleScaling({ clampMin: 0.9 });
    expect(result.clampMin).toBe(0.9);
    expect(result.clampMax).toBe(1.9);
    expect(result.resolution).toBe(256);
  });

  test('generateSimpleScalingGain keeps unity for already linear data', () => {
    const measurements = createMeasurementSet((position) => position);
    const result = generateSimpleScalingGain(measurements, {
      normalizationMode: LAB_NORMALIZATION_MODES.DENSITY
    });
    expect(result.samples).toHaveLength(256);
    const maxDeviation = Math.max(...result.samples.map((value) => Math.abs(1 - value)));
    expect(maxDeviation).toBeLessThan(0.05);
    expect(result.rawGain[0]).toBe(1);
    expect(result.rawGain[result.rawGain.length - 1]).toBe(1);
  });

  test('generateSimpleScalingGain boosts highlights when measurement is undershooting', () => {
    const measurements = createMeasurementSet((position) => position * 0.65);
    const result = generateSimpleScalingGain(measurements, {
      clampMax: 1.9,
      normalizationMode: LAB_NORMALIZATION_MODES.DENSITY
    });
    const highlightWindow = result.samples.slice(1, 80);
    const highlightMax = Math.max(...highlightWindow);
    expect(highlightMax).toBeGreaterThan(1);
    expect(highlightMax).toBeLessThanOrEqual(1.9);
  });

  test('generateSimpleScalingGain attenuates deep tones when measurement is overshooting', () => {
    const measurements = createMeasurementSet((position) => Math.min(1, position * 1.25 + 0.05));
    const result = generateSimpleScalingGain(measurements, {
      clampMin: 0.8,
      normalizationMode: LAB_NORMALIZATION_MODES.DENSITY
    });
    const shadowSample = result.samples[220]; // ≈86% input
    expect(shadowSample).toBeLessThan(1);
    expect(shadowSample).toBeGreaterThanOrEqual(0.8);
  });

  test('generateSimpleScalingGain reduces gain where measured density exceeds target (V6 dataset)', () => {
    const measurements = loadLabMeasurements('data/P800_K36C26LK25_V6.txt');
    const result = generateSimpleScalingGain(measurements, { clampMin: 0.8, clampMax: 1.9 });
    const startIndex = Math.round(0.6 * 255);
    const endIndex = Math.round(0.87 * 255);
    const window = result.samples.slice(startIndex, endIndex + 1);
    const minGain = Math.min(...window);
    expect(minGain).toBeLessThan(1);
  });

  test('applyGainToChannels redistributes overflow toward channels with capacity', () => {
    const channels = {
      K: {
        endValue: 52000,
        samples: [0, 12000, 26000, 36000]
      },
      C: {
        endValue: 18000,
        samples: [0, 8000, 14000, 17000]
      }
    };
    const gainCurve = [1, 1.2, 1.2, 1.2];
    const densityWeights = { K: 0.6, C: 0.2 };
    const result = applyGainToChannels({
      channels,
      gainCurve,
      densityWeights
    });
    const redistributed = result.channels.K.samples[3];
    expect(result.channels.C.samples[3]).toBeLessThanOrEqual(18000);
    expect(redistributed).toBeLessThanOrEqual(36000);
    expect(result.metadata.perChannelLift.K).toBe(0);
    expect(result.metadata.residualOverflow.some((value) => value > 0)).toBe(true);
  });

  test('applyGainToChannels allows controlled ceiling lift when enabled', () => {
    const channels = {
      C: {
        endValue: 20000,
        samples: [0, 12000, 18000, 19500]
      }
    };
    const gainCurve = [1, 1.15, 1.15, 1.15];
    const disabled = applyGainToChannels({
      channels,
      gainCurve,
      allowCeilingLift: false
    });
    const enabled = applyGainToChannels({
      channels,
      gainCurve,
      allowCeilingLift: true,
      maxLiftPercent: 0.05
    });
    expect(disabled.channels.C.samples[3]).toBeLessThanOrEqual(20000);
    expect(enabled.channels.C.endValue).toBeGreaterThanOrEqual(20000);
    expect(enabled.channels.C.samples[3]).toBeGreaterThan(disabled.channels.C.samples[3]);
  });

  test('applyGainToChannels caps per-sample increase to 25 percent and redistributes overflow', () => {
    const baseValue = 18000;
    const channels = {
      LK: {
        endValue: 20000,
        samples: [0, baseValue, baseValue, baseValue]
      },
      K: {
        endValue: 24000,
        samples: [0, 5000, 12000, 18000]
      }
    };
    const gainCurve = [1, 1.9, 1.9, 1.9];
    const result = applyGainToChannels({
      channels,
      gainCurve,
      allowCeilingLift: true,
      densityWeights: { LK: 0.4, K: 0.6 }
    });
  const cappedValue = Math.round(baseValue * 1.25);
  expect(result.channels.LK.samples[1]).toBeLessThanOrEqual(cappedValue);
  expect(result.metadata.residualOverflow[1]).toBeGreaterThan(0);
});

test('applyGainToChannels prevents K channel from exceeding baseline samples', () => {
  const channels = {
    K: {
      endValue: 52000,
      samples: [0, 8000, 20000, 36000]
    },
    LK: {
      endValue: 20000,
      samples: [0, 6000, 14000, 16000]
    }
  };
  const gainCurve = [1, 1.6, 1.8, 1.9];
  const result = applyGainToChannels({
    channels,
    gainCurve,
    allowCeilingLift: true,
    densityWeights: { LK: 0.4, K: 0.6 }
  });
  expect(result.channels.K.samples[1]).toBeLessThanOrEqual(8000);
  expect(result.channels.K.samples[2]).toBeLessThanOrEqual(20000);
  expect(result.channels.K.samples[3]).toBeLessThanOrEqual(36000);
  expect(result.metadata.perChannelLift.K).toBe(0);
});

  test('runSimpleScalingCorrection iterative pass reduces residual error profile', () => {
    const resolution = 32;
    const channels = {
      K: {
        endValue: 52000,
        samples: createChannelSamples(resolution, (t) => 52000 * t)
      },
      C: {
        endValue: 18000,
        samples: createChannelSamples(resolution, (t) => 18000 * Math.pow(t, 0.55))
      }
    };
    const measurements = createMeasurementSet((position) => position * 0.5);
    const result = runSimpleScalingCorrection({
      measurements,
      channels,
      densityWeights: { K: 0.6, C: 0.2 },
      options: {
        resolution,
        residualThreshold: 0,
        maxIterations: 2,
        residualIntensity: 0.5,
        allowCeilingLift: false
      }
    });
    expect(result.passes.length).toBeGreaterThan(1);
    const firstResidual = result.passes[0].residual.max;
    const finalResidual = result.metadata.residual.max;
    expect(finalResidual).toBeLessThanOrEqual(firstResidual);
  });

  test('runSimpleScalingCorrection supports blend percent output', () => {
    const resolution = 32;
    const channels = {
      K: {
        endValue: 52000,
        samples: createChannelSamples(resolution, (t) => 52000 * t)
      }
    };
    const measurements = createMeasurementSet((position) => position * 0.7);
    const result = runSimpleScalingCorrection({
      measurements,
      channels,
      options: {
        resolution,
        blendPercent: 50,
        maxIterations: 1
      }
    });
    expect(result.channels.K.samples).toHaveLength(resolution);
    expect(result.metadata.blendPercent).toBe(50);
  });
});
