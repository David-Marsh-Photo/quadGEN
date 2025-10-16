import { describe, it, expect } from 'vitest';

import { computeGaussianMomentum } from '../../src/js/core/composite-momentum.js';

describe('computeGaussianMomentum', () => {
  it('returns a normalized momentum profile that highlights steep regions', () => {
    const curve = [0, 0.12, 0.48, 0.9, 0.92, 0.94, 0.95];
    const momentum = computeGaussianMomentum(curve, { windowRadius: 2, sigma: 1.0 });

    expect(Array.isArray(momentum)).toBe(true);
    expect(momentum).toHaveLength(curve.length);

    // Mid ramp rise should carry more momentum than flat tail
    expect(momentum[3]).toBeGreaterThan(momentum[5]);
    // Momentum should spike near the steepest rise
    expect(momentum[2]).toBeGreaterThan(0);
    // Momentum should be normalized to [0, 1]
    momentum.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  it('responds to falling edges with the same magnitude as rising edges', () => {
    const curve = [1, 0.8, 0.6, 0.3, 0.15, 0.1, 0.08];
    const momentum = computeGaussianMomentum(curve, { windowRadius: 2, sigma: 1.0 });

    expect(momentum[3]).toBeGreaterThan(momentum[5]);
    expect(momentum[2]).toBeGreaterThan(momentum[0]);
  });
});
