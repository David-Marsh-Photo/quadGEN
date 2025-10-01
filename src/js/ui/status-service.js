// Status message service
// Provides a simple pub/sub interface for success/warning/error/status messages

import { registerDebugNamespace } from '../utils/debug-registry.js';

const listeners = new Set();

export const StatusLevel = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
});

function emit(level, message) {
  const payload = {
    level,
    message,
    timestamp: Date.now()
  };
  listeners.forEach((callback) => {
    try {
      callback(payload);
    } catch (err) {
      console.warn('[status-service] listener error:', err);
    }
  });
}

export function showStatus(message) {
  emit(StatusLevel.INFO, message);
}

export function showSuccess(message) {
  emit(StatusLevel.SUCCESS, message);
}

export function showWarning(message) {
  emit(StatusLevel.WARNING, message);
}

export function showError(message) {
  emit(StatusLevel.ERROR, message);
}

export function subscribeStatus(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

registerDebugNamespace('statusService', {
  showStatus,
  showSuccess,
  showWarning,
  showError,
  subscribeStatus
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: ['showStatus', 'showSuccess', 'showWarning', 'showError']
});
