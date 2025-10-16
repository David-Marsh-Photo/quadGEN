import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { computeAutoRaiseTargetPercent, maybeAutoRaiseInkLimits, clearAutoRaiseAuditState } from '../../src/js/core/auto-raise-on-import.js';
import { setCompositeAutoRaiseSummary, getCompositeDebugState, resetCompositeDebugState, setCompositeDebugEnabled, commitCompositeDebugSession } from '../../src/js/core/composite-debug.js';
import { setAutoRaiseInkLimitsEnabled } from '../../src/js/core/feature-flags.js';
import * as SmartCurves from '../../src/js/curves/smart-curves.js';
import * as State from '../../src/js/core/state.js';
import * as StateManager from '../../src/js/core/state-manager.js';

describe('computeAutoRaiseTargetPercent', () => {
  test('returns 0 for invalid entries', () => {
    expect(computeAutoRaiseTargetPercent(null)).toBe(0);
    expect(computeAutoRaiseTargetPercent({})).toBe(0);
    expect(computeAutoRaiseTargetPercent({ samples: [] })).toBe(0);
  });

  test('scales fractional samples to percent', () => {
    const entry = { samples: [0, 0.25, 0.5, 0.75] };
    expect(computeAutoRaiseTargetPercent(entry)).toBeCloseTo(75, 3);
  });

  test('returns raw percent when samples exceed 1', () => {
    const entry = { samples: [0, 1.2, 1.5] };
    expect(computeAutoRaiseTargetPercent(entry)).toBeCloseTo(1.5, 3);
  });
});

describe('maybeAutoRaiseInkLimits coverage alignment', () => {
  const originalDocument = global.document;
  const originalCoverageGetter = global.getCompositeCoverageSummary;

  beforeEach(() => {
    setAutoRaiseInkLimitsEnabled(true);
    clearAutoRaiseAuditState();
    global.document = {
      querySelectorAll: vi.fn().mockReturnValue([])
    };
    const baselineEnd = { K: 40000, C: 32000, MK: 36000 };
    vi.spyOn(State, 'getLoadedQuadData').mockReturnValue({
      baselineEnd: { ...baselineEnd },
      curves: {
        K: Array.from({ length: 256 }, (_, idx) => (idx / 255) * baselineEnd.K),
        C: Array.from({ length: 256 }, (_, idx) => (idx / 255) * baselineEnd.C),
        MK: Array.from({ length: 256 }, (_, idx) => (idx / 255) * baselineEnd.MK)
      }
    });
    vi.spyOn(StateManager, 'getStateManager').mockReturnValue({
      get: (key) => {
        if (key === 'printer.channelValues') {
          return {
            K: { percentage: 60, endValue: baselineEnd.K },
            C: { percentage: 50, endValue: baselineEnd.C },
            MK: { percentage: 45, endValue: baselineEnd.MK }
          };
        }
        return undefined;
      }
    });
  });

  afterEach(() => {
    setAutoRaiseInkLimitsEnabled(false);
    clearAutoRaiseAuditState();
    vi.restoreAllMocks();
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
    if (originalCoverageGetter === undefined) {
      delete global.getCompositeCoverageSummary;
    } else {
      global.getCompositeCoverageSummary = originalCoverageGetter;
    }
  });

  test('skips auto-raise when coverage headroom remains', () => {
    const ensureSpy = vi.spyOn(SmartCurves, 'ensureInkLimitForAbsoluteTarget').mockReturnValue(null);
    global.getCompositeCoverageSummary = () => ({
      K: {
        maxNormalized: 0.62,
        bufferedLimit: 0.82,
        limit: 0.815
      }
    });

    const result = maybeAutoRaiseInkLimits({ samples: [0, 0.85] }, {
      scope: 'channel',
      channelName: 'K',
      label: 'coverage test',
      emitStatus: false
    });

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(result.adjustments).toHaveLength(0);
    if (result.blocked.length > 0) {
      expect(result.blocked).toEqual([
        expect.objectContaining({
          channelName: 'K',
          reason: 'coverage-available'
        })
      ]);
    }
  });

  test('raises when coverage exhausted across all channels', () => {
    const ensureSpy = vi.spyOn(SmartCurves, 'ensureInkLimitForAbsoluteTarget').mockReturnValue({
      raised: true,
      previousPercent: 60,
      newPercent: 85,
      currentPercent: 60,
      absolute: 85
    });
    global.getCompositeCoverageSummary = () => ({
      K: {
        maxNormalized: 0.805,
        bufferedLimit: 0.81,
        limit: 0.805
      },
      C: {
        maxNormalized: 0.81,
        bufferedLimit: 0.81,
        limit: 0.81
      }
    });

    const result = maybeAutoRaiseInkLimits({ samples: [0, 0.9] }, {
      scope: 'channel',
      channelName: 'K',
      label: 'coverage exhaustion',
      emitStatus: false
    });

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0]).toMatchObject({
      channelName: 'K',
      reason: 'coverage-exhausted'
    });
  });

  test('skips auto-raise when a partner channel retains coverage headroom', () => {
    const ensureSpy = vi.spyOn(SmartCurves, 'ensureInkLimitForAbsoluteTarget').mockReturnValue(null);
    global.getCompositeCoverageSummary = () => ({
      K: {
        maxNormalized: 0.809,
        bufferedLimit: 0.81,
        limit: 0.81
      },
      MK: {
        maxNormalized: 0.71,
        bufferedLimit: 0.97,
        limit: 0.97
      }
    });

    const result = maybeAutoRaiseInkLimits({ samples: [0, 0.92] }, {
      scope: 'channel',
      channelName: 'K',
      label: 'handoff available',
      emitStatus: false
    });

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(result.adjustments).toHaveLength(0);
    if (result.blocked.length > 0) {
      expect(result.blocked).toEqual([
        expect.objectContaining({
          channelName: 'K',
          reason: 'handoff-available'
        })
      ]);
    }
  });
});

describe('composite debug auto-raise summary integration', () => {
  beforeEach(() => {
    resetCompositeDebugState();
    setCompositeDebugEnabled(true);
  });

  test('stores auto-raise entries in summary', () => {
    setCompositeAutoRaiseSummary([
      { channel: 'K', previousPercent: 50, newPercent: 80, desiredPercent: 80 }
    ], { label: 'test', source: 'unit' });
    const state = getCompositeDebugState();
    expect(state.summary?.autoRaisedEnds?.length ?? 0).toBe(1);
    const entry = state.summary.autoRaisedEnds[0];
    expect(entry.channel).toBe('K');
    expect(entry.locked).toBe(false);
  });

  test('auto-raise entries persist after composite session commit', () => {
    setCompositeAutoRaiseSummary([
      { channel: 'C', previousPercent: 40, newPercent: 65, desiredPercent: 65 }
    ], { label: 'pre-commit', source: 'unit' });

    commitCompositeDebugSession({
      summary: { channelNames: ['C'] },
      snapshots: [],
      selectionIndex: null
    });

    const state = getCompositeDebugState();
    expect(state.summary?.autoRaisedEnds?.length ?? 0).toBe(1);
    expect(state.summary.autoRaisedEnds[0].channel).toBe('C');
  });
});
