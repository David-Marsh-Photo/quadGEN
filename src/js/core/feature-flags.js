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

const REDISTRIBUTION_SMOOTHING_DEFAULTS = Object.freeze({
  targetSpan: 0.07,
  minSamples: 3,
  maxSamples: 9,
  alpha: 1.5,
  momentumBias: 0
});

const REDISTRIBUTION_SMOOTHING_LIMITS = Object.freeze({
  targetSpan: { min: 0.03, max: 0.1 },
  minSamples: { min: 3, max: 9 },
  maxSamples: { min: 3, max: 12 },
  alpha: { min: 0.5, max: 3 }
});

const DEFAULT_FLAGS = {
    activeRangeLinearization: false,
    cubeEndpointAnchoring: false,
    smartPointDrag: true,
    redistributionSmoothingWindow: false,
    autoRaiseInkLimitsOnImport: false,
    slopeKernelSmoothing: true
};

const flagState = {
    ...DEFAULT_FLAGS
};

const redistributionSmoothingWindowConfig = {
    targetSpan: REDISTRIBUTION_SMOOTHING_DEFAULTS.targetSpan,
    minSamples: REDISTRIBUTION_SMOOTHING_DEFAULTS.minSamples,
    maxSamples: REDISTRIBUTION_SMOOTHING_DEFAULTS.maxSamples,
    alpha: REDISTRIBUTION_SMOOTHING_DEFAULTS.alpha,
    momentumBias: REDISTRIBUTION_SMOOTHING_DEFAULTS.momentumBias
};

function clampValue(value, { min, max }, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    if (typeof min === 'number' && numeric < min) {
        return min;
    }
    if (typeof max === 'number' && numeric > max) {
        return max;
    }
    return numeric;
}

function sanitizeRedistributionSmoothingConfig(partial = {}) {
    const next = { ...redistributionSmoothingWindowConfig };
    if (Object.prototype.hasOwnProperty.call(partial, 'targetSpan')) {
        next.targetSpan = clampValue(
            partial.targetSpan,
            REDISTRIBUTION_SMOOTHING_LIMITS.targetSpan,
            REDISTRIBUTION_SMOOTHING_DEFAULTS.targetSpan
        );
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'minSamples')) {
        const min = clampValue(
            partial.minSamples,
            REDISTRIBUTION_SMOOTHING_LIMITS.minSamples,
            REDISTRIBUTION_SMOOTHING_DEFAULTS.minSamples
        );
        next.minSamples = Math.round(min);
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'maxSamples')) {
        const max = clampValue(
            partial.maxSamples,
            REDISTRIBUTION_SMOOTHING_LIMITS.maxSamples,
            REDISTRIBUTION_SMOOTHING_DEFAULTS.maxSamples
        );
        next.maxSamples = Math.round(max);
    }
    if (next.maxSamples < next.minSamples) {
        next.maxSamples = next.minSamples;
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'alpha')) {
        next.alpha = clampValue(
            partial.alpha,
            REDISTRIBUTION_SMOOTHING_LIMITS.alpha,
            REDISTRIBUTION_SMOOTHING_DEFAULTS.alpha
        );
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'momentumBias')) {
        const numeric = Number(partial.momentumBias);
        next.momentumBias = Number.isFinite(numeric) ? numeric : REDISTRIBUTION_SMOOTHING_DEFAULTS.momentumBias;
    }
    return next;
}

const storedSmartPointDrag = loadSmartPointDragFromStorage();
if (storedSmartPointDrag !== null) {
    flagState.smartPointDrag = storedSmartPointDrag;
}

if (typeof process !== 'undefined' && process && process.env && Object.prototype.hasOwnProperty.call(process.env, 'QUADGEN_ENABLE_SLOPE_KERNEL')) {
    const raw = process.env.QUADGEN_ENABLE_SLOPE_KERNEL;
    flagState.slopeKernelSmoothing = raw !== '0' && raw !== 'false';
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

export function isRedistributionSmoothingWindowEnabled() {
    return !!flagState.redistributionSmoothingWindow;
}

export function setRedistributionSmoothingWindowEnabled(enabled) {
    flagState.redistributionSmoothingWindow = !!enabled;
    return flagState.redistributionSmoothingWindow;
}

export function isSlopeKernelSmoothingEnabled() {
    return !!flagState.slopeKernelSmoothing;
}

export function setSlopeKernelSmoothingEnabled(enabled) {
    flagState.slopeKernelSmoothing = !!enabled;
    return flagState.slopeKernelSmoothing;
}

export function getRedistributionSmoothingWindowConfig() {
    return { ...redistributionSmoothingWindowConfig };
}

export function configureRedistributionSmoothingWindow(overrides = {}) {
    const next = sanitizeRedistributionSmoothingConfig(overrides || {});
    Object.assign(redistributionSmoothingWindowConfig, next);
    if (redistributionSmoothingWindowConfig.maxSamples < redistributionSmoothingWindowConfig.minSamples) {
        redistributionSmoothingWindowConfig.maxSamples = redistributionSmoothingWindowConfig.minSamples;
    }
    return getRedistributionSmoothingWindowConfig();
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

    if (typeof window.setRedistributionSmoothingWindowEnabled !== 'function') {
        window.setRedistributionSmoothingWindowEnabled = (enabled = true) => setRedistributionSmoothingWindowEnabled(enabled);
    }

    if (typeof window.configureRedistributionSmoothingWindow !== 'function') {
        window.configureRedistributionSmoothingWindow = (options) => configureRedistributionSmoothingWindow(options);
    }

    if (typeof window.getRedistributionSmoothingWindowConfig !== 'function') {
        window.getRedistributionSmoothingWindowConfig = () => getRedistributionSmoothingWindowConfig();
    }

    if (typeof window.enableSlopeKernelSmoothing !== 'function') {
        window.enableSlopeKernelSmoothing = (enabled = true) => setSlopeKernelSmoothingEnabled(enabled);
    }

    if (typeof window.isSlopeKernelSmoothingEnabled !== 'function') {
        window.isSlopeKernelSmoothingEnabled = () => isSlopeKernelSmoothingEnabled();
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
    isAutoRaiseInkLimitsEnabled,
    setRedistributionSmoothingWindowEnabled,
    isRedistributionSmoothingWindowEnabled,
    configureRedistributionSmoothingWindow,
    getRedistributionSmoothingWindowConfig,
    setSlopeKernelSmoothingEnabled,
    isSlopeKernelSmoothingEnabled
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
    flagState.slopeKernelSmoothing =
        Object.prototype.hasOwnProperty.call(overrides, 'slopeKernelSmoothing')
            ? !!overrides.slopeKernelSmoothing
            : DEFAULT_FLAGS.slopeKernelSmoothing;
    storeSmartPointDragToStorage(flagState.smartPointDrag);
    installWindowAdapters();
    return { ...flagState };
}
