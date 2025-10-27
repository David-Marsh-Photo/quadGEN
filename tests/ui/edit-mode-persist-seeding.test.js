/** @vitest-environment jsdom */
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/js/ui/ui-hooks.js', () => ({
  registerInkChartHandler: vi.fn(),
  triggerInkChartUpdate: vi.fn(),
  registerProcessingDetailHandler: vi.fn(),
  triggerProcessingDetail: vi.fn(),
  registerProcessingDetailAllHandler: vi.fn(),
  triggerProcessingDetailAll: vi.fn(),
  registerRevertButtonsHandler: vi.fn(),
  triggerRevertButtonsUpdate: vi.fn(),
  registerSessionStatusHandler: vi.fn(),
  triggerSessionStatusUpdate: vi.fn(),
  registerPreviewHandler: vi.fn(),
  triggerPreviewUpdate: vi.fn()
}));

vi.mock('../../src/js/ui/bell-shift-controls.js', () => ({
  initializeBellShiftControls: vi.fn(),
  updateBellShiftControl: vi.fn()
}));

vi.mock('../../src/js/ui/bell-width-controls.js', () => ({
  initializeBellWidthControls: vi.fn(),
  updateBellWidthControls: vi.fn()
}));

vi.mock('../../src/js/core/state-manager.js', () => ({
  getStateManager: () => null
}));

vi.mock('../../src/js/ui/graph-status.js', () => ({
  updateSessionStatus: vi.fn()
}));

vi.mock('../../src/js/core/history-manager.js', async () => {
  const actual = await vi.importActual('../../src/js/core/history-manager.js');
  return {
    ...actual,
    getHistoryManager: () => null
  };
});

import { elements, ensureLoadedQuadData, setLoadedQuadData } from '../../src/js/core/state.js';
import { ControlPoints, createDefaultKeyPoints, toAbsoluteOutput } from '../../src/js/curves/smart-curves.js';
import { __TEST_ONLY__ } from '../../src/js/ui/edit-mode.js';

const { seedChannelFromSamples } = __TEST_ONLY__;

const CURVE_RESOLUTION = 256;

function readKChannelSamples() {
  const lines = readFileSync(resolve('data/KCLK.quad'), 'utf8').split(/\r?\n/);
  const values = [];
  for (const line of lines) {
    if (line.startsWith('# C curve')) break;
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      values.push(Number(trimmed));
    }
  }
  if (values.length !== CURVE_RESOLUTION) {
    throw new Error(`Unexpected sample count ${values.length}`);
  }
  return values;
}

describe('Edit Mode Smart seeding preserves absolute amplitudes', () => {
  const plateauSamples = readKChannelSamples();

  beforeEach(() => {
    document.body.innerHTML = `
      <table>
        <tbody id="channelRows">
          <tr class="channel-row" data-channel="K">
            <td><input class="percent-input" value="14" data-base-percent="14" /></td>
            <td><input class="end-input" value="9175" data-base-end="9175" /></td>
          </tr>
        </tbody>
      </table>
    `;

    elements.rows = document.getElementById('channelRows');
    elements.editModeToggleBtn = document.createElement('button');
    elements.editModeLabel = document.createElement('span');
    elements.editChannelSelect = document.createElement('select');
    elements.editPanelBody = document.createElement('div');
    elements.editChannelState = document.createElement('div');
    elements.editChannelPrev = document.createElement('button');
    elements.editChannelNext = document.createElement('button');
    elements.editRecomputeBtn = document.createElement('button');
    elements.editPointIndex = document.createElement('span');

    const loaded = ensureLoadedQuadData(() => ({
      curves: {},
      sources: {},
      keyPoints: {},
      keyPointsMeta: {},
      originalCurves: {},
      rebasedCurves: {},
      baselineEnd: {}
    }));
    loaded.curves.K = plateauSamples.slice();
    loaded.originalCurves.K = plateauSamples.slice();
    loaded.rebasedCurves.K = plateauSamples.slice();
    loaded.baselineEnd.K = plateauSamples[plateauSamples.length - 1];
    loaded.sources.K = 'quad';

    ControlPoints.persist('K', createDefaultKeyPoints());
  });

  afterEach(() => {
    ControlPoints.persist('K', createDefaultKeyPoints());
    setLoadedQuadData(null);
    elements.rows = null;
    elements.editModeToggleBtn = null;
    elements.editModeLabel = null;
    elements.editChannelSelect = null;
    elements.editPanelBody = null;
    elements.editChannelState = null;
    elements.editChannelPrev = null;
    elements.editChannelNext = null;
    elements.editRecomputeBtn = null;
    elements.editPointIndex = null;
    document.body.innerHTML = '';
  });

  it('stores Smart points whose relative outputs exceed the ink limit while absolute stays intact', () => {
    const success = seedChannelFromSamples('K', plateauSamples.slice(), 'unit-test');
    expect(success).toBe(true);

    const entry = ControlPoints.get('K');
    expect(entry).toBeTruthy();
    const points = entry?.points || [];
    expect(points.length).toBeGreaterThan(2);

    const lastPoint = points[points.length - 1];
    expect(lastPoint).toBeTruthy();
    expect(Number(lastPoint.output)).toBeGreaterThan(95);
    expect(Number(lastPoint.output)).toBeCloseTo(100, 2);

    const absolute = toAbsoluteOutput('K', Number(lastPoint.output));
    const channelPercent = 14;
    expect(absolute).toBeCloseTo(channelPercent, 3);
    expect(absolute).toBeLessThanOrEqual(channelPercent + 0.01);
  });
});
