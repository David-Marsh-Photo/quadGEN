import { scaleChannelEndsByPercent } from './scaling-utils.js';
import {
  beginHistoryTransaction,
  commitHistoryTransaction,
  rollbackHistoryTransaction
} from './history-manager.js';
import { showStatus } from '../ui/status-service.js';
import { setChartStatusMessage } from '../ui/chart-manager.js';
import {
  triggerInkChartUpdate,
  triggerPreviewUpdate,
  triggerSessionStatusUpdate
} from '../ui/ui-hooks.js';
import { formatScalePercent } from '../ui/ui-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

function refreshAfterScale(result) {
  if (result.message) {
    showStatus(result.message);
  }

  setChartStatusMessage('Preview updated', 2000);
  triggerInkChartUpdate();
  triggerPreviewUpdate();
  triggerSessionStatusUpdate();
}

/**
 * Apply one global scale inside an undo-safe transaction.
 *
 * The underlying scaler is synchronous, so callers do not need a queue. This
 * function remains async to preserve the public promise contract used by the
 * UI, Lab Tech, and compatibility helpers.
 */
async function scale(percent, options = {}) {
  const numericPercent = Number(percent);
  if (!Number.isFinite(numericPercent) || numericPercent <= 0) {
    throw new Error(`Invalid scale percent "${percent}"`);
  }

  let transactionId;

  try {
    transactionId = beginHistoryTransaction(
      `Scale channels to ${formatScalePercent(numericPercent)}%`
    );

    const result = scaleChannelEndsByPercent(numericPercent, options);
    if (!result || result.success === false) {
      throw new Error(result?.message || 'Failed to scale channels');
    }

    commitHistoryTransaction(transactionId);
    transactionId = null;
    refreshAfterScale(result);
    return result;
  } catch (error) {
    if (transactionId) {
      try {
        rollbackHistoryTransaction(transactionId);
      } catch (rollbackError) {
        console.warn('Global scale rollback failed:', rollbackError);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    showStatus(message);
    throw error;
  }
}

const scalingCoordinator = { scale };

registerDebugNamespace('scalingCoordinator', {
  scalingCoordinator,
  scale,
  applyGlobalScale: scale,
  scaleChannelEndsByPercent: scale
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: [
    'scalingCoordinator',
    'applyGlobalScale',
    'scaleChannelEndsByPercent'
  ]
});

export { scale };
export default scalingCoordinator;
