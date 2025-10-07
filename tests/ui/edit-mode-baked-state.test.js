/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/js/ui/ui-hooks.js', () => {
  const mocks = {
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
  };
  globalThis.__uiHookMocks = mocks;
  return mocks;
});

import { setGlobalBakedState } from '../../src/js/ui/edit-mode.js';
import { elements } from '../../src/js/core/state.js';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';

describe('setGlobalBakedState processing updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <span id="globalName"></span>
      <button id="globalToggle"></button>
      <table>
        <tbody>
          <tr class="channel-row" data-channel="K"><td></td></tr>
          <tr class="channel-row" data-channel="C"><td></td></tr>
        </tbody>
      </table>
    `;

    elements.globalLinearizationFilename = document.getElementById('globalName');
    elements.globalLinearizationToggle = document.getElementById('globalToggle');

    window.graphStatus = {
      updateProcessingDetail: vi.fn()
    };

    LinearizationState.globalData = {
      filename: 'negative.cube',
      format: '1D LUT',
      samples: [0, 65535]
    };
    LinearizationState.globalApplied = true;
    LinearizationState.globalBakedMeta = null;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    globalThis.__uiHookMocks.triggerProcessingDetailAll.mockReset();
    globalThis.__uiHookMocks.triggerProcessingDetail.mockReset();
    globalThis.__uiHookMocks.triggerRevertButtonsUpdate.mockReset();
    document.body.innerHTML = '';
    elements.globalLinearizationFilename = null;
    elements.globalLinearizationToggle = null;
    delete window.graphStatus;
  });

  it('invokes processing detail refreshers when marking baked', () => {
    setGlobalBakedState({ filename: 'negative.cube' });

    expect(elements.globalLinearizationFilename.textContent).toBe('*BAKED* negative.cube');
    expect(elements.globalLinearizationToggle.dataset.baked).toBe('true');

    expect(globalThis.__uiHookMocks.triggerProcessingDetailAll).toHaveBeenCalledTimes(1);
    expect(globalThis.__uiHookMocks.triggerRevertButtonsUpdate).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(window.graphStatus.updateProcessingDetail).toHaveBeenCalledWith('K');
    expect(window.graphStatus.updateProcessingDetail).toHaveBeenCalledWith('C');
  });
});
