import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setScaleValue } from '../../scripts/diagnostics/compare-coordinator-legacy.js';

function createStubPage(windowStub) {
  return {
    evaluate: vi.fn(async (fn, args) => {
      const previousWindow = global.window;
      global.window = windowStub;
      try {
        return await fn(args);
      } finally {
        global.window = previousWindow;
      }
    })
  };
}

function createCoordinatorWindow({ applyResult }) {
  const applyGlobalScale = vi.fn(async () => applyResult);
  const validateScalingStateSync = vi.fn();
  return {
    __USE_SCALING_COORDINATOR: true,
    applyGlobalScale,
    legacyApplyGlobalScale: undefined,
    validateScalingStateSync
  };
}

function createLegacyWindow() {
  const legacyApplyGlobalScale = vi.fn();
  const validateScalingStateSync = vi.fn();
  return {
    __USE_SCALING_COORDINATOR: false,
    applyGlobalScale: undefined,
    legacyApplyGlobalScale,
    validateScalingStateSync
  };
}

describe('compare-coordinator diagnostics', () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = global.window;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  it('calls validator after coordinator bridge operations', async () => {
    const fakeWindow = createCoordinatorWindow({ applyResult: undefined });
    const page = createStubPage(fakeWindow);

    const result = await setScaleValue(page, 142, 'high');

    expect(result).toEqual({ success: true });
    expect(fakeWindow.applyGlobalScale).toHaveBeenCalledWith(142, {
      priority: 'high',
      metadata: { trigger: 'parity-sequence' }
    });
    expect(fakeWindow.validateScalingStateSync).toHaveBeenCalledWith({
      throwOnMismatch: false,
      reason: 'diagnostics'
    });
  });

  it('calls validator after legacy bridge operations', async () => {
    const fakeWindow = createLegacyWindow();
    const page = createStubPage(fakeWindow);

    const result = await setScaleValue(page, 95, 'normal');

    expect(result).toEqual({ success: true });
    expect(fakeWindow.legacyApplyGlobalScale).toHaveBeenCalledWith(95);
    expect(fakeWindow.validateScalingStateSync).toHaveBeenCalledWith({
      throwOnMismatch: false,
      reason: 'diagnostics'
    });
  });
});
