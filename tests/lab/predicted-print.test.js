import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseLabData,
  applyDefaultLabSmoothingToEntry,
  rebuildLabSamplesFromOriginal
} from '../../src/js/data/lab-parser.js';
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

describe('predicted print from a measurement correction', () => {
  it.each([GRAVURE, INKJET])('the unsmoothed inverse lands on target for %s', (file) => {
    const entry = loadReadings(file);
    const raw = rebuildLabSamplesFromOriginal(entry.originalData, {
      ...LSTAR,
      skipDefaultSmoothing: true
    });

    expect(Math.abs(worstPredictedError(entry, raw).error)).toBeLessThan(0.5);
  });

  // Known defect: the default smoothing window (up to 15% of the input range)
  // flattens real response shape, leaving 3-6 L* of error. Flip to `it.each`
  // once smoothing is bounded by meter noise.
  it.fails.each([GRAVURE, INKJET])('default smoothing lands within 1 L* of target for %s', (file) => {
    const entry = applyDefaultLabSmoothingToEntry(loadReadings(file), LSTAR);

    expect(Math.abs(worstPredictedError(entry, entry.samples).error)).toBeLessThan(1);
  });
});
