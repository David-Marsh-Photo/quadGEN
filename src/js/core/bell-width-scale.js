// Bell Curve Width Scaling
// Adjusts bell-shaped curves to widen or tighten slopes around a fixed apex.

import {
    sanitizeSamples,
    linearSample,
    clamp,
    estimateFalloff,
    clampFalloff,
    spanToFalloff
} from './bell-curve-utils.js';

const DEFAULT_MIN_APEX_INDEX = 4;
const DEFAULT_MAX_MARGIN = 4;
const MIN_FACTOR = 0.4;
const MAX_FACTOR = 2.5;
const EPSILON = 1e-4;

function clampFactor(value) {
    if (!Number.isFinite(value)) return 1;
    if (value < MIN_FACTOR) return MIN_FACTOR;
    if (value > MAX_FACTOR) return MAX_FACTOR;
    return value;
}

function isApproximatelyOne(value) {
    return Math.abs(value - 1) < EPSILON;
}

function normalizeSpanSamples(spanSamples, spanPercent, length) {
    if (Number.isFinite(spanSamples)) {
        return spanSamples;
    }
    if (Number.isFinite(spanPercent) && length > 1) {
        return (spanPercent / 100) * (length - 1);
    }
    return null;
}

function resolveSideFalloff(length, baseEstimate, spanSamples, explicitFalloff) {
    if (Number.isFinite(explicitFalloff)) {
        return clampFalloff(explicitFalloff, length);
    }
    if (Number.isFinite(spanSamples)) {
        const derived = spanToFalloff(spanSamples, length);
        if (Number.isFinite(derived)) {
            return derived;
        }
    }
    return baseEstimate;
}

/**
 * Scale bell-curve widths on either side of the apex.
 * @param {number[]} samples - Curve samples (0-65535)
 * @param {number} apexIndex - Current apex sample index
 * @param {Object} factors - { leftFactor, rightFactor }
 * @param {Object} options - { leftSpanSamples, rightSpanSamples, leftSpanPercent, rightSpanPercent, falloffLeft, falloffRight, fallbackFalloff }
 * @returns {number[]} Scaled samples
 */
export function scaleBellCurve(samples, apexIndex, factors = {}, options = {}, previousFactors = null) {
    const sanitized = sanitizeSamples(samples);
    const length = sanitized.length;
    if (length < 8 || !Number.isFinite(apexIndex)) {
        return sanitized.slice();
    }

    const minApex = DEFAULT_MIN_APEX_INDEX;
    const maxApex = length - 1 - DEFAULT_MAX_MARGIN;
    const pivotIndex = clamp(apexIndex, minApex, maxApex);

    const leftFactor = clampFactor(Number.isFinite(factors.leftFactor) ? factors.leftFactor : 1);
    const rightFactor = clampFactor(Number.isFinite(factors.rightFactor) ? factors.rightFactor : 1);
    if (isApproximatelyOne(leftFactor) && isApproximatelyOne(rightFactor)) {
        return sanitized.slice();
    }

    const baseFalloffEstimate = clampFalloff(
        Number.isFinite(options.fallbackFalloff)
            ? options.fallbackFalloff
            : estimateFalloff(sanitized, pivotIndex),
        length
    );

    const leftSpanSamples = normalizeSpanSamples(
        options.leftSpanSamples,
        options.leftSpanPercent,
        length
    );
    const rightSpanSamples = normalizeSpanSamples(
        options.rightSpanSamples,
        options.rightSpanPercent,
        length
    );

    const leftFalloff = resolveSideFalloff(
        length,
        baseFalloffEstimate,
        leftSpanSamples,
        options.falloffLeft
    );
    const rightFalloff = resolveSideFalloff(
        length,
        baseFalloffEstimate,
        rightSpanSamples,
        options.falloffRight
    );

    const result = sanitized.slice();
    const prevLeftFactor = Number.isFinite(previousFactors?.leftFactor) ? clampFactor(previousFactors.leftFactor) : 1;
    const prevRightFactor = Number.isFinite(previousFactors?.rightFactor) ? clampFactor(previousFactors.rightFactor) : 1;

    for (let i = 1; i < length - 1; i += 1) {
        if (i === pivotIndex) {
            result[i] = sanitized[i];
            continue;
        }
        const distance = i - pivotIndex;
        const isLeft = distance < 0;
        const factor = isLeft ? leftFactor : rightFactor;
        const prevFactor = isLeft ? prevLeftFactor : prevRightFactor;
        if (isApproximatelyOne(factor) && isApproximatelyOne(prevFactor)) {
            result[i] = sanitized[i];
            continue;
        }
        const falloff = isLeft ? leftFalloff : rightFalloff;
        const weight = Math.exp(-Math.abs(distance) / falloff);
        const blendedPrev = 1 + ((prevFactor - 1) * weight);
        const blendedNext = 1 + ((factor - 1) * weight);
        if (isApproximatelyOne(blendedPrev) && isApproximatelyOne(blendedNext)) {
            result[i] = sanitized[i];
            continue;
        }
        if (isApproximatelyOne(blendedPrev / blendedNext)) {
            result[i] = sanitized[i];
            continue;
        }
        const ratio = blendedPrev / blendedNext;
        const sourceDistance = distance * ratio;
        const sourceIndex = clamp(pivotIndex + sourceDistance, 0, length - 1);
        result[i] = Math.round(linearSample(sanitized, sourceIndex));
    }

    // Preserve endpoints exactly so ink limits remain untouched.
    result[0] = sanitized[0];
    result[length - 1] = sanitized[length - 1];
    return result;
}

export function normalizeWidthFactor(value) {
    return clampFactor(value);
}
