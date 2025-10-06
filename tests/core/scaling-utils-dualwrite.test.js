import { describe, it, expect, beforeEach, vi } from 'vitest';

const stubState = () => ({
  scaling: {
    globalPercent: 100,
    baselines: null,
    maxAllowed: 1000,
  },
  computed: {
    scaling: {
      isActive: false,
    },
  },
});

function getValueByPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
}

function setValueByPath(obj, path, value) {
  const parts = path.split('.');
  let target = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!target[key] || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  }
  target[parts.at(-1)] = value;
}

async function loadScalingUtils() {
  vi.resetModules();

  const state = stubState();
  const setMock = vi.fn((path, value) => {
    setValueByPath(state, path, value);
  });
  const batchMock = vi.fn((fn) => {
    if (typeof fn === 'function') {
      fn();
    }
  });
  const createSelectorMock = vi.fn((paths, computeFn) => {
    const deps = Array.isArray(paths) ? paths : [paths];
    return () => {
      const values = deps.map((dep) => getValueByPath(state, dep));
      return computeFn(...values);
    };
  });
  const getMock = vi.fn((path) => getValueByPath(state, path));

  vi.doMock('../../src/js/core/state-manager.js', () => ({
    getStateManager: () => ({
      set: setMock,
      batch: batchMock,
      createSelector: createSelectorMock,
      get: getMock,
    }),
  }));

  const currentPrinterMock = vi.fn(() => ({ channels: ['MK'] }));
  vi.doMock('../../src/js/core/state.js', () => ({
    elements: {},
    getCurrentPrinter: currentPrinterMock,
  }));

  const getHistoryManagerMock = vi.fn(() => ({ recordBatchAction: vi.fn() }));
  vi.doMock('../../src/js/core/history-manager.js', () => ({
    getHistoryManager: getHistoryManagerMock,
  }));

  vi.doMock('../../src/js/core/validation.js', () => ({
    InputValidator: {
      clampPercent: (value) => Number(value),
      clampEnd: (value) => Number(value),
      computeEndFromPercent: (percent) => Math.round((Number(percent) || 0) * 655.35),
      computePercentFromEnd: (end) => (Number(end) || 0) / 655.35,
      clearValidationStyling: vi.fn(),
    },
  }));

  const percentInput = {
    value: '100',
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
  };
  const endInput = {
    value: '65535',
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
  };
  vi.doMock('../../src/js/ui/channel-registry.js', () => ({
    getChannelRow: () => ({
      querySelector: (selector) => {
        if (selector === '.percent-input') return percentInput;
        if (selector === '.end-input') return endInput;
        return null;
      },
    }),
  }));

  vi.doMock('../../src/js/ui/ui-utils.js', () => ({
    formatScalePercent: (value) => value.toString(),
  }));

  vi.doMock('../../src/js/ui/chart-manager.js', () => ({
    setChartStatusMessage: vi.fn(),
  }));

  vi.doMock('../../src/js/ui/ui-hooks.js', () => ({
    triggerInkChartUpdate: vi.fn(),
    triggerPreviewUpdate: vi.fn(),
    triggerSessionStatusUpdate: vi.fn(),
  }));

  vi.doMock('../../src/js/ui/status-service.js', () => ({
    showStatus: vi.fn(),
  }));

  vi.doMock('../../src/js/utils/debug-registry.js', () => ({
    registerDebugNamespace: vi.fn(),
  }));

  vi.doMock('../../src/js/curves/smart-curves.js', () => ({
    rescaleSmartCurveForInkLimit: vi.fn(),
  }));

  vi.doMock('../../src/js/core/scaling-coordinator.js', () => ({
    default: { scale: vi.fn() },
  }));

  const module = await import('../../src/js/core/scaling-utils.js');

  return {
    ...module,
    state,
    setMock,
    batchMock,
    createSelectorMock,
    endInput,
    percentInput,
  };
}

describe('scaling-utils dual write integration', () => {
  it('writes scaling state when coordinator state flag is enabled', async () => {
    const module = await loadScalingUtils();
    module.setScalingStateEnabled(true);

    module.scaleChannelEndsByPercent(80);

    expect(module.state.scaling.globalPercent).toBe(80);
    expect(module.state.scaling.baselines).not.toBeNull();
    expect(module.state.scaling.baselines.MK).toBeGreaterThan(0);
    expect(module.state.scaling.maxAllowed).toBe(100);
    expect(module.state.computed.scaling.isActive).toBe(true);
  });

  it('resets baselines when returning to 100% scale', async () => {
    const module = await loadScalingUtils();
    module.setScalingStateEnabled(true);

    module.scaleChannelEndsByPercent(80);
    module.scaleChannelEndsByPercent(100);

    expect(module.state.scaling.globalPercent).toBe(100);
    expect(module.state.scaling.baselines).toBeNull();
    expect(module.state.scaling.maxAllowed).toBe(1000);
    expect(module.state.computed.scaling.isActive).toBe(false);
  });
});
