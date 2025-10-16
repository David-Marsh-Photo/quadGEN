import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach } from 'vitest';

import { parseACVFile } from '../../src/js/parsers/file-parsers.js';
import { apply1DLUT } from '../../src/js/core/processing-pipeline.js';
import { resetFeatureFlags } from '../../src/js/core/feature-flags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const MIDTONE_LIFT_ACV_PATH = path.resolve(ROOT, 'testdata', 'midtone_lift.acv');

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('.acv global correction', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  it('applies midtone_lift.acv to a default 0-100 ramp using the printer-space orientation', () => {
    const buffer = fs.readFileSync(MIDTONE_LIFT_ACV_PATH);
    const acv = parseACVFile(toArrayBuffer(buffer), 'midtone_lift.acv');

    expect(acv.valid).toBe(true);

    const ramp = Array.from({ length: 101 }, (_, index) => index);
    const result = apply1DLUT(
      ramp,
      acv,
      acv.domainMin,
      acv.domainMax,
      100,
      acv.interpolationType
    );

    // Canonical orientation keeps the samples in printer space (no second flip/invert).
    const expected = apply1DLUT(
      ramp,
      { ...acv, sourceSpace: 'printer' },
      acv.domainMin,
      acv.domainMax,
      100,
      acv.interpolationType
    );

    // Midpoint should lighten the ramp (less ink) for this ACV.
    expect(expected[50]).toBeLessThan(50);
    expect(result).toEqual(expected);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
  });
});
