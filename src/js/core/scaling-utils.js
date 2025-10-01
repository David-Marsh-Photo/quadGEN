/**
 * Global Channel Scaling Utilities
 * Handles scaling all channel endpoints by a percentage factor
 */

import { elements, getCurrentPrinter } from './state.js';
import { getStateManager } from './state-manager.js';
import { getHistoryManager } from './history-manager.js';
import { InputValidator } from './validation.js';
import { formatScalePercent } from '../ui/ui-utils.js';
import { setChartStatusMessage } from '../ui/chart-manager.js';
import { triggerInkChartUpdate, triggerPreviewUpdate, triggerSessionStatusUpdate } from '../ui/ui-hooks.js';
import { showStatus } from '../ui/status-service.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getChannelRow } from '../ui/channel-registry.js';
import { rescaleSmartCurveForInkLimit } from '../curves/smart-curves.js';

// Global scaling state
let scaleAllPercent = 100;
let scaleBaselineEnds = null;

const MAX_SCALE_PERCENT = 1000;


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

    const currentEnd = InputValidator.clampEnd(endInput.value);
    const factor = Math.max(0.0001, scaleAllPercent / 100 || 1);
    const base = InputValidator.clampEnd(Math.round(currentEnd / factor));

    scaleBaselineEnds[channelName] = base;
}

/**
 * Scale channel endpoints by percentage
 * @param {number} percent - Scale percentage (100 = no change)
 * @returns {Object} Result object with success/message/details
 */
export function scaleChannelEndsByPercent(percent) {
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

            const endInput = row.querySelector('.end-input');
            if (!endInput) continue;

            const currentEnd = InputValidator.clampEnd(endInput.value);
            if (currentEnd <= 0) continue;

            let baseEnd;
            if (scaleBaselineEnds[channelName] != null) {
                baseEnd = InputValidator.clampEnd(scaleBaselineEnds[channelName]);
                // Additional guards when baseline already exists (from legacy system)
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

            const previousEnd = InputValidator.clampEnd(endInput.value);
            const prevPercent = InputValidator.computePercentFromEnd(previousEnd);
            const newEnd = InputValidator.clampEnd(Math.round(baseEnd * newFactor));

            if (newEnd !== previousEnd) {
                const oldEndValue = previousEnd;
                endInput.value = newEnd;

                // Update corresponding percent input
                const newPercent = InputValidator.computePercentFromEnd(newEnd);
                const percentInput = row.querySelector('.percent-input');
                if (percentInput) {
                    percentInput.value = newPercent.toFixed(1);
                    InputValidator.clearValidationStyling(percentInput);
                }

                const rescaled = rescaleSmartCurveForInkLimit(channelName, prevPercent, newPercent);
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
            }
        });

        if (updates.length === 0) {
            scaleAllPercent = previousPercent;
            if (Math.abs(scaleAllPercent - 100) < 1e-6) {
                scaleBaselineEnds = null;
            }

            if (elements.scaleAllInput) {
                elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
            }

            const direction = appliedPercent > previousPercent
                ? 'already maxed at current ink limits'
                : 'already at minimum for active channels';

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

        if (history && batchActions.length > 0) {
            history.recordBatchAction(`Scale channels to ${formatScalePercent(appliedPercent)}%`, batchActions);
        }

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
 * Apply global scale with validation and UI updates
 * @param {number} rawPercent - Raw percentage input
 */
export function applyGlobalScale(rawPercent) {
    console.log(`🔍 [APPLY DEBUG] applyGlobalScale called:`, {
        rawPercent,
        timestamp: Date.now(),
        callStack: new Error().stack.split('\n').slice(1, 4)
    });

    const MIN_SCALE = 1;
    const MAX_SCALE = 1000;

    if (!elements.scaleAllInput) {
        console.log(`🔍 [APPLY DEBUG] No scaleAllInput element found`);
        return;
    }

    let parsed = parseFloat(rawPercent);
    console.log(`🔍 [APPLY DEBUG] Parsed value:`, { rawPercent, parsed });

    if (!Number.isFinite(parsed)) {
        console.warn('🔍 [APPLY DEBUG] Invalid scale value:', rawPercent);
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
        return;
    }

    const beforeClamp = parsed;
    parsed = Math.max(MIN_SCALE, Math.min(MAX_SCALE, parsed));
    console.log(`🔍 [APPLY DEBUG] After clamping:`, { beforeClamp, afterClamp: parsed });

    console.log(`🔍 [APPLY DEBUG] Calling scaleChannelEndsByPercent(${parsed})`);
    const result = scaleChannelEndsByPercent(parsed);
    console.log(`🔍 [APPLY DEBUG] scaleChannelEndsByPercent result:`, result);

    if (!result.success) {
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
        console.error('Scaling failed:', result.message);
        showStatus(result.message || 'Unable to scale channel ends');
        return;
    }

    const applied = result.details?.scalePercent ?? parsed;
    scaleAllPercent = applied;
    elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);

    if (result.message) {
        showStatus(result.message);
    }

    // Show "Preview updated" message on the chart canvas (like quadgen.html)
    setChartStatusMessage('Preview updated', 2000);

    // Trigger chart update if available
    triggerInkChartUpdate();

    // Trigger preview update to show status messages
    console.log('📊 Calling updatePreview after scaling');
    triggerPreviewUpdate();

    // Update session status after scaling
    console.log('📊 Calling updateSessionStatus after scaling');
    triggerSessionStatusUpdate();

    console.log(`✅ Global scale applied: ${formatScalePercent(applied)}%`);
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

registerDebugNamespace('scalingUtils', {
    applyGlobalScale,
    scaleChannelEndsByPercent,
    updateScaleBaselineForChannel,
    resetGlobalScale,
    getCurrentScale
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: [
        'applyGlobalScale',
        'scaleChannelEndsByPercent',
        'updateScaleBaselineForChannel',
        'resetGlobalScale',
        'getCurrentScale'
    ]
});
