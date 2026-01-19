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
    useSavitzkyGolay: true,  // Use Savitzky-Golay by default (better peak preservation)
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

function hashSamples(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return null;
    }
    let hash = 2166136261 >>> 0; // FNV-1a basis
    for (let i = 0; i < samples.length; i += 1) {
        hash ^= Number(samples[i]) & 0xffff;
        hash = (hash * 16777619) >>> 0;
    }
    return hash >>> 0;
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

/**
 * Savitzky-Golay smoothing (2nd order, window=5)
 * Better peak preservation than moving average - standard in chromatography
 * Uses polynomial fitting instead of simple boxcar averaging
 * @param {number[]} values - Input values
 * @returns {number[]} Smoothed values
 */
function savitzkyGolay5(values) {
    if (!Array.isArray(values) || values.length < 5) {
        return values.slice();
    }

    // Savitzky-Golay coefficients for window=5, polynomial=2
    // Coefficients: [-3, 12, 17, 12, -3] / 35
    const coeffs = [-3 / 35, 12 / 35, 17 / 35, 12 / 35, -3 / 35];
    const result = new Array(values.length);

    for (let i = 0; i < values.length; i++) {
        let sum = 0;
        for (let j = -2; j <= 2; j++) {
            const idx = Math.min(values.length - 1, Math.max(0, i + j));
            sum += values[idx] * coeffs[j + 2];
        }
        result[i] = sum;
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

function estimateApexSpan(samples, peakIndex) {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    if (!Number.isFinite(peakIndex)) return null;
    const peakValue = samples[peakIndex];
    if (!Number.isFinite(peakValue) || peakValue <= 0) return null;
    const threshold = peakValue * 0.2;
    let left = peakIndex;
    let right = peakIndex;
    while (left > 0 && samples[left] > threshold) {
        left -= 1;
    }
    while (right < samples.length - 1 && samples[right] > threshold) {
        right += 1;
    }
    const leftSpan = Math.max(0, peakIndex - left);
    const rightSpan = Math.max(0, right - peakIndex);
    const totalSpan = Math.max(0, right - left);
    const domain = samples.length > 1 ? (samples.length - 1) : null;
    const toPercent = (value) => (domain ? (value / domain) * 100 : null);
    return {
        totalSamples: totalSpan,
        leftSamples: leftSpan,
        rightSamples: rightSpan,
        totalPercent: toPercent(totalSpan),
        leftPercent: toPercent(leftSpan),
        rightPercent: toPercent(rightSpan)
    };
}

/**
 * Compute R² (coefficient of determination) vs ideal Gaussian
 * Measures how well the curve matches a Gaussian bell shape
 * @param {number[]} samples - Normalized curve samples (0-1)
 * @param {number} peakIndex - Index of peak value
 * @returns {number|null} R² value (0-1) or null if cannot compute
 */
function computeGaussianFitQuality(samples, peakIndex) {
    if (!Array.isArray(samples) || samples.length < 10) return null;
    if (!Number.isFinite(peakIndex)) return null;

    const peakValue = samples[peakIndex];
    if (!Number.isFinite(peakValue) || peakValue <= 0) return null;

    // Estimate sigma from FWHM (Full Width at Half Maximum)
    const halfMax = peakValue * 0.5;
    let leftHalf = peakIndex;
    let rightHalf = peakIndex;
    while (leftHalf > 0 && samples[leftHalf] > halfMax) leftHalf--;
    while (rightHalf < samples.length - 1 && samples[rightHalf] > halfMax) rightHalf++;
    const fwhm = rightHalf - leftHalf;
    const sigma = fwhm / 2.355; // FWHM to sigma conversion

    if (sigma < 1) return null;

    // Compute sum of squared residuals vs Gaussian model
    let ssRes = 0;
    let ssTot = 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

    for (let i = 0; i < samples.length; i++) {
        const d = i - peakIndex;
        const gaussian = peakValue * Math.exp(-(d * d) / (2 * sigma * sigma));
        ssRes += (samples[i] - gaussian) ** 2;
        ssTot += (samples[i] - mean) ** 2;
    }

    const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
    return Math.max(0, Math.min(1, rSquared));
}

function buildBaseResult(samples) {
    const sanitized = sanitizeSamples(samples);
    const length = sanitized.length;
    const curveHash = hashSamples(sanitized);
    const peakIndex = length > 0 ? sanitized.reduce((idx, value, i, arr) => (value > arr[idx] ? i : idx), 0) : null;
    const peakValue = peakIndex != null ? sanitized[peakIndex] : null;
    const apexSpan = peakIndex != null ? estimateApexSpan(sanitized, peakIndex) : null;
    const startValue = length > 0 ? sanitized[0] : null;
    const endValue = length > 0 ? sanitized[length - 1] : null;
    // Compute Gaussian fit quality on normalized samples
    const normalizedForFit = normalize(sanitized);
    const fitQuality = peakIndex != null ? computeGaussianFitQuality(normalizedForFit, peakIndex) : null;
    return {
        classification: CurveShapeClassification.UNKNOWN,
        confidence: 0,
        startValue,
        endValue,
        peakIndex,
        peakValue,
        peakInputPercent: peakIndex != null && length > 1 ? (peakIndex / (length - 1)) * 100 : null,
        apexSampleIndex: peakIndex,
        apexInputPercent: peakIndex != null && length > 1 ? (peakIndex / (length - 1)) * 100 : null,
        apexOutputPercent: peakValue != null ? clamp01(peakValue / MAX_VALUE) * 100 : null,
        apexSpanSamples: apexSpan?.totalSamples ?? null,
        apexSpanPercent: apexSpan?.totalPercent ?? null,
        apexSpanLeftSamples: apexSpan?.leftSamples ?? null,
        apexSpanRightSamples: apexSpan?.rightSamples ?? null,
        apexSpanLeftPercent: apexSpan?.leftPercent ?? null,
        apexSpanRightPercent: apexSpan?.rightPercent ?? null,
        // Asymmetry metrics (added per multi-agent audit recommendation)
        asymmetryRatio: apexSpan?.leftSamples && apexSpan?.rightSamples
            ? apexSpan.leftSamples / apexSpan.rightSamples
            : null,
        isLeftSkewed: (apexSpan?.leftSamples ?? 0) < (apexSpan?.rightSamples ?? 0) * 0.8,
        isRightSkewed: (apexSpan?.leftSamples ?? 0) > (apexSpan?.rightSamples ?? 0) * 1.2,
        // Gaussian fit quality (R² coefficient of determination)
        gaussianFitQuality: fitQuality,
        sampleCount: length,
        normalizedPeak: peakValue != null ? clamp01(peakValue / MAX_VALUE) : null,
        reasons: [],
        curveHash: curveHash,
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
    const smoothed = mergedOptions.useSavitzkyGolay
        ? savitzkyGolay5(normalized)
        : movingAverage(normalized, mergedOptions.smoothingWindow);
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
