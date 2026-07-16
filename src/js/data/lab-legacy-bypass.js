// LAB Legacy Bypass Controller
// Surgical bypass system to route LAB data through legacy processing
// instead of the problematic modular pipeline

import {
    LEGACY_LAB_CONSTANTS,
    generateCorrectionPoints,
    localSigmaAt,
    generate256PointCurve,
    generateSmoothingControlPoints
} from './lab-legacy-core.js';

import { getTargetRelAt } from './lab-parser.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers, getLegacyScope } from '../legacy/legacy-helpers.js';

/**
 * Feature flag to enable/disable LAB bypass
 * Can be toggled for instant rollback if needed
 */
const LAB_BYPASS_ENABLED = true;

/**
 * Debug flag for bypass-specific logging
 */
const DEBUG_LAB_BYPASS = () => {
    return (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) ||
           (typeof globalThis !== 'undefined' && globalThis.DEBUG_LOGS);
};

/**
 * Reliably detect if linearization data is LAB measurement data
 * Uses multiple detection methods for maximum reliability
 * @param {Object} entry - Linearization data entry to check
 * @returns {boolean} True if entry contains LAB measurement data
 */
export function isLabLinearizationData(entry) {
    if (DEBUG_LAB_BYPASS()) {
        console.log('[LAB BYPASS] Detection check:', {
            hasEntry: !!entry,
            entryType: typeof entry,
            format: entry?.format,
            filename: entry?.filename,
            sourceSpace: entry?.sourceSpace,
            measurementIntent: entry?.measurementIntent,
            hasOriginalData: Array.isArray(entry?.originalData)
        });
    }

    if (!entry || typeof entry !== 'object') {
        return false;
    }

    // Primary detection: explicit format marker
    if (entry.format === 'LAB Data') {
        if (DEBUG_LAB_BYPASS()) console.log('[LAB BYPASS] Detected via format:', entry.format);
        return true;
    }

    // Secondary detection: filename contains "lab"
    if (entry.filename && typeof entry.filename === 'string' &&
        entry.filename.toLowerCase().includes('lab')) {
        if (DEBUG_LAB_BYPASS()) console.log('[LAB BYPASS] Detected via filename:', entry.filename);
        return true;
    }

    // Tertiary detection: measurement intent and space combination
    if (entry.sourceSpace === 'printer' && entry.measurementIntent === 'positive') {
        if (DEBUG_LAB_BYPASS()) console.log('[LAB BYPASS] Detected via space/intent:', entry.sourceSpace, entry.measurementIntent);
        return true;
    }

    // Quaternary detection: originalData contains lab values
    if (Array.isArray(entry.originalData) && entry.originalData.length > 0) {
        const hasLabData = entry.originalData.some(point =>
            point && typeof point === 'object' &&
            typeof point.lab === 'number'
        );
        if (hasLabData) {
            if (DEBUG_LAB_BYPASS()) console.log('[LAB BYPASS] Detected via originalData structure');
            return true;
        }
    }

    return false;
}

/**
 * Main bypass function for LAB data processing
 * This will be called instead of the modular pipeline for LAB data
 * @param {Array<number>} values - Input values to transform
 * @param {Object} labEntry - LAB linearization data entry
 * @param {number} smoothingPercent - Smoothing percentage from UI
 * @param {number} maxValue - Maximum output value for scaling
 * @returns {Array<number>} Processed values using legacy algorithm
 */
export function processLabLegacy(values, labEntry, smoothingPercent = 30, maxValue = 65535) {
    // Force log this entry regardless of debug settings to see if function is called
    console.log('[LAB BYPASS] processLabLegacy called with:', {
        valuesCount: values.length,
        smoothingPercent,
        maxValue,
        bypassEnabled: LAB_BYPASS_ENABLED,
        labEntryFormat: labEntry?.format
    });

    if (!LAB_BYPASS_ENABLED) {
        // Bypass disabled - this shouldn't happen, but safety fallback
        console.warn('[LAB BYPASS] Bypass disabled, falling back to modular processing');
        return values.slice();
    }

    if (DEBUG_LAB_BYPASS()) {
        console.log('[LAB BYPASS] Processing LAB data:', {
            valuesCount: values.length,
            smoothingPercent,
            maxValue,
            labEntry: {
                format: labEntry.format,
                filename: labEntry.filename,
                originalDataCount: labEntry.originalData?.length
            }
        });
    }

    try {
        // Validate input data
        if (!labEntry.originalData || !Array.isArray(labEntry.originalData) || labEntry.originalData.length < 2) {
            throw new Error('Invalid LAB originalData');
        }

        if (DEBUG_LAB_BYPASS()) {
            console.log('[LAB BYPASS] Starting legacy processing with', labEntry.originalData.length, 'data points');
        }

        // Step 1: Generate correction points from LAB measurement data
        const correctionData = generateCorrectionPoints(labEntry.originalData, getTargetRelAt);

        if (DEBUG_LAB_BYPASS()) {
            console.log('[LAB BYPASS] Generated', correctionData.correctionPoints.length, 'correction points');
        }

        // Step 2: Create local sigma function bound to positions
        const localSigmaFunction = (t) => localSigmaAt(t, correctionData.positions, LEGACY_LAB_CONSTANTS);

        // Step 3: Generate 256-point curve using legacy Gaussian algorithm
        const curve256 = generate256PointCurve(correctionData, localSigmaFunction, LEGACY_LAB_CONSTANTS);

        if (DEBUG_LAB_BYPASS()) {
            console.log('[LAB BYPASS] Generated 256-point curve, first few values:', curve256.slice(0, 5));
        }

        // Step 4: Apply curve to input values
        const result = values.map((value, index) => {
            const normalized = Math.max(0, Math.min(1, maxValue > 0 ? value / maxValue : 0));
            const curveIndex = Math.round(normalized * 255);
            const correctedValue = curve256[curveIndex];
            return Math.round(correctedValue * maxValue);
        });

        if (DEBUG_LAB_BYPASS()) {
            console.log('[LAB BYPASS] Applied curve to values, result sample:', result.slice(0, 10));
        }

        return result;

    } catch (error) {
        console.error('[LAB BYPASS] Error in legacy processing:', error);
        // Fallback to input values to prevent crashes
        return values.slice();
    }
}

/**
 * Generate direct 256-point curve from LAB data
 * Bypasses entire LUT/interpolation system for direct output
 * @param {Object} labEntry - LAB linearization data entry
 * @param {number} smoothingPercent - Smoothing percentage from UI
 * @returns {Array<number>} 256-point curve (0.0-1.0 range)
 */
export function generateLabCurve256(labEntry, smoothingPercent = 30) {
    if (!LAB_BYPASS_ENABLED) {
        console.warn('[LAB BYPASS] Bypass disabled for curve generation');
        // Return linear ramp as fallback
        return new Array(256).fill(0).map((_, i) => i / 255);
    }

    if (DEBUG_LAB_BYPASS()) {
        console.log('[LAB BYPASS] Generating 256-point curve:', {
            smoothingPercent,
            labEntry: {
                format: labEntry.format,
                filename: labEntry.filename,
                originalDataCount: labEntry.originalData?.length
            }
        });
    }

    try {
        // Validate input data
        if (!labEntry.originalData || !Array.isArray(labEntry.originalData) || labEntry.originalData.length < 2) {
            throw new Error('Invalid LAB originalData');
        }

        if (DEBUG_LAB_BYPASS()) {
            console.log('[LAB BYPASS] Generating direct 256-point curve with smoothing:', smoothingPercent);
        }

        // Generate correction points from LAB measurement data
        const correctionData = generateCorrectionPoints(labEntry.originalData, getTargetRelAt);

        // Generate smoothing control points using exact legacy algorithm
        const controlPointsData = generateSmoothingControlPoints(
            correctionData,
            smoothingPercent,
            LEGACY_LAB_CONSTANTS
        );

        // Return the full 256-point curve
        const curve256 = controlPointsData.fullCurve;

        if (DEBUG_LAB_BYPASS()) {
            console.log('[LAB BYPASS] Generated 256-point curve, first few values:', curve256.slice(0, 5));
            console.log('[LAB BYPASS] Control points count:', controlPointsData.controlPointCount);
        }

        return curve256;

    } catch (error) {
        console.error('[LAB BYPASS] Error generating LAB curve:', error);
        // Return linear ramp as fallback
        return new Array(256).fill(0).map((_, i) => i / 255);
    }
}

/**
 * Check if LAB bypass is enabled
 * @returns {boolean} True if bypass is enabled
 */
export function isLabBypassEnabled() {
    return LAB_BYPASS_ENABLED;
}

/**
 * Get bypass status for debugging
 * @returns {Object} Bypass status information
 */
export function getLabBypassStatus() {
    return {
        enabled: LAB_BYPASS_ENABLED,
        debugMode: DEBUG_LAB_BYPASS,
        version: '1.0.0-bypass'
    };
}

const legacyScope = getLegacyScope();
const labBypassExports = {
    isLabLinearizationData,
    processLabLegacy,
    generateLabCurve256,
    getStatus: getLabBypassStatus
};
const legacyLabBypass = (legacyScope.labBypass && typeof legacyScope.labBypass === 'object')
    ? legacyScope.labBypass
    : {};
Object.assign(legacyLabBypass, labBypassExports);
legacyScope.labBypass = legacyLabBypass;

registerLegacyHelpers({
    labBypass: legacyLabBypass,
    isLabLinearizationData,
    processLabLegacy,
    generateLabCurve256,
    getLabBypassStatus
});

registerDebugNamespace('labBypass', {
    isLabLinearizationData,
    processLabLegacy,
    generateLabCurve256,
    getLabBypassStatus
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['labBypass']
});
