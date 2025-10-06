import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/js/ui/status-service.js', () => ({
  showStatus: vi.fn()
}));

vi.mock('../../src/js/ui/chart-manager.js', () => ({
  setChartStatusMessage: vi.fn()
}));

vi.mock('../../src/js/ui/ui-hooks.js', async () => {
  const actual = await vi.importActual('../../src/js/ui/ui-hooks.js');
  return {
    ...actual,
    triggerInkChartUpdate: vi.fn(),
    triggerPreviewUpdate: vi.fn(),
    triggerSessionStatusUpdate: vi.fn()
  };
});

vi.mock('../../src/js/ui/ui-utils.js', () => ({
  formatScalePercent: (value) => `${Number(value).toFixed(1)}%`
}));

const telemetryEvents = [];
let telemetryIdCounter = 0;
vi.mock('../../src/js/core/scaling-telemetry.js', () => ({
  recordCoordinatorEvent: vi.fn((event) => {
    telemetryEvents.push(event);
  }),
  getTelemetryBuffer: vi.fn(() => telemetryEvents),
  clearTelemetryBuffer: vi.fn(() => {
    telemetryEvents.length = 0;
  }),
  subscribeTelemetry: vi.fn(() => () => {}),
  generateOperationId: vi.fn(() => {
    telemetryIdCounter += 1;
    return `test-op-${telemetryIdCounter}`;
  })
}), { virtual: true });

const showStatus = (await import('../../src/js/ui/status-service.js')).showStatus;
const setChartStatusMessage = (await import('../../src/js/ui/chart-manager.js')).setChartStatusMessage;
const { triggerInkChartUpdate, triggerPreviewUpdate, triggerSessionStatusUpdate } = await import('../../src/js/ui/ui-hooks.js');
const { recordCoordinatorEvent } = await import('../../src/js/core/scaling-telemetry.js');

const { ScalingCoordinator } = await import('../../src/js/core/scaling-coordinator.js');

describe('ScalingCoordinator', () => {
  let beginTransaction;
  let commitTransaction;
  let rollbackTransaction;
  let scaleFn;
  let coordinator;

  beforeEach(() => {
    beginTransaction = vi.fn(() => 'tx1');
    commitTransaction = vi.fn(() => ({ success: true }));
    rollbackTransaction = vi.fn(() => ({ success: true }));
    scaleFn = vi.fn(() => ({ success: true, message: 'Scaled', details: { scalePercent: 80 } }));
    coordinator = new ScalingCoordinator({
      scaleFn,
      beginTransaction,
      commitTransaction,
      rollbackTransaction
    });
    coordinator.setEnabled(true);
    vi.clearAllMocks();
    telemetryEvents.length = 0;
  });

  afterEach(() => {
    coordinator.flushQueue('test teardown');
  });

  it('processes a single scale operation through a transaction', async () => {
    const result = await coordinator.scale(80, 'ui');

    expect(beginTransaction).toHaveBeenCalledWith(expect.stringContaining('Scale channels to'));
    expect(commitTransaction).toHaveBeenCalledWith('tx1');
    expect(rollbackTransaction).not.toHaveBeenCalled();
    expect(scaleFn).toHaveBeenCalledWith(80, {});
    expect(result.success).toBe(true);
    expect(result.details.scalePercent).toBe(80);
  });

  it('enforces FIFO ordering for queued operations', async () => {
    const callOrder = [];
    scaleFn
      .mockImplementationOnce(() => {
        callOrder.push('first');
        return { success: true, message: 'first', details: { scalePercent: 70 } };
      })
      .mockImplementationOnce(() => {
        callOrder.push('second');
        return { success: true, message: 'second', details: { scalePercent: 90 } };
      });

    const promiseA = coordinator.scale(70, 'ui');
    const promiseB = coordinator.scale(90, 'ui');

    await Promise.all([promiseA, promiseB]);

    expect(callOrder).toEqual(['first', 'second']);
  });

  it('processes high priority operations before queued low priority entries', async () => {
    const callLog = [];
    let resolveFirst;

    scaleFn
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce((value) => {
        callLog.push(value);
        return { success: true, message: 'high', details: { scalePercent: value } };
      })
      .mockImplementationOnce((value) => {
        callLog.push(value);
        return { success: true, message: 'low', details: { scalePercent: value } };
      });

    const first = coordinator.scale(70, 'ui');
    const lowQueued = coordinator.scale(75, 'ui');
    const highQueued = coordinator.scale(95, 'ui', { priority: 'high' });

    resolveFirst({ success: true, message: 'first', details: { scalePercent: 70 } });

    await Promise.all([first, lowQueued, highQueued]);

    expect(callLog).toEqual([95, 75]);
  });

  it('rolls back and rejects when scaling fails', async () => {
    scaleFn.mockImplementationOnce(() => ({ success: false, message: 'no change' }));

    await expect(coordinator.scale(110, 'ui')).rejects.toThrow('no change');

    expect(rollbackTransaction).toHaveBeenCalledWith('tx1');
    expect(commitTransaction).not.toHaveBeenCalled();
  });

  it('rejects invalid percent', async () => {
    await expect(coordinator.scale('not-a-number')).rejects.toThrow(/Invalid scale percent/);
    expect(beginTransaction).not.toHaveBeenCalled();
  });

  it('emits UI side-effects on success', async () => {
    await coordinator.scale(80, 'ui');

    expect(showStatus).toHaveBeenCalledWith('Scaled');
    expect(setChartStatusMessage).toHaveBeenCalledWith('Preview updated', 2000);
    expect(triggerInkChartUpdate).toHaveBeenCalled();
    expect(triggerPreviewUpdate).toHaveBeenCalled();
    expect(triggerSessionStatusUpdate).toHaveBeenCalled();
  });

  it('tracks debug metrics', async () => {
    await coordinator.scale(80, 'ui');
    const debug = coordinator.getDebugInfo();
    expect(debug.processed).toBe(1);
    expect(debug.queueLength).toBe(0);
    expect(debug.lastResult.details.scalePercent).toBe(80);
  });

  it('passes metadata through to the scaling function', async () => {
    const metadata = { caller: 'test-case' };
    await coordinator.scale(82, 'ui', { metadata });
    expect(scaleFn).toHaveBeenCalledWith(82, metadata);
  });

  it('rolls back when the scaling function throws an error', async () => {
    const error = new Error('boom');
    scaleFn.mockImplementationOnce(() => {
      throw error;
    });

    await expect(coordinator.scale(60, 'ui')).rejects.toThrow('boom');
    expect(rollbackTransaction).toHaveBeenCalledWith('tx1');
  });

  it('emits telemetry for successful operations', async () => {
    await coordinator.scale(75, 'ui');

    expect(recordCoordinatorEvent).toHaveBeenCalled();
    const phases = telemetryEvents.map((event) => event.phase);
    expect(phases).toContain('enqueue');
    expect(phases).toContain('start');
    expect(phases).toContain('success');
    const successEvent = telemetryEvents.find((event) => event.phase === 'success');
    expect(successEvent.metrics?.processed).toBe(1);
    expect(successEvent.operation?.percent).toBe(75);
  });

  it('emits telemetry failure path and includes error details', async () => {
    scaleFn.mockImplementationOnce(() => ({ success: false, message: 'no change' }));

    await expect(coordinator.scale(110, 'ui')).rejects.toThrow('no change');

    const phases = telemetryEvents.map((event) => event.phase);
    expect(phases).toContain('enqueue');
    expect(phases).toContain('start');
    expect(phases).toContain('fail');
    const failureEvent = telemetryEvents.find((event) => event.phase === 'fail');
    expect(failureEvent.error?.message).toBe('no change');
  });

  it('updates max queue length metric during bursts', async () => {
    let resolveFirst;
    const firstResult = { success: true, message: 'first', details: { scalePercent: 70 } };
    const secondResult = { success: true, message: 'second', details: { scalePercent: 75 } };

    scaleFn
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => secondResult);

    const promiseA = coordinator.scale(70, 'ui');
    const promiseB = coordinator.scale(75, 'ui');

    const debugDuringQueue = coordinator.getDebugInfo();
    expect(debugDuringQueue.maxQueueLength).toBeGreaterThanOrEqual(1);

    resolveFirst(firstResult);
    await Promise.all([promiseA, promiseB]);

    expect(coordinator.getDebugInfo().processed).toBe(2);
  });

  it('setEnabled toggles coordinator state when window is unavailable', () => {
    const current = coordinator.isEnabled();
    coordinator.setEnabled(!current);
    expect(coordinator.isEnabled()).toBe(!current);
  });

  it('flushes queued operations when disabled', async () => {
    let resolveFirst;
    const firstResult = { success: true, message: 'first', details: { scalePercent: 70 } };

    scaleFn
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce((value) => ({ success: true, message: 'second', details: { scalePercent: value } }));

    const first = coordinator.scale(70, 'ui');
    const second = coordinator.scale(75, 'ui');

    const disabled = coordinator.setEnabled(false);
    expect(disabled).toBe(false);

    await expect(second).rejects.toThrow(/queue flushed/);

    resolveFirst(firstResult);
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it('records telemetry when flushing the queue', async () => {
    coordinator.processing = true;
    const pending = coordinator.scale(70, 'ui');
    coordinator.processing = false;
    expect(telemetryEvents.some((event) => event.phase === 'enqueue')).toBe(true);

    coordinator.flushQueue('test');

    const phases = telemetryEvents.map((event) => event.phase);
    expect(phases).toContain('flush');
    const flushEvent = telemetryEvents.find((event) => event.phase === 'flush');
    expect(flushEvent.error?.reason).toBe('test');
    await expect(pending).rejects.toThrow(/queue flushed/);
  });
});
