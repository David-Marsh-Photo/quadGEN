import { describe, it, expect, beforeEach } from 'vitest';
import { parseCube1D } from '../../src/js/parsers/file-parsers.js';
import {
  resetFeatureFlags,
  isCubeEndpointAnchoringEnabled,
  setCubeEndpointAnchoringEnabled
} from '../../src/js/core/feature-flags.js';

const TWO_POINT_NEGATIVE_LUT = [
  'TITLE "Two-point LUT"',
  'LUT_1D_SIZE 2',
  '0.132080',
  '1.000000'
].join('\n');

describe('cube endpoint anchoring feature flag', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  it('keeps endpoints unclamped by default but allows opt-in clamping', () => {
    const baseline = parseCube1D(TWO_POINT_NEGATIVE_LUT, 'negative.cube');
    expect(isCubeEndpointAnchoringEnabled()).toBe(false);
    const baselineLast = baseline.samples[baseline.samples.length - 1];
    expect(baselineLast).toBeLessThan(1);
    expect(baselineLast).toBeCloseTo(0.86792, 5);

    setCubeEndpointAnchoringEnabled(true);
    const clamped = parseCube1D(TWO_POINT_NEGATIVE_LUT, 'negative.cube');
    expect(clamped.samples[0]).toBe(0);
    expect(clamped.samples[clamped.samples.length - 1]).toBe(1);

    setCubeEndpointAnchoringEnabled(false);
    const restored = parseCube1D(TWO_POINT_NEGATIVE_LUT, 'negative.cube');
    expect(restored.samples[restored.samples.length - 1]).toBeCloseTo(0.86792, 5);
  });
});
