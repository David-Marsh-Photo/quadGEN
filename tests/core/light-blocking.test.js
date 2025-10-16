import { describe, expect, it } from 'vitest';
import { computeLightBlockingCurve } from '../../src/js/core/light-blocking.js';

describe('computeLightBlockingCurve', () => {
  it('combines enabled channel curves with density weights and reports metadata', () => {
    const mockChannels = {
      K: {
        enabled: true,
        end: 80,
        weight: 0.6,
        samples: Array.from({ length: 256 }, (_, i) => i / 255),
      },
      C: {
        enabled: true,
        end: 50,
        weight: 0.2,
        samples: Array.from({ length: 256 }, (_, i) => (255 - i) / 255),
      },
      Lk: {
        enabled: false,
        end: 100,
        weight: 0.15,
        samples: Array.from({ length: 256 }, () => 0.5),
      },
    };

    const result = computeLightBlockingCurve({
      channels: mockChannels,
      resolution: 256,
    });

    expect(result.curve).toHaveLength(256);
    expect(result.contributingChannels).toEqual(['K', 'C']);
    expect(result.maxValue).toBeCloseTo(60, 1);
    expect(result.curve[255]).toBeCloseTo(60, 1);
    expect(result.curve[0]).toBeCloseTo(20, 1);
    expect(result.rawMaxValue).toBeCloseTo(60, 1);
    expect(result.rawCurve?.[255]).toBeCloseTo(60, 1);
    expect(result.normalizedCurve?.[255]).toBeCloseTo(100, 5);

    const normalized = computeLightBlockingCurve({
      channels: mockChannels,
      resolution: 256,
      normalize: true,
    });

    expect(normalized.maxValue).toBeCloseTo(100, 5);
    expect(normalized.curve[255]).toBeCloseTo(100, 5);
    expect(normalized.rawMaxValue).toBeCloseTo(60, 1);
  });
});
