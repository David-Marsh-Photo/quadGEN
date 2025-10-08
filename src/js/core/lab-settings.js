// Runtime setting for LAB linearization normalization mode (L* vs density)

import { registerDebugNamespace } from '../utils/debug-registry.js';

export const LAB_NORMALIZATION_MODES = Object.freeze({
    LSTAR: 'lstar',
    DENSITY: 'density'
});

const STORAGE_KEY = 'quadgen.labNormalizationMode';
const listeners = new Set();

function sanitizeMode(mode) {
    return mode === LAB_NORMALIZATION_MODES.DENSITY ? LAB_NORMALIZATION_MODES.DENSITY : LAB_NORMALIZATION_MODES.LSTAR;
}

function loadInitialMode() {
    try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (!stored) {
            return LAB_NORMALIZATION_MODES.LSTAR;
        }
        return sanitizeMode(stored);
    } catch (error) {
        return LAB_NORMALIZATION_MODES.LSTAR;
    }
}

let currentMode = loadInitialMode();

function persistMode() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, currentMode);
        }
    } catch (error) {
        // Ignore storage failures (private mode, etc.)
    }
}

function notify(mode) {
    listeners.forEach((listener) => {
        try {
            listener(mode);
        } catch (error) {
            console.warn('[lab-settings] listener error:', error);
        }
    });
}

export function getLabNormalizationMode() {
    return currentMode;
}

export function isDensityNormalizationEnabled() {
    return currentMode === LAB_NORMALIZATION_MODES.DENSITY;
}

export function setLabNormalizationMode(mode) {
    const nextMode = sanitizeMode(mode);
    if (nextMode === currentMode) {
        return currentMode;
    }
    currentMode = nextMode;
    persistMode();
    notify(currentMode);
    return currentMode;
}

export function toggleLabNormalizationMode() {
    const next = isDensityNormalizationEnabled() ? LAB_NORMALIZATION_MODES.LSTAR : LAB_NORMALIZATION_MODES.DENSITY;
    return setLabNormalizationMode(next);
}

export function subscribeLabNormalizationMode(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

registerDebugNamespace('labSettings', {
    getLabNormalizationMode,
    setLabNormalizationMode,
    toggleLabNormalizationMode,
    isDensityNormalizationEnabled,
    LAB_NORMALIZATION_MODES
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['setLabNormalizationMode', 'toggleLabNormalizationMode']
});
