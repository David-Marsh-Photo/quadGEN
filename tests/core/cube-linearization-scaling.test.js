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
});
