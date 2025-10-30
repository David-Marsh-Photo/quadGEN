import { describe, it, expect } from 'vitest';

import { scaleBellCurve } from '../../src/js/core/bell-width-scale.js';

function makeBellSamples(apexIndex = 132, width = 28, amplitude = 0.92) {
  const length = 256;
  const samples = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const distance = (i - apexIndex) / width;
    const gaussian = Math.exp(-(distance * distance));
    samples[i] = Math.round(gaussian * amplitude * 65535);
  }
  samples[0] = 0;
  samples[length - 1] = 0;
  return samples;
}

function findHalfIndex(samples, apexIndex, side) {
  const apexValue = samples[apexIndex] || 0;
  const threshold = apexValue * 0.5;
  if (side === 'left') {
    for (let i = apexIndex; i >= 0; i -= 1) {
      if (samples[i] <= threshold) {
        return i;
      }
    }
    return 0;
  }
  for (let i = apexIndex; i < samples.length; i += 1) {
    if (samples[i] <= threshold) {
      return i;
    }
  }
  return samples.length - 1;
}

const options = {
  leftSpanSamples: 40,
  rightSpanSamples: 40
};

describe('scaleBellCurve', () => {
  it('returns identical samples when both factors equal 1', () => {
    const samples = makeBellSamples();
    const scaled = scaleBellCurve(samples, 132, { leftFactor: 1, rightFactor: 1 }, options);

    expect(scaled).toEqual(samples);
  });

  it('widens the left slope when leftFactor > 1', () => {
    const samples = makeBellSamples();
    const baseHalf = findHalfIndex(samples, 132, 'left');
    const scaled = scaleBellCurve(samples, 132, { leftFactor: 1.6, rightFactor: 1 }, options);
    const scaledHalf = findHalfIndex(scaled, 132, 'left');

    expect(scaledHalf).toBeLessThan(baseHalf - 1);
    expect(scaled[132]).toBe(samples[132]);
    expect(scaled[0]).toBe(samples[0]);
  });

  it('tightens the right slope when rightFactor < 1', () => {
    const samples = makeBellSamples();
    const baseHalf = findHalfIndex(samples, 132, 'right');
    const scaled = scaleBellCurve(samples, 132, { leftFactor: 1, rightFactor: 0.6 }, options);
    const scaledHalf = findHalfIndex(scaled, 132, 'right');

    expect(scaledHalf).toBeLessThan(baseHalf);
    expect(scaled[132]).toBe(samples[132]);
    expect(scaled[255]).toBe(samples[255]);
  });
});
