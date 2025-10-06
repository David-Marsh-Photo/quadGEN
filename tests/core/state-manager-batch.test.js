import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuadGenStateManager } from '../../src/js/core/state-manager.js';

describe('QuadGenStateManager batch API', () => {
  let manager;

  beforeEach(() => {
    manager = new QuadGenStateManager();
  });

  it('buffers set calls until batch completes', () => {
    const listener = vi.fn();
    manager.subscribe('app.debugLogs', listener);

    manager.batch(() => {
      manager.set('app.debugLogs', true);
      expect(manager.get('app.debugLogs')).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('app.debugLogs', true, false, expect.objectContaining({ batched: true }));
  });

  it('supports batch object syntax for backwards compatibility', () => {
    const listener = vi.fn();
    manager.subscribe('app.debugLogs', listener);

    manager.batch({ 'app.debugLogs': true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.get('app.debugLogs')).toBe(true);
  });

  it('merges nested batches and flushes once', () => {
    const debugListener = vi.fn();
    const editListener = vi.fn();
    manager.subscribe('app.debugLogs', debugListener);
    manager.subscribe('app.editMode', editListener);

    manager.batch(() => {
      manager.set('app.debugLogs', true);
      manager.batch(() => {
        manager.set('app.editMode', true);
      });
    });

    expect(debugListener).toHaveBeenCalledTimes(1);
    expect(editListener).toHaveBeenCalledTimes(1);
    expect(manager.get('app.debugLogs')).toBe(true);
    expect(manager.get('app.editMode')).toBe(true);
  });

  it('rolls back state when batch function throws', () => {
    manager.set('app.debugLogs', false);
    expect(() => {
      manager.batch(() => {
        manager.set('app.debugLogs', true);
        throw new Error('fail');
      });
    }).toThrow('fail');

    expect(manager.get('app.debugLogs')).toBe(false);
  });

  it('throws when batch argument is invalid', () => {
    expect(() => manager.batch(null)).toThrow('stateManager.batch expects a function or an object map');
  });
});
