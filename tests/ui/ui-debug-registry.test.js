import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadDebugRegistry() {
  const mod = await import('../../src/js/utils/debug-registry.js');
  return mod.getDebugRegistry;
}

async function resetRegistry() {
  const getDebugRegistry = await loadDebugRegistry();
  const registry = getDebugRegistry();
  Object.keys(registry).forEach((key) => delete registry[key]);
}

describe('UI debug registry exposure', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete globalThis.window;
    await resetRegistry();
  });

  it('registers edit-mode helpers without relying on window globals', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/edit-mode.js');
    const registry = getDebugRegistry();
    expect(registry.editMode).toBeDefined();
  });

  it('registers theme manager helpers without relying on window globals', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/theme-manager.js');
    const registry = getDebugRegistry();
    expect(registry.theme).toBeDefined();
  });

  it('registers chat UI helpers without relying on window globals', async () => {
    const getDebugRegistry = await loadDebugRegistry();
    await import('../../src/js/ui/chat-ui.js');
    const registry = getDebugRegistry();
    expect(registry.chatUI).toBeDefined();
  });
});
