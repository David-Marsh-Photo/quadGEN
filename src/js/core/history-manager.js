// quadGEN History Management (Undo/Redo System)
// Extracted and modularized CurveHistory system with centralized state integration

import { getStateManager } from './state-manager.js';
import { elements, getLoadedQuadData, setLoadedQuadData, ensureLoadedQuadData, updateAppState, getAppState, setEditModeFlag } from './state.js';
import { getCurrentScale, getLegacyScalingSnapshot, restoreLegacyScalingState, updateScaleBaselineForChannel, validateScalingStateSync } from './scaling-utils.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { setSmartKeyPoints, ControlPoints } from '../curves/smart-curves.js';
import { InputValidator } from './validation.js';
import { isEditModeEnabled } from '../ui/edit-mode.js';
import { triggerInkChartUpdate, triggerPreviewUpdate, triggerProcessingDetail, triggerRevertButtonsUpdate } from '../ui/ui-hooks.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';
const HISTORY_SNAPSHOT_VERSION = 2;

/**
 * History management for undo/redo functionality
 * Integrates with centralized state management system
 */
export class HistoryManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.history = []; // Unified timeline of actions and snapshots
        this.redoStack = [];
        this.maxHistorySize = 20; // Keep last 20 actions
        this.isRestoring = false; // Flag to prevent state capture during restore
        this.isBatchOperation = false; // Flag to prevent individual recording during batch operations
        this._pendingKeyPoints = {}; // Pending key-point extras keyed by channel
        this._transactionIdCounter = 0;
        this.activeTransaction = null;
        this._transactionWarnTimer = null;

        // Subscribe to state changes to automatically capture certain operations
        this.setupStateSubscriptions();
    }

    cloneEntry(entry) {
        try {
            return JSON.parse(JSON.stringify(entry));
        } catch (err) {
            console.warn('HistoryManager.cloneEntry failed:', err);
            return entry;
        }
    }

    /**
     * Set up subscriptions to state changes for automatic history capture
     * @private
     */
    setupStateSubscriptions() {
        // Subscribe to channel value changes
        this.stateManager.subscribe(['printer.channelValues', 'printer.channelStates'], (path, newValue, oldValue, options) => {
            if (this.isRestoring || options?.skipHistory) return;

            // Extract channel name and field from path
            const pathParts = path.split('.');
            if (pathParts.length >= 3) {
                const channelName = pathParts[2];
                const field = pathParts[3];

                if (field && channelName) {
                    let actionType = field;
                    if (field === 'percentage') {
                        actionType = 'percentage';
                    } else if (field === 'endValue') {
                        actionType = 'endValue';
                    } else if (field === 'enabled') {
                        actionType = 'enabled';
                    }
                    this.recordChannelAction(channelName, actionType, oldValue, newValue);
                }
            }
        });

        // Subscribe to linearization changes
        this.stateManager.subscribe(['linearization'], (path, newValue, oldValue, options) => {
            if (this.isRestoring || options?.skipHistory) return;

            this.recordLinearizationAction(path, oldValue, newValue);
        });

        // Subscribe to edit selection changes (channel / ordinal)
        this.stateManager.subscribe(['app.editSelection'], (path, newValue, oldValue, options = {}) => {
            if (this.isRestoring || options.skipHistory) return;

            // Only act once per update when metadata payload is available
            if (!path.endsWith('__meta')) return;

            if (!newValue || typeof newValue !== 'object') {
                return;
            }

            const previousSelection = options.previousSelection || {
                channel: null,
                ordinal: 1
            };

            const currentSelection = this.stateManager.getEditSelection();

            if (previousSelection.channel === currentSelection.channel &&
                previousSelection.ordinal === currentSelection.ordinal) {
                return;
            }

            const description = newValue.description
                || (currentSelection.channel
                    ? `Select channel ${currentSelection.channel} (point ${currentSelection.ordinal})`
                    : 'Clear edit selection');

            this.recordUIAction(
                'editSelection',
                { ...previousSelection },
                { ...currentSelection },
                description
            );

            // Clear meta marker to avoid stale descriptions lingering in state
            this.stateManager.set('app.editSelection.__meta', null, { skipHistory: true });
        });
    }

    /**
     * Push entry to history stack
     * @private
     */
    _pushHistoryEntry(entry, options = {}) {
        if (this.isRestoring && !options.force) return;

        if (this.activeTransaction && !options.force && !options.allowDuringTransaction) {
            this.activeTransaction.entries.push(this.cloneEntry(entry));
            return;
        }

        this.history.push(this.cloneEntry(entry));

        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }

        if (!options.preserveRedo) {
            this.redoStack = [];
        }

        this.updateButtons();
    }

    /**
     * Push entry to redo stack
     * @private
     */
    _pushRedoEntry(entry) {
        this.redoStack.push(this.cloneEntry(entry));

        if (this.redoStack.length > this.maxHistorySize) {
            this.redoStack.shift();
        }

        this.updateButtons();
    }

    /**
     * Record pending key point change for the next curve action on this channel
     * @param {string} channelName - Channel name
     * @param {Array} oldKeyPoints - Old key points
     * @param {Array} newKeyPoints - New key points
     * @param {string} oldInterpolation - Old interpolation type
     * @param {string} newInterpolation - New interpolation type
     */
    recordKeyPointsChange(channelName, oldKeyPoints, newKeyPoints, oldInterpolation, newInterpolation) {
        try {
            this._pendingKeyPoints[channelName] = {
                oldKeyPoints: Array.isArray(oldKeyPoints) ? oldKeyPoints.map(p => ({ input: p.input, output: p.output })) : undefined,
                newKeyPoints: Array.isArray(newKeyPoints) ? newKeyPoints.map(p => ({ input: p.input, output: p.output })) : undefined,
                oldInterpolation,
                newInterpolation
            };
        } catch (e) {
            console.warn('recordKeyPointsChange failed:', e);
        }
    }

    /**
     * Record individual channel action
     * @param {string} channelName - Channel name
     * @param {string} actionType - Type of action ('enable', 'disable', 'percentage', 'end', 'curve')
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     * @param {Object} extras - Additional action data
     */
    recordChannelAction(channelName, actionType, oldValue, newValue, extras = null) {
        if (this.isRestoring) {
            return;
        }

        const action = {
            timestamp: Date.now(),
            type: actionType,
            channelName: channelName,
            oldValue: oldValue,
            newValue: newValue,
            description: `${actionType} ${channelName}: ${oldValue} → ${newValue}`
        };

        if (extras && typeof extras === 'object') {
            Object.assign(action, extras);
        }

        // Check for pending key points data
        if (this._pendingKeyPoints[channelName]) {
            Object.assign(action, this._pendingKeyPoints[channelName]);
            delete this._pendingKeyPoints[channelName];
        }

        // Create concise, user-friendly descriptions
        if (actionType === 'curve') {
            const kpCount = Array.isArray(action.newKeyPoints) ? action.newKeyPoints.length : undefined;
            const interp = action.newInterpolation || action.oldInterpolation || undefined;
            const parts = [`curve ${channelName}`];
            if (kpCount !== undefined) parts.push(`(${kpCount} key points${interp ? `, ${interp}` : ''})`);
            else if (Array.isArray(newValue)) parts.push(`(${newValue.length} pts)`);
            action.description = parts.join(' ');
        } else {
            // Avoid dumping large arrays/objects in tooltip for other actions
            const summarize = (v) => {
                if (Array.isArray(v)) return `${v.length} items`;
                if (v && typeof v === 'object') return 'updated';
                return String(v);
            };
            action.description = `${actionType} ${channelName}: ${summarize(oldValue)} → ${summarize(newValue)}`;
        }

        this._pushHistoryEntry({ kind: 'channel', action });
    }

    /**
     * Record a UI-level action (non-channel)
     * @param {string} uiType - UI action type (e.g., 'editMode')
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     * @param {string} description - Human-friendly description
     */
    recordUIAction(uiType, oldValue, newValue, description) {
        if (this.isRestoring) return;

        const action = {
            timestamp: Date.now(),
            type: 'ui',
            uiType,
            oldValue,
            newValue,
            description: description || `${uiType}: ${String(oldValue)} → ${String(newValue)}`
        };

        this._pushHistoryEntry({ kind: 'ui', action });
    }

    /**
     * Record batch action (multiple channels affected by single command)
     * @param {string} description - Batch action description
     * @param {Array} channelActions - Array of individual channel actions
     */
    recordBatchAction(description, channelActions) {
        if (this.isRestoring) {
            return;
        }

        const batchAction = {
            timestamp: Date.now(),
            type: 'batch',
            description: description,
            channelActions: channelActions
        };

        this._pushHistoryEntry({ kind: 'batch', action: batchAction });
    }

    /**
     * Record linearization action
     * @param {string} path - State path that changed
     * @param {any} oldValue - Previous value
     * @param {any} newValue - New value
     */
    recordLinearizationAction(path, oldValue, newValue) {
        if (this.isRestoring) return;

        const action = {
            timestamp: Date.now(),
            type: 'linearization',
            path,
            oldValue,
            newValue,
            description: `Linearization: ${path.split('.').pop()}`
        };

        this._pushHistoryEntry({ kind: 'linearization', action });
    }

    /**
     * Legacy method for non-channel actions (curve modifications, etc.)
     * @param {string} actionDescription - Description of the action
     */
    captureState(actionDescription = 'Curve modification') {
        if (this.isRestoring) {
            return;
        }

        // Get current state from state manager
        const currentState = this.stateManager.getState();

        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log(`[SNAPSHOT DEBUG] Capturing "${actionDescription}"`);
            console.log(`[SNAPSHOT DEBUG] printer.channelValues:`, currentState.printer?.channelValues);
            console.log(`[SNAPSHOT DEBUG] printer.channelStates:`, currentState.printer?.channelStates);
        }

        const currentLoaded = getLoadedQuadData();
        const loaded = currentLoaded ? JSON.parse(JSON.stringify(currentLoaded)) : null;
        if (!currentState.curves) {
            currentState.curves = {};
        }
        currentState.curves.loadedQuadData = loaded;

        const scalingSnapshot = (() => {
            try {
                if (typeof getLegacyScalingSnapshot === 'function') {
                    return getLegacyScalingSnapshot();
                }
            } catch (error) {
                console.warn('history-manager: getLegacyScalingSnapshot failed during snapshot capture', error);
            }

            try {
                const percent = typeof getCurrentScale === 'function' ? getCurrentScale() : null;
                return {
                    percent,
                    baselines: null,
                    maxAllowed: null,
                    statePercent: null,
                    stateBaselines: null,
                    stateMaxAllowed: null,
                    parity: {
                        status: 'legacy-only',
                        percentDelta: 0,
                        baselineDiffs: [],
                        maxAllowedDelta: 0
                    }
                };
            } catch (fallbackError) {
                console.warn('history-manager: getCurrentScale fallback failed during snapshot capture', fallbackError);
                return {
                    percent: null,
                    baselines: null,
                    maxAllowed: null,
                    statePercent: null,
                    stateBaselines: null,
                    stateMaxAllowed: null,
                    parity: {
                        status: 'legacy-only',
                        percentDelta: null,
                        baselineDiffs: [],
                        maxAllowedDelta: null
                    }
                };
            }
        })();

        const scalingStateSnapshot = (scalingSnapshot.statePercent != null
            || (scalingSnapshot.stateBaselines && Object.keys(scalingSnapshot.stateBaselines).length > 0)
            || scalingSnapshot.stateMaxAllowed != null)
            ? {
                percent: scalingSnapshot.statePercent,
                baselines: scalingSnapshot.stateBaselines,
                maxAllowed: scalingSnapshot.stateMaxAllowed
            }
            : null;

        const state = {
            version: HISTORY_SNAPSHOT_VERSION,
            timestamp: Date.now(),
            action: actionDescription,
            stateSnapshot: currentState,
            legacyScaling: {
                percent: scalingSnapshot.percent,
                baselines: scalingSnapshot.baselines,
                maxAllowed: scalingSnapshot.maxAllowed
            },
            scalingStateSnapshot,
            scalingParity: scalingSnapshot.parity
        };

        this._pushHistoryEntry({ kind: 'snapshot', state, action: actionDescription });
    }

    /**
     * Undo the last action
     * @returns {Object} Result object with success/failure and message
     */
    undo() {
        if (this.history.length === 0) {
            return { success: false, message: 'No actions to undo' };
        }

        try {
            this.isRestoring = true;
            const entry = this.history.pop();
            let message;

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('🔄 UNDO: Processing entry:', entry);
            }

            if (entry.kind === 'channel') {
                this.undoChannelAction(entry.action);
                message = `Undid: ${entry.action.description}`;
                this._pushRedoEntry({ kind: 'channel', action: entry.action });
            } else if (entry.kind === 'ui') {
                this.undoUIAction(entry.action);
                message = `Undid: ${entry.action.description}`;
                this._pushRedoEntry({ kind: 'ui', action: entry.action });
            } else if (entry.kind === 'batch') {
                this.undoBatchAction(entry.action);
                message = `Undid: ${entry.action.description}`;
                this._pushRedoEntry({ kind: 'batch', action: entry.action });
            } else if (entry.kind === 'linearization') {
                this.undoLinearizationAction(entry.action);
                message = `Undid: ${entry.action.description}`;
                this._pushRedoEntry({ kind: 'linearization', action: entry.action });
            } else if (entry.kind === 'transaction') {
                const tx = entry.action || {};
                const description = tx.description || 'Transaction';
                const childEntries = Array.isArray(tx.entries) ? tx.entries : [];
                for (let i = childEntries.length - 1; i >= 0; i -= 1) {
                    this.undoTransactionEntry(childEntries[i]);
                }
                message = `Undid: ${description}`;
                this._pushRedoEntry({ kind: 'transaction', action: this.cloneEntry(tx) });
            } else if (entry.kind === 'snapshot') {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[HistoryManager] Undo snapshot entry:', entry.action);
                }
                let targetState = entry.state;
                let redoPayload = { kind: 'snapshot', state: entry.state, action: entry.action };

                if (typeof entry.action === 'string' && entry.action.startsWith('After:')) {
                    const beforeLabel = entry.action.replace('After:', 'Before:');

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[HistoryManager] Checking for paired snapshot:', beforeLabel);
                    }

                    for (let i = this.history.length - 1; i >= 0; i--) {
                        const candidate = this.history[i];
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[HistoryManager] Candidate for pairing:', candidate.kind, candidate.action);
                        }
                        if (candidate.kind === 'snapshot' && candidate.action === beforeLabel) {
                            this.history.splice(i, 1);
                            targetState = candidate.state;
                            redoPayload = { kind: 'snapshot_pair', before: candidate, after: entry };
                            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                                console.log('[HistoryManager] Paired snapshot found');
                            }
                            break;
                        }
                    }
                }

                this.restoreSnapshot(targetState);
                message = `Undid: ${entry.action}`;
                this._pushRedoEntry(redoPayload);
            } else {
                return { success: false, message: 'Unknown action type' };
            }

            const result = { success: true, message };
            try {
                validateScalingStateSync({ reason: 'history:undo', throwOnMismatch: false });
            } catch (validationError) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('HistoryManager undo parity validation failed', validationError);
                }
            }
            return result;
        } catch (error) {
            console.error('Undo failed:', error);
            return { success: false, message: `Undo failed: ${error.message}` };
        } finally {
            this.isRestoring = false;
            this.updateButtons();
        }
    }

    /**
     * Redo the last undone action
     * @returns {Object} Result object with success/failure and message
     */
    redo() {
        if (this.redoStack.length === 0) {
            return { success: false, message: 'No actions to redo' };
        }

        try {
            this.isRestoring = true;
            const entry = this.redoStack.pop();
            let message;

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('🔄 REDO: Processing entry:', entry);
            }

            if (entry.kind === 'channel') {
                this.redoChannelAction(entry.action);
                message = `Redid: ${entry.action.description}`;
                this._pushHistoryEntry({ kind: 'channel', action: entry.action }, { preserveRedo: true, force: true });
            } else if (entry.kind === 'ui') {
                this.redoUIAction(entry.action);
                message = `Redid: ${entry.action.description}`;
                this._pushHistoryEntry({ kind: 'ui', action: entry.action }, { preserveRedo: true, force: true });
            } else if (entry.kind === 'batch') {
                this.redoBatchAction(entry.action);
                message = `Redid: ${entry.action.description}`;
                this._pushHistoryEntry({ kind: 'batch', action: entry.action }, { preserveRedo: true, force: true });
            } else if (entry.kind === 'linearization') {
                this.redoLinearizationAction(entry.action);
                message = `Redid: ${entry.action.description}`;
                this._pushHistoryEntry({ kind: 'linearization', action: entry.action }, { preserveRedo: true, force: true });
            } else if (entry.kind === 'transaction') {
                const tx = entry.action || {};
                const description = tx.description || 'Transaction';
                const childEntries = Array.isArray(tx.entries) ? tx.entries : [];
                for (const child of childEntries) {
                    this.redoTransactionEntry(child);
                }
                message = `Redid: ${description}`;
                this._pushHistoryEntry({ kind: 'transaction', action: this.cloneEntry(tx) }, { preserveRedo: true, force: true });
            } else if (entry.kind === 'snapshot') {
                this.restoreSnapshot(entry.state);
                message = `Redid: ${entry.action}`;
                this._pushHistoryEntry({ kind: 'snapshot', state: entry.state, action: entry.action }, { preserveRedo: true, force: true });
            } else if (entry.kind === 'snapshot_pair') {
                const beforeEntry = entry.before;
                const afterEntry = entry.after;

                if (beforeEntry) {
                    this.history.push(this.cloneEntry(beforeEntry));
                    if (this.history.length > this.maxHistorySize) {
                        this.history.shift();
                    }
                }

                if (afterEntry) {
                    this.history.push(this.cloneEntry(afterEntry));
                    if (this.history.length > this.maxHistorySize) {
                        this.history.shift();
                    }
                    this.restoreSnapshot(afterEntry.state);
                    message = `Redid: ${afterEntry.action}`;
                } else if (beforeEntry) {
                    this.restoreSnapshot(beforeEntry.state);
                    message = `Redid: ${beforeEntry.action}`;
                } else {
                    message = 'Redid snapshot';
                }
            } else {
                return { success: false, message: 'Unknown action type' };
            }

            const result = { success: true, message };
            try {
                validateScalingStateSync({ reason: 'history:redo', throwOnMismatch: false });
            } catch (validationError) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('HistoryManager redo parity validation failed', validationError);
                }
            }
            return result;
        } catch (error) {
            console.error('Redo failed:', error);
            return { success: false, message: `Redo failed: ${error.message}` };
        } finally {
            this.isRestoring = false;
            this.updateButtons();
        }
    }

    undoTransactionEntry(entry) {
        if (!entry) return;
        switch (entry.kind) {
            case 'channel':
                this.undoChannelAction(entry.action);
                break;
            case 'batch':
                this.undoBatchAction(entry.action);
                break;
            case 'ui':
                this.undoUIAction(entry.action);
                break;
            case 'linearization':
                this.undoLinearizationAction(entry.action);
                break;
            case 'snapshot':
                this.restoreSnapshot(entry.state);
                break;
            case 'snapshot_pair':
                if (entry.before) {
                    this.restoreSnapshot(entry.before.state);
                }
                break;
            default:
                console.warn('Unknown transaction entry kind during undo:', entry.kind);
        }
    }

    redoTransactionEntry(entry) {
        if (!entry) return;
        switch (entry.kind) {
            case 'channel':
                this.redoChannelAction(entry.action);
                break;
            case 'batch':
                this.redoBatchAction(entry.action);
                break;
            case 'ui':
                this.redoUIAction(entry.action);
                break;
            case 'linearization':
                this.redoLinearizationAction(entry.action);
                break;
            case 'snapshot':
                this.restoreSnapshot(entry.state);
                break;
            case 'snapshot_pair':
                if (entry.after) {
                    this.restoreSnapshot(entry.after.state);
                }
                break;
            default:
                console.warn('Unknown transaction entry kind during redo:', entry.kind);
        }
    }

    /**
     * Undo a channel action
     * @private
     */
    undoChannelAction(action) {
        const { channelName, type, oldValue } = action;

        switch (type) {
            case 'enabled':
                this.stateManager.setChannelEnabled(channelName, oldValue);
                break;
            case 'percentage':
            case 'value':
                this.stateManager.setChannelValue(channelName, 'percentage', oldValue);
                break;
            case 'endValue':
                this.stateManager.setChannelValue(channelName, 'endValue', oldValue);
                break;
            case 'curve': {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[HISTORY] undo curve', {
                        channelName,
                        hasOldPoints: Array.isArray(action.oldKeyPoints) ? action.oldKeyPoints.length : null,
                        hasNewPoints: Array.isArray(action.newKeyPoints) ? action.newKeyPoints.length : null
                    });
                }
                const hasOldPoints = Array.isArray(action.oldKeyPoints) && action.oldKeyPoints.length > 0;

                if (hasOldPoints) {
                    setSmartKeyPoints(channelName, action.oldKeyPoints, action.oldInterpolation || 'smooth', {
                        skipHistory: true,
                        skipMarkEdited: true,
                        allowWhenEditModeOff: true
                    });
                } else {
                    this.clearSmartCurve(channelName);

                    const data = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {} }));
                    data.curves = data.curves || {};
                    data.sources = data.sources || {};

                    if (Array.isArray(oldValue)) {
                        data.curves[channelName] = oldValue.slice();
                    } else if (data.curves[channelName]) {
                        delete data.curves[channelName];
                    }

                    if (action.oldSource === undefined || action.oldSource === null) {
                        delete data.sources[channelName];
                    } else {
                        data.sources[channelName] = action.oldSource;
                    }
                }

                this.stateManager.batch({
                    [`curves.keyPoints.${channelName}`]: hasOldPoints ? action.oldKeyPoints : null,
                    [`curves.keyPointsMeta.${channelName}.interpolationType`]: hasOldPoints ? (action.oldInterpolation || 'smooth') : null,
                    [`curves.sources.${channelName}`]: action.oldSource !== undefined ? action.oldSource : null
                }, { skipHistory: true });

                this.refreshCurveUI(channelName, action.selectedOrdinalBefore, action.selectedChannelBefore);

                break;
            }
        }
    }

    /**
     * Redo a channel action
     * @private
     */
    redoChannelAction(action) {
        const { channelName, type, newValue } = action;

        switch (type) {
            case 'enabled':
                this.stateManager.setChannelEnabled(channelName, newValue);
                break;
            case 'percentage':
            case 'value':
                this.stateManager.setChannelValue(channelName, 'percentage', newValue);
                break;
            case 'endValue':
                this.stateManager.setChannelValue(channelName, 'endValue', newValue);
                break;
            case 'curve': {
                const hasNewPoints = Array.isArray(action.newKeyPoints) && action.newKeyPoints.length > 0;

                if (hasNewPoints) {
                    setSmartKeyPoints(channelName, action.newKeyPoints, action.newInterpolation || 'smooth', {
                        skipHistory: true,
                        skipMarkEdited: true,
                        allowWhenEditModeOff: true
                    });
                } else {
                    this.clearSmartCurve(channelName);

                    const data = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {} }));
                    data.curves = data.curves || {};
                    data.sources = data.sources || {};

                    if (Array.isArray(newValue)) {
                        data.curves[channelName] = newValue.slice();
                    } else if (data.curves[channelName]) {
                        delete data.curves[channelName];
                    }

                    if (action.newSource === undefined || action.newSource === null) {
                        delete data.sources[channelName];
                    } else {
                        data.sources[channelName] = action.newSource;
                    }
                }

                this.stateManager.batch({
                    [`curves.keyPoints.${channelName}`]: hasNewPoints ? action.newKeyPoints : null,
                    [`curves.keyPointsMeta.${channelName}.interpolationType`]: hasNewPoints ? (action.newInterpolation || 'smooth') : null,
                    [`curves.sources.${channelName}`]: action.newSource !== undefined ? action.newSource : null
                }, { skipHistory: true });

                this.refreshCurveUI(channelName, action.selectedOrdinalAfter, action.selectedChannelAfter);

                break;
            }
        }
    }

    /**
     * Undo a UI action
     * @private
     */
    undoUIAction(action) {
        const { uiType, oldValue } = action;

        switch (uiType) {
            case 'editMode':
                this.stateManager.setEditMode(oldValue);
                break;
            case 'editSelection':
                this.updateEditSelection(oldValue?.channel ?? null, oldValue?.ordinal ?? 1);
                break;
            default:
                this.stateManager.set(`ui.${uiType}`, oldValue);
                break;
        }
    }

    /**
     * Redo a UI action
     * @private
     */
    redoUIAction(action) {
        const { uiType, newValue } = action;

        switch (uiType) {
            case 'editMode':
                this.stateManager.setEditMode(newValue);
                break;
            case 'editSelection':
                this.updateEditSelection(newValue?.channel ?? null, newValue?.ordinal ?? 1);
                break;
            default:
                this.stateManager.set(`ui.${uiType}`, newValue);
                break;
        }
    }

    /**
     * Undo a batch action
     * @private
     */
    undoBatchAction(action) {
        // Undo individual channel actions in reverse order
        for (let i = action.channelActions.length - 1; i >= 0; i--) {
            this.undoChannelAction(action.channelActions[i]);
        }
    }

    /**
     * Redo a batch action
     * @private
     */
    redoBatchAction(action) {
        // Redo individual channel actions in forward order
        for (const channelAction of action.channelActions) {
            this.redoChannelAction(channelAction);
        }
    }

    /**
     * Undo a linearization action
     * @private
     */
    undoLinearizationAction(action) {
        this.stateManager.set(action.path, action.oldValue, { skipHistory: true });
    }

    /**
     * Redo a linearization action
     * @private
     */
    redoLinearizationAction(action) {
        this.stateManager.set(action.path, action.newValue, { skipHistory: true });
    }

    /**
     * Restore a complete state snapshot
     * @private
     */
    restoreSnapshot(state) {
        const normalized = this.ensureSnapshotVersion(state);

        if (normalized && normalized.stateSnapshot) {
            const snapshotCopy = JSON.parse(JSON.stringify(normalized.stateSnapshot));
            this.stateManager.state = snapshotCopy;
            this.restoreDomFromSnapshot(snapshotCopy);

            if (elements.rows) {
                Array.from(elements.rows.children)
                    .filter((row) => row && row.id !== 'noChannelsRow')
                    .forEach((row) => {
                        const channelName = row.getAttribute('data-channel');
                        if (channelName) {
                            this.ensureChannelEnabledState(channelName);
                        }
                    });
            }

            this.applyLegacyScaling(normalized.legacyScaling);
        } else {
            this.restoreLegacySnapshot(normalized);
        }

        triggerInkChartUpdate();
    }

    /**
     * Restore legacy snapshot format
     * @private
     */
    restoreLegacySnapshot(state) {
        // Convert legacy snapshot to new state format
        if (state.loadedQuadData) {
            setLoadedQuadData(JSON.parse(JSON.stringify(state.loadedQuadData)));
        } else {
            setLoadedQuadData(null);
        }

        if (state.channels) {
            for (const [channelName, channelData] of Object.entries(state.channels)) {
                this.stateManager.batch({
                    [`printer.channelValues.${channelName}.percentage`]: channelData.percentage,
                    [`printer.channelValues.${channelName}.endValue`]: channelData.endValue,
                    [`printer.channelStates.${channelName}.enabled`]: channelData.enabled
                }, { skipHistory: true });
            }
        }

        if (state.globalLinearization) {
            this.stateManager.batch({
                'linearization.global.data': state.globalLinearization.data,
                'linearization.global.applied': state.globalLinearization.applied,
                'linearization.global.enabled': state.globalLinearization.enabled,
                'ui.filenames.globalLinearization': state.globalLinearization.filename
            }, { skipHistory: true });
        }

        if (state.perChannelLinearization) {
            this.stateManager.set('linearization.perChannel.data', state.perChannelLinearization, { skipHistory: true });
        }

        if (state.perChannelEnabled) {
            this.stateManager.set('linearization.perChannel.enabled', state.perChannelEnabled, { skipHistory: true });
        }
    }

    getSnapshotVersion(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return 1;
        }
        return Number.isFinite(snapshot.version) ? snapshot.version : 1;
    }

    ensureSnapshotVersion(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return snapshot;
        }

        const version = this.getSnapshotVersion(snapshot);
        if (version >= HISTORY_SNAPSHOT_VERSION) {
            return snapshot;
        }

        if (snapshot.stateSnapshot) {
            return {
                ...snapshot,
                version: HISTORY_SNAPSHOT_VERSION,
                legacyScaling: snapshot.legacyScaling ?? null
            };
        }

        return snapshot;
    }

    applyLegacyScaling(legacyScaling) {
        if (!legacyScaling || typeof legacyScaling.percent !== 'number') {
            return;
        }

        const applyScale = (() => {
            if (typeof globalScope.applyGlobalScale === 'function') {
                return globalScope.applyGlobalScale;
            }
            if (globalScope.__quadDebug?.scalingUtils?.applyGlobalScale) {
                return globalScope.__quadDebug.scalingUtils.applyGlobalScale;
            }
            return null;
        })();

        if (applyScale) {
            try {
                restoreLegacyScalingState(legacyScaling);
                applyScale(legacyScaling.percent, { priority: 'history-restore', metadata: { trigger: 'historyRestore' } });
            } catch (error) {
                console.warn('history-manager: failed to reapply legacy scaling percent', error);
            }
        }
    }

    /**
     * Restore DOM/UI elements based on a state snapshot
     * @private
     */
    restoreDomFromSnapshot(snapshot) {
        const loadedQuadData = snapshot.curves?.loadedQuadData;
        if (loadedQuadData) {
            setLoadedQuadData(JSON.parse(JSON.stringify(loadedQuadData)));
        } else {
            setLoadedQuadData(null);
        }

        const channelValues = snapshot.printer?.channelValues || {};
        const channelStates = snapshot.printer?.channelStates || {};
        const perChannelData = snapshot.linearization?.perChannel?.data || {};
        const perChannelEnabled = snapshot.linearization?.perChannel?.enabled || {};
        const uiFilenames = snapshot.ui?.filenames?.perChannelLinearization || {};

        if (elements.rows) {
            Array.from(elements.rows.children).forEach((row) => {
                if (!row || row.id === 'noChannelsRow') return;
                const channelName = row.getAttribute('data-channel');
                if (!channelName) return;

                if (!channelValues[channelName]) channelValues[channelName] = {};
                if (!channelStates[channelName]) channelStates[channelName] = {};
                const channelValue = channelValues[channelName];
                const channelState = channelStates[channelName];

                let percentValue = Number(channelValue.percentage ?? 0);
                if (!Number.isFinite(percentValue)) {
                    percentValue = 0;
                }

                const rawEndValue = channelValue.endValue;
                let resolvedEndValue;
                if (rawEndValue !== undefined && rawEndValue !== null) {
                    const numericEnd = Number(rawEndValue);
                    resolvedEndValue = Number.isFinite(numericEnd)
                        ? numericEnd
                        : InputValidator.computeEndFromPercent(percentValue);
                } else {
                    resolvedEndValue = InputValidator.computeEndFromPercent(percentValue);
                }

                const percentInput = row.querySelector('.percent-input');
                if (percentInput) {
                    percentInput.value = String(percentValue);
                    percentInput.setAttribute('data-base-percent', String(percentValue));
                    InputValidator.clearValidationStyling(percentInput);
                }

                const endInput = row.querySelector('.end-input');
                if (endInput) {
                    endInput.value = String(resolvedEndValue);
                    endInput.setAttribute('data-base-end', String(resolvedEndValue));
                    InputValidator.clearValidationStyling(endInput);
                }

                const enabledFlag = (channelState.enabled !== undefined)
                    ? !!channelState.enabled
                    : (resolvedEndValue > 0 || percentValue > 0);

                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log(`[UNDO DEBUG] Restoring ${channelName}:`, {
                        percentValue,
                        resolvedEndValue,
                        enabledFlag,
                        fromSnapshot: {
                            enabled: channelState.enabled,
                            percent: channelValue.percentage,
                            end: channelValue.endValue
                        }
                    });
                }

                channelValue.percentage = percentValue;
                channelValue.endValue = resolvedEndValue;
                channelState.enabled = enabledFlag;

                const checkbox = row._virtualCheckbox;
                if (checkbox) {
                    checkbox.checked = enabledFlag;
                }

                const perChannelToggle = row.querySelector('.per-channel-toggle');
                if (perChannelToggle) {
                    const hasMeasurement = !!perChannelData[channelName];
                    perChannelToggle.disabled = !hasMeasurement;
                    perChannelToggle.checked = hasMeasurement && (perChannelEnabled[channelName] !== false);
                }

                const perChannelBtn = row.querySelector('.per-channel-btn');
                if (perChannelBtn) {
                    const filename = uiFilenames[channelName];
                    if (filename) {
                        perChannelBtn.setAttribute('data-tooltip', `Loaded: ${filename}`);
                    } else {
                        perChannelBtn.setAttribute('data-tooltip', 'Load LUT.cube, LABdata.txt, or .acv curve files');
                    }
                }

                updateScaleBaselineForChannel(channelName);

                if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
                    try {
                        row.refreshDisplayFn();
                    } catch (err) {
                        console.warn('restoreDomFromSnapshot refreshDisplayFn failed:', err);
                    }
                }
            });
        }

        const editSelection = snapshot.app?.editSelection || {};
        const editChannel = editSelection.channel ?? null;
        const editOrdinal = Number.isFinite(editSelection.ordinal) ? editSelection.ordinal : 1;

        if (typeof snapshot.app?.editMode === 'boolean') {
            try {
                setEditModeFlag(!!snapshot.app.editMode);
            } catch (err) {
                console.warn('restoreDomFromSnapshot edit mode flag sync failed:', err);
            }
        }

        if (isBrowser && globalScope.EDIT) {
            globalScope.EDIT.selectedChannel = editChannel;
            globalScope.EDIT.selectedOrdinal = editOrdinal;
        }

        if (elements.editChannelSelect) {
            try {
                const select = elements.editChannelSelect;
                if (editChannel && Array.from(select.options).some(opt => opt.value === editChannel)) {
                    select.value = editChannel;
                } else if (!editChannel) {
                    select.value = '';
                }
            } catch (err) {
                console.warn('restoreDomFromSnapshot edit dropdown sync failed:', err);
            }
        }

        if (LinearizationState) {
            const globalLin = snapshot.linearization?.global || {};
            LinearizationState.globalData = globalLin.data || null;
            LinearizationState.globalApplied = !!globalLin.applied;
            LinearizationState.globalBakedMeta = globalLin.baked || null;

            const perData = snapshot.linearization?.perChannel?.data || {};
            const perEnabled = snapshot.linearization?.perChannel?.enabled || {};

            LinearizationState.perChannelData = JSON.parse(JSON.stringify(perData));
            LinearizationState.perChannelEnabled = { ...perEnabled };

            const bakedMeta = globalLin.baked || null;
            try {
                if (this.stateManager) {
                    this.stateManager.set('linearization.global.baked', bakedMeta, { skipHistory: true });
                }
            } catch (err) {
                console.warn('HistoryManager: failed to restore baked meta in state manager:', err);
            }

            if (isBrowser && typeof globalScope.__quadSetGlobalBakedState === 'function') {
                try {
                    globalScope.__quadSetGlobalBakedState(bakedMeta, { skipHistory: true });
                } catch (err) {
                    console.warn('HistoryManager: failed to apply baked UI state during restore:', err);
                }
            }

            const perFilenames = snapshot.ui?.filenames?.perChannelLinearization || {};
            updateAppState({
                perChannelLinearization: JSON.parse(JSON.stringify(perData)),
                perChannelEnabled: { ...perEnabled },
                perChannelFilenames: { ...perFilenames }
            });

            if (isBrowser) {
                globalScope.perChannelLinearization = JSON.parse(JSON.stringify(perData));
                globalScope.perChannelEnabled = { ...perEnabled };
                globalScope.perChannelFilenames = { ...perFilenames };

                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[RESTORE DEBUG] Synced per-channel maps:', {
                        dataChannels: Object.keys(perData),
                        enabledChannels: Object.keys(perEnabled).filter(ch => perEnabled[ch])
                    });
                }
            }
        }

        const globalLinearization = snapshot.linearization?.global || {};
        const globalFilename = snapshot.ui?.filenames?.globalLinearization || '';
        const hasGlobalData = !!globalLinearization.data;
        const globalEnabled = !!globalLinearization.enabled;
        const displayName = globalFilename || globalLinearization.filename || '';

        if (elements.globalLinearizationToggle) {
            elements.globalLinearizationToggle.disabled = !hasGlobalData;
            elements.globalLinearizationToggle.checked = hasGlobalData && globalEnabled;
        }

        if (elements.globalLinearizationFilename) {
            elements.globalLinearizationFilename.textContent = displayName;
        }

        if (elements.globalLinearizationDetails) {
            if (hasGlobalData && Array.isArray(globalLinearization.data?.samples)) {
                const sampleCount = globalLinearization.data.samples.length;
                elements.globalLinearizationDetails.textContent = sampleCount ? ` - ${sampleCount} samples` : '';
            } else {
                elements.globalLinearizationDetails.textContent = '';
            }
        }

        if (elements.globalLinearizationInfo) {
            if (hasGlobalData) elements.globalLinearizationInfo.classList.remove('hidden');
            else elements.globalLinearizationInfo.classList.add('hidden');
        }

        if (elements.globalLinearizationHint) {
            if (hasGlobalData) elements.globalLinearizationHint.classList.add('hidden');
            else elements.globalLinearizationHint.classList.remove('hidden');
        }

        try {
            triggerRevertButtonsUpdate();
            triggerPreviewUpdate();
            triggerInkChartUpdate();
            if (isBrowser && typeof globalScope.refreshEditState === 'function') {
                globalScope.refreshEditState();
            }
        } catch (err) {
            console.warn('restoreDomFromSnapshot global refresh failed:', err);
        }
    }

    /**
     * Update undo/redo button states
     * @private
     */
    updateButtons() {
        this.updateUndoButton();
        this.updateRedoButton();
    }

    /**
     * Update undo button state
     * @private
     */
    updateUndoButton() {
        const undoBtn = elements.undoBtn || document.getElementById('undoBtn');
        if (undoBtn) {
            const canUndo = this.history.length > 0;
            undoBtn.disabled = !canUndo;

            if (canUndo && this.history.length > 0) {
                const lastEntry = this.history[this.history.length - 1];
                const tooltip = lastEntry.action?.description || lastEntry.action || 'Undo last action';
                undoBtn.title = `Undo: ${tooltip}`;
            } else {
                undoBtn.title = 'Nothing to undo';
            }
        }
    }

    /**
     * Update redo button state
     * @private
     */
    updateRedoButton() {
        const redoBtn = elements.redoBtn || document.getElementById('redoBtn');
        if (redoBtn) {
            const canRedo = this.redoStack.length > 0;
            redoBtn.disabled = !canRedo;

            if (canRedo && this.redoStack.length > 0) {
                const lastEntry = this.redoStack[this.redoStack.length - 1];
                const tooltip = lastEntry.action?.description || lastEntry.action || 'Redo last action';
                redoBtn.title = `Redo: ${tooltip}`;
            } else {
                redoBtn.title = 'Nothing to redo';
            }
        }
    }

    refreshCurveUI(channelName, targetOrdinal, targetChannel) {
        if (!isBrowser) {
            return;
        }

        try {
            this.updateEditSelection(channelName, targetOrdinal, targetChannel);
            this.ensureChannelEnabledState(channelName);
            if (targetChannel && targetChannel !== channelName) {
                this.ensureChannelEnabledState(targetChannel);
            }

            triggerProcessingDetail(channelName);
        } catch (err) {
            console.warn('refreshCurveUI updateProcessingDetail failed:', err);
        }

        try {
            triggerPreviewUpdate();
        } catch (err) {
            console.warn('refreshCurveUI updatePreview failed:', err);
        }

        try {
            triggerInkChartUpdate();
        } catch (err) {
            console.warn('refreshCurveUI updateInkChart failed:', err);
        }

        try {
            if (isBrowser && typeof globalScope.refreshEditState === 'function') {
                globalScope.refreshEditState();
            }
        } catch (err) {
            console.warn('refreshCurveUI refreshEditState failed:', err);
        }
    }

    ensureChannelEnabledState(channelName) {
        if (!elements.rows || !channelName) return;

        const row = Array.from(elements.rows.children).find((tr) => tr.getAttribute('data-channel') === channelName);
        if (!row) return;

        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');

        const percentValue = percentInput ? InputValidator.clampPercent(percentInput.value) : 0;
        let endValue = endInput ? InputValidator.clampEnd(endInput.value) : 0;

        if (percentValue > 0 && endValue === 0) {
            endValue = InputValidator.computeEndFromPercent(percentValue);
            if (endInput) {
                endInput.value = String(endValue);
            }

            try {
                this.stateManager.setChannelValue(channelName, 'endValue', endValue);
            } catch (err) {
                console.warn('Failed to sync fallback end value during undo:', err);
            }

        }

        const enabled = percentValue > 0 || endValue > 0;

        if (enabled) {
            row.removeAttribute('data-user-disabled');
        }

        const checkbox = row._virtualCheckbox;
        if (checkbox) {
            checkbox.checked = enabled;
        }

        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            try {
                row.refreshDisplayFn();
            } catch (err) {
                console.warn('ensureChannelEnabledState refresh failed:', err);
            }
        }
    }

    updateEditSelection(channelName, targetOrdinal, targetChannel) {
        if (!isBrowser || !globalScope.EDIT || typeof isEditModeEnabled !== 'function') {
            return;
        }

        if (!isEditModeEnabled()) {
            return;
        }

        if (targetChannel && globalScope.EDIT.selectedChannel !== targetChannel) {
            globalScope.EDIT.selectedChannel = targetChannel;
        }

        if (globalScope.EDIT.selectedChannel !== channelName && globalScope.EDIT.selectedChannel !== targetChannel) {
            globalScope.EDIT.selectedChannel = channelName;
        }

        const selectedChannel = globalScope.EDIT.selectedChannel;
        if (elements.editChannelSelect) {
            try {
                const select = elements.editChannelSelect;
                if (selectedChannel && Array.from(select.options).some(opt => opt.value === selectedChannel)) {
                    select.value = selectedChannel;
                }
            } catch (err) {
                console.warn('updateEditSelection dropdown sync failed:', err);
            }
        }

        const points = ControlPoints.get(channelName)?.points || [];
        const fallback = globalScope.EDIT.selectedOrdinal || 1;
        let ordinal = Number.isFinite(targetOrdinal) ? targetOrdinal : fallback;

        if (points.length > 0) {
            ordinal = Math.max(1, Math.min(ordinal, points.length));
        } else {
            ordinal = 1;
        }

        globalScope.EDIT.selectedOrdinal = ordinal;

        if (this.stateManager && typeof this.stateManager.setEditSelection === 'function') {
            try {
                this.stateManager.setEditSelection(selectedChannel, ordinal, { skipHistory: true });
            } catch (err) {
                console.warn('updateEditSelection state sync failed:', err);
            }
        }

        if (typeof globalScope.edit_refreshPointIndex === 'function') {
            try {
                globalScope.edit_refreshPointIndex();
            } catch (err) {
                console.warn('updateEditSelection edit_refreshPointIndex failed:', err);
            }
        }

        if (typeof globalScope.refreshEditState === 'function') {
            try {
                globalScope.refreshEditState();
            } catch (err) {
                console.warn('updateEditSelection refreshEditState failed:', err);
            }
        }

        try {
            triggerInkChartUpdate();
        } catch (err) {
            console.warn('updateEditSelection updateInkChart failed:', err);
        }

        if (selectedChannel) {
            try {
                triggerProcessingDetail(selectedChannel);
            } catch (err) {
                console.warn('updateEditSelection updateProcessingDetail failed:', err);
            }
        }
    }

    clearSmartCurve(channelName) {
        const data = getLoadedQuadData();
        if (!data) {
            return;
        }
        if (data.keyPoints && data.keyPoints[channelName]) {
            delete data.keyPoints[channelName];
        }
        if (data.keyPointsMeta && data.keyPointsMeta[channelName]) {
            delete data.keyPointsMeta[channelName];
        }
        if (data.sources && data.sources[channelName]) {
            delete data.sources[channelName];
        }
    }

    /**
     * Clear all history
     */
    clear() {
        this.history = [];
        this.redoStack = [];
        this._pendingKeyPoints = {};
        this._clearActiveTransaction();
        this.updateButtons();
    }

    _clearActiveTransaction() {
        if (this._transactionWarnTimer) {
            clearTimeout(this._transactionWarnTimer);
            this._transactionWarnTimer = null;
        }
        this.activeTransaction = null;
    }

    /**
     * Begin a buffered history transaction.
     * Subsequent history entries are captured but not flushed until commit.
     * @param {string} description - Human-readable description for the history entry.
     * @returns {string} Transaction identifier.
     */
    beginTransaction(description = 'History transaction') {
        if (this.activeTransaction) {
            throw new Error('History transaction already active');
        }

        const id = `tx_${Date.now()}_${++this._transactionIdCounter}`;
        this.activeTransaction = {
            id,
            description,
            startedAt: Date.now(),
            snapshot: this.captureSnapshotState(),
            entries: []
        };

        this._transactionWarnTimer = setTimeout(() => {
            console.warn(`History transaction "${description}" (${id}) has not been committed after 5s`);
        }, 5000);

        return id;
    }

    /**
     * Commit the active transaction and flush buffered entries as a single history item.
     * @param {string} transactionId - Transaction identifier returned by beginTransaction.
     * @returns {{ success: boolean, message: string }} Commit result metadata.
     */
    commit(transactionId) {
        if (!this.activeTransaction) {
            throw new Error('No active history transaction to commit');
        }
        if (this.activeTransaction.id !== transactionId) {
            throw new Error('Mismatched history transaction id');
        }

        const tx = this.activeTransaction;
        this._clearActiveTransaction();

        if (!Array.isArray(tx.entries) || tx.entries.length === 0) {
            return { success: true, message: 'Transaction committed (no changes)' };
        }

        const action = {
            timestamp: Date.now(),
            type: 'transaction',
            description: tx.description,
            entries: tx.entries.map(entry => this.cloneEntry(entry))
        };

        this._pushHistoryEntry({ kind: 'transaction', action }, { force: true });
        return { success: true, message: tx.description || 'Transaction committed' };
    }

    /**
     * Roll back the active transaction and restore the pre-transaction snapshot.
     * @param {string} transactionId - Transaction identifier returned by beginTransaction.
     * @returns {{ success: boolean, message: string }} Rollback status metadata.
     */
    rollback(transactionId) {
        if (!this.activeTransaction) {
            throw new Error('No active history transaction to rollback');
        }
        if (this.activeTransaction.id !== transactionId) {
            throw new Error('Mismatched history transaction id');
        }

        const tx = this.activeTransaction;
        this._clearActiveTransaction();

        if (tx.snapshot) {
            try {
                this.isRestoring = true;
                this.restoreSnapshot(tx.snapshot);
            } finally {
                this.isRestoring = false;
            }
        }

        return { success: true, message: tx.description ? `Rolled back: ${tx.description}` : 'Transaction rolled back' };
    }

    /**
     * Capture the current application state for transaction rollback.
     * @returns {{ stateSnapshot: object } | null} Cloned snapshot of the state manager.
     */
    captureSnapshotState() {
        try {
            const currentState = this.stateManager.getState();
            const snapshot = JSON.parse(JSON.stringify(currentState));
            const currentLoaded = getLoadedQuadData();
            if (!snapshot.curves) {
                snapshot.curves = {};
            }
            snapshot.curves.loadedQuadData = currentLoaded ? JSON.parse(JSON.stringify(currentLoaded)) : null;
            return { stateSnapshot: snapshot };
        } catch (err) {
            console.warn('Failed to capture history transaction snapshot:', err);
            return null;
        }
    }

    /**
     * Get current history info for debugging
     * @returns {Object} History debug information
     */
    getDebugInfo() {
        return {
            historyLength: this.history.length,
            redoLength: this.redoStack.length,
            isRestoring: this.isRestoring,
            pendingKeyPoints: Object.keys(this._pendingKeyPoints),
            transactionActive: !!this.activeTransaction,
            transactionDescription: this.activeTransaction?.description || null,
            recentActions: this.history.slice(-5).map(entry => ({
                kind: entry.kind,
                description: entry.action?.description || entry.action
            }))
        };
    }
}

/**
 * Global history manager instance
 */
let globalHistoryManager = null;

/**
 * Get or create the global history manager
 * @returns {HistoryManager} Global history manager instance
 */
export function getHistoryManager() {
    if (!globalHistoryManager) {
        const stateManager = getStateManager();
        globalHistoryManager = new HistoryManager(stateManager);
    }
    return globalHistoryManager;
}

/**
 * Convenience functions for common history operations
 */

export function recordChannelAction(channelName, actionType, oldValue, newValue, extras = null) {
    return getHistoryManager().recordChannelAction(channelName, actionType, oldValue, newValue, extras);
}

export function recordUIAction(uiType, oldValue, newValue, description) {
    return getHistoryManager().recordUIAction(uiType, oldValue, newValue, description);
}

export function recordBatchAction(description, channelActions) {
    return getHistoryManager().recordBatchAction(description, channelActions);
}

export function captureState(actionDescription = 'Curve modification') {
    return getHistoryManager().captureState(actionDescription);
}

export function beginHistoryTransaction(description) {
    return getHistoryManager().beginTransaction(description);
}

export function commitHistoryTransaction(transactionId) {
    return getHistoryManager().commit(transactionId);
}

export function rollbackHistoryTransaction(transactionId) {
    return getHistoryManager().rollback(transactionId);
}

export function undo() {
    return getHistoryManager().undo();
}

export function redo() {
    return getHistoryManager().redo();
}

export function clearHistory() {
    return getHistoryManager().clear();
}

/**
 * Export for global access during transition
 */
if (isBrowser) {
    globalScope.HistoryManager = HistoryManager;
    globalScope.getHistoryManager = getHistoryManager;
    globalScope.recordChannelAction = recordChannelAction;
    globalScope.recordUIAction = recordUIAction;
    globalScope.recordBatchAction = recordBatchAction;
    globalScope.captureState = captureState;
    globalScope.beginHistoryTransaction = beginHistoryTransaction;
    globalScope.commitHistoryTransaction = commitHistoryTransaction;
    globalScope.rollbackHistoryTransaction = rollbackHistoryTransaction;
    globalScope.undo = undo;
    globalScope.redo = redo;
    globalScope.clearHistory = clearHistory;

    // Legacy CurveHistory compatibility
    globalScope.CurveHistory = {
        recordChannelAction,
        recordUIAction,
        recordBatchAction,
        captureState,
        undo,
        redo,
        clear: clearHistory,
        beginTransaction: beginHistoryTransaction,
        commitTransaction: commitHistoryTransaction,
        rollbackTransaction: rollbackHistoryTransaction,
        updateUndoButton: () => getHistoryManager().updateUndoButton(),
        updateRedoButton: () => getHistoryManager().updateRedoButton()
    };
}
