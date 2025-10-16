// Momentum helpers for composite LAB redistribution.
// Computes Gaussian-weighted derivative magnitudes so weighting modes can bias toward high-momentum channels.

import { clamp01 } from '../math/interpolation.js';

const DEFAULT_WINDOW_RADIUS = 2;
const DEFAULT_SIGMA = 1.0;

function buildGaussianKernel(windowRadius, sigma) {
    const radius = Math.max(0, Math.floor(Number.isFinite(windowRadius) ? windowRadius : DEFAULT_WINDOW_RADIUS));
    const effectiveSigma = Number.isFinite(sigma) && sigma > 0 ? sigma : (radius > 0 ? radius / 1.5 : DEFAULT_SIGMA);
    const kernel = [];
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
        const weight = Math.exp(-(offset * offset) / (2 * effectiveSigma * effectiveSigma));
        kernel.push(weight);
        sum += weight;
    }
    if (sum <= 0) {
        return { kernel: [1], radius: 0 };
    }
    return {
        kernel: kernel.map((weight) => weight / sum),
        radius
    };
}

function buildDeltaSeries(samples) {
    const length = samples.length;
    const deltas = new Array(length).fill(0);
    if (!length) {
        return deltas;
    }
    if (length === 1) {
        deltas[0] = 0;
        return deltas;
    }
    for (let i = 0; i < length; i += 1) {
        if (i === 0) {
            deltas[i] = samples[1] - samples[0];
        } else {
            deltas[i] = samples[i] - samples[i - 1];
        }
    }
    deltas[length - 1] = samples[length - 1] - samples[length - 2];
    return deltas;
}

function resolveDelta(deltas, index) {
    if (!deltas.length) return 0;
    if (index <= 0) return deltas[0];
    if (index >= deltas.length) return deltas[deltas.length - 1];
    return deltas[index];
}

export function computeGaussianMomentum(curve, options = {}) {
    if (!Array.isArray(curve) || !curve.length) {
        return [];
    }
    const samples = curve.map((value) => clamp01(Number.isFinite(value) ? value : 0));
    const deltas = buildDeltaSeries(samples);
    const { kernel, radius } = buildGaussianKernel(options.windowRadius, options.sigma);
    const length = samples.length;
    const result = new Array(length).fill(0);
    for (let i = 0; i < length; i += 1) {
        let momentum = 0;
        for (let k = -radius; k <= radius; k += 1) {
            const weight = kernel[k + radius];
            const delta = resolveDelta(deltas, i + k);
            momentum += weight * Math.abs(delta);
        }
        result[i] = momentum;
    }
    const maxMagnitude = result.reduce((max, value) => (value > max ? value : max), 0);
    if (maxMagnitude <= 0) {
        return result.fill(0);
    }
    return result.map((value) => clamp01(value / maxMagnitude));
}

export function computeChannelMomentum(curve, endValue, options = {}) {
    if (!Array.isArray(curve) || curve.length === 0 || !(Number.isFinite(endValue) && endValue > 0)) {
        return new Array(Array.isArray(curve) ? curve.length : 0).fill(0);
    }
    const normalized = curve.map((value) => clamp01((Number(value) || 0) / endValue));
    return computeGaussianMomentum(normalized, options);
}

