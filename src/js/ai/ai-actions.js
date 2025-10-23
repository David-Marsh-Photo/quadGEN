// quadGEN AI Actions
// QuadGenActions class extracted from monolithic codebase
// Note: This module requires integration with application state and UI handlers

import scalingCoordinator from '../core/scaling-coordinator.js';
import { elements, getCurrentPrinter, getCurrentState, updateAppState, getAppState, getLoadedQuadData, PRINTERS } from '../core/state.js';
import { InputValidator } from '../core/validation.js';
import { buildFile } from '../core/processing-pipeline.js';
import { updateInkChart } from '../ui/chart-manager.js';
import { updateProcessingDetail } from '../ui/processing-status.js';
import { showStatus } from '../ui/status-service.js';
import {
    triggerRevertButtonsUpdate,
    triggerSessionStatusUpdate,
    triggerInkChartUpdate,
    triggerProcessingDetailAll,
    triggerPreviewUpdate
} from '../ui/ui-hooks.js';
import {
    insertSmartKeyPointAt,
    deleteSmartKeyPointByIndex,
    adjustSmartKeyPointByIndex,
    simplifySmartKeyPointsFromCurve
} from '../curves/smart-curves.js';
import { LinearizationState, normalizeLinearizationEntry, getEditedDisplayName, getBasePointCountLabel } from '../data/linearization-utils.js';
import { parseLabData, applyDefaultLabSmoothingToEntry } from '../data/lab-parser.js';
import { parseManualLstarData } from '../parsers/file-parsers.js';
import { setPrinter } from '../ui/printer-manager.js';
import { computeGlobalRevertState, resetSmartPointsForChannels, resetChannelSmartPointsToMeasurement } from '../ui/revert-controls.js';
import { maybeAutoRaiseInkLimits } from '../core/auto-raise-on-import.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

/**
 * Core AI actions handler for quadGEN Lab Tech integration
 * Provides programmatic interface for AI assistant to control application
 */
export class QuadGenActions {
    constructor() {
        this.lastAction = null;
        this.lastActionTime = null;
    }

    /**
     * Resolve channel: if not provided, choose the first enabled channel
     * Enabled = percentage > 0 OR endValue > 0 OR enabled = true
     * @param {string|null} preferredChannel - Optional preferred channel name
     * @returns {string} Channel name
     */
    _resolveChannel(preferredChannel = null) {
        if (preferredChannel) return preferredChannel;

        try {
            // Get current printer configuration
            const printer = getCurrentPrinter();
            if (!printer || !printer.channels) return 'K';

            // Look for first enabled channel
            for (const channelName of printer.channels) {
                const row = document.querySelector(`tr[data-channel="${channelName}"]`);
                if (row) {
                    const percentInput = row.querySelector('.percent-input');
                    const endInput = row.querySelector('.end-input');

                    const percent = percentInput ? parseFloat(percentInput.value) || 0 : 0;
                    const endValue = endInput ? parseInt(endInput.value) || 0 : 0;

                    if (percent > 0 || endValue > 0) {
                        return channelName;
                    }
                }
            }

            // If no enabled channels, return first available
            return printer.channels[0] || 'K';
        } catch (error) {
            console.warn('Error resolving channel:', error);
            return 'K';
        }
    }

    /**
     * Set individual channel ink limit value
     * @param {string} channelName - Channel name (K, C, M, Y, etc.)
     * @param {number} percentage - Ink limit percentage (0-100)
     * @returns {Object} Result with success status and message
     */
    setChannelValue(channelName, percentage) {
        try {
            // Validate inputs
            const validPercent = InputValidator.clampPercent(percentage);
            const endValue = InputValidator.computeEndFromPercent(validPercent);

            // Find the channel row
            const row = document.querySelector(`tr[data-channel="${channelName}"]`);
            if (!row) {
                return {
                    success: false,
                    message: `Channel ${channelName} not found`
                };
            }

            // Update the UI inputs
            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (percentInput) {
                percentInput.value = validPercent;
                // Trigger change event to update any listeners
                percentInput.dispatchEvent(new Event('input', { bubbles: true }));
                percentInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (endInput) {
                endInput.value = endValue;
                // Trigger change event to update any listeners
                endInput.dispatchEvent(new Event('input', { bubbles: true }));
                endInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Update processing detail for this channel
            updateProcessingDetail(channelName);

            // Update chart
            updateInkChart();

            return {
                success: true,
                message: `Set ${channelName} channel to ${validPercent}%`
            };
        } catch (error) {
            return {
                success: false,
                message: `Error setting channel value: ${error.message}`
            };
        }
    }

    /**
     * Set channel end value (raw value, not percentage)
     * @param {string} channelName - Channel name
     * @param {number} endValue - Raw end value (0-65535)
     * @returns {Object} Result with success status and message
     */
    setChannelEndValue(channelName, endValue) {
        try {
            // Validate and clamp end value
            const validEndValue = InputValidator.clampEndValue(endValue);
            const percentage = InputValidator.computePercentFromEnd(validEndValue);

            // Find the channel row
            const row = document.querySelector(`tr[data-channel="${channelName}"]`);
            if (!row) {
                return {
                    success: false,
                    message: `Channel ${channelName} not found`
                };
            }

            // Update the UI inputs
            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (endInput) {
                endInput.value = validEndValue;
                // Trigger change event to update any listeners
                endInput.dispatchEvent(new Event('input', { bubbles: true }));
                endInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (percentInput) {
                percentInput.value = percentage;
                // Trigger change event to update any listeners
                percentInput.dispatchEvent(new Event('input', { bubbles: true }));
                percentInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Update processing detail for this channel
            updateProcessingDetail(channelName);

            // Update chart
            updateInkChart();

            return {
                success: true,
                message: `Set ${channelName} channel end value to ${validEndValue} (${percentage}%)`
            };
        } catch (error) {
            return {
                success: false,
                message: `Error setting channel end value: ${error.message}`
            };
        }
    }

    /**
     * Apply percentage to all enabled channels
     * @param {number} percentage - Percentage to apply (0-100)
     * @returns {Object} Result with success status and message
     */
    applyToAllChannels(percentage) {
        try {
            const validPercent = InputValidator.clampPercent(percentage);
            const printer = getCurrentPrinter();
            if (!printer || !printer.channels) {
                return {
                    success: false,
                    message: 'No printer configuration available'
                };
            }

            let appliedChannels = 0;
            const results = [];

            // Apply to all enabled channels
            printer.channels.forEach(channelName => {
                const row = document.querySelector(`tr[data-channel="${channelName}"]`);
                if (row) {
                    const percentInput = row.querySelector('.percent-input');
                    const endInput = row.querySelector('.end-input');

                    // Check if channel is currently enabled
                    const currentPercent = percentInput ? parseFloat(percentInput.value) || 0 : 0;
                    const currentEnd = endInput ? parseInt(endInput.value) || 0 : 0;

                    if (currentPercent > 0 || currentEnd > 0) {
                        const result = this.setChannelValue(channelName, validPercent);
                        results.push(`${channelName}: ${result.message}`);
                        if (result.success) appliedChannels++;
                    }
                }
            });

            return {
                success: appliedChannels > 0,
                message: appliedChannels > 0 ?
                    `Applied ${validPercent}% to ${appliedChannels} enabled channels` :
                    'No enabled channels found to apply percentage to',
                details: results
            };
        } catch (error) {
            return {
                success: false,
                message: `Error applying to all channels: ${error.message}`
            };
        }
    }

    _applyGlobalLinearization(normalized, filename, pointLabel, statusMessage) {
        try {
            const sampleCount = Array.isArray(normalized.samples) ? normalized.samples.length : 0;
            const displayName = getEditedDisplayName(filename, false);
            const pointSummary = pointLabel || getBasePointCountLabel(normalized);
            const message = statusMessage || `Applied global correction (${pointSummary})`;

            LinearizationState.setGlobalData(normalized, true);
            if (typeof window !== 'undefined' && typeof window.__quadSetGlobalBakedState === 'function') {
                window.__quadSetGlobalBakedState(null, { skipHistory: true });
            }
            updateAppState({
                linearizationData: normalized,
                linearizationApplied: true
            });

            maybeAutoRaiseInkLimits(normalized, {
                scope: 'global',
                label: 'global correction',
                source: 'global-linearization'
            });

            if (isBrowser) {
                globalScope.linearizationData = normalized;
                globalScope.linearizationApplied = true;
            }

            if (elements.globalLinearizationBtn) {
                elements.globalLinearizationBtn.setAttribute('data-tooltip', `Loaded: ${displayName}`);
            }
            if (elements.globalLinearizationFilename) {
                elements.globalLinearizationFilename.textContent = filename;
            }
            if (elements.globalLinearizationDetails) {
                elements.globalLinearizationDetails.textContent = ` (${pointSummary})`;
            }
            if (elements.globalLinearizationToggle) {
                elements.globalLinearizationToggle.disabled = false;
                elements.globalLinearizationToggle.checked = true;
                elements.globalLinearizationToggle.setAttribute('aria-checked', 'true');
            }
            if (elements.globalLinearizationInfo) {
                elements.globalLinearizationInfo.classList.remove('hidden');
            }
            if (elements.globalLinearizationHint) {
                elements.globalLinearizationHint.classList.add('hidden');
            }

            updateInkChart();

            if (isBrowser) {
                if (typeof globalScope.updateInterpolationControls === 'function') {
                    try { globalScope.updateInterpolationControls(); } catch (err) { /* ignore */ }
                }
                try { triggerRevertButtonsUpdate(); } catch (err) { /* ignore */ }
                try { triggerSessionStatusUpdate(); } catch (err) { /* ignore */ }
                if (typeof globalScope.postGlobalDeltaChatSummary === 'function') {
                    try { globalScope.postGlobalDeltaChatSummary(); } catch (err) { /* ignore */ }
                }
            }

            showStatus(message);

            return {
                success: true,
                message,
                format: normalized.format,
                sampleCount
            };

        } catch (error) {
            console.error('Failed to apply global linearization:', error);
            return {
                success: false,
                message: `Error applying global linearization: ${error.message}`
            };
        }
    }

    _applyPerChannelLinearization(channelName, normalized, filename, statusMessage) {
        try {
            if (!channelName) {
                return {
                    success: false,
                    message: 'Channel name is required for per-channel linearization'
                };
            }

            const sampleCount = Array.isArray(normalized.samples) ? normalized.samples.length : 0;
            const displayName = getEditedDisplayName(filename, false);
            const message = statusMessage || `Loaded ${channelName} correction (${getBasePointCountLabel(normalized)})`;

            LinearizationState.setPerChannelData(channelName, normalized, true);

            const currentAppState = getAppState();
            const nextPerChannelMap = {
                ...(currentAppState.perChannelLinearization || {}),
                [channelName]: normalized
            };
            updateAppState({ perChannelLinearization: nextPerChannelMap });

            maybeAutoRaiseInkLimits(normalized, {
                scope: 'channel',
                channelName,
                label: `${channelName} correction`,
                source: 'per-channel-linearization'
            });

            let handledViaToggle = false;
            const channelRow = document.querySelector(`tr[data-channel="${channelName}"]`);
            if (channelRow) {
                const loadBtn = channelRow.querySelector('.per-channel-btn');
                if (loadBtn) {
                    loadBtn.setAttribute('data-tooltip', `Loaded: ${displayName}`);
                }

                const revertBtn = channelRow.querySelector('.per-channel-revert');
                if (revertBtn) {
                    revertBtn.disabled = false;
                    revertBtn.classList.remove('invisible');
                    revertBtn.title = `Revert ${channelName} to measurement`;
                }

                const toggle = channelRow.querySelector('.per-channel-toggle');
                if (toggle) {
                    toggle.disabled = false;
                    toggle.checked = true;
                    toggle.setAttribute('aria-checked', 'true');

                    try {
                        toggle.dispatchEvent(new Event('change', { bubbles: true }));
                        handledViaToggle = true;
                    } catch (err) {
                        if (console && console.warn) console.warn('Unable to dispatch toggle change event:', err);
                    }
                }
            }

            if (!handledViaToggle) {
                updateProcessingDetail(channelName);
                updateInkChart();
                try { triggerRevertButtonsUpdate(); } catch (err) { /* ignore */ }
                try { triggerSessionStatusUpdate(); } catch (err) { /* ignore */ }
                try { triggerInkChartUpdate(); } catch (err) { /* ignore */ }
            }

            showStatus(message);

            return {
                success: true,
                message,
                channel: channelName,
                format: normalized.format,
                sampleCount
            };

        } catch (error) {
            console.error('Failed to apply per-channel linearization:', error);
            return {
                success: false,
                message: `Error applying per-channel linearization: ${error.message}`
            };
        }
    }

    /**
     * Load LAB measurement data from pasted text
     * @param {string} labData - LAB measurement text
     * @param {boolean} isGlobal - Whether to apply globally or per-channel
     * @param {string|null} channelName - Optional channel name for per-channel loads
     * @returns {Object} Result object indicating success and contextual message
     */
    loadLabData(labData, isGlobal = true, channelName = null) {
        try {
            const labText = typeof labData === 'string' ? labData.trim() : '';
            if (!labText) {
                return {
                    success: false,
                    message: 'LAB data text is required'
                };
            }

            let resolvedChannel = null;
            if (!isGlobal) {
                resolvedChannel = (channelName || this._resolveChannel()).toUpperCase();
                const printer = getCurrentPrinter();
                const availableChannels = printer?.channels || [];
                if (!availableChannels.includes(resolvedChannel)) {
                    return {
                        success: false,
                        message: `Channel ${resolvedChannel} is not available for the current printer`
                    };
                }
            }

            const filename = isGlobal
                ? 'Lab Tech LAB (global).txt'
                : `Lab Tech LAB (${resolvedChannel}).txt`;

            const parsed = parseLabData(labText, filename);
            if (!parsed || parsed.valid === false) {
                return {
                    success: false,
                    message: parsed?.error || 'Unable to parse LAB data'
                };
            }

            const prepared = applyDefaultLabSmoothingToEntry(parsed);
            prepared.filename = filename;

            const normalized = normalizeLinearizationEntry(prepared);
            normalized.filename = filename;
            normalized.edited = false;

            const sampleCount = Array.isArray(normalized.samples) ? normalized.samples.length : 0;
            const pointLabel = getBasePointCountLabel(normalized);

            if (isGlobal) {
                const message = `Loaded global LAB correction via Lab Tech (${pointLabel})`;
                return this._applyGlobalLinearization(normalized, filename, pointLabel, message);
            }

            const channelMessage = `Loaded ${resolvedChannel} LAB correction via Lab Tech (${pointLabel})`;
            return this._applyPerChannelLinearization(resolvedChannel, normalized, filename, channelMessage);

        } catch (error) {
            console.error('Failed to load LAB data:', error);
            return {
                success: false,
                message: `Error loading LAB data: ${error.message}`
            };
        }
    }

    /**
     * Apply manual L* values as a correction curve
     * @param {number[]} lValues - Array of L* values (0–100)
     * @param {string|null} channelName - Optional channel to target (defaults to global)
     * @param {number[]|null} patchPercents - Optional patch percentages matching lValues
     * @returns {Object} Result object indicating success, sample count, etc.
     */
    applyManualLstarValues(lValues, channelName = null, patchPercents = null) {
        try {
            if (!Array.isArray(lValues) || lValues.length < 3) {
                return {
                    success: false,
                    message: 'At least three L* values are required to build a correction'
                };
            }

            const cleaned = lValues
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value));

            if (cleaned.length !== lValues.length) {
                return {
                    success: false,
                    message: 'All L* values must be numeric'
                };
            }

            const clampedL = cleaned.map((value) => Math.max(0, Math.min(100, value)));
            const count = clampedL.length;

            const percentSource = Array.isArray(patchPercents) && patchPercents.length === count
                ? patchPercents.map((value) => Number(value))
                : null;

            const percents = percentSource && percentSource.every((value) => Number.isFinite(value))
                ? percentSource.map((value) => Math.max(0, Math.min(100, value)))
                : clampedL.map((_, index) => {
                    if (count === 1) return 0;
                    return (index / (count - 1)) * 100;
                });

            const measuredPairs = percents.map((x, idx) => ({
                x,
                l: clampedL[idx]
            }));

            const validation = {
                isValid: true,
                measuredPairs
            };

            const parsed = parseManualLstarData(validation);
            if (!parsed || parsed.valid === false) {
                return {
                    success: false,
                    message: parsed?.error || 'Unable to generate manual L* correction'
                };
            }

            const baseEntry = normalizeLinearizationEntry(parsed);
            baseEntry.edited = false;

            const cloneEntry = (filename) => ({
                ...baseEntry,
                samples: Array.isArray(baseEntry.samples) ? baseEntry.samples.slice() : [],
                baseSamples: Array.isArray(baseEntry.baseSamples) ? baseEntry.baseSamples.slice() : undefined,
                rawSamples: Array.isArray(baseEntry.rawSamples) ? baseEntry.rawSamples.slice() : undefined,
                previewSamples: Array.isArray(baseEntry.previewSamples) ? baseEntry.previewSamples.slice() : undefined,
                originalData: Array.isArray(baseEntry.originalData)
                    ? baseEntry.originalData.map((point) => ({ ...point }))
                    : [],
                filename,
                edited: false
            });

            const pointLabel = getBasePointCountLabel(baseEntry);
            const sampleCount = Array.isArray(baseEntry.samples) ? baseEntry.samples.length : 0;

            const globalFilename = 'Lab Tech Manual L* (global).txt';
            const globalEntry = cloneEntry(globalFilename);
            const globalMessage = `Applied manual L* correction via Lab Tech (${pointLabel})`;
            const globalResult = this._applyGlobalLinearization(globalEntry, globalFilename, pointLabel, globalMessage);

            if (!channelName) {
                if (globalResult.success) {
                    globalResult.sampleCount = sampleCount;
                }
                return globalResult;
            }

            const resolvedChannel = channelName.toUpperCase();
            const printer = getCurrentPrinter();
            const availableChannels = printer?.channels || [];
            if (!availableChannels.includes(resolvedChannel)) {
                return {
                    success: false,
                    message: `Channel ${resolvedChannel} is not available for the current printer`,
                    details: { global: globalResult }
                };
            }

            const channelFilename = `Lab Tech Manual L* (${resolvedChannel}).txt`;
            const perEntry = cloneEntry(channelFilename);
            const channelMessage = `Loaded ${resolvedChannel} Manual L* correction via Lab Tech (${pointLabel})`;
            const perResult = this._applyPerChannelLinearization(resolvedChannel, perEntry, channelFilename, channelMessage);

            const combinedSuccess = globalResult.success && perResult.success;
            return {
                success: combinedSuccess,
                message: combinedSuccess
                    ? `Applied manual L* correction globally and to ${resolvedChannel}`
                    : `Results — global: ${globalResult.message}; ${resolvedChannel}: ${perResult.message}`,
                channel: resolvedChannel,
                sampleCount,
                details: {
                    global: globalResult,
                    perChannel: perResult
                }
            };

        } catch (error) {
            console.error('Failed to apply manual L* values:', error);
            return {
                success: false,
                message: `Error applying manual L* values: ${error.message}`
            };
        }
    }

    /**
     * Scale all channel end values by percentage
     * @param {number} scalePercent - Scale percentage (e.g., 110 for 10% increase)
     * @returns {Object} Result with success status and message
     */
    async scaleChannelEndsByPercent(scalePercent) {
        try {
            const numeric = Number(scalePercent);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                return {
                    success: false,
                    message: `Invalid scale percent '${scalePercent}'`
                };
            }

            const result = await scalingCoordinator.scale(numeric, 'ai', {
                priority: 'high',
                metadata: { trigger: 'ai-scale_command' }
            });

            // Update processing details and session status after scaling
            this._updateGraphStatus();

            if (result && typeof result === 'object') {
                const success = typeof result.success === 'boolean' ? result.success : true;
                const message = result.message || `Scaled channels by ${scalePercent}%`;
                return {
                    success,
                    message,
                    details: result.details
                };
            }

            return {
                success: true,
                message: `Scaled channels by ${scalePercent}%`
            };
        } catch (error) {
            return {
                success: false,
                message: `Error scaling channels: ${error.message}`
            };
        }
    }

    /**
     * Change the active printer model
     * @param {string} printerName - Printer identifier (e.g., P700P900)
     * @returns {Object} Result with success status and message
     */
    changePrinter(printerName) {
        try {
            if (!printerName || !PRINTERS[printerName]) {
                return {
                    success: false,
                    message: `Invalid printer '${printerName}'. Available printers: ${Object.keys(PRINTERS).join(', ')}`
                };
            }

            setPrinter(printerName, { silent: false });

            const printer = PRINTERS[printerName];
            this._updateGraphStatus();

            return {
                success: true,
                message: `Switched to ${printer.name}`
            };
        } catch (error) {
            console.error('Error changing printer:', error);
            return {
                success: false,
                message: `Error changing printer: ${error.message}`
            };
        }
    }

    /**
     * Get current application state
     * @returns {Object} Current state data
     */
    getCurrentState() {
        try {
            const printer = getCurrentPrinter();
            const state = getCurrentState();
            const channels = {};

            // Get channel data from DOM and state
            if (printer && printer.channels) {
                printer.channels.forEach(channelName => {
                    const row = document.querySelector(`tr[data-channel="${channelName}"]`);
                    if (row) {
                        const percentInput = row.querySelector('.percent-input');
                        const endInput = row.querySelector('.end-input');

                        channels[channelName] = {
                            percentage: percentInput ? parseFloat(percentInput.value) || 0 : 0,
                            endValue: endInput ? parseInt(endInput.value) || 0 : 0,
                            enabled: (percentInput ? parseFloat(percentInput.value) || 0 : 0) > 0 ||
                                   (endInput ? parseInt(endInput.value) || 0 : 0) > 0
                        };
                    }
                });
            }

            return {
                success: true,
                message: 'Retrieved current application state',
                data: {
                    channels,
                    printer: printer || { name: 'Unknown', channels: ['K'] },
                    hasLoadedQuad: !!(getLoadedQuadData()?.curves),
                    linearizationApplied: !!(LinearizationState?.globalApplied || getAppState().linearizationApplied),
                    autoWhiteLimit: !!(elements?.autoWhiteLimitToggle?.checked),
                    autoBlackLimit: !!(elements?.autoBlackLimitToggle?.checked)
                }
            };
        } catch (error) {
            return {
                success: false,
                message: `Error getting current state: ${error.message}`,
                data: {
                    channels: {},
                    printer: { name: 'Unknown', channels: ['K'] }
                }
            };
        }
    }

    /**
     * Generate and download quad file
     * @returns {Object} Result with success status and message
     */
    generateAndDownloadQuadFile() {
        try {
            // Use the actual buildFile function from the processing pipeline
            const result = buildFile();

            if (result && typeof result === 'object' && result.success !== false) {
                return {
                    success: true,
                    message: 'Generated and downloaded quad file successfully'
                };
            } else {
                return {
                    success: false,
                    message: result?.message || 'Failed to generate quad file'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Error generating quad file: ${error.message}`
            };
        }
    }

    /**
     * Enable or disable a specific channel
     * @param {string} channelName - Channel name
     * @param {boolean} enabled - Whether to enable the channel
     * @returns {Object} Result with success status and message
     */
    enableDisableChannel(channelName, enabled) {
        try {
            const row = document.querySelector(`tr[data-channel="${channelName}"]`);
            if (!row) {
                return {
                    success: false,
                    message: `Channel ${channelName} not found`
                };
            }

            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (enabled) {
                // Enable: set to default values if currently disabled
                const currentPercent = percentInput ? parseFloat(percentInput.value) || 0 : 0;
                const currentEnd = endInput ? parseInt(endInput.value) || 0 : 0;

                if (currentPercent === 0 && currentEnd === 0) {
                    // Set to default enabled values
                    const defaultPercent = 100;
                    const defaultEnd = InputValidator.computeEndFromPercent(defaultPercent);

                    if (percentInput) {
                        percentInput.value = defaultPercent;
                        percentInput.dispatchEvent(new Event('input', { bubbles: true }));
                        percentInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    if (endInput) {
                        endInput.value = defaultEnd;
                        endInput.dispatchEvent(new Event('input', { bubbles: true }));
                        endInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            } else {
                // Disable: set to zero
                if (percentInput) {
                    percentInput.value = 0;
                    percentInput.dispatchEvent(new Event('input', { bubbles: true }));
                    percentInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                if (endInput) {
                    endInput.value = 0;
                    endInput.dispatchEvent(new Event('input', { bubbles: true }));
                    endInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            // Update processing detail and chart
            updateProcessingDetail(channelName);
            updateInkChart();

            return {
                success: true,
                message: `${enabled ? 'Enabled' : 'Disabled'} ${channelName} channel`
            };
        } catch (error) {
            return {
                success: false,
                message: `Error toggling channel: ${error.message}`
            };
        }
    }

    /**
     * Apply contrast intent preset
     * @param {string} preset - Preset name
     * @param {Object} params - Additional parameters
     * @returns {Object} Result with success status and message
     */
    setContrastIntentPreset(preset, params = {}) {
        try {
            // This would need to integrate with contrast intent system
            // For now, provide a meaningful stub that could be extended
            const validPresets = ['linear', 'gentle', 'moderate', 'strong', 'custom'];

            if (!validPresets.includes(preset)) {
                return {
                    success: false,
                    message: `Invalid preset: ${preset}. Valid presets: ${validPresets.join(', ')}`
                };
            }

            // TODO: Implement actual contrast intent application
            // This would involve:
            // 1. Loading appropriate contrast curve data
            // 2. Applying to Smart Curves or linearization
            // 3. Updating the chart and processing status

            console.warn(`QuadGenActions.setContrastIntentPreset: ${preset} preset not yet implemented`);

            return {
                success: false,
                message: `Contrast intent preset '${preset}' recognized but not yet implemented`
            };
        } catch (error) {
            return {
                success: false,
                message: `Error setting contrast intent: ${error.message}`
            };
        }
    }

    /**
     * Revert global measurement to its original seeded Smart points.
     * Mirrors the UI button logic so Lab Tech calls stay in sync with manual workflows.
     * @returns {Object} Result payload with success flag and summary.
     */
    revertGlobalToMeasurement() {
        try {
            const revertState = computeGlobalRevertState();
            const { isMeasurement, hasSmartEdits, wasEdited, isBaked, globalData } = revertState;

            if (isBaked) {
                return {
                    success: false,
                    message: 'Global measurement already baked into Smart curves. Use undo to restore.'
                };
            }

            if (!isMeasurement || !(hasSmartEdits || wasEdited)) {
                return {
                    success: false,
                    message: 'No global measurement edits to revert'
                };
            }

            try {
                globalScope.CurveHistory?.captureState?.('Before: Revert Global to Measurement (AI)');
            } catch (err) {
                console.warn('CurveHistory capture failed during AI revert (global):', err);
            }

            const printer = getCurrentPrinter();
            const channels = Array.isArray(printer?.channels) ? printer.channels : [];
            const summary = resetSmartPointsForChannels(channels, {
                skipUiRefresh: true,
                forceReinitialize: true
            });

            if (globalData) {
                globalData.edited = false;
                LinearizationState.setGlobalData(globalData, true);
                if (typeof window !== 'undefined' && typeof window.__quadSetGlobalBakedState === 'function') {
                    window.__quadSetGlobalBakedState(null, { skipHistory: true });
                }
                updateAppState({ linearizationData: globalData, linearizationApplied: true });
                if (isBrowser) {
                    globalScope.linearizationData = globalData;
                    globalScope.linearizationApplied = true;
                }
            }

            updateInkChart();
            triggerInkChartUpdate();
            triggerProcessingDetailAll();
            triggerPreviewUpdate();
            this._updateGraphStatus();
            triggerRevertButtonsUpdate();

            showStatus('Reverted to measurement (global)');

            return {
                success: true,
                message: 'Global measurement restored',
                seededChannels: summary.seeded,
                reinitializedChannels: summary.reinitialized
            };
        } catch (error) {
            console.error('QuadGenActions.revertGlobalToMeasurement failed:', error);
            return {
                success: false,
                message: `Error reverting global measurement: ${error.message}`
            };
        }
    }

    /**
     * Revert a single channel to its loaded measurement source.
     * @param {string} channelName - Channel identifier
     * @returns {Object} Result payload with success flag and summary.
     */
    revertChannelToMeasurement(channelName) {
        try {
            const targetChannel = channelName || this._resolveChannel();
            const measurement = LinearizationState.getPerChannelData(targetChannel);
            const enabled = LinearizationState.isPerChannelEnabled(targetChannel);

            if (!measurement || !enabled) {
                return {
                    success: false,
                    message: `${targetChannel} has no measurement data loaded`
                };
            }

            try {
                globalScope.CurveHistory?.captureState?.(`Before: Revert ${targetChannel} to Measurement (AI)`);
            } catch (err) {
                console.warn('CurveHistory capture failed during AI revert (per-channel):', err);
            }

            measurement.edited = false;
            LinearizationState.setPerChannelData(targetChannel, measurement, true);

            const appState = getAppState();
            const nextLinearization = { ...(appState.perChannelLinearization || {}) };
            nextLinearization[targetChannel] = measurement;
            const nextEnabled = { ...(appState.perChannelEnabled || {}) };
            nextEnabled[targetChannel] = true;
            updateAppState({
                perChannelLinearization: nextLinearization,
                perChannelEnabled: nextEnabled
            });

            const result = resetChannelSmartPointsToMeasurement(targetChannel, {
                skipUiRefresh: true,
                forceReinitialize: true
            });

            const row = document.querySelector(`tr[data-channel="${targetChannel}"]`);
            if (row) {
                row.removeAttribute('data-allow-toggle');

                const toggle = row.querySelector('.per-channel-toggle');
                if (toggle) {
                    toggle.disabled = false;
                    toggle.checked = true;
                    toggle.setAttribute('aria-checked', 'true');
                }

                const revertBtn = row.querySelector('.per-channel-revert');
                if (revertBtn) {
                    revertBtn.disabled = true;
                    revertBtn.classList.add('invisible');
                }

                if (typeof row.refreshDisplayFn === 'function') {
                    try { row.refreshDisplayFn(); } catch (err) {
                        console.warn('Per-channel display refresh failed after AI revert:', err);
                    }
                }
            }

            updateProcessingDetail(targetChannel);
            updateInkChart();
            triggerInkChartUpdate();
            triggerRevertButtonsUpdate();
            triggerSessionStatusUpdate();
            triggerPreviewUpdate();

            showStatus(`Reverted ${targetChannel} to measurement`);

            return {
                success: true,
                message: `Reverted ${targetChannel} to measurement`,
                channel: targetChannel,
                restoredFromSeed: !!result?.restoredFromSeed
            };
        } catch (error) {
            console.error('QuadGenActions.revertChannelToMeasurement failed:', error);
            return {
                success: false,
                message: `Error reverting channel: ${error.message}`
            };
        }
    }

    /**
     * Update graph status displays after operations
     * Calls updateSessionStatus and updateProcessingDetail for all channels
     * @private
     */
    _updateGraphStatus() {
        try {
            // Update session status at the top of the graph (if available)
            triggerSessionStatusUpdate();

            // Update processing details for all channels using actual printer configuration
            const printer = getCurrentPrinter();
            const channels = (printer && printer.channels) ? printer.channels : ['K', 'C', 'M', 'Y'];

            channels.forEach(channelName => {
                try {
                    updateProcessingDetail(channelName);
                } catch (err) {
                    console.warn(`Failed to update processing detail for ${channelName}:`, err);
                }
            });
        } catch (error) {
            console.warn('Error updating graph status:', error);
        }
    }

    /**
     * Set auto white limit rolloff (toe near paper white)
     * @param {boolean} enabled - Whether to enable white limit rolloff
     * @returns {Object} Result with success status and message
     */
    setAutoWhiteLimit(enabled) {
        try {
            const toggle = document.getElementById('autoWhiteLimitToggle');
            if (!toggle) {
                return {
                    success: false,
                    message: 'Auto white limit controls not found (feature may be disabled)'
                };
            }

            toggle.checked = !!enabled;

            // Trigger change event to update localStorage and status
            toggle.dispatchEvent(new Event('change', { bubbles: true }));

            // Update graph status after change
            this._updateGraphStatus();

            return {
                success: true,
                message: enabled ? 'Auto white limit enabled' : 'Auto white limit disabled'
            };
        } catch (error) {
            return {
                success: false,
                message: `Error setting auto white limit: ${error.message}`
            };
        }
    }

    /**
     * Set auto black limit rolloff (shoulder near max ink)
     * @param {boolean} enabled - Whether to enable black limit rolloff
     * @returns {Object} Result with success status and message
     */
    setAutoBlackLimit(enabled) {
        try {
            const toggle = document.getElementById('autoBlackLimitToggle');
            if (!toggle) {
                return {
                    success: false,
                    message: 'Auto black limit controls not found (feature may be disabled)'
                };
            }

            toggle.checked = !!enabled;

            // Trigger change event to update localStorage and status
            toggle.dispatchEvent(new Event('change', { bubbles: true }));

            // Update graph status after change
            this._updateGraphStatus();

            return {
                success: true,
                message: enabled ? 'Auto black limit enabled' : 'Auto black limit disabled'
            };
        } catch (error) {
            return {
                success: false,
                message: `Error setting auto black limit: ${error.message}`
            };
        }
    }

    // TODO: Add remaining methods from the full QuadGenActions class as needed
    // === Smart Curves Methods ===

    /**
     * Insert a new Smart key point at specified input/output position
     * @param {string} channelName - Channel to modify
     * @param {number} inputPercent - X position (0-100%)
     * @param {number|null} outputPercent - Y position (0-100%), null to sample curve
     * @returns {Object} Success/failure result
     */
    insertSmartKeyPointAt(channelName, inputPercent, outputPercent = null) {
        try {
            const result = insertSmartKeyPointAt(channelName, inputPercent, outputPercent);

            if (result.success) {
                // Update UI after successful insertion
                updateInkChart();
                updateProcessingDetail(channelName);
            } else if (result && result.message) {
                showStatus(result.message);
            }

            return result;
        } catch (error) {
            console.error('Failed to insert Smart key point:', error);
            return { success: false, message: `Error inserting point: ${error.message}` };
        }
    }

    /**
     * Delete a Smart key point by ordinal index
     * @param {string} channelName - Channel to modify
     * @param {number} ordinal - 1-based point index
     * @param {Object} options - Additional options
     * @returns {Object} Success/failure result
     */
    deleteSmartKeyPointByIndex(channelName, ordinal, options = {}) {
        try {
            const result = deleteSmartKeyPointByIndex(channelName, ordinal, options);

            if (result.success) {
                updateInkChart();
                updateProcessingDetail(channelName);
            } else if (result && result.message) {
                showStatus(result.message);
            }

            return result;
        } catch (error) {
            console.error('Failed to delete Smart key point:', error);
            return { success: false, message: `Error deleting point: ${error.message}` };
        }
    }

    /**
     * Adjust a Smart key point by ordinal index
     * @param {string} channelName - Channel to modify
     * @param {number} ordinal - 1-based point index
     * @param {Object} params - Adjustment parameters
     * @returns {Object} Success/failure result
     */
    adjustSmartKeyPointByIndex(channelName, ordinal, params = {}) {
        try {
            const result = adjustSmartKeyPointByIndex(channelName, ordinal, params);

            if (result.success) {
                updateInkChart();
                updateProcessingDetail(channelName);
            }

            return result;
        } catch (error) {
            console.error('Failed to adjust Smart key point:', error);
            return { success: false, message: `Error adjusting point: ${error.message}` };
        }
    }

    /**
     * Simplify Smart key points from curve data
     * @param {string} channelName - Channel to modify
     * @param {Object} options - Simplification options
     * @returns {Object} Success/failure result
     */
    simplifySmartKeyPointsFromCurve(channelName, options = {}) {
        try {
            const result = simplifySmartKeyPointsFromCurve(channelName, options);

            if (result.success) {
                updateInkChart();
                updateProcessingDetail(channelName);
            }

            return result;
        } catch (error) {
            console.error('Failed to simplify Smart key points:', error);
            return { success: false, message: `Error simplifying points: ${error.message}` };
        }
    }

    /**
     * Set measurement spot marker overlay visibility
     * @param {boolean} enabled - true to show, false to hide
     * @returns {Object} Success/failure result
     */
    setLabSpotMarkers(enabled) {
        try {
            if (typeof enabled !== 'boolean') {
                return { success: false, message: 'enabled parameter must be a boolean' };
            }

            if (typeof globalScope.setLabSpotMarkerOverlayEnabled === 'function') {
                const result = globalScope.setLabSpotMarkerOverlayEnabled(enabled);
                return {
                    success: true,
                    message: `Measurement spot markers ${enabled ? 'enabled' : 'disabled'}`,
                    enabled: result
                };
            } else {
                return { success: false, message: 'setLabSpotMarkerOverlayEnabled function not available' };
            }
        } catch (error) {
            console.error('Failed to set lab spot markers:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Set auto-raise ink limits on import
     * @param {boolean} enabled - true to enable, false to disable
     * @returns {Object} Success/failure result
     */
    setAutoRaiseInkLimits(enabled) {
        try {
            if (typeof enabled !== 'boolean') {
                return { success: false, message: 'enabled parameter must be a boolean' };
            }

            if (typeof globalScope.enableAutoRaiseInkLimitsOnImport === 'function') {
                const result = globalScope.enableAutoRaiseInkLimitsOnImport(enabled);
                return {
                    success: true,
                    message: `Auto-raise ink limits ${enabled ? 'enabled' : 'disabled'}`,
                    enabled: result
                };
            } else {
                return { success: false, message: 'enableAutoRaiseInkLimitsOnImport function not available' };
            }
        } catch (error) {
            console.error('Failed to set auto-raise ink limits:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Set light-blocking overlay visibility
     * @param {boolean} enabled - true to show, false to hide
     * @returns {Object} Success/failure result
     */
    setLightBlockingOverlay(enabled) {
        try {
            if (typeof enabled !== 'boolean') {
                return { success: false, message: 'enabled parameter must be a boolean' };
            }

            if (typeof globalScope.setLightBlockingOverlayEnabled === 'function') {
                const result = globalScope.setLightBlockingOverlayEnabled(enabled);
                return {
                    success: true,
                    message: `Light-blocking overlay ${enabled ? 'enabled' : 'disabled'}`,
                    enabled: result
                };
            } else {
                return { success: false, message: 'setLightBlockingOverlayEnabled function not available' };
            }
        } catch (error) {
            console.error('Failed to set light-blocking overlay:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Set correction method (simple or density_solver)
     * @param {string} method - "simple" or "density_solver"
     * @returns {Object} Success/failure result
     */
    setCorrectionMethod(method) {
        try {
            if (method !== 'simple' && method !== 'density_solver') {
                return { success: false, message: 'method must be "simple" or "density_solver"' };
            }

            if (typeof globalScope.enableSimpleScalingCorrection === 'function') {
                const enableSimple = method === 'simple';
                const result = globalScope.enableSimpleScalingCorrection(enableSimple);
                return {
                    success: true,
                    message: `Correction method set to ${method === 'simple' ? 'Simple Scaling' : 'Density Solver'}`,
                    method: method,
                    enabled: result
                };
            } else {
                return { success: false, message: 'enableSimpleScalingCorrection function not available' };
            }
        } catch (error) {
            console.error('Failed to set correction method:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Set correction gain blend percentage
     * @param {number} percent - Gain percentage (0-100)
     * @returns {Object} Success/failure result
     */
    setCorrectionGain(percent) {
        try {
            if (typeof percent !== 'number' || percent < 0 || percent > 100) {
                return { success: false, message: 'percent must be a number between 0 and 100' };
            }

            if (typeof globalScope.setCorrectionGainPercent === 'function') {
                globalScope.setCorrectionGainPercent(percent, { updateUI: true });

                const currentPercent = typeof globalScope.getCorrectionGainPercent === 'function'
                    ? globalScope.getCorrectionGainPercent()
                    : percent;

                return {
                    success: true,
                    message: `Correction gain set to ${percent}%`,
                    percent: currentPercent
                };
            } else {
                return { success: false, message: 'setCorrectionGainPercent function not available' };
            }
        } catch (error) {
            console.error('Failed to set correction gain:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Get current correction gain percentage
     * @returns {Object} Result with gain percentage
     */
    getCorrectionGain() {
        try {
            if (typeof globalScope.getCorrectionGainPercent === 'function') {
                const percent = globalScope.getCorrectionGainPercent();
                return {
                    success: true,
                    percent: percent
                };
            } else if (typeof globalScope.getCorrectionGain === 'function') {
                const normalized = globalScope.getCorrectionGain();
                const percent = Math.round(normalized * 100);
                return {
                    success: true,
                    percent: percent
                };
            } else {
                return { success: false, message: 'getCorrectionGain function not available' };
            }
        } catch (error) {
            console.error('Failed to get correction gain:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Lock or unlock a channel
     * @param {string} channelName - Channel name
     * @param {boolean} locked - true to lock, false to unlock
     * @returns {Object} Success/failure result
     */
    lockChannel(channelName, locked) {
        try {
            if (typeof locked !== 'boolean') {
                return { success: false, message: 'locked parameter must be a boolean' };
            }

            if (typeof globalScope.setChannelLock === 'function') {
                globalScope.setChannelLock(channelName, locked);
                return {
                    success: true,
                    message: `Channel ${channelName} ${locked ? 'locked' : 'unlocked'}`,
                    channelName: channelName,
                    locked: locked
                };
            } else {
                return { success: false, message: 'setChannelLock function not available' };
            }
        } catch (error) {
            console.error('Failed to lock/unlock channel:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    /**
     * Get channel lock status for one channel or all channels
     * @param {string|null} channelName - Optional specific channel
     * @returns {Object} Result with lock status
     */
    getChannelLockStatus(channelName = null) {
        try {
            if (typeof globalScope.isChannelLocked === 'function') {
                if (channelName) {
                    // Get status for specific channel
                    const locked = globalScope.isChannelLocked(channelName);
                    return {
                        success: true,
                        channelName: channelName,
                        locked: locked
                    };
                } else {
                    // Get status for all channels
                    const printer = getCurrentPrinter();
                    if (!printer || !printer.channels) {
                        return { success: false, message: 'No printer configured' };
                    }

                    const status = {};
                    for (const ch of printer.channels) {
                        status[ch] = globalScope.isChannelLocked(ch);
                    }

                    return {
                        success: true,
                        locks: status
                    };
                }
            } else {
                return { success: false, message: 'isChannelLocked function not available' };
            }
        } catch (error) {
            console.error('Failed to get channel lock status:', error);
            return { success: false, message: `Error: ${error.message}` };
        }
    }

    // The original class has many more methods including:
    // - File loading operations
    // - LAB data operations
    // - Edit mode controls
    // - Linearization functions
    // - And many more...
}

/**
 * Create a default instance for use throughout the application
 * @returns {QuadGenActions} Default QuadGenActions instance
 */
export function createQuadGenActions() {
    return new QuadGenActions();
}
