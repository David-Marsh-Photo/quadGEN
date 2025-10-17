import { describe, it, expect, beforeEach, vi } from 'vitest';

function immediateDebounce(fn) {
  const debounced = (...args) => fn(...args);
  debounced.cancel = () => {};
  return debounced;
}

const P800_V19_K_CURVE = [
  0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8,
  8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 13, 13, 13, 14, 14, 15,
  15, 15, 16, 16, 17, 17, 18, 18, 18, 19, 19, 20, 20, 21, 21, 22,
  22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 29, 29, 30, 31,
  31, 32, 33, 33, 34, 35, 36, 36, 36, 37, 38, 39, 39, 40, 40, 41,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 54, 55, 57, 59,
  61, 63, 65, 67, 70, 73, 76, 80, 84, 87, 91, 95, 100, 105, 111, 116,
  123, 133, 150, 174, 202, 233, 268, 303, 339, 373, 407, 443, 483, 523, 567, 614,
  664, 719, 778, 840, 906, 974, 1044, 1116, 1192, 1272, 1355, 1443, 1534, 1631, 1734, 1843,
  1956, 2072, 2191, 2315, 2443, 2575, 2710, 2846, 2985, 3125, 3267, 3412, 3558, 3706, 3855, 4006,
  4158, 4312, 4467, 4623, 4780, 4939, 5099, 5261, 5425, 5590, 5756, 5925, 6092, 6258, 6426, 6595,
  6766, 6938, 7111, 7286, 7462, 7640, 7819, 8000, 8183, 8368, 8555, 8743, 8933, 9126, 9320, 9517,
  9715, 9916, 10119, 10324, 10530, 10739, 10948, 11159, 11371, 11585, 11799, 12014, 12230, 12446, 12663, 12880,
  13097, 13315, 13532, 13749, 13968, 14186, 14405, 14625, 14846, 15067, 15288, 15510, 15733, 15957, 16181, 16406,
  16631, 16858, 17084, 17312, 17540, 17769, 17999, 18229, 18460, 18692, 18925, 19158, 19389, 19621, 19853, 20085,
  20318, 20553, 20790, 21029, 21270, 21515, 21764, 22016, 22273, 22535, 22806, 23087, 23376, 23668, 23960, 24248
];

if (typeof document === 'undefined') {
  vi.stubGlobal('document', {
    getElementById: () => null
  });
}

vi.mock('../../src/js/ui/ui-utils.js', () => ({
  sanitizeFilename: (value) => value,
  debounce: immediateDebounce,
  formatScalePercent: (value) => `${value}%`
}));

vi.mock('../../src/js/core/state-manager.js', () => ({
  getStateManager: () => ({
    setChannelValue: vi.fn(),
    setChannelEnabled: vi.fn()
  })
}));

vi.mock('../../src/js/core/channel-locks.js', () => ({
  ensureChannelLock: vi.fn(),
  setChannelLock: vi.fn(),
  isChannelLocked: () => false,
  updateChannelLockBounds: vi.fn(),
  subscribeToChannelLock: () => () => {},
  clampAbsoluteToChannelLock: (value) => value,
  getChannelLockInfo: () => ({}),
  getLockedChannels: () => [],
  getGlobalScaleLockMessage: () => null
}));

vi.mock('../../src/js/files/file-operations.js', () => ({
  generateFilename: vi.fn(),
  downloadFile: vi.fn(),
  readFileAsText: vi.fn()
}));

vi.mock('../../src/js/parsers/file-parsers.js', () => ({
  parseQuadFile: vi.fn(),
  parseLinearizationFile: vi.fn()
}));

vi.mock('../../src/js/ui/chart-manager.js', () => ({
  updateInkChart: vi.fn(),
  stepChartZoom: vi.fn(),
  setChartDebugShowCorrectionTarget: vi.fn(),
  isChartDebugShowCorrectionTarget: () => false
}));

vi.mock('../../src/js/core/scaling-utils.js', () => ({
  getCurrentScale: () => 100,
  reapplyCurrentGlobalScale: vi.fn(),
  updateScaleBaselineForChannel: vi.fn(),
  updateScaleBaselineForChannelCore: vi.fn(),
  validateScalingStateSync: () => true
}));

vi.mock('../../src/js/core/scaling-coordinator.js', () => ({
  setEnabled: vi.fn(),
  withLock: async (fn) => (typeof fn === 'function' ? fn() : undefined)
}));

vi.mock('../../src/js/ui/compact-channels.js', () => ({
  updateCompactChannelsList: vi.fn(),
  updateChannelCompactState: vi.fn(),
  updateNoChannelsMessage: vi.fn()
}));

vi.mock('../../src/js/ui/channel-registry.js', () => ({
  registerChannelRow: vi.fn(),
  getChannelRow: vi.fn()
}));

vi.mock('../../src/js/ui/graph-status.js', () => ({
  updateProcessingDetail: vi.fn(),
  updateSessionStatus: vi.fn()
}));

vi.mock('../../src/js/data/linearization-utils.js', () => ({
  LinearizationState: {
    setGlobalWarnings: vi.fn(),
    getGlobalData: vi.fn(() => null),
    getGlobalCorrectedCurves: vi.fn(() => null),
    getGlobalBaselineCurves: vi.fn(() => null),
    globalApplied: false
  },
  normalizeLinearizationEntry: vi.fn(),
  getEditedDisplayName: vi.fn(),
  getBasePointCountLabel: vi.fn()
}));

vi.mock('../../src/js/core/auto-raise-on-import.js', () => ({
  maybeAutoRaiseInkLimits: vi.fn()
}));

vi.mock('../../src/js/curves/smart-curves.js', async () => {
  const actual = await vi.importActual('../../src/js/curves/smart-curves.js');
  return {
    ...actual,
    ControlPoints: { persist: vi.fn() },
    extractAdaptiveKeyPointsFromValues: vi.fn(),
    KP_SIMPLIFY: 0,
    isSmartCurve: () => false,
    isSmartCurveSourceTag: () => false,
    rescaleSmartCurveForInkLimit: vi.fn(),
    formatPercentDisplay: (value) => `${value}`
  };
});

vi.mock('../../src/js/ui/edit-mode.js', () => ({
  isEditModeEnabled: () => false,
  setEditMode: vi.fn(),
  populateChannelDropdown: vi.fn(),
  refreshSmartCurvesFromMeasurements: vi.fn(),
  reinitializeChannelSmartCurves: vi.fn(),
  persistSmartPoints: vi.fn(),
  setGlobalBakedState: vi.fn(),
  isSmartPointDragActive: () => false
}));

vi.mock('../../src/js/data/lab-parser.js', () => ({
  getTargetRelAt: vi.fn(),
  rebuildLabSamplesFromOriginal: vi.fn(() => [])
}));

vi.mock('../../src/js/ui/labtech-summaries.js', () => ({
  postLinearizationSummary: vi.fn()
}));

vi.mock('../../src/js/ui/quad-preview.js', () => ({
  updatePreview: vi.fn()
}));

vi.mock('../../src/js/ui/intent-system.js', () => ({
  getPreset: () => ({ label: 'Linear', params: {} }),
  canApplyIntentRemap: () => false,
  updateIntentDropdownState: vi.fn()
}));

vi.mock('../../src/js/core/history-manager.js', () => ({
  getHistoryManager: () => null
}));

vi.mock('../../src/js/math/interpolation.js', () => ({
  clamp01: (value) => Math.min(1, Math.max(0, value)),
  createPCHIPSpline: vi.fn()
}));

vi.mock('../../src/js/ui/revert-controls.js', () => ({
  updateRevertButtonsState: vi.fn(),
  computeGlobalRevertState: vi.fn(),
  resetSmartPointsForChannels: vi.fn(),
  resetChannelSmartPointsToMeasurement: vi.fn()
}));

vi.mock('../../src/js/ui/status-service.js', () => ({
  showStatus: vi.fn()
}));

vi.mock('../../src/js/ui/help-system.js', () => ({
  initializeHelpSystem: vi.fn()
}));

vi.mock('../../src/js/ui/printer-manager.js', () => ({
  setPrinter: vi.fn(),
  registerChannelRowSetup: vi.fn(),
  syncPrinterForQuadData: vi.fn()
}));

vi.mock('../../src/js/core/processing-pipeline.js', () => ({
  make256: vi.fn(),
  beginCompositeLabRedistribution: vi.fn(),
  finalizeCompositeLabRedistribution: vi.fn(() => ({})),
  replayCompositeLabRedistribution: vi.fn(),
  replayCompositeDebugSessionFromCache: vi.fn(),
  getCompositeCoverageSummary: vi.fn()
}));

vi.mock('../../src/js/core/lab-settings.js', () => ({
  getLabNormalizationMode: () => 'lstar',
  setLabNormalizationMode: vi.fn(),
  isDensityNormalizationEnabled: () => false,
  subscribeLabNormalizationMode: () => () => {},
  LAB_NORMALIZATION_MODES: { LSTAR: 'lstar', DENSITY: 'density' },
  getLabSmoothingPercent: () => 0,
  setLabSmoothingPercent: vi.fn(),
  subscribeLabSmoothingPercent: () => () => {},
  mapSmoothingPercentToWiden: () => 1
}));

vi.mock('../../src/js/data/lab-legacy-bypass.js', () => ({
  isLabLinearizationData: () => true
}));

vi.mock('../../src/js/core/feature-flags.js', () => ({
  isSmartPointDragEnabled: () => true,
  setSmartPointDragEnabled: vi.fn(),
  isRedistributionSmoothingWindowEnabled: () => false,
  setRedistributionSmoothingWindowEnabled: vi.fn(),
  isAutoRaiseInkLimitsEnabled: () => true,
  setAutoRaiseInkLimitsEnabled: vi.fn()
}));

vi.mock('../../src/js/core/composite-settings.js', () => ({
  setCompositeWeightingMode: vi.fn(),
  getCompositeWeightingMode: () => 'normalized',
  subscribeCompositeWeightingMode: () => () => {},
  COMPOSITE_WEIGHTING_MODES: { normalized: 'normalized' }
}));

vi.mock('../../src/js/core/composite-debug.js', () => ({
  setCompositeDebugEnabled: vi.fn(),
  isCompositeDebugEnabled: () => false,
  subscribeCompositeDebugState: () => () => {}
}));

vi.mock('../../src/js/core/channel-densities.js', () => ({
  setManualChannelDensity: vi.fn(),
  setSolverChannelDensity: vi.fn(),
  getResolvedChannelDensity: () => ({ value: 0, source: 'solver' }),
  subscribeChannelDensities: () => () => {},
  formatDensityValue: (value) => `${value}`,
  clearChannelDensity: vi.fn(),
  getDensityOverridesSnapshot: () => ({}),
  isAutoDensityComputeEnabled: () => true,
  DEFAULT_CHANNEL_DENSITIES: {}
}));

vi.mock('../../src/js/core/validation.js', () => ({
  InputValidator: {
    computePercentFromEnd: (end) => Number(end),
    clearValidationStyling: vi.fn()
  }
}));

import { setLoadedQuadData, getLoadedQuadData, setPlotSmoothingPercent } from '../../src/js/core/state.js';
import { __plotSmoothingTestUtils } from '../../src/js/ui/event-handlers.js';

const {
  applyPlotSmoothingToLoadedChannels,
  refreshPlotSmoothingSnapshotsForSmartEdit,
  blendCurveHeadWithBaseline
} = __plotSmoothingTestUtils;

describe('plot smoothing cache regression', () => {
  beforeEach(() => {
    setLoadedQuadData({
      curves: {},
      baselineEnd: {},
      rebasedSources: {},
      plotBaseCurves: {},
      _plotSmoothingOriginalCurves: {},
      _plotSmoothingOriginalEnds: {}
    });
  });

  it('restores original baseline when smoothing returns to zero', () => {
    const originalCurve = [0, 12000, 24148];
    const collapsedCurve = [0, 11880, 23757];

    const loadedData = getLoadedQuadData();
    loadedData.curves.K = collapsedCurve.slice();
    loadedData.plotBaseCurves.K = collapsedCurve.slice();
    loadedData.rebasedSources.K = collapsedCurve.slice();
    loadedData.baselineEnd.K = collapsedCurve[collapsedCurve.length - 1];
    loadedData._plotSmoothingOriginalCurves.K = originalCurve.slice();
    loadedData._plotSmoothingOriginalEnds.K = originalCurve[originalCurve.length - 1];

    setPlotSmoothingPercent(0);
    applyPlotSmoothingToLoadedChannels(0);

    const mutated = getLoadedQuadData();
    expect(mutated.baselineEnd.K).toBe(originalCurve[originalCurve.length - 1]);
    expect(mutated.curves.K[mutated.curves.K.length - 1]).toBe(originalCurve[originalCurve.length - 1]);
  });

  it('tapers the highlight head toward the baseline', () => {
    const smoothed = [0, 200, 400, 600, 800, 1000];
    const baseline = [0, 10, 20, 30, 40, 50];
    const blended = blendCurveHeadWithBaseline(smoothed, baseline, { windowSize: 6 });
    expect(blended[0]).toBe(0);
    expect(blended[1]).toBeLessThanOrEqual(100);
    expect(blended[5]).toBeGreaterThanOrEqual(baseline[5]);
    expect(blended).toEqual(blended.slice().sort((a, b) => a - b));
  });

it('keeps Smart edits intact after smoothing toggles', () => {
  const baselineCurve = [0, 11000, 22000, 24148];
  const editedCurve = [0, 12500, 23500, 25500];

    const loadedData = getLoadedQuadData();
    loadedData.curves.K = editedCurve.slice();
    loadedData.rebasedCurves.K = editedCurve.slice();
    loadedData.rebasedSources.K = editedCurve.slice();
    loadedData.plotBaseCurves = loadedData.plotBaseCurves || {};
    loadedData.plotBaseCurves.K = baselineCurve.slice();
    loadedData._plotSmoothingOriginalCurves = loadedData._plotSmoothingOriginalCurves || {};
    loadedData._plotSmoothingBaselineCurves = loadedData._plotSmoothingBaselineCurves || {};
    loadedData._plotSmoothingOriginalCurves.K = baselineCurve.slice();
    loadedData._plotSmoothingBaselineCurves.K = baselineCurve.slice();
    loadedData._plotSmoothingOriginalEnds = loadedData._plotSmoothingOriginalEnds || {};
    loadedData.baselineEnd = loadedData.baselineEnd || {};
    loadedData._plotSmoothingOriginalEnds.K = baselineCurve[baselineCurve.length - 1];
    loadedData.baselineEnd.K = baselineCurve[baselineCurve.length - 1];
    loadedData._zeroSmoothingCurves = loadedData._zeroSmoothingCurves || {};
    loadedData._zeroSmoothingCurves.K = baselineCurve.slice();
    loadedData._zeroSmoothingSignature = 'test.quad';

    refreshPlotSmoothingSnapshotsForSmartEdit('K', editedCurve.slice());
    applyPlotSmoothingToLoadedChannels(60);
    applyPlotSmoothingToLoadedChannels(0);

  const mutated = getLoadedQuadData();
  expect(mutated.curves.K).toEqual(editedCurve);
});

it('keeps the plot-smoothed tail balanced for the P800 V19 ramp', () => {
  const baseCurve = P800_V19_K_CURVE;
  const loadedData = getLoadedQuadData();
  loadedData.curves.K = baseCurve.slice();
  loadedData.rebasedCurves = loadedData.rebasedCurves || {};
  loadedData.rebasedCurves.K = baseCurve.slice();
  loadedData.rebasedSources.K = baseCurve.slice();
  loadedData.plotBaseCurves = loadedData.plotBaseCurves || {};
  loadedData.plotBaseCurves.K = baseCurve.slice();
  loadedData.baselineEnd.K = baseCurve[baseCurve.length - 1];
  loadedData.channelPeaks = { K: baseCurve.length - 1 };
  loadedData._plotSmoothingOriginalCurves = loadedData._plotSmoothingOriginalCurves || {};
  loadedData._plotSmoothingOriginalCurves.K = baseCurve.slice();
  loadedData._plotSmoothingBaselineCurves = loadedData._plotSmoothingBaselineCurves || {};
  loadedData._plotSmoothingBaselineCurves.K = baseCurve.slice();
  loadedData._plotSmoothingOriginalEnds = loadedData._plotSmoothingOriginalEnds || {};
  loadedData._plotSmoothingOriginalEnds.K = baseCurve[baseCurve.length - 1];
  loadedData._zeroSmoothingCurves = { K: baseCurve.slice() };
  loadedData._zeroSmoothingSignature = 'P800_K36C26LK25_V19.quad';

  applyPlotSmoothingToLoadedChannels(120);

  const mutated = getLoadedQuadData();
  const tail = mutated.curves.K.slice(-10);
  const diffs = tail
    .map((value, index, array) => (index === 0 ? null : value - array[index - 1]))
    .slice(1);
  const lastDiff = diffs[diffs.length - 1];
  const previousDiff = diffs[diffs.length - 2];

  expect(lastDiff).toBeLessThanOrEqual(previousDiff);
});

it('tapers the tail for steep shadow ramps under heavy smoothing', () => {
  const loadedData = getLoadedQuadData();
  const baseCurve = Array.from({ length: 256 }, (_, index) => {
    if (index < 240) {
      return Math.round(index * 75);
    }
    if (index === 255) {
      return 24248;
    }
    return 18000;
  });

  loadedData.curves.K = baseCurve.slice();
  loadedData.rebasedCurves = loadedData.rebasedCurves || {};
  loadedData.rebasedCurves.K = baseCurve.slice();
  loadedData.rebasedSources.K = baseCurve.slice();
  loadedData.plotBaseCurves = loadedData.plotBaseCurves || {};
  loadedData.plotBaseCurves.K = baseCurve.slice();
  loadedData.baselineEnd.K = baseCurve[baseCurve.length - 1];
  loadedData.channelPeaks = { K: baseCurve.length - 1 };
  loadedData._plotSmoothingOriginalCurves = loadedData._plotSmoothingOriginalCurves || {};
  loadedData._plotSmoothingOriginalCurves.K = baseCurve.slice();
  loadedData._plotSmoothingBaselineCurves = loadedData._plotSmoothingBaselineCurves || {};
  loadedData._plotSmoothingBaselineCurves.K = baseCurve.slice();
  loadedData._plotSmoothingOriginalEnds = loadedData._plotSmoothingOriginalEnds || {};
  loadedData._plotSmoothingOriginalEnds.K = baseCurve[baseCurve.length - 1];
  loadedData._zeroSmoothingCurves = { K: baseCurve.slice() };
  loadedData._zeroSmoothingSignature = 'SteepShadow.quad';

  applyPlotSmoothingToLoadedChannels(200);

  const mutated = getLoadedQuadData();
  const tail = mutated.curves.K.slice(-10);
  const diffs = tail
    .map((value, index, array) => (index === 0 ? null : value - array[index - 1]))
    .slice(1);

  const baselineDiff = baseCurve[baseCurve.length - 1] - baseCurve[baseCurve.length - 2];
  expect(diffs[diffs.length - 1]).toBeLessThanOrEqual(baselineDiff);
});

it('blends the highlight head without exceeding the baseline slope', () => {
  const loadedData = getLoadedQuadData();
  const baseCurve = Array.from({ length: 256 }, (_, idx) => {
    if (idx === 0) return 0;
    if (idx === 1) return 1;
    if (idx === 2) return 2;
    if (idx === 3) return 3;
    if (idx === 4) return 4;
    if (idx === 5) return 5;
    if (idx < 240) return 500 + idx * 150;
    if (idx < 250) return 12000;
    return 24000 + (idx - 250) * 200;
  });

  loadedData.curves.K = baseCurve.slice();
  loadedData.rebasedCurves = loadedData.rebasedCurves || {};
  loadedData.rebasedCurves.K = baseCurve.slice();
  loadedData.rebasedSources.K = baseCurve.slice();
  loadedData.plotBaseCurves = loadedData.plotBaseCurves || {};
  loadedData.plotBaseCurves.K = baseCurve.slice();
  loadedData.baselineEnd.K = baseCurve[baseCurve.length - 1];
  loadedData.channelPeaks = { K: baseCurve.length - 1 };
  loadedData._plotSmoothingOriginalCurves = loadedData._plotSmoothingOriginalCurves || {};
  loadedData._plotSmoothingOriginalCurves.K = baseCurve.slice();
  loadedData._plotSmoothingBaselineCurves = loadedData._plotSmoothingBaselineCurves || {};
  loadedData._plotSmoothingBaselineCurves.K = baseCurve.slice();
  loadedData._plotSmoothingOriginalEnds = loadedData._plotSmoothingOriginalEnds || {};
  loadedData._plotSmoothingOriginalEnds.K = baseCurve[baseCurve.length - 1];
  loadedData._zeroSmoothingCurves = { K: baseCurve.slice() };
  loadedData._zeroSmoothingSignature = 'HighlightPlateau.quad';

  applyPlotSmoothingToLoadedChannels(150);

  const mutated = getLoadedQuadData();
  const head = mutated.curves.K.slice(0, 8);
  const headDiffs = head
    .map((value, index, array) => (index === 0 ? null : value - array[index - 1]))
    .slice(1);

  const baselineHead = baseCurve.slice(0, 8);
  const baselineDiffs = baselineHead
    .map((value, index, array) => (index === 0 ? null : value - array[index - 1]))
    .slice(1);

  expect(headDiffs[5]).toBeLessThanOrEqual(baselineDiffs[5]);
});

it('keeps the P800 V19 highlight ramp monotonic under 72% smoothing', () => {
  const loadedData = getLoadedQuadData();
  const baseCurve = P800_V19_K_CURVE.slice();

  loadedData.curves.K = baseCurve.slice();
  loadedData.rebasedCurves = loadedData.rebasedCurves || {};
  loadedData.rebasedCurves.K = baseCurve.slice();
  loadedData.rebasedSources.K = baseCurve.slice();
  loadedData.plotBaseCurves = loadedData.plotBaseCurves || {};
  loadedData.plotBaseCurves.K = baseCurve.slice();
  loadedData.baselineEnd.K = baseCurve[baseCurve.length - 1];
  loadedData.channelPeaks = { K: baseCurve.length - 1 };
  loadedData._plotSmoothingOriginalCurves = loadedData._plotSmoothingOriginalCurves || {};
  loadedData._plotSmoothingOriginalCurves.K = baseCurve.slice();
  loadedData._plotSmoothingBaselineCurves = loadedData._plotSmoothingBaselineCurves || {};
  loadedData._plotSmoothingBaselineCurves.K = baseCurve.slice();
  loadedData._plotSmoothingOriginalEnds = loadedData._plotSmoothingOriginalEnds || {};
  loadedData._plotSmoothingOriginalEnds.K = baseCurve[baseCurve.length - 1];
  loadedData._zeroSmoothingCurves = { K: baseCurve.slice() };
  loadedData._zeroSmoothingSignature = 'P800_K36C26LK25_V19.quad';

  applyPlotSmoothingToLoadedChannels(72);

  const mutated = getLoadedQuadData();
  const head = mutated.curves.K.slice(0, 16);
  const diffs = head
    .map((value, index, array) => (index === 0 ? null : value - array[index - 1]))
    .slice(1);

  expect(diffs.every((delta) => delta >= 0)).toBe(true);
});
});
