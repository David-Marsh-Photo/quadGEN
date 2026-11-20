import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { rebuildLabSamplesFromOriginal } from '../../src/js/data/lab-parser.js';
import { buildInkInterpolatorFromMeasurements } from '../../src/js/data/lab-utils.js';
import {
  LAB_NORMALIZATION_MODES,
  setLabSmoothingPercent
} from '../../src/js/core/lab-settings.js';

const SAMPLE_DATA = [
  { input: 0, lab: 99.2 },
  { input: 12.5, lab: 90.1 },
  { input: 28, lab: 68.4 },
  { input: 47.5, lab: 52.9 },
  { input: 63, lab: 39.8 },
  { input: 81, lab: 27.6 },
  { input: 100, lab: 5.5 }
];

const DEFAULT_OPTIONS = {
  normalizationMode: LAB_NORMALIZATION_MODES.LSTAR
};

const maxAbsDelta = (a, b) => {
  const length = Math.min(a.length, b.length);
  let max = 0;
  for (let i = 0; i < length; i += 1) {
    const diff = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    if (diff > max) {
      max = diff;
    }
  }
  return max;
};

describe('LAB baseline smoothing', () => {
  beforeEach(() => {
    setLabSmoothingPercent(50);
  });

  afterEach(() => {
    setLabSmoothingPercent(0);
  });

  it('matches widen ×1 output for baseline reconstruction', () => {
    const baseline = rebuildLabSamplesFromOriginal(SAMPLE_DATA, {
      ...DEFAULT_OPTIONS,
      useBaselineWidenFactor: true
    });
    const widenOne = rebuildLabSamplesFromOriginal(SAMPLE_DATA, {
      ...DEFAULT_OPTIONS,
      widenFactor: 1
    });

    expect(baseline).toHaveLength(256);
    expect(widenOne).toHaveLength(256);
    expect(maxAbsDelta(baseline, widenOne)).toBeLessThan(1e-6);
  });
});

// 40-patch photogravure target with patches bunched at both ends. The 100%
// patch reads 0.12 L* lighter than 99.8%, which is ordinary meter noise.
const DENSE_END_TARGET = [
  [0, 94.46], [0.2, 94.44], [0.6, 94.29], [1.5, 94.09], [2.6, 93.14],
  [4, 90.51], [5.7, 86.52], [7.7, 80.14], [10, 77.29], [12.6, 75.92],
  [15.4, 75.1], [18.4, 72.12], [21.6, 70.45], [25, 69.37], [28.6, 67.05],
  [32.3, 64.46], [36.1, 62.21], [40, 60.58], [44, 59.43], [48, 58.02],
  [52, 57.83], [56, 56.3], [60, 53.64], [63.9, 52.92], [67.7, 50.8],
  [71.4, 49.24], [75, 47.51], [78.4, 45.6], [81.6, 44.25], [84.6, 41.35],
  [87.4, 38.28], [90, 36.02], [92.3, 34.51], [94.3, 31.59], [96, 28.54],
  [97.4, 26.59], [98.5, 23.66], [99.4, 22.56], [99.8, 21.84], [100, 21.96]
].map(([input, lab]) => ({ input, lab }));

describe('LAB smoothing at densely sampled ends', () => {
  const labs = DENSE_END_TARGET.map((point) => point.lab);
  const maxLab = Math.max(...labs);
  const span = maxLab - Math.min(...labs);
  const measured = (point) => (maxLab - point.lab) / span;
  // Patches within 1.5% of either end of the input range.
  const edgePatches = DENSE_END_TARGET.filter(
    (point) => point.input > 0 && point.input < 100 && (point.input <= 1.5 || point.input >= 98.5)
  );

  it.each([1, 2])('keeps edge patches within meter noise of their readings at widen ×%d', (widenFactor) => {
    const evaluator = buildInkInterpolatorFromMeasurements(DENSE_END_TARGET, {
      normalizationMode: LAB_NORMALIZATION_MODES.LSTAR,
      widenFactor
    }).evaluate;

    // 1% of the tonal range is about 0.7 L* on this print.
    for (const point of edgePatches) {
      expect(Math.abs(evaluator(point.input / 100) - measured(point)), `patch ${point.input}%`)
        .toBeLessThan(0.01);
    }
  });

  it('does not flatten the correction before the last patch', () => {
    const samples = rebuildLabSamplesFromOriginal(DENSE_END_TARGET, {
      ...DEFAULT_OPTIONS,
      useBaselineWidenFactor: true
    });

    // Readings keep darkening through 99.8%, so the inverse must still have
    // room to rise over the last 2% instead of saturating early.
    expect(1 - samples[250]).toBeGreaterThan(0.005);
  });
});
