import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockElements = {
  rows: null,
  undoBtn: null,
  redoBtn: null
};

const mockLoadedData = { keyPoints: {}, keyPointsMeta: {}, sources: {} };

vi.mock('../../src/js/core/state.js', () => ({
  elements: mockElements,
  TOTAL: 65535,
  INK_COLORS: {},
  PRINTERS: {},
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
}));

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

function createStateManager() {
  const stateHolder = {
    printer: {
      channelValues: {},
      channelStates: {}
    },
    curves: {},
    linearization: {},
    app: {
      editSelection: {
        channel: null,
        ordinal: 1
      }
    }
  };

  return {
    state: stateHolder,
    subscribe: vi.fn(),
    getState: vi.fn(() => JSON.parse(JSON.stringify(stateHolder))),
    setState: vi.fn((next) => {
      Object.keys(stateHolder).forEach((key) => delete stateHolder[key]);
      Object.assign(stateHolder, next);
    }),
    setChannelValue: vi.fn(),
    setChannelEnabled: vi.fn(),
    batch: vi.fn((updates) => {
      Object.entries(updates).forEach(([path, value]) => {
        const segments = path.split('.');
        let target = stateHolder;
        for (let i = 0; i < segments.length - 1; i += 1) {
          const key = segments[i];
          if (!target[key]) target[key] = {};
          target = target[key];
        }
        target[segments.at(-1)] = value;
      });
    }),
    set: vi.fn(),
    setEditMode: vi.fn(),
    setEditSelection: vi.fn(),
    getEditSelection: vi.fn(() => ({ channel: null, ordinal: 1 }))
  };
}

describe('HistoryManager transactions', () => {
  let HistoryManager;
  let history;
  let stateManager;
  const originalWindow = global.window;
  const originalDocument = global.document;

  beforeEach(async () => {
    vi.resetModules();
    stateManager = createStateManager();
    mockElements.undoBtn = null;
    mockElements.redoBtn = null;
    global.window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    };
    global.window.__USE_SCALING_STATE = false;
    global.document = {
      getElementById: vi.fn(() => null)
    };
    global.triggerInkChartUpdate = vi.fn();
    global.triggerPreviewUpdate = vi.fn();
    global.triggerRevertButtonsUpdate = vi.fn();
    global.triggerProcessingDetail = vi.fn();
    const module = await import('../../src/js/core/history-manager.js');
    ({ HistoryManager } = module);
    history = new HistoryManager(stateManager);
    stateManager.setChannelValue.mockClear();
  });

  afterEach(() => {
    delete global.triggerInkChartUpdate;
    delete global.triggerPreviewUpdate;
    delete global.triggerRevertButtonsUpdate;
    delete global.triggerProcessingDetail;
    global.window = originalWindow;
    global.document = originalDocument;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('buffers entries during an active transaction', () => {
    const txId = history.beginTransaction('Scale 80%');
    history.recordChannelAction('K', 'percentage', 100, 80);
    expect(history.history).toHaveLength(0);
    const result = history.commit(txId);
    expect(result.success).toBe(true);
    expect(history.history).toHaveLength(1);
    expect(history.history[0].kind).toBe('transaction');
    expect(history.history[0].action.entries).toHaveLength(1);
  });

  it('undo/redo operates on transaction as a single entry', () => {
    const txId = history.beginTransaction('Scale 75%');
    history.recordChannelAction('K', 'percentage', 100, 75);
    history.commit(txId);

    expect(history.history).toHaveLength(1);

    history.undo();
    expect(stateManager.setChannelValue).toHaveBeenCalledWith('K', 'percentage', 100);
    expect(history.redoStack).toHaveLength(1);

    stateManager.setChannelValue.mockClear();
    history.redo();
    expect(stateManager.setChannelValue).toHaveBeenCalledWith('K', 'percentage', 75);
    expect(history.history).toHaveLength(1);
  });

  it('restores snapshot when rolling back a transaction', () => {
    stateManager.state.printer.channelValues.K = { percentage: 90 };
    const txId = history.beginTransaction('Rollback scale');
    stateManager.state.printer.channelValues.K.percentage = 40;
    const result = history.rollback(txId);
    expect(result.success).toBe(true);
    expect(stateManager.state.printer.channelValues.K.percentage).toBe(90);
    expect(history.history).toHaveLength(0);
  });

  it('prevents nested transactions', () => {
    history.beginTransaction('First');
    expect(() => history.beginTransaction('Second')).toThrow();
  });

  it('ignores commit when no entries recorded', () => {
    const txId = history.beginTransaction('No-op');
    const result = history.commit(txId);
    expect(result.message).toContain('no changes');
    expect(history.history).toHaveLength(0);
  });

  it('throws when committing with wrong transaction id', () => {
    history.beginTransaction('Mismatch');
    expect(() => history.commit('bad-id')).toThrow();
  });

  it('handles UI actions inside a transaction', () => {
    const txId = history.beginTransaction('Edit mode toggle');
    history.recordUIAction('editMode', false, true, 'Enable Edit Mode');
    history.commit(txId);

    expect(history.history).toHaveLength(1);
    expect(history.history[0].action.entries[0].kind).toBe('ui');

    history.undo();
    expect(stateManager.setEditMode).toHaveBeenCalledWith(false);
  });

  it('reports active transaction in debug info', () => {
    history.beginTransaction('Debug');
    const debugInfo = history.getDebugInfo();
    expect(debugInfo.transactionActive).toBe(true);
    expect(debugInfo.transactionDescription).toBe('Debug');
  });

  it('clears warning timer on commit', () => {
    vi.useFakeTimers();
    const txId = history.beginTransaction('Timer');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    history.commit(txId);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear() resets transaction state', () => {
    history.beginTransaction('Clear test');
    history.clear();
    expect(history.activeTransaction).toBeNull();
    expect(history.history).toHaveLength(0);
  });
});
