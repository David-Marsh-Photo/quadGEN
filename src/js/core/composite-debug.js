// Composite LAB redistribution diagnostics
// Tracks per-snapshot solver data for tests and console inspection.

import { registerDebugNamespace } from '../utils/debug-registry.js';
import { sanitizeSnapshotFlags, cloneSnapshotFlags } from './snapshot-flags.js';

const state = {
    summary: null,
    snapshots: [],
    flags: {},
    sessionId: 0,
    lastUpdated: 0
};

let pendingAutoRaise = null;

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
        densityLadder: Array.isArray(summary.densityLadder) ? summary.densityLadder.slice() : [],
        ladderOrderIndex: summary.ladderOrderIndex && typeof summary.ladderOrderIndex === 'object'
            ? { ...summary.ladderOrderIndex }
            : {},
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
            : null
    };
    return clone;
}

function clearData() {
    state.summary = null;
    state.snapshots = [];
    state.flags = {};
    state.sessionId += 1;
    state.lastUpdated = Date.now();
    pendingAutoRaise = null;
}

export function getCompositeDebugState() {
    return {
        summary: cloneSummary(state.summary),
        snapshots: state.snapshots.map((entry) => (entry ? cloneSnapshot(entry) : null)),
        flags: cloneSnapshotFlags(state.flags),
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

export function resetCompositeDebugState() {
    clearData();
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
    state.lastUpdated = Date.now();
    state.sessionId += 1;
}

export function storeCompositeDebugSession(payload) {
    assignSessionData(payload);
}

registerDebugNamespace('compositeDebug', {
    getCompositeDebugState,
    getCompositeDebugSnapshot,
    resetCompositeDebugState,
    setCompositeAutoRaiseSummary,
    storeCompositeDebugSession,
    getFlaggedSnapshots: () => cloneSnapshotFlags(state.flags),
    sanitizeSnapshotFlags
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['getCompositeDebugState', 'getCompositeDebugSnapshot']
});
