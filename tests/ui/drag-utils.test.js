import { describe, expect, it } from 'vitest';
import { normalizeDragOutputToAbsolute } from '../../src/js/ui/drag-utils.js';

describe('normalizeDragOutputToAbsolute', () => {
  it('returns the clamped output when display max is 100', () => {
    expect(normalizeDragOutputToAbsolute(55, 100)).toBeCloseTo(55, 6);
  });

  it('does not scale values above the chart display max', () => {
    expect(normalizeDragOutputToAbsolute(40, 40)).toBeCloseTo(40, 6);
  });
});

