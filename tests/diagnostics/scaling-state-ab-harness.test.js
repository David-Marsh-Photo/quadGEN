import { describe, expect, it } from 'vitest';
import { summarizeReasonCounts } from '../../scripts/diagnostics/scaling-state-ab.js';

describe('scaling-state diagnostics harness', () => {
  it('aggregates reason counts from iteration snapshots and final audit', () => {
    const results = [
      { auditSnapshot: { reasonCounts: { 'flag:enable': 2, 'legacy:apply': 1 } } },
      { auditSnapshot: { reasonCounts: { 'flag:enable': 1, 'history:undo': 3 } } }
    ];

    const finalAudit = { reasonCounts: { 'history:undo': 1, 'flag:disable': 2 } };

    const summary = summarizeReasonCounts(results, finalAudit);

    expect(summary['flag:enable']).toBe(3);
    expect(summary['legacy:apply']).toBe(1);
    expect(summary['history:undo']).toBe(4);
    expect(summary['flag:disable']).toBe(2);
  });
});
