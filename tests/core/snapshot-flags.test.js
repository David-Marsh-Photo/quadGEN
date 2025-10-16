import { describe, it, expect } from 'vitest';
import {
  computeSnapshotFlags,
  SNAPSHOT_FLAG_THRESHOLD_PERCENT,
} from '../../src/js/core/snapshot-flags.js';

describe('snapshot flagging', () => {
  it('flags snapshots when rise exceeds threshold', () => {
    const snapshots = [
      {
        index: 0,
        inputPercent: 0,
        perChannel: {
          K: { normalizedAfter: 0.2 },
        },
      },
      {
        index: 1,
        inputPercent: 50,
        perChannel: {
          K: { normalizedAfter: 0.95 },
        },
      },
    ];

    const flags = computeSnapshotFlags(snapshots, { thresholdPercent: 7 });
    expect(Object.keys(flags)).toContain('1');
    expect(flags[1].kind).toBe('rise');
    expect(flags[1].channels).toEqual(['K']);
    expect(flags[1].details[0]).toMatchObject({ channel: 'K', direction: 'rise' });
    expect(flags[1].magnitude).toBeGreaterThanOrEqual(SNAPSHOT_FLAG_THRESHOLD_PERCENT);
    expect(flags[1].threshold).toBe(SNAPSHOT_FLAG_THRESHOLD_PERCENT);
  });

  it('does not flag when changes stay below threshold', () => {
    const snapshots = [
      {
        index: 0,
        perChannel: {
          K: { normalizedAfter: 0.40 },
        },
      },
      {
        index: 1,
        perChannel: {
          K: { normalizedAfter: 0.45 },
        },
      },
    ];

    const flags = computeSnapshotFlags(snapshots, { thresholdPercent: 7 });
    expect(flags).toEqual({});
  });

  it('captures drops exceeding the threshold', () => {
    const snapshots = [
      {
        index: 0,
        perChannel: {
          K: { normalizedAfter: 0.9 },
        },
      },
      {
        index: 1,
        perChannel: {
          K: { normalizedAfter: 0.10 },
        },
      },
    ];

    const flags = computeSnapshotFlags(snapshots, { thresholdPercent: 7 });
    expect(Object.keys(flags)).toContain('1');
    expect(flags[1].kind).toBe('drop');
    expect(flags[1].channels).toEqual(['K']);
    expect(flags[1].details[0]).toMatchObject({ channel: 'K', direction: 'drop' });
  });

  it('skips detection when auto-raise is still in progress', () => {
    const snapshots = [
      {
        index: 0,
        perChannel: {
          K: { normalizedAfter: 0.2 },
        },
      },
      {
        index: 1,
        perChannel: {
          K: { normalizedAfter: 0.95 },
        },
      },
    ];

    const flags = computeSnapshotFlags(snapshots, { autoRaiseInProgress: true });
    expect(flags).toEqual({});
  });
});
