import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { rebuildLabSamplesFromOriginal } from '../../src/js/data/lab-parser.js';
import {
  LAB_NORMALIZATION_MODES,
  setLabSmoothingPercent,
  getLabWidenFactor
} from '../../src/js/core/lab-settings.js';
import {
  setLabBaselineSmoothingEnabled,
  resetFeatureFlags
} from '../../src/js/core/feature-flags.js';

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

describe('LAB baseline smoothing flag', () => {
  beforeEach(() => {
    setLabSmoothingPercent(50);
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  it('matches widen ×1 output when legacy baseline smoothing flag is enabled', () => {
    setLabBaselineSmoothingEnabled(true);
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

  it('falls back to configured smoothing widen factor when flag is disabled', () => {
    setLabBaselineSmoothingEnabled(false);
    const baseline = rebuildLabSamplesFromOriginal(SAMPLE_DATA, DEFAULT_OPTIONS);
    const configuredWiden = getLabWidenFactor();
    const widenDefault = rebuildLabSamplesFromOriginal(SAMPLE_DATA, {
      ...DEFAULT_OPTIONS,
      widenFactor: configuredWiden
    });

    expect(baseline).toHaveLength(256);
    expect(widenDefault).toHaveLength(256);
    expect(maxAbsDelta(baseline, widenDefault)).toBeLessThan(1e-6);

    const widenOne = rebuildLabSamplesFromOriginal(SAMPLE_DATA, {
      ...DEFAULT_OPTIONS,
      widenFactor: 1
    });
    expect(maxAbsDelta(baseline, widenOne)).toBeGreaterThan(1e-4);
  });
});
