// Channel density store
// Manages manual defaults, solver outputs, and persistence for per-channel density constants.

import { registerDebugNamespace } from '../utils/debug-registry.js';

const STORAGE_KEY = 'quadgen.channelDensity.v1';
const MAX_DENSITY = 2;

export const DEFAULT_CHANNEL_DENSITIES = Object.freeze({
    K: 1.0,
    MK: 1.0,
    C: 0.21,
    LK: 0.054
});

const MIN_SOLVER_DENSITY = 0.01;

const densityState = new Map(); // channel -> { value: number, source: 'manual' | 'solver' }
const subscribers = new Set();
const autoSubscribers = new Set();
let storageLoaded = false;
let autoComputeEnabled = true;

function clampDensity(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    if (value < 0) return 0;
    if (value > MAX_DENSITY) return MAX_DENSITY;
    return value;
}

export function formatDensityValue(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    const clamped = clampDensity(value);
    if (clamped === null) return '';
    const fixed = clamped.toFixed(3);
    return fixed.replace(/\.?0+$/, '');
}

function getDefaultDensity(channelName) {
    const defaultValue = DEFAULT_CHANNEL_DENSITIES[channelName];
    return Number.isFinite(defaultValue) ? defaultValue : null;
}

function notify(channelName) {
    if (!channelName) return;
    const payload = getResolvedChannelDensity(channelName);
    subscribers.forEach((listener) => {
        try {
            listener(channelName, payload);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('[channel-densities] subscriber failed:', error);
        }
    });
}

function notifyAutoCompute() {
    const state = !!autoComputeEnabled;
    autoSubscribers.forEach((listener) => {
        try {
            listener(state);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('[channel-densities] auto subscriber failed:', error);
        }
    });
}

function persist() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload = {
        auto: !!autoComputeEnabled,
        channels: {}
    };
    densityState.forEach((entry, channel) => {
        if (!entry || !Number.isFinite(entry.value)) return;
        if (entry.source === 'default' || entry.source === 'unset') return;
        payload.channels[channel] = {
            value: entry.value,
            source: entry.source
        };
    });
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            // eslint-disable-next-line no-console
            console.warn('[channel-densities] persist failed:', error);
        }
    }
}

function loadFromStorage() {
    if (storageLoaded) return;
    storageLoaded = true;
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        let channelEntries = parsed;
        if ('channels' in parsed || 'auto' in parsed) {
            if (typeof parsed.auto === 'boolean') {
                autoComputeEnabled = parsed.auto;
            }
            if (parsed.channels && typeof parsed.channels === 'object') {
                channelEntries = parsed.channels;
            } else {
                channelEntries = {};
            }
        }
        densityState.clear();
        let mutated = false;
        Object.entries(channelEntries).forEach(([channelName, entry]) => {
            const sanitized = clampDensity(Number(entry?.value));
            const sourceRaw = typeof entry?.source === 'string' ? entry.source : 'solver';
            const source = sourceRaw === 'manual' ? 'manual' : 'solver';
            if (sanitized === null) return;
            const defaultValue = getDefaultDensity(channelName);
            if (source !== 'manual' &&
                Number.isFinite(defaultValue) &&
                defaultValue > 0 &&
                sanitized <= MIN_SOLVER_DENSITY) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[channel-densities] restoring default', {
                        channel: channelName,
                        stored: sanitized,
                        defaultValue
                    });
                }
                mutated = true;
                return;
            }
            densityState.set(channelName, {
                value: sanitized,
                source
            });
        });
        if (mutated) {
            persist();
        }
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            // eslint-disable-next-line no-console
            console.warn('[channel-densities] load failed:', error);
        }
    }
}

export function initializeChannelDensitiesForPrinter(channelNames = []) {
    loadFromStorage();
    const valid = new Set(Array.isArray(channelNames) ? channelNames : []);
    let mutated = false;
    densityState.forEach((_, channelName) => {
        if (!valid.has(channelName)) {
            densityState.delete(channelName);
            mutated = true;
        }
    });
    if (mutated) {
        persist();
    }
}

export function getResolvedChannelDensity(channelName) {
    loadFromStorage();
    if (!channelName) {
        return { value: null, source: 'unset' };
    }
    const stored = densityState.get(channelName);
    if (stored && Number.isFinite(stored.value)) {
        return { value: clampDensity(stored.value), source: stored.source || 'manual' };
    }
    const fallback = getDefaultDensity(channelName);
    if (fallback !== null) {
        return { value: fallback, source: 'default' };
    }
    return { value: null, source: 'unset' };
}

export function setManualChannelDensity(channelName, value) {
    loadFromStorage();
    const sanitized = clampDensity(value);
    if (!channelName) return getResolvedChannelDensity(channelName);
    if (sanitized === null) {
        const changed = densityState.delete(channelName);
        if (changed) {
            persist();
            notify(channelName);
        } else {
            notify(channelName);
        }
        return getResolvedChannelDensity(channelName);
    }
    if (sanitized <= 0) {
        const previous = densityState.get(channelName);
        if (!previous || previous.value !== 0 || previous.source !== 'pending') {
            densityState.set(channelName, { value: 0, source: 'pending' });
            persist();
        }
        notify(channelName);
        return { value: 0, source: 'pending' };
    }
    const previous = densityState.get(channelName);
    if (previous && previous.value === sanitized && previous.source === 'manual') {
        notify(channelName);
        return { value: sanitized, source: 'manual' };
    }
    densityState.set(channelName, { value: sanitized, source: 'manual' });
    persist();
    notify(channelName);
    return { value: sanitized, source: 'manual' };
}

export function setSolverChannelDensity(channelName, value) {
    loadFromStorage();
    if (!channelName) return;
    const sanitized = clampDensity(value);
    if (sanitized === null) {
        const changed = densityState.delete(channelName);
        if (changed) {
            persist();
            notify(channelName);
        }
        return;
    }
    densityState.set(channelName, { value: sanitized, source: 'solver' });
    persist();
    notify(channelName);
}

export function clearChannelDensity(channelName) {
    if (!channelName) return;
    const changed = densityState.delete(channelName);
    if (changed) {
        persist();
        notify(channelName);
    } else {
        notify(channelName);
    }
}

export function resetAllChannelDensities(channelNames = []) {
    let changed = false;
    if (!channelNames || !channelNames.length) {
        if (densityState.size) {
            densityState.clear();
            changed = true;
        }
    } else {
        const preserve = new Set(channelNames);
        densityState.forEach((_, name) => {
            if (!preserve.has(name)) {
                densityState.delete(name);
                changed = true;
            }
        });
    }
    if (changed) {
        persist();
        (channelNames || []).forEach((name) => notify(name));
    }
}

export function subscribeChannelDensities(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    subscribers.add(listener);
    return () => {
        subscribers.delete(listener);
    };
}

export function exportChannelDensityState() {
    const snapshot = {
        auto: !!autoComputeEnabled,
    };
    const channels = {};
    densityState.forEach((entry, channel) => {
        channels[channel] = { ...entry };
    });
    snapshot.channels = channels;
    return snapshot;
}

export function isAutoDensityComputeEnabled() {
    loadFromStorage();
    return !!autoComputeEnabled;
}

export function setAutoDensityComputeEnabled(enabled) {
    loadFromStorage();
    const next = !!enabled;
    if (autoComputeEnabled === next) {
        return autoComputeEnabled;
    }
    autoComputeEnabled = next;
    persist();
    notifyAutoCompute();
    return autoComputeEnabled;
}

export function subscribeAutoDensityCompute(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    autoSubscribers.add(listener);
    return () => {
        autoSubscribers.delete(listener);
    };
}

export function getDensityOverridesSnapshot(channelNames = []) {
    loadFromStorage();
    const overrides = {};
    if (!Array.isArray(channelNames)) {
        return overrides;
    }
    channelNames.forEach((name) => {
        const resolved = getResolvedChannelDensity(name);
        if (!resolved || resolved.value === null || resolved.source === 'unset' || resolved.source === 'default' || resolved.source === 'pending') {
            return;
        }
        overrides[name] = {
            value: resolved.value,
            source: resolved.source
        };
    });
    return overrides;
}

registerDebugNamespace('channelDensities', {
    DEFAULT_CHANNEL_DENSITIES,
    getResolvedChannelDensity,
    setManualChannelDensity,
    setSolverChannelDensity,
    clearChannelDensity,
    resetAllChannelDensities,
    subscribeChannelDensities,
    exportChannelDensityState,
    isAutoDensityComputeEnabled,
    setAutoDensityComputeEnabled,
    subscribeAutoDensityCompute,
    getDensityOverridesSnapshot
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['getResolvedChannelDensity', 'setManualChannelDensity', 'setAutoDensityComputeEnabled']
});
