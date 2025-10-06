/* @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn()
  }
}), { virtual: true });

const ORIGINAL_ARGV1 = process.argv[1];

describe('diagnostics compare-coordinator legacy helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    process.argv[1] = ORIGINAL_ARGV1;
    delete globalThis.window;
  });

  afterEach(() => {
    process.argv[1] = ORIGINAL_ARGV1;
    delete globalThis.window;
  });

  it('awaits the window applyGlobalScale bridge when coordinator disable path runs', async () => {
    process.argv[1] = '/not/the-script.js';
    const awaitedRef = { value: false };
    const thenable = {
      then(resolve) {
        awaitedRef.value = true;
        resolve({ success: true });
      }
    };

    const evaluateMock = vi.fn(async (fn, args) => fn(args));
    const pageMock = { evaluate: evaluateMock };

    globalThis.window = {
      __USE_SCALING_COORDINATOR: true,
      applyGlobalScale: vi.fn(() => thenable),
      legacyApplyGlobalScale: vi.fn()
    };

    const module = await import('../../scripts/diagnostics/compare-coordinator-legacy.js');

    expect(typeof module.setScaleValue).toBe('function');

    const result = await module.setScaleValue(pageMock, 120, 'normal');

    expect(result).toEqual({ success: true });
    expect(globalThis.window.applyGlobalScale).toHaveBeenCalledWith(120, expect.objectContaining({ priority: 'normal' }));
    expect(awaitedRef.value).toBe(true);
  });
});
