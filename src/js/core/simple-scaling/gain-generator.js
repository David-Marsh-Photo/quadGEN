import { createPCHIPSpline, clamp01 } from '../../math/interpolation.js';
import { cieDensityFromLstar } from '../../utils/lab-math.js';
import { getLabNormalizationMode, LAB_NORMALIZATION_MODES } from '../lab-settings.js';

const EPSILON = 1e-6;

function sanitizeMeasurements(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .map((row) => ({
            input: Number.isFinite(row?.input) ? row.input : Number(row?.inputPercent ?? row?.gray ?? row?.GRAY),
            lab: Number.isFinite(row?.lab) ? row.lab : Number(row?.labL ?? row?.LAB_L ?? row?.l ?? row?.L)
        }))
        .filter((entry) => Number.isFinite(entry.input) && Number.isFinite(entry.lab))
        .map((entry) => ({
            input: Math.max(0, Math.min(100, entry.input)),
            lab: Math.max(0, Math.min(100, entry.lab))
        }))
        .sort((a, b) => a.input - b.input);
}

function computeNormalizedDensity(data) {
    if (!data.length) {
        return {
            minDensity: 0,
            maxDensity: 0,
            normalized: [],
            raw: []
        };
    }
    const raw = data.map((row) => cieDensityFromLstar(row.lab));
    const minDensity = Math.min(...raw);
    const maxDensity = Math.max(...raw);
    const span = Math.max(EPSILON, maxDensity - minDensity);
    const normalized = raw.map((value) => clamp01((value - minDensity) / span));
    return {
        minDensity,
        maxDensity,
        normalized,
        raw
    };
}

function computeAdaptiveSigma(position, normalizedDensity, options = {}) {
    const minSigma = Number.isFinite(options.minSigma) ? Math.max(0.005, options.minSigma) : 0.02;
    const maxSigma = Number.isFinite(options.maxSigma) ? Math.max(minSigma, options.maxSigma) : 0.08;
    const leverage = clamp01(normalizedDensity);
    // Highlights (density ~0) → stay narrow; deep tones widen toward maxSigma.
    return minSigma + leverage * (maxSigma - minSigma);
}

function smoothGainValues(positions, rawGain, normalizedDensity, options = {}) {
    if (positions.length !== rawGain.length || positions.length !== normalizedDensity.length) {
        return rawGain.slice();
    }
    const smoothed = new Array(rawGain.length);
    for (let i = 0; i < positions.length; i += 1) {
        const centerPos = positions[i];
        const sigma = computeAdaptiveSigma(centerPos, normalizedDensity[i], options);
        const radius = sigma * 3;
        let totalWeight = 0;
        let weightedSum = 0;

        for (let j = 0; j < positions.length; j += 1) {
            const distance = Math.abs(positions[j] - centerPos);
            if (distance > radius) {
                continue;
            }
            const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
            weightedSum += rawGain[j] * weight;
            totalWeight += weight;
        }

        if (totalWeight > EPSILON) {
            smoothed[i] = weightedSum / totalWeight;
        } else {
            smoothed[i] = rawGain[i];
        }
    }
    return smoothed;
}

function clampToBand(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return Math.min(Math.max(1, min), max);
    }
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
}

function computeNormalizedResponse(data, positions, normalizationMode) {
    if (!data.length) {
        return {
            normalizedValues: [],
            targetValues: [],
            metadata: {}
        };
    }

    if (normalizationMode === LAB_NORMALIZATION_MODES.DENSITY) {
        const densityInfo = computeNormalizedDensity(data);
        const normalizedValues = densityInfo.normalized.map((value, index) => {
            if (index === 0) return 0;
            if (index === densityInfo.normalized.length - 1) return 1;
            return clamp01(value);
        });
        const targetValues = positions.map((value, index) => {
            if (index === 0) return 0;
            if (index === positions.length - 1) return 1;
            return clamp01(value);
        });
        return {
            normalizedValues,
            targetValues,
            metadata: {
                minDensity: densityInfo.minDensity,
                maxDensity: densityInfo.maxDensity
            }
        };
    }

    const highlightLab = data[0]?.lab ?? 100;
    const shadowLab = data[data.length - 1]?.lab ?? 0;
    const labSpan = Math.max(EPSILON, highlightLab - shadowLab);
    const normalizedValues = data.map((entry, index) => {
        if (index === 0) return 0;
        if (index === data.length - 1) return 1;
        const normalized = (highlightLab - entry.lab) / labSpan;
        return clamp01(normalized);
    });
    const targetValues = positions.map((value, index) => {
        if (index === 0) return 0;
        if (index === positions.length - 1) return 1;
        return clamp01(value);
    });
    const densityInfo = computeNormalizedDensity(data);

    return {
        normalizedValues,
        targetValues,
        metadata: {
            minDensity: densityInfo.minDensity,
            maxDensity: densityInfo.maxDensity,
            highlightLab,
            shadowLab
        }
    };
}

export function generateSimpleScalingGain(measurements, options = {}) {
    const {
        clampMin = 0.85,
        clampMax = 1.9,
        resolution = 256,
        smoothing = {},
        normalizationMode: overrideNormalizationMode = null
    } = options;

    const sorted = sanitizeMeasurements(measurements);
    if (!sorted.length) {
        const unity = Array.from({ length: resolution }, () => 1);
        return {
            clampMin,
            clampMax,
            positions: [],
            rawGain: [],
            smoothedGain: [],
            samples: unity,
            rawSamples: unity.slice(),
            normalizedDensity: [],
            metadata: {
                minDensity: 0,
                maxDensity: 0
            }
        };
    }

    const positions = sorted.map((row) => clamp01(row.input / 100));
    const normalizationMode = overrideNormalizationMode || getLabNormalizationMode?.() || LAB_NORMALIZATION_MODES.LSTAR;
    const {
        normalizedValues,
        targetValues,
        metadata: normalizationMetadata
    } = computeNormalizedResponse(sorted, positions, normalizationMode);

    const rawGain = positions.map((_, index) => {
        if (index === 0 || index === positions.length - 1) {
            return 1;
        }
        const desired = clamp01(targetValues[index] ?? positions[index]);
        const actual = clamp01(normalizedValues[index]);
        if (desired <= EPSILON && actual <= EPSILON) {
            return 1;
        }
        if (actual <= EPSILON) {
            return clampMax;
        }
        const ratio = desired / Math.max(EPSILON, actual);
        return clampToBand(ratio, clampMin, clampMax);
    });

    // Ensure endpoints stay at unity to preserve ink endpoints.
    rawGain[0] = 1;
    rawGain[rawGain.length - 1] = 1;

    const smoothedGain = smoothGainValues(positions, rawGain, normalizedValues, smoothing)
        .map((value, index) => {
            if (index === 0 || index === positions.length - 1) {
                return 1;
            }
            return clampToBand(value, clampMin, clampMax);
        });
    smoothedGain[0] = 1;
    smoothedGain[smoothedGain.length - 1] = 1;

    const spline = createPCHIPSpline(positions, smoothedGain);
    const rawSpline = createPCHIPSpline(positions, rawGain);

    const samples = [];
    const rawSamples = [];
    for (let i = 0; i < resolution; i += 1) {
        const t = positions.length === 1 ? positions[0] : (i / (resolution - 1));
        const smoothedValue = clampToBand(spline(t), clampMin, clampMax);
        const rawValue = clampToBand(rawSpline(t), clampMin, clampMax);
        samples.push(smoothedValue);
        rawSamples.push(rawValue);
    }

    return {
        clampMin,
        clampMax,
        positions,
        rawGain,
        smoothedGain,
        samples,
        rawSamples,
        normalizedDensity: normalizedValues,
        metadata: {
            normalizationMode,
            targetNormalized: targetValues.slice(),
            normalizedResponse: normalizedValues.slice(),
            ...normalizationMetadata
        }
    };
}
