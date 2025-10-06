import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadDebugRegistry() {
  const mod = await import('../../src/js/utils/debug-registry.js');
  return mod.getDebugRegistry;
}

async function resetRegistry() {
  const getDebugRegistry = await loadDebugRegistry();
  const registry = getDebugRegistry();
  Object.keys(registry).forEach((key) => delete registry[key]);
}

describe('Legacy bridge debug registry coverage', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.window;
    globalThis.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    };
    const makeElement = () => ({
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      appendChild: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn().mockReturnValue(false) },
      style: {},
      innerHTML: '',
      innerText: '',
      textContent: '',
      querySelector: vi.fn().mockReturnValue(null)
    });

    globalThis.document = {
      documentElement: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        getAttribute: vi.fn().mockReturnValue(null),
        style: { setProperty: vi.fn() }
      },
      body: makeElement(),
      createElement: vi.fn(() => makeElement()),
      getElementById: vi.fn().mockReturnValue(null),
      querySelector: vi.fn().mockReturnValue(null)
    };
    await resetRegistry();
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.document;
  });

  it('registers scaling utilities helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/core/scaling-utils.js');
    const registry = getDebugRegistry();
    expect(registry.scalingUtils).toBeDefined();
    expect(typeof registry.scalingUtils.applyGlobalScale).toBe('function');
    expect(typeof registry.scalingUtils.scaleChannelEndsByPercent).toBe('function');
  });

  it('registers status service helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/status-service.js');
    const registry = getDebugRegistry();
    expect(registry.statusService).toBeDefined();
    expect(typeof registry.statusService.showStatus).toBe('function');
    expect(typeof registry.statusService.subscribeStatus).toBe('function');
  });

  it('registers status message helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/status-messages.js');
    const registry = getDebugRegistry();
    expect(registry.statusMessages).toBeDefined();
    expect(typeof registry.statusMessages.addChatMessage).toBe('function');
    expect(typeof registry.statusMessages.clearChatMessages).toBe('function');
  });

  it('registers chat interface helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ai/chat-interface.js');
    const registry = getDebugRegistry();
    expect(registry.chatInterface).toBeDefined();
    expect(typeof registry.chatInterface.getChatInterface).toBe('function');
    expect(typeof registry.chatInterface.sendChatMessage).toBe('function');
  });

  it('registers make256 debug helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/debug/debug-make256.js');
    const registry = getDebugRegistry();
    expect(registry.debugMake256).toBeDefined();
    expect(typeof registry.debugMake256.captureMake256Step).toBe('function');
    expect(typeof registry.debugMake256.getMake256Debug).toBe('function');
  });

  it('registers auto-limit state helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/core/auto-limit-state.js');
    const registry = getDebugRegistry();
    expect(registry.autoLimitState).toBeDefined();
    expect(typeof registry.autoLimitState.getAutoLimitState).toBe('function');
    expect(typeof registry.autoLimitState.setAutoLimitState).toBe('function');
  });

  it('registers linearization utilities', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/data/linearization-utils.js');
    const registry = getDebugRegistry();
    expect(registry.linearization).toBeDefined();
    expect(typeof registry.linearization.LinearizationState).toBe('object');
    expect(typeof registry.linearization.normalizeLinearizationEntry).toBe('function');
  });

  it('registers LAB bypass helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/data/lab-legacy-bypass.js');
    const registry = getDebugRegistry();
    expect(registry.labBypass).toBeDefined();
    expect(typeof registry.labBypass.processLabLegacy).toBe('function');
    expect(typeof registry.labBypass.generateLabCurve256).toBe('function');
  });

  it('registers processing utilities', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/data/processing-utils.js');
    const registry = getDebugRegistry();
    expect(registry.processingUtils).toBeDefined();
    expect(registry.processingUtils.DataSpace).toBeDefined();
    expect(typeof registry.processingUtils.AUTO_LIMIT_CONFIG).toBe('object');
  });

  it('registers compact channel helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/compact-channels.js');
    const registry = getDebugRegistry();
    expect(registry.compactChannels).toBeDefined();
    expect(typeof registry.compactChannels.updateCompactChannelsList).toBe('function');
  });

  it('registers processing status helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/processing-status.js');
    const registry = getDebugRegistry();
    expect(registry.processingStatus).toBeDefined();
    expect(typeof registry.processingStatus.updateProcessingDetail).toBe('function');
    expect(typeof registry.processingStatus.updateAllProcessingDetails).toBe('function');
  });

  it('registers chart renderer debug helpers', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/chart-renderer.js');
    const registry = getDebugRegistry();
    expect(registry.chartRenderer).toBeDefined();
    expect(typeof registry.chartRenderer.setSmartOverlayDebug).toBe('function');
    expect(typeof registry.chartRenderer.getSmartOverlayDebug).toBe('function');
  });

  describe('scaling window bridges', () => {
    function mockRegisterDebugNamespace(registry, windowRef) {
      return vi.fn((namespace, exports, options = {}) => {
        registry[namespace] = exports;
        if (options.exposeOnWindow && Array.isArray(options.windowAliases)) {
          options.windowAliases.forEach((alias) => {
            windowRef[alias] = exports[alias];
          });
        }
      });
    }

    function setupCommonMocks({ registry, windowRef, scaleMock }) {
      vi.doMock('../../src/js/utils/debug-registry.js', () => ({
        registerDebugNamespace: mockRegisterDebugNamespace(registry, windowRef),
        getDebugRegistry: () => registry
      }));

      vi.doMock('../../src/js/core/state.js', () => ({
        elements: {
          scaleAllInput: { value: '100' }
        },
        getCurrentPrinter: () => ({ channels: [] })
      }));

      vi.doMock('../../src/js/core/state-manager.js', () => ({
        getStateManager: () => ({
          get: vi.fn(),
          set: vi.fn(),
          setChannelValue: vi.fn()
        })
      }));

      vi.doMock('../../src/js/core/history-manager.js', () => ({
        getHistoryManager: () => ({
          recordBatchAction: vi.fn()
        })
      }));

      vi.doMock('../../src/js/core/validation.js', () => ({
        InputValidator: {
          clampEnd: (value) => Number(value),
          computePercentFromEnd: (end) => Number(end),
          validatePercentInput: (input) => Number(input.value),
          computeEndFromPercent: (percent) => Number(percent),
          clearValidationStyling: vi.fn(),
          clampPercent: (value) => Number(value),
          validateEndInput: (input) => Number(input.value)
        }
      }));

      vi.doMock('../../src/js/ui/ui-utils.js', () => ({
        formatScalePercent: (value) => String(Number(value ?? 0) || 0)
      }));

      vi.doMock('../../src/js/ui/chart-manager.js', () => ({
        setChartStatusMessage: vi.fn()
      }));

      vi.doMock('../../src/js/ui/ui-hooks.js', () => ({
        triggerInkChartUpdate: vi.fn(),
        triggerPreviewUpdate: vi.fn(),
        triggerSessionStatusUpdate: vi.fn()
      }));

      vi.doMock('../../src/js/ui/status-service.js', () => ({
        showStatus: vi.fn()
      }));

      vi.doMock('../../src/js/ui/channel-registry.js', () => ({
        getChannelRow: () => null
      }));

      vi.doMock('../../src/js/curves/smart-curves.js', () => ({
        rescaleSmartCurveForInkLimit: vi.fn()
      }));

      vi.doMock('../../src/js/core/scaling-coordinator.js', () => ({
        default: {
          scale: scaleMock,
          isEnabled: vi.fn(() => true),
          setEnabled: vi.fn(),
          flushQueue: vi.fn(),
          getDebugInfo: vi.fn()
        }
      }));
    }

    it('routes window.applyGlobalScale through the scaling coordinator and returns a promise', async () => {
      vi.resetModules();
      const registry = {};
      const windowRef = {};
      const scaleMock = vi.fn(() => Promise.resolve({ success: true }));

      // Ensure window is defined before modules evaluate
      globalThis.window = windowRef;

      setupCommonMocks({ registry, windowRef, scaleMock });

      await import('../../src/js/core/scaling-utils.js');

      expect(typeof window.applyGlobalScale).toBe('function');

      const result = window.applyGlobalScale(150);

      expect(scaleMock).toHaveBeenCalledWith(150, 'compat-window', expect.objectContaining({
        priority: 'normal',
        metadata: expect.objectContaining({ requestedBy: 'window.applyGlobalScale' })
      }));
      expect(result).toBeInstanceOf(Promise);

      delete globalThis.window;
    });

    it('routes window.scaleChannelEndsByPercent through the scaling coordinator', async () => {
      vi.resetModules();
      const registry = {};
      const windowRef = {};
      const scaleMock = vi.fn(() => Promise.resolve({ success: true }));

      globalThis.window = windowRef;

      setupCommonMocks({ registry, windowRef, scaleMock });

      await import('../../src/js/core/scaling-utils.js');

      expect(typeof window.scaleChannelEndsByPercent).toBe('function');

      const result = window.scaleChannelEndsByPercent(200, { skipHistory: true });

      expect(scaleMock).toHaveBeenCalledWith(200, 'compat-window', expect.objectContaining({
        priority: 'normal',
        metadata: expect.objectContaining({
          requestedBy: 'window.scaleChannelEndsByPercent',
          options: { skipHistory: true }
        })
      }));
      expect(result).toBeInstanceOf(Promise);

      delete globalThis.window;
    });
  });
});
