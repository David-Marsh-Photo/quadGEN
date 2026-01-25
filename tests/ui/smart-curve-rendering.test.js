import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drawSmartKeyPointOverlays, getSmartOverlayDebug } from '../../src/js/ui/chart-renderer.js';

describe('drawSmartKeyPointOverlays rendering logic', () => {
    let mockCtx;
    const TOTAL = 65535;
    const geom = {
        dpr: 1,
        leftPadding: 0,
        chartWidth: 100,
        chartHeight: 100,
        height: 100,
        padding: 0,
        bottomPadding: 0,
        displayMax: 100
    };
    const colors = { grid: '#ccc', axis: '#000', text: '#000', bg: '#fff', border: '#ccc' };

    beforeEach(() => {
        // Mock Canvas Context
        mockCtx = {
            save: vi.fn(),
            restore: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            fill: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            measureText: vi.fn(() => ({ width: 10 })),
            fillText: vi.fn(),
            setLineDash: vi.fn(),
        };
    });

    it('snaps key point to curve even for small deviations (< 10%)', () => {
        const channelName = 'K';
        const keyPoints = [
            { input: 0, output: 0 },
            { input: 50, output: 50 }, // Stored point at 50%
            { input: 100, output: 100 }
        ];
        
        // Construct curveValues where the value at 50% is 55%
        // 55% of 65535 = ~36044
        const curveValues = new Array(256).fill(0);
        // At index 128 (approx 50%), set value to 55%
        // Note: xNorm * (255) => 0.5 * 255 = 127.5 => round to 128
        const targetIndex = 128; 
        const targetValue = Math.round(0.55 * TOTAL);
        curveValues[targetIndex] = targetValue;
        
        // The function uses xNorm * (curveValues.length - 1) to find index.
        
        drawSmartKeyPointOverlays(
            mockCtx,
            geom,
            colors,
            channelName,
            keyPoints,
            curveValues,
            TOTAL,
            -1, // No selection
            '#000',
            { drawMarkers: false, showLabels: false, isDragging: false }
        );

        const debugInfo = getSmartOverlayDebug();
        expect(debugInfo).toBeDefined();
        expect(debugInfo.points).toHaveLength(3);

        const midPoint = debugInfo.points[1];
        expect(midPoint.input).toBe(50);
        
        // With the fix, outputPercent should track the curve (55%)
        // Without the fix, it would stay at stored value (50%) because diff (5%) < 10%
        expect(midPoint.outputPercent).toBeCloseTo(55, 1);
        expect(midPoint.outputPercent).not.toBeCloseTo(50, 1);
    });

    it('uses stored position when dragging', () => {
        const channelName = 'K';
        const keyPoints = [
            { input: 0, output: 0 },
            { input: 50, output: 50 },
            { input: 100, output: 100 }
        ];
        
        const curveValues = new Array(256).fill(0);
        const targetIndex = 128; 
        const targetValue = Math.round(0.55 * TOTAL); // 55%
        curveValues[targetIndex] = targetValue;
        
        drawSmartKeyPointOverlays(
            mockCtx,
            geom,
            colors,
            channelName,
            keyPoints,
            curveValues,
            TOTAL,
            -1,
            '#000',
            { drawMarkers: false, showLabels: false, isDragging: true } // Dragging!
        );

        const debugInfo = getSmartOverlayDebug();
        const midPoint = debugInfo.points[1];
        
        // When dragging, we should respect the stored point (which tracks cursor)
        // and IGNORE the curve value
        expect(midPoint.outputPercent).toBeCloseTo(50, 1);
    });
});
