// Channel Builder State Management
// Tracks calibration sessions, reference K, added channels, and computed results.
// Persists across page reloads via localStorage.

import { generateLinearRamp } from './channel-builder.js';

const STORAGE_KEY = 'quadgen.channelBuilder.session';

/**
 * Channel builder session state
 */
let session = {
    // Reference K channel data
    referenceK: null,
    // { name: 'K', inkLimit: number, measurements: [{input, lstar}], dMax: number,
    //   curve: number[], L_paper: number }

    // Added secondary channels
    secondaryChannels: [],
    // [{ name: string, inkLimit: number, measurements: [{input, lstar}],
    //    computed: { dMax, apex, widthFactor, end, role, curve } }]

    // Computed K reduction
    kReduction: null,
    // { curve: number[], startIndex: number, midtonePeakPercent: number }

    // Session metadata
    createdAt: null,
    modifiedAt: null,

    // Wizard state
    currentStep: 0,  // 0: Reference K, 1: Add Channel, 2: Preview, 3: Apply

    // Options
    options: {
        useLstarMatching: false,
        bracketMargin: 0.13,
        thresholdFraction: 0.5,
        transitionWidth: 20,
        entryMode: 'paste',        // 'paste' | 'manual'
        manualRowCount: 7          // Default rows for manual entry
    }
};

// Listeners for state changes
const listeners = new Set();

/**
 * Deep clone helper
 */
function deepClone(value) {
    if (!value) return value;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (err) {
            // Fallback
        }
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (err) {
        return Array.isArray(value) ? value.slice() : { ...value };
    }
}

/**
 * Notify all listeners of state change
 */
function notifyListeners() {
    const snapshot = getSession();
    listeners.forEach(callback => {
        try {
            callback(snapshot);
        } catch (error) {
            console.warn('[ChannelBuilder] Listener error:', error);
        }
    });
}

/**
 * Persist session to localStorage
 */
function persistSession() {
    try {
        if (typeof localStorage !== 'undefined') {
            const serialized = JSON.stringify({
                ...session,
                modifiedAt: Date.now()
            });
            localStorage.setItem(STORAGE_KEY, serialized);
        }
    } catch (error) {
        console.warn('[ChannelBuilder] Failed to persist session:', error);
    }
}

/**
 * Load session from localStorage
 */
function loadPersistedSession() {
    try {
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Validate basic structure
                if (parsed && typeof parsed === 'object') {
                    session = {
                        referenceK: parsed.referenceK || null,
                        secondaryChannels: Array.isArray(parsed.secondaryChannels)
                            ? parsed.secondaryChannels : [],
                        kReduction: parsed.kReduction || null,
                        createdAt: parsed.createdAt || null,
                        modifiedAt: parsed.modifiedAt || null,
                        currentStep: typeof parsed.currentStep === 'number'
                            ? parsed.currentStep : 0,
                        options: {
                            useLstarMatching: parsed.options?.useLstarMatching || false,
                            bracketMargin: parsed.options?.bracketMargin ?? 0.13,
                            thresholdFraction: parsed.options?.thresholdFraction ?? 0.5,
                            transitionWidth: parsed.options?.transitionWidth ?? 20,
                            entryMode: parsed.options?.entryMode || 'paste',
                            manualRowCount: parsed.options?.manualRowCount ?? 7
                        }
                    };
                    return true;
                }
            }
        }
    } catch (error) {
        console.warn('[ChannelBuilder] Failed to load persisted session:', error);
    }
    return false;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize channel builder state (call on app start)
 */
export function initializeChannelBuilderState() {
    const loaded = loadPersistedSession();
    if (!loaded) {
        clearSession();
    }
}

/**
 * Get current session (deep copy for safety)
 * @returns {Object} Session state
 */
export function getSession() {
    return deepClone(session);
}

/**
 * Check if a session is active
 * @returns {boolean}
 */
export function hasActiveSession() {
    return session.referenceK !== null || session.secondaryChannels.length > 0;
}

/**
 * Clear the entire session
 */
export function clearSession() {
    session = {
        referenceK: null,
        secondaryChannels: [],
        kReduction: null,
        createdAt: null,
        modifiedAt: null,
        currentStep: 0,
        options: {
            useLstarMatching: false,
            bracketMargin: 0.13,
            thresholdFraction: 0.5,
            transitionWidth: 20,
            entryMode: 'paste',
            manualRowCount: 7
        }
    };
    persistSession();
    notifyListeners();
}

/**
 * Start a new session
 */
export function startNewSession() {
    clearSession();
    session.createdAt = Date.now();
    session.modifiedAt = Date.now();
    persistSession();
    notifyListeners();
}

// ============================================================================
// Reference K Management
// ============================================================================

/**
 * Set reference K channel data
 * @param {Object} kData - { name?, inkLimit?, measurements, dMax?, curve?, L_paper? }
 */
export function setReferenceK(kData) {
    if (!kData) {
        session.referenceK = null;
    } else {
        session.referenceK = {
            name: kData.name || 'K',
            inkLimit: typeof kData.inkLimit === 'number' ? kData.inkLimit : null,
            measurements: Array.isArray(kData.measurements)
                ? deepClone(kData.measurements) : [],
            dMax: typeof kData.dMax === 'number' ? kData.dMax : null,
            curve: Array.isArray(kData.curve) ? kData.curve.slice() : null,
            L_paper: typeof kData.L_paper === 'number' ? kData.L_paper : null
        };
    }
    session.modifiedAt = Date.now();
    if (!session.createdAt) {
        session.createdAt = session.modifiedAt;
    }
    persistSession();
    notifyListeners();
}

/**
 * Get reference K data
 * @returns {Object|null}
 */
export function getReferenceK() {
    return session.referenceK ? deepClone(session.referenceK) : null;
}

/**
 * Set reference K from ink limit and L* measurements (primary workflow)
 * This follows the same pattern as secondary channels: ink limit + measurements
 * @param {number} inkLimit - Ink limit used for test print (0-100)
 * @param {Array<{input: number, lstar: number}>} measurements - L* measurements
 * @param {Function} computeDensityProfile - Density profile function from channel-builder.js
 * @returns {boolean} Success
 */
export function setReferenceKFromMeasurements(inkLimit, measurements, computeDensityProfile) {
    if (!measurements || measurements.length < 2) {
        console.warn('[ChannelBuilder] Invalid measurements for K');
        return false;
    }

    if (typeof inkLimit !== 'number' || inkLimit <= 0 || inkLimit > 100) {
        console.warn('[ChannelBuilder] Invalid ink limit for K');
        return false;
    }

    // Compute density profile to get dMax and L_paper
    let dMax = null;
    let L_paper = null;
    if (typeof computeDensityProfile === 'function') {
        const profile = computeDensityProfile(measurements);
        dMax = profile.dMax;
        L_paper = profile.L_paper;
    }

    // Generate linear ramp curve scaled to ink limit
    const curve = generateLinearRamp(inkLimit);

    setReferenceK({
        name: 'K',
        inkLimit,
        measurements,
        dMax,
        curve,
        L_paper
    });

    return true;
}

/**
 * Check if reference K is set
 * @returns {boolean}
 */
export function hasReferenceK() {
    return session.referenceK !== null && session.referenceK.dMax !== null;
}

/**
 * Load reference K from an existing quad file's K curve
 * This is an optional "import from existing quad" shortcut.
 * The primary workflow is setReferenceKFromMeasurements().
 * @param {Object} quadData - Loaded quad data with curves
 */
export function loadReferenceKFromQuad(quadData) {
    if (!quadData?.curves?.K) {
        console.warn('[ChannelBuilder] No K curve found in quad data');
        return false;
    }

    const kCurve = quadData.curves.K;

    // Extract ink limit from curve max value
    const maxCurveValue = Math.max(...kCurve);
    const inkLimit = (maxCurveValue / 65535) * 100;

    // Create synthetic measurements from the curve for analysis
    // We need measurements to compute dMax
    const measurements = [];
    const step = 16; // Sample every 16th point
    for (let i = 0; i < 256; i += step) {
        const input = (i / 255) * 100;
        // Convert curve value to approximate L* (rough estimation)
        // This is imprecise without actual L* measurements
        const inkValue = kCurve[i] / 65535;
        const estimatedL = 100 - (inkValue * 100); // Very rough approximation
        measurements.push({ input, lstar: estimatedL });
    }
    // Add final point
    measurements.push({ input: 100, lstar: 100 - (kCurve[255] / 65535 * 100) });

    setReferenceK({
        name: 'K',
        inkLimit: Math.round(inkLimit * 10) / 10, // Round to 1 decimal
        measurements,
        dMax: null, // Will be computed when actual L* measurements provided
        curve: kCurve.slice()
    });

    return true;
}

// ============================================================================
// Secondary Channel Management
// ============================================================================

/**
 * Add a secondary channel
 * @param {Object} channelData - { name, inkLimit, measurements, computed? }
 * @returns {number} Index of added channel
 */
export function addSecondaryChannel(channelData) {
    const channel = {
        name: channelData.name,
        inkLimit: channelData.inkLimit || 100,
        measurements: Array.isArray(channelData.measurements)
            ? deepClone(channelData.measurements) : [],
        computed: channelData.computed ? deepClone(channelData.computed) : null
    };

    // Check if channel already exists
    const existingIndex = session.secondaryChannels.findIndex(
        c => c.name === channel.name
    );

    if (existingIndex >= 0) {
        // Update existing
        session.secondaryChannels[existingIndex] = channel;
    } else {
        // Add new
        session.secondaryChannels.push(channel);
    }

    session.modifiedAt = Date.now();
    persistSession();
    notifyListeners();

    return existingIndex >= 0 ? existingIndex : session.secondaryChannels.length - 1;
}

/**
 * Update a secondary channel's computed results
 * @param {string} name - Channel name
 * @param {Object} computed - Computed parameters
 */
export function updateSecondaryChannelComputed(name, computed) {
    const channel = session.secondaryChannels.find(c => c.name === name);
    if (channel) {
        channel.computed = deepClone(computed);
        session.modifiedAt = Date.now();
        persistSession();
        notifyListeners();
    }
}

/**
 * Remove a secondary channel
 * @param {string} name - Channel name
 * @returns {boolean} True if removed
 */
export function removeSecondaryChannel(name) {
    const index = session.secondaryChannels.findIndex(c => c.name === name);
    if (index >= 0) {
        session.secondaryChannels.splice(index, 1);
        session.modifiedAt = Date.now();
        persistSession();
        notifyListeners();
        return true;
    }
    return false;
}

/**
 * Get all secondary channels
 * @returns {Array}
 */
export function getSecondaryChannels() {
    return deepClone(session.secondaryChannels);
}

/**
 * Get a specific secondary channel
 * @param {string} name - Channel name
 * @returns {Object|null}
 */
export function getSecondaryChannel(name) {
    const channel = session.secondaryChannels.find(c => c.name === name);
    return channel ? deepClone(channel) : null;
}

/**
 * Get channels sorted by apex position (lightest first)
 * @returns {Array}
 */
export function getSecondaryChannelsSortedByApex() {
    const channels = deepClone(session.secondaryChannels);
    return channels.sort((a, b) => {
        const apexA = a.computed?.apex ?? 50;
        const apexB = b.computed?.apex ?? 50;
        return apexA - apexB;
    });
}

// ============================================================================
// K Reduction Management
// ============================================================================

/**
 * Set computed K reduction
 * @param {Object} reduction - { curve, startIndex, midtonePeakPercent }
 */
export function setKReduction(reduction) {
    if (!reduction) {
        session.kReduction = null;
    } else {
        session.kReduction = {
            curve: Array.isArray(reduction.curve) ? reduction.curve.slice() : null,
            startIndex: typeof reduction.startIndex === 'number' ? reduction.startIndex : 0,
            midtonePeakPercent: typeof reduction.midtonePeakPercent === 'number'
                ? reduction.midtonePeakPercent : 50
        };
    }
    session.modifiedAt = Date.now();
    persistSession();
    notifyListeners();
}

/**
 * Get K reduction
 * @returns {Object|null}
 */
export function getKReduction() {
    return session.kReduction ? deepClone(session.kReduction) : null;
}

// ============================================================================
// Wizard Navigation
// ============================================================================

/**
 * Get current wizard step
 * @returns {number}
 */
export function getCurrentStep() {
    return session.currentStep;
}

/**
 * Set current wizard step
 * @param {number} step - 0-3
 */
export function setCurrentStep(step) {
    const clamped = Math.max(0, Math.min(3, Math.round(step)));
    if (session.currentStep !== clamped) {
        session.currentStep = clamped;
        session.modifiedAt = Date.now();
        persistSession();
        notifyListeners();
    }
}

/**
 * Advance to next step
 */
export function nextStep() {
    setCurrentStep(session.currentStep + 1);
}

/**
 * Go back to previous step
 */
export function previousStep() {
    setCurrentStep(session.currentStep - 1);
}

// ============================================================================
// Options Management
// ============================================================================

/**
 * Get session options
 * @returns {Object}
 */
export function getOptions() {
    return deepClone(session.options);
}

/**
 * Update session options
 * @param {Object} updates - Partial options
 */
export function updateOptions(updates) {
    session.options = {
        ...session.options,
        ...updates
    };
    session.modifiedAt = Date.now();
    persistSession();
    notifyListeners();
}

// ============================================================================
// Subscriptions
// ============================================================================

/**
 * Subscribe to session changes
 * @param {Function} callback - Called with session snapshot
 * @returns {Function} Unsubscribe function
 */
export function subscribeSessionChanges(callback) {
    if (typeof callback !== 'function') return () => {};
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

// ============================================================================
// Export/Import
// ============================================================================

/**
 * Export session to JSON string
 * @returns {string}
 */
export function exportSession() {
    return JSON.stringify(session, null, 2);
}

/**
 * Import session from JSON string
 * @param {string} json - JSON string
 * @returns {boolean} Success
 */
export function importSession(json) {
    try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === 'object') {
            session = {
                referenceK: parsed.referenceK || null,
                secondaryChannels: Array.isArray(parsed.secondaryChannels)
                    ? parsed.secondaryChannels : [],
                kReduction: parsed.kReduction || null,
                createdAt: parsed.createdAt || Date.now(),
                modifiedAt: Date.now(),
                currentStep: parsed.currentStep || 0,
                options: {
                    useLstarMatching: false,
                    bracketMargin: 0.13,
                    thresholdFraction: 0.5,
                    transitionWidth: 20,
                    entryMode: 'paste',
                    manualRowCount: 7,
                    ...(parsed.options || {})
                }
            };
            persistSession();
            notifyListeners();
            return true;
        }
    } catch (error) {
        console.warn('[ChannelBuilder] Failed to import session:', error);
    }
    return false;
}

// ============================================================================
// Helper: Get all channel curves for total ink calculation
// ============================================================================

/**
 * Get all channels as array suitable for total ink validation
 * @returns {Array<{name: string, curve: number[], endPercent: number}>}
 */
export function getAllChannelsForValidation() {
    const channels = [];

    // Add K (reduced)
    if (session.kReduction?.curve) {
        const kEnd = session.referenceK?.curve
            ? (Math.max(...session.referenceK.curve) / 65535 * 100)
            : 100;
        channels.push({
            name: 'K',
            curve: session.kReduction.curve,
            endPercent: kEnd
        });
    } else if (session.referenceK?.curve) {
        const kEnd = Math.max(...session.referenceK.curve) / 65535 * 100;
        channels.push({
            name: 'K',
            curve: session.referenceK.curve,
            endPercent: kEnd
        });
    }

    // Add secondaries
    for (const ch of session.secondaryChannels) {
        if (ch.computed?.curve) {
            channels.push({
                name: ch.name,
                curve: ch.computed.curve,
                endPercent: ch.computed.end || 100
            });
        }
    }

    return channels;
}

// ============================================================================
// Initialization
// ============================================================================

// Auto-load persisted session on module load
if (typeof window !== 'undefined') {
    loadPersistedSession();
}

export default {
    initializeChannelBuilderState,
    getSession,
    hasActiveSession,
    clearSession,
    startNewSession,
    setReferenceK,
    getReferenceK,
    hasReferenceK,
    setReferenceKFromMeasurements,
    loadReferenceKFromQuad,
    addSecondaryChannel,
    updateSecondaryChannelComputed,
    removeSecondaryChannel,
    getSecondaryChannels,
    getSecondaryChannel,
    getSecondaryChannelsSortedByApex,
    setKReduction,
    getKReduction,
    getCurrentStep,
    setCurrentStep,
    nextStep,
    previousStep,
    getOptions,
    updateOptions,
    subscribeSessionChanges,
    exportSession,
    importSession,
    getAllChannelsForValidation
};
