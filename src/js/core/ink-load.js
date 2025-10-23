// Cumulative Ink-Load Overlay Helpers
// Mirrors the legacy January build behavior while fitting the modular architecture.

import {
    elements,
    TOTAL,
    getAppState,
    updateAppState,
    isChannelNormalizedToEnd
} from './state.js';
import { InputValidator } from './validation.js';
import { make256 } from './processing-pipeline.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const OVERLAY_STORAGE_KEY = 'quadgen.inkLoadOverlayEnabled.v1';
const THRESHOLD_STORAGE_KEY = 'quadgen.inkLoadThreshold.v1';
const DEFAULT_THRESHOLD = 25;
const MIN_THRESHOLD = 10;
const MAX_THRESHOLD = 400;
const DEFAULT_RESOLUTION = 256;

let preferenceLoaded = false;

function clampThreshold(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_THRESHOLD;
    }
    return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, Math.round(numeric)));
}

function ensurePreferencesLoaded() {
    if (preferenceLoaded) {
        return;
    }
    preferenceLoaded = true;
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }
        const rawEnabled = window.localStorage.getItem(OVERLAY_STORAGE_KEY);
        if (rawEnabled === 'true') {
            updateAppState({ showInkLoadOverlay: true });
        } else if (rawEnabled === 'false') {
            updateAppState({ showInkLoadOverlay: false });
        }

        const storedThreshold = window.localStorage.getItem(THRESHOLD_STORAGE_KEY);
        if (storedThreshold !== null && storedThreshold !== undefined) {
            const clamped = clampThreshold(storedThreshold);
            updateAppState({ inkLoadThreshold: clamped });
        }
    } catch (error) {
        console.warn('[ink-load] preference load failed:', error);
    }
}

function persistOverlayPreference(enabled) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(OVERLAY_STORAGE_KEY, enabled ? 'true' : 'false');
        }
    } catch (error) {
        console.warn('[ink-load] overlay preference persist failed:', error);
    }
}

function persistThresholdPreference(value) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(THRESHOLD_STORAGE_KEY, String(value));
        }
    } catch (error) {
        console.warn('[ink-load] threshold persist failed:', error);
    }
}

export function getInkLoadThreshold() {
    ensurePreferencesLoaded();
    const state = getAppState();
    const numeric = clampThreshold(state.inkLoadThreshold);
    if (numeric !== state.inkLoadThreshold) {
        updateAppState({ inkLoadThreshold: numeric });
    }
    return numeric;
}

export function setInkLoadThreshold(value, { persist = true } = {}) {
    ensurePreferencesLoaded();
    const clamped = clampThreshold(value);
    updateAppState({ inkLoadThreshold: clamped });
    if (persist) {
        persistThresholdPreference(clamped);
    }
    return clamped;
}

export function setInkLoadOverlayEnabled(enabled = true) {
    ensurePreferencesLoaded();
    const next = !!enabled;
    updateAppState({ showInkLoadOverlay: next });
    persistOverlayPreference(next);
    return next;
}

export function isInkLoadOverlayEnabled() {
    ensurePreferencesLoaded();
    const state = getAppState();
    return !!state.showInkLoadOverlay;
}

function buildChannelEntries({ resolution }) {
    if (!elements.rows) {
        return [];
    }

    const rows = Array.from(elements.rows.querySelectorAll('tr.channel-row[data-channel]'));
    if (rows.length === 0) {
        return [];
    }

    const applyLinearization = !!(LinearizationState?.globalApplied && LinearizationState?.globalData);
    const entries = [];

    rows.forEach((row) => {
        const channelName = row.getAttribute('data-channel');
        if (!channelName) {
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

        if (!(percentValue > 0 || endValue > 0) || endValue <= 0) {
            return;
        }

        try {
            const normalizeToEnd = isChannelNormalizedToEnd(channelName);
            const samples = make256(endValue, channelName, applyLinearization, {
                normalizeToEnd
            }) || [];
            if (!Array.isArray(samples) || samples.length === 0) {
                return;
            }
            entries.push({
                channelName,
                endValue,
                samples: samples.slice(0, resolution)
            });
        } catch (error) {
            console.warn('[ink-load] make256 failed for', channelName, error);
        }
    });

    return entries;
}

export function computeInkLoadCurve(options = {}) {
    const resolution = Number.isInteger(options.resolution) && options.resolution > 1
        ? options.resolution
        : DEFAULT_RESOLUTION;

    ensurePreferencesLoaded();

    let entries = [];
    if (Array.isArray(options.channels) && options.channels.length > 0) {
        entries = options.channels
            .map((entry) => ({
                channelName: entry?.channelName ?? entry?.name ?? '',
                endValue: Number(entry?.endValue) || 0,
                samples: Array.isArray(entry?.samples) ? entry.samples.slice(0, resolution) : []
            }))
            .filter((entry) => entry.channelName && entry.endValue > 0 && entry.samples.length > 0);
    } else {
        entries = buildChannelEntries({ resolution });
    }

    if (entries.length === 0) {
        return null;
    }

    const curve = new Array(resolution).fill(0);
    let maxValue = 0;

    for (let i = 0; i < resolution; i += 1) {
        let totalInkPercent = 0;
        for (const entry of entries) {
            const sample = entry.samples[i] ?? 0;
            const channelPercent = (Number(sample) / TOTAL) * 100;
            if (Number.isFinite(channelPercent)) {
                totalInkPercent += channelPercent;
            }
        }

        curve[i] = totalInkPercent;
        if (totalInkPercent > maxValue) {
            maxValue = totalInkPercent;
        }
    }

    return {
        curve,
        maxValue,
        threshold: getInkLoadThreshold(),
        enabledChannels: entries.map((entry) => entry.channelName)
    };
}

registerDebugNamespace('inkLoad', {
    compute: computeInkLoadCurve,
    setEnabled: setInkLoadOverlayEnabled,
    getEnabled: isInkLoadOverlayEnabled,
    getThreshold: getInkLoadThreshold,
    setThreshold: setInkLoadThreshold
});
