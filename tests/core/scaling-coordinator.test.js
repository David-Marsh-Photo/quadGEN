import { describe, it, expect, beforeEach, vi } from 'vitest';

const scaleCore = vi.fn();
const beginTransaction = vi.fn();
const commitTransaction = vi.fn();
const rollbackTransaction = vi.fn();
const showStatus = vi.fn();
const setChartStatusMessage = vi.fn();
const triggerInkChartUpdate = vi.fn();
const triggerPreviewUpdate = vi.fn();
const triggerSessionStatusUpdate = vi.fn();

vi.mock('../../src/js/core/scaling-utils.js', () => ({
  scaleChannelEndsByPercent: scaleCore
}));

vi.mock('../../src/js/core/history-manager.js', () => ({
  beginHistoryTransaction: beginTransaction,
  commitHistoryTransaction: commitTransaction,
  rollbackHistoryTransaction: rollbackTransaction
}));

vi.mock('../../src/js/ui/status-service.js', () => ({ showStatus }));
vi.mock('../../src/js/ui/chart-manager.js', () => ({ setChartStatusMessage }));
vi.mock('../../src/js/ui/ui-hooks.js', () => ({
  triggerInkChartUpdate,
  triggerPreviewUpdate,
  triggerSessionStatusUpdate
}));
vi.mock('../../src/js/ui/ui-utils.js', () => ({
  formatScalePercent: (value) => String(value)
}));

const { default: scalingCoordinator } = await import('../../src/js/core/scaling-coordinator.js');

describe('global scaling orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beginTransaction.mockReturnValue('tx-1');
    scaleCore.mockReturnValue({
      success: true,
      message: 'Scaled',
      details: { scalePercent: 80 }
    });
  });

  it('commits one scale operation and refreshes the UI', async () => {
    const options = { skipHistory: true };
    const result = await scalingCoordinator.scale(80, options);

    expect(beginTransaction).toHaveBeenCalledWith('Scale channels to 80%');
    expect(scaleCore).toHaveBeenCalledWith(80, options);
    expect(commitTransaction).toHaveBeenCalledWith('tx-1');
    expect(rollbackTransaction).not.toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalledWith('Scaled');
    expect(setChartStatusMessage).toHaveBeenCalledWith('Preview updated', 2000);
    expect(triggerInkChartUpdate).toHaveBeenCalledOnce();
    expect(triggerPreviewUpdate).toHaveBeenCalledOnce();
    expect(triggerSessionStatusUpdate).toHaveBeenCalledOnce();
    expect(result.details.scalePercent).toBe(80);
  });

  it('rolls back and rejects a failed scale operation', async () => {
    scaleCore.mockReturnValue({ success: false, message: 'Unable to scale' });

    await expect(scalingCoordinator.scale(110)).rejects.toThrow('Unable to scale');

    expect(rollbackTransaction).toHaveBeenCalledWith('tx-1');
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalledWith('Unable to scale');
  });

  it('rejects invalid input before opening a transaction', async () => {
    await expect(scalingCoordinator.scale('not-a-number')).rejects.toThrow('Invalid scale percent');

    expect(beginTransaction).not.toHaveBeenCalled();
    expect(scaleCore).not.toHaveBeenCalled();
  });
});
