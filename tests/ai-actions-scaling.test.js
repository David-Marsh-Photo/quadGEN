import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scaleMock = vi.fn();

vi.mock('../src/js/core/scaling-coordinator.js', () => ({
  default: {
    scale: scaleMock,
  },
}));

vi.mock('../src/js/core/state.js', () => ({
  elements: {},
  getCurrentPrinter: vi.fn(() => ({ channels: ['K'] })),
  getCurrentState: vi.fn(() => ({})),
  updateAppState: vi.fn(),
  getAppState: vi.fn(() => ({})),
  getLoadedQuadData: vi.fn(() => null),
  PRINTERS: { P700P900: { channels: ['K'] } },
}));

vi.mock('../src/js/core/validation.js', () => ({
  InputValidator: {
    clampPercent: (value) => Number(value),
    computeEndFromPercent: (value) => Number(value) * 100,
    clampEnd: (value) => Number(value) || 0,
    computePercentFromEnd: (value) => Number(value) / 100,
    clearValidationStyling: vi.fn(),
  },
}));

vi.mock('../src/js/core/processing-pipeline.js', () => ({
  buildFile: vi.fn(() => new Array(256).fill(0)),
}));

vi.mock('../src/js/ui/chart-manager.js', () => ({
  updateInkChart: vi.fn(),
}));

vi.mock('../src/js/ui/processing-status.js', () => ({
  updateProcessingDetail: vi.fn(),
}));

vi.mock('../src/js/ui/status-service.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../src/js/ui/ui-hooks.js', () => ({
  registerRevertButtonsHandler: vi.fn(),
  registerSessionStatusHandler: vi.fn(),
  registerInkChartHandler: vi.fn(),
  registerProcessingDetailAllHandler: vi.fn(),
  registerProcessingDetailHandler: vi.fn(),
  registerPreviewHandler: vi.fn(),
  triggerRevertButtonsUpdate: vi.fn(),
  triggerSessionStatusUpdate: vi.fn(),
  triggerInkChartUpdate: vi.fn(),
  triggerProcessingDetailAll: vi.fn(),
  triggerProcessingDetail: vi.fn(),
  triggerPreviewUpdate: vi.fn(),
}));

vi.mock('../src/js/curves/smart-curves.js', () => ({
  insertSmartKeyPointAt: vi.fn(),
  deleteSmartKeyPointByIndex: vi.fn(),
  adjustSmartKeyPointByIndex: vi.fn(),
  simplifySmartKeyPointsFromCurve: vi.fn(() => []),
  rescaleSmartCurveForInkLimit: vi.fn(),
}));

vi.mock('../src/js/data/linearization-utils.js', () => ({
  LinearizationState: {
    hasAnyLinearization: vi.fn(() => false),
    setGlobalData: vi.fn(),
    setPerChannelData: vi.fn(),
    clearGlobalData: vi.fn(),
    clearPerChannelData: vi.fn(),
    isPerChannelEnabled: vi.fn(() => false),
  },
  normalizeLinearizationEntry: vi.fn((entry) => entry),
  getEditedDisplayName: vi.fn(() => 'Test Display'),
  getBasePointCountLabel: vi.fn(() => '5 points'),
}));

vi.mock('../src/js/data/lab-parser.js', () => ({
  parseLabData: vi.fn(),
  applyDefaultLabSmoothingToEntry: vi.fn((entry) => entry),
}));

vi.mock('../src/js/parsers/file-parsers.js', () => ({
  parseManualLstarData: vi.fn(() => ({ samples: [] })),
}));

vi.mock('../src/js/ui/printer-manager.js', () => ({
  setPrinter: vi.fn(),
}));

vi.mock('../src/js/ui/revert-controls.js', () => ({
  computeGlobalRevertState: vi.fn(() => ({ hasMeasurement: false })),
  resetSmartPointsForChannels: vi.fn(),
  resetChannelSmartPointsToMeasurement: vi.fn(),
}));

describe('QuadGenActions.scaleChannelEndsByPercent', () => {
  let QuadGenActions;

  beforeEach(async () => {
    scaleMock.mockReset();
    const module = await import('../src/js/ai/ai-actions.js');
    QuadGenActions = module.QuadGenActions;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes scaling requests through the coordinator with high priority and metadata', async () => {
    scaleMock.mockResolvedValue({ success: true, message: 'ok' });
    const actions = new QuadGenActions();
    vi.spyOn(actions, '_updateGraphStatus').mockImplementation(() => {});

    const result = await actions.scaleChannelEndsByPercent(125);

    expect(scaleMock).toHaveBeenCalledWith(125, 'ai', expect.objectContaining({
      priority: 'high',
      metadata: expect.objectContaining({ trigger: 'ai-scale_command' }),
    }));
    expect(result).toEqual({ success: true, message: 'ok', details: undefined });
  });

  it('propagates coordinator failure without forcing success', async () => {
    scaleMock.mockResolvedValue({ success: false, message: 'nope' });
    const actions = new QuadGenActions();
    vi.spyOn(actions, '_updateGraphStatus').mockImplementation(() => {});

    const result = await actions.scaleChannelEndsByPercent(80);

    expect(result.success).toBe(false);
    expect(result.message).toBe('nope');
  });
});
