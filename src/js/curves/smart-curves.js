// quadGEN Smart Curves Management
// Smart Curve generation, key point management, and curve interpolation

import { CURVE_RESOLUTION, createLinearRamp } from '../data/processing-utils.js';
import { createPCHIPSpline } from '../math/interpolation.js';
import { getLoadedQuadData, ensureLoadedQuadData, TOTAL, elements } from '../core/state.js';
import { LinearizationState, markLinearizationEdited } from '../data/linearization-utils.js';
import { InputValidator } from '../core/validation.js';
import { triggerInkChartUpdate, triggerProcessingDetail, triggerRevertButtonsUpdate, triggerPreviewUpdate } from '../ui/ui-hooks.js';
import { make256 } from '../core/processing-pipeline.js';
import { isEditModeEnabled } from '../ui/edit-mode.js';
import { getHistoryManager } from '../core/history-manager.js';
import { updateAppState, getAppState } from '../core/state.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

/**
 * Smart Curve simplification configuration
 */
export const KP_SIMPLIFY = {
    maxErrorPercent: 0.25,
    maxPoints: 21
};

/**
 * Maximum points for direct seeding from ACV files
 */
export const DIRECT_SEED_MAX_POINTS = 21;

/**
 * Control point policy configuration
 */
export const ControlPolicy = {
    minGap: 0.01,
    yMin: 0,
    yMax: 100,
    defaultTolerance: 1.0,
    endpointsLocked: true,

    /**
     * Clamp Y coordinate to valid range
     * @param {number} y - Y coordinate
     * @returns {number} Clamped Y coordinate
     */
    clampY(y) {
        return Math.max(this.yMin, Math.min(this.yMax, y));
    },

    /**
     * Clamp X coordinate to valid range
     * @param {number} x - X coordinate
     * @returns {number} Clamped X coordinate
     */
    clampX(x) {
        return Math.max(0, Math.min(100, x));
    }
};

const DENOM = CURVE_RESOLUTION - 1;

function getChannelRow(channelName) {
    if (typeof document === 'undefined') return null;
    try {
        return document.querySelector(`tr[data-channel="${channelName}"]`);
    } catch (err) {
        return null;
    }
}

/**
 * Control Points management facade for Smart Curves
 */
export const ControlPoints = {
    /**
     * Get current Smart Curve control points and interpolation for channel
     * @param {string} channelName - Channel name
     * @returns {Object} Points and interpolation data
     */
    get(channelName) {
        const loadedData = getLoadedQuadData();
        const pts = loadedData?.keyPoints?.[channelName] || null;
        const interpolation = loadedData?.keyPointsMeta?.[channelName]?.interpolationType || 'smooth';
        return {
            points: pts ? pts.map(p => ({ input: p.input, output: p.output })) : null,
            interpolation
        };
    },

    /**
     * Normalize control points: clamp, sort by X, and enforce minimum gap
     * @param {Array} points - Array of {input, output} points
     * @returns {Array} Normalized points
     */
    normalize(points) {
        if (!Array.isArray(points)) return [];

        const clamped = points.map(p => ({
            input: ControlPolicy.clampX(Number(p.input)),
            output: ControlPolicy.clampY(Number(p.output))
        }));

        clamped.sort((a, b) => a.input - b.input);

        // Enforce minimum gap between points
        for (let i = 1; i < clamped.length; i++) {
            if (clamped[i].input <= clamped[i - 1].input) {
                clamped[i].input = Math.min(100, clamped[i - 1].input + ControlPolicy.minGap);
            }
        }

        return clamped;
    },

    /**
     * Persist control points to global storage
     * @param {string} channelName - Channel name
     * @param {Array} points - Control points
     * @param {string} interpolation - Interpolation type
     */
    persist(channelName, points, interpolation = 'smooth') {
        const loadedData = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {} }));
        if (!loadedData.keyPoints) loadedData.keyPoints = {};
        if (!loadedData.keyPointsMeta) loadedData.keyPointsMeta = {};

        loadedData.keyPoints[channelName] = points.map(p => ({
            input: p.input,
            output: p.output
        }));

        // Preserve existing metadata (e.g., bakedGlobal) and update interpolation only
        const prevMeta = loadedData.keyPointsMeta[channelName] || {};
        loadedData.keyPointsMeta[channelName] = {
            ...prevMeta,
            interpolationType: (interpolation === 'linear' ? 'linear' : 'smooth')
        };
    },

    /**
     * Sample Y value at X using current points and interpolation
     * @param {Array} points - Control points
     * @param {string} interpolation - Interpolation type
     * @param {number} x - X coordinate to sample
     * @returns {number} Interpolated Y value
     */
    sampleY(points, interpolation, x) {
        if (!Array.isArray(points) || points.length === 0) return 0;

        const xs = points.map(p => p.input);
        const ys = points.map(p => p.output);
        const xi = ControlPolicy.clampX(x);

        if (interpolation === 'linear') {
            // Linear interpolation
            if (xi <= xs[0]) return ys[0];
            if (xi >= xs[xs.length - 1]) return ys[ys.length - 1];

            let i = 0;
            while (i < xs.length - 1 && xs[i + 1] < xi) i++;

            const x0 = xs[i], x1 = xs[i + 1];
            const y0 = ys[i], y1 = ys[i + 1];
            const t = (xi - x0) / (x1 - x0);
            return y0 + t * (y1 - y0);
        } else {
            // PCHIP interpolation
            try {
                const pchip = createPCHIPSpline(xs, ys);
                return pchip(xi);
            } catch (error) {
                console.warn('PCHIP interpolation failed, falling back to linear:', error);
                return this.sampleY(points, 'linear', x);
            }
        }
    },

    /**
     * Find nearest control point index to X coordinate within tolerance
     * @param {Array} points - Control points
     * @param {number} x - X coordinate
     * @param {number} tolerance - Search tolerance
     * @returns {Object} Nearest point info
     */
    nearestIndex(points, x, tolerance = ControlPolicy.defaultTolerance) {
        const xi = ControlPolicy.clampX(x);
        let best = { index: -1, delta: Infinity, input: 0 };

        points.forEach((p, i) => {
            const d = Math.abs(p.input - xi);
            if (d < best.delta) {
                best = { index: i, delta: d, input: p.input };
            }
        });

        return best.delta <= tolerance ? best : { index: -1, delta: Infinity, input: 0 };
    }
};

/**
 * Check if a source tag indicates a Smart Curve
 * @param {string} tag - Source tag
 * @returns {boolean} True if Smart Curve tag
 */
export function isSmartCurveSourceTag(tag) {
    return tag === 'smart' || tag === 'ai';
}

/**
 * Check if a channel has a Smart Curve AND edit mode is enabled
 * Smart curves should only be applied when edit mode is active
 * @param {string} channelName - Channel name
 * @returns {boolean} True if channel has Smart Curve and edit mode is enabled
 */
export function isSmartCurve(channelName) {
    try {
        const tag = getLoadedQuadData()?.sources?.[channelName];
        return isSmartCurveSourceTag(tag);
    } catch (err) {
        return false;
    }
}

/**
 * Generate curve from control points
 * @param {Array} keyPoints - Control points [{input, output}]
 * @param {string} interpolationType - Interpolation type ('smooth' or 'linear')
 * @param {number} resolution - Output resolution (default 256)
 * @returns {Array<number>} Generated curve values
 */
export function generateCurveFromKeyPoints(keyPoints, interpolationType = 'smooth', resolution = CURVE_RESOLUTION) {
    if (!Array.isArray(keyPoints) || keyPoints.length < 2) {
        return createLinearRamp(resolution, 0, 100);
    }

    const normalizedPoints = ControlPoints.normalize(keyPoints);
    const curve = new Array(resolution);

    for (let i = 0; i < resolution; i++) {
        const x = (i / (resolution - 1)) * 100; // 0-100 range
        curve[i] = ControlPoints.sampleY(normalizedPoints, interpolationType, x);
    }

    return curve;
}

function perpendicularDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
        const ux = point.x - a.x;
        const uy = point.y - a.y;
        return Math.hypot(ux, uy);
    }
    return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / Math.hypot(dx, dy);
}

function rdpSimplify(points, eps) {
    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;

    (function simplify(first, last) {
        if (last <= first + 1) return;
        const a = points[first];
        const b = points[last];
        let maxDistance = -1;
        let idx = -1;

        for (let i = first + 1; i < last; i++) {
            const distance = perpendicularDistance(points[i], a, b);
            if (distance > maxDistance) {
                maxDistance = distance;
                idx = i;
            }
        }

        if (maxDistance > eps) {
            keep[idx] = true;
            simplify(first, idx);
            simplify(idx, last);
        }
    })(0, points.length - 1);

    const out = [];
    for (let i = 0; i < points.length; i++) {
        if (keep[i]) out.push(points[i]);
    }
    return out;
}

/**
 * Extract adaptive key points from curve values using RDP simplification
 * @param {number[]} values - Curve values (0..65535 scale)
 * @param {Object} options - Simplification options
 * @returns {Array<{input:number, output:number}>} Simplified key points
 */
export function extractAdaptiveKeyPointsFromValues(values, options = {}) {
    const maxErrorPercent = Math.max(0.05, Math.min(5, options.maxErrorPercent || KP_SIMPLIFY.maxErrorPercent || 1.0));
    const maxPoints = Math.max(2, Math.min(21, options.maxPoints || KP_SIMPLIFY.maxPoints || 21));
    const scaleMax = Math.max(1, options.scaleMax || TOTAL);

    if (!Array.isArray(values) || values.length < 2) {
        return [{ input: 0, output: 0 }, { input: 100, output: 100 }];
    }

    const N = values.length;
    const peak = Math.max(0, ...values);
    if (peak <= 0) {
        return [{ input: 0, output: 0 }, { input: 100, output: 100 }];
    }

    const pts = new Array(N);
    for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 100;
        const normalized = peak > 0 ? values[i] / scaleMax : 0;
        const y = Math.max(0, Math.min(100, normalized * 100));
        pts[i] = { x, y };
    }

    const EPS = 0.002;
    const samplesIdx = [];
    for (let k = 0; k <= 10; k++) {
        samplesIdx.push(Math.round((N - 1) * (k / 10)));
    }
    const isLinear = samplesIdx.every((idx) => {
        const expected = idx / (N - 1);
        const actual = values[idx] / peak;
        return Math.abs(actual - expected) <= EPS;
    });

    if (isLinear) {
        return [{ input: 0, output: 0 }, { input: 100, output: 100 }];
    }

    let epsilon = maxErrorPercent;
    let simplified = rdpSimplify(pts, epsilon);
    let guard = 0;
    while (simplified.length > maxPoints && guard < 8) {
        epsilon *= 1.3;
        simplified = rdpSimplify(pts, epsilon);
        guard += 1;
    }

    const keyPoints = simplified.map((p) => ({ input: p.x, output: p.y }));
    return ControlPoints.normalize(keyPoints);
}

/**
 * Rescale Smart Curve key points for new ink limit
 * @param {string} channelName - Channel name
 * @param {number} fromPercent - Previous ink limit percentage
 * @param {number} toPercent - New ink limit percentage
 * @returns {boolean} True if rescaling was applied
 */
export function rescaleSmartCurveForInkLimit(channelName, fromPercent, toPercent) {
    if (!isSmartCurve(channelName) || fromPercent <= 0 || toPercent <= 0) {
        return false;
    }

    const { points, interpolation } = ControlPoints.get(channelName);
    if (!points || points.length === 0) return false;

    const scaleFactor = toPercent / fromPercent;
    const rescaledPoints = points.map((p) => ({
        input: p.input,
        output: Math.min(100, p.output * scaleFactor)
    }));

    const result = setSmartKeyPoints(channelName, rescaledPoints, interpolation);
    return !!result.success;
}

/**
 * Create default Smart Curve key points
 * @param {number} startY - Starting Y value (default 0)
 * @param {number} endY - Ending Y value (default 100)
 * @returns {Array} Default key points
 */
export function createDefaultKeyPoints(startY = 0, endY = 100) {
    return [
        { input: 0, output: startY },
        { input: 100, output: endY }
    ];
}

/**
 * Validate key points array
 * @param {Array} keyPoints - Key points to validate
 * @returns {Object} Validation result
 */
export function validateKeyPoints(keyPoints) {
    if (!Array.isArray(keyPoints)) {
        return {
            valid: false,
            message: 'Key points must be an array'
        };
    }

    if (keyPoints.length < 2) {
        return {
            valid: false,
            message: 'At least 2 key points required'
        };
    }

    for (let i = 0; i < keyPoints.length; i++) {
        const point = keyPoints[i];
        if (!point || typeof point !== 'object') {
            return {
                valid: false,
                message: `Point ${i} is not an object`
            };
        }

        if (typeof point.input !== 'number' || typeof point.output !== 'number') {
            return {
                valid: false,
                message: `Point ${i} must have numeric input and output`
            };
        }

        if (!isFinite(point.input) || !isFinite(point.output)) {
            return {
                valid: false,
                message: `Point ${i} has non-finite values`
            };
        }

        if (point.input < 0 || point.input > 100 || point.output < 0 || point.output > 100) {
            return {
                valid: false,
                message: `Point ${i} values outside 0-100 range`
            };
        }
    }

    return {
        valid: true,
        message: 'Key points are valid'
    };
}

/**
 * Normalize Smart Curve sources in loaded data
 * Converts legacy 'ai' tags to 'smart'
 */
export function normalizeSmartSourcesInLoadedData() {
    const loadedData = getLoadedQuadData();
    if (!loadedData?.sources) return;

    const sources = loadedData.sources;
    for (const [channel, tag] of Object.entries(sources)) {
        if (tag === 'ai') {
            sources[channel] = 'smart';
        }
    }
}

/**
 * Smart Curve editing operations
 * These functions provide the key point editing capabilities for Smart Curves
 */

/**
 * Ensure Smart key points exist for a channel; create them from current curve if needed
 * This implements the "silent conversion" logic from the legacy system
 * @param {string} channelName - Channel name
 * @param {string} interpolationType - Interpolation type ('smooth' or 'linear')
 * @returns {Object} Result with success flag and message
 */
function ensureEditableKeyPointsForChannel(channelName, interpolationType = 'smooth') {
    try {
        // Check if key points already exist
        const existing = ControlPoints.get(channelName).points;
        if (existing && existing.length >= 2) {
            return { success: true };
        }

        // Get current channel end value
        const channelRows = Array.from(elements.rows?.children || []);
        const row = channelRows.find(r => r.getAttribute('data-channel') === channelName);
        const endInput = row?.querySelector('.end-input');
        const endVal = endInput ? InputValidator.clampEnd(endInput.value) : 65535;
        const sampleEnd = endVal > 0 ? endVal : 65535;

        // Generate current curve values using global function
        const values = make256(sampleEnd, channelName, true);

        // Create simplified key points from the curve using adaptive algorithm
        const candidate = extractAdaptiveKeyPointsFromValues(values, {
            maxErrorPercent: 0.25,
            maxPoints: 21
        });

        if (candidate.length < 2) {
            return { success: false, message: 'Failed to generate Smart key points from curve' };
        }

        // Store the generated key points
        ControlPoints.persist(channelName, candidate, interpolationType);

        return { success: true };
    } catch (error) {
        console.warn(`Error ensuring Smart key points for ${channelName}:`, error);
        return { success: false, message: `Error creating Smart key points: ${error.message}` };
    }
}


/**
 * Adjust a single Smart key point by ordinal (1-based, endpoints included)
 * @param {string} channelName - Channel name to edit
 * @param {number} ordinal - 1-based ordinal of key point
 * @param {Object} params - Edit parameters
 * @param {number} [params.inputPercent] - Absolute input percentage (0-100)
 * @param {number} [params.outputPercent] - Absolute output percentage (0-100)
 * @param {number} [params.deltaInput] - Delta change to input
 * @param {number} [params.deltaOutput] - Delta change to output
 * @returns {Object} Edit result with success/message
 */
export function adjustSmartKeyPointByIndex(channelName, ordinal, params = {}) {
    if (!channelName || typeof ordinal !== 'number' || ordinal < 1) {
        return { success: false, message: 'Invalid channel name or ordinal' };
    }

    let { points: kp, interpolation: interpType } = ControlPoints.get(channelName);
    if (!kp || kp.length < 2) {
        // Silent conversion: auto-create Smart key points from current curve
        const ensured = ensureEditableKeyPointsForChannel(channelName, 'smooth');
        if (!ensured.success) {
            return { success: false, message: ensured.message || `No Smart key points stored for ${channelName}.` };
        }
        ({ points: kp, interpolation: interpType } = ControlPoints.get(channelName));
    }

    if (ordinal > kp.length) {
        return { success: false, message: `Invalid ordinal ${ordinal}. Valid range: 1..${kp.length}` };
    }

    const points = kp.map(p => ({ input: p.input, output: p.output }));
    const idx = ordinal - 1;
    const target = points[idx];

    // Compute new values
    let newInput = target.input;
    let newOutput = target.output;

    if (typeof params.inputPercent === 'number') {
        newInput = params.inputPercent;
    }
    if (typeof params.deltaInput === 'number') {
        newInput += params.deltaInput;
    }
    if (typeof params.outputPercent === 'number') {
        newOutput = params.outputPercent;
    }
    if (typeof params.deltaOutput === 'number') {
        newOutput += params.deltaOutput;
    }

    // Clamp values
    newOutput = ControlPolicy.clampY(newOutput);

    // Bounds for input to maintain order
    const gap = ControlPolicy.minGap;
    const prevX = idx > 0 ? points[idx - 1].input : 0;
    const nextX = idx < points.length - 1 ? points[idx + 1].input : 100;
    const minX = idx === 0 ? 0 : prevX + gap;
    const maxX = idx === points.length - 1 ? 100 : nextX - gap;
    newInput = Math.max(minX, Math.min(maxX, newInput));

    // Apply changes
    points[idx] = { input: newInput, output: newOutput };

    // Normalize and persist
    const normalizedPoints = ControlPoints.normalize(points);
    ControlPoints.persist(channelName, normalizedPoints, interpType);
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[SMART CURVES] adjustSmartKeyPointByIndex normalized points', {
            channelName,
            ordinal,
            interpType,
            newInput,
            newOutput,
            pointCount: normalizedPoints.length
        });
    }

    const data = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {} }));
    if (!data.curves) data.curves = {};

    const samples = new Array(CURVE_RESOLUTION);
    for (let i = 0; i < CURVE_RESOLUTION; i++) {
        const xi = (i / DENOM) * 100;
        const percent = ControlPoints.sampleY(normalizedPoints, interpType, xi);
        const clamped = Math.max(0, Math.min(100, percent));
        samples[i] = Math.round((clamped / 100) * TOTAL);
    }
    data.curves[channelName] = samples;

    if (!data.sources) data.sources = {};
    data.sources[channelName] = 'smart';

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[SMART CURVES] persisted samples after adjust', {
            channelName,
            first: samples[0],
            mid: samples[128],
            last: samples[255]
        });
    }

    return {
        success: true,
        message: `Adjusted key point ${ordinal} for ${channelName}`,
        channelName,
        ordinal,
        newPoint: { input: newInput, output: newOutput }
    };
}

/**
 * Insert a new Smart key point at a specific input percentage
 * @param {string} channelName - Channel name
 * @param {number} inputPercent - Input percentage (0-100)
 * @param {number} [outputPercent] - Output percentage, or null to sample curve
 * @returns {Object} Insert result with success/message
 */
export function insertSmartKeyPointAt(channelName, inputPercent, outputPercent = null) {
    if (!channelName || typeof inputPercent !== 'number') {
        return { success: false, message: 'Invalid channel name or input percentage' };
    }

    const x = ControlPolicy.clampX(inputPercent);
    let { points: kp, interpolation: interpType } = ControlPoints.get(channelName);

    if (!kp || kp.length < 2) {
        // Silent conversion: auto-create Smart key points from current curve
        const ensured = ensureEditableKeyPointsForChannel(channelName, 'smooth');
        if (!ensured.success) {
            return { success: false, message: ensured.message || `No Smart key points stored for ${channelName}.` };
        }
        ({ points: kp, interpolation: interpType } = ControlPoints.get(channelName));
    }

    // Check for existing point at this location
    const existing = ControlPoints.nearestIndex(kp, x, 0.5); // 0.5% tolerance
    if (existing.index !== -1) {
        return { success: false, message: `A key point already exists near ${x}%` };
    }

    const points = kp.map(p => ({ input: p.input, output: p.output }));
    points.sort((a, b) => a.input - b.input);

    // Determine output value
    let y = outputPercent;
    if (y === null || y === undefined) {
        // Sample current curve at x
        y = ControlPoints.sampleY(points, interpType, x);
    }
    y = ControlPolicy.clampY(y);

    // Find insertion position
    let insertIndex = 0;
    while (insertIndex < points.length && points[insertIndex].input < x) {
        insertIndex++;
    }

    // Check spacing requirements
    const gap = ControlPolicy.minGap;
    const left = insertIndex > 0 ? points[insertIndex - 1] : null;
    const right = insertIndex < points.length ? points[insertIndex] : null;

    if (left && (x - left.input) < gap) {
        return { success: false, message: `Too close to existing point at ${left.input}%` };
    }
    if (right && (right.input - x) < gap) {
        return { success: false, message: `Too close to existing point at ${right.input}%` };
    }

    // Insert the new point
    points.splice(insertIndex, 0, { input: x, output: y });

    const result = setSmartKeyPoints(channelName, points, interpType, {
        historyExtras: {
            insertedPoint: { input: x, output: y },
            insertedIndex: insertIndex + 1,
            selectedOrdinalAfter: insertIndex + 1
        }
    });

    if (!result.success) {
        return result;
    }

    return {
        ...result,
        message: `Inserted key point at ${x}% for ${channelName}`,
        channelName,
        insertIndex: insertIndex + 1,
        newPoint: { input: x, output: y }
    };
}

/**
 * Delete a Smart key point by ordinal (1-based)
 * @param {string} channelName - Channel name
 * @param {number} ordinal - 1-based ordinal of key point to delete
 * @param {Object} [options] - Options object
 * @param {boolean} [options.allowEndpoint=false] - Allow deleting endpoints
 * @returns {Object} Delete result with success/message
 */
export function deleteSmartKeyPointByIndex(channelName, ordinal, options = {}) {
    if (!channelName || typeof ordinal !== 'number' || ordinal < 1) {
        return { success: false, message: 'Invalid channel name or ordinal' };
    }

    const { points: kp, interpolation: interpType } = ControlPoints.get(channelName);
    if (!kp || kp.length < 2) {
        return { success: false, message: `No Smart key points exist for ${channelName}` };
    }

    if (ordinal > kp.length) {
        return { success: false, message: `Invalid ordinal ${ordinal}. Valid range: 1..${kp.length}` };
    }

    if (kp.length <= 2) {
        return { success: false, message: 'Cannot delete - at least 2 key points required' };
    }

    const idx = ordinal - 1;
    const isEndpoint = (idx === 0 || idx === kp.length - 1);

    if (isEndpoint && !options.allowEndpoint) {
        return { success: false, message: 'Cannot delete endpoint - set allowEndpoint=true to override' };
    }

    const points = kp.map(p => ({ input: p.input, output: p.output }));
    const deletedPoint = points[idx];

    // Remove the point and apply updated set
    points.splice(idx, 1);

    const nextOrdinalAfterDelete = Math.max(1, Math.min(rawOrdinal, points.length));
    const result = setSmartKeyPoints(channelName, points, interpType, {
        historyExtras: {
            deletedOrdinal: rawOrdinal,
            deletedPoint,
            selectedOrdinalAfter: nextOrdinalAfterDelete
        }
    });
    if (!result.success) {
        return result;
    }

    return {
        ...result,
        message: `Deleted key point ${ordinal} from ${channelName}`,
        deletedOrdinal: ordinal,
        deletedPoint
    };
}

/**
 * Simplify Smart key points from current curve data (recompute)
 * @param {string} channelName - Channel name
 * @param {Object} [options] - Simplification options
 * @param {number} [options.maxErrorPercent] - Maximum error percentage
 * @param {number} [options.maxPoints] - Maximum number of points
 * @returns {Object} Simplify result with success/message
 */
export function simplifySmartKeyPointsFromCurve(channelName, options = {}) {
    if (!channelName) {
        return { success: false, message: 'Channel name required' };
    }

    const maxErrorPercent = Math.max(0.05, Math.min(5, options.maxErrorPercent || KP_SIMPLIFY.maxErrorPercent));
    const maxPoints = Math.max(2, Math.min(21, options.maxPoints || KP_SIMPLIFY.maxPoints));

    try {
        if (typeof isEditModeEnabled === 'function') {
            if (!isEditModeEnabled()) {
                return { success: false, message: 'Edit mode is off — enable Edit Curves to edit.' };
            }
        }

        if (typeof make256 !== 'function') {
            console.warn(`[RECOMPUTE] ${channelName}: make256 not available, using linear fallback`);
            const fallbackPoints = createLinearRamp(CURVE_RESOLUTION, 0, TOTAL);
            const keyPointsFallback = extractAdaptiveKeyPointsFromValues(fallbackPoints, {
                maxErrorPercent,
                maxPoints
            });
            return applySmartKeyPointsInternal(channelName, keyPointsFallback, 'smooth');
        }

        const row = getChannelRow(channelName);
        const endValue = row ? InputValidator.clampEnd(row.querySelector('.end-input')?.value || TOTAL) : TOTAL;
        const rawCurveValues = make256(endValue, channelName, false);

        const keyPoints = extractAdaptiveKeyPointsFromValues(rawCurveValues, {
            maxErrorPercent,
            maxPoints
        });

        if (!keyPoints || keyPoints.length < 2) {
            return { success: false, message: 'Failed to generate sufficient key points' };
        }

        const result = applySmartKeyPointsInternal(channelName, keyPoints, 'smooth');
        if (!result.success) {
            return result;
        }

        const autoWhiteOn = !!elements?.autoWhiteLimitToggle?.checked;
        const autoBlackOn = !!elements?.autoBlackLimitToggle?.checked;
        const globalActive = !!(LinearizationState.globalApplied && LinearizationState.getGlobalData());

        const data = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {} }));
        data.keyPointsMeta = data.keyPointsMeta || {};
        data.keyPointsMeta[channelName] = {
            ...(data.keyPointsMeta[channelName] || {}),
            bakedGlobal: globalActive,
            bakedAutoLimit: autoWhiteOn || autoBlackOn,
            bakedAutoWhite: autoWhiteOn,
            bakedAutoBlack: autoBlackOn
        };

        if (globalActive) {
            const history = getHistoryManager?.();
            if (history && Array.isArray(history.history)) {
                try {
                    for (let i = history.history.length - 1; i >= 0; i--) {
                        const entry = history.history[i];
                        if (entry && entry.kind === 'channel') {
                            const action = entry.action;
                            if (action && action.type === 'curve' && action.channelName === channelName) {
                                action.newBakedGlobal = true;
                                break;
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[SMART CURVES] Failed to annotate history bakedGlobal flag:', err);
                }
            }
        }

        return {
            ...result,
            message: `Recomputed ${result.keyPointCount} key points for ${channelName}`
        };
    } catch (error) {
        return { success: false, message: `Recompute failed: ${error.message}` };
    }
}

/**
 * Insert a Smart key point between two ordinals
 * @param {string} channelName - Channel name
 * @param {number} leftOrdinal - Left ordinal (1-based)
 * @param {number} rightOrdinal - Right ordinal (1-based)
 * @param {number} [outputPercent] - Output percentage, or null to sample midpoint
 * @returns {Object} Insert result
 */
export function insertSmartKeyPointBetween(channelName, leftOrdinal, rightOrdinal, outputPercent = null) {
    if (!channelName || typeof leftOrdinal !== 'number' || typeof rightOrdinal !== 'number') {
        return { success: false, message: 'Invalid parameters' };
    }

    const { points: kp, interpolation: interpType } = ControlPoints.get(channelName);
    if (!kp || kp.length < 2) {
        return { success: false, message: `No Smart key points exist for ${channelName}` };
    }

    if (leftOrdinal < 1 || rightOrdinal < 1 || leftOrdinal > kp.length || rightOrdinal > kp.length) {
        return { success: false, message: 'Invalid ordinals' };
    }

    if (Math.abs(rightOrdinal - leftOrdinal) !== 1) {
        return { success: false, message: 'Ordinals must be adjacent' };
    }

    const leftIdx = Math.min(leftOrdinal, rightOrdinal) - 1;
    const rightIdx = Math.max(leftOrdinal, rightOrdinal) - 1;

    const leftPoint = kp[leftIdx];
    const rightPoint = kp[rightIdx];

    // Calculate midpoint
const midX = (leftPoint.input + rightPoint.input) / 2;

return insertSmartKeyPointAt(channelName, midX, outputPercent);
}

function applySmartKeyPointsInternal(channelName, keyPoints, interpolationType = 'smooth', options = {}) {
    if (!isBrowser) {
        return { success: false, message: 'Window context unavailable' };
    }

    const normalized = ControlPoints.normalize(keyPoints);
    if (normalized.length < 2) {
        return { success: false, message: 'At least 2 key points are required' };
    }

    const data = ensureLoadedQuadData(() => ({ curves: {}, keyPoints: {}, keyPointsMeta: {}, sources: {} }));
    data.curves = data.curves || {};
    data.keyPoints = data.keyPoints || {};
    data.keyPointsMeta = data.keyPointsMeta || {};
    data.sources = data.sources || {};

    const interp = interpolationType === 'linear' ? 'linear' : 'smooth';

    const oldCurve = data.curves[channelName] ? data.curves[channelName].slice() : null;
    const oldKeyPoints = data.keyPoints[channelName] ? data.keyPoints[channelName].map((p) => ({ input: p.input, output: p.output })) : null;
    const oldInterpolation = data.keyPointsMeta[channelName]?.interpolationType || 'smooth';
    const oldSource = data.sources[channelName] || null;

    const history = getHistoryManager?.();
    const skipHistory = !!options.skipHistory;
    const selectedOrdinalBefore = (isBrowser && globalScope.EDIT && globalScope.EDIT.selectedChannel === channelName)
        ? (globalScope.EDIT.selectedOrdinal || 1)
        : 1;
    if (!skipHistory && history && typeof history.recordKeyPointsChange === 'function') {
        try {
            history.recordKeyPointsChange(channelName, oldKeyPoints, normalized.map((p) => ({ input: p.input, output: p.output })), oldInterpolation, interp);
        } catch (err) {
            console.warn('[SMART CURVES] recordKeyPointsChange failed:', err);
        }
    }

    ControlPoints.persist(channelName, normalized, interp);

    data.keyPoints[channelName] = normalized.map((p) => ({ input: p.input, output: p.output }));
    const bakedFlags = options.bakedFlags || {};
    const existingMeta = data.keyPointsMeta[channelName] || {};
    const smartTouched = options.smartTouched !== undefined ? options.smartTouched : true;
    const nextMeta = {
        ...existingMeta,
        interpolationType: interp,
        ...bakedFlags
    };
    if (smartTouched) {
        nextMeta.smartTouched = true;
    } else if ('smartTouched' in nextMeta) {
        delete nextMeta.smartTouched;
    }
    data.keyPointsMeta[channelName] = nextMeta;

    const samples = new Array(CURVE_RESOLUTION);
    for (let i = 0; i < CURVE_RESOLUTION; i++) {
        const x = (i / DENOM) * 100;
        const percent = ControlPoints.sampleY(normalized, interp, x);
        const clamped = Math.max(0, Math.min(100, percent));
        samples[i] = Math.round((clamped / 100) * TOTAL);
    }

    data.curves[channelName] = samples.slice();
    data.sources[channelName] = 'smart';

    if (!skipHistory && history && typeof history.recordChannelAction === 'function') {
        try {
            const extras = {
                oldKeyPoints,
                newKeyPoints: normalized.map((p) => ({ input: p.input, output: p.output })),
                oldInterpolation,
                newInterpolation: interp,
                oldSource,
                newSource: 'smart',
                selectedOrdinalBefore,
                selectedChannelBefore: (isBrowser && globalScope.EDIT) ? globalScope.EDIT.selectedChannel : null
            };
            if (options.historyExtras && typeof options.historyExtras === 'object') {
                Object.assign(extras, options.historyExtras);
            }
            if (extras.selectedOrdinalAfter === undefined) {
                const clampedAfter = Math.max(1, Math.min(selectedOrdinalBefore, normalized.length));
                extras.selectedOrdinalAfter = clampedAfter;
            }
            if (extras.selectedChannelAfter === undefined && isBrowser && globalScope.EDIT) {
                extras.selectedChannelAfter = globalScope.EDIT.selectedChannel;
            }
            history.recordChannelAction(channelName, 'curve', oldCurve, samples.slice(), extras);
        } catch (err) {
            console.warn('[SMART CURVES] recordChannelAction failed:', err);
        }
    }

    const skipMarkEdited = !!options.skipMarkEdited;
    if (!skipMarkEdited) {
        try {
            markLinearizationEdited(channelName);
        } catch (err) {
            console.warn('[SMART CURVES] markLinearizationEdited failed:', err);
        }
    }

    try {
        const state = getAppState();
        if (state.perChannelEnabled && Object.prototype.hasOwnProperty.call(state.perChannelEnabled, channelName)) {
            const nextEnabled = { ...state.perChannelEnabled, [channelName]: false };
            updateAppState({ perChannelEnabled: nextEnabled });
        }
        if (LinearizationState && typeof LinearizationState.setPerChannelData === 'function') {
            const perEntry = LinearizationState.getPerChannelData(channelName);
            if (perEntry) {
                LinearizationState.setPerChannelData(channelName, perEntry, false);
            }
        }
        const row = getChannelRow(channelName);
        if (row) {
            const toggle = row.querySelector('.per-channel-toggle');
            if (toggle) {
                toggle.disabled = true;
                toggle.checked = false;
            }
        }
    } catch (err) {
        console.warn('[SMART CURVES] Failed to update per-channel toggle state:', err);
    }

    const skipUiRefresh = !!options.skipUiRefresh;
    if (!skipUiRefresh) {
        try {
            triggerPreviewUpdate();
            triggerProcessingDetail(channelName);
            triggerInkChartUpdate();
            triggerRevertButtonsUpdate();
        } catch (err) {
            console.warn('[SMART CURVES] UI refresh failed:', err);
        }
    }

    return {
        success: true,
        message: `Set ${normalized.length} key points for ${channelName}`,
        channelName,
        keyPointCount: normalized.length,
        keyPoints: normalized.map((p) => ({ input: p.input, output: p.output })),
        curve: samples
    };
}

/**
 * Set Smart key points for a channel (replaces existing points)
 * @param {string} channelName - Channel name
 * @param {Array} keyPoints - Array of {input, output} points
 * @param {string} [interpolationType='smooth'] - Interpolation type
 * @returns {Object} Set result
 */
export function setSmartKeyPoints(channelName, keyPoints, interpolationType = 'smooth', options = {}) {
    if (!channelName) {
        return { success: false, message: 'Channel name required' };
    }

    const validation = validateKeyPoints(keyPoints);
    if (!validation.valid) {
        return { success: false, message: validation.message };
    }

    if (typeof isEditModeEnabled === 'function' && !options.allowWhenEditModeOff) {
        if (!isEditModeEnabled()) {
            return { success: false, message: 'Edit mode is off — enable Edit Curves to edit.' };
        }
    }

    return applySmartKeyPointsInternal(channelName, keyPoints, interpolationType, options);
}

/**
 * Export utility for global access during transition
 */
if (isBrowser) {
    globalScope.isSmartCurve = isSmartCurve;
    globalScope.ControlPoints = ControlPoints;
    globalScope.KP_SIMPLIFY = KP_SIMPLIFY;

    // Export editing functions globally for legacy compatibility
    globalScope.adjustSmartKeyPointByIndex = adjustSmartKeyPointByIndex;
    globalScope.insertSmartKeyPointAt = insertSmartKeyPointAt;
    globalScope.deleteSmartKeyPointByIndex = deleteSmartKeyPointByIndex;
    globalScope.simplifySmartKeyPointsFromCurve = simplifySmartKeyPointsFromCurve;
    globalScope.insertSmartKeyPointBetween = insertSmartKeyPointBetween;
    globalScope.setSmartKeyPoints = setSmartKeyPoints;
    globalScope.rescaleSmartCurveForInkLimit = rescaleSmartCurveForInkLimit;
}
