// Centralized feature flag helpers for runtime toggles

import { registerDebugNamespace } from '../utils/debug-registry.js';

const DEFAULT_FLAGS = {
    activeRangeLinearization: false,
    cubeEndpointAnchoring: false
};

const flagState = {
    ...DEFAULT_FLAGS
};

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
}

installWindowAdapters();

registerDebugNamespace('featureFlags', {
    setActiveRangeLinearizationEnabled,
    isActiveRangeLinearizationEnabled,
    setCubeEndpointAnchoringEnabled,
    isCubeEndpointAnchoringEnabled
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
    installWindowAdapters();
    return { ...flagState };
}
