// Bell Curve Shift Helper
// Provides weighted apex shift for bell-shaped curves without distorting tails.

const MAX_VALUE = 65535;
const DEFAULT_MIN_APEX_INDEX = 4;
const DEFAULT_MAX_MARGIN = 4;

function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
}

function sanitizeSamples(samples) {
    if (!samples || typeof samples.length !== 'number') {
        return [];
    }
    const length = samples.length >>> 0;
    const result = new Array(length);
    for (let i = 0; i < length; i += 1) {
        const numeric = Number(samples[i]);
        if (!Number.isFinite(numeric)) {
            result[i] = 0;
        } else if (numeric < 0) {
            result[i] = 0;
        } else if (numeric > MAX_VALUE) {
            result[i] = MAX_VALUE;
        } else {
            result[i] = numeric;
        }
    }
    return result;
}

function linearSample(values, position) {
    const length = values.length;
    if (length === 0) return 0;
    const clamped = clamp(position, 0, length - 1);
    const left = Math.floor(clamped);
    const right = Math.min(length - 1, left + 1);
    const t = clamped - left;
    if (t <= 1e-6 || left === right) return values[left];
    return (values[left] * (1 - t)) + (values[right] * t);
}

function estimateFalloff(values, apexIndex) {
    const length = values.length;
    if (!length) return 12;
    const apexValue = values[apexIndex] || 1;
    if (apexValue <= 0) return 12;
    const threshold = apexValue * 0.2;
    let left = apexIndex;
    let right = apexIndex;
    while (left > 0 && values[left] > threshold) left -= 1;
    while (right < length - 1 && values[right] > threshold) right += 1;
    const span = Math.max(6, right - left);
    return span * 0.45;
}

/**
 * Shift a bell curve horizontally by weighting distances from the apex.
 * @param {number[]} samples - Curve samples (0-65535 range expected)
 * @param {number} apexIndex - Current apex sample index
 * @param {number} deltaPercent - Desired apex shift in input percent (−100..100)
 * @param {Object} options - Additional tuning options
 * @returns {number[]} Shifted samples
 */
export function shiftBellCurve(samples, apexIndex, deltaPercent, options = {}) {
    const sanitized = sanitizeSamples(samples);
    const length = sanitized.length;
    if (length < 8 || !Number.isFinite(apexIndex)) {
        return sanitized.slice();
    }

    const minApex = DEFAULT_MIN_APEX_INDEX;
    const maxApex = length - 1 - DEFAULT_MAX_MARGIN;
    const clampedApex = clamp(apexIndex, minApex, maxApex);

    const deltaPercentNumber = Number(deltaPercent) || 0;
    if (Math.abs(deltaPercentNumber) < 1e-4) {
        return sanitized.slice();
    }

    const targetIndexFloat = clamp(
        clampedApex + ((deltaPercentNumber / 100) * (length - 1)),
        minApex,
        maxApex
    );
    const limitedDelta = targetIndexFloat - clampedApex;
    if (Math.abs(limitedDelta) < 1e-4) {
        return sanitized.slice();
    }

    const falloff = clamp(
        options.falloff || estimateFalloff(sanitized, clampedApex),
        4,
        length / 2
    );
    const strength = Number.isFinite(options.strength) ? options.strength : 1;

    const result = new Array(length);
    for (let i = 0; i < length; i += 1) {
        const distance = Math.abs(i - clampedApex);
        const weight = Math.exp(-distance / falloff) * strength;
        const shiftAmount = limitedDelta * weight;
        const sourceIndex = clamp(i - shiftAmount, 0, length - 1);
        result[i] = Math.round(linearSample(sanitized, sourceIndex));
    }

    // Preserve endpoints exactly so ink limits stay intact.
    result[0] = sanitized[0];
    result[length - 1] = sanitized[length - 1];
    return result;
}

export function clampInputPercent(percent) {
    if (!Number.isFinite(percent)) return 0;
    if (percent < 0) return 0;
    if (percent > 100) return 100;
    return percent;
}
