// Legacy helpers for bridging optional window-based utilities
// Provides safe access to legacy globals during the transition period.

const FALLBACK_SCOPE = {};

function resolveLegacyScope() {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return FALLBACK_SCOPE;
}

export function getLegacyScope() {
  return resolveLegacyScope();
}

export function getLegacyHelper(name) {
  if (!name) return undefined;
  const scope = resolveLegacyScope();
  const candidate = scope?.[name];
  return typeof candidate === 'function' ? candidate : undefined;
}

export function invokeLegacyHelper(name, ...args) {
  const helper = getLegacyHelper(name);
  if (typeof helper !== 'function') {
    return undefined;
  }
  try {
    return helper(...args);
  } catch (error) {
    console.warn(`[legacy-helper] call failed for ${name}:`, error);
    return undefined;
  }
}

export function registerLegacyHelpers(helpers = {}) {
  const scope = resolveLegacyScope();
  Object.entries(helpers).forEach(([key, value]) => {
    if (typeof scope[key] === 'undefined') {
      scope[key] = value;
    }
  });
  return scope;
}
