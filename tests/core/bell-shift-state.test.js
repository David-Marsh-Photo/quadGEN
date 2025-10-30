import { describe, it, expect } from 'vitest';

import {
  ensureBellShiftContainer,
  syncBellShiftFromMeta
} from '../../src/js/core/bell-shift-state.js';

function makeMeta(overrides = {}) {
  return {
    classification: 'bell',
    apexInputPercent: 52.4,
    apexOutputPercent: 78.1,
    curveHash: 0xdeadbe,
    ...overrides
  };
}

describe('bell shift state width metadata', () => {
  it('initializes default width scale metadata when syncing', () => {
    const loaded = {};
    ensureBellShiftContainer(loaded);
    const result = syncBellShiftFromMeta(loaded, 'K', makeMeta());

    expect(result?.widthScale).toBeDefined();
    expect(result?.widthScale?.leftFactor).toBe(1);
    expect(result?.widthScale?.rightFactor).toBe(1);
    expect(result?.widthScale?.linked).toBe(true);
    expect(result?.widthScale?.baselineHash).toBe(makeMeta().curveHash);
  });

  it('retains width scale adjustments when the curve hash updates', () => {
    const loaded = {};
    ensureBellShiftContainer(loaded);
    syncBellShiftFromMeta(loaded, 'K', makeMeta({ curveHash: 101 }));

    expect(loaded.bellCurveShift?.K?.widthScale).toBeDefined();
    loaded.bellCurveShift.K.widthScale.leftFactor = 1.4;
    loaded.bellCurveShift.K.widthScale.rightFactor = 0.85;
    loaded.bellCurveShift.K.widthScale.linked = false;

    const result = syncBellShiftFromMeta(loaded, 'K', makeMeta({ curveHash: 202 }));
    expect(result?.widthScale?.leftFactor).toBeCloseTo(1.4);
    expect(result?.widthScale?.rightFactor).toBeCloseTo(0.85);
    expect(result?.widthScale?.linked).toBe(false);
    expect(result?.widthScale?.baselineHash).toBe(202);
  });
});
