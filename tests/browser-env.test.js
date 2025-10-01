import { beforeEach, describe, expect, it, vi } from 'vitest';

const resetEnvironment = () => {
  delete globalThis.matchMedia;
  delete globalThis.innerWidth;
  delete globalThis.innerHeight;
  delete globalThis.window;
};

describe('browser environment helpers', () => {
  beforeEach(async () => {
    resetEnvironment();
    vi.resetModules();
  });

  it('binds global matchMedia when window is unavailable', async () => {
    const matchMediaSpy = vi.fn(() => ({ matches: true }));
    globalThis.matchMedia = matchMediaSpy;
    const { getMatchMedia } = await import('../src/js/utils/browser-env.js');

    const matcher = getMatchMedia();
    expect(typeof matcher).toBe('function');

    const result = matcher('(prefers-color-scheme: dark)');
    expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(result).toEqual({ matches: true });
  });

  it('falls back to window.matchMedia when global scope lacks it', async () => {
    const matchMediaSpy = vi.fn(() => ({ matches: false }));
    globalThis.window = { matchMedia: matchMediaSpy };
    const { getMatchMedia } = await import('../src/js/utils/browser-env.js');

    const matcher = getMatchMedia();
    expect(typeof matcher).toBe('function');

    matcher('(prefers-color-scheme: light)');
    expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-color-scheme: light)');
  });

  it('returns null when matchMedia is unavailable', async () => {
    const { getMatchMedia } = await import('../src/js/utils/browser-env.js');
    expect(getMatchMedia()).toBeNull();
  });

  it('provides viewport fallbacks when no window dimensions exist', async () => {
    const { getViewportSize } = await import('../src/js/utils/browser-env.js');
    const { width, height } = getViewportSize();
    expect(width).toBe(Number.POSITIVE_INFINITY);
    expect(height).toBe(Number.POSITIVE_INFINITY);
  });
});
