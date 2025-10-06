import { showStatus } from '../ui/status-service.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const MAX_BUFFER_LENGTH = 200;
const telemetryBuffer = [];
const subscribers = new Set();
let operationCounter = 0;

function nowIso() {
  return new Date().toISOString();
}

function clampBuffer() {
  while (telemetryBuffer.length > MAX_BUFFER_LENGTH) {
    telemetryBuffer.shift();
  }
}

function notifySubscribers(payload) {
  subscribers.forEach((callback) => {
    try {
      callback(payload);
    } catch (err) {
      console.warn('[scaling-telemetry] subscriber error', err);
    }
  });
}

function maybeShowStatus(event) {
  if (!event) return;
  const { phase, error } = event;
  if (phase === 'flush') {
    const reason = error?.reason ? ` (${error.reason})` : '';
    showStatus(`Scaling queue flushed${reason}`);
  }
}

export function generateOperationId() {
  operationCounter += 1;
  return `scale-${operationCounter}`;
}

export function recordCoordinatorEvent(event) {
  if (!event || !event.phase) {
    return null;
  }

  const payload = {
    timestamp: nowIso(),
    ...event
  };

  telemetryBuffer.push(payload);
  clampBuffer();
  notifySubscribers(payload);
  maybeShowStatus(payload);
  return payload;
}

export function getTelemetryBuffer() {
  return [...telemetryBuffer];
}

export function clearTelemetryBuffer() {
  telemetryBuffer.length = 0;
}

export function subscribeTelemetry(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

registerDebugNamespace('scalingTelemetry', {
  record: recordCoordinatorEvent,
  getBuffer: getTelemetryBuffer,
  clear: clearTelemetryBuffer,
  subscribe: subscribeTelemetry,
  generateOperationId
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: []
});
