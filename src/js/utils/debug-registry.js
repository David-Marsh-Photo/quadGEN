// quadGEN Debug Registry
// Centralized helper for development-only debug exports so modules avoid
// scattering `window.*` assignments while still supporting legacy tooling.

import { getWindow } from './browser-env.js';

const debugRegistry = {};

function isDebugExposureEnabled() {
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.DEV !== 'undefined') {
    return !!import.meta.env.DEV;
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env.NODE_ENV === 'string') {
    return process.env.NODE_ENV !== 'production';
  }
  return true;
}

export function getDebugRegistry() {
  return debugRegistry;
}

export function registerDebugNamespace(namespace, helpers = {}, options = {}) {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('registerDebugNamespace requires a string namespace');
  }

  if (!helpers || typeof helpers !== 'object') {
    throw new Error('registerDebugNamespace requires an object of helpers');
  }

  const existing = debugRegistry[namespace] || {};
  const merged = { ...existing, ...helpers };
  debugRegistry[namespace] = merged;

  const { exposeOnWindow = false, windowAliases = [] } = options;
  if (!exposeOnWindow) {
    return merged;
  }

  const win = getWindow();
  if (win) {
    const root = win.__quadDebug = win.__quadDebug || {};
    root[namespace] = merged;

    windowAliases.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(helpers, key)) {
        return;
      }
      if (typeof win[key] !== 'undefined') {
        return;
      }
      win[key] = helpers[key];
    });
  }

  return merged;
}
