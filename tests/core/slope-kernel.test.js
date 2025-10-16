import { describe, it, expect } from 'vitest';
import { applySnapshotSlopeKernel } from '../../src/js/core/snapshot-slope-kernel.js';

function toNormalized(curve, endValue) {
  return curve.map((value) => (endValue > 0 ? value / endValue : 0));
}

function computeDeltas(series) {
  const deltas = [];
  for (let i = 1; i < series.length; i += 1) {
    deltas.push(series[i] - series[i - 1]);
  }
  return deltas;
}

describe('snapshot slope kernel smoother', () => {
  it('reshapes a sharp drop into a curved slope while preserving endpoints', () => {
    const endValue = 1000;
    const originalNormalized = [
      0.95, 0.945, 0.94, 0.935,
      0.93, 0.925, 0.92, 0.915,
      0.3, 0.2, 0.12, 0.08,
      0.06, 0.05, 0.04, 0.03,
    ];
    const rawCurve = originalNormalized.map((value) => Math.round(value * endValue));
    const curves = { K: rawCurve.slice() };

    const result = applySnapshotSlopeKernel(curves, {
      channelNames: ['K'],
      endValues: { K: endValue },
      thresholdPercent: 7,
    });

    expect(result).toBeDefined();
    expect(result.appliedChannels).toContain('K');
    expect(result.channelsNeedingLimiter).not.toContain('K');
    const normalized = result.normalizedSeriesByChannel.K;
    expect(Math.abs(normalized[0] - originalNormalized[0])).toBeLessThan(0.015);
    expect(Math.abs(normalized.at(-1) - originalNormalized.at(-1))).toBeLessThan(0.015);

    const deltas = computeDeltas(normalized);
    const absDeltas = deltas.map((delta) => Math.abs(delta));
    const maxDelta = absDeltas.reduce((max, delta) => Math.max(max, delta), 0);
    expect(maxDelta).toBeLessThan(0.07 + 1e-5);
    expect(absDeltas[0]).toBeLessThan(0.06);
    expect(absDeltas.at(-1)).toBeLessThan(0.055);
    const avgEarly = (absDeltas[0] + absDeltas[1] + absDeltas[2]) / 3;
    const avgLate = (absDeltas.at(-1) + absDeltas.at(-2) + absDeltas.at(-3)) / 3;
    expect(avgLate).toBeLessThan(0.06);
  });

  it('respects locked samples flagged via debug snapshots', () => {
    const endValue = 1000;
    const originalNormalized = [
      0.95, 0.945, 0.94, 0.935,
      0.3, 0.2, 0.12, 0.08,
      0.06, 0.05, 0.04, 0.03,
    ];
    const rawCurve = originalNormalized.map((value) => Math.round(value * endValue));
    const curves = { K: rawCurve.slice() };
    const debugSnapshots = originalNormalized.map((value, index) => ({
      index,
      perChannel: {
        K: {
          normalizedAfter: value,
          blendLimited: index >= 4 && index <= 8,
          reserveState: 'exhausted',
        },
      },
    }));

    const result = applySnapshotSlopeKernel(curves, {
      channelNames: ['K'],
      endValues: { K: endValue },
      thresholdPercent: 7,
      debugSnapshots,
    });

    expect(result).toBeDefined();
    expect(result.appliedChannels).not.toContain('K');
    expect(result.channelsNeedingLimiter).toContain('K');
    const normalized = toNormalized(curves.K, endValue);
    const deltas = computeDeltas(normalized);
    const sharpDelta = Math.abs(deltas[4]);
    expect(sharpDelta).toBeGreaterThan(0.07);
  });
});
