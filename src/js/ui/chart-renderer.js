// quadGEN Chart Renderer
// Core chart drawing functionality extracted from updateInkChart

import {
    mapPercentToY,
    mapPercentToX,
    getChartColors,
    createChartGeometry,
    drawChartGrid,
    normalizeDisplayMax
} from './chart-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { toAbsoluteOutput } from '../curves/smart-curves.js';
import { getLegacyScope } from '../legacy/legacy-helpers.js';

let lastSmartOverlayDetails = null;
const legacyScope = getLegacyScope();

export function setSmartOverlayDebug(details) {
    if (!details || typeof details !== 'object') {
        lastSmartOverlayDetails = null;
        legacyScope.__LAST_SMART_OVERLAY_DETAILS = null;
        return;
    }
    lastSmartOverlayDetails = {
        channelName: details.channelName || null,
        selectedOrdinal: details.selectedOrdinal || null,
        points: Array.isArray(details.points) ? details.points.map((point) => ({ ...point })) : []
    };
    legacyScope.__LAST_SMART_OVERLAY_DETAILS = lastSmartOverlayDetails;
}

export function getSmartOverlayDebug() {
    return lastSmartOverlayDetails;
}

/**
 * Draw chart axes with proper styling
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 */
export function drawChartAxes(ctx, geom, colors) {
    ctx.strokeStyle = colors.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const bottomPadding = geom.bottomPadding || geom.padding;
    ctx.moveTo(geom.leftPadding, geom.padding);
    ctx.lineTo(geom.leftPadding, geom.height - bottomPadding);
    ctx.lineTo(geom.leftPadding + geom.chartWidth, geom.height - bottomPadding);
    ctx.stroke();
}

/**
 * Draw ink level gradient (vertical gradient beside Y-axis)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @returns {Object} Gradient dimensions for alignment calculations
 */
export function drawInkLevelGradient(ctx, geom, colors) {
    const gradientWidth = 10;
    const gradientGap = 1;
    const gradientX = geom.leftPadding - gradientWidth - gradientGap;
    // Match Y-axis dimensions exactly: from geom.padding (top) to geom.height - geom.bottomPadding (bottom)
    const gradientY = geom.padding;
    const bottomPadding = geom.bottomPadding || geom.padding; // fallback if not available
    const gradientHeight = geom.height - geom.padding - bottomPadding;

    // Draw white background first so gradient shows true colors
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

    const grad = ctx.createLinearGradient(0, gradientY, 0, gradientY + gradientHeight);
    grad.addColorStop(0, '#000000'); // top = 100% ink = black
    grad.addColorStop(1, '#ffffff'); // bottom = 0% ink = white
    ctx.fillStyle = grad;
    ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

    // Subtle border using theme border color
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(gradientX, gradientY, gradientWidth, gradientHeight);

    return { width: gradientWidth, gap: gradientGap, x: gradientX, y: gradientY, height: gradientHeight };
}

/**
 * Draw input level gradient (horizontal gradient under X-axis)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @returns {Object} Gradient dimensions for alignment calculations
 */
export function drawInputLevelGradient(ctx, geom, colors) {
    const gradientHeight = 10;
    const gradientGap = 0; // No gap - gradient aligned to axis
    const bottomPadding = geom.bottomPadding || geom.padding;
    // Position gradient at the same Y coordinate as the X-axis line
    const gradientY = geom.height - bottomPadding;

    // Draw white background first so gradient shows true colors
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(geom.leftPadding, gradientY, geom.chartWidth, gradientHeight);

    const grad = ctx.createLinearGradient(geom.leftPadding, 0, geom.leftPadding + geom.chartWidth, 0);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(geom.leftPadding, gradientY, geom.chartWidth, gradientHeight);

    // Subtle border for visibility
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(geom.leftPadding, gradientY, geom.chartWidth, gradientHeight);

    return { height: gradientHeight, gap: gradientGap, y: gradientY };
}

/**
 * Draw axis labels for the chart
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {number[]} tickValues - Y-axis tick values
 * @param {Object} inkGradientInfo - Gradient dimensions from drawInkLevelGradient
 * @param {Object} inputGradientInfo - Gradient dimensions from drawInputLevelGradient
 */
export function drawAxisLabels(ctx, geom, colors, tickValues, inkGradientInfo, inputGradientInfo) {
    // Scale font sizes based on DPR, but ensure minimum readability
    const dpr = geom.dpr || 1;
    const baseFontSize = Math.max(10, Math.round(12 * dpr * 10) / 10);

    ctx.fillStyle = colors.text;
    ctx.font = `${baseFontSize}px system-ui`;
    ctx.textAlign = 'center';

    // X-axis labels (0% to 100%)
    // Calculate position based on input gradient dimensions
    const bottomPadding = geom.bottomPadding || geom.padding;
    const xLabelYOffset = inputGradientInfo ? (inputGradientInfo.height + inputGradientInfo.gap + 17 * dpr) : 29 * dpr;
    for (let i = 0; i <= 10; i++) {
        const x = geom.leftPadding + (i * geom.chartWidth / 10);
        const value = i * 10;
        // Make 0 and 100 bold
        if (value === 0 || value === 100) {
            ctx.font = `bold ${baseFontSize}px system-ui`;
        } else {
            ctx.font = `${baseFontSize}px system-ui`;
        }
        ctx.fillText(`${value}`, x, geom.height - bottomPadding + xLabelYOffset);
    }

    // Y-axis labels (respect current zoom)
    // Calculate position based on ink gradient dimensions
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.text;
    const yLabelOffset = inkGradientInfo ? (inkGradientInfo.width + inkGradientInfo.gap + 11 * dpr) : 23 * dpr;
    const yAxisLabelX = geom.leftPadding - yLabelOffset;
    tickValues.forEach((value) => {
        const y = mapPercentToY(value, geom);
        const isEdge = Math.abs(value) < 0.001 || Math.abs(value - geom.displayMax) < 0.001;
        ctx.font = isEdge ? `bold ${baseFontSize}px system-ui` : `${baseFontSize}px system-ui`;
        const label = (Math.abs(value - Math.round(value)) < 0.001) ? Math.round(value).toString() : value.toFixed(1);
        ctx.fillText(label, yAxisLabelX, y + 4 * dpr);
    });
}

/**
 * Draw axis titles for the chart
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {Object} inkGradientInfo - Gradient dimensions from drawInkLevelGradient
 */
export function drawAxisTitles(ctx, geom, colors, inkGradientInfo) {
    // Scale font sizes based on DPR
    const dpr = geom.dpr || 1;
    const titleFontSize = Math.max(12, Math.round(14 * dpr * 10) / 10);

    // X-axis and Y-axis titles now rendered as DOM elements (see index.template.html)
}

/**
 * Draw a single curve on the chart
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number[]} values - Curve data values (256 points)
 * @param {Object} geom - Chart geometry
 * @param {string} color - Curve color
 * @param {number} endValue - Channel end value for scaling
 * @param {number} lineWidth - Line width for drawing
 */
export function drawCurve(ctx, values, geom, color, endValue, lineWidth = 2) {
    if (!values || values.length === 0) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    let hasStarted = false;

    for (let i = 0; i < values.length; i++) {
        const inputPercent = (i / (values.length - 1)) * 100;
        const outputPercent = (values[i] / endValue) * 100;

        const x = mapPercentToX(inputPercent, geom);
        const y = mapPercentToY(outputPercent, geom);

        if (!hasStarted) {
            ctx.moveTo(x, y);
            hasStarted = true;
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();
}

/**
 * Setup chart background with optional theme-based background color
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 */
export function setupChartBackground(ctx, geom, colors) {
    // Clear canvas
    ctx.clearRect(0, 0, geom.width, geom.height);

    // Lighten/differentiate chart area background per theme
    if (colors.bg && colors.bg !== 'transparent') {
        ctx.save();
        ctx.fillStyle = colors.bg;
        ctx.fillRect(geom.leftPadding, geom.padding, geom.chartWidth, geom.chartHeight);
        ctx.restore();
    }
}

/**
 * Get tick values for Y-axis based on display maximum
 * @param {number} displayMax - Maximum display value
 * @returns {number[]} Array of tick values
 */
export function getTickValues(displayMax) {
    const tickStep = displayMax <= 50 ? 5 : 10;
    const tickValues = [];
    for (let value = 0; value <= displayMax; value += tickStep) {
        tickValues.push(Math.round(value * 100) / 100);
    }
    if (tickValues[tickValues.length - 1] !== displayMax) {
        tickValues.push(displayMax);
    }
    return tickValues;
}

/**
 * Complete chart rendering setup including all basic elements
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {number} displayMax - Maximum display value for Y-axis
 */
export function renderChartFrame(ctx, geom, displayMax) {
    const colors = getChartColors();
    const tickValues = getTickValues(displayMax);

    // Setup background
    setupChartBackground(ctx, geom, colors);

    // Draw grid
    drawChartGrid(ctx, geom, colors);

    // Draw axes
    drawChartAxes(ctx, geom, colors);

    // Draw orientation gradients and capture their dimensions
    const inkGradientInfo = drawInkLevelGradient(ctx, geom, colors);
    const inputGradientInfo = drawInputLevelGradient(ctx, geom, colors);

    // Draw labels and titles using gradient dimensions for alignment
    drawAxisLabels(ctx, geom, colors, tickValues, inkGradientInfo, inputGradientInfo);
    drawAxisTitles(ctx, geom, colors, inkGradientInfo);

    return { colors, tickValues };
}

/**
 * Draw Smart key point overlays with ordinal labels
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {string} channelName - Channel name to render overlays for
 * @param {Array<Object>} keyPoints - Array of key points with input/output properties
 * @param {Array<number>} curveValues - Current curve values for positioning
 * @param {number} maxValue - Maximum value for scaling (usually TOTAL = 65535)
 * @param {number} selectedOrdinal - Currently selected ordinal (1-based, -1 for none)
 * @param {string} inkColor - Channel ink color
 * @param {Object} options - Rendering options
 */
export function drawSmartKeyPointOverlays(ctx, geom, colors, channelName, keyPoints, curveValues, maxValue, selectedOrdinal, inkColor, options = {}) {
    const {
        drawMarkers = true,
        showLabels = true,
        boxSize = 6,
        isDragging = false
    } = options;

    if (!keyPoints || keyPoints.length === 0) {
        return;
    }

    try {
        ctx.save();

        const defaultFont = '16px system-ui';
        ctx.font = defaultFont;
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'center';

        const displayMax = normalizeDisplayMax(geom);
        const debugPoints = [];

        keyPoints.forEach((pt, i) => {
            const xNorm = Math.max(0, Math.min(1, (pt.input || 0) / 100));
            const x = geom.leftPadding + xNorm * geom.chartWidth;

            const absoluteOutput = toAbsoluteOutput(channelName, pt.output || 0);
            let outputPercent = Math.max(0, Math.min(100, absoluteOutput));

            // When we have the processed curve samples, ensure the overlay matches the curve exactly.
            // This ensures that features like Plot Smoothing (which modifies the curve but not the points initially)
            // are visually reflected in the key point positions.
            // Skip this check during drag so the marker follows the cursor immediately.
            if (!isDragging && curveValues && curveValues.length > 0) {
                const curveIndex = Math.round(xNorm * (curveValues.length - 1));
                const actualCurveValue = curveValues[curveIndex] || 0;
                const curvePercent = Math.max(0, Math.min(100, (actualCurveValue / maxValue) * 100));

                // Always sync overlay position to the actual curve
                outputPercent = curvePercent;
            }

            const chartPercent = Math.max(0, Math.min(displayMax, outputPercent));
            const y = mapPercentToY(chartPercent, geom);

            debugPoints.push({
                ordinal: i + 1,
                input: pt.input,
                outputPercent,
                chartPercent,
                canvasX: x,
                canvasY: y
            });

            const hx = boxSize / 2;
            const hy = boxSize / 2;

            // Square marker (highlight current selected ordinal)
            const isSelected = (i + 1 === selectedOrdinal);
            const bx = Math.round(x - hx) + 0.5;
            const by = Math.round(y - hy) + 0.5;

            if (drawMarkers) {

                if (isSelected) {
                    ctx.save();
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = inkColor;
                    ctx.strokeRect(bx - 2, by - 2, boxSize + 4, boxSize + 4);
                    ctx.restore();
                    ctx.fillStyle = 'rgba(255,255,255,1)';
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.95)';
                }
                ctx.fillRect(bx, by, boxSize, boxSize);
                ctx.strokeStyle = inkColor;
                ctx.lineWidth = 1;
                ctx.strokeRect(bx, by, boxSize, boxSize);
            }

            if (!showLabels) return;

            // Label positioning
            let labelX = x;
            let labelY = y - hy - 3;
            const lowClamp = displayMax * 0.05;
            const highClamp = displayMax - lowClamp;
            if (chartPercent <= lowClamp) labelX += 8;
            if (chartPercent >= highClamp) labelX -= 8;
            const minY = geom.padding + 8;
            const bottomPadding = geom.bottomPadding || geom.padding;
            const maxY = geom.height - bottomPadding - 2;
            if (labelY < minY) labelY = minY;
            if (labelY > maxY) labelY = maxY;

            const num = String(i + 1);
            // Enlarge and bold the selected label number
            const labelFontSize = isSelected ? 34 : 18;
            ctx.font = `bold ${labelFontSize}px system-ui`;
            const metrics = ctx.measureText(num);
            const bgPadX = isSelected ? 9 : 7;
            const bgW = Math.ceil(metrics.width) + bgPadX * 2;
            const bgH = Math.round(labelFontSize * 1.22);
            const bgX = Math.round(labelX - bgW / 2) + 0.5;
            const bgY = Math.round(labelY - bgH + 1) + 0.5;

            // Ordinal label colors: use the exact channel ink color for the chip
            // Compute text color (black/white) using YIQ for readability
            let r = 0, g = 0, b = 0;
            try {
                const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(String(inkColor));
                if (m) { r = parseInt(m[1], 16); g = parseInt(m[2], 16); b = parseInt(m[3], 16); }
            } catch (err) {}
            const yiq = (r * 299 + g * 587 + b * 114) / 1000;
            const labelTextColor = yiq >= 140 ? '#000000' : '#FFFFFF';

            ctx.fillStyle = inkColor;
            ctx.fillRect(bgX, bgY, bgW, bgH);
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bgX + 0.5, bgY + 0.5, bgW - 1, bgH - 1);
            ctx.fillStyle = labelTextColor;
            ctx.fillText(num, Math.round(labelX) + 0.5, Math.round(labelY) + 0.5);

            // Reset font to default for next iterations
            ctx.font = defaultFont;
        });
        ctx.restore();

        setSmartOverlayDebug({
            channelName,
            selectedOrdinal,
            points: debugPoints
        });
    } catch (e) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) console.warn('Smart key point overlay failed:', e);
    }
}

registerDebugNamespace('chartRenderer', {
    setSmartOverlayDebug,
    getSmartOverlayDebug
}, {
    exposeOnWindow: typeof window !== 'undefined'
});
