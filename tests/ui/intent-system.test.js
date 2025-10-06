import { describe, it, expect, vi } from 'vitest';

import {
  canApplyIntentRemap,
  hasAnyLinearization,
  getAllPresets
} from '../../src/js/ui/intent-system.js';

describe('intent-system bridge', () => {
  it('exposes preset metadata when window is undefined', () => {
    const presets = getAllPresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every(p => typeof p.id === 'string')).toBe(true);
  });

  it('hasAnyLinearization returns false without LinearizationState or window', () => {
    expect(hasAnyLinearization()).toBe(false);
  });

  it('canApplyIntentRemap handles missing window without logging warnings (expected post-bridge)', () => {
    const cachedWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
      ? globalThis.window
      : undefined;
    const warnings = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args.map(String).join(' '));
    });
    try {
      delete globalThis.window;
      const result = canApplyIntentRemap();
      expect(result).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      if (cachedWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = cachedWindow;
      }
    }
  });

  it('canApplyIntentRemap avoids recursion when legacy delegate references the modular implementation', () => {
    const cachedWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
      ? globalThis.window
      : undefined;

    const fakeWindow = {
      linearizationData: null,
      linearizationApplied: false,
      perChannelLinearization: {},
      perChannelEnabled: {},
      hasLoadedQuadCurves: vi.fn(() => true)
    };

    fakeWindow.canApplyIntentRemap = canApplyIntentRemap;

    const warnings = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args.map(String).join(' '));
    });

    try {
      globalThis.window = fakeWindow;

      expect(() => canApplyIntentRemap()).not.toThrow();
      const result = canApplyIntentRemap();
      expect(result).toBe(true);
      expect(warnings.some(msg => msg.includes('Legacy remap delegate'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
      if (cachedWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = cachedWindow;
      }
    }
  });
});
