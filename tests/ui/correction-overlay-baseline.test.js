import { describe, expect, test, beforeEach, vi } from 'vitest';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';

vi.mock('../../src/js/core/state.js', () => {
  const elements = {
    inkChart: null,
    rows: { children: [] },
    aiLabelToggle: null
  };
  const loadedData = {
    baselineEnd: { K: 40000 }
  };
  return {
    elements,
    getCurrentPrinter: vi.fn(() => null),
    getAppState: vi.fn(() => ({ showCorrectionOverlay: true })),
    updateAppState: vi.fn(),
    INK_COLORS: {},
    TOTAL: 65535,
    isChannelNormalizedToEnd: vi.fn(() => false),
    getLoadedQuadData: vi.fn(() => loadedData),
    getCorrectionGain: () => 1,
    isReferenceQuadLoaded: () => false
  };
});

vi.mock('../../src/js/core/state-manager.js', () => ({
  getStateManager: () => ({
    get: () => null,
    set: () => null,
    subscribe: () => () => {}
  })
}));

vi.mock('../../src/js/core/validation.js', () => ({
  InputValidator: {
    clampPercent: (value) => Number(value) || 0,
    clampEnd: (value) => Number(value) || 0,
    computePercentFromEnd: (value) => Number(value) || 0,
    clampPercentInput: (value) => Number(value) || 0,
    clampPercentDelta: (value) => Number(value) || 0,
    clampSmartPoint: (input = 0, output = 0) => ({ input: Number(input) || 0, output: Number(output) || 0 })
  }
}));

vi.mock('../../src/js/core/processing-pipeline.js', () => ({
  make256: (endValue = 0) => {
    const numeric = Number(endValue) || 0;
    return Array.from({ length: 256 }, () => numeric);
  }
}));

vi.mock('../../src/js/core/scaling-utils.js', () => ({
  getCurrentScale: () => ({ percent: 100 })
}));

vi.mock('../../src/js/core/scaling-constants.js', () => ({
  SCALING_STATE_FLAG_EVENT: 'scaling-event'
}));

const mockControlPoints = {
  get: () => ({ points: [] }),
  set: () => {},
  persist: () => {},
  nearestIndex: () => 0
};

vi.mock('../../src/js/curves/smart-curves.js', () => ({
  ControlPoints: mockControlPoints,
  isSmartCurve: () => false,
  markLinearizationEdited: () => {}
}));

vi.mock('../../src/js/ui/ui-hooks.js', () => ({
  registerInkChartHandler: () => {},
  registerSessionStatusHandler: () => {},
  registerProcessingDetailHandler: () => {},
  registerProcessingDetailAllHandler: () => {},
  registerRevertButtonsHandler: () => {},
  registerPreviewHandler: () => {},
  triggerPreviewUpdate: () => {},
  triggerProcessingDetail: () => {},
  triggerProcessingDetailAll: () => {},
  triggerRevertButtonsUpdate: () => {},
  triggerInkChartUpdate: () => {},
  triggerSessionStatusUpdate: () => {}
}));

vi.mock('../../src/js/ui/status-service.js', () => ({
  showStatus: () => {}
}));

vi.mock('../../src/js/core/feature-flags.js', () => ({
  isSmartPointDragEnabled: () => false
}));

vi.mock('../../src/js/core/channel-locks.js', () => ({
  isChannelLocked: () => false,
  getChannelLockEditMessage: () => 'locked'
}));

vi.mock('../../src/js/ui/edit-mode.js', () => ({
  beginSmartPointDrag: () => {},
  updateSmartPointDrag: () => {},
  endSmartPointDrag: () => {},
  cancelSmartPointDrag: () => {},
  isSmartPointDragActive: () => false,
  selectSmartPointOrdinal: () => {}
}));

vi.mock('../../src/js/ui/drag-utils.js', () => ({
  normalizeDragOutputToAbsolute: (value) => value
}));

vi.mock('../../src/js/ui/processing-status.js', () => ({
  updateProcessingDetail: () => {},
  updateAllProcessingDetails: () => {}
}));

vi.mock('../../src/js/core/composite-debug.js', () => ({
  subscribeCompositeDebugState: () => () => {},
  getCompositeDebugState: () => null
}));

vi.mock('../../src/js/core/light-blocking.js', () => ({
  computeLightBlockingCurve: () => ({ curve: [0, 0], maxValue: 0, contributingChannels: [] }),
  isLightBlockingOverlayEnabled: () => false,
  setLightBlockingOverlayEnabled: () => {},
  clearLightBlockingCache: () => {}
}));

vi.mock('../../src/js/ui/chart-renderer.js', () => ({
  drawChartAxes: () => {},
  drawCurve: () => ({}),
  renderChartFrame: () => {},
  drawSmartKeyPointOverlays: () => {},
  drawInkLevelGradient: () => ({ height: 100 }),
  drawInputLevelGradient: () => ({ width: 100 }),
  drawAxisLabels: () => {},
  drawAxisTitles: () => {},
  getTickValues: () => [0, 50, 100]
}));

function createStubContext() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 42 })),
    globalAlpha: 1,
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: ''
  };
  return ctx;
}

const geom = {
  displayMax: 100,
  leftPadding: 0,
  chartWidth: 100,
  padding: 0,
  bottomPadding: 0,
  height: 100,
  chartHeight: 100
};

describe('Correction overlay baseline handling', () => {
  beforeEach(() => {
    LinearizationState.clear();
    LinearizationState.setGlobalData({
      samples: [0, 0.25, 0.5, 0.75, 1],
      domainMin: 0,
      domainMax: 1
    }, true);
  });

  test('baseline reference is not exported with the correction overlay', async () => {
    const { __testRenderCorrectionOverlay } = await import('../../src/js/ui/chart-manager.js');
    const ctx = createStubContext();
    const overlay = __testRenderCorrectionOverlay(ctx, geom);
    expect(overlay).toBeTruthy();
    expect(Array.isArray(overlay.samples)).toBe(true);
    expect(Array.isArray(overlay.baseline)).toBe(true);
    expect(overlay.baseline).toHaveLength(2);
    expect(overlay.baseline[0]).toEqual({ input: 0, output: 0 });
    expect(overlay.baseline[1]?.input).toBe(100);
    expect(overlay.baseline[1]?.output).toBeCloseTo(overlay.effectiveMaxPercent, 5);
    const dashCalls = ctx.setLineDash.mock.calls;
    const hasBaselineDash = dashCalls.some((args) => Array.isArray(args) && args.length > 0 && Array.isArray(args[0]) && args[0][0] === 4 && args[0][1] === 4);
    expect(hasBaselineDash).toBe(true);
  });

  test('light blocking overlay renders without dashed reference guide', async () => {
    const { __testRenderLightBlockingOverlay } = await import('../../src/js/ui/chart-manager.js');
    const ctx = createStubContext();
    const overlay = {
      curve: [0, 10, 20, 35, 50, 65, 80, 90, 100],
      maxValue: 72.5,
      contributingChannels: ['K']
    };
    __testRenderLightBlockingOverlay(ctx, geom, overlay);
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });
});
