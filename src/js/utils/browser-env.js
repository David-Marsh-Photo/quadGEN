// Browser environment helpers
// Centralized shims for optional window APIs so modules can
// reference browser capabilities without importing window directly.

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * Returns the active window object when available.
 * @returns {Window|null}
 */
export function getWindow() {
  if (typeof window !== 'undefined') {
    return window;
  }
  const candidate = globalScope && typeof globalScope.window !== 'undefined'
    ? globalScope.window
    : null;
  return candidate ?? null;
}

/**
 * Returns a bound matchMedia function when supported.
 * Prefers globalThis.matchMedia to support jsdom/polyfills, then window.
 * @returns {(query: string) => MediaQueryList | null}
 */
export function getMatchMedia() {
  if (globalScope && typeof globalScope.matchMedia === 'function') {
    return globalScope.matchMedia.bind(globalScope);
  }

  const win = getWindow();
  if (win && typeof win.matchMedia === 'function') {
    return win.matchMedia.bind(win);
  }

  return null;
}

/**
 * Returns viewport dimensions, falling back to Infinity when unknown.
 * @returns {{ width: number, height: number }}
 */
export function getViewportSize() {
  const win = getWindow();

  const width = typeof globalScope.innerWidth === 'number'
    ? globalScope.innerWidth
    : (win && typeof win.innerWidth === 'number'
      ? win.innerWidth
      : Number.POSITIVE_INFINITY);

  const height = typeof globalScope.innerHeight === 'number'
    ? globalScope.innerHeight
    : (win && typeof win.innerHeight === 'number'
      ? win.innerHeight
      : Number.POSITIVE_INFINITY);

  return { width, height };
}

/**
 * Determines whether the environment exposes a real window object.
 * Helpful when callers just need a boolean check.
 * @returns {boolean}
 */
export function hasWindow() {
  return !!getWindow();
}

export function getGlobalScope() {
  return globalScope;
}
