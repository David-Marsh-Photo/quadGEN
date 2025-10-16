// Auto-raise ink limits when imported corrections exceed current channel ceilings

import { isAutoRaiseInkLimitsEnabled } from './feature-flags.js';
import { ensureInkLimitForAbsoluteTarget, formatPercentDisplay } from '../curves/smart-curves.js';
import { getCurrentPrinter, getLoadedQuadData } from './state.js';
import { getStateManager } from './state-manager.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { setCompositeAutoRaiseSummary } from './composite-debug.js';

const auditState = {
    lastRun: null
};

const COVERAGE_HEADROOM_TOLERANCE = 0.005;
const COVERAGE_HANDOFF_TOLERANCE = 0.003;
const COVERAGE_TARGET_TOLERANCE = 0.01;
const COVERAGE_FLOAT_EPSILON = 1e-6;

function recordAudit(payload) {
    auditState.lastRun = {
        ...(payload || {}),
        timestamp: Date.now()
    };
    return auditState.lastRun;
}

function uniqueChannels(names = []) {
    const seen = new Set();
    const result = [];
    names.forEach((name) => {
        if (typeof name !== 'string') return;
        const trimmed = name.trim().toUpperCase();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        result.push(trimmed);
    });
    return result;
}

function resolveChannels(scope = 'global', explicitlyNamed = null) {
    if (scope === 'channel' && explicitlyNamed) {
        return uniqueChannels([explicitlyNamed]);
    }

    const names = [];
    const printer = typeof getCurrentPrinter === 'function' ? getCurrentPrinter() : null;
    if (printer && Array.isArray(printer.channels)) {
        names.push(...printer.channels);
    }

    if (!names.length && typeof document !== 'undefined') {
        document.querySelectorAll('tr[data-channel]').forEach((row) => {
            const key = row.getAttribute('data-channel');
            if (key) {
                names.push(key);
            }
        });
    }

    return uniqueChannels(names);
}

function gatherCandidateArrays(entry) {
    if (!entry || typeof entry !== 'object') {
        return [];
    }
    const arrays = [];
    const pushIfArray = (value) => {
        if (Array.isArray(value) && value.length > 0) {
            arrays.push(value);
        }
    };
    pushIfArray(entry.samples);
    pushIfArray(entry.previewSamples);
    pushIfArray(entry.originalSamples);
    pushIfArray(entry.originalData);
    return arrays;
}

function getCoverageSnapshot() {
    try {
        const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
        if (!globalScope) return null;
        if (typeof globalScope.getCompositeCoverageSummary === 'function') {
            return globalScope.getCompositeCoverageSummary();
        }
        if (globalScope.LinearizationState && typeof globalScope.LinearizationState.getCompositeCoverageSummary === 'function') {
            return globalScope.LinearizationState.getCompositeCoverageSummary();
        }
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[auto-raise] failed to read coverage summary:', error);
        }
    }
    return null;
}

function selectCoverageEntry(summary, channelName) {
    if (!summary || typeof summary !== 'object' || !channelName) {
        return null;
    }
    if (summary[channelName]) {
        return summary[channelName];
    }
    const upper = channelName.toUpperCase();
    if (summary[upper]) {
        return summary[upper];
    }
    const lower = channelName.toLowerCase();
    if (summary[lower]) {
        return summary[lower];
    }
    return null;
}

function computeCoverageHeadroom(entry) {
    if (!entry || typeof entry !== 'object') {
        return { headroom: Number.POSITIVE_INFINITY, bufferedLimit: null, maxNormalized: null, limit: null };
    }
    const bufferedLimit = Number.isFinite(entry.bufferedLimit) ? entry.bufferedLimit : (Number.isFinite(entry.limit) ? entry.limit : null);
    const maxNormalized = Number.isFinite(entry.maxNormalized) ? entry.maxNormalized : 0;
    const headroom = bufferedLimit != null ? Math.max(0, bufferedLimit - maxNormalized) : Number.POSITIVE_INFINITY;
    const limit = Number.isFinite(entry.limit) ? entry.limit : bufferedLimit;
    return { headroom, bufferedLimit, maxNormalized, limit };
}

function hasPartnerCoverage(summary, channelName, targetNormalized) {
    if (!summary || typeof summary !== 'object') {
        return false;
    }
    const keys = Object.keys(summary);
    if (!keys.length) return false;
    const target = Number.isFinite(targetNormalized) ? targetNormalized : 1;
    return keys.some((key) => {
        if (typeof key !== 'string') return false;
        if (key === channelName || key.toUpperCase() === channelName.toUpperCase()) {
            return false;
        }
        const entry = summary[key];
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const { headroom, bufferedLimit } = computeCoverageHeadroom(entry);
        if (!Number.isFinite(headroom) || headroom <= COVERAGE_HANDOFF_TOLERANCE + COVERAGE_FLOAT_EPSILON) {
            return false;
        }
        if (bufferedLimit == null) {
            return true;
        }
        return bufferedLimit + COVERAGE_TARGET_TOLERANCE + COVERAGE_FLOAT_EPSILON >= target;
    });
}

function evaluateCoverageDecision(summary, channelName, targetNormalized) {
    const target = Number.isFinite(targetNormalized) ? targetNormalized : 1;
    const entry = selectCoverageEntry(summary, channelName);
    if (!entry) {
        return {
            allowRaise: true,
            reason: 'no-coverage-data',
            entrySnapshot: null
        };
    }
    const coverageInfo = computeCoverageHeadroom(entry);
    const entrySnapshot = {
        limit: coverageInfo.limit,
        bufferedLimit: coverageInfo.bufferedLimit,
        maxNormalized: coverageInfo.maxNormalized,
        headroom: coverageInfo.headroom
    };
    if (!Number.isFinite(coverageInfo.headroom)) {
        return {
            allowRaise: true,
            reason: 'no-coverage-data',
            entrySnapshot
        };
    }
    if (coverageInfo.headroom > COVERAGE_HEADROOM_TOLERANCE + COVERAGE_FLOAT_EPSILON) {
        return {
            allowRaise: false,
            reason: 'coverage-available',
            entrySnapshot
        };
    }
    if (hasPartnerCoverage(summary, channelName, target)) {
        return {
            allowRaise: false,
            reason: 'handoff-available',
            entrySnapshot
        };
    }
    return {
        allowRaise: true,
        reason: 'coverage-exhausted',
        entrySnapshot
    };
}

export function computeAutoRaiseTargetPercent(entry) {
    const arrays = gatherCandidateArrays(entry);
    if (!arrays.length) {
        return 0;
    }

    let maxValue = 0;
    arrays.forEach((arr) => {
        arr.forEach((value) => {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) {
                maxValue = Math.max(maxValue, numeric);
            }
        });
    });

    if (!Number.isFinite(maxValue) || maxValue <= 0) {
        return 0;
    }

    if (maxValue > 100) {
        // Fall back to 100% for unexpected value ranges (e.g., 16-bit curves)
        return 100;
    }

    if (maxValue > 1.0001) {
        return Math.min(100, maxValue);
    }

    return Math.min(100, maxValue * 100);
}

export function getAutoRaiseAuditState() {
    return auditState.lastRun
        ? { ...auditState.lastRun }
        : null;
}

export function clearAutoRaiseAuditState() {
    auditState.lastRun = null;
}

export function maybeAutoRaiseInkLimits(entry, options = {}) {
    const flagEnabled = isAutoRaiseInkLimitsEnabled();
    const inBrowser = typeof document !== 'undefined';
    const context = {
        scope: options.scope === 'channel' ? 'channel' : 'global',
        channelName: options.channelName || null,
        label: options.label || 'correction',
        source: options.source || 'correction-import'
    };

    const result = {
        enabled: flagEnabled,
        inBrowser,
        adjustments: [],
        blocked: [],
        evaluated: false,
        targetPercent: 0,
        context
    };

    if (!flagEnabled || !inBrowser) {
        recordAudit(result);
        return result;
    }

    const targetPercent = computeAutoRaiseTargetPercent(entry);
    result.evaluated = true;
    result.targetPercent = targetPercent;

    if (!Number.isFinite(targetPercent) || targetPercent <= 0) {
        recordAudit(result);
        return result;
    }

    const channels = resolveChannels(context.scope, context.channelName);
    if (!channels.length) {
        recordAudit(result);
        return result;
    }

    const loadedData = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
    const baselineEndMap = loadedData?.baselineEnd || {};
    const curveMap = loadedData?.curves || {};
    let channelStateValues = {};
    try {
        const manager = typeof getStateManager === 'function' ? getStateManager() : null;
        if (manager && typeof manager.get === 'function') {
            channelStateValues = manager.get('printer.channelValues') || {};
        }
    } catch (error) {
        channelStateValues = {};
    }

    const normalizeName = (name) => (typeof name === 'string' ? name.trim().toUpperCase() : '');

    const debugEnabled = typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS;
    if (debugEnabled) {
        console.log('[auto-raise] channel state snapshot', channelStateValues);
        console.log('[auto-raise] baseline map', baselineEndMap);
    }

    const baselineActiveChannels = new Set();
    Object.entries(baselineEndMap).forEach(([name, value]) => {
        const normalized = normalizeName(name);
        const numeric = Number(value);
        if (!normalized || !Number.isFinite(numeric) || numeric <= 0) {
            return;
        }
        baselineActiveChannels.add(normalized);
    });

    const curveActiveChannels = new Set();
    Object.entries(curveMap).forEach(([name, samples]) => {
        const normalized = normalizeName(name);
        if (!normalized || !Array.isArray(samples)) {
            return;
        }
        const hasInk = samples.some((sample) => {
            const numeric = Number(sample);
            return Number.isFinite(numeric) && numeric > 0;
        });
        if (hasInk) {
            curveActiveChannels.add(normalized);
        }
    });

    const channelStateValuesNormalized = {};
    Object.entries(channelStateValues).forEach(([name, entry]) => {
        const normalized = normalizeName(name);
        if (!normalized) return;
        channelStateValuesNormalized[normalized] = entry;
    });

    const channelHasBaselineInk = (channelName) => {
        const normalized = normalizeName(channelName);
        if (!normalized) {
            return false;
        }
        if (baselineActiveChannels.has(normalized) || curveActiveChannels.has(normalized)) {
            return true;
        }
        const stateEntry = channelStateValues?.[channelName] ||
            channelStateValuesNormalized[normalized] ||
            channelStateValues?.[normalized];
        if (stateEntry && typeof stateEntry === 'object') {
            const percent = Number(stateEntry.percentage);
            const endValue = Number(stateEntry.endValue);
            if ((Number.isFinite(percent) && percent > 0) || (Number.isFinite(endValue) && endValue > 0)) {
                return true;
            }
        }
        return false;
    };

    const epsilon = Number.isFinite(options.epsilonPercent)
        ? Math.max(0, options.epsilonPercent)
        : 0.05;
    const coverageSummary = getCoverageSnapshot();
    const targetNormalized = Number.isFinite(targetPercent)
        ? Math.max(0, Math.min(1, targetPercent / 100))
        : null;
    if (coverageSummary && typeof coverageSummary === 'object') {
        result.coverageSummary = coverageSummary;
    }

    channels.forEach((channelName) => {
        const normalized = normalizeName(channelName);
        const stateEntry = channelStateValues?.[channelName] ||
            channelStateValuesNormalized[normalized] ||
            channelStateValues?.[normalized];
        const hasBaseline = channelHasBaselineInk(channelName);
        if (debugEnabled) {
            console.log('[auto-raise] channel baseline check', channelName, {
                hasBaseline,
                baseline: Number(baselineEndMap?.[channelName]) || 0,
                statePercent: Number(stateEntry?.percentage) || 0,
                stateEnd: Number(stateEntry?.endValue) || 0
            });
        }
        if (!hasBaseline) {
            const currentPercent = stateEntry && Number.isFinite(Number(stateEntry.percentage))
                ? Number(stateEntry.percentage)
                : 0;
            if (debugEnabled) {
                console.log('[auto-raise] skip disabled channel', channelName, {
                    currentPercent,
                    baseline: Number(baselineEndMap?.[channelName]) || 0
                });
            }
            result.blocked.push({
                channelName,
                currentPercent,
                desiredPercent: targetPercent,
                reason: 'disabled-channel',
                coverage: null
            });
            return;
        }
        if (debugEnabled) {
            const baseline = Number(baselineEndMap?.[channelName]) || 0;
            const percent = Number(stateEntry?.percentage) || 0;
            const endValue = Number(stateEntry?.endValue) || 0;
            console.log('[auto-raise] evaluating channel', channelName, { baseline, percent, endValue });
        }

        const coverageDecision = evaluateCoverageDecision(coverageSummary, channelName, targetNormalized);
        const coverageSnapshot = coverageDecision.entrySnapshot || null;

        if (!coverageDecision.allowRaise) {
            const percentValue = Number(stateEntry?.percentage);
            if (Number.isFinite(percentValue) && Number.isFinite(targetPercent) && (percentValue + epsilon) < targetPercent) {
                coverageDecision.allowRaise = true;
                coverageDecision.reason = 'end-limited';
            }
        }

        if (!coverageDecision.allowRaise) {
            result.blocked.push({
                channelName,
                currentPercent: null,
                desiredPercent: targetPercent,
                reason: coverageDecision.reason,
                coverage: coverageSnapshot
            });
            return;
        }

        const lockedStatusFormatter = options.notifyLocked === false
            ? null
            : ({ currentPercent }) => `${channelName} ink limit locked at ${formatPercentDisplay(currentPercent ?? 0)}% — auto-raise skipped (${context.label} peaks at ${formatPercentDisplay(targetPercent)}%)`;

        const limitAdjust = ensureInkLimitForAbsoluteTarget(channelName, targetPercent, {
            epsilonPercent: epsilon,
            statusFormatter: ({ newPercent }) => `${channelName} ink limit changed to ${formatPercentDisplay(newPercent)}% (auto-raised for ${context.label})`,
            lockedStatusFormatter,
            emitStatus: options.emitStatus !== false,
            source: context.source
        });

        if (!limitAdjust) {
            return;
        }

        const adjustmentReasonBase = coverageDecision.reason === 'no-coverage-data' ? 'end-limited' : coverageDecision.reason;

        if (limitAdjust.raised) {
            result.adjustments.push({
                channelName,
                previousPercent: Number.isFinite(limitAdjust.previousPercent) ? limitAdjust.previousPercent : Number.isFinite(limitAdjust.currentPercent) ? limitAdjust.currentPercent : null,
                newPercent: Number.isFinite(limitAdjust.newPercent) ? limitAdjust.newPercent : Number.isFinite(limitAdjust.currentPercent) ? limitAdjust.currentPercent : null,
                desiredPercent: targetPercent,
                absoluteTarget: Number.isFinite(limitAdjust.absolute) ? limitAdjust.absolute : targetPercent,
                previousEnd: Number.isFinite(limitAdjust.previousEnd) ? limitAdjust.previousEnd : null,
                newEnd: Number.isFinite(limitAdjust.newEnd) ? limitAdjust.newEnd : null,
                raised: true,
                source: context.source,
                reason: adjustmentReasonBase,
                coverage: coverageSnapshot
            });
            return;
        }

        if (limitAdjust.locked) {
            const current = Number.isFinite(limitAdjust.currentPercent)
                ? limitAdjust.currentPercent
                : Number.isFinite(limitAdjust.previousPercent)
                    ? limitAdjust.previousPercent
                    : null;
            result.blocked.push({
                channelName,
                currentPercent: current,
                desiredPercent: targetPercent,
                reason: 'locked',
                coverage: coverageSnapshot
            });
            return;
        }

        const passiveReason = adjustmentReasonBase === 'end-limited' ? 'within-limit' : adjustmentReasonBase;
        if (passiveReason === 'within-limit') {
            return;
        }
        result.blocked.push({
            channelName,
            currentPercent: Number.isFinite(limitAdjust.currentPercent) ? limitAdjust.currentPercent : null,
            desiredPercent: targetPercent,
            reason: passiveReason,
            coverage: coverageSnapshot
        });
    });

    const summaryEntries = [];
    result.adjustments.forEach((entry) => {
        summaryEntries.push({
            channel: entry.channelName,
            previousPercent: entry.previousPercent,
            newPercent: entry.newPercent,
            desiredPercent: Number.isFinite(entry.desiredPercent) ? entry.desiredPercent : result.targetPercent,
            locked: false,
            currentPercent: entry.newPercent,
            reason: entry.reason || null,
            coverage: entry.coverage || null
        });
    });
    result.blocked.forEach((entry) => {
        summaryEntries.push({
            channel: entry.channelName,
            previousPercent: entry.currentPercent,
            newPercent: entry.currentPercent,
            desiredPercent: entry.desiredPercent ?? result.targetPercent,
            locked: entry.reason === 'locked',
            currentPercent: entry.currentPercent,
            reason: entry.reason || null,
            coverage: entry.coverage || null
        });
    });
    setCompositeAutoRaiseSummary(summaryEntries, {
        label: context.label,
        source: context.source,
        targetPercent: result.targetPercent,
        evaluated: result.evaluated,
        timestamp: Date.now()
    });

    recordAudit(result);
    return result;
}

registerDebugNamespace('autoRaiseInkLimits', {
    getAutoRaiseAuditState,
    clearAutoRaiseAuditState,
    computeAutoRaiseTargetPercent,
    maybeAutoRaiseInkLimits
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['getAutoRaiseAuditState', 'computeAutoRaiseTargetPercent']
});
