// Snapshot slope limiter utilities

import { SNAPSHOT_FLAG_THRESHOLD_PERCENT } from './snapshot-flags.js';

const EPSILON = 1e-9;

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

function enforceSlopeLimit(series, threshold) {
    if (!Array.isArray(series) || !series.length) {
        return null;
    }
    const n = series.length;
    if (n === 1) {
        return [clampNormalized(series[0])];
    }
    const result = series.map((value) => clampNormalized(value));
    const startAnchor = clampNormalized(series[0]);
    const endAnchor = clampNormalized(series[n - 1]);
    result[0] = startAnchor;
    result[n - 1] = endAnchor;
    const adjustedThreshold = Math.max(0, threshold - 1e-4);
    const maxIterations = Math.max(2, n * 3);
    for (let iter = 0; iter < maxIterations; iter += 1) {
        let changed = false;
        for (let i = 1; i < n; i += 1) {
            const prev = result[i - 1];
            const allowedMax = prev + adjustedThreshold;
            const allowedMin = prev - adjustedThreshold;
            if (result[i] > allowedMax + EPSILON) {
                result[i] = allowedMax;
                changed = true;
            } else if (result[i] < allowedMin - EPSILON) {
                result[i] = allowedMin;
                changed = true;
            }
        }
        result[n - 1] = endAnchor;
        for (let i = n - 2; i >= 0; i -= 1) {
            const next = result[i + 1];
            const allowedMax = next + adjustedThreshold;
            const allowedMin = next - adjustedThreshold;
            if (result[i] > allowedMax + EPSILON) {
                result[i] = allowedMax;
                changed = true;
            } else if (result[i] < allowedMin - EPSILON) {
                result[i] = allowedMin;
                changed = true;
            }
        }
        result[0] = startAnchor;
        if (!changed) {
            break;
        }
    }
    for (let i = 0; i < n; i += 1) {
        result[i] = clampNormalized(result[i]);
    }
    return result;
}

export function applySnapshotSlopeLimiter(curves, {
    channelNames = null,
    endValues = null,
    thresholdPercent = SNAPSHOT_FLAG_THRESHOLD_PERCENT
} = {}) {
    if (!curves || typeof curves !== 'object') {
        return {};
    }
    const threshold = Number.isFinite(thresholdPercent) && thresholdPercent > 0
        ? (thresholdPercent / 100)
        : (SNAPSHOT_FLAG_THRESHOLD_PERCENT / 100);
    if (threshold <= EPSILON) {
        return {};
    }

    const names = normalizeChannelNames(channelNames, curves);
    const endValueMap = endValues && typeof endValues === 'object' ? endValues : {};
    const normalizedSeriesByChannel = {};

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
        const normalizedSeries = curve.map((value) => {
            const numeric = Number(value);
            const normalized = endValue > 0 ? numeric / endValue : 0;
            return clampNormalized(normalized);
        });
        const limitedSeries = enforceSlopeLimit(normalizedSeries, threshold);
        if (!limitedSeries) {
            return;
        }
        for (let i = 0; i < curve.length; i += 1) {
            const normalized = clampNormalized(limitedSeries[i]);
            const absoluteValue = Math.round(normalized * endValue);
            const clampedValue = Math.max(0, Math.min(endValue, absoluteValue));
            curve[i] = clampedValue;
            limitedSeries[i] = endValue > 0 ? (clampedValue / endValue) : 0;
        }
        normalizedSeriesByChannel[name] = limitedSeries;
    });

    return normalizedSeriesByChannel;
}

export function syncSnapshotsWithSlopeLimiter(snapshots, {
    channelNames = null,
    normalizedSeriesByChannel = null,
    correctedCurves = null,
    endValues = null,
    densityWeights = null
} = {}) {
    if (!Array.isArray(snapshots) || !snapshots.length) {
        return;
    }
    if (!normalizedSeriesByChannel || typeof normalizedSeriesByChannel !== 'object') {
        return;
    }
    const names = normalizeChannelNames(channelNames, normalizedSeriesByChannel);
    if (!names.length) {
        return;
    }
    const endValueMap = endValues && typeof endValues === 'object' ? endValues : {};
    const curveMap = correctedCurves && typeof correctedCurves === 'object' ? correctedCurves : {};
    const weightMap = densityWeights instanceof Map
        ? densityWeights
        : (densityWeights && typeof densityWeights === 'object'
            ? new Map(Object.entries(densityWeights))
            : new Map());

    snapshots.forEach((snapshot, index) => {
        if (!snapshot || typeof snapshot !== 'object') {
            return;
        }
        if (!snapshot.perChannel || typeof snapshot.perChannel !== 'object') {
            return;
        }

        let correctedInkTotal = 0;
        let densityTotal = 0;
        const densityByChannel = new Map();

        names.forEach((name) => {
            const perChannelEntry = snapshot.perChannel[name];
            const series = normalizedSeriesByChannel[name];
            const curve = curveMap[name];
            const endValueRaw = Number(endValueMap[name]);
            const endValue = Number.isFinite(endValueRaw) && endValueRaw > 0 ? endValueRaw : 0;
            if (!perChannelEntry || !Array.isArray(series) || series.length <= index || endValue <= 0) {
                return;
            }
            const normalized = clampNormalized(series[index]);
            const curveValue = Array.isArray(curve) && curve.length > index
                ? Math.max(0, Number(curve[index]) || 0)
                : Math.max(0, Math.round(normalized * endValue));
            const baselineValue = Number(perChannelEntry.baselineValue) || 0;
            const baselineNormalized = Number(perChannelEntry.normalizedBefore) || 0;
            const weight = Number.isFinite(perChannelEntry.weight)
                ? perChannelEntry.weight
                : (weightMap.get(name) || 0);
            const densityContributionBefore = Number(perChannelEntry.densityContributionBefore) || 0;
            const densityContributionAfter = weight * normalized;

            perChannelEntry.correctedValue = curveValue;
            perChannelEntry.valueDelta = curveValue - baselineValue;
            perChannelEntry.normalizedAfter = normalized;
            perChannelEntry.normalizedDelta = normalized - baselineNormalized;
            perChannelEntry.densityContributionAfter = densityContributionAfter;
            perChannelEntry.densityContributionDelta = densityContributionAfter - densityContributionBefore;

            correctedInkTotal += curveValue;
            densityTotal += densityContributionAfter;
            densityByChannel.set(name, densityContributionAfter);
        });

        if (correctedInkTotal > 0 || densityTotal > 0) {
            names.forEach((name) => {
                const perChannelEntry = snapshot.perChannel[name];
                if (!perChannelEntry) {
                    return;
                }
                const correctedValue = Number(perChannelEntry.correctedValue) || 0;
                const densityContributionAfter = densityByChannel.has(name)
                    ? densityByChannel.get(name)
                    : Number(perChannelEntry.densityContributionAfter) || 0;
                perChannelEntry.shareAfter = correctedInkTotal > 0
                    ? correctedValue / correctedInkTotal
                    : 0;
                perChannelEntry.densityShareAfter = densityTotal > 0
                    ? densityContributionAfter / densityTotal
                    : 0;
            });
        }

        snapshot.correctedInk = correctedInkTotal;
        const baselineInk = Number(snapshot.baselineInk) || 0;
        snapshot.inkDelta = correctedInkTotal - baselineInk;
    });
}
