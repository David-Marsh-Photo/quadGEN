import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuadGenStateManager } from '../../src/js/core/state-manager.js';

describe('QuadGenStateManager.createSelector', () => {
  let manager;

  beforeEach(() => {
    manager = new QuadGenStateManager();
  });

  it('returns the raw value when no computeFn is provided', () => {
    const selector = manager.createSelector('app.debugLogs');
    expect(selector()).toBe(false);

    manager.set('app.debugLogs', true);
    expect(selector()).toBe(true);
  });

  it('memoizes results until the dependency changes', () => {
    const compute = vi.fn((value) => value ? 'enabled' : 'disabled');
    const selector = manager.createSelector('app.debugLogs', compute);

    expect(selector()).toBe('disabled');
    expect(selector()).toBe('disabled');
    expect(compute).toHaveBeenCalledTimes(1);

    manager.set('app.debugLogs', true);
    expect(selector()).toBe('enabled');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('does not recompute when unrelated paths change', () => {
    const compute = vi.fn((value) => value);
    const selector = manager.createSelector('app.debugLogs', compute);

    selector();
    manager.set('ui.statusMessage', 'updated');
    selector();

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('supports multiple dependency paths', () => {
    const compute = vi.fn((editMode, chartZoom) => ({ editMode, chartZoom }));
    const selector = manager.createSelector(['app.editMode', 'app.chartZoomIndex'], compute);

    expect(selector()).toEqual({ editMode: false, chartZoom: 9 });
    expect(compute).toHaveBeenCalledTimes(1);

    manager.set('app.editMode', true);
    expect(selector()).toEqual({ editMode: true, chartZoom: 9 });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('handles nested path updates with new values', () => {
    const compute = vi.fn((percentage) => percentage);
    const selector = manager.createSelector('printer.channelValues.K.percentage', compute);

    expect(selector()).toBeUndefined();
    expect(compute).toHaveBeenCalledTimes(1);

    manager.set('printer.channelValues.K.percentage', 80);
    expect(selector()).toBe(80);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('exposes invalidate to force cache reset', () => {
    const compute = vi.fn((value) => value);
    const selector = manager.createSelector('app.debugLogs', compute);

    selector();
    selector.invalidate();
    selector();

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('resets memoized result after state reset', () => {
    const compute = vi.fn((value) => value);
    const selector = manager.createSelector('app.debugLogs', compute);

    selector();
    manager.reset(['app.debugLogs']);
    selector();

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('throws when called without dependency paths', () => {
    // @ts-expect-error testing runtime guard
    expect(() => manager.createSelector([], () => null)).toThrow('createSelector requires at least one dependency path');
  });
});
