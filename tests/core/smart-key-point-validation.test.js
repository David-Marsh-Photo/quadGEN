/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { validateKeyPoints } from '../../src/js/curves/smart-curves.js';

describe('validateKeyPoints', () => {
  it('accepts relative outputs above 100 (End above the rounded Percent field)', () => {
    // End 19481 is 29.726% absolute; stored against a 29.7 Percent field the endpoint is 100.088 relative.
    const result = validateKeyPoints([
      { input: 0, output: 0 },
      { input: 48, output: 47.6 },
      { input: 100, output: 100.088 }
    ]);
    expect(result.valid).toBe(true);
  });

  it('rejects negative outputs and inputs outside 0-100', () => {
    expect(validateKeyPoints([{ input: 0, output: -1 }, { input: 100, output: 100 }]).valid).toBe(false);
    expect(validateKeyPoints([{ input: 0, output: 0 }, { input: 101, output: 100 }]).valid).toBe(false);
  });
});
