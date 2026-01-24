// Channel Builder - Core Calculation Engine
// Enables incremental construction of multi-ink quad files by measuring
// each secondary channel's L* contribution against a calibrated K channel.

import { createPCHIPSpline } from '../math/interpolation.js';
import { shiftBellCurve } from './bell-shift.js';
import { scaleBellCurve } from './bell-width-scale.js';

// ============================================================================
// L* to Density Conversion (Paper-Relative)
// ============================================================================

/**
 * Convert CIE L* to relative luminance Y (piecewise formula)
 * @param {number} L - L* value (0-100)
 * @returns {number} Relative luminance Y (0-1)
 */
export function lstarToY(L) {
    const l = Math.max(0, Math.min(100, Number(L) || 0));
    if (l > 8) {
        const f = (l + 16) / 116;
        return f * f * f;
    }
    return l / 903.3; // Linear region for very dark samples
}

/**
 * Compute paper-relative optical density
 * @param {number} L_patch - L* of the ink patch
 * @param {number} L_paper - L* of the paper white (typically 94-98)
 * @returns {number} Optical density relative to paper
 */
export function computeDensity(L_patch, L_paper) {
    const Y_patch = lstarToY(L_patch);
    const Y_paper = lstarToY(L_paper);
    return Math.log10(Y_paper / Math.max(Y_patch, 1e-10));
}

/**
 * Compute density profile from measurements
 * @param {Array<{input: number, lstar: number}>} measurements - L* measurements
 * @returns {{densities: number[], dMax: number, L_paper: number}}
 */
export function computeDensityProfile(measurements) {
    if (!measurements || measurements.length < 2) {
        return { densities: [], dMax: 0, L_paper: 100 };
    }

    // Paper white is the first measurement (0% ink)
    const L_paper = measurements[0].lstar;

    const densities = measurements.map(m => computeDensity(m.lstar, L_paper));
    const dMax = Math.max(...densities);

    return { densities, dMax, L_paper };
}

// ============================================================================
// Bell Parameter Estimation
// ============================================================================

/**
 * Compute bell apex position using density ratio method
 * @param {number} channelDMax - Channel's maximum density
 * @param {number} referenceDMax - Reference K channel's maximum density
 * @returns {number} Apex position as percentage (0-100)
 */
export function computeApexByDensityRatio(channelDMax, referenceDMax) {
    if (!referenceDMax || referenceDMax <= 0) {
        return 50; // Fallback to midpoint
    }
    const ratio = channelDMax / referenceDMax;
    return Math.max(5, Math.min(95, ratio * 100)); // Clamp to avoid edge artifacts
}

/**
 * Compute bell apex position using L* matching method
 * For linear-L* workflows where density ratio may place peaks too early
 * @param {number} secondaryMinL - Secondary channel's minimum L* (darkest)
 * @param {Array<{input: number, lstar: number}>} kMeasurements - K channel measurements
 * @returns {number} Apex position as percentage (0-100)
 */
export function computeApexByLstarMatch(secondaryMinL, kMeasurements) {
    if (!kMeasurements || kMeasurements.length < 2) {
        return 50;
    }

    // Find input position where K's L* matches secondary's minimum
    for (let i = 0; i < kMeasurements.length - 1; i++) {
        if (kMeasurements[i].lstar >= secondaryMinL &&
            kMeasurements[i + 1].lstar < secondaryMinL) {
            // Interpolate between points
            const t = (secondaryMinL - kMeasurements[i].lstar) /
                      (kMeasurements[i + 1].lstar - kMeasurements[i].lstar);
            const apex = kMeasurements[i].input + t *
                   (kMeasurements[i + 1].input - kMeasurements[i].input);
            return Math.max(5, Math.min(95, apex));
        }
    }
    return 100; // Fallback if no match found
}

/**
 * Compute bell width factor from L* slope characteristics
 * Steeper L* transitions suggest narrower bells; gradual transitions suggest wider bells
 * @param {Array<{input: number, lstar: number}>} measurements - L* measurements
 * @returns {number} Width factor (0.6 to 1.4)
 */
export function computeWidthFactor(measurements) {
    if (!measurements || measurements.length < 3) {
        return 1.0; // Default to standard width
    }

    const L_max = measurements[0].lstar; // Paper white
    const L_min = measurements[measurements.length - 1].lstar; // Max ink
    const L_range = L_max - L_min;

    if (L_range <= 0) {
        return 1.0;
    }

    // Find 20% and 80% L* thresholds
    const L_20 = L_max - 0.2 * L_range;
    const L_80 = L_max - 0.8 * L_range;

    // Find input positions where these thresholds are crossed
    let input_20 = 0;
    let input_80 = 100;

    for (const m of measurements) {
        if (m.lstar <= L_20 && input_20 === 0) {
            input_20 = m.input;
        }
        if (m.lstar <= L_80) {
            input_80 = m.input;
            break;
        }
    }

    // avgSlope = L* change per input % in the active region
    const inputRange = Math.max(1, input_80 - input_20);
    const avgSlope = Math.abs(L_80 - L_20) / inputRange;

    // maxSlope = steepest theoretical slope (full L* range over 60% input)
    const maxSlope = L_range / 60;

    // widthFactor bounds: [0.6, 1.4] maps to scaleBellCurve's [0.4, 2.5] range
    // Steep slopes → narrower bells (lower factor), gradual slopes → wider bells (higher factor)
    return Math.max(0.6, Math.min(1.4, 1.4 - (avgSlope / maxSlope) * 0.8));
}

/**
 * Assign tonal role based on peak position
 * @param {number} peakPercent - Peak position as percentage
 * @returns {'highlight' | 'midtone' | 'shadow'}
 */
export function assignRole(peakPercent) {
    if (peakPercent < 40) return 'highlight';
    if (peakPercent < 70) return 'midtone';
    return 'shadow';
}

/**
 * Compute recommended End value (peak amplitude)
 * @param {number} inkLimitUsed - Ink limit used for test print (0-100)
 * @param {number} channelDMax - Channel's maximum density
 * @param {number} referenceDMax - Reference K channel's maximum density
 * @returns {number} Recommended End value as percentage
 */
export function computeRecommendedEnd(inkLimitUsed, channelDMax, referenceDMax) {
    if (!referenceDMax || referenceDMax <= 0) {
        return inkLimitUsed;
    }
    const efficiencyFactor = Math.min(1.0, channelDMax / referenceDMax);
    return Math.round(inkLimitUsed * efficiencyFactor * 10) / 10;
}

/**
 * Compute all bell parameters from measurements
 * @param {Array<{input: number, lstar: number}>} measurements - L* measurements
 * @param {number} referenceDMax - Reference K channel's maximum density
 * @param {number} inkLimitUsed - Ink limit used for test print
 * @param {Object} options - { useL*Matching: boolean, kMeasurements: array }
 * @returns {{dMax: number, apex: number, widthFactor: number, end: number, role: string}}
 */
export function computeBellParameters(measurements, referenceDMax, inkLimitUsed, options = {}) {
    const { densities, dMax, L_paper } = computeDensityProfile(measurements);

    // Compute apex position
    let apex;
    if (options.useLstarMatching && options.kMeasurements) {
        const secondaryMinL = measurements[measurements.length - 1].lstar;
        apex = computeApexByLstarMatch(secondaryMinL, options.kMeasurements);
    } else {
        apex = computeApexByDensityRatio(dMax, referenceDMax);
    }

    const widthFactor = computeWidthFactor(measurements);
    const end = computeRecommendedEnd(inkLimitUsed, dMax, referenceDMax);
    const role = assignRole(apex);

    return { dMax, apex, widthFactor, end, role, L_paper };
}

// ============================================================================
// Linear Ramp Generation (for K channel)
// ============================================================================

/**
 * Generate a linear ramp curve scaled to ink limit
 * Used for K channel in the unified workflow
 * @param {number} inkLimit - Ink limit as percentage (0-100)
 * @returns {number[]} 256-point curve
 */
export function generateLinearRamp(inkLimit) {
    const curve = new Array(256);
    const maxValue = (inkLimit / 100) * 65535;
    for (let i = 0; i < 256; i++) {
        curve[i] = Math.round((i / 255) * maxValue);
    }
    return curve;
}

// ============================================================================
// Bell Curve Generation
// ============================================================================

/**
 * Generate a base bell curve using PCHIP interpolation
 * @param {number} peakIndex - Peak position (0-255)
 * @param {number} peakValue - Peak amplitude (default 65535)
 * @returns {number[]} 256-point bell curve
 */
export function generateBaseBell(peakIndex, peakValue = 65535) {
    // Create a symmetric base bell with 5 control points
    // This will be asymmetrically scaled later based on role
    const width = 60; // ~24% of 256 indices
    const halfWidth = width / 2;

    const controlPoints = [
        { x: Math.max(0, peakIndex - width), y: 0 },
        { x: Math.max(0, peakIndex - halfWidth), y: peakValue * 0.5 },
        { x: peakIndex, y: peakValue },
        { x: Math.min(255, peakIndex + halfWidth), y: peakValue * 0.5 },
        { x: Math.min(255, peakIndex + width), y: 0 }
    ];

    // Remove duplicate X values and ensure monotonic X
    const uniquePoints = [];
    for (const p of controlPoints) {
        if (uniquePoints.length === 0 || p.x > uniquePoints[uniquePoints.length - 1].x) {
            uniquePoints.push(p);
        }
    }

    // Need at least 2 points for interpolation
    if (uniquePoints.length < 2) {
        return new Array(256).fill(0);
    }

    // Generate 256-point curve via PCHIP
    const xs = uniquePoints.map(p => p.x);
    const ys = uniquePoints.map(p => p.y);
    const spline = createPCHIPSpline(xs, ys);

    const curve = new Array(256);
    for (let i = 0; i < 256; i++) {
        const val = spline(i);
        curve[i] = Math.max(0, Math.round(val));
    }

    // Ensure endpoints are zero (bell tails)
    curve[0] = Math.min(curve[0], curve[1] || 0);
    curve[255] = Math.min(curve[255], curve[254] || 0);

    return curve;
}

/**
 * Generate a bell curve with role-based asymmetry
 * @param {number} targetApexPercent - Target apex position (0-100)
 * @param {number} endValue - Target End value (0-100)
 * @param {'highlight' | 'midtone' | 'shadow'} role - Tonal role
 * @returns {number[]} 256-point bell curve
 */
export function generateBellForRole(targetApexPercent, endValue, role) {
    // Convert percent to index
    const targetApexIndex = Math.round((targetApexPercent / 100) * 255);

    // Generate base bell centered at target apex
    const baseCurve = generateBaseBell(targetApexIndex);

    // Find current apex (should be at targetApexIndex, but verify)
    const currentApexIndex = baseCurve.indexOf(Math.max(...baseCurve));

    // Shift if needed (deltaPercent = 0 if already positioned correctly)
    const deltaPercent = ((targetApexIndex - currentApexIndex) / 255) * 100;
    let curve = deltaPercent !== 0
        ? shiftBellCurve(baseCurve, currentApexIndex, deltaPercent)
        : baseCurve.slice();

    // Update apex index after shift
    const newApexIndex = curve.indexOf(Math.max(...curve));

    // Apply asymmetry based on role
    let leftFactor, rightFactor;
    if (role === 'highlight') {
        leftFactor = 0.6;   // Narrow the rise (steep attack)
        rightFactor = 1.5;  // Extend the tail (slow decay)
    } else if (role === 'midtone') {
        leftFactor = 1.4;   // Extend the rise (gradual build)
        rightFactor = 0.7;  // Compress the fall (faster dropoff)
    } else {
        leftFactor = 1.0;   // Symmetric (for shadow/testing)
        rightFactor = 1.0;
    }

    curve = scaleBellCurve(curve, newApexIndex, { leftFactor, rightFactor });

    // Scale to target End value
    const currentMax = Math.max(...curve);
    const targetMax = (endValue / 100) * 65535;
    const scale = currentMax > 0 ? targetMax / currentMax : 0;

    return curve.map(v => Math.round(Math.max(0, v * scale)));
}

/**
 * Generate a complete channel curve with parameters
 * @param {Object} params - { apex, end, widthFactor, role }
 * @returns {number[]} 256-point curve
 */
export function generateChannelCurve(params) {
    const { apex, end, widthFactor = 1.0, role } = params;

    // Generate base bell with role-based asymmetry
    let curve = generateBellForRole(apex, end, role || assignRole(apex));

    // Apply additional width scaling if widthFactor !== 1.0
    if (Math.abs(widthFactor - 1.0) > 0.01) {
        const apexIndex = curve.indexOf(Math.max(...curve));
        // Map widthFactor [0.6, 1.4] to scale factors [0.6, 1.4] for both sides
        const scaleFactor = widthFactor;
        curve = scaleBellCurve(curve, apexIndex, {
            leftFactor: scaleFactor,
            rightFactor: scaleFactor
        });
    }

    return curve;
}

// ============================================================================
// K Carve-Out
// ============================================================================

/**
 * Compute overlap margins for channel placement
 * @param {number} previousPeakPercent - Previous channel's peak position
 * @param {number} startOverlap - Start overlap fraction (default 0.25)
 * @returns {number} Position where next channel should start
 */
export function computeStartOverlap(previousPeakPercent, startOverlap = 0.25) {
    return Math.max(0, previousPeakPercent - (startOverlap * 100));
}

/**
 * Compute symmetric bracket around midtone peak
 * @param {number} midtonePeak - Midtone channel's peak position
 * @param {number} bracketMargin - Bracket margin fraction (default 0.13)
 * @returns {{highlightEnd: number, shadowStart: number}}
 */
export function computeSymmetricBracket(midtonePeak, bracketMargin = 0.13) {
    return {
        highlightEnd: midtonePeak + (bracketMargin * 100),
        shadowStart: midtonePeak - (bracketMargin * 100)
    };
}

/**
 * Compute where K should start based on secondary coverage
 * Uses the LATER (darker) of bracket vs threshold methods
 * @param {Array<{curve: number[], endPercent?: number}>} secondaryChannels - Secondary channel curves
 * @param {number} midtonePeakPercent - Midtone peak position
 * @param {number} bracketMargin - Symmetric bracket margin (default 0.13)
 * @param {number} thresholdFraction - Coverage threshold fraction (default 0.5)
 * @returns {number} K start index (0-255)
 */
export function computeKStartPoint(secondaryChannels, midtonePeakPercent = 50, bracketMargin = 0.13, thresholdFraction = 0.5) {
    // Method 1: Symmetric bracket
    const bracketStart = Math.round(((midtonePeakPercent - bracketMargin * 100) / 100) * 255);

    // Method 2: Coverage threshold
    const totalCoverage = new Array(256).fill(0);
    for (const channel of secondaryChannels) {
        if (!channel.curve) continue;
        for (let i = 0; i < 256; i++) {
            totalCoverage[i] += channel.curve[i] / 65535;
        }
    }

    const maxCoverage = Math.max(...totalCoverage);

    // Guard: if all secondary channels have zero coverage, use bracket method only
    if (maxCoverage < 0.01) {
        return Math.max(0, bracketStart);
    }

    const threshold = maxCoverage * thresholdFraction;

    let thresholdStart = 0;
    for (let i = 255; i >= 0; i--) {
        if (totalCoverage[i] >= threshold) {
            thresholdStart = i;
            break;
        }
    }

    // Use the LATER (darker) of the two methods
    return Math.max(bracketStart, thresholdStart);
}

/**
 * Carve out K where secondaries provide coverage
 * Preserves K's calibration shape using mask multiplication
 * @param {number[]} originalK - Original K curve (256 points)
 * @param {number} startIndex - Where K should start
 * @param {number} transitionWidth - Width of fade-in transition (default 20)
 * @returns {number[]} Carved-out K curve
 */
export function carveOutK(originalK, startIndex, transitionWidth = 20) {
    const result = new Array(256);

    // Clamp to valid range
    const safeStart = Math.max(0, Math.min(254, startIndex));
    const safeEnd = Math.min(255, safeStart + transitionWidth);

    // Build smooth mask using PCHIP
    // Ensure monotonic X values (no duplicates)
    const maskPoints = [
        { x: 0, y: 0 },
        { x: Math.max(1, safeStart), y: 0 },
        { x: safeEnd, y: 1 },
        { x: 255, y: 1 }
    ];

    // Remove duplicate X values
    const uniquePoints = [];
    for (const p of maskPoints) {
        if (uniquePoints.length === 0 || p.x > uniquePoints[uniquePoints.length - 1].x) {
            uniquePoints.push(p);
        }
    }

    const xs = uniquePoints.map(p => p.x);
    const ys = uniquePoints.map(p => p.y);
    const spline = createPCHIPSpline(xs, ys);

    // Generate mask and apply to original K
    for (let i = 0; i < 256; i++) {
        const maskValue = Math.max(0, Math.min(1, spline(i)));
        result[i] = Math.round((originalK[i] || 0) * maskValue);
    }

    return result;
}

/**
 * Compute cumulative K reduction from multiple secondary channels
 * @param {Array<{curve: number[], endPercent?: number}>} secondaryChannels - All secondary channels
 * @param {number[]} referenceK - Original reference K curve
 * @param {number} midtonePeakPercent - Midtone anchor peak position
 * @param {Object} options - { bracketMargin, thresholdFraction, transitionWidth }
 * @returns {{kCurve: number[], startIndex: number}}
 */
export function computeKReduction(secondaryChannels, referenceK, midtonePeakPercent = 50, options = {}) {
    const {
        bracketMargin = 0.13,
        thresholdFraction = 0.5,
        transitionWidth = 20
    } = options;

    const startIndex = computeKStartPoint(
        secondaryChannels,
        midtonePeakPercent,
        bracketMargin,
        thresholdFraction
    );

    const kCurve = carveOutK(referenceK, startIndex, transitionWidth);

    return { kCurve, startIndex };
}

// ============================================================================
// Measurement Validation
// ============================================================================

/**
 * Validate measurement data quality
 * @param {Array<{input: number, lstar: number}>} measurements - L* measurements
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateMeasurements(measurements) {
    const errors = [];
    const warnings = [];

    if (!measurements || !Array.isArray(measurements)) {
        errors.push('Measurements must be an array');
        return { valid: false, errors, warnings };
    }

    // 1. Minimum point count
    if (measurements.length < 5) {
        errors.push('Minimum 5 measurement points required');
    }

    // 2. Endpoint coverage
    if (measurements.length > 0 && measurements[0].input > 5) {
        errors.push('First measurement should be at or near 0% input (paper white)');
    }
    if (measurements.length > 0 && measurements[measurements.length - 1].input < 95) {
        errors.push('Last measurement should be at or near 100% input (max ink)');
    }

    // 3. L* range validation
    for (const m of measurements) {
        if (m.lstar < 0 || m.lstar > 100) {
            errors.push(`L* value ${m.lstar} out of range [0, 100]`);
        }
    }

    // 4. Gap detection (warn if any gap > 20%)
    for (let i = 1; i < measurements.length; i++) {
        const gap = measurements[i].input - measurements[i - 1].input;
        if (gap > 20) {
            warnings.push(`Large gap (${gap}%) between points ${i - 1} and ${i}`);
        }
    }

    // 5. Monotonicity check (L* should decrease as input increases for positive prints)
    let nonMonotonic = false;
    for (let i = 1; i < measurements.length; i++) {
        if (measurements[i].lstar > measurements[i - 1].lstar + 1) {
            // Allow small tolerance (1 L*) for measurement noise
            nonMonotonic = true;
            break;
        }
    }
    if (nonMonotonic) {
        warnings.push('Non-monotonic L* values detected - consider PCHIP smoothing');
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate total ink across all channels
 * @param {Array<{curve: number[], endPercent?: number}>} channels - All channels
 * @param {number} warnThreshold - Warning threshold (default 50)
 * @param {number} maxThreshold - Maximum threshold (default 100)
 * @returns {string[]} Warning messages
 */
export function validateTotalInk(channels, warnThreshold = 50, maxThreshold = 100) {
    const warnings = [];
    let warnCount = 0;
    let maxCount = 0;

    for (let i = 0; i < 256; i++) {
        let total = 0;
        for (const ch of channels) {
            if (!ch.curve) continue;
            const endPercent = ch.endPercent || 100;
            total += (ch.curve[i] / 65535) * endPercent;
        }

        if (total > maxThreshold) {
            maxCount++;
            if (maxCount <= 3) {  // Limit detailed messages
                const inputPercent = Math.round(i / 2.55);
                warnings.push(`Total ink ${total.toFixed(1)}% at input ${inputPercent}% exceeds max ${maxThreshold}%`);
            }
        } else if (total > warnThreshold) {
            warnCount++;
        }
    }

    if (maxCount > 3) {
        warnings.push(`... and ${maxCount - 3} more points exceeding ${maxThreshold}%`);
    }
    if (warnCount > 0) {
        warnings.unshift(`⚠️ ${warnCount} points exceed ${warnThreshold}% (warning threshold)`);
    }

    return warnings;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Complete channel calibration computation
 * @param {{measurements: Array, dMax: number, curve?: number[]}} referenceK - Reference K channel data
 * @param {{name: string, inkLimit: number, measurements: Array}} newChannel - New channel to calibrate
 * @param {Object} options - Additional options
 * @returns {{dMax: number, recommendedEnd: number, recommendedApex: number, recommendedWidth: number, role: string, curve: number[], kReductionCurve: number[], validation: Object}}
 */
export function computeChannelCalibration(referenceK, newChannel, options = {}) {
    // Validate input measurements
    const validation = validateMeasurements(newChannel.measurements);

    // Compute bell parameters
    const params = computeBellParameters(
        newChannel.measurements,
        referenceK.dMax,
        newChannel.inkLimit,
        {
            useLstarMatching: options.useLstarMatching,
            kMeasurements: referenceK.measurements
        }
    );

    // Generate channel curve
    const curve = generateChannelCurve({
        apex: params.apex,
        end: params.end,
        widthFactor: params.widthFactor,
        role: params.role
    });

    // Compute K reduction if reference K curve is provided
    let kReductionCurve = null;
    if (referenceK.curve) {
        const secondaryChannels = options.existingSecondaries || [];
        secondaryChannels.push({ curve, endPercent: params.end });

        const { kCurve } = computeKReduction(
            secondaryChannels,
            referenceK.curve,
            options.midtonePeakPercent || params.apex,
            options
        );
        kReductionCurve = kCurve;
    }

    return {
        dMax: params.dMax,
        recommendedEnd: params.end,
        recommendedApex: params.apex,
        recommendedWidth: params.widthFactor,
        role: params.role,
        curve,
        kReductionCurve,
        validation
    };
}

// Export all functions for testing and direct use
export default {
    // Density
    lstarToY,
    computeDensity,
    computeDensityProfile,
    // Bell parameters
    computeApexByDensityRatio,
    computeApexByLstarMatch,
    computeWidthFactor,
    assignRole,
    computeRecommendedEnd,
    computeBellParameters,
    // Linear ramp (for K channel)
    generateLinearRamp,
    // Bell generation
    generateBaseBell,
    generateBellForRole,
    generateChannelCurve,
    // K carve-out
    computeStartOverlap,
    computeSymmetricBracket,
    computeKStartPoint,
    carveOutK,
    computeKReduction,
    // Validation
    validateMeasurements,
    validateTotalInk,
    // Main API
    computeChannelCalibration
};
