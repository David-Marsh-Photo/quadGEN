// Legacy State Bridge
// Centralizes interaction with legacy window globals for core state.

class LegacyStateBridge {
  constructor() {
    this.windowRef = typeof window !== 'undefined' ? window : null;
  }

  getWindow() {
    if (typeof window !== 'undefined') {
      this.windowRef = window;
    }
    return this.windowRef;
  }

  getLoadedQuadData() {
    const legacyWin = this.getWindow();
    return legacyWin ? legacyWin.loadedQuadData || null : null;
  }

  setLoadedQuadData(data) {
    const legacyWin = this.getWindow();
    if (!legacyWin) return;
    legacyWin.loadedQuadData = data || null;
  }

  getEditModeFlag() {
    const legacyWin = this.getWindow();
    if (!legacyWin || typeof legacyWin.EDIT_MODE_ENABLED === 'undefined') {
      return null;
    }
    return legacyWin.EDIT_MODE_ENABLED === true;
  }

  setEditModeFlag(enabled) {
    const legacyWin = this.getWindow();
    if (!legacyWin) return;
    legacyWin.EDIT_MODE_ENABLED = enabled === true;
  }

  registerHelpers(helpers = {}) {
    const legacyWin = this.getWindow();
    if (!legacyWin) return;
    Object.entries(helpers).forEach(([key, value]) => {
      if (legacyWin[key] !== undefined) return;
      legacyWin[key] = value;
    });
  }
}

let singletonBridge = null;

export function getLegacyStateBridge() {
  if (!singletonBridge) {
    singletonBridge = new LegacyStateBridge();
  }
  return singletonBridge;
}
