// Centralized feature flag helpers for runtime toggles

import { registerDebugNamespace } from '../utils/debug-registry.js';

const SMART_POINT_DRAG_STORAGE_KEY = 'quadgen.smartPointDragEnabled';

function loadSmartPointDragFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    try {
        const stored = window.localStorage.getItem(SMART_POINT_DRAG_STORAGE_KEY);
        if (stored === null) return null;
        return stored === 'true';
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('Failed to load smartPointDrag from storage:', error);
        }
        return null;
    }
}

function storeSmartPointDragToStorage(value) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(SMART_POINT_DRAG_STORAGE_KEY, value ? 'true' : 'false');
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('Failed to persist smartPointDrag flag:', error);
        }
    }
}

const DEFAULT_FLAGS = {
    activeRangeLinearization: false,
    cubeEndpointAnchoring: false,
    smartPointDrag: true,
    autoRaiseInkLimitsOnImport: false
};

const flagState = {
    ...DEFAULT_FLAGS
};

const storedSmartPointDrag = loadSmartPointDragFromStorage();
if (storedSmartPointDrag !== null) {
    flagState.smartPointDrag = storedSmartPointDrag;
}

export function isActiveRangeLinearizationEnabled() {
    return !!flagState.activeRangeLinearization;
}

export function setActiveRangeLinearizationEnabled(enabled) {
    flagState.activeRangeLinearization = !!enabled;
    return flagState.activeRangeLinearization;
}

export function isCubeEndpointAnchoringEnabled() {
    return !!flagState.cubeEndpointAnchoring;
}

export function setCubeEndpointAnchoringEnabled(enabled) {
    flagState.cubeEndpointAnchoring = enabled !== false;
    return flagState.cubeEndpointAnchoring;
}

export function isSmartPointDragEnabled() {
    return !!flagState.smartPointDrag;
}

export function setSmartPointDragEnabled(enabled) {
    flagState.smartPointDrag = !!enabled;
    storeSmartPointDragToStorage(flagState.smartPointDrag);
    return flagState.smartPointDrag;
}

export function isAutoRaiseInkLimitsEnabled() {
    return !!flagState.autoRaiseInkLimitsOnImport;
}

export function setAutoRaiseInkLimitsEnabled(enabled) {
    flagState.autoRaiseInkLimitsOnImport = !!enabled;
    return flagState.autoRaiseInkLimitsOnImport;
}

function installWindowAdapters() {
    if (typeof window === 'undefined') {
        return;
    }

    if (typeof window.enableActiveRangeLinearization !== 'function') {
        window.enableActiveRangeLinearization = (enabled = true) => setActiveRangeLinearizationEnabled(enabled);
    }

    if (typeof window.isActiveRangeLinearizationEnabled !== 'function') {
        window.isActiveRangeLinearizationEnabled = () => isActiveRangeLinearizationEnabled();
    }

    if (typeof window.setCubeEndpointAnchoringEnabled !== 'function') {
        window.setCubeEndpointAnchoringEnabled = (enabled = true) => setCubeEndpointAnchoringEnabled(enabled);
    }

    if (typeof window.isCubeEndpointAnchoringEnabled !== 'function') {
        window.isCubeEndpointAnchoringEnabled = () => isCubeEndpointAnchoringEnabled();
    }

    if (typeof window.enableSmartPointDrag !== 'function') {
        window.enableSmartPointDrag = (enabled = true) => setSmartPointDragEnabled(enabled);
    }

    if (typeof window.isSmartPointDragEnabled !== 'function') {
        window.isSmartPointDragEnabled = () => isSmartPointDragEnabled();
    }

    if (typeof window.enableAutoRaiseInkLimitsOnImport !== 'function') {
        window.enableAutoRaiseInkLimitsOnImport = (enabled = true) => setAutoRaiseInkLimitsEnabled(enabled);
    }

    if (typeof window.isAutoRaiseInkLimitsEnabled !== 'function') {
        window.isAutoRaiseInkLimitsEnabled = () => isAutoRaiseInkLimitsEnabled();
    }

}

installWindowAdapters();

registerDebugNamespace('featureFlags', {
    setActiveRangeLinearizationEnabled,
    isActiveRangeLinearizationEnabled,
    setCubeEndpointAnchoringEnabled,
    isCubeEndpointAnchoringEnabled,
    setSmartPointDragEnabled,
    isSmartPointDragEnabled,
    setAutoRaiseInkLimitsEnabled,
    isAutoRaiseInkLimitsEnabled
}, {
    exposeOnWindow: typeof window !== 'undefined'
});

export function resetFeatureFlags(overrides = {}) {
    flagState.activeRangeLinearization =
        Object.prototype.hasOwnProperty.call(overrides, 'activeRangeLinearization')
            ? !!overrides.activeRangeLinearization
            : DEFAULT_FLAGS.activeRangeLinearization;
    flagState.cubeEndpointAnchoring =
        Object.prototype.hasOwnProperty.call(overrides, 'cubeEndpointAnchoring')
            ? !!overrides.cubeEndpointAnchoring
            : DEFAULT_FLAGS.cubeEndpointAnchoring;
    flagState.smartPointDrag =
        Object.prototype.hasOwnProperty.call(overrides, 'smartPointDrag')
            ? !!overrides.smartPointDrag
            : DEFAULT_FLAGS.smartPointDrag;
    flagState.autoRaiseInkLimitsOnImport =
        Object.prototype.hasOwnProperty.call(overrides, 'autoRaiseInkLimitsOnImport')
            ? !!overrides.autoRaiseInkLimitsOnImport
            : DEFAULT_FLAGS.autoRaiseInkLimitsOnImport;
    storeSmartPointDragToStorage(flagState.smartPointDrag);
    installWindowAdapters();
    return { ...flagState };
}
