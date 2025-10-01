import { registerDebugNamespace } from '../utils/debug-registry.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
const STORE_KEY = '__debugMake256Steps';

function ensureStore() {
  if (!globalScope[STORE_KEY]) {
    globalScope[STORE_KEY] = {};
  }
  return globalScope[STORE_KEY];
}

export function captureMake256Step(channelName, stepName, values) {
  if (!channelName || !stepName || !Array.isArray(values)) return;
  const store = ensureStore();
  if (!store[channelName]) {
    store[channelName] = {};
  }
  store[channelName][stepName] = values.slice(0, 16);
}

export function getMake256Debug(channelName) {
  const store = globalScope[STORE_KEY];
  if (!store) return null;
  return store[channelName] || null;
}

registerDebugNamespace('debugMake256', {
  captureMake256Step,
  getMake256Debug
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: ['__debugGetMake256Steps']
});
