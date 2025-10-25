import { beforeEach, describe, expect, it } from 'vitest';

import { applyGlobalLinearizationStep, make256 } from '../../src/js/core/processing-pipeline.js';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';
import { setCorrectionGain, appState, resetAppState } from '../../src/js/core/state.js';

const BASE_VALUES = [0, 32768, 65535];
const OPTIONS = {
  channelName: 'K',
  endValue: 65535,
  applyLinearization: true,
  interpolationType: 'linear',
  smoothingPercent: 0,
  smartApplied: false,
};

function createIdentityEntry() {
  return {
    domainMin: 0,
    domainMax: 1,
    samples: [0, 0.35, 0.7, 1],
  };
}

describe('applyGlobalLinearizationStep with correction gain', () => {
  beforeEach(() => {
    LinearizationState.clear();
    LinearizationState.setGlobalData(createIdentityEntry(), true);
    LinearizationState.setGlobalBaselineCurves({
      K: BASE_VALUES.slice()
    });
    setCorrectionGain(1, { persist: false });
    resetAppState();
  });

  it('returns fully corrected values when gain is 100%', () => {
    setCorrectionGain(1, { persist: false });
    const result = applyGlobalLinearizationStep(BASE_VALUES, OPTIONS);
    expect(result).not.toStrictEqual(BASE_VALUES);
  });

  it('returns baseline when gain is 0%', () => {
    setCorrectionGain(0, { persist: false });
    const result = applyGlobalLinearizationStep(BASE_VALUES, OPTIONS);
    expect(result).toStrictEqual(BASE_VALUES);
  });

  it('blends linearly for partial gains', () => {
    setCorrectionGain(1, { persist: false });
    const corrected = applyGlobalLinearizationStep(BASE_VALUES, OPTIONS);

    LinearizationState.setGlobalBaselineCurves({
      K: BASE_VALUES.slice()
    });

    setCorrectionGain(0.5, { persist: false });
    const blended = applyGlobalLinearizationStep(BASE_VALUES, OPTIONS);

    const expected = corrected.map((value, index) => {
      const base = BASE_VALUES[index];
      return Math.round(base + (value - base) * 0.5);
    });

    expect(blended).toStrictEqual(expected);
  });

  it('respects stored baseline even if input values are already corrected', () => {
    setCorrectionGain(1, { persist: false });
    const corrected = applyGlobalLinearizationStep(BASE_VALUES, OPTIONS);
    expect(corrected).not.toStrictEqual(BASE_VALUES);

    LinearizationState.setGlobalBaselineCurves({
      K: BASE_VALUES.slice()
    });

    setCorrectionGain(0, { persist: false });
    const blended = applyGlobalLinearizationStep(corrected, OPTIONS);

    expect(blended).toStrictEqual(BASE_VALUES);
  });

  it('updates cached corrected curves when gain changes', () => {
    const baselineCurve = BASE_VALUES.slice();
    const correctedCurve = [0, 34406, 65535];

    LinearizationState.setGlobalBaselineCurves({
      K: baselineCurve.slice()
    });
    LinearizationState.setGlobalCorrectedCurves({
      K: correctedCurve.slice()
    });

    LinearizationState.refreshMeasurementCorrectionsForGain(0);

    const adjusted = LinearizationState.getGlobalCorrectedCurves();
    expect(adjusted).toBeTruthy();
    expect(Array.isArray(adjusted?.K)).toBe(true);
    expect(adjusted.K).toStrictEqual(baselineCurve);
  });

  it('recomputes make256 output when gain is reduced', () => {
    const ramp = new Array(256).fill(0).map((_, index) => Math.round((index / 255) * 65535));
    const corrected = ramp.map((value, index) => Math.min(65535, value + index * 64));
    const normalizedSamples = corrected.map((value) => Math.max(0, Math.min(1, value / 65535)));

    appState.loadedQuadData = {
      curves: { K: corrected.slice() },
      plotBaseCurves: { K: corrected.slice() },
      baselineEnd: { K: 65535 },
      sources: {},
      normalizeToEndChannels: {}
    };

    LinearizationState.setGlobalData({
      format: 'LAB',
      samples: normalizedSamples
    }, true);
    LinearizationState.setGlobalBaselineCurves({
      K: ramp.slice()
    });
    LinearizationState.setGlobalCorrectedCurves({
      K: corrected.slice()
    });
    LinearizationState.globalApplied = true;

    setCorrectionGain(1, { persist: false });
    const fullGain = make256(65535, 'K', true);
    expect(fullGain[128]).toBeGreaterThan(ramp[128]);

    setCorrectionGain(0, { persist: false });
    LinearizationState.refreshMeasurementCorrectionsForGain(0);
    const zeroGain = make256(65535, 'K', true);

    expect(zeroGain).toStrictEqual(ramp);
  });

  it('ignores legacy bakedGlobal metadata when a live correction is applied', () => {
    appState.loadedQuadData = {
      keyPointsMeta: {
        K: { bakedGlobal: true }
      }
    };

    setCorrectionGain(1, { persist: false });
    const result = applyGlobalLinearizationStep(BASE_VALUES, OPTIONS);
    expect(result).not.toStrictEqual(BASE_VALUES);
  });
});
