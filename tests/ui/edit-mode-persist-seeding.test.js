/** @vitest-environment jsdom */
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

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
import { LinearizationState } from '../../src/js/data/linearization-utils.js';
import { ControlPoints, createDefaultKeyPoints, toAbsoluteOutput } from '../../src/js/curves/smart-curves.js';
import { setEditMode, reinitializeChannelSmartCurves, __TEST_ONLY__ } from '../../src/js/ui/edit-mode.js';
import { getDebugRegistry } from '../../src/js/utils/debug-registry.js';

const { seedChannelFromSamples } = __TEST_ONLY__;

const CURVE_RESOLUTION = 256;

function buildPlateauCurve(endValue, plateauEndIndex = 155) {
  const samples = new Array(CURVE_RESOLUTION).fill(0);
  for (let i = plateauEndIndex; i < CURVE_RESOLUTION; i += 1) {
    const progress = (i - plateauEndIndex) / (CURVE_RESOLUTION - 1 - plateauEndIndex);
    samples[i] = Math.round(endValue * progress);
  }
  samples[CURVE_RESOLUTION - 1] = endValue;
  return samples;
}

describe('Edit Mode Smart seeding preserves absolute amplitudes', () => {
  const plateauSamples = buildPlateauCurve(9175);

  beforeEach(() => {
    document.body.innerHTML = `
      <table>
        <tbody id="channelRows">
          <tr class="channel-row" data-channel="K">
            <td><input class="percent-input" value="14" data-base-percent="14" /></td>
            <td><input class="end-input" value="9175" data-base-end="9175" /></td>
            <td><input type="checkbox" class="per-channel-toggle" checked /></td>
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

    const option = document.createElement('option');
    option.value = 'K';
    option.textContent = 'K';
    elements.editChannelSelect.appendChild(option);

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

    LinearizationState.clear();
    setEditMode(false);
    ControlPoints.persist('K', createDefaultKeyPoints());
  });

  afterEach(() => {
    setEditMode(false);
    const registry = getDebugRegistry();
    delete registry.processingPipeline;
    LinearizationState.clear();
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

  it('rebuilds measurement-based Smart points without disturbing the loaded baseline', () => {
    const normalizedPlateau = plateauSamples.map((value) => (value > 0 ? value / 9175 : 0));
    LinearizationState.setGlobalData({
      format: 'LAB TXT',
      filename: 'global-measurements.txt',
      originalData: Array.from({ length: 6 }, (_, index) => ({ input: index * 20 })),
      samples: normalizedPlateau
    }, true);

    getDebugRegistry().processingPipeline = {
      make256: vi.fn(() => null)
    };

    setEditMode(true);
    ControlPoints.persist('K', createDefaultKeyPoints());

    const data = ensureLoadedQuadData();
    data.keyPointsMeta.K = { interpolationType: 'smooth' };
    reinitializeChannelSmartCurves('K', { forceIfEditModeEnabling: true });

    const { points } = ControlPoints.get('K');
    expect(points.length).toBeGreaterThan(2);
    expect(points.at(-1).output).toBeCloseTo(100, 5);
    expect(data.baselineEnd.K).toBe(9175);
    expect(data.keyPointsMeta.K?.smartTouched).toBeUndefined();
    expect(elements.rows.querySelector('.end-input').value).toBe('9175');
  });
});
