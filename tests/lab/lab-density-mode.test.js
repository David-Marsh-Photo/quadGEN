import { describe, it, expect } from 'vitest';

import { buildInkInterpolatorFromMeasurements } from '../../src/js/data/lab-utils.js';
import { cieDensityFromLstar } from '../../src/js/data/lab-parser.js';
import { setLabNormalizationMode, getLabNormalizationMode, LAB_NORMALIZATION_MODES } from '../../src/js/core/lab-settings.js';

function normalizeDensities(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  return values.map((value) => (value - min) / span);
}

describe('LAB normalization modes', () => {
  it('normalizes measured data using CIE density', () => {
    const initialMode = getLabNormalizationMode();
    try {
      setLabNormalizationMode(LAB_NORMALIZATION_MODES.DENSITY);

      const points = [
      { input: 0, lab: 96.2 },
      { input: 50, lab: 70.4 },
      { input: 100, lab: 12.5 }
    ];

    const helper = buildInkInterpolatorFromMeasurements(points, {
      neighbors: 1,
      sigmaFloor: 1e-6,
      sigmaCeil: 1e-6,
      sigmaAlpha: 1e-6
    });

    const measuredEvaluator = helper.createEvaluator(1);

    const densities = normalizeDensities(points.map((point) => cieDensityFromLstar(point.lab)));

    expect(measuredEvaluator(0)).toBeCloseTo(densities[0], 6);
    expect(measuredEvaluator(0.5)).toBeCloseTo(densities[1], 4);
    expect(measuredEvaluator(1)).toBeCloseTo(densities[2], 6);
    } finally {
      setLabNormalizationMode(initialMode);
    }
  });

  it('falls back to L* normalization when density mode is disabled', () => {
    const initialMode = getLabNormalizationMode();
    try {
      setLabNormalizationMode(LAB_NORMALIZATION_MODES.LSTAR);

      const points = [
      { input: 0, lab: 96.2 },
      { input: 50, lab: 70.4 },
      { input: 100, lab: 12.5 }
    ];

    const helper = buildInkInterpolatorFromMeasurements(points, {
      neighbors: 1,
      sigmaFloor: 1e-6,
      sigmaCeil: 1e-6,
      sigmaAlpha: 1e-6
    });

    const measuredEvaluator = helper.createEvaluator(1);

    const maxLab = Math.max(...points.map((p) => p.lab));
    const minLab = Math.min(...points.map((p) => p.lab));
    const span = Math.max(1e-6, maxLab - minLab);
    const normalizedLstar = points.map((point) => (maxLab - point.lab) / span);

    expect(measuredEvaluator(0)).toBeCloseTo(normalizedLstar[0], 6);
    expect(measuredEvaluator(0.5)).toBeCloseTo(normalizedLstar[1], 6);
    expect(measuredEvaluator(1)).toBeCloseTo(normalizedLstar[2], 6);
    } finally {
      setLabNormalizationMode(initialMode);
    }
  });
});
