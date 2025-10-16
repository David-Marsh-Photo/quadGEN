import { describe, it, expect, beforeEach, vi } from 'vitest';

function immediateDebounce(fn) {
  const debounced = (...args) => fn(...args);
  debounced.cancel = () => {};
  return debounced;
}

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

const { applyPlotSmoothingToLoadedChannels, refreshPlotSmoothingSnapshotsForSmartEdit } = __plotSmoothingTestUtils;

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
});
