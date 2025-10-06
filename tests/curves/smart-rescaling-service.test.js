import { describe, it, expect, beforeEach } from 'vitest';

import {
  normalizeKeyPoints,
  reconcileBakedMetadata,
  rescaleKeyPointsForInkLimit
} from '../../src/js/curves/smart-rescaling-service.js';

function makePoints(...pairs) {
  return pairs.map(([input, output]) => ({ input, output }));
}

describe('smart-rescaling-service.normalizeKeyPoints', () => {
  it('clamps inputs/outputs to [0, 100] and sorts by input', () => {
    const raw = makePoints(
      [50, 42],
      [-20, -5],
      [120, 200],
      [15, 110]
    );

    const normalized = normalizeKeyPoints(raw);

    expect(normalized[0]).toEqual({ input: 0, output: 0 });
    expect(normalized.at(-1)).toEqual({ input: 100, output: 100 });
    for (let i = 1; i < normalized.length; i += 1) {
      expect(normalized[i].input).toBeGreaterThan(normalized[i - 1].input);
      expect(normalized[i].output).toBeGreaterThanOrEqual(0);
      expect(normalized[i].output).toBeLessThanOrEqual(100);
    }
  });

  it('removes duplicate points within tolerance', () => {
    const raw = makePoints(
      [0, 0],
      [25.0004, 25],
      [25.0009, 25.1],
      [50, 50],
      [75, 75],
      [75.005, 74.99],
      [100, 100]
    );

    const normalized = normalizeKeyPoints(raw);

    const duplicateInputs = normalized.filter((point) => point.input >= 25 && point.input <= 26);
    expect(duplicateInputs).toHaveLength(1);
    expect(normalized).toHaveLength(5);
  });

  it('handles non-array input safely', () => {
    expect(normalizeKeyPoints(null)).toEqual([]);
    expect(normalizeKeyPoints(undefined)).toEqual([]);
  });
});

describe('smart-rescaling-service.reconcileBakedMetadata', () => {
  it('returns shallow copy when scale unchanged', () => {
    const meta = { bakedGlobal: true, bakedAutoWhite: true, smartTouched: true };
    const next = reconcileBakedMetadata(meta, 1);

    expect(next).not.toBe(meta);
    expect(next).toEqual(meta);
  });

  it('clears baked auto flags when scale shifts more than 1%', () => {
    const meta = {
      bakedGlobal: true,
      bakedAutoWhite: true,
      bakedAutoBlack: true,
      bakedAutoLimit: true,
      smartTouched: true
    };

    const next = reconcileBakedMetadata(meta, 1.08);

    expect(next.bakedAutoWhite).toBeUndefined();
    expect(next.bakedAutoBlack).toBeUndefined();
    expect(next.bakedAutoLimit).toBe(false);
    expect(next.bakedGlobal).toBe(true);
  });

  it('preserves baked metadata when scale factor ~1', () => {
    const meta = {
      bakedGlobal: false,
      bakedAutoWhite: true,
      smartTouched: true
    };

    const next = reconcileBakedMetadata(meta, 1.005);

    expect(next.bakedAutoWhite).toBe(true);
    expect(next.bakedGlobal).toBe(false);
  });
});

describe('smart-rescaling-service.rescaleKeyPointsForInkLimit', () => {
  let basePoints;

  beforeEach(() => {
    basePoints = makePoints([0, 0], [30, 28], [60, 62], [100, 100]);
  });

  it('returns error for invalid inputs', () => {
    const result = rescaleKeyPointsForInkLimit('K', 100, 80, { points: null });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('respects preserveRelative mode', () => {
    const result = rescaleKeyPointsForInkLimit('K', 100, 50, {
      points: basePoints,
      mode: 'preserveRelative'
    });

    expect(result.success).toBe(true);
    expect(result.points).toEqual(basePoints);
    expect(result.scaleFactor).toBeCloseTo(0.5, 5);
  });

  it('rescale from 100 -> 50 halves stored outputs', () => {
    const result = rescaleKeyPointsForInkLimit('K', 100, 50, { points: basePoints });

    expect(result.success).toBe(true);
    const outputs = result.points.map((p) => p.output);
    expect(outputs).toEqual([0, 14, 31, 50]);
  });

  it('rescale from 50 -> 100 doubles stored outputs with clamp', () => {
    const points = makePoints([0, 0], [50, 60], [100, 90]);
    const result = rescaleKeyPointsForInkLimit('K', 50, 100, { points });

    expect(result.success).toBe(true);
    const outputs = result.points.map((p) => p.output);
    expect(outputs).toEqual([0, 100, 100]);
  });

  it('zero percent handling collapses outputs and warns', () => {
    const result = rescaleKeyPointsForInkLimit('K', 100, 0, { points: basePoints });

    expect(result.success).toBe(true);
    expect(result.points.every((p) => p.output === 0)).toBe(true);
    expect(result.warnings.some((w) => /zero/i.test(w))).toBe(true);
  });

  it('scale factor of 1 returns identical points', () => {
    const result = rescaleKeyPointsForInkLimit('K', 80, 80, {
      points: basePoints,
      metadata: { bakedGlobal: true }
    });

    expect(result.success).toBe(true);
    expect(result.points).toEqual(basePoints);
    expect(result.metadata.bakedGlobal).toBe(true);
  });

  it('endpoint values remain within 0.5% of channel percent', () => {
    const result = rescaleKeyPointsForInkLimit('K', 90, 60, { points: basePoints });

    expect(result.success).toBe(true);
    const lastPoint = result.points.at(-1);
    expect(lastPoint.input).toBe(100);
    const expected = basePoints.at(-1).output * (60 / 90);
    expect(lastPoint.output).toBeCloseTo(expected, 3);
  });

  it('floating point precision stays stable around 100%', () => {
    const closePoints = makePoints([0, 0], [100, 99.99999]);
    const result = rescaleKeyPointsForInkLimit('K', 99.99999, 100, { points: closePoints });

    expect(result.success).toBe(true);
    expect(result.points.at(-1).output).toBe(100);
  });

  it('large point arrays complete under 10ms', () => {
    const large = Array.from({ length: 256 }, (_, idx) => ({
      input: idx * (100 / 255),
      output: idx * (100 / 255)
    }));

    const start = performance.now();
    const result = rescaleKeyPointsForInkLimit('K', 100, 80, { points: large });
    const duration = performance.now() - start;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(10);
  });

  it('reports warnings when any point shifts more than 5%', () => {
    const points = makePoints([0, 0], [50, 80], [100, 100]);
    const result = rescaleKeyPointsForInkLimit('K', 100, 40, { points });

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('surfaces metadata reconciliation', () => {
    const meta = { bakedGlobal: true, bakedAutoWhite: true };
    const result = rescaleKeyPointsForInkLimit('K', 100, 99, { points: basePoints, metadata: meta });

    expect(result.success).toBe(true);
    expect(result.metadata.bakedGlobal).toBe(true);
    expect(result.metadata.bakedAutoWhite).toBe(true);
  });

  it('propagates reconcile changes when thresholds exceeded', () => {
    const meta = { bakedGlobal: false, bakedAutoWhite: true, bakedAutoBlack: true, bakedAutoLimit: true };
    const result = rescaleKeyPointsForInkLimit('K', 100, 70, { points: basePoints, metadata: meta });

    expect(result.success).toBe(true);
    expect(result.metadata.bakedAutoWhite).toBeUndefined();
    expect(result.metadata.bakedAutoBlack).toBeUndefined();
    expect(result.metadata.bakedAutoLimit).toBe(false);
  });

  it('integration-style: normalized outputs remain monotonic', () => {
    const jagged = makePoints([0, 0], [30, 45], [30.0004, 44], [60, 80], [90, 78], [100, 100]);
    const result = rescaleKeyPointsForInkLimit('K', 100, 120, { points: jagged });

    expect(result.success).toBe(true);
    const outputs = result.points.map((p) => p.output);
    for (let i = 1; i < outputs.length; i += 1) {
      expect(outputs[i]).toBeGreaterThanOrEqual(outputs[i - 1]);
    }
    expect(result.points[0].input).toBe(0);
    expect(result.points.at(-1).input).toBe(100);
  });
});
