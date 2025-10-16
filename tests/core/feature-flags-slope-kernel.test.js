import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isSlopeKernelSmoothingEnabled,
  setSlopeKernelSmoothingEnabled,
} from '../../src/js/core/feature-flags.js';

describe('slope kernel smoothing feature flag default', () => {
  let original;

  beforeEach(() => {
    original = isSlopeKernelSmoothingEnabled();
  });

  afterEach(() => {
    setSlopeKernelSmoothingEnabled(original);
  });

  it('is enabled by default so composite smoothing runs without overrides', () => {
    expect(isSlopeKernelSmoothingEnabled()).toBe(true);
  });
});

