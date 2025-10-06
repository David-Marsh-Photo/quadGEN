import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/js/ui/status-service.js', () => ({
  showStatus: vi.fn()
}));

vi.mock('../../src/js/utils/debug-registry.js', () => ({
  registerDebugNamespace: vi.fn()
}));

const { showStatus } = await import('../../src/js/ui/status-service.js');
const {
  recordCoordinatorEvent,
  getTelemetryBuffer,
  clearTelemetryBuffer
} = await import('../../src/js/core/scaling-telemetry.js');

describe('scaling-telemetry', () => {
  beforeEach(() => {
    clearTelemetryBuffer();
    vi.clearAllMocks();
  });

  it('records events and clamps buffer length', () => {
    for (let index = 0; index < 205; index += 1) {
      recordCoordinatorEvent({ phase: 'enqueue', operation: { id: `op-${index}` } });
    }

    const buffer = getTelemetryBuffer();
    expect(buffer).toHaveLength(200);
    expect(buffer.at(-1)?.operation?.id).toBe('op-204');
  });

  it('surfaces status messages when queues flush', () => {
    recordCoordinatorEvent({ phase: 'fail', error: { message: 'no change' } });
    recordCoordinatorEvent({ phase: 'flush', error: { reason: 'manual' } });

    expect(showStatus).toHaveBeenCalledTimes(1);
    expect(showStatus).toHaveBeenCalledWith('Scaling queue flushed (manual)');
  });
});
