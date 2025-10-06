import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    detectActiveRange,
    remapActiveRange,
    apply1DLUT,
    apply1DLUTFixedDomain
} from '../../src/js/core/processing-pipeline.js';
import {
    setActiveRangeLinearizationEnabled,
    resetFeatureFlags
} from '../../src/js/core/feature-flags.js';

function buildDelayedOnsetCurve({ onsetIndex, maxValue }) {
    const curve = new Array(256).fill(0);
    const span = 255 - onsetIndex;
    for (let i = onsetIndex; i < 256; i++) {
        const fraction = span === 0 ? 1 : (i - onsetIndex) / span;
        curve[i] = Math.round(fraction * maxValue);
    }
    return curve;
}

function buildTargetCurve({ onsetIndex, maxValue }) {
    return buildDelayedOnsetCurve({ onsetIndex, maxValue });
}

function computeExpectedRemap(baseCurve, targetCurve) {
    const activeRange = detectActiveRange(baseCurve);
    const targetRange = detectActiveRange(targetCurve);
    const result = new Array(baseCurve.length).fill(0);

    if (!activeRange.isActive || !targetRange.isActive) {
        return result;
    }

    const span = activeRange.span || 1;
    const targetSpan = targetRange.span || 1;

    for (let i = 0; i < baseCurve.length; i++) {
        if (i < activeRange.startIndex || i > activeRange.endIndex) {
            result[i] = 0;
            continue;
        }

        const fraction = (i - activeRange.startIndex) / span;
        const targetIndexFloat = targetRange.startIndex + fraction * targetSpan;
        const lowerIndex = Math.floor(targetIndexFloat);
        const upperIndex = Math.ceil(targetIndexFloat);
        const alpha = targetIndexFloat - lowerIndex;
        const clampIndex = (index) => Math.max(targetRange.startIndex, Math.min(targetRange.endIndex, index));
        const lowerValue = targetCurve[clampIndex(lowerIndex)];
        const upperValue = targetCurve[clampIndex(upperIndex)];
        result[i] = Math.round((1 - alpha) * lowerValue + alpha * upperValue);
    }

    return result;
}

beforeEach(() => {
    resetFeatureFlags();
});

afterEach(() => {
    resetFeatureFlags();
});

describe('remapActiveRange', () => {
    it('compresses delayed-onset channels to match target active span', () => {
        const baseCurve = buildDelayedOnsetCurve({ onsetIndex: 128, maxValue: 1000 });
        const targetCurve = buildTargetCurve({ onsetIndex: 200, maxValue: 1000 });
        const activeRange = detectActiveRange(baseCurve);

        const expected = computeExpectedRemap(baseCurve, targetCurve);
        const remapped = remapActiveRange(baseCurve, targetCurve, activeRange);

        expect(remapped).toEqual(expected);
    });

    it('returns the original curve when no ink ever flows', () => {
        const baseCurve = new Array(256).fill(0);
        const targetCurve = buildTargetCurve({ onsetIndex: 200, maxValue: 1000 });
        const activeRange = detectActiveRange(baseCurve);

        const remapped = remapActiveRange(baseCurve, targetCurve, activeRange);

        expect(remapped).toEqual(baseCurve);
    });

    it('preserves immediate-onset curves while matching target amplitudes', () => {
        const baseCurve = buildDelayedOnsetCurve({ onsetIndex: 0, maxValue: 1000 });
        const targetCurve = buildTargetCurve({ onsetIndex: 0, maxValue: 800 });
        const activeRange = detectActiveRange(baseCurve);

        const remapped = remapActiveRange(baseCurve, targetCurve, activeRange, { maxOutput: 1000 });

        expect(remapped).toEqual(targetCurve);
    });

    it('handles tiny active spans without flattening the output', () => {
        const baseCurve = buildDelayedOnsetCurve({ onsetIndex: 252, maxValue: 1000 });
        const targetCurve = buildTargetCurve({ onsetIndex: 242, maxValue: 1000 });
        const activeRange = detectActiveRange(baseCurve);

        const remapped = remapActiveRange(baseCurve, targetCurve, activeRange, { maxOutput: 1000 });

        expect(remapped.slice(0, 252).every(value => value === 0)).toBe(true);
        expect(remapped.slice(252)).toEqual(computeExpectedRemap(baseCurve, targetCurve).slice(252));
    });
});

describe('apply1DLUT active-range integration', () => {
    it('applies LUT targets over the active span when the flag is enabled', () => {
        const baseCurve = buildDelayedOnsetCurve({ onsetIndex: 128, maxValue: 1000 });
        const targetCurve = buildTargetCurve({ onsetIndex: 200, maxValue: 1000 });
        const samples = targetCurve.map(value => value / 1000);

        setActiveRangeLinearizationEnabled(true);

        const output = apply1DLUT(baseCurve, { samples }, 0, 1, 1000, 'linear', 0);
        const expected = computeExpectedRemap(baseCurve, targetCurve);

        expect(output).toEqual(expected);
    });

    it('keeps legacy fixed-domain mapping when the feature flag is off', () => {
        const baseCurve = buildDelayedOnsetCurve({ onsetIndex: 128, maxValue: 1000 });
        const targetCurve = buildTargetCurve({ onsetIndex: 200, maxValue: 1000 });
        const samples = targetCurve.map(value => value / 1000);

        resetFeatureFlags({ activeRangeLinearization: false });
        
        const expected = apply1DLUTFixedDomain(baseCurve, { samples }, 0, 1, 1000, 'linear', 0);
        const output = apply1DLUT(baseCurve, { samples }, 0, 1, 1000, 'linear', 0);

        expect(output).toEqual(expected);
    });
});
