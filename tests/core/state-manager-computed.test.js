import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuadGenStateManager } from '../../src/js/core/state-manager.js';

describe('QuadGenStateManager computed properties', () => {
  let manager;

  beforeEach(() => {
    manager = new QuadGenStateManager();
  });

  it('registers computed property with initial value', () => {
    manager.addComputed('computed.flags.hasLogs', 'app.debugLogs', (value) => Boolean(value));
    expect(manager.get('computed.flags.hasLogs')).toBe(false);
  });

  it('updates computed value when dependency changes', () => {
    manager.addComputed('computed.flags.hasLogs', 'app.debugLogs', (value) => Boolean(value));
    const listener = vi.fn();
    manager.subscribe('computed.flags.hasLogs', listener);

    manager.set('app.debugLogs', true);

    expect(manager.get('computed.flags.hasLogs')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('computed.flags.hasLogs', true, false, expect.objectContaining({ computed: true }));
  });

  it('updates computed values once after batched dependency changes', () => {
    manager.addComputed(
      'computed.flags.bothEnabled',
      ['app.debugLogs', 'app.editMode'],
      (logs, edit) => Boolean(logs && edit)
    );

    const listener = vi.fn();
    manager.subscribe('computed.flags.bothEnabled', listener);

    manager.batch(() => {
      manager.set('app.debugLogs', true);
      manager.set('app.editMode', true);
    });

    expect(manager.get('computed.flags.bothEnabled')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      'computed.flags.bothEnabled',
      true,
      false,
      expect.objectContaining({ computed: true, batched: true })
    );
  });

  it('removing computed stops further updates', () => {
    manager.addComputed('computed.flags.hasLogs', 'app.debugLogs', (value) => Boolean(value));
    manager.removeComputed('computed.flags.hasLogs');

    const listener = vi.fn();
    manager.subscribe('computed.flags.hasLogs', listener);

    manager.set('app.debugLogs', true);

    expect(listener).not.toHaveBeenCalled();
  });
});
