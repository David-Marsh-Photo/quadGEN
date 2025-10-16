// Composite LAB redistribution debug state
// Tracks per-snapshot diagnostics for the composite solver so the UI can surface them.

import { registerDebugNamespace } from '../utils/debug-registry.js';
import { sanitizeSnapshotFlags, cloneSnapshotFlags } from './snapshot-flags.js';

const STORAGE_KEY = 'quadgen.compositeDebugEnabled';

function readStorageEnabled() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;
        return raw === 'true';
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[CompositeDebug] Failed to read storage flag:', error);
        }
        return null;
    }
}

function writeStorageEnabled(enabled) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[CompositeDebug] Failed to persist storage flag:', error);
        }
    }
}

const state = {
    enabled: false,
    summary: null,
    snapshots: [],
    flags: {},
    selection: { index: null, percent: null },
    sessionId: 0,
    lastUpdated: 0
};

const listeners = new Set();
let pendingAutoRaise = null;
let cachedSession = null;

function shallowClone(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }
    return { ...obj };
}

function sanitizeAutoRaiseEntries(entries = []) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
            channel: typeof entry.channel === 'string' ? entry.channel : (typeof entry.channelName === 'string' ? entry.channelName : null),
            previousPercent: Number.isFinite(entry.previousPercent) ? entry.previousPercent : null,
            newPercent: Number.isFinite(entry.newPercent) ? entry.newPercent : null,
            desiredPercent: Number.isFinite(entry.desiredPercent) ? entry.desiredPercent : null,
            locked: entry.locked === true,
            currentPercent: Number.isFinite(entry.currentPercent) ? entry.currentPercent : null,
            reason: typeof entry.reason === 'string' ? entry.reason : null,
            coverage: entry.coverage && typeof entry.coverage === 'object'
                ? {
                    limit: Number.isFinite(entry.coverage.limit) ? entry.coverage.limit : null,
                    bufferedLimit: Number.isFinite(entry.coverage.bufferedLimit) ? entry.coverage.bufferedLimit : null,
                    maxNormalized: Number.isFinite(entry.coverage.maxNormalized) ? entry.coverage.maxNormalized : null,
                    headroom: Number.isFinite(entry.coverage.headroom) ? entry.coverage.headroom : null
                }
                : null
        }));
}

function applyPendingAutoRaiseToState() {
    if (!pendingAutoRaise) {
        return;
    }
    state.summary = state.summary ? { ...state.summary } : {};
    state.summary.autoRaisedEnds = sanitizeAutoRaiseEntries(pendingAutoRaise.entries);
    state.summary.autoRaiseContext = pendingAutoRaise.context ? { ...pendingAutoRaise.context } : null;
}

export function setCompositeAutoRaiseSummary(entries, metadata = {}) {
    pendingAutoRaise = {
        entries: sanitizeAutoRaiseEntries(entries),
        context: metadata && typeof metadata === 'object' ? { ...metadata } : null
    };
    applyPendingAutoRaiseToState();
    state.lastUpdated = Date.now();
    notifyListeners();
    return getCompositeDebugState();
}

function cloneSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }
    const perChannel = {};
    if (snapshot.perChannel && typeof snapshot.perChannel === 'object') {
        Object.entries(snapshot.perChannel).forEach(([name, entry]) => {
            perChannel[name] = entry && typeof entry === 'object' ? { ...entry } : {};
        });
    }
    const smoothingWindows = Array.isArray(snapshot.smoothingWindows)
        ? snapshot.smoothingWindows.map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            return {
                id: entry.id ?? null,
                outgoingChannel: entry.outgoingChannel ?? null,
                incomingChannels: Array.isArray(entry.incomingChannels) ? entry.incomingChannels.slice() : [],
                position: entry.position ?? entry.t ?? null,
                outFactor: entry.outFactor ?? null,
                forced: entry.forced === true
            };
        }).filter(Boolean)
        : [];
    return {
        index: snapshot.index ?? null,
        inputPercent: snapshot.inputPercent ?? null,
        targetDensity: snapshot.targetDensity ?? null,
        measurementDensity: snapshot.measurementDensity ?? null,
        deltaDensity: snapshot.deltaDensity ?? null,
        baselineInk: snapshot.baselineInk ?? null,
        correctedInk: snapshot.correctedInk ?? null,
        inkDelta: snapshot.inkDelta ?? null,
        perChannel,
        weightingMode: snapshot.weightingMode ?? null,
        smoothingWindows,
        ladderSelection: Array.isArray(snapshot.ladderSelection)
            ? snapshot.ladderSelection.map((entry) => ({
                channel: typeof entry?.channel === 'string' ? entry.channel : null,
                ladderIndex: Number.isFinite(entry?.ladderIndex) ? entry.ladderIndex : null,
                normalizedApplied: Number.isFinite(entry?.normalizedApplied) ? entry.normalizedApplied : 0
            }))
            : [],
        ladderBlocked: Array.isArray(snapshot.ladderBlocked)
            ? snapshot.ladderBlocked.map((entry) => ({
                channel: typeof entry?.channel === 'string' ? entry.channel : null,
                reason: typeof entry?.reason === 'string' ? entry.reason : null,
                blockedBy: typeof entry?.blockedBy === 'string' ? entry.blockedBy : null,
                headroom: Number.isFinite(entry?.headroom) ? entry.headroom : null,
                usage: Number.isFinite(entry?.usage) ? entry.usage : null
            }))
            : [],
        ladderDirection: typeof snapshot.ladderDirection === 'string' ? snapshot.ladderDirection : null,
        ladderTrace: snapshot.ladderTrace && typeof snapshot.ladderTrace === 'object'
            ? {
                direction: typeof snapshot.ladderTrace.direction === 'string' ? snapshot.ladderTrace.direction : null,
                remaining: Number.isFinite(snapshot.ladderTrace.remaining) ? snapshot.ladderTrace.remaining : null,
                blocked: Array.isArray(snapshot.ladderTrace.blocked)
                    ? snapshot.ladderTrace.blocked.map((entry) => ({
                        channel: typeof entry?.channel === 'string' ? entry.channel : null,
                        reason: typeof entry?.reason === 'string' ? entry.reason : null,
                        blockedBy: typeof entry?.blockedBy === 'string' ? entry.blockedBy : null,
                        headroom: Number.isFinite(entry?.headroom) ? entry.headroom : null,
                        usage: Number.isFinite(entry?.usage) ? entry.usage : null
                    }))
                    : [],
                sequence: Array.isArray(snapshot.ladderTrace.sequence)
                    ? snapshot.ladderTrace.sequence.map((entry) => ({
                        channel: typeof entry?.channel === 'string' ? entry.channel : null,
                        ladderIndex: Number.isFinite(entry?.ladderIndex) ? entry.ladderIndex : null,
                        normalizedApplied: Number.isFinite(entry?.normalizedApplied) ? entry.normalizedApplied : null,
                        iteration: Number.isFinite(entry?.iteration) ? entry.iteration : null,
                        weight: Number.isFinite(entry?.weight) ? entry.weight : null
                    }))
                    : []
            }
            : null
    };
}

function cloneSummary(summary) {
    if (!summary || typeof summary !== 'object') {
        return null;
    }
    const clone = {
        channelNames: Array.isArray(summary.channelNames) ? summary.channelNames.slice() : [],
        channelMaxima: summary.channelMaxima ? { ...summary.channelMaxima } : {},
        densityWeights: summary.densityWeights ? { ...summary.densityWeights } : {},
        densityConstants: summary.densityConstants ? { ...summary.densityConstants } : {},
        cumulativeDensity: summary.cumulativeDensity ? { ...summary.cumulativeDensity } : {},
        totalDensity: Number.isFinite(summary.totalDensity) ? summary.totalDensity : null,
        measurementSamples: Array.isArray(summary.measurementSamples) ? summary.measurementSamples.slice() : null,
        measurementDeltas: Array.isArray(summary.measurementDeltas) ? summary.measurementDeltas.slice() : null,
        densityInputs: Array.isArray(summary.densityInputs) ? summary.densityInputs.slice() : null,
        coverageSummary: summary.coverageSummary && typeof summary.coverageSummary === 'object'
            ? Object.keys(summary.coverageSummary).reduce((acc, key) => {
                const entry = summary.coverageSummary[key];
                acc[key] = entry && typeof entry === 'object' ? { ...entry } : null;
                return acc;
            }, {})
            : {},
        coverageLimits: summary.coverageLimits ? { ...summary.coverageLimits } : {},
        coverageBuffers: summary.coverageBuffers ? { ...summary.coverageBuffers } : {},
        warnings: Array.isArray(summary.warnings) ? summary.warnings.slice() : [],
        peakIndices: summary.peakIndices ? { ...summary.peakIndices } : null,
        weightingMode: summary.weightingMode || null,
        densityLadder: Array.isArray(summary.densityLadder) ? summary.densityLadder.slice() : [],
        ladderOrderIndex: summary.ladderOrderIndex && typeof summary.ladderOrderIndex === 'object'
            ? { ...summary.ladderOrderIndex }
            : {},
        momentumPeaks: summary.momentumPeaks ? { ...summary.momentumPeaks } : null,
        momentumWindow: Number.isFinite(summary.momentumWindow) ? summary.momentumWindow : null,
        momentumSigma: Number.isFinite(summary.momentumSigma) ? summary.momentumSigma : null,
        smoothingWindows: Array.isArray(summary.smoothingWindows)
            ? summary.smoothingWindows.map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }
                return {
                    id: entry.id ?? null,
                    outgoingChannel: entry.outgoingChannel ?? null,
                    incomingChannels: Array.isArray(entry.incomingChannels) ? entry.incomingChannels.slice() : [],
                    startIndex: entry.startIndex ?? null,
                    endIndex: entry.endIndex ?? null,
                    inputStart: entry.inputStart ?? null,
                    inputEnd: entry.inputEnd ?? null,
                    forced: entry.forced === true
                };
            }).filter(Boolean)
            : [],
        smoothingConfig: summary.smoothingConfig ? { ...summary.smoothingConfig } : null,
        autoRaisedEnds: Array.isArray(summary.autoRaisedEnds)
            ? summary.autoRaisedEnds.map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }
                return {
                    channel: entry.channel ?? entry.channelName ?? null,
                    previousPercent: Number.isFinite(entry.previousPercent) ? entry.previousPercent : null,
                    newPercent: Number.isFinite(entry.newPercent) ? entry.newPercent : null,
                    desiredPercent: Number.isFinite(entry.desiredPercent) ? entry.desiredPercent : null,
                    locked: entry.locked === true,
                    currentPercent: Number.isFinite(entry.currentPercent) ? entry.currentPercent : null,
                    reason: typeof entry.reason === 'string' ? entry.reason : null,
                    coverage: entry.coverage && typeof entry.coverage === 'object'
                        ? {
                            limit: Number.isFinite(entry.coverage.limit) ? entry.coverage.limit : null,
                            bufferedLimit: Number.isFinite(entry.coverage.bufferedLimit) ? entry.coverage.bufferedLimit : null,
                            maxNormalized: Number.isFinite(entry.coverage.maxNormalized) ? entry.coverage.maxNormalized : null,
                            headroom: Number.isFinite(entry.coverage.headroom) ? entry.coverage.headroom : null
                        }
                        : null
                };
            }).filter(Boolean)
            : [],
        autoRaiseContext: summary.autoRaiseContext && typeof summary.autoRaiseContext === 'object'
            ? { ...summary.autoRaiseContext }
            : null,
        perSampleCeilingEnabled: summary.perSampleCeilingEnabled === true
    };
    return clone;
}

function clearData() {
    state.summary = null;
    state.snapshots = [];
    state.flags = {};
    state.selection = { index: null, percent: null };
    state.sessionId += 1;
    state.lastUpdated = Date.now();
    pendingAutoRaise = null;
    cachedSession = null;
}

function notifyListeners() {
    if (!listeners.size) {
        return;
    }
    const snapshot = getCompositeDebugState();
    listeners.forEach((listener) => {
        try {
            listener(snapshot);
        } catch (error) {
            console.warn('[CompositeDebug] listener failed:', error);
        }
    });
}

export function getCompositeDebugState() {
    const globalCache = typeof window !== 'undefined' && window ? window.__COMPOSITE_DEBUG_CACHE__ : null;
    const summarySource = state.summary || (cachedSession ? cachedSession.summary : null) || (globalCache ? globalCache.summary : null);
    const snapshotsSource = state.snapshots.length
        ? state.snapshots
        : (cachedSession ? cachedSession.snapshots : (globalCache ? globalCache.snapshots : []));
    const flagsSource = Object.keys(state.flags || {}).length
        ? state.flags
        : (cachedSession && cachedSession.flags ? cachedSession.flags : (globalCache ? globalCache.snapshotFlags : {}));
    return {
        enabled: state.enabled,
        summary: cloneSummary(summarySource),
        snapshots: snapshotsSource.map((entry) => (entry ? cloneSnapshot(entry) : null)),
        flags: cloneSnapshotFlags(flagsSource),
        selection: shallowClone(state.selection),
        sessionId: state.sessionId,
        lastUpdated: state.lastUpdated
    };
}

export function getCompositeDebugSnapshot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.snapshots.length) {
        return null;
    }
    const entry = state.snapshots[index];
    return entry ? cloneSnapshot(entry) : null;
}

export function subscribeCompositeDebugState(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function isCompositeDebugEnabled() {
    return !!state.enabled;
}

export function setCompositeDebugEnabled(enabled) {
    const next = !!enabled;
    if (state.enabled === next) {
        return state.enabled;
    }
    state.enabled = next;
    writeStorageEnabled(state.enabled);
    clearData();
    notifyListeners();
    return state.enabled;
}

export function resetCompositeDebugState({ keepEnabled = false } = {}) {
    if (!keepEnabled) {
        state.enabled = false;
        writeStorageEnabled(false);
    }
    clearData();
    notifyListeners();
}

function findFirstSnapshotIndex(entries) {
    if (!Array.isArray(entries)) {
        return null;
    }
    for (let index = 0; index < entries.length; index += 1) {
        if (entries[index]) {
            return index;
        }
    }
    return null;
}

function updateSelection(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.snapshots.length || !state.snapshots[index]) {
        state.selection = { index: null, percent: null };
        return;
    }
    const entry = state.snapshots[index];
    const percent = typeof entry?.inputPercent === 'number' ? entry.inputPercent : null;
    state.selection = { index, percent };
}

export function selectCompositeDebugSnapshot(index) {
    if (!state.enabled) {
        return null;
    }
    const prev = state.selection.index;
    updateSelection(index);
    if (prev !== state.selection.index) {
        state.lastUpdated = Date.now();
        notifyListeners();
    }
    return state.selection.index;
}

export function stepCompositeDebugSelection(delta) {
    if (!state.enabled || !Number.isInteger(delta)) {
        return state.selection.index;
    }
    const start = Number.isInteger(state.selection.index) ? state.selection.index : findFirstSnapshotIndex(state.snapshots);
    if (!Number.isInteger(start)) {
        return state.selection.index;
    }
    let candidate = start + delta;
    while (candidate >= 0 && candidate < state.snapshots.length) {
        if (state.snapshots[candidate]) {
            selectCompositeDebugSnapshot(candidate);
            break;
        }
        candidate += delta > 0 ? 1 : -1;
    }
    return state.selection.index;
}

function assignSessionData(payload) {
    if (!payload || typeof payload !== 'object') {
        clearData();
        return;
    }
    state.summary = cloneSummary(payload.summary);
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE DEBUG] assign summary keys', state.summary ? Object.keys(state.summary) : null, 'channelCount', Array.isArray(state.summary?.channelNames) ? state.summary.channelNames.length : null);
    }
    applyPendingAutoRaiseToState();
    state.snapshots = Array.isArray(payload.snapshots)
        ? payload.snapshots.map((entry) => (entry ? cloneSnapshot(entry) : null))
        : [];
    const rawFlags = Object.prototype.hasOwnProperty.call(payload, 'snapshotFlags')
        ? payload.snapshotFlags
        : payload.flags;
    state.flags = sanitizeSnapshotFlags(rawFlags);
    const explicitSelection = Number.isInteger(payload.selectionIndex) ? payload.selectionIndex : null;
    if (Number.isInteger(explicitSelection) && state.snapshots[explicitSelection]) {
        updateSelection(explicitSelection);
    } else {
        const first = findFirstSnapshotIndex(state.snapshots);
        if (Number.isInteger(first)) {
            updateSelection(first);
        } else {
            state.selection = { index: null, percent: null };
        }
    }
    state.lastUpdated = Date.now();
    state.sessionId += 1;
}

export function storeCompositeDebugSession(payload) {
    if (!payload || typeof payload !== 'object') {
        cachedSession = null;
        if (state.enabled) {
            clearData();
            notifyListeners();
        }
        return;
    }
    cachedSession = {
        summary: cloneSummary(payload.summary),
        snapshots: Array.isArray(payload.snapshots)
            ? payload.snapshots.map((entry) => (entry ? cloneSnapshot(entry) : null))
            : [],
        selectionIndex: Number.isInteger(payload.selectionIndex) ? payload.selectionIndex : null,
        flags: sanitizeSnapshotFlags(Object.prototype.hasOwnProperty.call(payload, 'snapshotFlags') ? payload.snapshotFlags : payload.flags)
    };
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE DEBUG] stored session cache', {
            summaryKeys: Object.keys(cachedSession.summary || {}),
            snapshotCount: cachedSession.snapshots.filter((entry) => !!entry).length
        });
    }
    if (state.enabled) {
        assignSessionData(cachedSession);
        notifyListeners();
    }
}

export function getCompositeDebugSessionCache() {
    if (!cachedSession) {
        return null;
    }
    return {
        summary: cloneSummary(cachedSession.summary),
        snapshots: cachedSession.snapshots.map((entry) => (entry ? cloneSnapshot(entry) : null)),
        selectionIndex: cachedSession.selectionIndex,
        snapshotFlags: cloneSnapshotFlags(cachedSession.flags)
    };
}

export function commitCompositeDebugSession(payload) {
    storeCompositeDebugSession(payload);
}

const storedEnabled = readStorageEnabled();
if (storedEnabled !== null) {
    state.enabled = !!storedEnabled;
}

registerDebugNamespace('compositeDebug', {
    getCompositeDebugState,
    getCompositeDebugSnapshot,
    selectCompositeDebugSnapshot,
    stepCompositeDebugSelection,
    setCompositeDebugEnabled,
    isCompositeDebugEnabled,
    resetCompositeDebugState,
    commitCompositeDebugSession,
    setCompositeAutoRaiseSummary,
    storeCompositeDebugSession,
    getCompositeDebugSessionCache,
    getFlaggedSnapshots: () => cloneSnapshotFlags(state.flags),
    sanitizeSnapshotFlags
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['getCompositeDebugState', 'getCompositeDebugSnapshot', 'selectCompositeDebugSnapshot', 'stepCompositeDebugSelection', 'setCompositeDebugEnabled', 'isCompositeDebugEnabled', 'getCompositeDebugFlaggedSnapshots']
});
