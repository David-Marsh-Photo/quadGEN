import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadRegistry() {
  const mod = await import('../../src/js/utils/debug-registry.js');
  return mod.getDebugRegistry;
}

async function resetRegistry() {
  const getDebugRegistry = await loadRegistry();
  const registry = getDebugRegistry();
  Object.keys(registry).forEach((key) => delete registry[key]);
}

const localStorageStub = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

describe('manual L* registry exposure', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.window;
    globalThis.localStorage = localStorageStub;
    await resetRegistry();
  });

  it('registers manual L* helpers without window globals', async () => {
    const getDebugRegistry = await loadRegistry();
    await import('../../src/js/ui/manual-lstar.js');
    const registry = getDebugRegistry();
    expect(registry.manualLstar).toBeDefined();
  });
});

afterEach(() => {
  delete globalThis.localStorage;
});
