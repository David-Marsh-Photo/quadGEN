// LAB Legacy Core Algorithm
// Pure port of the legacy LAB processing algorithm from quadgen.html
// Preserves exact mathematical formulas, constants, and logic flow

/**
 * Legacy LAB tuning constants (exact values from quadgen.html)
 */
export const LEGACY_LAB_CONSTANTS = {
    K_NEIGHBORS: 2,      // Number of nearest neighbors for sigma calculation
    SIGMA_FLOOR: 0.036,  // Minimum sigma value
    SIGMA_CEIL: 0.15,    // Maximum sigma value
    SIGMA_ALPHA: 2.0,    // Sigma scaling factor
    MAX_SMOOTHING: 90    // Maximum smoothing percentage
};

/**
 * Convert L* to CIE Y (exact legacy formula)
 * @param {number} L - L* value (0-100)
 * @returns {number} CIE Y value (0-1)
 */
export function lstarToY_CIE(L) {
    const l = Math.max(0, Math.min(100, Number(L)));
    if (l > 8) {
        const f = (l + 16) / 116;
        return f * f * f;
    } else {
        return l / 903.3;
    }
}

/**
 * Safe logarithm base 10 (exact legacy formula)
 * @param {number} x - Input value
 * @returns {number} Log10 value
 */
export function log10_safe(x) {
    const v = Math.max(1e-6, Math.min(1, x));
    return Math.log(v) / Math.LN10; // avoids older Math.log10 browser gaps
}

/**
 * Convert L* to unnormalized optical density (exact legacy formula)
 * @param {number} L - L* value (0-100)
 * @returns {number} Optical density value
 */
export function cieDensityFromLstar(L) {
    const Y = lstarToY_CIE(L);
    return -log10_safe(Y);
}

/**
 * Clamp value to 0-1 range (exact legacy formula)
 * @param {number} x - Input value
 * @returns {number} Clamped value (0-1)
 */
export function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

/**
 * Generate correction points from LAB measurement data (exact legacy logic)
 * @param {Array} dataPoints - Original LAB measurement points
 * @param {Function} getTargetRelAt - Target density function
 * @returns {Object} Correction points and metadata
 */
export function generateCorrectionPoints(dataPoints, getTargetRelAt) {
    if (!Array.isArray(dataPoints) || dataPoints.length === 0) {
        throw new Error('Invalid LAB data points');
    }

    // Sort data points by input value
    const sortedPoints = Array.from(dataPoints).map(p => ({
        input: p.input,
        lab: p.lab
    }));
    sortedPoints.sort((a, b) => a.input - b.input);

    // Convert LAB L* values to densities
    const labValues = sortedPoints.map(p => p.lab);
    const D_values = labValues.map(L => cieDensityFromLstar(L));
    const Dmax = Math.max(...D_values, 1e-6);

    // Generate correction points
    const correctionPoints = sortedPoints.map(point => {
        const position = clamp01(point.input / 100);
        const actualDensity = cieDensityFromLstar(point.lab) / Dmax;
        const expectedDensity = getTargetRelAt(position);
        const correction = expectedDensity - actualDensity;

        return {
            position,
            correction,
            originalLab: point.lab,
            originalInput: point.input
        };
    });

    // Extract positions array for sigma calculations
    const positions = correctionPoints.map(p => p.position);

    return {
        correctionPoints,
        positions,
        Dmax
    };
}

/**
 * Calculate local sigma at position using K-nearest neighbors (exact legacy algorithm)
 * @param {number} t - Position (0-1)
 * @param {Array<number>} positionsOnly - Array of correction point positions
 * @param {Object} constants - LAB tuning constants
 * @returns {number} Local sigma value
 */
export function localSigmaAt(t, positionsOnly, constants = LEGACY_LAB_CONSTANTS) {
    const { K_NEIGHBORS, SIGMA_FLOOR, SIGMA_CEIL, SIGMA_ALPHA } = constants;

    const n = positionsOnly.length;
    if (n <= 1) return SIGMA_CEIL;

    // Binary search to find insertion index
    let lo = 0, hi = n;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (positionsOnly[mid] < t) lo = mid + 1;
        else hi = mid;
    }

    // Gather K nearest distances from neighbors around index
    const dists = [];
    let L = lo - 1, R = lo;
    while ((L >= 0 || R < n) && dists.length < K_NEIGHBORS) {
        const dl = (L >= 0) ? Math.abs(t - positionsOnly[L]) : Infinity;
        const dr = (R < n) ? Math.abs(t - positionsOnly[R]) : Infinity;

        if (dl <= dr) {
            if (Number.isFinite(dl)) dists.push(dl);
            L--;
        } else {
            if (Number.isFinite(dr)) dists.push(dr);
            R++;
        }
    }

    if (!dists.length) return SIGMA_CEIL;

    // Calculate median distance
    dists.sort((a, b) => a - b);
    const mid = dists.length >> 1;
    const median = (dists.length % 2 === 0) ?
        0.5 * (dists[mid - 1] + dists[mid]) :
        dists[mid];

    return Math.min(SIGMA_CEIL, Math.max(SIGMA_FLOOR, SIGMA_ALPHA * median));
}

/**
 * Generate 256-point curve using Gaussian weighting (exact legacy algorithm)
 * @param {Object} correctionData - Correction points and positions
 * @param {Function} localSigmaFunction - Function to calculate local sigma
 * @param {Object} constants - LAB tuning constants
 * @returns {Array<number>} 256-point curve (0-1 values)
 */
export function generate256PointCurve(correctionData, localSigmaFunction, constants = LEGACY_LAB_CONSTANTS) {
    const { correctionPoints } = correctionData;
    const samples = [];

    // Main generation loop - exact legacy algorithm
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        const sigma = localSigmaFunction(t);
        const denom = 2 * sigma * sigma;
        let num = 0, den = 0;

        // Apply Gaussian weights to all correction points
        for (let j = 0; j < correctionPoints.length; j++) {
            const d = Math.abs(t - correctionPoints[j].position);
            const w = Math.exp(-(d * d) / Math.max(1e-9, denom));
            num += correctionPoints[j].correction * w;
            den += w;
        }

        // Calculate corrected position
        const correction = den > 0 ? (num / den) : 0;
        samples.push(clamp01(t + correction));
    }

    // Anchor endpoints (exact legacy behavior)
    samples[0] = 0.0;
    samples[255] = 1.0;

    return samples;
}

/**
 * Generate control points with smoothing (exact legacy getSmoothingControlPoints)
 * @param {Object} correctionData - Correction points and positions
 * @param {number} smoothingPercent - Smoothing percentage (0-90)
 * @param {Object} constants - LAB tuning constants
 * @returns {Object} Control points data
 */
export function generateSmoothingControlPoints(correctionData, smoothingPercent = 30, constants = LEGACY_LAB_CONSTANTS) {
    const { correctionPoints, positions } = correctionData;
    const { SIGMA_FLOOR, SIGMA_CEIL, MAX_SMOOTHING } = constants;

    // Clamp smoothing percentage
    const sp = Math.max(0, Math.min(MAX_SMOOTHING, Number(smoothingPercent) || 0));

    // Calculate widen factor (exact legacy formula)
    const widen = 1 + (sp / 100);

    // Generate 256-point dynamic curve with widened sigma
    const dyn = new Array(256);

    for (let i = 0; i < 256; i++) {
        const t = i / 255;

        // Calculate widened sigma (exact legacy formula)
        const baseSigma = localSigmaAt(t, positions, constants);
        const sigma = Math.min(SIGMA_CEIL, Math.max(SIGMA_FLOOR, baseSigma * widen));

        const denom = 2 * sigma * sigma;
        let num = 0, den = 0;

        // Apply Gaussian weights with widened sigma
        for (let j = 0; j < correctionPoints.length; j++) {
            const d = Math.abs(t - correctionPoints[j].position);
            const w = Math.exp(-(d * d) / Math.max(1e-9, denom));
            num += correctionPoints[j].correction * w;
            den += w;
        }

        const correction = den > 0 ? (num / den) : 0;
        dyn[i] = clamp01(t + correction);
    }

    // Anchor endpoints
    dyn[0] = 0.0;
    dyn[255] = 1.0;

    // Control point count calculation (exact legacy formula)
    const K = 21 - Math.floor(sp / 10);
    const controlPointCount = Math.max(3, K);

    // Extract control points
    const cpY = [];
    const cpX = [];

    for (let i = 0; i < controlPointCount; i++) {
        const x = i / (controlPointCount - 1);
        const idx = Math.round(x * 255);
        cpX.push(x);
        cpY.push(dyn[idx]);
    }

    return {
        samples: cpY,
        xCoords: cpX,
        controlPointCount,
        needsDualTransformation: false,
        influenceRadius: null,
        fullCurve: dyn // Include full 256-point curve
    };
}

/**
 * Get target density function (placeholder - will be connected to actual contrast intent)
 * @param {number} t - Position (0-1)
 * @returns {number} Target density
 */
export function getDefaultTargetRelAt(t) {
    // Linear fallback - will be replaced with actual contrast intent function
    return clamp01(t);
}

// Export for debugging and testing
export const legacyLabCore = {
    constants: LEGACY_LAB_CONSTANTS,
    lstarToY_CIE,
    log10_safe,
    cieDensityFromLstar,
    clamp01,
    generateCorrectionPoints,
    localSigmaAt,
    generate256PointCurve,
    generateSmoothingControlPoints,
    getDefaultTargetRelAt
};