// Curve Shape Detector
// Identifies bell vs monotonic channel profiles using slope + endpoint heuristics

export const CurveShapeClassification = {
    BELL: 'bell',
    MONOTONIC: 'monotonic',
    FLAT: 'flat',
    UNKNOWN: 'unknown'
};

const MAX_VALUE = 65535;
const DEFAULTS = {
    smoothingWindow: 5,
    slopeTolerance: 150 / MAX_VALUE,
    monotonicPositiveFraction: 0.9,
    monotonicRiseThreshold: 0.05,
    bellEndRatio: 0.35,
    bellMinProminence: 0.08,
    bellSlopeFraction: 0.78,
    bellMinPeakOffset: 10,
    flatAmplitudeThreshold: 0.02
};

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function sanitizeSamples(samples) {
    if (!Array.isArray(samples)) return [];
    return samples.map((value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        if (numeric < 0) return 0;
        if (numeric > MAX_VALUE) return MAX_VALUE;
        return numeric;
    });
}

function normalize(samples) {
    return samples.map((value) => clamp01(value / MAX_VALUE));
}

function movingAverage(values, windowSize) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const size = Math.max(1, Math.floor(windowSize));
    if (size <= 1) return values.slice();
    const radius = Math.floor(size / 2);
    const result = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = i - radius; j <= i + radius; j++) {
            const index = Math.min(values.length - 1, Math.max(0, j));
            sum += values[index];
            count += 1;
        }
        result[i] = sum / count;
    }
    return result;
}

function getSlopes(values) {
    if (!Array.isArray(values) || values.length < 2) {
        return [];
    }
    const slopes = new Array(values.length - 1);
    for (let i = 1; i < values.length; i++) {
        slopes[i - 1] = values[i] - values[i - 1];
    }
    return slopes;
}

function buildBaseResult(samples) {
    const sanitized = sanitizeSamples(samples);
    const length = sanitized.length;
    const peakIndex = length > 0 ? sanitized.reduce((idx, value, i, arr) => (value > arr[idx] ? i : idx), 0) : null;
    const peakValue = peakIndex != null ? sanitized[peakIndex] : null;
    const startValue = length > 0 ? sanitized[0] : null;
    const endValue = length > 0 ? sanitized[length - 1] : null;
    return {
        classification: CurveShapeClassification.UNKNOWN,
        confidence: 0,
        startValue,
        endValue,
        peakIndex,
        peakValue,
        peakInputPercent: peakIndex != null && length > 1 ? (peakIndex / (length - 1)) * 100 : null,
        sampleCount: length,
        normalizedPeak: peakValue != null ? clamp01(peakValue / MAX_VALUE) : null,
        reasons: [],
        sanitized
    };
}

function classifyFlatProfile(result, normalized, options) {
    if (!Array.isArray(normalized) || normalized.length === 0) {
        result.reasons.push('no_samples');
        return false;
    }
    const minValue = Math.min(...normalized);
    const maxValue = Math.max(...normalized);
    const amplitude = maxValue - minValue;
    if (amplitude <= options.flatAmplitudeThreshold) {
        result.classification = CurveShapeClassification.FLAT;
        result.confidence = 1 - (amplitude / options.flatAmplitudeThreshold);
        result.reasons.push('flat_amplitude');
        return true;
    }
    return false;
}

function classifyBellProfile(result, normalized, slopes, options) {
    const length = normalized.length;
    if (length < (options.bellMinPeakOffset * 2) + 3) {
        result.reasons.push('bell_too_short');
        return false;
    }
    const peakIndex = result.peakIndex ?? Math.floor(length / 2);
    if (peakIndex < options.bellMinPeakOffset || peakIndex > length - 1 - options.bellMinPeakOffset) {
        result.reasons.push('peak_near_edge');
        return false;
    }
    const peakValue = normalized[peakIndex];
    const minValue = Math.min(...normalized);
    const prominence = peakValue - minValue;
    if (prominence < options.bellMinProminence) {
        result.reasons.push('bell_low_prominence');
        return false;
    }

    const startLowEnough = normalized[0] <= (peakValue * options.bellEndRatio) + options.slopeTolerance;
    const endLowEnough = normalized[length - 1] <= (peakValue * options.bellEndRatio) + options.slopeTolerance;
    if (!startLowEnough || !endLowEnough) {
        result.reasons.push('ends_not_low');
        return false;
    }

    const riseSlopes = slopes.slice(0, Math.max(1, peakIndex));
    const fallSlopes = slopes.slice(Math.max(0, peakIndex));
    if (riseSlopes.length === 0 || fallSlopes.length === 0) {
        result.reasons.push('insufficient_slopes');
        return false;
    }

    const upFraction = riseSlopes.filter((delta) => delta >= -options.slopeTolerance).length / riseSlopes.length;
    const downFraction = fallSlopes.filter((delta) => delta <= options.slopeTolerance).length / fallSlopes.length;
    if (upFraction < options.bellSlopeFraction || downFraction < options.bellSlopeFraction) {
        result.reasons.push('bell_slope_mismatch');
        return false;
    }

    result.classification = CurveShapeClassification.BELL;
    result.confidence = Math.min(upFraction, downFraction);
    result.reasons.push('bell_detected');
    return true;
}

function classifyMonotonic(result, normalized, slopes, options) {
    if (!Array.isArray(slopes) || slopes.length === 0) {
        result.reasons.push('no_slopes');
        return false;
    }
    const nonDecreasingFraction = slopes.filter((delta) => delta >= -options.slopeTolerance).length / slopes.length;
    const netRise = normalized[normalized.length - 1] - normalized[0];
    if (nonDecreasingFraction >= options.monotonicPositiveFraction && netRise >= options.monotonicRiseThreshold) {
        result.classification = CurveShapeClassification.MONOTONIC;
        result.confidence = Math.min(1, nonDecreasingFraction);
        result.reasons.push('monotonic_detected');
        return true;
    }
    result.reasons.push('monotonic_threshold_not_met');
    return false;
}

/**
 * Classify a 256-point QuadToneRIP curve into bell / monotonic / flat
 * @param {number[]} samples - Curve samples (0-65535)
 * @param {Object} options - Optional tuning overrides
 * @returns {Object} classification metadata
 */
export function classifyCurve(samples, options = {}) {
    const mergedOptions = {
        ...DEFAULTS,
        ...(options || {})
    };
    const base = buildBaseResult(samples);
    if (base.sampleCount < 3) {
        base.reasons.push('insufficient_samples');
        delete base.sanitized;
        return base;
    }

    const normalized = normalize(base.sanitized);
    const smoothed = movingAverage(normalized, mergedOptions.smoothingWindow);
    const slopes = getSlopes(smoothed);

    if (classifyFlatProfile(base, normalized, mergedOptions)) {
        delete base.sanitized;
        return base;
    }

    if (classifyBellProfile(base, normalized, slopes, mergedOptions)) {
        delete base.sanitized;
        return base;
    }

    classifyMonotonic(base, normalized, slopes, mergedOptions);
    delete base.sanitized;
    return base;
}
