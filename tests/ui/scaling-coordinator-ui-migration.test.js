/* @vitest-environment jsdom */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

const coordinatorMocks = vi.hoisted(() => {
  const scale = vi.fn(() => Promise.resolve({ success: true, message: 'scaled', details: { scalePercent: 0 } }));
  const isEnabled = vi.fn(() => false);
  const setEnabled = vi.fn();
  const flushQueue = vi.fn();
  return {
    scale,
    isEnabled,
    setEnabled,
    flushQueue
  };
});

const scalingUtilsMocks = vi.hoisted(() => {
  let currentScale = 100;
  return {
    applyGlobalScale: vi.fn((value) => {
      currentScale = Number(value);
      return { success: true, message: 'legacy path', details: { scalePercent: currentScale } };
    }),
    scaleChannelEndsByPercent: vi.fn(() => ({ success: true, message: 'legacy channel resync' })),
    getCurrentScale: () => currentScale,
    setCurrentScale: (value) => {
      currentScale = Number(value);
    }
  };
});

const stateManagerStore = vi.hoisted(() => new Map());

vi.mock('../../src/js/core/state.js', () => {
  const elements = {
    rows: null,
    scaleAllInput: null,
    filenameInput: null,
    downloadBtn: null,
    printerSelect: null,
    channelInfo: null,
    printerDescription: null
  };
  const appState = {
    perChannelLinearization: {},
    perChannelEnabled: {}
  };
  return {
    elements,
    getCurrentPrinter: () => ({ channels: ['K'] }),
    setLoadedQuadData: vi.fn(),
    getLoadedQuadData: vi.fn(),
    ensureLoadedQuadData: vi.fn(),
    getAppState: () => appState,
    updateAppState: (updates) => Object.assign(appState, updates),
    getPlotSmoothingPercent: () => 0,
    setPlotSmoothingPercent: vi.fn(),
    TOTAL: 65535
  };
});

vi.mock('../../src/js/core/state-manager.js', () => {
  const manager = {
    get: (key) => stateManagerStore.get(key),
    set: (key, value) => {
      stateManagerStore.set(key, value);
    },
    setChannelValue: (channel, field, value) => {
      stateManagerStore.set(`printer.channelValues.${channel}.${field}`, value);
    },
    setChannelEnabled: vi.fn()
  };
  return {
    getStateManager: () => manager
  };
});

vi.mock('../../src/js/ui/ui-utils.js', () => {
  const debounce = (fn) => {
    function wrapped(...args) {
      return fn.apply(this, args);
    }
    wrapped.cancel = () => {};
    return wrapped;
  };
  return {
    sanitizeFilename: (value) => value,
    debounce,
    formatScalePercent: (value) => (Number.isFinite(Number(value)) ? String(Number(value)) : '100')
  };
});

vi.mock('../../src/js/files/file-operations.js', () => ({
  generateFilename: vi.fn(),
  downloadFile: vi.fn(),
  readFileAsText: vi.fn()
}));

vi.mock('../../src/js/core/validation.js', () => {
  const InputValidator = {
    validatePercentInput: (input) => Number(input.value),
    computeEndFromPercent: (percent) => Math.round(Number(percent) / 100 * 65535),
    clearValidationStyling: vi.fn(),
    computePercentFromEnd: (end) => Number(end) / 65535 * 100,
    validateEndInput: (input) => Number(input.value),
    clampPercent: (value) => Number(value),
    clampEnd: (value) => Number(value)
  };
  return { InputValidator };
});

vi.mock('../../src/js/parsers/file-parsers.js', () => ({
  parseQuadFile: vi.fn(),
  parseLinearizationFile: vi.fn()
}));

vi.mock('../../src/js/ui/chart-manager.js', () => ({
  updateInkChart: vi.fn(),
  stepChartZoom: vi.fn(),
  setChartStatusMessage: vi.fn()
}));

vi.mock('../../src/js/core/scaling-utils.js', () => ({
  getCurrentScale: () => scalingUtilsMocks.getCurrentScale(),
  updateScaleBaselineForChannel: vi.fn(),
  applyGlobalScale: scalingUtilsMocks.applyGlobalScale,
  scaleChannelEndsByPercent: scalingUtilsMocks.scaleChannelEndsByPercent,
  resetGlobalScale: vi.fn()
}));

vi.mock('../../src/js/core/scaling-coordinator.js', () => ({
  default: {
    scale: coordinatorMocks.scale,
    isEnabled: coordinatorMocks.isEnabled,
    setEnabled: coordinatorMocks.setEnabled,
    flushQueue: coordinatorMocks.flushQueue,
    getDebugInfo: vi.fn()
  }
}));

vi.mock('../../src/js/ui/compact-channels.js', () => ({
  updateCompactChannelsList: vi.fn(),
  updateChannelCompactState: vi.fn(),
  updateNoChannelsMessage: vi.fn()
}));

vi.mock('../../src/js/ui/channel-registry.js', () => {
  let currentRow = null;
  return {
    registerChannelRow: (row) => {
      currentRow = row;
      return row;
    },
    getChannelRow: () => currentRow
  };
});

vi.mock('../../src/js/ui/graph-status.js', () => ({
  updateProcessingDetail: vi.fn(),
  updateSessionStatus: vi.fn()
}));

vi.mock('../../src/js/data/linearization-utils.js', () => ({
  LinearizationState: { NONE: 'none' },
  normalizeLinearizationEntry: vi.fn(),
  getEditedDisplayName: vi.fn(),
  getBasePointCountLabel: vi.fn()
}));

vi.mock('../../src/js/curves/smart-curves.js', () => ({
  ControlPoints: {},
  extractAdaptiveKeyPointsFromValues: vi.fn(),
  KP_SIMPLIFY: {},
  isSmartCurve: () => false,
  rescaleSmartCurveForInkLimit: vi.fn(),
  refreshPlotSmoothingSnapshotsForSmartEdit: vi.fn()
}));

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
  getTargetRelAt: vi.fn()
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
  getHistoryManager: () => ({
    registerHistoryAction: vi.fn(),
    captureState: vi.fn()
  }),
  beginHistoryTransaction: vi.fn(),
  commitHistoryTransaction: vi.fn(),
  rollbackHistoryTransaction: vi.fn()
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

vi.mock('../../src/js/utils/debug-registry.js', () => ({
  registerDebugNamespace: vi.fn(),
  getDebugRegistry: () => ({})
}));

describe('UI scaling coordinator migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    stateManagerStore.clear();
    scalingUtilsMocks.setCurrentScale(100);

    document.body.innerHTML = '';
    if (!globalThis.window) {
      globalThis.window = window;
    }
    window.__USE_SCALING_COORDINATOR = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes Enter commits of the global scale field through the coordinator even when disabled', async () => {
    const { elements } = await import('../../src/js/core/state.js');
    const scaleInput = document.createElement('input');
    scaleInput.id = 'scaleAllInput';
    scaleInput.type = 'number';
    scaleInput.value = '110';
    scaleInput.blur = vi.fn();
    elements.scaleAllInput = scaleInput;
    document.body.appendChild(scaleInput);

    const { initializeEventHandlers } = await import('../../src/js/ui/event-handlers.js');
    initializeEventHandlers();
    scaleInput.value = '110';

    coordinatorMocks.isEnabled.mockReturnValue(false);

    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    scaleInput.dispatchEvent(keyEvent);

    expect(coordinatorMocks.scale).toHaveBeenCalledWith(110, 'ui', expect.objectContaining({ priority: 'high' }));
    expect(scalingUtilsMocks.applyGlobalScale).not.toHaveBeenCalled();
  });

  it('re-applies current global scale via coordinator after per-channel percent edits', async () => {
    vi.useFakeTimers();
    const { elements } = await import('../../src/js/core/state.js');

    const rows = document.createElement('tbody');
    const row = document.createElement('tr');
    row.setAttribute('data-channel', 'K');

    const percentInput = document.createElement('input');
    percentInput.className = 'percent-input';
    percentInput.value = '75';
    percentInput.type = 'number';

    const endInput = document.createElement('input');
    endInput.className = 'end-input';
    endInput.value = '50000';
    endInput.type = 'number';

    row.append(percentInput, endInput);
    rows.append(row);

    elements.rows = rows;
    document.body.append(rows);

    stateManagerStore.set('printer.channelValues.K.percentage', 80);
    stateManagerStore.set('printer.channelValues.K.endValue', 52428);

    scalingUtilsMocks.setCurrentScale(120);

    const { initializeEventHandlers } = await import('../../src/js/ui/event-handlers.js');
    initializeEventHandlers();

    coordinatorMocks.isEnabled.mockReturnValue(false);

    const changeEvent = new Event('change', { bubbles: true });
    percentInput.dispatchEvent(changeEvent);

    await Promise.resolve();
    vi.runAllTimers();

    expect(coordinatorMocks.scale).toHaveBeenCalledWith(120, 'ui-resync', expect.objectContaining({ metadata: expect.any(Object) }));
    expect(scalingUtilsMocks.scaleChannelEndsByPercent).not.toHaveBeenCalled();
  });
});
