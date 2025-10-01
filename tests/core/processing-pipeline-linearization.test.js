import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const perEntry = {
  format: 'LAB',
  samples: [0, 16384, 32768, 49152, 65535],
  domainMin: 0,
  domainMax: 1
};

const normalizedEntry = {
  samples: [0, 0.25, 0.5, 0.75, 1],
  domainMin: 0,
  domainMax: 1
};

let mockBridge;

vi.mock('../../src/js/data/linearization-utils.js', () => {
  return {
    LinearizationState: {
      getPerChannelData: vi.fn(() => null),
      isPerChannelEnabled: vi.fn(() => false),
      getGlobalData: vi.fn(() => null),
      globalApplied: false
    },
    ensurePrinterSpaceData: vi.fn(() => perEntry),
    normalizeLinearizationEntry: vi.fn(() => normalizedEntry)
  };
});

vi.mock('../../src/js/legacy/linearization-bridge.js', () => {
  mockBridge = {
    getPerChannelData: vi.fn(() => perEntry),
    isPerChannelEnabled: vi.fn(() => true)
  };
  return {
    getLegacyLinearizationBridge: () => mockBridge
  };
});

describe('processing pipeline per-channel fallback', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.resetModules();
    global.window = undefined;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  it('still applies per-channel linearization when window is unavailable', async () => {
    const module = await import('../../src/js/core/processing-pipeline.js');
    const { applyPerChannelLinearizationStep } = module;
    const utils = await import('../../src/js/data/linearization-utils.js');

    const base = Array.from({ length: 5 }, (_, i) => i * 1000);
    const result = applyPerChannelLinearizationStep(base, {
      channelName: 'K',
      endValue: 65535,
      interpolationType: 'smooth',
      smoothingPercent: 0,
      smartApplied: false
    });

    expect(utils.ensurePrinterSpaceData).toHaveBeenCalledWith(perEntry);
    expect(utils.normalizeLinearizationEntry).toHaveBeenCalled();
    expect(result).toEqual(expect.any(Array));
    expect(result).not.toBe(base);
    expect(mockBridge.getPerChannelData).toHaveBeenCalledWith('K');
    expect(mockBridge.isPerChannelEnabled).toHaveBeenCalledWith('K');
  });
});
