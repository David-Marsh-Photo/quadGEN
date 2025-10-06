import { beforeEach, describe, expect, it } from 'vitest';

describe('scaling utils audit reason tracking', () => {
  let module;

  beforeEach(async () => {
    // Import fresh module instance for each test to avoid shared state
    module = await import('../../src/js/core/scaling-utils.js');
    if (typeof module.resetScalingStateAudit === 'function') {
      module.resetScalingStateAudit('vitest-beforeEach');
    }
  });

  it('exposes a reason count map on the scaling state audit snapshot', () => {
    const audit = module.getScalingStateAudit();
    expect(audit).toBeTruthy();
    expect(audit.reasonCounts).toBeDefined();
    expect(audit.reasonCounts).toEqual({});
  });

  it('increments counters per reason when validateScalingStateSync is called', () => {
    module.validateScalingStateSync({ reason: 'flag:enable', throwOnMismatch: false });
    module.validateScalingStateSync({ reason: 'flag:enable', throwOnMismatch: false });
    module.validateScalingStateSync({ reason: 'history:undo', throwOnMismatch: false });

    const audit = module.getScalingStateAudit();
    expect(audit.reasonCounts['flag:enable']).toBe(2);
    expect(audit.reasonCounts['history:undo']).toBe(1);
  });
});
