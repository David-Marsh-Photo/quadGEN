/**
 * Global Channel Scaling Utilities
 * Handles scaling all channel endpoints by a percentage factor
 */

import { elements, getCurrentPrinter } from './state.js';
import { getStateManager } from './state-manager.js';
import { getHistoryManager } from './history-manager.js';
import { InputValidator } from './validation.js';
import { formatScalePercent } from '../ui/ui-utils.js';
import { setChartStatusMessage } from '../ui/chart-manager.js';
import { triggerInkChartUpdate, triggerPreviewUpdate, triggerSessionStatusUpdate } from '../ui/ui-hooks.js';
import { showStatus } from '../ui/status-service.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getChannelRow } from '../ui/channel-registry.js';
import { rescaleSmartCurveForInkLimit } from '../curves/smart-curves.js';
import { isChannelLocked, updateChannelLockBounds, getChannelLockInfo, getLockedChannels, getGlobalScaleLockMessage } from './channel-locks.js';
import scalingCoordinator from './scaling-coordinator.js';
import { SCALING_STATE_FLAG_EVENT, SCALING_STATE_AUDIT_EVENT } from './scaling-constants.js';

export { SCALING_STATE_FLAG_EVENT, SCALING_STATE_AUDIT_EVENT } from './scaling-constants.js';

// Global scaling state
let scaleAllPercent = 100;
let scaleBaselineEnds = null;

const MAX_SCALE_PERCENT = 1000;
let scalingStateFlag = typeof window !== 'undefined' ? !!window.__USE_SCALING_STATE : false;
let scalingComputedSelector = null;

const scalingStateAudit = {
    totalChecks: 0,
    mismatchCount: 0,
    lastMismatchDelta: 0,
    lastMismatchDetail: null,
    lastCheckTimestamp: null,
    lastCheckReason: null,
    lastExpectedMaxAllowed: null,
    lastObservedMaxAllowed: null,
    lastReason: null,
    reasonCounts: Object.create(null)
};

function ensureReasonCounts() {
    if (!scalingStateAudit.reasonCounts || typeof scalingStateAudit.reasonCounts !== 'object') {
        scalingStateAudit.reasonCounts = Object.create(null);
    }
    return scalingStateAudit.reasonCounts;
}

function recordAuditReason(reason) {
    if (!reason || typeof reason !== 'string') {
        return;
    }

    const key = reason.trim();
    if (!key) {
        return;
    }

    const bucket = ensureReasonCounts();
    const current = Number.isFinite(bucket[key]) ? bucket[key] : Number(bucket[key]) || 0;
    bucket[key] = current + 1;
    scalingStateAudit.lastReason = key;
}

function createAuditSnapshot() {
    if (typeof structuredClone === 'function') {
        try {
            const snapshot = structuredClone(scalingStateAudit);
            snapshot.lastCheckTimestampIso = snapshot.lastCheckTimestamp ? new Date(snapshot.lastCheckTimestamp).toISOString() : null;
            return snapshot;
        } catch (error) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[SCALE] structuredClone failed for audit snapshot', error);
            }
        }
    }

    try {
        const snapshot = JSON.parse(JSON.stringify(scalingStateAudit));
        snapshot.lastCheckTimestampIso = scalingStateAudit.lastCheckTimestamp ? new Date(scalingStateAudit.lastCheckTimestamp).toISOString() : null;
        return snapshot;
    } catch (error) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[SCALE] JSON snapshot failed for audit state', error);
        }
    }

    return {
        totalChecks: scalingStateAudit.totalChecks,
        mismatchCount: scalingStateAudit.mismatchCount,
        lastMismatchDelta: scalingStateAudit.lastMismatchDelta,
        lastMismatchDetail: scalingStateAudit.lastMismatchDetail ? { ...scalingStateAudit.lastMismatchDetail } : null,
        lastCheckTimestamp: scalingStateAudit.lastCheckTimestamp,
        lastCheckTimestampIso: scalingStateAudit.lastCheckTimestamp ? new Date(scalingStateAudit.lastCheckTimestamp).toISOString() : null,
        lastCheckReason: scalingStateAudit.lastCheckReason,
        lastExpectedMaxAllowed: scalingStateAudit.lastExpectedMaxAllowed,
        lastObservedMaxAllowed: scalingStateAudit.lastObservedMaxAllowed,
        lastReason: scalingStateAudit.lastReason,
        reasonCounts: { ...ensureReasonCounts() }
    };
}

function dispatchScalingAuditEvent(status, reason, payload = {}) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }

    const detail = {
        status: typeof status === 'string' ? status : null,
        reason: typeof reason === 'string' ? reason : null,
        audit: createAuditSnapshot()
    };

    if (payload && typeof payload === 'object') {
        if (Object.prototype.hasOwnProperty.call(payload, 'result')) {
            detail.result = payload.result;
        } else if (Object.keys(payload).length > 0) {
            detail.payload = payload;
        }
    }

    try {
        let event;
        if (typeof window.CustomEvent === 'function') {
            event = new window.CustomEvent(SCALING_STATE_AUDIT_EVENT, { detail });
        } else if (typeof Event === 'function') {
            event = new Event(SCALING_STATE_AUDIT_EVENT);
            try {
                Object.defineProperty(event, 'detail', {
                    configurable: true,
                    enumerable: true,
                    value: detail
                });
            } catch (defineError) {
                event.detail = detail;
            }
        }

        if (event) {
            window.dispatchEvent(event);
        }
    } catch (error) {
        console.warn('[SCALE] Failed to dispatch scaling audit event', error);
    }
}

function attachScalingAuditToWindow() {
    if (typeof window === 'undefined') {
        return;
    }
    window.scalingStateAudit = scalingStateAudit;
}

export function resetScalingStateAudit(reason = 'reset') {
    scalingStateAudit.totalChecks = 0;
    scalingStateAudit.mismatchCount = 0;
    scalingStateAudit.lastMismatchDelta = 0;
    scalingStateAudit.lastMismatchDetail = null;
    scalingStateAudit.lastCheckTimestamp = null;
    scalingStateAudit.lastCheckReason = reason || null;
    scalingStateAudit.lastExpectedMaxAllowed = null;
    scalingStateAudit.lastObservedMaxAllowed = null;
    scalingStateAudit.lastReason = null;
    scalingStateAudit.reasonCounts = Object.create(null);

    dispatchScalingAuditEvent('reset', reason || null);
}

function canonicalizeBaselines(baselines) {
    if (!baselines || typeof baselines !== 'object') {
        return {};
    }

    const normalized = {};
    for (const [channelName, value] of Object.entries(baselines)) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            continue;
        }
        normalized[channelName] = Math.round(numeric);
    }
    return normalized;
}

function diffBaselines(legacyBaselines, stateBaselines) {
    const legacyMap = canonicalizeBaselines(legacyBaselines);
    const stateMap = canonicalizeBaselines(stateBaselines);
    const allKeys = new Set([...Object.keys(legacyMap), ...Object.keys(stateMap)]);
    const diffs = [];

    for (const key of allKeys) {
        const legacyValue = Object.prototype.hasOwnProperty.call(legacyMap, key) ? legacyMap[key] : null;
        const stateValue = Object.prototype.hasOwnProperty.call(stateMap, key) ? stateMap[key] : null;
        if (legacyValue !== stateValue) {
            diffs.push({
                channel: key,
                legacy: legacyValue,
                state: stateValue
            });
        }
    }

    return diffs;
}

function resolveBaselinesSnapshot(baselines) {
    const normalized = canonicalizeBaselines(baselines);
    return Object.keys(normalized).length > 0 ? normalized : null;
}

attachScalingAuditToWindow();

export function getScalingStateAudit() {
    ensureReasonCounts();
    return scalingStateAudit;
}

export function dumpScalingStateAudit() {
    const snapshot = {
        ...scalingStateAudit,
        lastCheckTimestampIso: scalingStateAudit.lastCheckTimestamp ? new Date(scalingStateAudit.lastCheckTimestamp).toISOString() : null,
        reasonCounts: { ...ensureReasonCounts() }
    };

    if (typeof console !== 'undefined' && typeof console.table === 'function') {
        console.table([snapshot]);
    } else {
        console.log('[ScalingStateAudit]', snapshot);
    }

    return snapshot;
}

export function validateScalingStateSync(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const reason = typeof opts.reason === 'string' && opts.reason.trim() ? opts.reason : null;
    const throwOnMismatch = opts.throwOnMismatch !== false;

    recordAuditReason(reason || 'parity-check');

    if (!scalingStateFlag) {
        const result = { ok: true, skipped: true };
        dispatchScalingAuditEvent('disabled', reason || 'flag-disabled', { result });
        return result;
    }

    const now = Date.now();
    scalingStateAudit.totalChecks += 1;
    scalingStateAudit.lastCheckTimestamp = now;
    scalingStateAudit.lastCheckReason = reason;

    const stateManager = ensureStateManagerInstance();
    if (!stateManager) {
        scalingStateAudit.mismatchCount += 1;
        scalingStateAudit.lastMismatchDelta = Number.NaN;
        scalingStateAudit.lastMismatchDetail = { reason: 'stateManagerUnavailable' };

        const result = { ok: false, reason: 'stateManagerUnavailable' };
        dispatchScalingAuditEvent('error', 'stateManagerUnavailable', { result });

        if (throwOnMismatch) {
            const error = new Error('Scaling state mismatch detected');
            error.details = scalingStateAudit.lastMismatchDetail;
            throw error;
        }
        return result;
    }

    const statePercentRaw = Number(stateManager.get('scaling.globalPercent'));
    const statePercent = Number.isFinite(statePercentRaw) ? statePercentRaw : 0;
    const legacyPercent = Number.isFinite(scaleAllPercent) ? scaleAllPercent : 0;
    const percentDelta = Math.abs(statePercent - legacyPercent);

    const stateBaselines = stateManager.get('scaling.baselines');
    const legacyBaselines = scaleBaselineEnds ? { ...scaleBaselineEnds } : null;
    const baselineDiffs = diffBaselines(legacyBaselines, stateBaselines);

    const stateMaxAllowedRaw = Number(stateManager.get('scaling.maxAllowed'));
    const expectedMaxAllowed = computeMaxAllowedFromBaselines(legacyBaselines);
    const stateMaxAllowed = Number.isFinite(stateMaxAllowedRaw) ? stateMaxAllowedRaw : expectedMaxAllowed;
    const maxAllowedDelta = Math.abs(stateMaxAllowed - expectedMaxAllowed);

    scalingStateAudit.lastExpectedMaxAllowed = expectedMaxAllowed;
    scalingStateAudit.lastObservedMaxAllowed = stateMaxAllowed;

    const hasPercentMismatch = percentDelta > 0.01;
    const hasBaselineMismatch = baselineDiffs.length > 0;
    const hasMaxMismatch = maxAllowedDelta > 1;
    const mismatch = hasPercentMismatch || hasBaselineMismatch || hasMaxMismatch;

    if (mismatch) {
        scalingStateAudit.mismatchCount += 1;
        scalingStateAudit.lastMismatchDelta = percentDelta;
        scalingStateAudit.lastMismatchDetail = {
            reason: reason || 'parity-check',
            percent: { legacy: legacyPercent, state: statePercent, delta: percentDelta },
            baselines: baselineDiffs,
            expectedMaxAllowed,
            stateMaxAllowed,
            maxAllowedDelta
        };

        const result = {
            ok: false,
            percentDelta,
            baselineDiffs,
            expectedMaxAllowed,
            stateMaxAllowed,
            maxAllowedDelta
        };

        const detailReason = (scalingStateAudit.lastMismatchDetail && scalingStateAudit.lastMismatchDetail.reason) || reason || 'parity-check';
        dispatchScalingAuditEvent('mismatch', detailReason, { result });

        if (throwOnMismatch) {
            const error = new Error('Scaling state mismatch detected');
            error.details = scalingStateAudit.lastMismatchDetail;
            throw error;
        }

        return result;
    }

    scalingStateAudit.lastMismatchDelta = 0;
    scalingStateAudit.lastMismatchDetail = null;

    const result = {
        ok: true,
        percentDelta,
        expectedMaxAllowed,
        stateMaxAllowed
    };

    dispatchScalingAuditEvent('ok', reason || 'parity-check', { result });

    return result;
}

export function getLegacyScalingSnapshot() {
    const percent = Number.isFinite(scaleAllPercent) ? scaleAllPercent : 100;
    const legacyBaselines = resolveBaselinesSnapshot(scaleBaselineEnds);
    const maxAllowed = computeMaxAllowedFromBaselines(legacyBaselines);

    if (!scalingStateFlag) {
        return {
            percent,
            baselines: legacyBaselines,
            maxAllowed,
            statePercent: null,
            stateBaselines: null,
            stateMaxAllowed: null,
            parity: {
                status: 'state-disabled',
                percentDelta: 0,
                baselineDiffs: [],
                maxAllowedDelta: 0
            }
        };
    }

    const stateManager = ensureStateManagerInstance();
    if (!stateManager) {
        return {
            percent,
            baselines: legacyBaselines,
            maxAllowed,
            statePercent: null,
            stateBaselines: null,
            stateMaxAllowed: null,
            parity: {
                status: 'state-unavailable',
                percentDelta: null,
                baselineDiffs: [],
                maxAllowedDelta: null
            }
        };
    }

    const statePercentRaw = Number(stateManager.get('scaling.globalPercent'));
    const statePercent = Number.isFinite(statePercentRaw) ? statePercentRaw : null;
    const rawStateBaselines = stateManager.get('scaling.baselines');
    const stateBaselines = resolveBaselinesSnapshot(rawStateBaselines);
    const stateMaxAllowedRaw = Number(stateManager.get('scaling.maxAllowed'));
    const stateMaxAllowed = Number.isFinite(stateMaxAllowedRaw) ? stateMaxAllowedRaw : null;

    const baselineDiffs = diffBaselines(legacyBaselines, stateBaselines);
    const percentDelta = statePercent == null ? null : Math.abs(statePercent - percent);
    const maxAllowedDelta = stateMaxAllowed == null ? null : Math.abs(stateMaxAllowed - maxAllowed);

    let status = 'ok';
    if (statePercent == null || rawStateBaselines === undefined || stateMaxAllowed == null) {
        status = 'state-partial';
    }

    if ((percentDelta ?? 0) > 0.01 || baselineDiffs.length > 0 || (maxAllowedDelta ?? 0) > 1) {
        status = 'mismatch';
    }

    return {
        percent,
        baselines: legacyBaselines,
        maxAllowed,
        statePercent,
        stateBaselines,
        stateMaxAllowed,
        parity: {
            status,
            percentDelta: percentDelta ?? 0,
            baselineDiffs,
            maxAllowedDelta: maxAllowedDelta ?? 0
        }
    };
}

export function restoreLegacyScalingState(snapshot) {
    const baselines = snapshot && typeof snapshot === 'object' ? resolveBaselinesSnapshot(snapshot.baselines) : null;
    scaleBaselineEnds = baselines ? { ...baselines } : null;

    if (!scalingStateFlag) {
        return;
    }

    const percent = Number.isFinite(snapshot?.statePercent)
        ? snapshot.statePercent
        : (Number.isFinite(snapshot?.percent) ? snapshot.percent : scaleAllPercent);

    updateScalingState({
        percent,
        baselines: baselines ? { ...baselines } : null,
        maxAllowed: computeMaxAllowedFromBaselines(baselines)
    });
}

function dispatchScalingStateFlagEvent(enabled) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }

    try {
        let event;
        if (typeof window.CustomEvent === 'function') {
            event = new window.CustomEvent(SCALING_STATE_FLAG_EVENT, { detail: { enabled } });
        } else if (typeof Event === 'function') {
            event = new Event(SCALING_STATE_FLAG_EVENT);
            try {
                Object.defineProperty(event, 'detail', {
                    configurable: true,
                    enumerable: true,
                    value: { enabled }
                });
            } catch (defineError) {
                event.detail = { enabled };
            }
        }

        if (event) {
            window.dispatchEvent(event);
        }
    } catch (error) {
        console.warn('[SCALE] Failed to dispatch scaling state event', error);
    }
}

function ensureStateManagerInstance() {
    try {
        return getStateManager();
    } catch (error) {
        console.warn('[SCALE] Unable to access state manager:', error);
        return null;
    }
}

function ensureScalingComputedSelector(stateManager) {
    if (!stateManager) return null;
    if (!scalingComputedSelector) {
        scalingComputedSelector = stateManager.createSelector('scaling.globalPercent', (value) => Math.abs((value || 0) - 100) > 1e-6);
    }
    return scalingComputedSelector;
}

function computeMaxAllowedFromBaselines(baselines) {
    if (!baselines || typeof baselines !== 'object') {
        return MAX_SCALE_PERCENT;
    }

    let maxAllowed = MAX_SCALE_PERCENT;
    for (const channelName of Object.keys(baselines)) {
        const baseEnd = Number(baselines[channelName]);
        if (!Number.isFinite(baseEnd) || baseEnd <= 0) {
            continue;
        }
        const channelMax = Math.floor((65535 / baseEnd) * 100);
        maxAllowed = Math.min(maxAllowed, Number.isFinite(channelMax) ? channelMax : MAX_SCALE_PERCENT);
    }
    return maxAllowed;
}

function numbersRoughlyEqual(a, b, tolerance = 1e-6) {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= tolerance;
}

function baselinesEqual(current, next) {
    if (current === next) return true;
    if (!current || !next) return !current && !next;

    const currentKeys = Object.keys(current);
    const nextKeys = Object.keys(next);
    if (currentKeys.length !== nextKeys.length) return false;

    for (const key of currentKeys) {
        if (!(key in next)) return false;
        const currentVal = Number(current[key]);
        const nextVal = Number(next[key]);
        if (!numbersRoughlyEqual(currentVal, nextVal, 0.5)) {
            return false;
        }
    }

    return true;
}

function updateScalingState(partial) {
    if (!scalingStateFlag) return false;
    const stateManager = ensureStateManagerInstance();
    if (!stateManager) return false;

    const selector = ensureScalingComputedSelector(stateManager);
    let stateChanged = false;

    stateManager.batch(() => {
        if (partial.percent !== undefined) {
            const currentPercent = stateManager.get('scaling.globalPercent');
            if (!numbersRoughlyEqual(currentPercent, partial.percent)) {
                stateManager.set('scaling.globalPercent', partial.percent, { skipHistory: true });
                stateChanged = true;
            }
        }

        if (partial.baselines !== undefined) {
            const currentBaselines = stateManager.get('scaling.baselines');
            const nextBaselines = partial.baselines ? { ...partial.baselines } : null;
            if (!baselinesEqual(currentBaselines, nextBaselines)) {
                stateManager.set('scaling.baselines', nextBaselines, { skipHistory: true });
                stateChanged = true;
            }
        }

        if (partial.maxAllowed !== undefined) {
            const currentMaxAllowed = stateManager.get('scaling.maxAllowed');
            if (!numbersRoughlyEqual(currentMaxAllowed, partial.maxAllowed, 1e-3)) {
                stateManager.set('scaling.maxAllowed', partial.maxAllowed, { skipHistory: true });
                stateChanged = true;
            }
        }

        if (selector) {
            const currentComputed = stateManager.get('computed.scaling.isActive');
            const nextComputed = selector();
            if (currentComputed !== nextComputed) {
                stateManager.set('computed.scaling.isActive', nextComputed, { skipHistory: true });
                stateChanged = true;
            }
        }
    }, { skipHistory: true });

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[SCALE STATE] updateScalingState', {
            partial,
            stateChanged,
            snapshot: {
                percent: stateManager.get('scaling.globalPercent'),
                baselines: stateManager.get('scaling.baselines'),
                maxAllowed: stateManager.get('scaling.maxAllowed')
            }
        });
    }

    return stateChanged;
}

export function setScalingStateEnabled(enabled) {
    scalingStateFlag = !!enabled;
    if (typeof window !== 'undefined') {
        window.__USE_SCALING_STATE = scalingStateFlag;
    }

    resetScalingStateAudit(scalingStateFlag ? 'enable' : 'disable');
    attachScalingAuditToWindow();

    if (!scalingStateFlag) {
        scalingComputedSelector = null;
        dispatchScalingStateFlagEvent(false);
        validateScalingStateSync({ reason: 'flag:disable', throwOnMismatch: false });
        return;
    }

    scalingComputedSelector = null;
    const baselinesForState = scaleBaselineEnds ? { ...scaleBaselineEnds } : null;
    updateScalingState({
        percent: scaleAllPercent,
        baselines: baselinesForState,
        maxAllowed: computeMaxAllowedFromBaselines(baselinesForState)
    });
    validateScalingStateSync({ reason: 'flag:enable', throwOnMismatch: false });
    dispatchScalingStateFlagEvent(true);
}


/**
 * Update scale baseline for a specific channel
 * @param {string} channelName - Channel name
 */
export function updateScaleBaselineForChannel(channelName) {
    if (Math.abs(scaleAllPercent - 100) < 1e-6) {
        scaleBaselineEnds = null;
        if (scalingStateFlag) {
            updateScalingState({ baselines: null, maxAllowed: MAX_SCALE_PERCENT });
        }
        return;
    }

    if (!scaleBaselineEnds) scaleBaselineEnds = {};

    const row = getChannelRow(channelName);
    if (!row) return;

    const endInput = row.querySelector('.end-input');
    if (!endInput) return;

    const currentEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
    const factor = Math.max(0.0001, scaleAllPercent / 100 || 1);
    const base = InputValidator.clampEnd(Math.round(currentEnd / factor));

    scaleBaselineEnds[channelName] = base;

    if (scalingStateFlag) {
        const baselinesForState = { ...scaleBaselineEnds };
        updateScalingState({
            baselines: baselinesForState,
            maxAllowed: computeMaxAllowedFromBaselines(baselinesForState)
        });
    }
}

/**
 * Scale channel endpoints by percentage
 * @param {number} percent - Scale percentage (100 = no change)
 * @returns {Object} Result object with success/message/details
 */
export function scaleChannelEndsByPercent(percent, options = {}) {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const skipHistory = !!opts.skipHistory;

    console.log(`🔍 [SCALE CORE DEBUG] scaleChannelEndsByPercent called:`, {
        percent,
        timestamp: Date.now(),
        currentScaleAllPercent: scaleAllPercent,
        scaleBaselineEnds: scaleBaselineEnds,
        callStack: new Error().stack.split('\n').slice(1, 3)
    });

    try {
        const rawPercent = Number(percent);
        console.log(`🔍 [SCALE CORE DEBUG] Raw percent validation:`, { percent, rawPercent, isFinite: Number.isFinite(rawPercent), isPositive: rawPercent > 0 });

        if (!Number.isFinite(rawPercent) || rawPercent <= 0) {
            console.log(`🔍 [SCALE CORE DEBUG] Invalid percent - returning error`);
            return {
                success: false,
                message: `Invalid scale '${percent}'. Enter a positive percent value.`
            };
        }

        const requestedPercent = Math.min(MAX_SCALE_PERCENT, Math.max(0, rawPercent));
        const currentPrinter = getCurrentPrinter();

        if (!currentPrinter || !Array.isArray(currentPrinter.channels)) {
            return {
                success: false,
                message: 'No printer selected.'
            };
        }

        const lockedChannels = getLockedChannels(currentPrinter.channels);
        if (lockedChannels.length > 0) {
            return {
                success: false,
                message: getGlobalScaleLockMessage(lockedChannels),
                details: {
                    lockedChannels
                }
            };
        }

        if (!scaleBaselineEnds) scaleBaselineEnds = {};

        const previousPercent = scaleAllPercent;
        const previousFactor = Math.max(0.0001, previousPercent / 100 || 1);
        const baselineMap = {};
        const stateManager = getStateManager();
        const history = getHistoryManager();
        const batchActions = [];
        let maxAllowedPercent = MAX_SCALE_PERCENT;

        // Calculate baselines and maximum allowed scaling
        for (const channelName of currentPrinter.channels) {
            const row = getChannelRow(channelName);
            if (!row) continue;

            if (isChannelLocked(channelName)) {
                const lockInfo = getChannelLockInfo(channelName);
                const lockLimitPercent = Number.isFinite(lockInfo.percentLimit) ? lockInfo.percentLimit : 100;
                maxAllowedPercent = Math.min(maxAllowedPercent, lockLimitPercent);
                if (scaleBaselineEnds && Object.prototype.hasOwnProperty.call(scaleBaselineEnds, channelName)) {
                    delete scaleBaselineEnds[channelName];
                }
                continue;
            }

            const endInput = row.querySelector('.end-input');
            if (!endInput) continue;

            const currentEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
            if (currentEnd <= 0) continue;

            let baseEnd;
            if (scaleBaselineEnds[channelName] != null) {
                baseEnd = InputValidator.clampEnd(scaleBaselineEnds[channelName]);
                // Additional guards when baseline already exists (from legacy system)
                if (previousFactor > 1.000001 && currentEnd >= 65535 && baseEnd > currentEnd) {
                    baseEnd = currentEnd;
                } else if (previousFactor < 0.999999 && currentEnd <= 0 && baseEnd < currentEnd) {
                    baseEnd = currentEnd;
                }
            } else {
                const computedBase = InputValidator.clampEnd(Math.round(currentEnd / previousFactor));
                // Add double-scaling protection guards from legacy system
                const guardingMax = (previousFactor > 1.000001 && currentEnd >= 65535 && computedBase < currentEnd);
                const guardingMin = (previousFactor < 0.999999 && currentEnd <= 0 && computedBase > currentEnd);
                baseEnd = guardingMax || guardingMin ? currentEnd : computedBase;
                scaleBaselineEnds[channelName] = baseEnd;
            }

            baselineMap[channelName] = baseEnd;

            if (baseEnd > 0) {
                const maxPercentForChannel = Math.floor((65535 / baseEnd) * 100);
                maxAllowedPercent = Math.min(maxAllowedPercent, maxPercentForChannel);
            }
        }

        const appliedPercent = Math.min(requestedPercent, maxAllowedPercent);
        const newFactor = Math.max(0.0001, appliedPercent / 100);
        const updates = [];

        // Apply scaling to all channels
        Object.keys(baselineMap).forEach(channelName => {
            const row = getChannelRow(channelName);
            if (!row) return;

            const endInput = row.querySelector('.end-input');
            if (!endInput) return;

            const baseEnd = baselineMap[channelName];
            if (baseEnd <= 0) return;

            const previousEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
            const prevPercent = InputValidator.computePercentFromEnd(previousEnd);
            const newEnd = InputValidator.clampEnd(Math.round(baseEnd * newFactor));

            if (newEnd !== previousEnd) {
                const oldEndValue = previousEnd;
                endInput.value = newEnd;
                endInput.setAttribute('data-base-end', String(newEnd));

                // Update corresponding percent input
                const newPercent = InputValidator.computePercentFromEnd(newEnd);
                const percentInput = row.querySelector('.percent-input');
                if (percentInput) {
                    percentInput.value = Number(newPercent.toFixed(1)).toString();
                    percentInput.setAttribute('data-base-percent', String(newPercent));
                    InputValidator.clearValidationStyling(percentInput);
                }

                const rescaled = rescaleSmartCurveForInkLimit(channelName, prevPercent, newPercent, {
                    mode: 'preserveRelative',
                    historyExtras: { triggeredBy: 'globalScale' }
                });
                updates.push({ channelName, row, newEnd, baseEnd, rescaled });

                stateManager.set(`printer.channelValues.${channelName}.percentage`, newPercent, { skipHistory: true });
                batchActions.push({
                    channelName,
                    type: 'percentage',
                    oldValue: prevPercent,
                    newValue: newPercent
                });

                InputValidator.clearValidationStyling(endInput);
                stateManager.set(`printer.channelValues.${channelName}.endValue`, newEnd, { skipHistory: true });
                batchActions.push({
                    channelName,
                    type: 'endValue',
                    oldValue: oldEndValue,
                    newValue: newEnd
                });
                updateChannelLockBounds(channelName, { percent: newPercent, endValue: newEnd });
            }
        });

        if (updates.length === 0) {
            scaleAllPercent = appliedPercent;
            if (Math.abs(scaleAllPercent - 100) < 1e-6) {
                scaleBaselineEnds = null;
                if (scalingStateFlag) {
                    updateScalingState({ percent: scaleAllPercent, baselines: null, maxAllowed: MAX_SCALE_PERCENT });
                    validateScalingStateSync({ reason: 'scaleChannelEndsByPercent:no-change' });
                } else {
                    validateScalingStateSync({ reason: 'legacy:no-change', throwOnMismatch: false });
                }
            } else if (scalingStateFlag) {
                const baselinesForState = scaleBaselineEnds ? { ...scaleBaselineEnds } : null;
                const maxAllowedForState = baselinesForState ? maxAllowedPercent : MAX_SCALE_PERCENT;
                updateScalingState({
                    percent: scaleAllPercent,
                    baselines: baselinesForState,
                    maxAllowed: maxAllowedForState
                });
                validateScalingStateSync({ reason: 'scaleChannelEndsByPercent:no-change' });
            } else {
                validateScalingStateSync({ reason: 'legacy:no-change', throwOnMismatch: false });
            }

            if (elements.scaleAllInput) {
                elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
            }

            const direction = appliedPercent > previousPercent
                ? 'already maxed at current ink limits'
                : 'already at minimum for active channels';

            clearBakedStateAfterScaling();

            return {
                success: true,
                message: `Scale unchanged — ${direction}.`,
                details: { scalePercent: scaleAllPercent }
            };
        }

        // Reset baseline cache if returning to 100%
        if (Math.abs(appliedPercent - 100) < 1e-6) {
            scaleBaselineEnds = null;
        }

        scaleAllPercent = appliedPercent;

        if (scalingStateFlag) {
            const baselinesForState = scaleBaselineEnds ? { ...scaleBaselineEnds } : null;
            const maxAllowedForState = baselinesForState ? maxAllowedPercent : MAX_SCALE_PERCENT;
            updateScalingState({
                percent: appliedPercent,
                baselines: baselinesForState,
                maxAllowed: maxAllowedForState
            });
            validateScalingStateSync({ reason: 'scaleChannelEndsByPercent:applied' });
        } else {
            validateScalingStateSync({ reason: 'legacy:apply', throwOnMismatch: false });
        }

        if (elements.scaleAllInput) {
            elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
        }

        if (!skipHistory && history && batchActions.length > 0) {
            history.recordBatchAction(`Scale channels to ${formatScalePercent(appliedPercent)}%`, batchActions);
        }

        clearBakedStateAfterScaling();

        return {
            success: true,
            message: `Scaled ${updates.length} channel${updates.length === 1 ? '' : 's'} by ${appliedPercent}%`,
            details: { scalePercent: appliedPercent, updates: updates.length }
        };

    } catch (error) {
        console.error('Error in scaleChannelEndsByPercent:', error);
        return {
            success: false,
            message: `Error scaling channels: ${error.message}`
        };
    }
}

/**
 * Apply global scale with validation and UI updates
 * @param {number} rawPercent - Raw percentage input
 */
export function applyGlobalScale(rawPercent) {
    console.log(`🔍 [APPLY DEBUG] applyGlobalScale called:`, {
        rawPercent,
        timestamp: Date.now(),
        callStack: new Error().stack.split('\n').slice(1, 4)
    });

    const MIN_SCALE = 1;
    const MAX_SCALE = 1000;

    if (!elements.scaleAllInput) {
        console.log(`🔍 [APPLY DEBUG] No scaleAllInput element found`);
        return;
    }

    let parsed = parseFloat(rawPercent);
    console.log(`🔍 [APPLY DEBUG] Parsed value:`, { rawPercent, parsed });

    if (!Number.isFinite(parsed)) {
        console.warn('🔍 [APPLY DEBUG] Invalid scale value:', rawPercent);
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
        return;
    }

    const beforeClamp = parsed;
    parsed = Math.max(MIN_SCALE, Math.min(MAX_SCALE, parsed));
    console.log(`🔍 [APPLY DEBUG] After clamping:`, { beforeClamp, afterClamp: parsed });

    console.log(`🔍 [APPLY DEBUG] Calling scaleChannelEndsByPercent(${parsed})`);
    const result = scaleChannelEndsByPercent(parsed);
    console.log(`🔍 [APPLY DEBUG] scaleChannelEndsByPercent result:`, result);

    if (!result.success) {
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
        console.error('Scaling failed:', result.message);
        showStatus(result.message || 'Unable to scale channel ends');
        return;
    }

    const applied = result.details?.scalePercent ?? parsed;
    scaleAllPercent = applied;
    elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);

    if (result.message) {
        showStatus(result.message);
    }

    // Show "Preview updated" message on the chart canvas (like quadgen.html)
    setChartStatusMessage('Preview updated', 2000);

    // Trigger chart update if available
    triggerInkChartUpdate();

    // Trigger preview update to show status messages
    console.log('📊 Calling updatePreview after scaling');
    triggerPreviewUpdate();

    // Update session status after scaling
    console.log('📊 Calling updateSessionStatus after scaling');
    triggerSessionStatusUpdate();

    console.log(`✅ Global scale applied: ${formatScalePercent(applied)}%`);
}

/**
 * Reset global scaling to 100%
 */
export function resetGlobalScale() {
    scaleAllPercent = 100;
    scaleBaselineEnds = null;

    if (elements.scaleAllInput) {
        elements.scaleAllInput.value = formatScalePercent(scaleAllPercent);
    }

    if (scalingStateFlag) {
        updateScalingState({ percent: scaleAllPercent, baselines: null, maxAllowed: MAX_SCALE_PERCENT });
        validateScalingStateSync({ reason: 'resetGlobalScale', throwOnMismatch: false });
    }
}

/**
 * Get current global scale percentage
 * @returns {number} Current scale percentage
 */
export function getCurrentScale() {
    if (scalingStateFlag) {
        const stateManager = ensureStateManagerInstance();
        if (stateManager && typeof stateManager.get === 'function') {
            const statePercent = Number(stateManager.get('scaling.globalPercent'));
            if (Number.isFinite(statePercent) && statePercent > 0) {
                return statePercent;
            }
        }
    }

    return scaleAllPercent;
}

/**
 * Reapply the active global scale to the current channel endpoints.
 * Useful after operations that overwrite curve data (e.g., measurement loads or reverts).
 */
export function reapplyCurrentGlobalScale(options = {}) {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const { percent: overridePercent, ...rest } = opts;

    const currentPercent = Number.isFinite(overridePercent)
        ? Number(overridePercent)
        : Number(scaleAllPercent);

    const effectivePercent = Number.isFinite(currentPercent) && currentPercent > 0
        ? currentPercent
        : 100;

    return scaleChannelEndsByPercent(effectivePercent, {
        skipHistory: true,
        ...rest
    });
}

function queueCoordinatorScale(rawPercent, requestedBy, options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};
    const { priority: requestedPriority, ...optionMetadata } = opts;
    const priority = typeof requestedPriority === 'string' ? requestedPriority : 'normal';

    return scalingCoordinator.scale(rawPercent, 'compat-window', {
        priority,
        metadata: {
            requestedBy,
            bridge: 'scaling-utils-window',
            options: optionMetadata
        }
    });
}

function applyGlobalScaleBridge(rawPercent, options) {
    return queueCoordinatorScale(rawPercent, 'window.applyGlobalScale', options);
}

function scaleChannelEndsByPercentBridge(rawPercent, options) {
    return queueCoordinatorScale(rawPercent, 'window.scaleChannelEndsByPercent', options);
}

registerDebugNamespace('scalingUtils', {
    applyGlobalScale: applyGlobalScaleBridge,
    scaleChannelEndsByPercent: scaleChannelEndsByPercentBridge,
    reapplyCurrentGlobalScale,
    updateScaleBaselineForChannel,
    resetGlobalScale,
    getCurrentScale,
    legacyApplyGlobalScale: applyGlobalScale,
    legacyScaleChannelEndsByPercent: scaleChannelEndsByPercent,
    setScalingStateEnabled,
    validateScalingStateSync,
    getScalingStateAudit,
    dumpScalingStateAudit,
    resetScalingStateAudit,
    getLegacyScalingSnapshot,
    restoreLegacyScalingState
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: [
        'applyGlobalScale',
        'scaleChannelEndsByPercent',
        'reapplyCurrentGlobalScale',
        'updateScaleBaselineForChannel',
        'resetGlobalScale',
        'getCurrentScale',
        'legacyApplyGlobalScale',
        'legacyScaleChannelEndsByPercent',
        'setScalingStateEnabled',
        'validateScalingStateSync',
        'getScalingStateAudit',
        'dumpScalingStateAudit',
        'resetScalingStateAudit',
        'getLegacyScalingSnapshot',
        'restoreLegacyScalingState'
    ]
});

if (typeof window !== 'undefined' && typeof window.setScalingStateEnabled !== 'function') {
    window.setScalingStateEnabled = setScalingStateEnabled;
}
function clearBakedStateAfterScaling() {
    const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    const clearFn = scope && typeof scope.setGlobalBakedState === 'function'
        ? scope.setGlobalBakedState
        : null;
    if (!clearFn) return;
    try {
        clearFn.call(scope, null, { skipHistory: true });
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[SCALE] Failed to clear baked state after scaling:', error);
        }
    }
}
