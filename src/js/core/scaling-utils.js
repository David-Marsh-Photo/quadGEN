/**
 * Global Channel Scaling Utilities
 * Handles scaling all channel endpoints by a percentage factor
 */

import { elements, getCurrentPrinter } from './state.js';
import { getStateManager } from './state-manager.js';
import { getHistoryManager } from './history-manager.js';
import { InputValidator } from './validation.js';
import { formatScalePercent } from '../ui/ui-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getChannelRow } from '../ui/channel-registry.js';
import { rescaleSmartCurveForInkLimit } from '../curves/smart-curves.js';
import { isChannelLocked, updateChannelLockBounds, getChannelLockInfo, getLockedChannels, getGlobalScaleLockMessage } from './channel-locks.js';

// Global scaling state
let scaleAllPercent = 100;
let scaleBaselineEnds = null;

const MAX_SCALE_PERCENT = 1000;

function canonicalizeBaselines(baselines) {
    if (!baselines || typeof baselines !== 'object') {
        return {};
    }

    const normalized = {};
    for (const [channelName, value] of Object.entries(baselines)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            continue;
        }
        normalized[channelName] = Math.round(numeric);
    }
    return normalized;
}

function resolveBaselinesSnapshot(baselines) {
    const normalized = canonicalizeBaselines(baselines);
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function computeMaxAllowedFromBaselines(baselines) {
    if (!baselines || typeof baselines !== 'object') {
        return MAX_SCALE_PERCENT;
    }

    let maxAllowed = MAX_SCALE_PERCENT;
    for (const channelName of Object.keys(baselines)) {
        const baseEnd = Number(baselines[channelName]);
        if (!Number.isFinite(baseEnd) || baseEnd <= 0) {
            continue;
        }
        const channelMax = Math.floor((65535 / baseEnd) * 100);
        maxAllowed = Math.min(maxAllowed, Number.isFinite(channelMax) ? channelMax : MAX_SCALE_PERCENT);
    }
    return maxAllowed;
}

export function getScalingSnapshot() {
    const baselines = resolveBaselinesSnapshot(scaleBaselineEnds);
    return {
        percent: Number.isFinite(scaleAllPercent) ? scaleAllPercent : 100,
        baselines,
        maxAllowed: computeMaxAllowedFromBaselines(baselines)
    };
}

/** Restore the canonical percent and cached baselines from history. */
export function restoreScalingState(snapshot) {
    const percent = Number(snapshot?.percent);
    scaleAllPercent = Number.isFinite(percent) && percent > 0 ? percent : 100;
    scaleBaselineEnds = resolveBaselinesSnapshot(snapshot?.baselines);
    if (Math.abs(scaleAllPercent - 100) < 1e-6) {
        scaleBaselineEnds = null;
    }
    if (elements.scaleAllInput) {
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
    }
}


/**
 * Update scale baseline for a specific channel
 * @param {string} channelName - Channel name
 */
export function updateScaleBaselineForChannel(channelName) {
    if (Math.abs(scaleAllPercent - 100) < 1e-6) {
        scaleBaselineEnds = null;
        return;
    }

    if (!scaleBaselineEnds) scaleBaselineEnds = {};

    const row = getChannelRow(channelName);
    if (!row) return;

    const endInput = row.querySelector('.end-input');
    if (!endInput) return;

    const currentEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
    const factor = Math.max(0.0001, scaleAllPercent / 100 || 1);
    const base = InputValidator.clampEnd(Math.round(currentEnd / factor));

    scaleBaselineEnds[channelName] = base;
}

/**
 * Scale channel endpoints by percentage
 * @param {number} percent - Scale percentage (100 = no change)
 * @returns {Object} Result object with success/message/details
 */
export function scaleChannelEndsByPercent(percent, options = {}) {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const skipHistory = !!opts.skipHistory;

    console.log(`🔍 [SCALE CORE DEBUG] scaleChannelEndsByPercent called:`, {
        percent,
        timestamp: Date.now(),
        currentScaleAllPercent: scaleAllPercent,
        scaleBaselineEnds: scaleBaselineEnds,
        callStack: new Error().stack.split('\n').slice(1, 3)
    });

    try {
        const rawPercent = Number(percent);
        console.log(`🔍 [SCALE CORE DEBUG] Raw percent validation:`, { percent, rawPercent, isFinite: Number.isFinite(rawPercent), isPositive: rawPercent > 0 });

        if (!Number.isFinite(rawPercent) || rawPercent <= 0) {
            console.log(`🔍 [SCALE CORE DEBUG] Invalid percent - returning error`);
            return {
                success: false,
                message: `Invalid scale '${percent}'. Enter a positive percent value.`
            };
        }

        const requestedPercent = Math.min(MAX_SCALE_PERCENT, Math.max(0, rawPercent));
        const currentPrinter = getCurrentPrinter();

        if (!currentPrinter || !Array.isArray(currentPrinter.channels)) {
            return {
                success: false,
                message: 'No printer selected.'
            };
        }

        const lockedChannels = getLockedChannels(currentPrinter.channels);
        if (lockedChannels.length > 0) {
            return {
                success: false,
                message: getGlobalScaleLockMessage(lockedChannels),
                details: {
                    lockedChannels
                }
            };
        }

        const scalingBefore = getScalingSnapshot();
        if (!scaleBaselineEnds) scaleBaselineEnds = {};

        const previousPercent = scaleAllPercent;
        const previousFactor = Math.max(0.0001, previousPercent / 100 || 1);
        const baselineMap = {};
        const stateManager = getStateManager();
        const history = getHistoryManager();
        const batchActions = [];
        let maxAllowedPercent = MAX_SCALE_PERCENT;

        // Calculate baselines and maximum allowed scaling
        for (const channelName of currentPrinter.channels) {
            const row = getChannelRow(channelName);
            if (!row) continue;

            if (isChannelLocked(channelName)) {
                const lockInfo = getChannelLockInfo(channelName);
                const lockLimitPercent = Number.isFinite(lockInfo.percentLimit) ? lockInfo.percentLimit : 100;
                maxAllowedPercent = Math.min(maxAllowedPercent, lockLimitPercent);
                if (scaleBaselineEnds && Object.prototype.hasOwnProperty.call(scaleBaselineEnds, channelName)) {
                    delete scaleBaselineEnds[channelName];
                }
                continue;
            }

            const endInput = row.querySelector('.end-input');
            if (!endInput) continue;

            const currentEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
            if (currentEnd <= 0) continue;

            let baseEnd;
            if (scaleBaselineEnds[channelName] != null) {
                baseEnd = InputValidator.clampEnd(scaleBaselineEnds[channelName]);
                // Guard cached baselines when a channel is already at an endpoint.
                if (previousFactor > 1.000001 && currentEnd >= 65535 && baseEnd > currentEnd) {
                    baseEnd = currentEnd;
                } else if (previousFactor < 0.999999 && currentEnd <= 0 && baseEnd < currentEnd) {
                    baseEnd = currentEnd;
                }
            } else {
                const computedBase = InputValidator.clampEnd(Math.round(currentEnd / previousFactor));
                // Add double-scaling protection guards from legacy system
                const guardingMax = (previousFactor > 1.000001 && currentEnd >= 65535 && computedBase < currentEnd);
                const guardingMin = (previousFactor < 0.999999 && currentEnd <= 0 && computedBase > currentEnd);
                baseEnd = guardingMax || guardingMin ? currentEnd : computedBase;
                scaleBaselineEnds[channelName] = baseEnd;
            }

            baselineMap[channelName] = baseEnd;

            if (baseEnd > 0) {
                const maxPercentForChannel = Math.floor((65535 / baseEnd) * 100);
                maxAllowedPercent = Math.min(maxAllowedPercent, maxPercentForChannel);
            }
        }

        const appliedPercent = Math.min(requestedPercent, maxAllowedPercent);
        const newFactor = Math.max(0.0001, appliedPercent / 100);
        const updates = [];

        // Apply scaling to all channels
        Object.keys(baselineMap).forEach(channelName => {
            const row = getChannelRow(channelName);
            if (!row) return;

            const endInput = row.querySelector('.end-input');
            if (!endInput) return;

            const baseEnd = baselineMap[channelName];
            if (baseEnd <= 0) return;

            const previousEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
            const prevPercent = InputValidator.computePercentFromEnd(previousEnd);
            const newEnd = InputValidator.clampEnd(Math.round(baseEnd * newFactor));

            if (newEnd !== previousEnd) {
                const oldEndValue = previousEnd;
                endInput.value = newEnd;
                endInput.setAttribute('data-base-end', String(newEnd));

                // Update corresponding percent input
                const newPercent = InputValidator.computePercentFromEnd(newEnd);
                const percentInput = row.querySelector('.percent-input');
                if (percentInput) {
                    percentInput.value = Number(newPercent.toFixed(1)).toString();
                    percentInput.setAttribute('data-base-percent', String(newPercent));
                    InputValidator.clearValidationStyling(percentInput);
                }

                const rescaled = rescaleSmartCurveForInkLimit(channelName, prevPercent, newPercent, {
                    mode: 'preserveRelative',
                    historyExtras: { triggeredBy: 'globalScale' }
                });
                updates.push({ channelName, row, newEnd, baseEnd, rescaled });

                stateManager.set(`printer.channelValues.${channelName}.percentage`, newPercent, { skipHistory: true });
                batchActions.push({
                    channelName,
                    type: 'percentage',
                    oldValue: prevPercent,
                    newValue: newPercent
                });

                InputValidator.clearValidationStyling(endInput);
                stateManager.set(`printer.channelValues.${channelName}.endValue`, newEnd, { skipHistory: true });
                batchActions.push({
                    channelName,
                    type: 'endValue',
                    oldValue: oldEndValue,
                    newValue: newEnd
                });
                updateChannelLockBounds(channelName, { percent: newPercent, endValue: newEnd });
            }
        });

        if (updates.length === 0) {
            scaleAllPercent = appliedPercent;
            if (Math.abs(scaleAllPercent - 100) < 1e-6) {
                scaleBaselineEnds = null;
            }

            if (elements.scaleAllInput) {
                elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
            }

            const direction = appliedPercent > previousPercent
                ? 'already maxed at current ink limits'
                : 'already at minimum for active channels';

            clearBakedStateAfterScaling();

            return {
                success: true,
                message: `Scale unchanged — ${direction}.`,
                details: { scalePercent: scaleAllPercent }
            };
        }

        // Reset baseline cache if returning to 100%
        if (Math.abs(appliedPercent - 100) < 1e-6) {
            scaleBaselineEnds = null;
        }

        scaleAllPercent = appliedPercent;

        if (elements.scaleAllInput) {
            elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
        }

        if (!skipHistory && history && batchActions.length > 0) {
            history.recordBatchAction(
                `Scale channels to ${formatScalePercent(appliedPercent)}%`,
                batchActions,
                { scalingBefore, scalingAfter: getScalingSnapshot() }
            );
        }

        clearBakedStateAfterScaling();

        return {
            success: true,
            message: `Scaled ${updates.length} channel${updates.length === 1 ? '' : 's'} by ${appliedPercent}%`,
            details: { scalePercent: appliedPercent, updates: updates.length }
        };

    } catch (error) {
        console.error('Error in scaleChannelEndsByPercent:', error);
        return {
            success: false,
            message: `Error scaling channels: ${error.message}`
        };
    }
}

/**
 * Reset global scaling to 100%
 */
export function resetGlobalScale() {
    scaleAllPercent = 100;
    scaleBaselineEnds = null;

    if (elements.scaleAllInput) {
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
    }

}

/**
 * Get current global scale percentage
 * @returns {number} Current scale percentage
 */
export function getCurrentScale() {
    return scaleAllPercent;
}

/**
 * Reapply the active global scale to the current channel endpoints.
 * Useful after operations that overwrite curve data (e.g., measurement loads or reverts).
 */
export function reapplyCurrentGlobalScale(options = {}) {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const { percent: overridePercent, ...rest } = opts;

    const currentPercent = Number.isFinite(overridePercent)
        ? Number(overridePercent)
        : Number(scaleAllPercent);

    const effectivePercent = Number.isFinite(currentPercent) && currentPercent > 0
        ? currentPercent
        : 100;

    return scaleChannelEndsByPercent(effectivePercent, {
        skipHistory: true,
        ...rest
    });
}

registerDebugNamespace('scalingUtils', {
    scaleChannelEndsByPercent,
    reapplyCurrentGlobalScale,
    updateScaleBaselineForChannel,
    resetGlobalScale,
    getCurrentScale,
    getScalingSnapshot,
    restoreScalingState
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: [
        'reapplyCurrentGlobalScale',
        'updateScaleBaselineForChannel',
        'resetGlobalScale',
        'getCurrentScale'
    ]
});
function clearBakedStateAfterScaling() {
    const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    const clearFn = scope && typeof scope.setGlobalBakedState === 'function'
        ? scope.setGlobalBakedState
        : null;
    if (!clearFn) return;
    try {
        clearFn.call(scope, null, { skipHistory: true });
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[SCALE] Failed to clear baked state after scaling:', error);
        }
    }
}
