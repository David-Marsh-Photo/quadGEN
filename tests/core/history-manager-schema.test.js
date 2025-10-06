import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockElements = {
  rows: null,
  undoBtn: null,
  redoBtn: null
};

const mockLoadedData = { keyPoints: {}, keyPointsMeta: {}, sources: {} };

const getCurrentScaleMock = vi.fn(() => 100);
const getScalingSnapshotMock = vi.fn(() => ({
  percent: 87,
  baselines: { MK: 40200 },
  maxAllowed: 163,
  statePercent: 87,
  stateBaselines: { MK: 40200 },
  stateMaxAllowed: 163,
  parity: { status: 'ok', percentDelta: 0, baselineDiffs: [], maxAllowedDelta: 0 }
}));
const restoreLegacyScalingStateMock = vi.fn();

vi.mock('../../src/js/core/state.js', async () => {
  const actual = await vi.importActual('../../src/js/core/state.js');
  return {
    ...actual,
    elements: mockElements,
    getLoadedQuadData: vi.fn(() => mockLoadedData),
    setLoadedQuadData: vi.fn(),
    ensureLoadedQuadData: (factory) => {
      if (typeof factory === 'function') {
        const created = factory();
        Object.assign(mockLoadedData, created);
        return mockLoadedData;
      }
      return mockLoadedData;
    },
    updateAppState: vi.fn(),
    getAppState: vi.fn(() => ({})),
    setEditModeFlag: vi.fn()
  };
});

vi.mock('../../src/js/data/linearization-utils.js', () => ({
  LinearizationState: {
    getGlobalData: vi.fn(() => null),
    globalApplied: false,
    getPerChannelData: vi.fn(() => null)
  }
}));

vi.mock('../../src/js/curves/smart-curves.js', () => ({
  setSmartKeyPoints: vi.fn(),
  ControlPoints: {
    get: vi.fn(() => ({ points: [] }))
  }
}));

vi.mock('../../src/js/core/validation.js', () => ({
  InputValidator: {
    clampPercent: (value) => Number(value) || 0,
    clampEnd: (value) => Number(value) || 0,
    computeEndFromPercent: (percent) => Math.round((Number(percent) || 0) * 655.35)
  }
}));

vi.mock('../../src/js/ui/edit-mode.js', () => ({
  isEditModeEnabled: () => false
}));

vi.mock('../../src/js/core/scaling-utils.js', () => ({
  getCurrentScale: getCurrentScaleMock,
  getLegacyScalingSnapshot: getScalingSnapshotMock,
  restoreLegacyScalingState: restoreLegacyScalingStateMock
}));

const originalWindow = global.window;
const originalDocument = global.document;
const originalTriggerInkChartUpdate = global.triggerInkChartUpdate;

describe('HistoryManager snapshot schema', () => {
  let HistoryManagerModule;
  let HistoryManager;
  let QuadGenStateManager;
  let history;
  let stateManager;

  beforeEach(async () => {
    vi.resetModules();
    mockElements.rows = null;
    mockElements.undoBtn = null;
    mockElements.redoBtn = null;
    global.window = { applyGlobalScale: vi.fn() };
    global.document = {
      getElementById: vi.fn(() => null)
    };
    global.triggerInkChartUpdate = vi.fn();
    global.triggerPreviewUpdate = vi.fn();
    global.triggerRevertButtonsUpdate = vi.fn();
    global.triggerProcessingDetail = vi.fn();

    HistoryManagerModule = await import('../../src/js/core/history-manager.js');
    HistoryManager = HistoryManagerModule.HistoryManager;
    const stateManagerModule = await import('../../src/js/core/state-manager.js');
    QuadGenStateManager = stateManagerModule.QuadGenStateManager;
    stateManager = new QuadGenStateManager();
    history = new HistoryManager(stateManager);
    restoreLegacyScalingStateMock.mockReset();
  });

  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    global.triggerInkChartUpdate = originalTriggerInkChartUpdate;
  });

  it('captures versioned snapshots with legacy scaling metadata', () => {
    getCurrentScaleMock.mockReturnValueOnce(87);
    getScalingSnapshotMock.mockReturnValueOnce({
      percent: 87,
      baselines: { MK: 40200 },
      maxAllowed: 163,
      statePercent: 87,
      stateBaselines: { MK: 40200 },
      stateMaxAllowed: 163,
      parity: { status: 'ok', percentDelta: 0, baselineDiffs: [], maxAllowedDelta: 0 }
    });
    history.captureState('Test Capture');

    expect(history.history.length).toBe(1);
    const entry = history.history[0];
    expect(entry.kind).toBe('snapshot');
    expect(entry.state.version).toBe(2);
    expect(getScalingSnapshotMock).toHaveBeenCalled();
    expect(entry.state.legacyScaling).toMatchObject({ percent: 87, baselines: { MK: 40200 }, maxAllowed: 163 });
    expect(entry.state.scalingStateSnapshot).toMatchObject({ percent: 87, baselines: { MK: 40200 }, maxAllowed: 163 });
    expect(entry.state.scalingParity).toEqual({ status: 'ok', percentDelta: 0, baselineDiffs: [], maxAllowedDelta: 0 });
    expect(entry.state.stateSnapshot.app.editMode).toBe(false);
  });

  it('hydrates legacy scaling baselines on snapshot restore', () => {
    const snapshot = {
      version: 2,
      timestamp: Date.now(),
      action: 'After: Scale 120%',
      stateSnapshot: stateManager.getState(),
      legacyScaling: {
        percent: 120,
        baselines: { MK: 41000 },
        maxAllowed: 159,
        statePercent: 120,
        stateBaselines: { MK: 41000 },
        stateMaxAllowed: 159,
        parity: { status: 'ok', percentDelta: 0, baselineDiffs: [], maxAllowedDelta: 0 }
      },
      scalingStateSnapshot: {
        percent: 120,
        baselines: { MK: 41000 },
        maxAllowed: 159
      },
      scalingParity: { status: 'ok', percentDelta: 0, baselineDiffs: [], maxAllowedDelta: 0 }
    };

    history.restoreSnapshot(snapshot);

    expect(restoreLegacyScalingStateMock).toHaveBeenCalledWith(snapshot.legacyScaling);
  });

  it('restores v1 snapshots that include stateSnapshot without version', () => {
    const snapshotV1 = {
      timestamp: 1000,
      action: 'Legacy state',
      stateSnapshot: stateManager.getState()
    };
    snapshotV1.stateSnapshot.app.debugLogs = true;

    stateManager.set('app.debugLogs', false);
    history.restoreSnapshot(snapshotV1);

    expect(stateManager.get('app.debugLogs')).toBe(true);
  });

  it('restores legacy snapshots without stateSnapshot fields', () => {
    const legacySnapshot = {
      channels: {
        MK: { percentage: 75, endValue: 40000, enabled: true }
      },
      globalLinearization: {
        data: { foo: 'bar' },
        applied: true,
        enabled: true,
        filename: 'legacy.txt'
      },
      perChannelLinearization: {
        MK: { data: [1, 2, 3] }
      },
      perChannelEnabled: {
        MK: true
      },
      loadedQuadData: { meta: 'legacy' }
    };

    history.restoreSnapshot(legacySnapshot);

    expect(stateManager.get('printer.channelValues.MK.percentage')).toBe(75);
    expect(stateManager.get('linearization.global.enabled')).toBe(true);
    expect(stateManager.get('linearization.perChannel.enabled.MK')).toBe(true);
  });
});
