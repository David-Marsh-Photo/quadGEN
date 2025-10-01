import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadRegistry() {
  const mod = await import('../../src/js/utils/debug-registry.js');
  return mod.getDebugRegistry;
}

async function resetRegistry() {
  const getDebugRegistry = await loadRegistry();
  const registry = getDebugRegistry();
  Object.keys(registry).forEach((key) => delete registry[key]);
}

describe('core state bridge', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.window;
    await resetRegistry();
  });

  it('registers state helpers without window globals', async () => {
    const getDebugRegistry = await loadRegistry();
    await import('../../src/js/core/state.js');
    const registry = getDebugRegistry();
    expect(registry.coreState).toBeDefined();
  });
});
