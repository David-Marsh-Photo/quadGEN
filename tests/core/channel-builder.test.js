import { describe, it, expect, beforeEach } from 'vitest';

import {
    lstarToY,
    computeDensity,
    computeDensityProfile,
    computeApexByDensityRatio,
    computeApexByLstarMatch,
    computeWidthFactor,
    assignRole,
    computeRecommendedEnd,
    computeBellParameters,
    generateLinearRamp,
    generateBaseBell,
    generateBellForRole,
    generateChannelCurve,
    computeStartOverlap,
    computeSymmetricBracket,
    computeKStartPoint,
    carveOutK,
    computeKReduction,
    validateMeasurements,
    validateTotalInk,
    computeChannelCalibration
} from '../../src/js/core/channel-builder.js';

import {
    setReferenceKFromMeasurements,
    getReferenceK,
    clearSession
} from '../../src/js/core/channel-builder-state.js';

// ============================================================================
// Test Data
// ============================================================================

// Simulated K channel measurements (typical inkjet)
const kMeasurements = [
    { input: 0, lstar: 95.5 },
    { input: 10, lstar: 87.2 },
    { input: 20, lstar: 78.1 },
    { input: 30, lstar: 68.5 },
    { input: 40, lstar: 58.9 },
    { input: 50, lstar: 49.2 },
    { input: 60, lstar: 39.8 },
    { input: 70, lstar: 30.5 },
    { input: 80, lstar: 22.1 },
    { input: 90, lstar: 15.3 },
    { input: 100, lstar: 11.2 }
];

// Simulated light ink measurements (e.g., LK)
const lkMeasurements = [
    { input: 0, lstar: 95.2 },
    { input: 10, lstar: 91.5 },
    { input: 20, lstar: 87.8 },
    { input: 30, lstar: 83.4 },
    { input: 40, lstar: 78.5 },
    { input: 50, lstar: 73.1 },
    { input: 60, lstar: 67.8 },
    { input: 70, lstar: 62.5 },
    { input: 80, lstar: 57.3 },
    { input: 90, lstar: 52.6 },
    { input: 100, lstar: 48.2 }
];

// ============================================================================
// Density Conversion Tests
// ============================================================================

describe('lstarToY', () => {
    it('returns 1 for L* = 100', () => {
        expect(lstarToY(100)).toBeCloseTo(1.0, 3);
    });

    it('returns approximately 0.18 for L* = 50', () => {
        // L*=50 corresponds to Y≈0.1841
        expect(lstarToY(50)).toBeCloseTo(0.1841, 2);
    });

    it('returns 0 for L* = 0', () => {
        expect(lstarToY(0)).toBeCloseTo(0, 5);
    });

    it('clamps values outside 0-100 range', () => {
        expect(lstarToY(-10)).toBe(lstarToY(0));
        expect(lstarToY(110)).toBe(lstarToY(100));
    });
});

describe('computeDensity', () => {
    it('returns 0 when patch equals paper', () => {
        expect(computeDensity(95, 95)).toBeCloseTo(0, 5);
    });

    it('returns positive density when patch is darker', () => {
        const density = computeDensity(50, 95);
        expect(density).toBeGreaterThan(0);
    });

    it('returns higher density for darker patches', () => {
        const d1 = computeDensity(50, 95);
        const d2 = computeDensity(20, 95);
        expect(d2).toBeGreaterThan(d1);
    });
});

describe('computeDensityProfile', () => {
    it('computes dMax from measurements', () => {
        const { dMax, L_paper } = computeDensityProfile(kMeasurements);
        expect(dMax).toBeGreaterThan(1.0); // K typically has dMax > 1.5
        expect(L_paper).toBe(95.5);
    });

    it('returns empty results for invalid input', () => {
        const { densities, dMax } = computeDensityProfile(null);
        expect(densities).toEqual([]);
        expect(dMax).toBe(0);
    });
});

// ============================================================================
// Bell Parameter Tests
// ============================================================================

describe('computeApexByDensityRatio', () => {
    it('returns 50% when densities are equal', () => {
        expect(computeApexByDensityRatio(1.0, 2.0)).toBe(50);
    });

    it('returns higher apex for denser ink', () => {
        const apex = computeApexByDensityRatio(1.5, 2.0);
        expect(apex).toBe(75);
    });

    it('clamps to valid range', () => {
        expect(computeApexByDensityRatio(3.0, 2.0)).toBeLessThanOrEqual(95);
        expect(computeApexByDensityRatio(0.05, 2.0)).toBeGreaterThanOrEqual(5);
    });

    it('returns 50 for invalid reference dMax', () => {
        expect(computeApexByDensityRatio(1.0, 0)).toBe(50);
        expect(computeApexByDensityRatio(1.0, null)).toBe(50);
    });
});

describe('computeApexByLstarMatch', () => {
    it('finds input position where K matches secondary minimum L*', () => {
        // LK min L* = 48.2, find where K reaches ~48
        const apex = computeApexByLstarMatch(48.2, kMeasurements);
        // Should be around 50-55% input range
        expect(apex).toBeGreaterThan(40);
        expect(apex).toBeLessThan(60);
    });

    it('returns 100 if no match found', () => {
        // Try to match L* = 5 which K never reaches
        const apex = computeApexByLstarMatch(5, kMeasurements);
        expect(apex).toBe(100);
    });
});

describe('computeWidthFactor', () => {
    it('returns 1.0 for standard response curve', () => {
        const width = computeWidthFactor(kMeasurements);
        expect(width).toBeGreaterThanOrEqual(0.6);
        expect(width).toBeLessThanOrEqual(1.4);
    });

    it('returns default for insufficient data', () => {
        expect(computeWidthFactor([])).toBe(1.0);
        expect(computeWidthFactor([{ input: 0, lstar: 95 }])).toBe(1.0);
    });
});

describe('assignRole', () => {
    it('assigns highlight for apex < 40%', () => {
        expect(assignRole(30)).toBe('highlight');
        expect(assignRole(39)).toBe('highlight');
    });

    it('assigns midtone for apex 40-70%', () => {
        expect(assignRole(40)).toBe('midtone');
        expect(assignRole(55)).toBe('midtone');
        expect(assignRole(69)).toBe('midtone');
    });

    it('assigns shadow for apex >= 70%', () => {
        expect(assignRole(70)).toBe('shadow');
        expect(assignRole(90)).toBe('shadow');
    });
});

describe('computeRecommendedEnd', () => {
    it('returns ink limit when channel equals reference density', () => {
        const end = computeRecommendedEnd(70, 1.8, 1.8);
        expect(end).toBeCloseTo(70, 0);
    });

    it('scales down for weaker secondary', () => {
        const end = computeRecommendedEnd(70, 1.44, 1.8); // 80% efficiency
        expect(end).toBeCloseTo(56, 0); // 70 * 0.8
    });

    it('caps at ink limit for stronger secondary', () => {
        const end = computeRecommendedEnd(70, 2.0, 1.8);
        expect(end).toBeLessThanOrEqual(70);
    });
});

// ============================================================================
// Bell Curve Generation Tests
// ============================================================================

describe('generateBaseBell', () => {
    it('generates 256-point curve', () => {
        const bell = generateBaseBell(128);
        expect(bell).toHaveLength(256);
    });

    it('peaks at specified index', () => {
        const peakIndex = 100;
        const bell = generateBaseBell(peakIndex);
        const maxValue = Math.max(...bell);
        const actualPeakIndex = bell.indexOf(maxValue);
        // Allow some tolerance due to curve shape
        expect(Math.abs(actualPeakIndex - peakIndex)).toBeLessThan(10);
    });

    it('has non-negative values', () => {
        const bell = generateBaseBell(128);
        expect(bell.every(v => v >= 0)).toBe(true);
    });
});

describe('generateBellForRole', () => {
    it('generates highlight bell with steep rise', () => {
        const bell = generateBellForRole(30, 25, 'highlight');
        expect(bell).toHaveLength(256);
        // Peak should be near 30%
        const peakIndex = bell.indexOf(Math.max(...bell));
        expect(peakIndex).toBeLessThan(100); // Before midpoint
    });

    it('generates midtone bell with gradual rise', () => {
        const bell = generateBellForRole(60, 30, 'midtone');
        const peakIndex = bell.indexOf(Math.max(...bell));
        expect(peakIndex).toBeGreaterThan(100);
        expect(peakIndex).toBeLessThan(200);
    });

    it('scales to target End value', () => {
        const endValue = 25; // 25%
        const bell = generateBellForRole(50, endValue, 'midtone');
        const maxValue = Math.max(...bell);
        const expectedMax = (endValue / 100) * 65535;
        expect(maxValue).toBeCloseTo(expectedMax, -1); // Allow some rounding
    });
});

describe('generateChannelCurve', () => {
    it('generates curve from parameters', () => {
        const curve = generateChannelCurve({
            apex: 35,
            end: 28,
            widthFactor: 1.0,
            role: 'highlight'
        });
        expect(curve).toHaveLength(256);
        expect(Math.max(...curve)).toBeGreaterThan(0);
    });
});

// ============================================================================
// K Carve-Out Tests
// ============================================================================

describe('computeStartOverlap', () => {
    it('computes start position before peak', () => {
        const start = computeStartOverlap(34, 0.25);
        expect(start).toBe(9); // 34 - 25 = 9
    });

    it('clamps to zero', () => {
        const start = computeStartOverlap(10, 0.25);
        expect(start).toBeGreaterThanOrEqual(0);
    });
});

describe('computeSymmetricBracket', () => {
    it('computes symmetric margin around midtone', () => {
        const { highlightEnd, shadowStart } = computeSymmetricBracket(73, 0.13);
        expect(highlightEnd).toBeCloseTo(86, 0); // 73 + 13
        expect(shadowStart).toBeCloseTo(60, 0);  // 73 - 13
    });
});

describe('computeKStartPoint', () => {
    it('returns later of bracket vs threshold', () => {
        // Create mock secondary channels
        const bell = generateBellForRole(50, 30, 'midtone');
        const channels = [{ curve: bell, endPercent: 30 }];

        const startIndex = computeKStartPoint(channels, 50, 0.13, 0.5);
        // Should be around index 94 (50% - 13% = 37% ≈ index 94)
        expect(startIndex).toBeGreaterThan(50);
        expect(startIndex).toBeLessThan(200);
    });
});

describe('carveOutK', () => {
    it('zeros values before start index', () => {
        const originalK = new Array(256).fill(0).map((_, i) => Math.round((i / 255) * 65535));
        const startIndex = 150;
        const carved = carveOutK(originalK, startIndex, 20);

        // Values well before start should be near zero
        expect(carved[100]).toBe(0);

        // Values after transition should match original scaled
        expect(carved[255]).toBeGreaterThan(0);
    });

    it('preserves curve shape in active region', () => {
        const originalK = new Array(256).fill(0).map((_, i) => Math.round((i / 255) * 65535));
        const carved = carveOutK(originalK, 100, 20);

        // Check that curve increases through transition
        expect(carved[120]).toBeGreaterThan(carved[110]);
        expect(carved[130]).toBeGreaterThan(carved[120]);
    });
});

describe('computeKReduction', () => {
    it('returns carved K curve', () => {
        const refK = new Array(256).fill(0).map((_, i) => Math.round((i / 255) * 65535));
        const bell = generateBellForRole(50, 30, 'midtone');
        const channels = [{ curve: bell, endPercent: 30 }];

        const { kCurve, startIndex } = computeKReduction(channels, refK, 50);

        expect(kCurve).toHaveLength(256);
        expect(startIndex).toBeGreaterThan(0);
        expect(kCurve[0]).toBe(0); // Carved out at start
    });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('validateMeasurements', () => {
    it('passes valid measurements', () => {
        const { valid, errors } = validateMeasurements(kMeasurements);
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
    });

    it('fails with too few points', () => {
        const { valid, errors } = validateMeasurements([
            { input: 0, lstar: 95 },
            { input: 100, lstar: 10 }
        ]);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('Minimum 5'))).toBe(true);
    });

    it('fails with missing endpoints', () => {
        const { valid, errors } = validateMeasurements([
            { input: 20, lstar: 80 },
            { input: 40, lstar: 60 },
            { input: 60, lstar: 40 },
            { input: 80, lstar: 20 },
            { input: 90, lstar: 10 }
        ]);
        expect(valid).toBe(false);
    });

    it('warns on large gaps', () => {
        const { warnings } = validateMeasurements([
            { input: 0, lstar: 95 },
            { input: 25, lstar: 70 },
            { input: 50, lstar: 50 },
            { input: 75, lstar: 30 },
            { input: 100, lstar: 10 }
        ]);
        expect(warnings.some(w => w.includes('gap'))).toBe(true);
    });

    it('warns on non-monotonic L*', () => {
        const { warnings } = validateMeasurements([
            { input: 0, lstar: 95 },
            { input: 20, lstar: 80 },
            { input: 40, lstar: 85 }, // Non-monotonic
            { input: 60, lstar: 50 },
            { input: 80, lstar: 30 },
            { input: 100, lstar: 10 }
        ]);
        expect(warnings.some(w => w.includes('monotonic'))).toBe(true);
    });
});

describe('validateTotalInk', () => {
    it('returns empty for low ink curves', () => {
        const channels = [
            { curve: new Array(256).fill(10000), endPercent: 20 },
            { curve: new Array(256).fill(10000), endPercent: 20 }
        ];
        const warnings = validateTotalInk(channels, 50, 100);
        expect(warnings).toHaveLength(0);
    });

    it('warns when total exceeds threshold', () => {
        // Create channels with high ink values that exceed 100% total
        // curve value 50000/65535 ≈ 76.3% × endPercent 80% = ~61% each
        // Two channels = ~122% total, exceeds 100% threshold
        const channels = [
            { curve: new Array(256).fill(50000), endPercent: 80 },
            { curve: new Array(256).fill(50000), endPercent: 80 }
        ];
        const warnings = validateTotalInk(channels, 50, 100);
        expect(warnings.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('computeChannelCalibration', () => {
    it('computes full calibration from measurements', () => {
        // Setup reference K
        const { dMax: kDMax } = computeDensityProfile(kMeasurements);
        const referenceK = {
            measurements: kMeasurements,
            dMax: kDMax,
            curve: new Array(256).fill(0).map((_, i) => Math.round((i / 255) * 65535))
        };

        // Calibrate LK
        const result = computeChannelCalibration(referenceK, {
            name: 'LK',
            inkLimit: 70,
            measurements: lkMeasurements
        });

        expect(result.dMax).toBeGreaterThan(0);
        expect(result.recommendedEnd).toBeGreaterThan(0);
        expect(result.recommendedEnd).toBeLessThanOrEqual(70);
        expect(result.recommendedApex).toBeGreaterThan(5);
        expect(result.recommendedApex).toBeLessThan(95);
        expect(result.role).toBe('highlight'); // LK should be highlight
        expect(result.curve).toHaveLength(256);
        expect(result.kReductionCurve).toHaveLength(256);
        expect(result.validation.valid).toBe(true);
    });
});

// ============================================================================
// Bug Fix Verification Tests
// ============================================================================

describe('computeWidthFactor - inverted mapping fix', () => {
    it('returns lower values for steep slopes', () => {
        // Steep slope: L* drops quickly (e.g., 95 to 20 over small input range)
        const steepMeasurements = [
            { input: 0, lstar: 95 },
            { input: 10, lstar: 70 },
            { input: 20, lstar: 45 },
            { input: 30, lstar: 25 },
            { input: 40, lstar: 15 },
            { input: 50, lstar: 12 },
            { input: 100, lstar: 10 }
        ];

        // Gradual slope: L* drops slowly
        const gradualMeasurements = [
            { input: 0, lstar: 95 },
            { input: 20, lstar: 85 },
            { input: 40, lstar: 70 },
            { input: 60, lstar: 55 },
            { input: 80, lstar: 40 },
            { input: 100, lstar: 30 }
        ];

        const steepWidth = computeWidthFactor(steepMeasurements);
        const gradualWidth = computeWidthFactor(gradualMeasurements);

        // Steep slopes should produce narrower bells (lower factor)
        expect(steepWidth).toBeLessThan(gradualWidth);
        // Both should be in valid range
        expect(steepWidth).toBeGreaterThanOrEqual(0.6);
        expect(gradualWidth).toBeLessThanOrEqual(1.4);
    });
});

describe('computeKStartPoint - zero coverage fix', () => {
    it('returns reasonable value (not 255) when all channels have zero coverage', () => {
        // Empty curves (zero coverage)
        const zeroCoverageChannels = [
            { curve: new Array(256).fill(0), endPercent: 50 },
            { curve: new Array(256).fill(0), endPercent: 50 }
        ];

        const startIndex = computeKStartPoint(zeroCoverageChannels, 50, 0.13, 0.5);

        // Should return bracket-based start, not 255
        // Bracket start = (50 - 13) / 100 * 255 ≈ 94
        expect(startIndex).toBeLessThan(200);
        expect(startIndex).toBeGreaterThanOrEqual(0);
    });

    it('still works correctly with valid coverage', () => {
        const bell = generateBellForRole(50, 30, 'midtone');
        const channels = [{ curve: bell, endPercent: 30 }];

        const startIndex = computeKStartPoint(channels, 50, 0.13, 0.5);
        expect(startIndex).toBeGreaterThan(50);
        expect(startIndex).toBeLessThan(200);
    });
});

// ============================================================================
// K from Measurements + Ink Limit Tests (Unified Workflow)
// ============================================================================

describe('generateLinearRamp', () => {
    it('generates linear ramp scaled to ink limit', () => {
        const inkLimit = 33;
        const curve = generateLinearRamp(inkLimit);
        const maxValue = (inkLimit / 100) * 65535;

        expect(curve).toHaveLength(256);
        expect(curve[0]).toBe(0);
        // Allow for rounding (within 1 unit)
        expect(Math.abs(curve[255] - maxValue)).toBeLessThanOrEqual(1);
        // Mid-point should be approximately half of max (within 100 units due to discrete sampling)
        expect(Math.abs(curve[128] - maxValue / 2)).toBeLessThan(100);
    });

    it('curve max value matches ink limit percentage', () => {
        const inkLimit = 50;
        const curve = generateLinearRamp(inkLimit);

        const actualMax = Math.max(...curve);
        const expectedMax = (inkLimit / 100) * 65535;
        // Allow for rounding (within 1 unit)
        expect(Math.abs(actualMax - expectedMax)).toBeLessThanOrEqual(1);
    });

    it('handles full ink limit (100%)', () => {
        const curve = generateLinearRamp(100);
        expect(curve[255]).toBe(65535);
        expect(curve[0]).toBe(0);
    });

    it('handles low ink limit', () => {
        const curve = generateLinearRamp(10);
        const expectedMax = (10 / 100) * 65535;
        // Allow for rounding (within 1 unit)
        expect(Math.abs(curve[255] - expectedMax)).toBeLessThanOrEqual(1);
    });
});

describe('K workflow with measurements and ink limit', () => {
    it('computes dMax from K measurements', () => {
        const { dMax, L_paper } = computeDensityProfile(kMeasurements);

        expect(dMax).toBeGreaterThan(1.0);
        expect(L_paper).toBe(95.5);
    });

    it('K dMax serves as reference for secondary apex calculation', () => {
        const { dMax: kDMax } = computeDensityProfile(kMeasurements);
        const { dMax: lkDMax } = computeDensityProfile(lkMeasurements);

        // LK should have lower dMax than K
        expect(lkDMax).toBeLessThan(kDMax);

        // Apex should be computed from ratio
        const apex = computeApexByDensityRatio(lkDMax, kDMax);
        expect(apex).toBeGreaterThan(0);
        expect(apex).toBeLessThan(100);
    });

    it('carve-out works correctly on linear K ramp', () => {
        // Generate a linear ramp for K at 33% ink limit
        const inkLimit = 33;
        const linearK = generateLinearRamp(inkLimit);

        // Carve out at 60%
        const startIndex = Math.round(0.6 * 255); // ~153
        const carved = carveOutK(linearK, startIndex, 20);

        // Values before start should be zero
        expect(carved[100]).toBe(0);
        expect(carved[130]).toBe(0);

        // Values in transition should be ramping up
        expect(carved[160]).toBeGreaterThan(0);
        expect(carved[170]).toBeGreaterThan(carved[160]);

        // Values after transition should match original scaled by mask
        expect(carved[255]).toBeCloseTo(linearK[255], 0);
    });

    it('complete workflow: K linear ramp + secondary calibration', () => {
        // Step 1: K channel setup with ink limit using generateLinearRamp
        const kInkLimit = 33;
        const { dMax: kDMax } = computeDensityProfile(kMeasurements);
        const kCurve = generateLinearRamp(kInkLimit);

        const referenceK = {
            measurements: kMeasurements,
            dMax: kDMax,
            curve: kCurve,
            inkLimit: kInkLimit
        };

        // Step 2: Calibrate secondary channel (LK)
        const result = computeChannelCalibration(referenceK, {
            name: 'LK',
            inkLimit: 70,
            measurements: lkMeasurements
        });

        // Verify results
        expect(result.dMax).toBeGreaterThan(0);
        expect(result.recommendedApex).toBeGreaterThan(5);
        expect(result.recommendedApex).toBeLessThan(95);
        expect(result.role).toBe('highlight');
        expect(result.curve).toHaveLength(256);
        expect(result.kReductionCurve).toHaveLength(256);

        // K reduction should preserve the linear ramp shape in the active region
        expect(result.kReductionCurve[255]).toBeCloseTo(kCurve[255], 0);
        // But should be zero in the carved region
        expect(result.kReductionCurve[50]).toBe(0);
    });
});

describe('validateTotalInk - warnThreshold fix', () => {
    it('reports warnings when exceeding warnThreshold but not maxThreshold', () => {
        // Create channels with moderate ink that exceeds 50% but not 100%
        // curve value 40000/65535 ≈ 61% × endPercent 50% = ~30.5% each
        // Two channels = ~61% total, exceeds 50% warn but not 100% max
        const channels = [
            { curve: new Array(256).fill(40000), endPercent: 50 },
            { curve: new Array(256).fill(40000), endPercent: 50 }
        ];

        const warnings = validateTotalInk(channels, 50, 100);

        // Should have warning about exceeding warnThreshold
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some(w => w.includes('warning threshold') || w.includes('50%'))).toBe(true);
        // Should NOT have max threshold warnings (no "exceeds max")
        expect(warnings.some(w => w.includes('exceeds max'))).toBe(false);
    });

    it('reports both warnings when exceeding both thresholds', () => {
        // High ink that exceeds both thresholds
        const channels = [
            { curve: new Array(256).fill(60000), endPercent: 100 },
            { curve: new Array(256).fill(60000), endPercent: 100 }
        ];

        const warnings = validateTotalInk(channels, 50, 100);

        // Should have both warn and max threshold messages
        expect(warnings.length).toBeGreaterThan(1);
        expect(warnings.some(w => w.includes('exceeds max'))).toBe(true);
    });

    it('limits detailed max threshold messages to 3', () => {
        // Very high ink throughout
        const channels = [
            { curve: new Array(256).fill(65535), endPercent: 100 },
            { curve: new Array(256).fill(65535), endPercent: 100 }
        ];

        const warnings = validateTotalInk(channels, 50, 100);

        // Should have limited detailed messages plus a "... and N more" message
        const maxExceedMessages = warnings.filter(w => w.includes('exceeds max'));
        expect(maxExceedMessages.length).toBeLessThanOrEqual(4); // 3 detailed + 1 "and more"
        expect(warnings.some(w => w.includes('more points exceeding'))).toBe(true);
    });
});

// ============================================================================
// setReferenceKFromMeasurements State Function Tests
// ============================================================================

describe('setReferenceKFromMeasurements', () => {
    beforeEach(() => {
        // Clear session state before each test
        clearSession();
    });

    it('returns false for invalid measurements (<2 points)', () => {
        const result = setReferenceKFromMeasurements(33, [{ input: 0, lstar: 95 }], computeDensityProfile);
        expect(result).toBe(false);

        const result2 = setReferenceKFromMeasurements(33, [], computeDensityProfile);
        expect(result2).toBe(false);

        const result3 = setReferenceKFromMeasurements(33, null, computeDensityProfile);
        expect(result3).toBe(false);
    });

    it('returns false for invalid ink limit (<=0 or >100)', () => {
        const validMeasurements = [
            { input: 0, lstar: 95 },
            { input: 50, lstar: 50 },
            { input: 100, lstar: 10 }
        ];

        expect(setReferenceKFromMeasurements(0, validMeasurements, computeDensityProfile)).toBe(false);
        expect(setReferenceKFromMeasurements(-10, validMeasurements, computeDensityProfile)).toBe(false);
        expect(setReferenceKFromMeasurements(101, validMeasurements, computeDensityProfile)).toBe(false);
    });

    it('returns true and sets state for valid inputs', () => {
        const measurements = [
            { input: 0, lstar: 95 },
            { input: 50, lstar: 50 },
            { input: 100, lstar: 10 }
        ];

        const result = setReferenceKFromMeasurements(33, measurements, computeDensityProfile);
        expect(result).toBe(true);

        const refK = getReferenceK();
        expect(refK).not.toBeNull();
        expect(refK.name).toBe('K');
        expect(refK.inkLimit).toBe(33);
        expect(refK.measurements).toHaveLength(3);
    });

    it('generates linear ramp curve scaled to ink limit', () => {
        const measurements = [
            { input: 0, lstar: 95 },
            { input: 50, lstar: 50 },
            { input: 100, lstar: 10 }
        ];

        setReferenceKFromMeasurements(33, measurements, computeDensityProfile);

        const refK = getReferenceK();
        expect(refK.curve).toHaveLength(256);
        expect(refK.curve[0]).toBe(0);

        // Max value should be ~33% of 65535
        const expectedMax = Math.round((33 / 100) * 65535);
        expect(Math.abs(refK.curve[255] - expectedMax)).toBeLessThanOrEqual(1);
    });

    it('computes dMax from measurements', () => {
        const measurements = [
            { input: 0, lstar: 95.5 },
            { input: 50, lstar: 49.2 },
            { input: 100, lstar: 11.2 }
        ];

        setReferenceKFromMeasurements(33, measurements, computeDensityProfile);

        const refK = getReferenceK();
        expect(refK.dMax).toBeGreaterThan(0);
        expect(refK.L_paper).toBe(95.5);
    });

    it('stores L_paper from first measurement point', () => {
        const measurements = [
            { input: 0, lstar: 97.2 },
            { input: 50, lstar: 55 },
            { input: 100, lstar: 15 }
        ];

        setReferenceKFromMeasurements(50, measurements, computeDensityProfile);

        const refK = getReferenceK();
        expect(refK.L_paper).toBe(97.2);
    });
});
