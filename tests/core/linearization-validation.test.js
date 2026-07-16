import { describe, expect, it } from 'vitest';

import { validateLinearizationData } from '../../src/js/data/linearization-utils.js';

const VALID_ENTRY = {
  valid: true,
  samples: [0, 1],
  domainMin: 0,
  domainMax: 1,
  sourceSpace: 'printer',
};

describe('linearization import validation', () => {
  it('accepts a finite two-sample correction with an ordered domain', () => {
    expect(validateLinearizationData(VALID_ENTRY)).toMatchObject({ valid: true });
  });

  it('rejects parser failures and unsafe sample or domain shapes', () => {
    const cases = [
      [{ ...VALID_ENTRY, valid: false, error: 'Parser rejected fixture' }, /parser rejected fixture/i],
      [{ ...VALID_ENTRY, samples: [] }, /at least two/i],
      [{ ...VALID_ENTRY, samples: [0] }, /at least two/i],
      [{ ...VALID_ENTRY, samples: [0, Number.NaN] }, /invalid sample/i],
      [{ ...VALID_ENTRY, domainMin: Number.NaN }, /finite numbers/i],
      [{ ...VALID_ENTRY, domainMax: Number.POSITIVE_INFINITY }, /finite numbers/i],
      [{ ...VALID_ENTRY, domainMin: 1, domainMax: 0 }, /less than/i],
      [{ ...VALID_ENTRY, sourceSpace: 'unknown-space' }, /sourceSpace/i],
    ];

    cases.forEach(([entry, expectedMessage]) => {
      const result = validateLinearizationData(entry);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(expectedMessage);
    });
  });
});
