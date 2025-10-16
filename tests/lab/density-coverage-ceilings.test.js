import { describe, expect, it } from 'vitest';

import { buildCoverageSummary } from '../../src/js/core/processing-pipeline.js';

describe('Density coverage summary', () => {
  it('builds coverage summary with normalized peaks when no clamps occur', () => {
    const coverageLimits = new Map([
      ['C', 0.2],
      ['K', 0.52]
    ]);
    const coverageBuffers = new Map([
      ['C', 0.005],
      ['K', 0.005]
    ]);
    const coverageThresholds = new Map([
      ['C', 0.205],
      ['K', 0.525]
    ]);
    const coverageUsage = new Map([
      ['C', 0.18],
      ['K', 0.49]
    ]);
    const coverageClampEvents = new Map();

    const { plain } = buildCoverageSummary(['C', 'K'], {
      coverageLimits,
      coverageBuffers,
      coverageThresholds,
      coverageUsage,
      coverageClampEvents
    });

    expect(plain.C.limit).toBeCloseTo(0.2, 6);
    expect(plain.C.buffer).toBeCloseTo(0.005, 6);
    expect(plain.C.maxNormalized).toBeCloseTo(0.18, 6);
    expect(plain.C.overflow).toBe(0);
    expect(plain.C.clampedSamples).toHaveLength(0);

    expect(plain.K.maxNormalized).toBeCloseTo(0.49, 6);
    expect(plain.K.bufferedLimit).toBeCloseTo(0.525, 6);
    expect(plain.K.overflowNormalized).toBe(0);
  });

  it('captures clamp metadata when normalized usage exceeds buffered limit', () => {
    const coverageLimits = new Map([
      ['C', 0.2]
    ]);
    const coverageBuffers = new Map([
      ['C', 0.005]
    ]);
    const coverageThresholds = new Map([
      ['C', 0.205]
    ]);
    const coverageUsage = new Map([
      ['C', 0.205]
    ]);
    const clampEvents = [
      {
        index: 84,
        inputPercent: 33.0,
        normalizedBefore: 0.19,
        normalizedAfter: 0.205,
        desiredNormalizedAfter: 0.22,
        overflowNormalized: 0.015,
        bufferedLimit: 0.205,
        limit: 0.2,
        truncatedByThreshold: true,
        truncatedByEnd: false
      }
    ];
    const coverageClampEvents = new Map([
      ['C', clampEvents]
    ]);

    const { plain } = buildCoverageSummary(['C'], {
      coverageLimits,
      coverageBuffers,
      coverageThresholds,
      coverageUsage,
      coverageClampEvents
    });

    expect(plain.C.maxNormalized).toBeCloseTo(0.205, 6);
    expect(plain.C.overflow).toBe(1);
    expect(plain.C.overflowNormalized).toBeCloseTo(0.015, 6);
    expect(plain.C.clampedSamples).toHaveLength(1);
    const [event] = plain.C.clampedSamples;
    expect(event.index).toBe(84);
    expect(event.inputPercent).toBeCloseTo(33.0, 3);
    expect(event.normalizedBefore).toBeCloseTo(0.19, 6);
    expect(event.normalizedAfter).toBeCloseTo(0.205, 6);
    expect(event.desiredNormalizedAfter).toBeCloseTo(0.22, 6);
    expect(event.truncatedByThreshold).toBe(true);
    expect(event.truncatedByEnd).toBe(false);
  });
});
