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
import { recordCoordinatorEvent, generateOperationId } from './scaling-telemetry.js';

const DEFAULT_SOURCE = 'ui';
const DEFAULT_PRIORITY = 'normal';

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function toNumberPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

class ScalingCoordinator {
  constructor(deps = {}) {
    this.scaleFn = deps.scaleFn || ((percent) => scaleChannelEndsByPercent(percent));
    this.beginTransaction = deps.beginTransaction || beginHistoryTransaction;
    this.commitTransaction = deps.commitTransaction || commitHistoryTransaction;
    this.rollbackTransaction = deps.rollbackTransaction || rollbackHistoryTransaction;
    this.queue = [];
    this.processing = false;
    this.metrics = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      maxQueueLength: 0,
      lastDurationMs: 0,
      lastError: null,
      lastResult: null
    };
    this._enabledOverride = typeof window === 'undefined' ? false : undefined;
  }

  _snapshotMetrics() {
    return {
      ...this.metrics,
      queueLength: this.queue.length,
      processing: this.processing
    };
  }

  _snapshotOperation(operation, extras = {}) {
    if (!operation) return null;
    return {
      id: operation.id,
      percent: operation.percent,
      source: operation.source,
      priority: operation.priority,
      metadata: operation.metadata || null,
      enqueuedAt: operation.enqueuedAt,
      startedAt: operation.startedAt || null,
      completedAt: operation.completedAt || null,
      failedAt: operation.failedAt || null,
      durationMs: operation.durationMs || null,
      ...extras
    };
  }

  _recordTelemetry(phase, operation, extras = {}) {
    try {
      const { operationExtras, ...rest } = extras || {};
      recordCoordinatorEvent({
        phase,
        operation: this._snapshotOperation(operation, operationExtras),
        metrics: this._snapshotMetrics(),
        ...rest
      });
    } catch (err) {
      console.warn('[scaling-coordinator] telemetry error', err);
    }
  }

  isEnabled() {
    if (typeof window !== 'undefined') {
      return !!window.__USE_SCALING_COORDINATOR;
    }
    return !!this._enabledOverride;
  }

  setEnabled(enabled) {
    const previous = this.isEnabled();
    const desired = !!enabled;

    if (typeof window !== 'undefined') {
      window.__USE_SCALING_COORDINATOR = desired;
    } else {
      this._enabledOverride = desired;
    }

    const current = this.isEnabled();
    if (previous && !current) {
      this.flushQueue('disabled');
    }

    return current;
  }

  scale(percent, source = DEFAULT_SOURCE, options = {}) {
    const numericPercent = toNumberPercent(percent);
    if (!Number.isFinite(numericPercent) || numericPercent <= 0) {
      return Promise.reject(new Error(`Invalid scale percent "${percent}"`));
    }

    const operation = {
      id: generateOperationId(),
      percent: numericPercent,
      source,
      priority: options.priority || DEFAULT_PRIORITY,
      metadata: options.metadata || null,
      enqueuedAt: now()
    };

    const promise = new Promise((resolve, reject) => {
      operation.resolve = resolve;
      operation.reject = reject;
    });

    if (operation.priority === 'high') {
      this.queue.unshift(operation);
    } else {
      this.queue.push(operation);
    }

    this.metrics.enqueued += 1;
    this.metrics.maxQueueLength = Math.max(this.metrics.maxQueueLength, this.queue.length);
    this._recordTelemetry('enqueue', operation);
    this._processQueue();

    return promise;
  }

  async _processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const op = this.queue.shift();
      const timerStart = now();
      const description = `Scale channels to ${formatScalePercent(op.percent)} (${op.source})`;
      let transactionId;
      let committed = false;
      const debugEnabled = typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS;

      if (debugEnabled) {
        console.log('[SCALING COORDINATOR] Processing operation', {
          percent: op.percent,
          source: op.source,
          queueLength: this.queue.length
        });
      }

      try {
        transactionId = this.beginTransaction(description);
        op.startedAt = now();
        this._recordTelemetry('start', op);
        const result = await Promise.resolve(this.scaleFn(op.percent, op.metadata || {}));

        if (!result || result.success === false) {
          const message = result?.message || 'Failed to scale channels';
          showStatus(message);
          await this._rollbackTransactionSafe(transactionId);
          this.metrics.failed += 1;
          this.metrics.lastError = message;
          op.failedAt = now();
          this._recordTelemetry('fail', op, {
            error: { message },
            result: result || null
          });
          if (debugEnabled) {
            console.warn('[SCALING COORDINATOR] Operation failed', { message });
          }
          op.reject(new Error(message));
          continue;
        }

        this.commitTransaction(transactionId);
        committed = true;
        this._afterSuccessfulScale(result);
        const finishedAt = now();
        const durationMs = finishedAt - timerStart;
        op.completedAt = finishedAt;
        op.durationMs = durationMs;
        this.metrics.processed += 1;
        this.metrics.lastDurationMs = durationMs;
        this.metrics.lastResult = result;
        this._recordTelemetry('success', op, {
          durationMs,
          result
        });
        if (debugEnabled) {
          console.log('[SCALING COORDINATOR] Operation complete', { durationMs, result });
        }
        op.resolve({ ...result, durationMs });
      } catch (error) {
        if (!committed && transactionId) {
          await this._rollbackTransactionSafe(transactionId);
        }
        this.metrics.failed += 1;
        this.metrics.lastError = error instanceof Error ? error.message : String(error);
        showStatus(this.metrics.lastError);
        op.failedAt = now();
        this._recordTelemetry('fail', op, {
          error: error instanceof Error ? { message: error.message } : { message: String(error) }
        });
        if (debugEnabled) {
          console.error('[SCALING COORDINATOR] Operation threw', error);
        }
        op.reject(error);
      }
    }

    this.processing = false;
  }

  async _rollbackTransactionSafe(transactionId) {
    try {
      if (transactionId) {
        await Promise.resolve(this.rollbackTransaction(transactionId));
      }
    } catch (error) {
      console.warn('Scaling coordinator rollback failed:', error);
    }
  }

  _afterSuccessfulScale(result) {
    if (!result) return;
    const appliedPercent = result.details?.scalePercent;
    const formatted = formatScalePercent(appliedPercent ?? result.percent ?? '');

    if (result.message) {
      showStatus(result.message);
    }

    setChartStatusMessage('Preview updated', 2000);
    triggerInkChartUpdate();
    triggerPreviewUpdate();
    triggerSessionStatusUpdate();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('scaling-coordinator:completed', {
        detail: {
          percent: appliedPercent,
          formattedPercent: formatted,
          message: result.message || null
        }
      }));
    }
  }

  flushQueue(reason = 'manual') {
    const flushed = [];
    while (this.queue.length > 0) {
      const op = this.queue.shift();
      op.reject(new Error(`Scaling coordinator queue flushed (${reason})`));
      flushed.push(this._snapshotOperation(op));
    }
    this.metrics.maxQueueLength = 0;
    this._recordTelemetry('flush', null, {
      error: { reason },
      operations: flushed
    });
  }

  getDebugInfo() {
    return {
      enabled: this.isEnabled(),
      queueLength: this.queue.length,
      processing: this.processing,
      ...this.metrics
    };
  }
}

const scalingCoordinator = new ScalingCoordinator();

if (typeof window !== 'undefined') {
  if (typeof window.__USE_SCALING_COORDINATOR === 'undefined') {
    window.__USE_SCALING_COORDINATOR = false;
  }
  if (typeof window.enableScalingCoordinator !== 'function') {
    window.enableScalingCoordinator = (enabled) => {
      const flag = scalingCoordinator.setEnabled(enabled);
      const status = flag ? 'ENABLED' : 'DISABLED';
      console.info(`Scaling coordinator ${status}`);
      return flag;
    };
  }
}

registerDebugNamespace('scalingCoordinator', {
  coordinator: scalingCoordinator,
  setEnabled: (value) => scalingCoordinator.setEnabled(value),
  getDebugInfo: () => scalingCoordinator.getDebugInfo(),
  flushQueue: (reason) => scalingCoordinator.flushQueue(reason)
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: ['scalingCoordinator']
});

export { ScalingCoordinator };
export default scalingCoordinator;
