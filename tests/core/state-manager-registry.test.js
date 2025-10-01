import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const REGISTRY_KEY = 'stateManager';

async function resetRegistry() {
  const { getDebugRegistry } = await import('../../src/js/utils/debug-registry.js');
  const registry = getDebugRegistry();
  delete registry[REGISTRY_KEY];
}

describe('state manager debug exposure', () => {
  const originalWindow = global.window;

  beforeEach(async () => {
    vi.resetModules();
    await resetRegistry();
    global.window = undefined;
  });

  afterEach(async () => {
    global.window = originalWindow;
    vi.restoreAllMocks();
    await resetRegistry();
  });

  it('registers helpers even when window is unavailable', async () => {
    await import('../../src/js/core/state-manager.js');
    const { getDebugRegistry } = await import('../../src/js/utils/debug-registry.js');
    const registry = getDebugRegistry();
    expect(registry[REGISTRY_KEY]).toBeDefined();
    expect(typeof registry[REGISTRY_KEY].getStateManager).toBe('function');
    expect(typeof registry[REGISTRY_KEY].getState).toBe('function');
  });
});
