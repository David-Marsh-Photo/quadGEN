import { describe, it, expect } from 'vitest';
import {
  resolveSmartPointClickSelection,
  mapPercentToX,
  mapPercentToY
} from '../../src/js/ui/chart-utils.js';

describe('resolveSmartPointClickSelection', () => {
  const geom = {
    dpr: 1,
    leftPadding: 10,
    chartWidth: 180,
    chartHeight: 180,
    height: 220,
    bottomPadding: 30,
    padding: 10,
    displayMax: 100
  };

  const points = [
    { input: 0, output: 0 },
    { input: 50, output: 60 },
    { input: 100, output: 100 }
  ];

  it('selects the nearest point when click is within tolerance', () => {
    const canvasX = mapPercentToX(50, geom);
    const canvasY = mapPercentToY(60, geom);
    const result = resolveSmartPointClickSelection({
      canvasX,
      canvasY,
      points,
      geom,
      tolerance: 12
    });

    expect(result?.ordinal).toBe(2);
  });

  it('returns null when click is outside tolerance', () => {
    const result = resolveSmartPointClickSelection({
      canvasX: 40,
      canvasY: 40,
      points,
      geom,
      tolerance: 4
    });

    expect(result).toBeNull();
  });
});
