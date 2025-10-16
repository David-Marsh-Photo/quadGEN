import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach } from 'vitest';

import { parseQuadFile, parseCube1D } from '../../src/js/parsers/file-parsers.js';
import { apply1DLUT } from '../../src/js/core/processing-pipeline.js';
import {
  resetFeatureFlags,
  setCubeEndpointAnchoringEnabled
} from '../../src/js/core/feature-flags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const MASTER_PATH = path.resolve(ROOT, 'data', 'master.quad');
const NEGATIVE_CUBE_PATH = path.resolve(ROOT, 'data', 'negative.cube');
const NEGATIVE_PERCENT_CUBE_PATH = path.resolve(
  ROOT,
  'testdata',
  'NegativeDensityRangeCorrection.cube'
);
const IMAGE_ADJUSTMENT_CUBE_PATH = path.resolve(
  ROOT,
  'testdata',
  'ImageAdjustment.cube'
);

function loadText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('global LUT application', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  it('scales master.quad curves when negative.cube is applied with unclamped endpoints', () => {
    const quadText = loadText(MASTER_PATH);
    const cubeText = loadText(NEGATIVE_CUBE_PATH);

    const quad = parseQuadFile(quadText);
    expect(quad.valid).toBe(true);

    const cube = parseCube1D(cubeText, 'negative.cube');
    expect(cube.valid).toBe(true);

    const kCurve = quad.curves['K'];
    const kEnd = quad.baselineEnd['K'];

    const scaled = apply1DLUT(kCurve, cube, cube.domainMin, cube.domainMax, kEnd, cube.interpolationType);
    const maxOriginal = Math.max(...kCurve);
    const maxScaled = Math.max(...scaled);

    expect(maxScaled).toBeLessThan(maxOriginal);
    expect(maxScaled / maxOriginal).toBeCloseTo(0.86792, 4);
  });

  it('returns to the legacy behavior when cube endpoint anchoring is enabled', () => {
    const quadText = loadText(MASTER_PATH);
    const cubeText = loadText(NEGATIVE_CUBE_PATH);

    const quad = parseQuadFile(quadText);
    const cube = parseCube1D(cubeText, 'negative.cube');

    const kCurve = quad.curves['K'];
    const kEnd = quad.baselineEnd['K'];
    const maxOriginal = Math.max(...kCurve);

    setCubeEndpointAnchoringEnabled(true);
    const clamped = apply1DLUT(kCurve, cube, cube.domainMin, cube.domainMax, kEnd, cube.interpolationType);

    expect(Math.max(...clamped)).toBe(maxOriginal);
  });

  it('applies a 1D LUT to a default 0-100 ramp using printer-space orientation', () => {
    const cubeText = loadText(NEGATIVE_PERCENT_CUBE_PATH);
    const cube = parseCube1D(cubeText, 'NegativeDensityRangeCorrection.cube');
    expect(cube.valid).toBe(true);

    const ramp = Array.from({ length: 101 }, (_, index) => index);
    const result = apply1DLUT(
      ramp,
      cube,
      cube.domainMin,
      cube.domainMax,
      100,
      cube.interpolationType
    );

    expect(result.length).toBe(ramp.length);
    expect(result[0]).toBe(0);

    const expectedFactor = cube.samples[cube.samples.length - 1];
    expect(expectedFactor).toBeGreaterThan(0);
    expect(expectedFactor).toBeLessThan(1);

    const expected = ramp.map(value => Math.round(value * expectedFactor));
    expect(result).toEqual(expected);
  });

  it('keeps the applied curve monotonic when LUT samples are monotonic', () => {
    const cubeText = loadText(IMAGE_ADJUSTMENT_CUBE_PATH);
    const cube = parseCube1D(cubeText, 'ImageAdjustment.cube');
    expect(cube.valid).toBe(true);

    const ramp = Array.from({ length: 101 }, (_, index) => index);
    const result = apply1DLUT(
      ramp,
      cube,
      cube.domainMin,
      cube.domainMax,
      100,
      cube.interpolationType
    );

    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
  });
});
