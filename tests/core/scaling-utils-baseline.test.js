import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const mockChannelRows = {};
const mockRescaleCalls = [];
const stateStore = new Map();
const stateManagerStub = {
  set: vi.fn((path, value) => {
    stateStore.set(path, value);
  }),
  get: vi.fn((path) => stateStore.get(path)),
  setChannelValue: vi.fn(),
  setPrinter: vi.fn(),
  batch: vi.fn((fn) => {
    if (typeof fn === 'function') {
      fn();
    }
  }),
  createSelector: vi.fn((paths, computeFn) => {
    const deps = Array.isArray(paths) ? paths : [paths];
    return () => {
      const values = deps.map((dep) => stateStore.get(dep));
      return computeFn(...values);
    };
  })
};
const historyStub = {
  recordBatchAction: vi.fn()
};

vi.mock('../../src/js/ui/channel-registry.js', () => ({
  getChannelRow: (name) => mockChannelRows[name] ?? null,
}));

vi.mock('../../src/js/ui/ui-hooks.js', () => ({
  triggerInkChartUpdate: vi.fn(),
  triggerPreviewUpdate: vi.fn(),
  triggerSessionStatusUpdate: vi.fn(),
  triggerProcessingDetail: vi.fn(),
  triggerRevertButtonsUpdate: vi.fn(),
}));

vi.mock('../../src/js/ui/status-service.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../src/js/ui/chart-manager.js', () => ({
  setChartStatusMessage: vi.fn(),
}));

vi.mock('../../src/js/curves/smart-curves.js', () => ({
  rescaleSmartCurveForInkLimit: vi.fn((channel, prevPercent, newPercent) => {
    mockRescaleCalls.push({ channel, prevPercent, newPercent });
    return { points: [], metadata: {}, warnings: [] };
  }),
}));

vi.mock('../../src/js/core/state-manager.js', () => ({
  getStateManager: () => stateManagerStub,
}));

vi.mock('../../src/js/core/history-manager.js', () => ({
  getHistoryManager: () => historyStub,
  beginHistoryTransaction: vi.fn(),
  commitHistoryTransaction: vi.fn(),
  rollbackHistoryTransaction: vi.fn(),
}));

vi.mock('../../src/js/legacy/state-bridge.js', () => ({
  getLegacyStateBridge: () => ({
    setLoadedQuadData: vi.fn(),
    getLoadedQuadData: vi.fn(() => null),
    setEditModeFlag: vi.fn(),
    getEditModeFlag: vi.fn(() => null),
    registerHelpers: vi.fn(),
  }),
}));

describe('scaling-utils baseline cache behavior', () => {
  let dom;
  let elements;
  let scalingUtils;
  let percentInput;
  let endInput;
  let secondaryPercentInput;
  let secondaryEndInput;
  let baseEnd;
  let inputValidator;

  async function importScalingUtils() {
    scalingUtils = await import('../../src/js/core/scaling-utils.js');
    return scalingUtils;
  }

  beforeEach(async () => {
    vi.resetModules();
    mockRescaleCalls.length = 0;
    Object.keys(mockChannelRows).forEach((key) => { delete mockChannelRows[key]; });
    stateStore.clear();
    stateManagerStub.set.mockClear();
    stateManagerStub.get.mockClear();
    stateManagerStub.setChannelValue.mockClear();
    stateManagerStub.setPrinter.mockClear();
    stateManagerStub.batch.mockClear();
    stateManagerStub.createSelector.mockClear();
    historyStub.recordBatchAction.mockClear();

    dom = new JSDOM('<!doctype html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;

    ({ elements } = await import('../../src/js/core/state.js'));
    ({ InputValidator: inputValidator } = await import('../../src/js/core/validation.js'));

    const scaleInput = document.createElement('input');
    scaleInput.id = 'scaleAllInput';
    scaleInput.type = 'number';
    scaleInput.value = '100';
    document.body.appendChild(scaleInput);
    elements.scaleAllInput = scaleInput;

    const rowsContainer = document.createElement('tbody');
    rowsContainer.id = 'rows';
    document.body.appendChild(rowsContainer);
    elements.rows = rowsContainer;

    function createRow(channel) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-channel', channel);

      const percentCell = document.createElement('td');
      const percent = document.createElement('input');
      percent.className = 'percent-input';
      percent.type = 'number';
      percent.value = '100';
      percent.setAttribute('data-base-percent', percent.value);
      percentCell.appendChild(percent);

      const endCell = document.createElement('td');
      const end = document.createElement('input');
      end.className = 'end-input';
      end.type = 'number';
      end.value = '65535';
      end.setAttribute('data-base-end', end.value);
      endCell.appendChild(end);

      tr.appendChild(percentCell);
      tr.appendChild(endCell);
      rowsContainer.appendChild(tr);
      mockChannelRows[channel] = tr;
      return { percent, end };
    }

    ({ percent: percentInput, end: endInput } = createRow('MK'));
    ({ percent: secondaryPercentInput, end: secondaryEndInput } = createRow('C'));

    await importScalingUtils();

    baseEnd = Number(endInput.value);
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.navigator;
  });

  it('clears baseline when scaling back to 100%', () => {
    const { scaleChannelEndsByPercent, getCurrentScale, resetGlobalScale } = scalingUtils;

    const result80 = scaleChannelEndsByPercent(80);
    expect(result80.success).toBe(true);
    expect(getCurrentScale()).toBe(80);
    expect(Number(percentInput.value)).toBeCloseTo(80, 5);
    expect(Number(endInput.value)).toBe(Math.round(baseEnd * 0.8));

    const result100 = scaleChannelEndsByPercent(100);
    expect(result100.success).toBe(true);
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(100, 5);
    expect(Number(endInput.value)).toBe(baseEnd);

    const result90 = scaleChannelEndsByPercent(90);
    expect(result90.success).toBe(true);
    expect(getCurrentScale()).toBe(90);
    expect(Number(percentInput.value)).toBeCloseTo(90, 5);
    expect(Number(endInput.value)).toBe(Math.round(baseEnd * 0.9));
  });

  it('resetGlobalScale restores global scale slider without mutating channel values', () => {
    const { scaleChannelEndsByPercent, getCurrentScale, resetGlobalScale } = scalingUtils;

    const result70 = scaleChannelEndsByPercent(70);
    expect(result70.success).toBe(true);
    expect(getCurrentScale()).toBe(70);
    expect(Number(endInput.value)).toBe(Math.round(baseEnd * 0.7));

    resetGlobalScale();
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(70, 5);
    expect(Number(endInput.value)).toBe(Math.round(baseEnd * 0.7));
  });

  it('caps applied scaling at ink maximum when requesting >100%', () => {
    const { scaleChannelEndsByPercent, getCurrentScale } = scalingUtils;

    const result120 = scaleChannelEndsByPercent(120);
    expect(result120.success).toBe(true);
    expect(result120.details.scalePercent).toBe(100);
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(100, 5);
    expect(Number(endInput.value)).toBe(baseEnd);
  });

  it('recomputes baseline after manual percent edit before next scale', () => {
    const { scaleChannelEndsByPercent, getCurrentScale, updateScaleBaselineForChannel } = scalingUtils;

    scaleChannelEndsByPercent(50);
    expect(getCurrentScale()).toBe(50);

    percentInput.value = '65';
    percentInput.setAttribute('data-base-percent', '65');
    const manualEnd = inputValidator.computeEndFromPercent(65);
    endInput.value = String(manualEnd);
    endInput.setAttribute('data-base-end', String(manualEnd));
    updateScaleBaselineForChannel('MK');

    const result80 = scaleChannelEndsByPercent(80);
    expect(result80.success).toBe(true);
    expect(getCurrentScale()).toBe(80);
    expect(Number(percentInput.value)).toBeCloseTo(80, 5);
    const recomputedBase = Math.min(65535, Math.round(manualEnd / 0.5));
    const expectedEnd = Math.round(recomputedBase * 0.8);
    expect(Number(endInput.value)).toBe(expectedEnd);
  });

  it('ignores scaling for zero-endpoint channels', () => {
    const { scaleChannelEndsByPercent, getCurrentScale } = scalingUtils;

    percentInput.value = '0';
    percentInput.setAttribute('data-base-percent', '0');
    endInput.value = '0';
    endInput.setAttribute('data-base-end', '0');

    const result = scaleChannelEndsByPercent(150);
    expect(result.success).toBe(true);
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(0, 5);
    expect(Number(endInput.value)).toBe(0);
  });

  it('returns error for invalid scale input without mutating state', () => {
    const { scaleChannelEndsByPercent, getCurrentScale } = scalingUtils;

    const result = scaleChannelEndsByPercent('not-a-number');
    expect(result.success).toBe(false);
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(100, 5);
    expect(Number(endInput.value)).toBe(baseEnd);
  });

  it('maintains independent baselines across channels', () => {
    const { scaleChannelEndsByPercent, getCurrentScale } = scalingUtils;

    scaleChannelEndsByPercent(80);
    expect(getCurrentScale()).toBe(80);

    secondaryPercentInput.value = '40';
    secondaryPercentInput.setAttribute('data-base-percent', '40');
    secondaryEndInput.value = String(inputValidator.computeEndFromPercent(40));
    secondaryEndInput.setAttribute('data-base-end', secondaryEndInput.value);
    scalingUtils.updateScaleBaselineForChannel('C');

    const result60 = scaleChannelEndsByPercent(60);
    expect(result60.success).toBe(true);
    expect(getCurrentScale()).toBe(60);
    expect(Number(percentInput.value)).toBeCloseTo(60, 5);
    expect(Number(secondaryPercentInput.value)).toBeCloseTo(30, 5);
  });

  it('computes baselines from current values on first scale operation', () => {
    const { scaleChannelEndsByPercent, getCurrentScale } = scalingUtils;

    percentInput.value = '70';
    percentInput.setAttribute('data-base-percent', '70');
    const manualEnd = inputValidator.computeEndFromPercent(70);
    endInput.value = String(manualEnd);
    endInput.setAttribute('data-base-end', String(manualEnd));
    secondaryPercentInput.value = '70';
    secondaryPercentInput.setAttribute('data-base-percent', '70');
    secondaryEndInput.value = String(inputValidator.computeEndFromPercent(70));
    secondaryEndInput.setAttribute('data-base-end', secondaryEndInput.value);

    const result = scaleChannelEndsByPercent(140);
    expect(result.success).toBe(true);
    expect(getCurrentScale()).toBe(140);

    const expectedEnd = Math.round(manualEnd * 1.4);
    expect(Number(endInput.value)).toBe(expectedEnd);
    const expectedPercent = (expectedEnd / 65535) * 100;
    expect(Number(percentInput.value)).toBeCloseTo(expectedPercent, 2);
  });

  it('reuses cached baseline on subsequent scaling operations', () => {
    const { scaleChannelEndsByPercent, getCurrentScale, updateScaleBaselineForChannel } = scalingUtils;

    percentInput.value = '80';
    percentInput.setAttribute('data-base-percent', '80');
    const baseEnd = inputValidator.computeEndFromPercent(80);
    endInput.value = String(baseEnd);
    endInput.setAttribute('data-base-end', String(baseEnd));
    updateScaleBaselineForChannel('MK');
    secondaryPercentInput.value = '80';
    secondaryPercentInput.setAttribute('data-base-percent', '80');
    secondaryEndInput.value = String(inputValidator.computeEndFromPercent(80));
    secondaryEndInput.setAttribute('data-base-end', secondaryEndInput.value);
    updateScaleBaselineForChannel('C');

    const upResult = scaleChannelEndsByPercent(110);
    expect(upResult.success).toBe(true);
    expect(getCurrentScale()).toBe(110);
    const expectedUpEnd = Math.round(baseEnd * 1.1);
    expect(Number(endInput.value)).toBe(expectedUpEnd);

    const downResult = scaleChannelEndsByPercent(90);
    expect(downResult.success).toBe(true);
    expect(getCurrentScale()).toBe(90);
    const expectedDownEnd = Math.round(baseEnd * 0.9);
    expect(Number(endInput.value)).toBe(expectedDownEnd);
  });

  it('honors ink-maximum guard when cached baseline would exceed 65535', () => {
    const { scaleChannelEndsByPercent, getCurrentScale, updateScaleBaselineForChannel } = scalingUtils;

    percentInput.value = '80';
    percentInput.setAttribute('data-base-percent', '80');
    const baseEnd = inputValidator.computeEndFromPercent(80);
    endInput.value = String(baseEnd);
    endInput.setAttribute('data-base-end', String(baseEnd));
    updateScaleBaselineForChannel('MK');
    secondaryPercentInput.value = '80';
    secondaryPercentInput.setAttribute('data-base-percent', '80');
    secondaryEndInput.value = String(inputValidator.computeEndFromPercent(80));
    secondaryEndInput.setAttribute('data-base-end', secondaryEndInput.value);
    updateScaleBaselineForChannel('C');

    const firstRamp = scaleChannelEndsByPercent(130);
    expect(firstRamp.success).toBe(true);
    expect(getCurrentScale()).toBe(125);
    expect(Number(endInput.value)).toBe(65535);

    const guardResult = scaleChannelEndsByPercent(110);
    expect(guardResult.success).toBe(true);
    expect(getCurrentScale()).toBe(110);
    const expectedEnd = Math.round(baseEnd * 1.1);
    expect(Number(endInput.value)).toBe(expectedEnd);
  });

  it('returns error for zero or negative scale requests without mutating state', () => {
    const { scaleChannelEndsByPercent, getCurrentScale } = scalingUtils;

    const zero = scaleChannelEndsByPercent(0);
    expect(zero.success).toBe(false);
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(100, 5);
    expect(Number(endInput.value)).toBe(baseEnd);

    const negative = scaleChannelEndsByPercent(-25);
    expect(negative.success).toBe(false);
    expect(getCurrentScale()).toBe(100);
    expect(Number(percentInput.value)).toBeCloseTo(100, 5);
    expect(Number(endInput.value)).toBe(baseEnd);
  });

  it('maintains lower-bound guard for zeroed channels while scaled below 100%', () => {
    const { scaleChannelEndsByPercent, getCurrentScale, updateScaleBaselineForChannel } = scalingUtils;

    const initialDown = scaleChannelEndsByPercent(50);
    expect(initialDown.success).toBe(true);
    expect(getCurrentScale()).toBe(50);

    percentInput.value = '0';
    percentInput.setAttribute('data-base-percent', '0');
    endInput.value = '0';
    endInput.setAttribute('data-base-end', '0');
    updateScaleBaselineForChannel('MK');

    const furtherDown = scaleChannelEndsByPercent(40);
    expect(furtherDown.success).toBe(true);
    expect(getCurrentScale()).toBe(40);
    expect(Number(percentInput.value)).toBeCloseTo(0, 5);
    expect(Number(endInput.value)).toBe(0);
  });
});
