/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/js/core/auto-limit-state.js', () => ({
  subscribeAutoLimitState: vi.fn(() => () => {})
}));

vi.mock('../../src/js/ui/ui-hooks.js', () => ({
  registerInkChartHandler: vi.fn(),
  registerProcessingDetailAllHandler: vi.fn(),
  registerProcessingDetailHandler: vi.fn(),
  registerSessionStatusHandler: vi.fn(),
  registerPreviewHandler: vi.fn(),
  registerRevertButtonsHandler: vi.fn(),
  triggerInkChartUpdate: vi.fn(),
  triggerProcessingDetailAll: vi.fn(),
  triggerProcessingDetail: vi.fn(),
  triggerSessionStatusUpdate: vi.fn(),
  triggerPreviewUpdate: vi.fn(),
  triggerRevertButtonsUpdate: vi.fn()
}));

describe('state synchronization without window', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.resetModules();
    global.window = undefined;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.restoreAllMocks();
  });

  it('initializes without throwing when window is unavailable', async () => {
    const module = await import('../../src/js/core/event-sync.js');
    const { setupStateSynchronization } = module;

    expect(() => setupStateSynchronization()).not.toThrow();
  });
});
