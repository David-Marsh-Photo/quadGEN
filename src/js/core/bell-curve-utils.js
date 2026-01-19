// Shared helpers for bell-curve transforms (apex shift, width scaling, etc.)

import { clamp } from '../data/processing-utils.js';

export const MAX_CURVE_VALUE = 65535;

// Re-export clamp for backwards compatibility
export { clamp };

export function sanitizeSamples(samples) {
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
        } else if (numeric > MAX_CURVE_VALUE) {
            result[i] = MAX_CURVE_VALUE;
        } else {
            result[i] = numeric;
        }
    }
    return result;
}

export function linearSample(values, position) {
    const length = values.length;
    if (length === 0) return 0;
    const clamped = clamp(position, 0, length - 1);
    const left = Math.floor(clamped);
    const right = Math.min(length - 1, left + 1);
    const t = clamped - left;
    if (t <= 1e-6 || left === right) return values[left];
    return (values[left] * (1 - t)) + (values[right] * t);
}

/**
 * Compute PCHIP (monotone-preserving) slope at a point
 * Returns zero at local extrema to preserve monotonicity
 */
function pchipSlope(p0, p1, p2) {
    const d0 = p1 - p0;
    const d1 = p2 - p1;

    // Monotonicity-preserving: return 0 at extrema
    if (d0 * d1 <= 0) return 0;

    // Weighted harmonic mean of slopes (PCHIP formula)
    const w0 = 2 + 1;
    const w1 = 1 + 2;
    return (w0 + w1) / (w0 / d0 + w1 / d1);
}

/**
 * PCHIP (monotone cubic Hermite) interpolation for smooth resampling
 * Preserves curve shape better than linear interpolation
 * @param {number[]} samples - Source samples
 * @param {number} index - Fractional index to sample
 * @returns {number} Interpolated value
 */
export function pchipSample(samples, index) {
    if (!Array.isArray(samples) || samples.length === 0) return 0;
    if (samples.length === 1) return samples[0];

    const clamped = clamp(index, 0, samples.length - 1);
    const i = Math.floor(clamped);
    const t = clamped - i;

    if (t < 1e-9) return samples[i];
    if (i >= samples.length - 1) return samples[samples.length - 1];

    // Get 4 points for cubic interpolation (clamp at boundaries)
    const p0 = samples[Math.max(0, i - 1)];
    const p1 = samples[i];
    const p2 = samples[Math.min(samples.length - 1, i + 1)];
    const p3 = samples[Math.min(samples.length - 1, i + 2)];

    // PCHIP slopes (monotone-preserving)
    const d1 = pchipSlope(p0, p1, p2);
    const d2 = pchipSlope(p1, p2, p3);

    // Hermite basis functions
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * p1 + h10 * d1 + h01 * p2 + h11 * d2;
}

export function estimateFalloff(values, apexIndex) {
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

export function clampFalloff(value, length) {
    const half = Math.max(8, length / 2);
    if (!Number.isFinite(value)) {
        return Math.min(half, Math.max(4, half / 2));
    }
    return Math.min(Math.max(value, 4), half);
}

export function spanToFalloff(spanSamples, length) {
    if (!Number.isFinite(spanSamples) || spanSamples <= 0) {
        return null;
    }
    const scaled = spanSamples * 0.45;
    return clampFalloff(scaled, length);
}
