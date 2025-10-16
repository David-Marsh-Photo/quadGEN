// Composite weighting settings for LAB redistribution.

import { registerDebugNamespace } from '../utils/debug-registry.js';

export const COMPOSITE_WEIGHTING_MODES = {
    ISOLATED: 'isolated',
    NORMALIZED: 'normalized',
    MOMENTUM: 'momentum',
    EQUAL: 'equal'
};

const STORAGE_KEY = 'quadgen.compositeWeightingMode';
const modeSubscribers = new Set();

function readStoredMode() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;
        return Object.values(COMPOSITE_WEIGHTING_MODES).includes(stored) ? stored : null;
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[CompositeSettings] Failed to read weighting mode from storage:', error);
        }
        return null;
    }
}

function writeStoredMode(mode) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[CompositeSettings] Failed to persist weighting mode:', error);
        }
    }
}

let weightingMode = readStoredMode() || COMPOSITE_WEIGHTING_MODES.NORMALIZED;

export function getCompositeWeightingMode() {
    return weightingMode;
}

export function setCompositeWeightingMode(mode) {
    const next = Object.values(COMPOSITE_WEIGHTING_MODES).includes(mode)
        ? mode
        : COMPOSITE_WEIGHTING_MODES.NORMALIZED;
    if (next === weightingMode) {
        return weightingMode;
    }
    weightingMode = next;
    writeStoredMode(weightingMode);
    notifySubscribers();
    return weightingMode;
}

export function subscribeCompositeWeightingMode(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    modeSubscribers.add(listener);
    return () => {
        modeSubscribers.delete(listener);
    };
}

function notifySubscribers() {
    if (!modeSubscribers.size) {
        return;
    }
    modeSubscribers.forEach((listener) => {
        try {
            listener(weightingMode);
        } catch (error) {
            console.warn('[CompositeSettings] subscriber failed:', error);
        }
    });
}

registerDebugNamespace('compositeSettings', {
    getCompositeWeightingMode,
    setCompositeWeightingMode,
    subscribeCompositeWeightingMode,
    modes: { ...COMPOSITE_WEIGHTING_MODES }
}, { exposeOnWindow: typeof window !== 'undefined' });
