// Correction method preference management

export const CORRECTION_METHODS = Object.freeze({
    DENSITY_SOLVER: 'densitySolver',
    SIMPLE_SCALING: 'simpleScaling'
});

const STORAGE_KEY = 'quadgen.correctionMethod.v1';
const listeners = new Set();

function sanitizeMethod(value) {
    if (value === CORRECTION_METHODS.DENSITY_SOLVER) {
        return CORRECTION_METHODS.DENSITY_SOLVER;
    }
    return CORRECTION_METHODS.SIMPLE_SCALING;
}

function loadInitialMethod() {
    try {
        if (typeof localStorage === 'undefined') {
            return CORRECTION_METHODS.SIMPLE_SCALING;
        }
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            return CORRECTION_METHODS.SIMPLE_SCALING;
        }
        return sanitizeMethod(stored);
    } catch (error) {
        return CORRECTION_METHODS.SIMPLE_SCALING;
    }
}

let currentMethod = loadInitialMethod();

function persistMethod() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, currentMethod);
        }
    } catch (error) {
        // Ignore persistence failures (private mode, etc.)
    }
}

function notify(method) {
    listeners.forEach((listener) => {
        try {
            listener(method);
        } catch (error) {
            console.warn('[correction-method] listener error:', error);
        }
    });
}

export function getCorrectionMethod() {
    return currentMethod;
}

export function setCorrectionMethod(method) {
    const next = sanitizeMethod(method);
    if (next === currentMethod) {
        return currentMethod;
    }
    currentMethod = next;
    persistMethod();
    notify(currentMethod);
    return currentMethod;
}

export function subscribeCorrectionMethod(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function isSimpleScalingSelected() {
    return currentMethod === CORRECTION_METHODS.SIMPLE_SCALING;
}
