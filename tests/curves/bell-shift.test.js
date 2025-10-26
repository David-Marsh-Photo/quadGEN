import { describe, it, expect } from 'vitest';
import { shiftBellCurve } from '../../src/js/core/bell-shift.js';

/**
 * Generate a simple bell-shaped curve with controllable apex and width.
 * Samples are scaled to 0..65535 so we can validate endpoint handling.
 */
function makeBellSamples(apexIndex = 128, width = 28, amplitude = 0.9) {
  const length = 256;
  const samples = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const distance = (i - apexIndex) / width;
    const gaussian = Math.exp(-distance * distance);
    const normalized = amplitude * gaussian;
    samples[i] = Math.round(normalized * 65535);
  }
  samples[0] = 0;
  samples[length - 1] = 0;
  return samples;
}

describe('shiftBellCurve', () => {
  it('returns identical samples when offset is 0', () => {
    const samples = makeBellSamples();
    const shifted = shiftBellCurve(samples, 128, 0);

    expect(shifted).toEqual(samples);
  });

  it('shifts apex left when offset negative and preserves endpoints', () => {
    const samples = makeBellSamples(140);
    const shifted = shiftBellCurve(samples, 140, -12);

    expect(shifted[0]).toBe(0);
    expect(shifted[255]).toBe(0);
    const peakIndex = shifted.reduce(
      (idx, value, index, arr) => (value > arr[idx] ? index : idx),
      0
    );
    expect(peakIndex).toBeLessThan(140);
    expect(140 - peakIndex).toBeGreaterThan(5);
  });

  it('clamps large offsets so the apex stays within the sample range', () => {
    const samples = makeBellSamples(30);
    const shifted = shiftBellCurve(samples, 30, -80);

    const peakIndex = shifted.reduce(
      (idx, value, index, arr) => (value > arr[idx] ? index : idx),
      0
    );
    expect(peakIndex).toBeGreaterThanOrEqual(0);
    expect(peakIndex).toBeLessThanOrEqual(20);
  });
});
