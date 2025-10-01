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
});
