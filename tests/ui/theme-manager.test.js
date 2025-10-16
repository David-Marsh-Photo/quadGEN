import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const THEME_KEY = 'quadgen.theme';

describe('theme manager defaults', () => {
  let storage;
  let matchMediaMock;

  beforeEach(() => {
    vi.resetModules();

    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => {
        storage.set(key, String(value));
      },
      removeItem: (key) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      }
    });

    matchMediaMock = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }));
    vi.stubGlobal('matchMedia', matchMediaMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to light when no preference is stored, even if system prefers dark', async () => {
    const { getCurrentTheme } = await import('../../src/js/ui/theme-manager.js');

    expect(getCurrentTheme()).toBe('light');
  });

  it('respects an explicitly stored preference', async () => {
    const { getCurrentTheme } = await import('../../src/js/ui/theme-manager.js');

    localStorage.setItem(THEME_KEY, 'dark');
    expect(getCurrentTheme()).toBe('dark');
  });
});
