import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseLabData,
  applyDefaultLabSmoothingToEntry,
  rebuildLabSamplesFromOriginal
} from '../../src/js/data/lab-parser.js';
import { buildInkInterpolatorFromMeasurements } from '../../src/js/data/lab-utils.js';
import { LAB_NORMALIZATION_MODES } from '../../src/js/core/lab-settings.js';

const LSTAR = { normalizationMode: LAB_NORMALIZATION_MODES.LSTAR };

function loadReadings(relativePath) {
  const text = fs.readFileSync(path.resolve(relativePath), 'utf8');
  return parseLabData(text, path.basename(relativePath), LSTAR);
}

function interpolate(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i += 1) {
    if (x <= xs[i + 1]) {
      const span = xs[i + 1] - xs[i];
      const t = span > 0 ? (x - xs[i]) / span : 0;
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[ys.length - 1];
}

// Uses the measurement as a model of the print. A correction sends target
// input t to printed input g(t), so the corrected print lands at the L* that
// was measured at g(t). Returns the worst gap from a linear L* ramp.
function worstPredictedError(entry, samples) {
  const points = entry.originalData.slice().sort((a, b) => a.input - b.input);
  const inputs = points.map((p) => p.input);
  const readings = points.map((p) => p.lab);
  const paper = Math.max(...readings);
  const black = Math.min(...readings);

  let worst = { error: 0, input: 0 };
  samples.forEach((g, i) => {
    const t = i / (samples.length - 1);
    const predicted = interpolate(inputs, readings, g * 100);
    const error = predicted - (paper - t * (paper - black));
    if (Math.abs(error) > Math.abs(worst.error)) {
      worst = { error, input: t * 100 };
    }
  });
  return worst;
}

const GRAVURE = 'testdata/gravure-40patch-v1-lab.txt';
const INKJET = 'data/P800_K35_1440S_V2.txt';
// Five patches 25% apart with a real S-shape: curvature must not be read as noise.
const SPARSE = 'testdata/Manual-LAB-Data.txt';

describe('predicted print from a measurement correction', () => {
  it.each([GRAVURE, INKJET])('the unsmoothed inverse lands on target for %s', (file) => {
    const entry = loadReadings(file);
    const raw = rebuildLabSamplesFromOriginal(entry.originalData, {
      ...LSTAR,
      skipDefaultSmoothing: true
    });

    expect(Math.abs(worstPredictedError(entry, raw).error)).toBeLessThan(0.5);
  });

  // Smoothing may only ignore differences the reading noise can explain. The old
  // Gaussian window missed by 5.7 L* (gravure) and 2.8 L* (inkjet).
  it.each([GRAVURE, INKJET])('default smoothing lands within the noise band for %s', (file) => {
    const entry = applyDefaultLabSmoothingToEntry(loadReadings(file), LSTAR);
    const { noiseBand } = buildInkInterpolatorFromMeasurements(entry.originalData, LSTAR);

    expect(noiseBand).toBeLessThan(1.5);
    expect(Math.abs(worstPredictedError(entry, entry.samples).error)).toBeLessThanOrEqual(noiseBand + 0.1);
  });

  // With patches far apart, curvature between neighbours must not be read as
  // noise: an estimate of ~6 L* straightened this S-shape into no correction.
  // Between widely spaced patches PCHIP and the straight-line model differ, so
  // the bound is looser than the noise band.
  it('a sparse target keeps its correction', () => {
    const entry = applyDefaultLabSmoothingToEntry(loadReadings(SPARSE), LSTAR);
    const { noiseBand } = buildInkInterpolatorFromMeasurements(entry.originalData, LSTAR);

    expect(noiseBand).toBeLessThan(1);
    expect(Math.abs(worstPredictedError(entry, entry.samples).error)).toBeLessThan(1);
  });
});
