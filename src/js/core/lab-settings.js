// Runtime setting for LAB linearization normalization mode (L* vs density)

import { registerDebugNamespace } from '../utils/debug-registry.js';
import { isLabBaselineSmoothingEnabled as featureLabBaseline } from './feature-flags.js';

export const LAB_NORMALIZATION_MODES = Object.freeze({
    LSTAR: 'lstar',
    DENSITY: 'density'
});

export const DEFAULT_LAB_SMOOTHING_PERCENT = 0;
const LEGACY_DEFAULT_LAB_SMOOTHING_PERCENT = 50;

const LAB_SMOOTHING_MAX = 300;
const LAB_SMOOTHING_EXPONENT = 1.35;
const LAB_SMOOTHING_MAX_DELTA = 3;

const SMOOTHING_STORAGE_KEY = 'quadgen.labSmoothingPercent';

const STORAGE_KEY = 'quadgen.labNormalizationMode';
const listeners = new Set();
const smoothingListeners = new Set();

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

function sanitizeSmoothingPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_LAB_SMOOTHING_PERCENT;
    }
    return Math.max(0, Math.min(300, Math.round(numeric)));
}

function loadInitialSmoothingPercent() {
    try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SMOOTHING_STORAGE_KEY) : null;
        if (stored == null) {
            return DEFAULT_LAB_SMOOTHING_PERCENT;
        }
        const sanitized = sanitizeSmoothingPercent(stored);
        if (sanitized === LEGACY_DEFAULT_LAB_SMOOTHING_PERCENT) {
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.removeItem(SMOOTHING_STORAGE_KEY);
                }
            } catch (storageError) {
                // Ignore storage cleanup issues (private mode, etc.)
            }
            return DEFAULT_LAB_SMOOTHING_PERCENT;
        }
        return sanitized;
    } catch (error) {
        return DEFAULT_LAB_SMOOTHING_PERCENT;
    }
}

let currentSmoothingPercent = loadInitialSmoothingPercent();

function persistMode() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, currentMode);
        }
    } catch (error) {
        // Ignore storage failures (private mode, etc.)
    }
}

function persistSmoothingPercent() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SMOOTHING_STORAGE_KEY, String(currentSmoothingPercent));
        }
    } catch (error) {
        // Ignore storage failures
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

function notifySmoothing(percent) {
    smoothingListeners.forEach((listener) => {
        try {
            listener(percent);
        } catch (error) {
            console.warn('[lab-settings] smoothing listener error:', error);
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

export function getLabSmoothingPercent() {
    return currentSmoothingPercent;
}

export function getLabWidenFactor() {
    return mapSmoothingPercentToWiden(currentSmoothingPercent);
}

export function mapSmoothingPercentToWiden(percent) {
    const numeric = Number(percent);
    if (!Number.isFinite(numeric)) {
        return 1;
    }
    const clamped = Math.max(0, Math.min(LAB_SMOOTHING_MAX, numeric));
    const normalized = LAB_SMOOTHING_MAX > 0 ? (clamped / LAB_SMOOTHING_MAX) : 0;
    const eased = Math.pow(normalized, LAB_SMOOTHING_EXPONENT);
    return 1 + eased * LAB_SMOOTHING_MAX_DELTA;
}

export function setLabSmoothingPercent(percent) {
    const sanitized = sanitizeSmoothingPercent(percent);
    if (sanitized === currentSmoothingPercent) {
        return currentSmoothingPercent;
    }
    currentSmoothingPercent = sanitized;
    persistSmoothingPercent();
    notifySmoothing(currentSmoothingPercent);
    return currentSmoothingPercent;
}

export function isLabBaselineSmoothingEnabled() {
    return featureLabBaseline?.() ?? true;
}

export function subscribeLabSmoothingPercent(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    smoothingListeners.add(listener);
    return () => {
        smoothingListeners.delete(listener);
    };
}

registerDebugNamespace('labSettings', {
    getLabNormalizationMode,
    setLabNormalizationMode,
    toggleLabNormalizationMode,
    isDensityNormalizationEnabled,
    LAB_NORMALIZATION_MODES,
    getLabSmoothingPercent,
    setLabSmoothingPercent,
    subscribeLabSmoothingPercent,
    getLabWidenFactor,
    mapSmoothingPercentToWiden,
    DEFAULT_LAB_SMOOTHING_PERCENT,
    isLabBaselineSmoothingEnabled
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['setLabNormalizationMode', 'toggleLabNormalizationMode']
});
