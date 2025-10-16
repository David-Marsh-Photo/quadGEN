import { describe, it, expect } from 'vitest';
import {
  applySnapshotSlopeLimiter,
  syncSnapshotsWithSlopeLimiter,
} from '../../src/js/core/snapshot-slope-limiter.js';

function diffWithinThreshold(series, threshold) {
  for (let i = 1; i < series.length; i += 1) {
    const delta = Math.abs(series[i] - series[i - 1]);
    if (delta > threshold + 1e-5) {
      return false;
    }
  }
  return true;
}

describe('snapshot slope limiter', () => {
  it('limits steep rises by distributing the excess forward', () => {
    const endValue = 65535;
    const sampleCount = 64;
    const curveValues = [];
    for (let i = 0; i < sampleCount; i += 1) {
      let normalized;
      if (i < 24) {
        normalized = 0.02 + (i * 0.002);
      } else if (i === 24) {
        normalized = 0.12;
      } else if (i === 25) {
        normalized = 0.90;
      } else {
        normalized = 0.95;
      }
      curveValues.push(Math.round(normalized * endValue));
    }
    const curves = { K: curveValues };
    const normalized = applySnapshotSlopeLimiter(curves, {
      channelNames: ['K'],
      endValues: { K: endValue },
      thresholdPercent: 7,
    });
    expect(normalized.K).toBeDefined();
    expect(diffWithinThreshold(normalized.K, 0.07)).toBe(true);
    const lastNormalized = normalized.K.at(-1);
    expect(lastNormalized).toBeGreaterThan(0.90);
  });

  it('limits sharp drops while preserving the final endpoint', () => {
    const endValue = 65535;
    const sampleCount = 64;
    const curveValues = [];
    for (let i = 0; i < sampleCount; i += 1) {
      let normalized = 0.95;
      if (i >= sampleCount - 8 && i < sampleCount - 2) {
        normalized = 0.90;
      } else if (i >= sampleCount - 2) {
        normalized = 0.10;
      }
      curveValues.push(Math.round(normalized * endValue));
    }
    const curves = { K: curveValues };
    const normalized = applySnapshotSlopeLimiter(curves, {
      channelNames: ['K'],
      endValues: { K: endValue },
      thresholdPercent: 7,
    });
    expect(normalized.K).toBeDefined();
    expect(diffWithinThreshold(normalized.K, 0.07)).toBe(true);
    expect(Math.abs(normalized.K[normalized.K.length - 1] - 0.10)).toBeLessThan(1e-3);
  });

  it('syncs snapshot metadata after limiting', () => {
    const endValue = 1000;
    const normalizedSeries = { K: [0.1, 0.2] };
    const curves = { K: [100, 200] };
    const snapshots = [
      {
        index: 0,
        baselineInk: 90,
        correctedInk: 90,
        inkDelta: 0,
        perChannel: {
          K: {
            baselineValue: 90,
            correctedValue: 90,
            valueDelta: 0,
            normalizedBefore: 0.09,
            normalizedAfter: 0.09,
            normalizedDelta: 0,
            weight: 1,
            shareBefore: 1,
            shareAfter: 1,
            weightingShare: 1,
            densityShareBefore: 1,
            densityShareAfter: 1,
            headroomBefore: 0,
            headroomAfter: 0,
            densityContributionBefore: 0.09,
            densityContributionAfter: 0.09,
            densityContributionDelta: 0,
          },
        },
      },
      {
        index: 1,
        baselineInk: 95,
        correctedInk: 95,
        inkDelta: 0,
        perChannel: {
          K: {
            baselineValue: 95,
            correctedValue: 95,
            valueDelta: 0,
            normalizedBefore: 0.095,
            normalizedAfter: 0.095,
            normalizedDelta: 0,
            weight: 1,
            shareBefore: 1,
            shareAfter: 1,
            weightingShare: 1,
            densityShareBefore: 1,
            densityShareAfter: 1,
            headroomBefore: 0,
            headroomAfter: 0,
            densityContributionBefore: 0.095,
            densityContributionAfter: 0.095,
            densityContributionDelta: 0,
          },
        },
      },
    ];

    syncSnapshotsWithSlopeLimiter(snapshots, {
      channelNames: ['K'],
      normalizedSeriesByChannel: normalizedSeries,
      correctedCurves: curves,
      endValues: { K: endValue },
      densityWeights: new Map([['K', 1]]),
    });

    expect(snapshots[1].perChannel.K.normalizedAfter).toBeCloseTo(0.2, 6);
    expect(snapshots[1].perChannel.K.correctedValue).toBe(200);
    expect(snapshots[1].perChannel.K.shareAfter).toBeCloseTo(1, 6);
    expect(snapshots[1].inkDelta).toBe(105);
  });
});
