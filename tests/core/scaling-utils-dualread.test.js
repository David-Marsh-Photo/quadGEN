import { describe, it, expect, vi } from 'vitest';

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
    TOTAL: 65535,
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

  const createInput = (initialValue) => {
    const attributes = new Map();
    return {
      value: initialValue,
      classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
      setAttribute: (name, value) => {
        attributes.set(name, String(value));
      },
      getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
      removeAttribute: (name) => {
        attributes.delete(name);
      }
    };
  };

  const percentInput = createInput('100');
  percentInput.setAttribute('data-base-percent', '100');
  const endInput = createInput('65535');
  endInput.setAttribute('data-base-end', '65535');
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
    registerInkChartHandler: vi.fn(),
    registerPreviewHandler: vi.fn(),
    registerSessionStatusHandler: vi.fn(),
    registerProcessingDetailHandler: vi.fn(),
    registerProcessingDetailAllHandler: vi.fn(),
    registerRevertButtonsHandler: vi.fn(),
    triggerInkChartUpdate: vi.fn(),
    triggerPreviewUpdate: vi.fn(),
    triggerSessionStatusUpdate: vi.fn(),
    triggerProcessingDetail: vi.fn(),
    triggerProcessingDetailAll: vi.fn(),
    triggerRevertButtonsUpdate: vi.fn(),
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
    percentInput,
    endInput,
  };
}

describe('scaling-utils dual-read expectations', () => {
  it('prefers state-managed global percent when dual-read flag is enabled', async () => {
    const module = await loadScalingUtils();

    module.setScalingStateEnabled(true);
    module.scaleChannelEndsByPercent(120);

    module.state.scaling.globalPercent = 85;

    expect(module.getCurrentScale()).toBe(85);
  });
});

describe('scaling-utils parity validator', () => {
  it('records parity audits and surfaces mismatches', async () => {
    const module = await loadScalingUtils();

    module.setScalingStateEnabled(true);

    expect(typeof module.validateScalingStateSync).toBe('function');
    expect(typeof module.getScalingStateAudit).toBe('function');

    module.scaleChannelEndsByPercent(150);

    const audit = module.getScalingStateAudit();
    expect(audit).toBeDefined();
    expect(audit.totalChecks).toBeGreaterThan(0);
    expect(audit.mismatchCount).toBe(0);

    module.state.scaling.globalPercent = 180;

    expect(() => module.validateScalingStateSync()).toThrowErrorMatchingInlineSnapshot(
      `[Error: Scaling state mismatch detected]`
    );

    const mismatchAudit = module.getScalingStateAudit();
    expect(mismatchAudit.mismatchCount).toBeGreaterThan(0);
    expect(mismatchAudit.lastMismatchDelta).toBeGreaterThan(0);
  });

  it('keeps validator clean when clamping back to 100%', async () => {
    const module = await loadScalingUtils();

    module.setScalingStateEnabled(true);

    const first = module.scaleChannelEndsByPercent(48);
    expect(first.success).toBe(true);

    const second = module.scaleChannelEndsByPercent(28);
    expect(second.success).toBe(true);

    const result = module.scaleChannelEndsByPercent(240);
    expect(result.success).toBe(true);

    const audit = module.getScalingStateAudit();
    expect(audit.mismatchCount).toBe(0);
    expect(audit.lastMismatchDetail).toBeNull();
  });
});
