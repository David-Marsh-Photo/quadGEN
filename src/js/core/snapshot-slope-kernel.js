// Kernel-based slope smoothing for snapshot curves (multi-pass implementation)

import { SNAPSHOT_FLAG_THRESHOLD_PERCENT } from './snapshot-flags.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const EPSILON = 1e-9;
const MIN_WINDOW_SAMPLES = 4;
const WINDOW_RADIUS = 10;
const ANCHOR_BLEND_WEIGHT = 0.25;
const PASS_REDUCTION_FACTOR = 0.6;
const PASS_MIN_THRESHOLD = 0.04;
const ITERATION_TOLERANCE = 1e-4;
const WEIGHT_TOLERANCE = 1e-6;
const NEAR_THRESHOLD_RATIO = 0.95;
const NEAR_THRESHOLD_MIN_SEGMENTS = 3;
const PENDING_BLEND_LOCK_TOLERANCE = 0.02;

let latestKernelStats = null;

function clampNormalized(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function normalizeChannelNames(channelNames, fallback) {
    if (Array.isArray(channelNames) && channelNames.length) {
        return channelNames.slice();
    }
    if (Array.isArray(fallback) && fallback.length) {
        return fallback.slice();
    }
    if (fallback && typeof fallback === 'object') {
        return Object.keys(fallback);
    }
    return [];
}

function debugLog(message, ...args) {
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[SLOPE_KERNEL]', message, ...args);
    }
}

function buildLockedMask(debugSnapshots, channelNames) {
    const maskByChannel = new Map();
    if (!Array.isArray(debugSnapshots) || !debugSnapshots.length) {
        return maskByChannel;
    }
    if (!Array.isArray(channelNames) || !channelNames.length) {
        return maskByChannel;
    }

    channelNames.forEach((name) => {
        maskByChannel.set(name, new Array(debugSnapshots.length).fill(false));
    });

    debugSnapshots.forEach((snapshot, index) => {
        if (!snapshot || typeof snapshot !== 'object') {
            return;
        }
        const perChannel = snapshot.perChannel || {};
        channelNames.forEach((name) => {
            const mask = maskByChannel.get(name);
            if (!mask || index >= mask.length) {
                return;
            }
            const entry = perChannel[name];
            if (!entry) {
                mask[index] = true;
                return;
            }
            const blendLimited = entry.blendLimited === true;
            const reserveState = entry.reserveState;
            const reserveRemaining = Number(entry.reserveAllowanceRemaining);
            const headroomAfter = Number(entry.headroomAfter);
            const pendingBlendCap = Number(entry.pendingBlendCap);
            const allowedNormalized = Number(entry.allowedNormalized);
            const normalizedAfter = Number(entry.normalizedAfter);
            const disabled = entry.enabled === false || entry.disabled === true;
            const coverageClamp = Number.isFinite(pendingBlendCap)
                && Number.isFinite(allowedNormalized)
                && Number.isFinite(normalizedAfter)
                && pendingBlendCap <= allowedNormalized + EPSILON
                && normalizedAfter >= pendingBlendCap - EPSILON
                && normalizedAfter <= pendingBlendCap + PENDING_BLEND_LOCK_TOLERANCE;
            const reserveDepleted = reserveState === 'exhausted'
                || (Number.isFinite(reserveRemaining) && reserveRemaining <= EPSILON);
            const headroomLocked = Number.isFinite(headroomAfter) && headroomAfter <= EPSILON;
            if (blendLimited || reserveDepleted || headroomLocked || coverageClamp || disabled) {
                mask[index] = true;
            }
        });
    });

    return maskByChannel;
}

function maxDelta(series) {
    let max = 0;
    if (!Array.isArray(series) || series.length < 2) {
        return max;
    }
    for (let i = 1; i < series.length; i += 1) {
        const prev = series[i - 1];
        const current = series[i];
        const delta = Math.abs(current - prev);
        if (delta > max) {
            max = delta;
        }
    }
    return max;
}

function maxDeltaForRange(series, start, end) {
    if (!Array.isArray(series) || start >= end) {
        return 0;
    }
    let max = 0;
    for (let i = start + 1; i <= end; i += 1) {
        const delta = Math.abs(series[i] - series[i - 1]);
        if (delta > max) {
            max = delta;
        }
    }
    return max;
}

function isMonotonic(series, start, end) {
    if (!Array.isArray(series) || series.length === 0) {
        return true;
    }
    const startValue = series[start];
    const endValue = series[end];
    const direction = endValue >= startValue ? 1 : -1;
    for (let i = start + 1; i <= end; i += 1) {
        if (direction >= 0) {
            if (series[i] + EPSILON < series[i - 1]) {
                return false;
            }
        } else if (series[i] > series[i - 1] + EPSILON) {
            return false;
        }
    }
    return true;
}

function mergeRegions(regions) {
    if (!Array.isArray(regions) || regions.length === 0) {
        return [];
    }
    const sorted = regions
        .filter((region) => region && Number.isFinite(region.start) && Number.isFinite(region.end))
        .map((region) => ({
            start: Math.max(0, Math.floor(region.start)),
            end: Math.max(0, Math.floor(region.end))
        }))
        .sort((a, b) => a.start - b.start);
    if (!sorted.length) {
        return [];
    }
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i += 1) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current.start <= last.end + 1) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push({ ...current });
        }
    }
    return merged;
}

function findOvershootRegions(series, threshold) {
    if (!Array.isArray(series) || series.length < 2) {
        return [];
    }
    const nearThreshold = Math.max(threshold * NEAR_THRESHOLD_RATIO, threshold - 0.02);
    const regions = [];
    let regionStart = null;
    let regionEnd = null;
    let nearSegments = 0;
    let hasTrueOvershoot = false;

    const flushRegion = () => {
        if (regionStart === null || regionEnd === null) {
            regionStart = null;
            regionEnd = null;
            nearSegments = 0;
            hasTrueOvershoot = false;
            return;
        }
        const span = regionEnd - regionStart;
        const qualifies = hasTrueOvershoot || nearSegments >= NEAR_THRESHOLD_MIN_SEGMENTS || span >= NEAR_THRESHOLD_MIN_SEGMENTS;
        if (qualifies) {
            const peakDelta = maxDeltaForRange(series, regionStart, regionEnd);
            if (hasTrueOvershoot || peakDelta >= nearThreshold - EPSILON) {
                regions.push({
                    start: regionStart,
                    end: regionEnd
                });
            }
        }
        regionStart = null;
        regionEnd = null;
        nearSegments = 0;
        hasTrueOvershoot = false;
    };

    for (let i = 1; i < series.length; i += 1) {
        const delta = series[i] - series[i - 1];
        const absDelta = Math.abs(delta);
        if (absDelta > threshold + EPSILON) {
            if (regionStart === null) {
                regionStart = i - 1;
            }
            regionEnd = i;
            hasTrueOvershoot = true;
            nearSegments += 1;
            continue;
        }
        if (absDelta >= nearThreshold - EPSILON) {
            if (regionStart === null) {
                regionStart = i - 1;
            }
            regionEnd = i;
            nearSegments += 1;
        } else {
            flushRegion();
        }
    }

    flushRegion();

    return mergeRegions(regions);
}

function hasLockedSamples(mask, start, end) {
    if (!Array.isArray(mask)) {
        return false;
    }
    for (let i = start; i <= end; i += 1) {
        if (mask[i]) {
            return true;
        }
    }
    return false;
}

function trimWindowAroundLocks(start, end, lockedMask) {
    if (!Array.isArray(lockedMask) || start >= end) {
        return { start, end };
    }
    let left = start;
    let right = end;
    while (left < right && lockedMask[left]) {
        left += 1;
    }
    while (left < right && lockedMask[right]) {
        right -= 1;
    }
    if (right - left + 1 < MIN_WINDOW_SAMPLES) {
        return null;
    }
    if (hasLockedSamples(lockedMask, left, right)) {
        return null;
    }
    return { start: left, end: right };
}

function clampWindowExternalDeltas(series, start, end, threshold, windowStat = null) {
    let clamped = false;
    const edgeThreshold = Math.max(threshold - ITERATION_TOLERANCE, threshold * 0.95);
    const prevIndex = start - 1;
    if (prevIndex >= 0 && prevIndex < series.length) {
        const prevValue = series[prevIndex];
        let startValue = series[start];
        if (Number.isFinite(prevValue) && Number.isFinite(startValue)) {
            const delta = startValue - prevValue;
            if (Math.abs(delta) > edgeThreshold + EPSILON) {
                const direction = delta >= 0 ? 1 : -1;
                const target = prevValue + (direction * edgeThreshold);
                series[start] = clampNormalized(target);
                if (windowStat) {
                    windowStat.startExternalClamp = true;
                }
                clamped = true;
            }
        }
    }
    const nextIndex = end + 1;
    if (nextIndex >= 0 && nextIndex < series.length) {
        const nextValue = series[nextIndex];
        let endValue = series[end];
        if (Number.isFinite(nextValue) && Number.isFinite(endValue)) {
            const delta = nextValue - endValue;
            if (Math.abs(delta) > edgeThreshold + EPSILON) {
                const direction = delta >= 0 ? 1 : -1;
                const target = nextValue - (direction * edgeThreshold);
                series[end] = clampNormalized(target);
                if (windowStat) {
                    windowStat.endExternalClamp = true;
                }
                clamped = true;
            }
        }
    }
    return clamped;
}

function createGaussianWeights(length) {
    if (!Number.isFinite(length) || length <= 0) {
        return null;
    }
    const center = (length - 1) / 2;
    const sigma = Math.max(1.1, length * 0.35);
    const weights = [];
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
        const distance = i - center;
        const weight = Math.exp(-((distance * distance) / (2 * sigma * sigma)));
        if (!Number.isFinite(weight)) {
            continue;
        }
        weights.push(weight);
        sum += weight;
    }
    if (weights.length !== length || sum <= EPSILON) {
        return null;
    }
    return weights.map((weight) => weight / sum);
}

function createCosineWeights(length) {
    if (!Number.isFinite(length) || length <= 0) {
        return null;
    }
    const weights = [];
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
        const t = (i + 0.5) / length;
        const weight = 0.5 * (1 - Math.cos(Math.PI * t));
        if (!Number.isFinite(weight)) {
            continue;
        }
        weights.push(weight);
        sum += weight;
    }
    if (weights.length !== length || sum <= EPSILON) {
        return null;
    }
    return weights.map((weight) => weight / sum);
}

function createKernelWeights(length) {
    if (length <= 0) {
        return null;
    }
    const gaussian = createGaussianWeights(length);
    if (Array.isArray(gaussian)) {
        return gaussian;
    }
    return createCosineWeights(length);
}

function adjustWeightsForThreshold(weights, totalChangeMagnitude, threshold) {
    if (!Array.isArray(weights) || weights.length === 0) {
        return null;
    }
    if (!Number.isFinite(totalChangeMagnitude) || totalChangeMagnitude <= EPSILON) {
        return weights;
    }
    if (!Number.isFinite(threshold) || threshold <= EPSILON) {
        return null;
    }
    const allowed = threshold / totalChangeMagnitude;
    if (!Number.isFinite(allowed) || allowed <= WEIGHT_TOLERANCE) {
        return null;
    }
    const maxWeight = weights.reduce((max, weight) => (weight > max ? weight : max), 0);
    if (maxWeight <= allowed + WEIGHT_TOLERANCE) {
        return weights;
    }
    const length = weights.length;
    const uniformWeight = 1 / length;
    if (uniformWeight > allowed + WEIGHT_TOLERANCE) {
        return null;
    }
    const uniform = new Array(length).fill(uniformWeight);
    let lower = 0;
    let upper = 1;
    let best = uniform.slice();
    for (let iter = 0; iter < 24; iter += 1) {
        const alpha = (lower + upper) / 2;
        const blended = weights.map((weight, index) => {
            const base = uniform[index];
            return base * (1 - alpha) + weight * alpha;
        });
        const blendedMax = blended.reduce((max, weight) => (weight > max ? weight : max), 0);
        if (blendedMax > allowed + WEIGHT_TOLERANCE) {
            upper = alpha;
        } else {
            best = blended;
            lower = alpha;
        }
    }
    const bestMax = best.reduce((max, weight) => (weight > max ? weight : max), 0);
    if (bestMax > allowed + WEIGHT_TOLERANCE) {
        return null;
    }
    const sum = best.reduce((acc, weight) => acc + weight, 0);
    if (sum <= EPSILON) {
        return null;
    }
    return best.map((weight) => weight / sum);
}

function applyKernelWindow(series, start, end, threshold) {
    const segments = end - start;
    if (segments < 1) {
        return false;
    }
    const weights = createKernelWeights(segments);
    if (!Array.isArray(weights) || weights.length !== segments) {
        return false;
    }
    const startValue = series[start];
    const endValue = series[end];
    const totalChange = endValue - startValue;
    if (Math.abs(totalChange) <= EPSILON) {
        return true;
    }
    const adjustedWeights = adjustWeightsForThreshold(weights, Math.abs(totalChange), threshold);
    if (!adjustedWeights) {
        return false;
    }

    const updated = series.slice();
    let cursor = startValue;
    for (let offset = 0; offset < segments; offset += 1) {
        cursor += totalChange * adjustedWeights[offset];
        const index = start + offset + 1;
        if (index >= end) {
            break;
        }
        updated[index] = clampNormalized(cursor);
    }

    updated[start] = startValue;
    updated[end] = endValue;

    if (!isMonotonic(updated, start, end)) {
        return false;
    }

    for (let index = start + 1; index < end; index += 1) {
        series[index] = updated[index];
    }
    return true;
}

function computeExpandedWindow(region, length, lockedMask) {
    if (!region) {
        return null;
    }
    let start = region.start;
    let end = region.end;

    let leftRadius = WINDOW_RADIUS;
    while (leftRadius > 0 && start > 0) {
        const next = start - 1;
        if (lockedMask && lockedMask[next]) {
            break;
        }
        start = next;
        leftRadius -= 1;
    }

    let rightRadius = WINDOW_RADIUS;
    while (rightRadius > 0 && end < length - 1) {
        const next = end + 1;
        if (lockedMask && lockedMask[next]) {
            break;
        }
        end = next;
        rightRadius -= 1;
    }

    if (end - start + 1 < MIN_WINDOW_SAMPLES) {
        return null;
    }

    if (lockedMask) {
        const trimmed = trimWindowAroundLocks(start, end, lockedMask);
        if (!trimmed) {
            return null;
        }
        start = trimmed.start;
        end = trimmed.end;
    }

    return { start, end };
}

function blendAnchorValue(series, index, neighborIndex) {
    if (!Array.isArray(series)) {
        return null;
    }
    if (neighborIndex < 0 || neighborIndex >= series.length) {
        return null;
    }
    const anchor = series[index];
    const neighbor = series[neighborIndex];
    if (!Number.isFinite(anchor) || !Number.isFinite(neighbor)) {
        return null;
    }
    const blended = ((1 - ANCHOR_BLEND_WEIGHT) * anchor) + (ANCHOR_BLEND_WEIGHT * neighbor);
    return clampNormalized(blended);
}

function smoothChannelWithKernel(series, threshold, lockedMask, channelStats) {
    if (!Array.isArray(series) || series.length < 3) {
        return {
            series: series ? series.slice() : [],
            applied: false,
            requiresLimiter: true
        };
    }

    const working = series.slice();
    let applied = false;
    let requiresLimiter = true;

    const regions = findOvershootRegions(series, threshold);
    if (!regions.length) {
        return {
            series: working,
            applied: false,
            requiresLimiter: true
        };
    }

    regions.forEach((region) => {
        const windowBounds = computeExpandedWindow(region, working.length, lockedMask);
        if (!windowBounds) {
            channelStats.windows.push({
                start: region.start,
                end: region.end,
                skipped: true,
                reason: 'locked-or-small'
            });
            return;
        }

        const { start, end } = windowBounds;
        const originalWindow = working.slice(start, end + 1);
        const windowStat = {
            start,
            end,
            deltaBefore: maxDelta(originalWindow),
            passesApplied: 0,
            fallback: false
        };

        const blendedStart = blendAnchorValue(working, start, start + 1);
        if (blendedStart !== null) {
            working[start] = blendedStart;
            windowStat.startBlended = true;
        }
        const blendedEnd = blendAnchorValue(working, end, end - 1);
        if (blendedEnd !== null) {
            working[end] = blendedEnd;
            windowStat.endBlended = true;
        }

        let passSuccess = false;
        const passASuccess = applyKernelWindow(working, start, end, threshold);
        if (passASuccess) {
            windowStat.passesApplied += 1;
            passSuccess = true;
        }

        const targetThreshold = Math.min(threshold * PASS_REDUCTION_FACTOR, PASS_MIN_THRESHOLD);
        if (passSuccess && targetThreshold > EPSILON) {
            const passBSuccess = applyKernelWindow(working, start, end, targetThreshold);
            if (passBSuccess) {
                windowStat.passesApplied += 1;
            } else {
                debugLog('secondary pass aborted', { start, end });
            }
        }

        if (!windowStat.passesApplied) {
            for (let i = 0; i < originalWindow.length; i += 1) {
                working[start + i] = originalWindow[i];
            }
            windowStat.reverted = true;
            windowStat.deltaAfter = windowStat.deltaBefore;
            channelStats.windows.push(windowStat);
            return;
        }

        const deltaAfter = maxDeltaForRange(working, start, end);
        windowStat.deltaAfter = deltaAfter;
        applied = true;

        if (deltaAfter > threshold + ITERATION_TOLERANCE) {
            windowStat.fallback = true;
        } else {
            requiresLimiter = false;
        }

        if (clampWindowExternalDeltas(working, start, end, threshold, windowStat)) {
            const clampPass = applyKernelWindow(working, start, end, threshold);
            if (clampPass) {
                windowStat.passesApplied += 1;
                windowStat.postClampPass = true;
            }
            const postClampDelta = maxDeltaForRange(working, Math.max(0, start - 1), Math.min(working.length - 1, end + 1));
            windowStat.deltaAfter = postClampDelta;
            if (postClampDelta <= threshold + ITERATION_TOLERANCE) {
                requiresLimiter = false;
            } else {
                windowStat.fallback = true;
            }
        }

        channelStats.windows.push(windowStat);
    });

    if (!applied) {
        requiresLimiter = true;
    }

    return {
        series: working,
        applied,
        requiresLimiter
    };
}

export function applySnapshotSlopeKernel(curves, {
    channelNames = null,
    endValues = null,
    thresholdPercent = SNAPSHOT_FLAG_THRESHOLD_PERCENT,
    debugSnapshots = null
} = {}) {
    if (!curves || typeof curves !== 'object') {
        return {
            normalizedSeriesByChannel: {},
            appliedChannels: [],
            channelsNeedingLimiter: [],
            stats: null
        };
    }

    const threshold = Number.isFinite(thresholdPercent) && thresholdPercent > 0
        ? (thresholdPercent / 100)
        : (SNAPSHOT_FLAG_THRESHOLD_PERCENT / 100);
    if (threshold <= EPSILON) {
        return {
            normalizedSeriesByChannel: {},
            appliedChannels: [],
            channelsNeedingLimiter: [],
            stats: null
        };
    }

    const names = normalizeChannelNames(channelNames, curves);
    if (!names.length) {
        return {
            normalizedSeriesByChannel: {},
            appliedChannels: [],
            channelsNeedingLimiter: [],
            stats: null
        };
    }

    const endValueMap = endValues && typeof endValues === 'object' ? endValues : {};
    const lockedMaskByChannel = buildLockedMask(debugSnapshots, names);
    const normalizedSeriesByChannel = {};
    const appliedChannels = [];
    const channelsNeedingLimiter = [];
    const stats = {
        guardThreshold: threshold,
        channels: {}
    };

    names.forEach((name) => {
        const curve = curves[name];
        if (!Array.isArray(curve) || !curve.length) {
            return;
        }
        const rawEndValue = Number(endValueMap[name]);
        const endValue = Number.isFinite(rawEndValue) && rawEndValue > 0 ? rawEndValue : 0;
        if (endValue <= 0) {
            return;
        }

        const normalized = curve.map((value) => {
            const numeric = Number(value) || 0;
            return clampNormalized(endValue > 0 ? numeric / endValue : 0);
        });

        const channelStats = {
            windows: []
        };
        stats.channels[name] = channelStats;

        const { series: smoothedSeries, applied, requiresLimiter } = smoothChannelWithKernel(
            normalized,
            threshold,
            lockedMaskByChannel.get(name) || null,
            channelStats
        );

        if (!Array.isArray(smoothedSeries) || !smoothedSeries.length) {
            if (requiresLimiter) {
                channelsNeedingLimiter.push(name);
            }
            return;
        }

        if (applied) {
            appliedChannels.push(name);
        }
        if (requiresLimiter) {
            channelsNeedingLimiter.push(name);
        }

        for (let i = 0; i < curve.length && i < smoothedSeries.length; i += 1) {
            const normalizedValue = clampNormalized(smoothedSeries[i]);
            const absoluteValue = Math.round(normalizedValue * endValue);
            const clampedValue = Math.max(0, Math.min(endValue, absoluteValue));
            curve[i] = clampedValue;
        }
        normalizedSeriesByChannel[name] = smoothedSeries.slice();
    });

    latestKernelStats = {
        timestamp: Date.now(),
        ...stats
    };

    return {
        normalizedSeriesByChannel,
        appliedChannels,
        channelsNeedingLimiter,
        stats: latestKernelStats
    };
}

export function getSnapshotSlopeKernelStats() {
    if (!latestKernelStats) {
        return null;
    }
    return JSON.parse(JSON.stringify(latestKernelStats));
}

registerDebugNamespace('slopeKernel', {
    getSnapshotSlopeKernelStats,
    getSlopeKernelStats: () => getSnapshotSlopeKernelStats()
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['getSlopeKernelStats']
});
