import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { applyBellWidthScale } from '../../src/js/core/bell-width-controller.js';
import { nudgeBellWidthSide } from '../../src/js/core/bell-width-controller.js';
import { setLoadedQuadData, getChannelShapeMeta, getLoadedQuadData } from '../../src/js/core/state.js';

if (typeof document === 'undefined') {
  global.document = {
    getElementById: () => null,
    querySelector: () => null
  };
}

if (typeof window === 'undefined') {
  global.window = {};
}

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

describe('bell-width-controller', () => {
  beforeEach(() => {
    setLoadedQuadData({
      curves: {
        K: makeBellSamples()
      },
      sources: {},
      bellCurveShift: {}
    });
  });

  afterEach(() => {
    setLoadedQuadData(null);
  });

  it('updates width scale metadata and curve when applying asymmetric scaling', () => {
    const result = applyBellWidthScale('K', { leftPercent: 120, rightPercent: 80, linked: false }, { silent: true });
    expect(result.success).toBe(true);

    const meta = getChannelShapeMeta('K');
    expect(meta?.bellWidthScale?.leftFactor).toBeGreaterThan(1.15);
    expect(meta?.bellWidthScale?.rightFactor).toBeLessThan(0.9);
  });

  it('nudging down decreases the linked width percent', () => {
    applyBellWidthScale('K', { leftPercent: 100, rightPercent: 100 }, { silent: true });
    const metaBefore = getChannelShapeMeta('K');
    expect(metaBefore?.bellWidthScale?.leftFactor ?? 1).toBeCloseTo(1, 3);

    const decResult = nudgeBellWidthSide('K', 'both', -2, { silent: true });
    expect(decResult.success).toBe(true);

    const afterDec = getChannelShapeMeta('K');
    expect(afterDec?.bellWidthScale?.leftFactor).toBeLessThan(1);

    const incResult = nudgeBellWidthSide('K', 'both', 2, { silent: true });
    expect(incResult.success).toBe(true);
    const afterInc = getChannelShapeMeta('K');
    expect(afterInc?.bellWidthScale?.leftFactor).toBeGreaterThan(afterDec?.bellWidthScale?.leftFactor ?? 0);
  });

  it('reset restores the baseline curve samples', () => {
    const baseline = getLoadedQuadData().curves.K.slice();
    applyBellWidthScale('K', { leftPercent: 130 }, { silent: true });
    const stretched = getLoadedQuadData().curves.K;
    expect(stretched).not.toEqual(baseline);

    applyBellWidthScale('K', { leftPercent: 100, rightPercent: 100 }, { silent: true });
    const resetCurve = getLoadedQuadData().curves.K;
    expect(resetCurve).toEqual(baseline);
  });
});
