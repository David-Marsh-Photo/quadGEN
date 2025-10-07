/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/js/core/scaling-utils.js', () => {
  const mocks = {
    getCurrentScale: vi.fn(() => 100),
    getLegacyScalingSnapshot: vi.fn(() => ({ percent: 100 })),
    restoreLegacyScalingState: vi.fn(),
    validateScalingStateSync: vi.fn(),
    updateScaleBaselineForChannel: vi.fn()
  };
  globalThis.__scalingMocks = mocks;
  return mocks;
});

vi.mock('../../src/js/ui/ui-hooks.js', () => ({
  registerInkChartHandler: vi.fn(),
  triggerInkChartUpdate: vi.fn(),
  registerProcessingDetailHandler: vi.fn(),
  triggerProcessingDetail: vi.fn(),
  triggerProcessingDetailAll: vi.fn(),
  registerProcessingDetailAllHandler: vi.fn(),
  registerRevertButtonsHandler: vi.fn(),
  triggerRevertButtonsUpdate: vi.fn(),
  registerSessionStatusHandler: vi.fn(),
  triggerSessionStatusUpdate: vi.fn(),
  registerPreviewHandler: vi.fn(),
  triggerPreviewUpdate: vi.fn()
}));

import { HistoryManager } from '../../src/js/core/history-manager.js';
import { elements, setLoadedQuadData } from '../../src/js/core/state.js';

function createChannelRow(channel) {
  const tr = document.createElement('tr');
  tr.className = 'channel-row';
  tr.setAttribute('data-channel', channel);

  const percentCell = document.createElement('td');
  const percentInput = document.createElement('input');
  percentInput.className = 'percent-input';
  percentInput.value = '0';
  percentCell.appendChild(percentInput);

  const endCell = document.createElement('td');
  const endInput = document.createElement('input');
  endInput.className = 'end-input';
  endInput.value = '0';
  endCell.appendChild(endInput);

  tr.appendChild(percentCell);
  tr.appendChild(endCell);

  tr._virtualCheckbox = { checked: false };
  tr.refreshDisplayFn = vi.fn();

  return tr;
}

describe('HistoryManager rebase restoration', () => {
  let historyManager;
  let rowsContainer;

  beforeEach(() => {
    document.body.innerHTML = '';
    rowsContainer = document.createElement('tbody');
    rowsContainer.id = 'channelRows';
    rowsContainer.appendChild(createChannelRow('K'));
    document.body.appendChild(rowsContainer);
    elements.rows = rowsContainer;

    const stateManager = {
      subscribe: vi.fn(),
      getEditSelection: vi.fn(() => ({ channel: null, ordinal: 1 })),
      set: vi.fn(),
      batch: vi.fn(),
      get: vi.fn(() => undefined),
      setEditMode: vi.fn()
    };

    historyManager = new HistoryManager(stateManager);

    setLoadedQuadData(null);
    globalThis.__scalingMocks.updateScaleBaselineForChannel.mockClear();
  });

  afterEach(() => {
    elements.rows = null;
    document.body.innerHTML = '';
  });

  it('restores data-base attributes and scaling from rebased snapshots', () => {
    const snapshot = {
      curves: {
        loadedQuadData: {
          channels: ['K'],
          curves: { K: [0, 655, 1310] },
          baselineEnd: { K: 1310 },
          rebasedCurves: { K: [0, 655, 1310] },
          rebasedSources: { K: [0, 655, 1310] },
          originalCurves: { K: [0, 600, 1200] },
          normalizeToEndChannels: {}
        }
      },
      printer: {
        channelValues: { K: { percentage: 42.5, endValue: 1310 } },
        channelStates: { K: { enabled: true } }
      },
      linearization: {
        perChannel: { data: {}, enabled: {} },
        global: {}
      },
      ui: {
        filenames: { perChannelLinearization: {} }
      },
      app: {
        editSelection: { channel: null, ordinal: 1 },
        editMode: false
      }
    };

    historyManager.restoreDomFromSnapshot(snapshot);

    const percentInput = rowsContainer.querySelector('.percent-input');
    const endInput = rowsContainer.querySelector('.end-input');
    expect(percentInput.value).toBe('42.5');
    expect(percentInput.getAttribute('data-base-percent')).toBe('42.5');
    expect(endInput.value).toBe('1310');
    expect(endInput.getAttribute('data-base-end')).toBe('1310');

    expect(globalThis.__scalingMocks.updateScaleBaselineForChannel).toHaveBeenCalledWith('K');
  });
});
