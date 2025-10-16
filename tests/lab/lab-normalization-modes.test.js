import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { parseLabData } from '../../src/js/data/lab-parser.js';
import { LAB_NORMALIZATION_MODES, setLabNormalizationMode } from '../../src/js/core/lab-settings.js';

describe('LAB normalization modes', () => {
  it('produces distinct sample sets for L* and density modes', () => {
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');

    setLabNormalizationMode(LAB_NORMALIZATION_MODES.LSTAR);
    const lstarEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt', {
      normalizationMode: LAB_NORMALIZATION_MODES.LSTAR
    });

    setLabNormalizationMode(LAB_NORMALIZATION_MODES.DENSITY);
    const densityEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt', {
      normalizationMode: LAB_NORMALIZATION_MODES.DENSITY
    });

    expect(Array.isArray(lstarEntry?.samples)).toBe(true);
    expect(Array.isArray(densityEntry?.samples)).toBe(true);
    expect(lstarEntry.samples.length).toBe(256);
    expect(densityEntry.samples.length).toBe(256);

    const probeIndices = [32, 96, 160, 224];
    probeIndices.forEach((idx) => {
      const lstarSample = lstarEntry.samples[idx];
      const densitySample = densityEntry.samples[idx];
      expect(lstarSample).toBeGreaterThanOrEqual(0);
      expect(densitySample).toBeGreaterThanOrEqual(0);
      expect(lstarSample).toBeLessThanOrEqual(1);
      expect(densitySample).toBeLessThanOrEqual(1);
      expect(Math.abs(lstarSample - densitySample)).toBeGreaterThan(1e-3);
    });
  });
});
