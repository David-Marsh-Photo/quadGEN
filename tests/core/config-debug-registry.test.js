import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const REGISTRY_KEY = 'intentDebug';

async function resetRegistry() {
  const { getDebugRegistry } = await import('../../src/js/utils/debug-registry.js');
  const registry = getDebugRegistry();
  delete registry[REGISTRY_KEY];
}

describe('intent debug registry exposure', () => {
  const originalWindow = global.window;

  beforeEach(async () => {
    vi.resetModules();
    await resetRegistry();
    global.window = undefined;
  });

  afterEach(async () => {
    global.window = originalWindow;
    await resetRegistry();
    vi.restoreAllMocks();
  });

  it('registers debug helpers without relying on window', async () => {
    await import('../../src/js/core/config.js');
    const { getDebugRegistry } = await import('../../src/js/utils/debug-registry.js');
    const registry = getDebugRegistry();
    expect(registry[REGISTRY_KEY]).toBeDefined();
    expect(typeof registry[REGISTRY_KEY].setIntentTuningDebug).toBe('function');
    expect(typeof registry[REGISTRY_KEY].storeIntentTuningFlag).toBe('function');
  });
});
