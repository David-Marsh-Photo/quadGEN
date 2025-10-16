// Light Blocking Overlay Helpers
// Computes density-weighted blocking curves and manages overlay state.

import {
    elements,
    TOTAL,
    getAppState,
    updateAppState,
    getLoadedQuadData,
    subscribeLoadedQuadData,
    isChannelNormalizedToEnd
} from './state.js';
import { InputValidator } from './validation.js';
import { make256 } from './processing-pipeline.js';
import { getResolvedChannelDensity } from './channel-densities.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const STORAGE_KEY = 'quadgen.lightBlockingOverlayEnabled.v1';
const DEFAULT_RESOLUTION = 256;

let preferenceLoaded = false;
let cachedSignature = null;
let cachedResult = null;

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function ensurePreferenceLoaded() {
    if (preferenceLoaded) return;
    preferenceLoaded = true;
    let stored = null;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            stored = window.localStorage.getItem(STORAGE_KEY);
        }
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[light-blocking] Failed to load overlay preference:', error);
        }
    }
    if (stored === 'true') {
        updateAppState({ showLightBlockingOverlay: true });
    } else if (stored === 'false') {
        updateAppState({ showLightBlockingOverlay: false });
    }
}

function persistPreference(enabled) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
        }
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[light-blocking] Failed to persist overlay preference:', error);
        }
    }
}

function resampleNormalizedSamples(samples, resolution) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return Array.from({ length: resolution }, () => 0);
    }
    if (samples.length === resolution) {
        return samples.map(clamp01);
    }

    const out = new Array(resolution);
    const lastIndex = samples.length - 1;
    for (let i = 0; i < resolution; i += 1) {
        if (resolution === 1) {
            out[i] = clamp01(samples[0] ?? 0);
            continue;
        }
        const position = (i / (resolution - 1)) * lastIndex;
        const left = Math.floor(position);
        const right = Math.min(lastIndex, left + 1);
        const t = position - left;
        const leftValue = clamp01(samples[left] ?? 0);
        const rightValue = clamp01(samples[right] ?? leftValue);
        out[i] = clamp01(leftValue + (rightValue - leftValue) * t);
    }
    return out;
}

function normalizeSamplesFromTotal(samples, resolution) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return Array.from({ length: resolution }, () => 0);
    }
    const normalized = samples.map((value) => clamp01(Number(value) / TOTAL));
    return resampleNormalizedSamples(normalized, resolution);
}

function buildDomChannelEntries({ resolution }) {
    if (!elements.rows) return [];

    const rows = Array.from(elements.rows.querySelectorAll('tr.channel-row[data-channel]'));
    const entries = [];
    const applyLinearization = !!(LinearizationState?.globalApplied && LinearizationState?.globalData);

    rows.forEach((row) => {
        const channelName = row.getAttribute('data-channel');
        if (!channelName || row.id === 'noChannelsRow') {
            return;
        }

        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');

        const percentValue = InputValidator.clampPercent(
            percentInput?.dataset?.pendingCommitValue ??
            percentInput?.getAttribute?.('data-base-percent') ??
            percentInput?.value
        );
        const endValue = InputValidator.clampEnd(
            endInput?.dataset?.pendingCommitValue ??
            endInput?.getAttribute?.('data-base-end') ??
            endInput?.value
        );

        const enabled = percentValue > 0 || endValue > 0;
        const weightEntry = getResolvedChannelDensity(channelName);
        const weight = Number.isFinite(weightEntry?.value) ? Math.max(0, weightEntry.value) : 0;

        let make256Values = [];
        if (typeof make256 === 'function' && enabled && endValue > 0) {
            try {
                make256Values = make256(endValue, channelName, applyLinearization, {
                    normalizeToEnd: isChannelNormalizedToEnd(channelName)
                }) || [];
            } catch (error) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[light-blocking] make256 failed for channel', channelName, error);
                }
            }
        }

        const normalizedSamples = normalizeSamplesFromTotal(make256Values, resolution);

        entries.push({
            channelName,
            enabled: enabled && weight > 0,
            weight,
            normalizedSamples,
            endValue
        });
    });

    return entries;
}

function buildOverrideEntries(channels, resolution) {
    if (!channels || typeof channels !== 'object') {
        return [];
    }
    return Object.entries(channels).map(([channelName, entry]) => {
        const enabled = !!entry?.enabled;
        const weight = Number(entry?.weight) || 0;
        const normalizedSamples = Array.isArray(entry?.samples)
            ? resampleNormalizedSamples(entry.samples.map((value) => clamp01(Number(value))), resolution)
            : Array.from({ length: resolution }, () => 0);
        const endValue = Number(entry?.end) || 0;
        return {
            channelName,
            enabled: enabled && weight > 0,
            weight,
            normalizedSamples,
            endValue,
            normalizeToEnd: !!entry?.normalizeToEnd
        };
    });
}

function buildSignature(entries, resolution) {
    if (!entries.length) return `${resolution}|`;
    const compact = entries.map((entry) => {
        const samples = entry.normalizedSamples || [];
        const first = clamp01(samples[0] ?? 0);
        const mid = clamp01(samples[Math.floor(samples.length / 2)] ?? 0);
        const last = clamp01(samples[samples.length - 1] ?? 0);
        const weight = Number.isFinite(entry.weight) ? entry.weight : 0;
        return [
            entry.channelName,
            entry.enabled ? 1 : 0,
            Math.round(Number(entry.endValue) || 0),
            weight.toFixed(4),
            first.toFixed(4),
            mid.toFixed(4),
            last.toFixed(4)
        ].join(':');
    }).join('|');
    return `${resolution}|${compact}`;
}

export function clearLightBlockingCache() {
    cachedSignature = null;
    cachedResult = null;
}

export function setLightBlockingOverlayEnabled(enabled = true) {
    ensurePreferenceLoaded();
    const next = !!enabled;
    updateAppState({ showLightBlockingOverlay: next });
    persistPreference(next);
    clearLightBlockingCache();
    return next;
}

export function isLightBlockingOverlayEnabled() {
    ensurePreferenceLoaded();
    const state = getAppState();
    return !!state.showLightBlockingOverlay;
}

export function computeLightBlockingCurve(options = {}) {
    const resolution = Number.isInteger(options.resolution) && options.resolution > 1
        ? options.resolution
        : DEFAULT_RESOLUTION;
    const skipCache = options.skipCache === true;

    let entries = [];
    if (options.channels) {
        entries = buildOverrideEntries(options.channels, resolution);
    } else {
        entries = buildDomChannelEntries({ resolution });
    }

    const signature = buildSignature(entries, resolution);
    if (!skipCache && !options.channels && cachedSignature === signature && cachedResult) {
        const useNormalizedCurve = options.normalize === true;
        return {
            curve: (useNormalizedCurve ? cachedResult.normalizedCurve : cachedResult.rawCurve).slice(),
            maxValue: useNormalizedCurve ? cachedResult.normalizedMaxValue : cachedResult.rawMaxValue,
            contributingChannels: cachedResult.contributingChannels.slice(),
            rawCurve: cachedResult.rawCurve.slice(),
            rawMaxValue: cachedResult.rawMaxValue,
            normalizedCurve: cachedResult.normalizedCurve.slice(),
            normalizedMaxValue: cachedResult.normalizedMaxValue
        };
    }

    const rawCurve = Array.from({ length: resolution }, () => 0);
    const contributing = [];

    for (const entry of entries) {
        if (!entry.enabled || !Number.isFinite(entry.weight) || entry.weight <= 0) {
            continue;
        }
        const samples = Array.isArray(entry.normalizedSamples)
            ? entry.normalizedSamples
            : Array.from({ length: resolution }, () => 0);
        let anyContribution = false;
        for (let i = 0; i < resolution; i += 1) {
            const normalized = clamp01(samples[i] ?? 0);
            if (normalized > 0) {
                anyContribution = true;
            }
            const weightedPercent = normalized * 100 * entry.weight;
            rawCurve[i] += Number.isFinite(weightedPercent) ? weightedPercent : 0;
        }
        if (anyContribution) {
            contributing.push(entry.channelName);
        }
    }

    let rawMaxValue = 0;
    for (let i = 0; i < rawCurve.length; i += 1) {
        const clamped = Math.max(0, Math.min(100, rawCurve[i]));
        rawCurve[i] = clamped;
        if (clamped > rawMaxValue) {
            rawMaxValue = clamped;
        }
    }

    const normalizedCurve = rawMaxValue > 0
        ? rawCurve.map((value) => (Math.max(0, Math.min(100, value / rawMaxValue * 100))))
        : rawCurve.slice();
    const normalizedMaxValue = rawMaxValue > 0 ? 100 : rawMaxValue;

    const useNormalizedCurve = options.normalize === true;

    const result = {
        curve: (useNormalizedCurve ? normalizedCurve : rawCurve).slice(),
        maxValue: useNormalizedCurve ? normalizedMaxValue : rawMaxValue,
        contributingChannels: contributing.slice(),
        rawCurve: rawCurve.slice(),
        rawMaxValue,
        normalizedCurve: normalizedCurve.slice(),
        normalizedMaxValue
    };

    if (!options.channels && !skipCache) {
        cachedSignature = signature;
        cachedResult = {
            rawCurve: rawCurve.slice(),
            rawMaxValue,
            normalizedCurve: normalizedCurve.slice(),
            normalizedMaxValue,
            contributingChannels: contributing.slice()
        };
    }

    return result;
}

subscribeLoadedQuadData(() => {
    clearLightBlockingCache();
});

if (typeof window !== 'undefined') {
    registerDebugNamespace('lightBlockingOverlay', {
        computeLightBlockingCurve,
        clearLightBlockingCache,
        isLightBlockingOverlayEnabled,
        setLightBlockingOverlayEnabled
    }, {
        exposeOnWindow: true,
        windowAliases: ['computeLightBlockingCurve', 'clearLightBlockingOverlayCache', 'isLightBlockingOverlayEnabled', 'setLightBlockingOverlayEnabled']
    });
}
