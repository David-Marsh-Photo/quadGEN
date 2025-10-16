import { describe, it, expect } from 'vitest';
import { PROCESSING_CONSTANTS } from '../../src/js/core/processing-pipeline.js';

describe('Composite ladder capacity threshold [solver-overhaul-blend]', () => {
  it('exposes a 0.01% ladder blend capacity threshold for early hand-off', () => {
    expect(
      PROCESSING_CONSTANTS?.LADDER_BLEND_CAPACITY_THRESHOLD,
      'threshold constant should be defined for tests'
    ).toBeDefined();
    expect(
      PROCESSING_CONSTANTS.LADDER_BLEND_CAPACITY_THRESHOLD,
      'threshold should reflect the 0.01% normalized headroom cutoff'
    ).toBeCloseTo(0.0001, 9);
  });
});
