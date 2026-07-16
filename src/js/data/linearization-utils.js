// quadGEN Linearization Utilities
// Helper functions for linearization and correction systems

import { DataSpace } from './processing-utils.js';
import { clamp01 } from '../math/interpolation.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers, getLegacyScope } from '../legacy/legacy-helpers.js';
import { getCorrectionGain } from '../core/state.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

function cloneCurveMap(curveMap) {
    if (!curveMap || typeof curveMap !== 'object') {
        return null;
    }
    const clone = {};
    let hasAny = false;
    Object.keys(curveMap).forEach((key) => {
        const curve = curveMap[key];
        const isArrayLike = Array.isArray(curve) || (curve && typeof curve.length === 'number');
        if (isArrayLike) {
            try {
                clone[key] = Array.from(curve);
            } catch (err) {
                const copy = new Array(curve.length);
                for (let i = 0; i < copy.length; i += 1) {
                    copy[i] = curve[i];
                }
                clone[key] = copy;
            }
            hasAny = true;
        }
    });
    return hasAny ? clone : null;
}

function sampleArrayValue(arr, index) {
    if (!Array.isArray(arr) || arr.length === 0) {
        return 0;
    }
    const clampedIndex = Math.max(0, Math.min(arr.length - 1, index));
    const value = arr[clampedIndex];
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function blendCurveMapsWithGain(curveMap, baselineMap, gain) {
    if (!curveMap || typeof curveMap !== 'object') {
        return null;
    }
    const numericGain = Number(gain);
    const clampedGain = Number.isFinite(numericGain) ? Math.max(0, Math.min(1, numericGain)) : 1;
    const blended = {};
    let hasAny = false;

    Object.keys(curveMap).forEach((channel) => {
        const corrected = curveMap[channel];
        if (!Array.isArray(corrected) || corrected.length === 0) {
            return;
        }
        const baseline = baselineMap && Array.isArray(baselineMap[channel])
            ? baselineMap[channel]
            : null;
        const length = corrected.length;
        const result = new Array(length);

        for (let i = 0; i < length; i += 1) {
            const correctedValue = Number(corrected[i]);
            const numericCorrected = Number.isFinite(correctedValue) ? correctedValue : sampleArrayValue(corrected, i);

            let baselineValue = numericCorrected;
            if (baseline) {
                if (baseline.length === length) {
                    const candidate = Number(baseline[i]);
                    baselineValue = Number.isFinite(candidate) ? candidate : sampleArrayValue(baseline, i);
                } else {
                    const ratio = length > 1 ? i / (length - 1) : 0;
                    const sampleIndex = Math.round(ratio * (baseline.length - 1));
                    baselineValue = sampleArrayValue(baseline, sampleIndex);
                }
            }

            if (clampedGain <= 0.001) {
                result[i] = Math.round(baselineValue);
            } else if (clampedGain >= 0.999) {
                result[i] = Math.round(numericCorrected);
            } else {
                const blendedValue = baselineValue + (numericCorrected - baselineValue) * clampedGain;
                result[i] = Math.round(blendedValue);
            }
        }

        blended[channel] = result;
        hasAny = true;
    });

    return hasAny ? blended : null;
}

function cloneMeasurementCorrections(source) {
    if (!Array.isArray(source) || source.length === 0) {
        return null;
    }
    const cloned = source
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            return { ...entry };
        })
        .filter(Boolean);
    return cloned.length ? cloned : null;
}

function applyCorrectionGainToCorrections(entries, gain) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return null;
    }
    const numericGain = Number(gain);
    const clampedGain = Number.isFinite(numericGain) ? Math.max(0, Math.min(1, numericGain)) : 1;
    const adjusted = entries
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const tolerance = Number(entry.tolerancePercent);
            const tolerancePercent = Number.isFinite(tolerance) ? tolerance : 1;
            const arrowClamp = Number.isFinite(entry.arrowClampPercent)
                ? entry.arrowClampPercent
                : (Number.isFinite(entry.maxArrowPercent) ? entry.maxArrowPercent : 8);
            const sourceNormalized = Number(entry.measuredSourceNormalized);
            const targetNormalized = Number(entry.targetNormalized);
            let baseDeltaNormalized = Number(entry.baseDeltaNormalized);

            if (!Number.isFinite(baseDeltaNormalized) && Number.isFinite(targetNormalized) && Number.isFinite(sourceNormalized)) {
                baseDeltaNormalized = targetNormalized - sourceNormalized;
            }

            if (!Number.isFinite(baseDeltaNormalized)) {
                baseDeltaNormalized = 0;
            }

            const appliedDeltaNormalized = baseDeltaNormalized * clampedGain;
            const residualDeltaNormalized = baseDeltaNormalized - appliedDeltaNormalized;
            const clampLimit = Number.isFinite(arrowClamp) && arrowClamp > 0 ? arrowClamp : 8;

            let correctedNormalized = null;
            if (Number.isFinite(sourceNormalized)) {
                correctedNormalized = sourceNormalized + appliedDeltaNormalized;
            }

            const appliedDeltaPercent = appliedDeltaNormalized * 100;
            const residualDeltaPercent = residualDeltaNormalized * 100;
            const magnitudePercent = Math.abs(appliedDeltaPercent);
            const withinTolerance = magnitudePercent <= (tolerancePercent + 1e-9);
            const direction = withinTolerance ? 0 : (appliedDeltaPercent > 0 ? 1 : -1);
            const clampedMagnitudePercent = Math.min(clampLimit, magnitudePercent);
            const normalizedMagnitude = clampLimit > 0 ? clampedMagnitudePercent / clampLimit : 0;
            const measuredNormalized = Number.isFinite(correctedNormalized)
                ? correctedNormalized
                : (Number.isFinite(entry.correctedNormalized) ? entry.correctedNormalized : null);
            const measuredPercent = Number.isFinite(measuredNormalized)
                ? measuredNormalized * 100
                : entry.correctedPercent;

            return {
                ...entry,
                correctionGain: clampedGain,
                measuredNormalized,
                measuredPercent,
                correctedNormalized: measuredNormalized,
                correctedPercent: measuredPercent,
                deltaNormalized: appliedDeltaNormalized,
                deltaPercent: appliedDeltaPercent,
                appliedDeltaNormalized,
                appliedDeltaPercent,
                residualDeltaNormalized,
                residualDeltaPercent,
                magnitudePercent,
                clampedMagnitudePercent,
                normalizedMagnitude,
                action: withinTolerance ? 'within' : (appliedDeltaPercent > 0 ? 'darken' : 'lighten'),
                withinTolerance,
                direction
            };
        })
        .filter(Boolean);

    return adjusted.length ? adjusted : null;
}

/**
 * Linearization state management for global and per-channel corrections
 */
export const LinearizationState = {
    // Global linearization data
    globalData: null,
    globalApplied: false,
    globalBakedMeta: null,
    globalDataSource: null,
    globalBaselineCurves: null,
    globalCorrectedCurves: null,
    globalCorrectedCurvesBase: null,
    globalWarnings: [],
    compositeCoverageSummary: null,
    globalMeasurementCorrections: null,
    globalMeasurementCorrectionsBase: null,

    // Per-channel linearization data
    perChannelData: {},
    perChannelEnabled: {},
    perChannelMeasurementCorrections: {},
    perChannelMeasurementCorrectionsBase: {},

    /**
     * Check if any linearization is active
     * @returns {boolean} True if any linearization is applied
     */
    hasAnyLinearization() {
        // Active when a global correction is applied, or at least one per-channel correction is enabled
        const hasGlobal = !!(this.globalData && this.globalApplied);
        const hasAnyPerEnabled = Object.keys(this.perChannelData).some(ch => this.perChannelEnabled[ch]);
        return hasGlobal || hasAnyPerEnabled;
    },

    /**
     * Get global linearization data
     * @returns {Object|null} Global linearization data
     */
    getGlobalData() {
        return this.globalData;
    },

    /**
     * Set global linearization data
     * @param {Object} data - Linearization data
     * @param {boolean} applied - Whether to mark as applied
     */
    setGlobalData(data, applied = true, options = {}) {
        this.globalData = data;
        this.globalApplied = applied;
        this.globalBakedMeta = null;
        this.globalBaselineCurves = null;
        this.globalCorrectedCurves = null;
        this.globalWarnings = [];
        if (!data) {
            this.globalDataSource = null;
        } else if (options && Object.prototype.hasOwnProperty.call(options, 'source')) {
            this.globalDataSource = options.source || null;
        } else if (!this.globalDataSource) {
            this.globalDataSource = null;
        }
        this.setGlobalMeasurementCorrections(data?.measurementCorrections || null);
        // Invalidate make256 cache since linearization state changed
        globalScope.invalidateMake256Cache?.();
    },

    /**
     * Get per-channel linearization data for a channel
     * @param {string} channelName - Channel name
     * @returns {Object|null} Per-channel linearization data
     */
    getPerChannelData(channelName) {
        return this.perChannelData[channelName] || null;
    },

    /**
     * Set per-channel linearization data
     * @param {string} channelName - Channel name
     * @param {Object} data - Linearization data
     * @param {boolean} enabled - Whether to enable for this channel
     */
    setPerChannelData(channelName, data, enabled = true) {
        this.perChannelData[channelName] = data;
        this.perChannelEnabled[channelName] = enabled;
        this.setPerChannelMeasurementCorrections(channelName, data?.measurementCorrections || null);
        // Invalidate make256 cache since linearization state changed
        globalScope.invalidateMake256Cache?.();
    },

    /**
     * Check if per-channel linearization is enabled for a channel
     * @param {string} channelName - Channel name
     * @returns {boolean} True if enabled
     */
    isPerChannelEnabled(channelName) {
        return !!this.perChannelEnabled[channelName];
    },

    /**
     * Clear all linearization data
     */
    clear() {
        this.globalData = null;
        this.globalApplied = false;
        this.globalBakedMeta = null;
        this.perChannelData = {};
        this.perChannelEnabled = {};
        this.globalBaselineCurves = null;
        this.globalCorrectedCurves = null;
        this.globalCorrectedCurvesBase = null;
        this.globalWarnings = [];
        this.compositeCoverageSummary = null;
        this.globalMeasurementCorrections = null;
        this.globalMeasurementCorrectionsBase = null;
        this.perChannelMeasurementCorrections = {};
        this.perChannelMeasurementCorrectionsBase = {};
        // Invalidate make256 cache since linearization state changed
        globalScope.invalidateMake256Cache?.();
    },

    /**
     * Clear global linearization data only
     */
    clearGlobal() {
        this.globalData = null;
        this.globalApplied = false;
        this.globalBakedMeta = null;
        this.globalBaselineCurves = null;
        this.globalCorrectedCurves = null;
        this.globalCorrectedCurvesBase = null;
        this.globalWarnings = [];
        this.compositeCoverageSummary = null;
        this.globalMeasurementCorrections = null;
        this.globalMeasurementCorrectionsBase = null;
        // Invalidate make256 cache since linearization state changed
        globalScope.invalidateMake256Cache?.();
    },

    /**
     * Clear per-channel linearization data for a channel
     * @param {string} channelName - Channel name
     */
    clearPerChannel(channelName) {
        delete this.perChannelData[channelName];
        delete this.perChannelEnabled[channelName];
        delete this.perChannelMeasurementCorrections[channelName];
        delete this.perChannelMeasurementCorrectionsBase[channelName];
        // Invalidate make256 cache since linearization state changed
        globalScope.invalidateMake256Cache?.();
    },

    /**
     * Determine whether a global linearization is currently applied
     * @returns {boolean}
     */
    isGlobalEnabled() {
        return !!(this.globalData && this.globalApplied);
    },

    setGlobalBakedMeta(meta) {
        this.globalBakedMeta = meta || null;
        if (meta) {
            this.globalDataSource = 'baked';
        } else if (!this.globalDataSource) {
            this.globalDataSource = null;
        }
    },

    getGlobalBakedMeta() {
        return this.globalBakedMeta || null;
    },

    isGlobalBaked() {
        return !!this.globalBakedMeta;
    },

    setGlobalDataSource(source) {
        this.globalDataSource = source || null;
    },

    getGlobalDataSource() {
        return this.globalDataSource || null;
    },

    setGlobalBaselineCurves(curves) {
        this.globalBaselineCurves = cloneCurveMap(curves);
        const gain = getCorrectionGain();
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            const K_baseline = this.globalBaselineCurves?.K?.slice(0, 10);
            const K_corrBase = this.globalCorrectedCurvesBase?.K?.slice(0, 10);
            console.log('[LinState] setGlobalBaselineCurves - gain:', gain, 'K baseline:', K_baseline, 'K corrBase:', K_corrBase);
        }
        if (this.globalCorrectedCurvesBase) {
            this.globalCorrectedCurves = blendCurveMapsWithGain(
                this.globalCorrectedCurvesBase,
                this.globalBaselineCurves,
                gain
            );
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                const K_result = this.globalCorrectedCurves?.K?.slice(0, 10);
                console.log('[LinState] setGlobalBaselineCurves result - K:', K_result);
            }
        }
    },

    getGlobalBaselineCurves() {
        return cloneCurveMap(this.globalBaselineCurves);
    },

    setGlobalCorrectedCurves(curves) {
        const base = cloneCurveMap(curves);
        this.globalCorrectedCurvesBase = base;
        if (!base) {
            this.globalCorrectedCurves = null;
            globalScope.invalidateMake256Cache?.();
            return;
        }
        const gain = getCorrectionGain();
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            const K_base = base?.K?.slice(0, 10);
            const K_baseline = this.globalBaselineCurves?.K?.slice(0, 10);
            const stack = new Error().stack.split('\n').slice(2, 6).join('\n');
            console.log('[LinState] setGlobalCorrectedCurves - gain:', gain, 'K base:', K_base, '\nStack:', stack);
        }
        this.globalCorrectedCurves = blendCurveMapsWithGain(base, this.globalBaselineCurves, gain) || cloneCurveMap(base);
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            const K_result = this.globalCorrectedCurves?.K?.slice(0, 10);
            console.log('[LinState] setGlobalCorrectedCurves result - K:', K_result);
        }
        // Invalidate make256 cache since corrected curves changed
        globalScope.invalidateMake256Cache?.();
    },

    getGlobalCorrectedCurves() {
        return cloneCurveMap(this.globalCorrectedCurves);
    },

    setGlobalWarnings(warnings = []) {
        this.globalWarnings = Array.isArray(warnings) ? warnings.slice() : [];
    },

    getGlobalWarnings() {
        return Array.isArray(this.globalWarnings) ? this.globalWarnings.slice() : [];
    },

    setCompositeCoverageSummary(summary = null) {
        if (!summary || typeof summary !== 'object') {
            this.compositeCoverageSummary = null;
            return;
        }
        try {
            this.compositeCoverageSummary = JSON.parse(JSON.stringify(summary));
        } catch (error) {
            this.compositeCoverageSummary = null;
        }
    },

    getCompositeCoverageSummary() {
        if (!this.compositeCoverageSummary) {
            return null;
        }
        try {
            return JSON.parse(JSON.stringify(this.compositeCoverageSummary));
        } catch (error) {
            return null;
        }
    },

    setGlobalMeasurementCorrections(corrections = null) {
        const base = cloneMeasurementCorrections(corrections);
        this.globalMeasurementCorrectionsBase = base;
        if (!base) {
            this.globalMeasurementCorrections = null;
            return;
        }
        this.globalMeasurementCorrections = applyCorrectionGainToCorrections(base, getCorrectionGain());
    },

    getGlobalMeasurementCorrections(options = {}) {
        const { skipEndpoints = true, clone = true } = options || {};
        const source = Array.isArray(this.globalMeasurementCorrections) ? this.globalMeasurementCorrections : [];
        const filtered = skipEndpoints ? source.filter((entry) => !entry?.isEndpoint) : source;
        if (!clone) {
            return filtered;
        }
        return filtered.map((entry) => ({ ...entry }));
    },

    setPerChannelMeasurementCorrections(channelName, corrections = null) {
        if (!channelName) {
            return;
        }
        const base = cloneMeasurementCorrections(corrections);
        if (!base) {
            delete this.perChannelMeasurementCorrections[channelName];
            delete this.perChannelMeasurementCorrectionsBase[channelName];
            return;
        }
        this.perChannelMeasurementCorrectionsBase[channelName] = base;
        this.perChannelMeasurementCorrections[channelName] = applyCorrectionGainToCorrections(base, getCorrectionGain());
    },

    refreshMeasurementCorrectionsForGain(gain = getCorrectionGain()) {
        const numericGain = Number(gain);
        const normalized = Number.isFinite(numericGain) ? Math.max(0, Math.min(1, numericGain)) : getCorrectionGain();
        if (this.globalMeasurementCorrectionsBase) {
            this.globalMeasurementCorrections = applyCorrectionGainToCorrections(this.globalMeasurementCorrectionsBase, normalized);
        }
        if (this.globalCorrectedCurvesBase) {
            this.globalCorrectedCurves = blendCurveMapsWithGain(
                this.globalCorrectedCurvesBase,
                this.globalBaselineCurves,
                normalized
            ) || cloneCurveMap(this.globalCorrectedCurvesBase);
        }
        if (this.perChannelMeasurementCorrectionsBase && typeof this.perChannelMeasurementCorrectionsBase === 'object') {
            Object.keys(this.perChannelMeasurementCorrectionsBase).forEach((channelName) => {
                const base = this.perChannelMeasurementCorrectionsBase[channelName];
                if (!base) {
                    delete this.perChannelMeasurementCorrections[channelName];
                    return;
                }
                this.perChannelMeasurementCorrections[channelName] = applyCorrectionGainToCorrections(base, normalized);
            });
        }
        // Invalidate make256 cache since gain affects corrected curves
        globalScope.invalidateMake256Cache?.();
    },

    getPerChannelMeasurementCorrections(channelName, options = {}) {
        if (!channelName) {
            return [];
        }
        const { skipEndpoints = true, clone = true } = options || {};
        const source = Array.isArray(this.perChannelMeasurementCorrections?.[channelName])
            ? this.perChannelMeasurementCorrections[channelName]
            : [];
        const filtered = skipEndpoints ? source.filter((entry) => !entry?.isEndpoint) : source;
        if (!clone) {
            return filtered;
        }
        return filtered.map((entry) => ({ ...entry }));
    },

    getLabMeasurementCorrections(options = {}) {
        const { channelName = null, skipEndpoints = true, clone = true } = options || {};
        if (channelName) {
            return this.getPerChannelMeasurementCorrections(channelName, { skipEndpoints, clone });
        }
        return this.getGlobalMeasurementCorrections({ skipEndpoints, clone });
    }
};

/**
 * Normalize linearization entry to ensure consistent format
 * @param {Object} entry - Raw linearization entry
 * @param {string} fallbackSpace - Fallback data space
 * @returns {Object} Normalized linearization entry
 */
export function normalizeLinearizationEntry(entry, fallbackSpace = DataSpace.SPACE.PRINTER) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const normalized = { ...entry };

    // Ensure sourceSpace is properly set
    if (!normalized.sourceSpace) {
        normalized.sourceSpace = fallbackSpace;
    }

    // Normalize sourceSpace value
    normalized.sourceSpace = DataSpace.normalizeSpace(normalized.sourceSpace);

    // Ensure domainMin/domainMax are set
    if (typeof normalized.domainMin !== 'number') {
        normalized.domainMin = 0;
    }
    if (typeof normalized.domainMax !== 'number') {
        normalized.domainMax = 1;
    }

    // Ensure samples array exists
    if (!Array.isArray(normalized.samples)) {
        normalized.samples = [];
    }

    // Add default metadata
    if (typeof normalized.edited !== 'boolean') {
        normalized.edited = false;
    }

    return normalized;
}

/**
 * Re-anchor a set of normalized samples so they span 0→1 exactly.
 * - If the range is effectively zero, returns a linear ramp.
 * - Values are clamped to [0,1] and endpoints forced to 0 and 1.
 * @param {number[]} samples - Input samples (any length ≥ 1)
 * @returns {number[]} Anchored samples in [0,1]
 */
export function anchorSamplesToUnitRange(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return [];
    }

    if (samples.length === 1) {
        return [0];
    }

    const anchored = samples.map((value) => clamp01(Number(value) || 0));
    anchored[0] = 0;
    anchored[anchored.length - 1] = 1;
    return anchored;
}

/**
 * Ensure samples are monotonically non-decreasing within [0,1]
 * @param {number[]} samples - Input samples
 * @param {number} epsilon - Minimum step to enforce when values would descend
 * @returns {number[]} Monotonic samples in [0,1]
 */
export function enforceMonotonicSamples(samples, epsilon = 1 / 65535) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return Array.isArray(samples) ? samples : [];
    }

    const out = samples.map((value) => clamp01(Number(value) || 0));
    if (out.length === 0) {
        return out;
    }

    out[0] = 0;
    for (let i = 1; i < out.length; i++) {
        if (out[i] < out[i - 1]) {
            out[i] = Math.min(1, out[i - 1] + epsilon);
        }
    }
    out[out.length - 1] = 1;
    return out;
}

/**
 * Apply linearization extras to a target object from source
 * @param {Object} target - Target linearization object
 * @param {Object} source - Source object with extras
 * @returns {Object} Target with applied extras
 */
export function applyLinearizationExtras(target, source) {
    if (!target || !source) return target;

    // Copy over additional properties that might be useful
    const extrasToApply = [
        'filename',
        'originalSamples',
        'smoothingMethod',
        'interpolationType',
        'description',
        'metadata'
    ];

    extrasToApply.forEach(key => {
        if (source[key] !== undefined && target[key] === undefined) {
            target[key] = source[key];
        }
    });

    return target;
}

/**
 * Ensure linearization data is in printer space
 * @param {Object} data - Linearization data
 * @returns {Object} Data converted to printer space if needed
 */
export function ensurePrinterSpaceData(data) {
    if (!data || typeof data !== 'object') return data;

    const sourceSpace = DataSpace.normalizeSpace(data.sourceSpace);

    if (sourceSpace === DataSpace.SPACE.PRINTER) {
        return data; // Already in printer space
    }

    // If not in printer space, we need to convert
    // For now, return a copy with updated sourceSpace
    // TODO: Connect to full DataSpace conversion when available
    const converted = { ...data };
    converted.sourceSpace = DataSpace.SPACE.PRINTER;

    if (sourceSpace === DataSpace.SPACE.IMAGE) {
        // Apply image->printer transformation if needed
        console.log('📊 Image->Printer space conversion needed (placeholder)');
    }

    return converted;
}

/**
 * Get interpolation type for global linearization
 * @param {Object} linearizationData - Global linearization data
 * @param {string} selectedInterpolationType - User-selected interpolation type
 * @returns {string} Effective interpolation type
 */
export function getGlobalLinearizationInterpolationType(linearizationData, selectedInterpolationType) {
    // Priority: explicit type in data > user selection > default
    if (linearizationData?.interpolationType) {
        return linearizationData.interpolationType;
    }

    if (selectedInterpolationType) {
        return selectedInterpolationType;
    }

    return 'pchip'; // Mandatory smooth default
}

/**
 * Create linearization data object from samples
 * @param {Array} samples - Sample values
 * @param {Object} options - Creation options
 * @returns {Object} Linearization data object
 */
export function createLinearizationData(samples, options = {}) {
    const {
        sourceSpace = DataSpace.SPACE.PRINTER,
        domainMin = 0,
        domainMax = 1,
        interpolationType = 'pchip',
        filename = 'generated',
        description = 'Generated linearization data'
    } = options;

    if (!Array.isArray(samples) || samples.length === 0) {
        throw new Error('Samples array is required and must not be empty');
    }

    return normalizeLinearizationEntry({
        samples: samples.slice(), // Copy array
        sourceSpace,
        domainMin,
        domainMax,
        interpolationType,
        filename,
        description,
        originalSamples: samples.slice(),
        edited: false
    });
}

/**
 * Validate linearization data object
 * @param {Object} data - Linearization data to validate
 * @returns {Object} Validation result
 */
export function validateLinearizationData(data) {
    if (!data || typeof data !== 'object') {
        return {
            valid: false,
            message: 'Linearization data must be an object'
        };
    }

    if (data.valid === false) {
        return {
            valid: false,
            message: data.error || 'Linearization parser rejected the data'
        };
    }

    if (!Array.isArray(data.samples)) {
        return {
            valid: false,
            message: 'Samples array is required'
        };
    }

    if (data.samples.length < 2) {
        return {
            valid: false,
            message: 'Samples array must contain at least two values'
        };
    }

    // Check sample values
    for (let i = 0; i < data.samples.length; i++) {
        const sample = data.samples[i];
        if (typeof sample !== 'number' || !Number.isFinite(sample)) {
            return {
                valid: false,
                message: `Invalid sample at index ${i}: ${sample}`
            };
        }
    }

    // Check domain
    if (!Number.isFinite(data.domainMin) || !Number.isFinite(data.domainMax)) {
        return {
            valid: false,
            message: 'domainMin and domainMax must be finite numbers'
        };
    }

    if (data.domainMin >= data.domainMax) {
        return {
            valid: false,
            message: 'domainMin must be less than domainMax'
        };
    }

    // Check sourceSpace
    const normalizedSpace = DataSpace.normalizeSpace(data.sourceSpace);
    if (normalizedSpace === DataSpace.SPACE.UNKNOWN) {
        return {
            valid: false,
            message: 'Invalid sourceSpace'
        };
    }

    return {
        valid: true,
        message: 'Linearization data is valid'
    };
}

/**
 * Mark linearization data as edited
 * @param {string} channelName - Channel name (null for global)
 */
export function markLinearizationEdited(channelName = null) {
    if (channelName) {
        // Mark per-channel as edited
        const data = LinearizationState.getPerChannelData(channelName);
        if (data) {
            data.edited = true;
        }
    } else {
        // Mark global as edited
        const data = LinearizationState.getGlobalData();
        if (data) {
            data.edited = true;
        }
    }
}

/**
 * Get display name for linearization file with edit status
 * @param {string} filename - Original filename
 * @param {boolean} edited - Whether the data has been edited
 * @returns {string} Display name with edit indicator
 */
export function getEditedDisplayName(filename, edited) {
    if (!filename) return 'unknown file';
    return edited ? `${filename} (edited)` : filename;
}

/**
 * Get base point count label for linearization data
 * @param {Object} data - Linearization data
 * @returns {string} Point count description
 */
export function getBasePointCountLabel(data) {
    if (!data) {
        return '0 points';
    }

    const originalDataCount = Array.isArray(data.originalData) ? data.originalData.length : null;
    if (originalDataCount && originalDataCount > 1) {
        return `${originalDataCount} points`;
    }

    const sampleCount = Array.isArray(data.samples) ? data.samples.length : 0;
    if (sampleCount <= 1) {
        return `${sampleCount} point`;
    }
    return `${sampleCount} points`;
}

/**
 * Clone linearization data object
 * @param {Object} data - Source linearization data
 * @returns {Object} Cloned linearization data
 */
export function cloneLinearizationData(data) {
    if (!data) return null;

    return {
        ...data,
        samples: Array.isArray(data.samples) ? data.samples.slice() : [],
        originalSamples: Array.isArray(data.originalSamples) ? data.originalSamples.slice() : [],
        metadata: data.metadata ? { ...data.metadata } : undefined,
        measurementCorrections: Array.isArray(data.measurementCorrections)
            ? data.measurementCorrections.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry))
            : data.measurementCorrections ?? null
    };
}

const legacyScope = getLegacyScope();
legacyScope.LinearizationState = legacyScope.LinearizationState || LinearizationState;

registerLegacyHelpers({
    LinearizationState,
    normalizeLinearizationEntry,
    ensurePrinterSpaceData,
    getBasePointCountLabel,
    cloneLinearizationData
});

registerDebugNamespace('linearization', {
    LinearizationState,
    normalizeLinearizationEntry,
    ensurePrinterSpaceData,
    getBasePointCountLabel,
    cloneLinearizationData
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: [
        'LinearizationState',
        'normalizeLinearizationEntry',
        'ensurePrinterSpaceData'
    ]
});
