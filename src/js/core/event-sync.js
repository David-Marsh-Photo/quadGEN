// Event-Driven State Synchronization System
// Coordinates updates between modular components and legacy global state

import { subscribeAutoLimitState } from './auto-limit-state.js';
import {
    triggerInkChartUpdate,
    triggerProcessingDetailAll,
    triggerProcessingDetail,
    triggerSessionStatusUpdate,
    triggerPreviewUpdate
} from '../ui/ui-hooks.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * Central event emitter for coordinating state changes across the application
 */
class StateEventEmitter {
    constructor() {
        this.listeners = new Map();
        this.isInitialized = false;
        this.cleanupCallbacks = [];
    }

    /**
     * Subscribe to a state event
     * @param {string} event - Event name
     * @param {function} callback - Event handler
     * @returns {function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // Return unsubscribe function
        return () => {
            const eventListeners = this.listeners.get(event);
            if (eventListeners) {
                eventListeners.delete(callback);
                if (eventListeners.size === 0) {
                    this.listeners.delete(event);
                }
            }
        };
    }

    /**
     * Emit an event to all subscribers
     * @param {string} event - Event name
     * @param {...any} args - Event arguments
     */
    emit(event, ...args) {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.warn(`Error in state event handler for '${event}':`, error);
                }
            });
        }
    }

    /**
     * Remove all listeners for an event
     * @param {string} event - Event name
     */
    removeAllListeners(event) {
        this.listeners.delete(event);
    }

    /**
     * Clear all event listeners
     */
    clear() {
        this.cleanupCallbacks.forEach((fn) => {
            try { fn(); } catch (err) { console.warn('Error during state watcher cleanup', err); }
        });
        this.cleanupCallbacks = [];
        this.listeners.clear();
    }

    /**
     * Initialize the synchronization system
     */
    initialize() {
        if (this.isInitialized) return;

        this.setupStateWatchers();
        this.setupDOMEventListeners();
        this.isInitialized = true;

        console.log('🔄 State synchronization system initialized');
    }

    /**
     * Set up watchers for critical global state variables
     * @private
     */
    setupStateWatchers() {
        // Watch for loadedQuadData changes
        this.watchGlobalProperty('loadedQuadData', (newValue, oldValue) => {
            this.emit('quadDataChanged', newValue, oldValue);
        });

        // Watch for linearizationApplied changes
        this.watchGlobalProperty('linearizationApplied', (newValue, oldValue) => {
            this.emit('linearizationStateChanged', newValue, oldValue);
        });

        // Watch for linearizationData changes
        this.watchGlobalProperty('linearizationData', (newValue, oldValue) => {
            this.emit('linearizationDataChanged', newValue, oldValue);
        });

        // Watch for keyPointsState changes
        this.watchGlobalProperty('keyPointsState', (newValue, oldValue) => {
            this.emit('keyPointsChanged', newValue, oldValue);
        });

        // Auto limit state is managed via dedicated module
        const unsubscribeAutoLimit = subscribeAutoLimitState((newValue, oldValue) => {
            this.emit('autoLimitStateChanged', newValue, oldValue);
        });
        this.cleanupCallbacks.push(unsubscribeAutoLimit);
    }

    /**
     * Set up DOM event listeners for UI changes
     * @private
     */
    setupDOMEventListeners() {
        if (typeof document === 'undefined' || !document?.addEventListener) {
            return;
        }
        // Listen for input changes on percentage and end value inputs
        document.addEventListener('input', (event) => {
            if (event.target.matches('.percent-input, .end-input')) {
                const channelName = event.target.closest('[data-channel]')?.dataset.channel;
                if (channelName) {
                    this.emit('channelValueChanged', channelName, event.target);
                }
            }
        });

        // Listen for auto limit toggle changes
        document.addEventListener('change', (event) => {
            if (event.target.id === 'autoWhiteLimitToggle') {
                this.emit('autoWhiteLimitChanged', event.target.checked);
            } else if (event.target.id === 'autoBlackLimitToggle') {
                this.emit('autoBlackLimitChanged', event.target.checked);
            }
        });
    }

    /**
     * Watch a global property for changes using a Proxy
     * @param {string} propertyName - Name of the global property
     * @param {function} callback - Callback to call when property changes
     * @private
     */
    watchGlobalProperty(propertyName, callback) {
        const scope = globalScope;
        let currentValue = scope[propertyName];

        // Create a property descriptor that tracks changes
        Object.defineProperty(scope, propertyName, {
            get() {
                return currentValue;
            },
            set(newValue) {
                const oldValue = currentValue;
                currentValue = newValue;
                callback(newValue, oldValue);
            },
            configurable: true,
            enumerable: true
        });
    }
}

// Create singleton instance
export const stateEvents = new StateEventEmitter();

/**
 * Setup synchronized state management between modular and legacy systems
 */
export function setupStateSynchronization() {
    // Initialize the event system
    stateEvents.initialize();

    // Set up event handlers for key state changes
    setupQuadDataSync();
    setupLinearizationSync();
    setupKeyPointsSync();
    setupAutoLimitSync();
    setupChartSync();

    console.log('✅ State synchronization configured');
}

/**
 * Set up quad data synchronization
 * @private
 */
function setupQuadDataSync() {
    stateEvents.on('quadDataChanged', (newQuadData, oldQuadData) => {
        triggerInkChartUpdate();

        triggerSessionStatusUpdate();

        triggerProcessingDetailAll();

        console.log('📊 Quad data synchronized');
    });
}

/**
 * Set up linearization state synchronization
 * @private
 */
function setupLinearizationSync() {
    stateEvents.on('linearizationStateChanged', (newState, oldState) => {
        triggerInkChartUpdate();

        triggerProcessingDetailAll();

        console.log('📈 Linearization state synchronized');
    });

    stateEvents.on('linearizationDataChanged', (newData, oldData) => {
        triggerInkChartUpdate();

        triggerProcessingDetailAll();

        console.log('📈 Linearization data synchronized');
    });
}

/**
 * Set up key points synchronization
 * @private
 */
function setupKeyPointsSync() {
    stateEvents.on('keyPointsChanged', (newKeyPoints, oldKeyPoints) => {
        triggerInkChartUpdate();

        triggerProcessingDetailAll();

        console.log('🎯 Key points synchronized');
    });
}

/**
 * Set up auto limit synchronization
 * @private
 */
function setupAutoLimitSync() {
    stateEvents.on('autoLimitStateChanged', (newState, oldState) => {
        triggerInkChartUpdate();
    });

    stateEvents.on('autoWhiteLimitChanged', (enabled) => {
        triggerInkChartUpdate();
        console.log(`🎚️ Auto white limit ${enabled ? 'enabled' : 'disabled'}`);
    });

    stateEvents.on('autoBlackLimitChanged', (enabled) => {
        triggerInkChartUpdate();
        console.log(`🎚️ Auto black limit ${enabled ? 'enabled' : 'disabled'}`);
    });
}

/**
 * Set up chart synchronization
 * @private
 */
function setupChartSync() {
    stateEvents.on('channelValueChanged', (channelName, inputElement) => {
        // Debounced chart update to avoid excessive redraws
        if (globalScope._chartUpdateTimeout) {
            clearTimeout(globalScope._chartUpdateTimeout);
        }

        globalScope._chartUpdateTimeout = setTimeout(() => {
            triggerInkChartUpdate();

            triggerProcessingDetail();

            triggerPreviewUpdate();
        }, 100);
    });
}

/**
 * Trigger a state synchronization event manually
 * @param {string} event - Event name
 * @param {...any} args - Event arguments
 */
export function triggerStateSync(event, ...args) {
    stateEvents.emit(event, ...args);
}

/**
 * Subscribe to state synchronization events
 * @param {string} event - Event name
 * @param {function} callback - Event handler
 * @returns {function} Unsubscribe function
 */
export function onStateSync(event, callback) {
    return stateEvents.on(event, callback);
}

registerDebugNamespace('eventSync', {
    stateEvents,
    setupStateSynchronization,
    triggerStateSync,
    onStateSync
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['stateEvents', 'setupStateSynchronization', 'triggerStateSync', 'onStateSync']
});
