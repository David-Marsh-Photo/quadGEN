// Legacy Intent Bridge
// Provides a thin wrapper around legacy global state so modern modules
// can consume intent-related data without reaching into window.* directly.

const DEFAULT_INTENT_NAME = 'Linear';

class LegacyIntentBridge {
  constructor() {
    this.windowRef = typeof window !== 'undefined' ? window : null;
  }

  getWindow() {
    if (typeof window !== 'undefined') {
      this.windowRef = window;
    }
    return this.windowRef;
  }

  /**
   * Retrieve the legacy canApplyIntentRemap delegate if it exists.
   * Always returns a callable bound to the legacy window, or null.
   */
  getRemapDelegate() {
    const legacyWin = this.getWindow();
    if (!legacyWin || typeof legacyWin.canApplyIntentRemap !== 'function') {
      return null;
    }
    try {
      return legacyWin.canApplyIntentRemap.bind(legacyWin);
    } catch (err) {
      return legacyWin.canApplyIntentRemap;
    }
  }

  /**
   * Check whether legacy code reports a loaded quad curve.
   * @returns {boolean}
   */
  hasLegacyQuadLoaded() {
    const legacyWin = this.getWindow();
    if (!legacyWin) return false;
    if (typeof legacyWin.hasLoadedQuadCurves === 'function') {
      try {
        return !!legacyWin.hasLoadedQuadCurves();
      } catch (err) {
        return false;
      }
    }
    return !!legacyWin.loadedQuadData;
  }

  /**
   * Snapshot of legacy linearization state.
   * @returns {{ hasGlobal: boolean, hasPerEnabled: boolean }}
   */
  getLegacyLinearizationFlags() {
    const legacyWin = this.getWindow();
    if (!legacyWin) {
      return { hasGlobal: false, hasPerEnabled: false };
    }

    const hasGlobal = !!(legacyWin.linearizationData && legacyWin.linearizationApplied);
    const perEntries = legacyWin.perChannelLinearization || {};
    const perEnabledMap = legacyWin.perChannelEnabled || {};
    const hasPerEnabled = Object.keys(perEntries).some((channel) => perEnabledMap[channel]);

    return { hasGlobal, hasPerEnabled };
  }

  /**
   * Resolve the active legacy intent name when available.
   * @returns {string}
   */
  getLegacyIntentName() {
    const legacyWin = this.getWindow();
    if (!legacyWin || !legacyWin.contrastIntent) {
      return DEFAULT_INTENT_NAME;
    }
    return legacyWin.contrastIntent.name || DEFAULT_INTENT_NAME;
  }

  /**
   * Register helper functions on the legacy window so the legacy shell can
   * still invoke them. Existing assignments are preserved.
   * @param {Record<string, Function>} helpers
   */
  registerIntentHelpers(helpers = {}) {
    const legacyWin = this.getWindow();
    if (!legacyWin) return;
    Object.entries(helpers).forEach(([key, value]) => {
      if (legacyWin[key] !== undefined) return;
      legacyWin[key] = value;
    });
  }
}

let singletonBridge = null;

/**
 * Obtain the singleton legacy intent bridge.
 * @returns {LegacyIntentBridge}
 */
export function getLegacyIntentBridge() {
  if (!singletonBridge) {
    singletonBridge = new LegacyIntentBridge();
  }
  return singletonBridge;
}

export { DEFAULT_INTENT_NAME };
