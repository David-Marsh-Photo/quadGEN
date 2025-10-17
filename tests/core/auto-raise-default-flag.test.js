import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import {
  resetFeatureFlags,
  isAutoRaiseInkLimitsEnabled,
  setAutoRaiseInkLimitsEnabled
} from '../../src/js/core/feature-flags.js';

describe('auto-raise feature flag defaults', () => {
  beforeEach(() => {
    resetFeatureFlags();
  });

  afterEach(() => {
    resetFeatureFlags();
  });

  test('auto-raise ink limits is disabled by default', () => {
    resetFeatureFlags();
    expect(isAutoRaiseInkLimitsEnabled()).toBe(false);
  });

  test('reset restores the default after enabling auto-raise', () => {
    setAutoRaiseInkLimitsEnabled(true);
    expect(isAutoRaiseInkLimitsEnabled()).toBe(true);

    resetFeatureFlags();
    expect(isAutoRaiseInkLimitsEnabled()).toBe(false);
  });
});
