import { describe, it, expect } from 'vitest';

import { classifyCurve, CurveShapeClassification } from '../../src/js/data/curve-shape-detector.js';

const MAX = 65535;

function toSamples(values) {
  return values.map((v) => Math.round(Math.max(0, Math.min(1, v)) * MAX));
}

describe('curve shape detector', () => {
  it('flags a bell profile with midtone apex', () => {
    const base = [];
    for (let i = 0; i < 64; i += 1) {
      base.push(i / 128); // slow rise
    }
    for (let i = 0; i < 64; i += 1) {
      base.push(0.5 + (i / 128)); // ramp to apex 1.0
    }
    for (let i = 0; i < 128; i += 1) {
      base.push(Math.max(0, 1 - (i / 128))); // fall back down
    }
    const samples = toSamples(base);
    const meta = classifyCurve(samples);
    expect(meta.classification).toBe(CurveShapeClassification.BELL);
    expect(meta.confidence).toBeGreaterThan(0.5);
    expect(meta.peakIndex).toBeGreaterThan(60);
    expect(meta.peakIndex).toBeLessThan(200);
  });

  it('detects monotonic ramps with small noise as monotonic', () => {
    const ramp = new Array(256).fill(0).map((_, index) => {
      const base = index / 255;
      const wobble = (Math.sin(index / 10) * 0.002);
      return Math.max(0, Math.min(1, base + wobble));
    });
    const samples = toSamples(ramp);
    const meta = classifyCurve(samples);
    expect(meta.classification).toBe(CurveShapeClassification.MONOTONIC);
    expect(meta.confidence).toBeGreaterThan(0.8);
    expect(meta.startValue).toBeLessThan(meta.endValue);
  });

  it('labels nearly flat curves as flat', () => {
    const flat = new Array(256).fill(0.02);
    const samples = toSamples(flat);
    const meta = classifyCurve(samples);
    expect(meta.classification).toBe(CurveShapeClassification.FLAT);
    expect(meta.peakValue).toBeLessThan(0.03 * MAX);
  });

  it('reports left/right apex span metadata and a curve hash for bell curves', () => {
    const gaussian = [];
    for (let i = 0; i < 256; i += 1) {
      const distance = (i - 132) / (i < 132 ? 24 : 32);
      const value = Math.exp(-(distance * distance)) * 0.9;
      gaussian.push(value);
    }
    const samples = toSamples(gaussian);
    const meta = classifyCurve(samples);
    expect(meta.classification).toBe(CurveShapeClassification.BELL);
    expect(meta.apexSpanLeftPercent).toBeGreaterThan(0);
    expect(meta.apexSpanRightPercent).toBeGreaterThan(0);
    expect(meta.apexSpanLeftPercent).not.toBe(meta.apexSpanRightPercent);
    expect(meta.curveHash).toBeGreaterThan(0);
  });
});
