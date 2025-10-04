// quadGEN Centralized State Management
// Consolidates all application state into a single, manageable system
// Provides explicit state updates, debugging capabilities, and undo/redo foundation

import { PRINTERS, INK_COLORS, TOTAL } from './state.js';
import { DataSpace } from '../data/processing-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getLegacyStateBridge } from '../legacy/state-bridge.js';

const legacyBridge = getLegacyStateBridge();

/**
 * Central state object that consolidates all dynamic application data
 */
export class QuadGenStateManager {
    constructor() {
        this.state = this.createInitialState();
        this.listeners = new Map(); // Event listeners for state changes
        this.isRestoring = false; // Flag to prevent cascading updates during restoration

        // Debugging support
        this.enableDebugging = false;
        this.stateSnapshots = []; // For debugging state changes
        this.maxSnapshots = 10;
    }

    /**
     * Create the initial state structure
     * @returns {Object} Initial state object
     */
    createInitialState() {
        return {
            // Application-level state
            app: {
                version: '2.6.4',
                debugLogs: false,
                debugAI: false,
                chartZoomIndex: 9, // Default to 100% (index 9 in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
                editMode: false,
                editSelection: {
                    channel: null,
                    ordinal: 1
                },
                darkMode: true,
                logoAnimatedOnce: false
            },

            // Printer configuration
            printer: {
                currentModel: 'P700P900', // Default printer model
                channels: [...PRINTERS.P700P900.channels], // Active channels
                channelValues: {}, // Per-channel ink percentages and end values
                channelStates: {}, // Per-channel enabled/disabled states
                channelPreviousValues: {} // For undo restoration
            },

            // Curve and quad data
            curves: {
                loadedQuadData: null, // Complete data from loaded .quad files
                smartCurves: {}, // Per-channel smart curve data
                keyPoints: {}, // Per-channel key points
                keyPointsMeta: {}, // Per-channel key point metadata
                sources: {} // Per-channel source information
            },

            // Linearization system
            linearization: {
                global: {
                    data: null,
                    applied: false,
                    filename: '',
                    enabled: false,
                    baked: null
                },
                perChannel: {
                    data: {}, // Per-channel linearization data
                    enabled: {} // Per-channel enabled states
                }
            },

            // UI state
            ui: {
                activeTab: 'main',
                modalOpen: null,
                statusMessage: '',
                processingState: false,
                filenames: {
                    quadFile: '',
                    globalLinearization: '',
                    perChannelLinearization: {}
                }
            },

            // File operation state
            files: {
                loadedFiles: {},
                recentFiles: [],
                autoSaveEnabled: false,
                lastSaveTime: null
            }
        };
    }

    /**
     * Get the current state (read-only copy)
     * @returns {Object} Deep copy of current state
     */
    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    /**
     * Get a specific state path
     * @param {string} path - Dot-notation path (e.g., 'printer.currentModel')
     * @returns {any} Value at the specified path
     */
    get(path) {
        return this.getValueByPath(this.state, path);
    }

    /**
     * Set a specific state path
     * @param {string} path - Dot-notation path
     * @param {any} value - New value
     * @param {Object} options - Update options
     */
    set(path, value, options = {}) {
        if (this.isRestoring && !options.allowDuringRestore) {
            return; // Prevent cascading updates during restoration
        }

        const oldValue = this.get(path);
        this.setValueByPath(this.state, path, value);

        // Capture snapshot for debugging
        if (this.enableDebugging) {
            this.captureStateSnapshot(`SET ${path}`, { path, oldValue, newValue: value });
        }

        // Notify listeners
        this.notifyListeners(path, value, oldValue, options);

        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log(`[STATE] ${path}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
        }
    }

    /**
     * Update multiple state paths atomically
     * @param {Object} updates - Object with path-value pairs
     * @param {Object} options - Update options
     */
    batch(updates, options = {}) {
        const oldValues = {};

        // Capture old values
        for (const path in updates) {
            oldValues[path] = this.get(path);
        }

        // Apply all updates
        for (const path in updates) {
            this.setValueByPath(this.state, path, updates[path]);
        }

        // Capture snapshot for debugging
        if (this.enableDebugging) {
            this.captureStateSnapshot('BATCH UPDATE', { updates, oldValues });
        }

        // Notify listeners for each change
        for (const path in updates) {
            this.notifyListeners(path, updates[path], oldValues[path], options);
        }

        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[STATE] BATCH UPDATE:', Object.keys(updates));
        }
    }

    /**
     * Reset state to initial values
     * @param {Array<string>} paths - Specific paths to reset, or null for full reset
     */
    reset(paths = null) {
        const initialState = this.createInitialState();

        if (paths) {
            // Reset specific paths
            const updates = {};
            for (const path of paths) {
                updates[path] = this.getValueByPath(initialState, path);
            }
            this.batch(updates, { reason: 'reset' });
        } else {
            // Full reset
            this.state = initialState;
            this.notifyListeners('*', this.state, null, { reason: 'fullReset' });

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[STATE] Full reset to initial state');
            }
        }
    }

    /**
     * Subscribe to state changes
     * @param {string|Array<string>} paths - Path(s) to watch, or '*' for all changes
     * @param {Function} callback - Callback function (path, newValue, oldValue, options)
     * @returns {Function} Unsubscribe function
     */
    subscribe(paths, callback) {
        if (typeof paths === 'string') {
            paths = [paths];
        }

        const subscription = { paths, callback };
        const subscriptionId = Symbol('subscription');
        this.listeners.set(subscriptionId, subscription);

        // Return unsubscribe function
        return () => {
            this.listeners.delete(subscriptionId);
        };
    }

    /**
     * Helper method to get value by dot-notation path
     * @private
     */
    getValueByPath(obj, path) {
        if (path === '*') return obj;

        const keys = path.split('.');
        let current = obj;

        for (const key of keys) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[key];
        }

        return current;
    }

    /**
     * Helper method to set value by dot-notation path
     * @private
     */
    setValueByPath(obj, path, value) {
        const keys = path.split('.');
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (current[key] === null || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        current[keys[keys.length - 1]] = value;
    }

    /**
     * Notify all relevant listeners
     * @private
     */
    notifyListeners(path, newValue, oldValue, options) {
        for (const [id, subscription] of this.listeners) {
            const { paths, callback } = subscription;

            // Check if this listener should be notified
            const shouldNotify = paths.includes('*') ||
                                paths.some(watchPath => path.startsWith(watchPath) || watchPath.startsWith(path));

            if (shouldNotify) {
                try {
                    callback(path, newValue, oldValue, options);
                } catch (error) {
                    console.error('State listener error:', error);
                }
            }
        }
    }

    /**
     * Capture state snapshot for debugging
     * @private
     */
    captureStateSnapshot(action, details) {
        if (!this.enableDebugging) return;

        const snapshot = {
            timestamp: Date.now(),
            action,
            details,
            state: JSON.parse(JSON.stringify(this.state))
        };

        this.stateSnapshots.push(snapshot);

        if (this.stateSnapshots.length > this.maxSnapshots) {
            this.stateSnapshots.shift();
        }
    }

    /**
     * Enable or disable debugging
     * @param {boolean} enabled - Whether to enable debugging
     */
    setDebugging(enabled) {
        this.enableDebugging = enabled;
        if (enabled) {
            console.log('[STATE] Debugging enabled - state changes will be captured');
        }
    }

    /**
     * Get debug information
     * @returns {Object} Debug information including snapshots
     */
    getDebugInfo() {
        return {
            currentState: this.getState(),
            snapshots: [...this.stateSnapshots],
            listenerCount: this.listeners.size
        };
    }

    /**
     * Convenience methods for common operations
     */

    // Printer operations
    getCurrentPrinter() {
        const model = this.get('printer.currentModel');
        return PRINTERS[model] || PRINTERS.P700P900;
    }

    setPrinter(model) {
        if (!PRINTERS[model]) {
            throw new Error(`Unknown printer model: ${model}`);
        }

        this.batch({
            'printer.currentModel': model,
            'printer.channels': [...PRINTERS[model].channels]
        });
    }

    // Channel operations
    getChannelValue(channelName, field) {
        return this.get(`printer.channelValues.${channelName}.${field}`);
    }

    setChannelValue(channelName, field, value) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log(`[STATE DEBUG] setChannelValue(${channelName}, ${field}, ${value})`);
        }
        this.set(`printer.channelValues.${channelName}.${field}`, value);
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            const check = this.get(`printer.channelValues.${channelName}.${field}`);
            console.log(`[STATE DEBUG] Verify: get returned ${check}`);
        }
    }

    isChannelEnabled(channelName) {
        return this.get(`printer.channelStates.${channelName}.enabled`) || false;
    }

    setChannelEnabled(channelName, enabled) {
        this.set(`printer.channelStates.${channelName}.enabled`, enabled);
    }

    // Linearization operations
    getGlobalLinearization() {
        return this.get('linearization.global');
    }

    setGlobalLinearization(data, applied = true) {
        this.batch({
            'linearization.global.data': data,
            'linearization.global.applied': applied
        });
    }

    getPerChannelLinearization(channelName) {
        return this.get(`linearization.perChannel.data.${channelName}`);
    }

    setPerChannelLinearization(channelName, data, enabled = true) {
        this.batch({
            [`linearization.perChannel.data.${channelName}`]: data,
            [`linearization.perChannel.enabled.${channelName}`]: enabled
        });
    }

    // Curve operations
    getLoadedQuadData() {
        return this.get('curves.loadedQuadData');
    }

    setLoadedQuadData(data) {
        this.set('curves.loadedQuadData', data);
    }

    getSmartCurve(channelName) {
        return this.get(`curves.smartCurves.${channelName}`);
    }

    setSmartCurve(channelName, curveData) {
        this.set(`curves.smartCurves.${channelName}`, curveData);
    }

    // UI operations
    setEditMode(enabled) {
        this.set('app.editMode', enabled);
    }

    isEditMode() {
        return this.get('app.editMode') || false;
    }

    setEditSelection(channel, ordinal = 1, options = {}) {
        const nextChannel = channel ?? null;
        const nextOrdinal = Number.isFinite(ordinal) ? ordinal : 1;

        const allowHistory = options.skipHistory !== true;
        const description = typeof options.description === 'string'
            ? options.description
            : nextChannel
                ? `Select channel ${nextChannel} (point ${nextOrdinal})`
                : 'Clear edit selection';

        this.batch({
            'app.editSelection.channel': nextChannel,
            'app.editSelection.ordinal': nextOrdinal,
            'app.editSelection.__meta': allowHistory ? { description } : null
        }, options);
    }

    getEditSelection() {
        const selection = this.get('app.editSelection') || {};
        const channel = selection.channel ?? null;
        const ordinal = Number.isFinite(selection.ordinal) ? selection.ordinal : 1;
        return { channel, ordinal };
    }

    setStatus(message) {
        this.set('ui.statusMessage', message);
    }

    getStatus() {
        return this.get('ui.statusMessage') || '';
    }
}

/**
 * Global state manager instance
 */
let globalStateManager = null;

/**
 * Get or create the global state manager
 * @returns {QuadGenStateManager} Global state manager instance
 */
export function getStateManager() {
    if (!globalStateManager) {
        globalStateManager = new QuadGenStateManager();
    }
    return globalStateManager;
}

/**
 * Convenience function to get current state
 * @returns {Object} Current application state
 */
export function getAppState() {
    return getStateManager().getState();
}

/**
 * Convenience function to get a state value
 * @param {string} path - Dot-notation path
 * @returns {any} Value at path
 */
export function getState(path) {
    return getStateManager().get(path);
}

/**
 * Convenience function to set a state value
 * @param {string} path - Dot-notation path
 * @param {any} value - New value
 * @param {Object} options - Update options
 */
export function setState(path, value, options = {}) {
    return getStateManager().set(path, value, options);
}

/**
 * Convenience function to batch update state
 * @param {Object} updates - Object with path-value pairs
 * @param {Object} options - Update options
 */
export function batchUpdateState(updates, options = {}) {
    return getStateManager().batch(updates, options);
}

/**
 * Convenience function to subscribe to state changes
 * @param {string|Array<string>} paths - Path(s) to watch
 * @param {Function} callback - Callback function
 * @returns {Function} Unsubscribe function
 */
export function subscribeToState(paths, callback) {
    return getStateManager().subscribe(paths, callback);
}

legacyBridge.registerHelpers({
    QuadGenStateManager,
    getStateManager,
    getAppState,
    getState,
    setState,
    batchUpdateState,
    subscribeToState
});

registerDebugNamespace('stateManager', {
    getStateManager,
    getAppState,
    getState,
    setState,
    batchUpdateState,
    subscribeToState
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['getStateManager', 'getAppState', 'getState', 'setState', 'batchUpdateState', 'subscribeToState']
});
