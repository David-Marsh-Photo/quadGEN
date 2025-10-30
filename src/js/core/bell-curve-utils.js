// Shared helpers for bell-curve transforms (apex shift, width scaling, etc.)

export const MAX_CURVE_VALUE = 65535;

export function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

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
