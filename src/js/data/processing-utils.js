// quadGEN Data Processing Utilities
// Core data processing and transformation utilities

import { TOTAL } from '../core/state.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers, getLegacyScope } from '../legacy/legacy-helpers.js';

/**
 * Standard curve resolution for QuadToneRIP
 */
export const CURVE_RESOLUTION = 256;

/**
 * Auto limit configuration for endpoint rolloff
 * These settings control the automatic shoulder/toe detection and application
 */
export const AUTO_LIMIT_CONFIG = {
    // Configuration map with getNumber accessor
    config: new Map([
        ['limitProximityPct', 3.0],     // Detection threshold as % of end value
        ['slopeAbsolutePct', 15.0],     // Slope collapse threshold relative to median
        ['sustainSamples', 4],          // Minimum consecutive flat samples
        ['minWidthPct', 5.0],           // Minimum knee width as % of domain
        ['blackShoulderScanStartPct', 80.0], // Start scanning from this % for black shoulder
        ['whiteToeScanEndPct', 10.0],   // End scanning at this % for white toe
        ['fallbackPlateauPct', 5.0]     // Fallback plateau distance from bounds
    ]),

    getNumber(key, defaultValue = 0) {
        const value = this.config.get(key);
        return (typeof value === 'number' && isFinite(value)) ? value : defaultValue;
    },

    setNumber(key, value) {
        if (typeof value === 'number' && isFinite(value)) {
            this.config.set(key, value);
        }
    }
};

/**
 * Data space enumeration for conversion operations
 */
export const DataSpace = {
    SPACE: {
        PRINTER: 'printer',
        IMAGE: 'image',
        LAB: 'lab',
        UNKNOWN: 'unknown'
    },

    /**
     * Normalize space identifier to standard form
     * @param {string} space - Space identifier to normalize
     * @returns {string} Normalized space identifier
     */
    normalizeSpace(space) {
        if (!space || typeof space !== 'string') return this.SPACE.UNKNOWN;
        const normalized = space.toLowerCase().trim();
        return Object.values(this.SPACE).includes(normalized) ? normalized : this.SPACE.UNKNOWN;
    },

    isPrinterSpace(space) {
        if (!space) return true;
        return this.normalizeSpace(space) === this.SPACE.PRINTER;
    },

    /**
     * Convert samples between data spaces
     * @param {Array<number>} samples - Input samples (0..1)
     * @param {Object} options - Conversion options
     * @param {string} options.from - Source space identifier
     * @param {string} [options.to='printer'] - Destination space identifier
     * @param {Object} [options.metadata] - Metadata to augment
     * @returns {{ values:number[], sourceSpace:string, meta:Object }}
     */
    convertSamples(samples, options = {}) {
        const { from, to = this.SPACE.PRINTER, metadata = {} } = options;
        const normalizedFrom = this.normalizeSpace(from);
        const sourceSpace = normalizedFrom === this.SPACE.UNKNOWN ? this.SPACE.PRINTER : normalizedFrom;
        const targetSpace = this.normalizeSpace(to) === this.SPACE.UNKNOWN ? this.SPACE.PRINTER : this.normalizeSpace(to);

        const input = Array.isArray(samples) ? samples : [];

        if (!input.length || sourceSpace === targetSpace) {
            return {
                values: input.slice(),
                sourceSpace: targetSpace,
                meta: { ...metadata, sourceSpace: targetSpace }
            };
        }

        let converted = input.slice();

        if (sourceSpace === this.SPACE.IMAGE && targetSpace === this.SPACE.PRINTER) {
            converted = input.slice().reverse().map(value => 1 - value);
        } else if (sourceSpace === this.SPACE.PRINTER && targetSpace === this.SPACE.IMAGE) {
            converted = input.map(value => 1 - value).reverse();
        }

        return {
            values: converted,
            sourceSpace: targetSpace,
            meta: {
                ...metadata,
                fromSpace: sourceSpace,
                sourceSpace: targetSpace,
                convertedAt: Date.now()
            }
        };
    },

    convertControlPoints(points, { from, to = this.SPACE.PRINTER, scale = 100, inputScale = 1, outputScale = 1 } = {}) {
        if (!Array.isArray(points) || !points.length) return [];

        const normalizedFrom = this.normalizeSpace(from);
        const sourceSpace = normalizedFrom === this.SPACE.UNKNOWN ? this.SPACE.PRINTER : normalizedFrom;
        const targetSpace = this.normalizeSpace(to) === this.SPACE.UNKNOWN ? this.SPACE.PRINTER : this.normalizeSpace(to);
        const targetScale = Number(scale) || 100;

        const normalize = (value, denom) => Math.max(0, Math.min(1, Number(value) / (denom || 1)));

        const normalizedPoints = points.map(point => ({
            input: normalize(point.input, inputScale),
            output: normalize(point.output, outputScale)
        }));

        const transform = (list, transformFn) => list.map(transformFn).sort((a, b) => a.input - b.input);

        if (sourceSpace === targetSpace) {
            return transform(normalizedPoints, (p) => ({
                input: p.input * targetScale,
                output: p.output * targetScale
            }));
        }

        if (sourceSpace === this.SPACE.IMAGE && targetSpace === this.SPACE.PRINTER) {
            return transform(normalizedPoints, (p) => ({
                input: (1 - p.input) * targetScale,
                output: (1 - p.output) * targetScale
            }));
        }

        if (sourceSpace === this.SPACE.PRINTER && targetSpace === this.SPACE.IMAGE) {
            return transform(normalizedPoints, (p) => ({
                input: (1 - p.input) * targetScale,
                output: (1 - p.output) * targetScale
            }));
        }

        return transform(normalizedPoints, (p) => ({
            input: p.input * targetScale,
            output: p.output * targetScale
        }));
    }
};

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Clamp value to range
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Create linear ramp array
 * @param {number} length - Array length
 * @param {number} start - Start value
 * @param {number} end - End value
 * @returns {Array<number>} Linear ramp array
 */
export function createLinearRamp(length, start = 0, end = TOTAL) {
    const result = new Array(length);
    for (let i = 0; i < length; i++) {
        const t = length === 1 ? 0 : i / (length - 1);
        result[i] = Math.round(lerp(start, end, t));
    }
    return result;
}

/**
 * Scale array values by a factor
 * @param {Array<number>} values - Input values
 * @param {number} factor - Scale factor
 * @param {boolean} round - Whether to round results
 * @returns {Array<number>} Scaled values
 */
export function scaleValues(values, factor, round = true) {
    if (!Array.isArray(values) || !isFinite(factor)) {
        return values.slice();
    }

    return values.map(value => {
        const scaled = value * factor;
        return round ? Math.round(scaled) : scaled;
    });
}

/**
 * Find maximum value in array
 * @param {Array<number>} values - Input values
 * @returns {number} Maximum value
 */
export function findMaxValue(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return Math.max(...values.filter(v => isFinite(v)));
}

/**
 * Normalize array to specified maximum
 * @param {Array<number>} values - Input values
 * @param {number} targetMax - Target maximum value
 * @returns {Array<number>} Normalized values
 */
export function normalizeToMax(values, targetMax = TOTAL) {
    const currentMax = findMaxValue(values);
    if (currentMax === 0) return values.slice();

    const factor = targetMax / currentMax;
    return scaleValues(values, factor);
}

/**
 * Resample array to target length using linear interpolation
 * @param {Array<number>} values - Input values
 * @param {number} targetLength - Target array length
 * @returns {Array<number>} Resampled values
 */
export function resampleArray(values, targetLength) {
    if (!Array.isArray(values) || values.length === 0) {
        return new Array(targetLength).fill(0);
    }

    if (values.length === targetLength) {
        return values.slice();
    }

    const result = new Array(targetLength);
    const sourceLength = values.length;

    for (let i = 0; i < targetLength; i++) {
        const sourceIndex = (i / (targetLength - 1)) * (sourceLength - 1);
        const lowerIndex = Math.floor(sourceIndex);
        const upperIndex = Math.min(lowerIndex + 1, sourceLength - 1);
        const t = sourceIndex - lowerIndex;

        if (lowerIndex === upperIndex) {
            result[i] = values[lowerIndex];
        } else {
            result[i] = Math.round(lerp(values[lowerIndex], values[upperIndex], t));
        }
    }

    return result;
}

/**
 * Calculate first differences of array (derivative approximation)
 * @param {Array<number>} values - Input values
 * @returns {Array<number>} First differences
 */
export function calculateFirstDifferences(values) {
    if (!Array.isArray(values) || values.length < 2) return [];

    const differences = new Array(values.length - 1);
    for (let i = 0; i < values.length - 1; i++) {
        differences[i] = values[i + 1] - values[i];
    }
    return differences;
}

/**
 * Detect flat regions in array based on slope analysis
 * @param {Array<number>} values - Input values
 * @param {number} threshold - Flatness threshold
 * @param {number} minLength - Minimum flat region length
 * @returns {Array<Object>} Flat regions [{start, end, length}]
 */
export function detectFlatRegions(values, threshold = 1.0, minLength = 3) {
    if (!Array.isArray(values) || values.length < minLength + 1) return [];

    const differences = calculateFirstDifferences(values);
    const flatRegions = [];
    let currentRegionStart = -1;

    for (let i = 0; i < differences.length; i++) {
        const isFlat = Math.abs(differences[i]) <= threshold;

        if (isFlat && currentRegionStart === -1) {
            currentRegionStart = i;
        } else if (!isFlat && currentRegionStart !== -1) {
            const regionLength = i - currentRegionStart;
            if (regionLength >= minLength) {
                flatRegions.push({
                    start: currentRegionStart,
                    end: i,
                    length: regionLength
                });
            }
            currentRegionStart = -1;
        }
    }

    // Handle region extending to end
    if (currentRegionStart !== -1) {
        const regionLength = differences.length - currentRegionStart;
        if (regionLength >= minLength) {
            flatRegions.push({
                start: currentRegionStart,
                end: differences.length,
                length: regionLength
            });
        }
    }

    return flatRegions;
}

/**
 * Validate curve data array
 * @param {Array} values - Values to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateCurveData(values, options = {}) {
    const {
        expectedLength = CURVE_RESOLUTION,
        allowEmpty = false,
        maxValue = TOTAL,
        minValue = 0
    } = options;

    if (!Array.isArray(values)) {
        return {
            valid: false,
            message: 'Input is not an array'
        };
    }

    if (values.length === 0 && !allowEmpty) {
        return {
            valid: false,
            message: 'Array is empty'
        };
    }

    if (expectedLength > 0 && values.length !== expectedLength) {
        return {
            valid: false,
            message: `Expected length ${expectedLength}, got ${values.length}`
        };
    }

    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (!isFinite(value)) {
            return {
                valid: false,
                message: `Non-finite value at index ${i}: ${value}`
            };
        }
        if (value < minValue || value > maxValue) {
            return {
                valid: false,
                message: `Value out of range at index ${i}: ${value} (expected ${minValue}-${maxValue})`
            };
        }
    }

    return {
        valid: true,
        message: 'Curve data is valid'
    };
}

/**
 * Create empty curve filled with zeros
 * @param {number} length - Curve length
 * @returns {Array<number>} Zero-filled array
 */
export function createEmptyCurve(length = CURVE_RESOLUTION) {
    return new Array(length).fill(0);
}

/**
 * Copy curve data safely
 * @param {Array<number>} values - Source values
 * @returns {Array<number>} Copied array
 */
export function copyCurveData(values) {
    if (!Array.isArray(values)) return [];
    return values.slice();
}

const legacyScope = getLegacyScope();
legacyScope.AUTO_LIMIT_CONFIG = legacyScope.AUTO_LIMIT_CONFIG || AUTO_LIMIT_CONFIG;
legacyScope.DataSpace = legacyScope.DataSpace || DataSpace;

registerLegacyHelpers({
    AUTO_LIMIT_CONFIG,
    DataSpace,
    validateCurveData,
    createEmptyCurve,
    copyCurveData
});

registerDebugNamespace('processingUtils', {
    AUTO_LIMIT_CONFIG,
    DataSpace,
    validateCurveData,
    createEmptyCurve,
    copyCurveData
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['AUTO_LIMIT_CONFIG', 'DataSpace']
});
