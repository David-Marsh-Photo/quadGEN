// quadGEN Chart Utilities
// Extracted from original monolithic file

/**
 * Normalize display maximum value for chart rendering
 * @param {Object} geom - Chart geometry object
 * @returns {number} Normalized display maximum
 */
export function normalizeDisplayMax(geom) {
  const raw = Number(geom?.displayMax);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 100;
}

/**
 * Clamp percent value for display within chart bounds
 * @param {number} percent - Percent value to clamp
 * @param {Object} geom - Chart geometry object
 * @returns {number} Clamped percent value
 */
export function clampPercentForDisplay(percent, geom) {
  const max = normalizeDisplayMax(geom);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(max, percent));
}

/**
 * Map percent value to Y pixel coordinate on chart
 * @param {number} percent - Percent value (0-100)
 * @param {Object} geom - Chart geometry object
 * @returns {number} Y pixel coordinate
 */
export function mapPercentToY(percent, geom) {
  const max = normalizeDisplayMax(geom);
  let chartHeight = Number(geom?.chartHeight);
  const padding = Number(geom?.padding) || 0;
  const bottomPadding = Number(geom?.bottomPadding) || padding;
  const height = Number(geom?.height) || 0;
  if (!Number.isFinite(chartHeight) || chartHeight <= 0) {
    chartHeight = Math.max(0, height - padding - bottomPadding);
  }
  const clamped = clampPercentForDisplay(percent, geom);
  if (chartHeight <= 0) return height - bottomPadding;
  return height - bottomPadding - (chartHeight * (clamped / max));
}

/**
 * Map Y pixel coordinate to percent value on chart
 * @param {number} yPx - Y pixel coordinate
 * @param {Object} geom - Chart geometry object
 * @returns {number} Percent value
 */
export function mapYToPercent(yPx, geom) {
  const max = normalizeDisplayMax(geom);
  let chartHeight = Number(geom?.chartHeight);
  const padding = Number(geom?.padding) || 0;
  const bottomPadding = Number(geom?.bottomPadding) || padding;
  const height = Number(geom?.height) || 0;
  if (!Number.isFinite(chartHeight) || chartHeight <= 0) {
    chartHeight = Math.max(0, height - padding - bottomPadding);
  }
  if (chartHeight <= 0) return 0;
  const relativeY = height - bottomPadding - yPx;
  return Math.max(0, Math.min(max, (relativeY / chartHeight) * max));
}

/**
 * Map percent value to X pixel coordinate on chart
 * @param {number} percent - Percent value (0-100)
 * @param {Object} geom - Chart geometry object
 * @returns {number} X pixel coordinate
 */
export function mapPercentToX(percent, geom) {
  const leftPadding = Number(geom?.leftPadding) || 0;
  const chartWidth = Number(geom?.chartWidth) || 0;
  const clamped = Math.max(0, Math.min(100, percent));
  return leftPadding + (chartWidth * (clamped / 100));
}

/**
 * Map X pixel coordinate to percent value on chart
 * @param {number} xPx - X pixel coordinate
 * @param {Object} geom - Chart geometry object
 * @returns {number} Percent value
 */
export function mapXToPercent(xPx, geom) {
  const leftPadding = Number(geom?.leftPadding) || 0;
  const chartWidth = Number(geom?.chartWidth) || 0;
  if (chartWidth <= 0) return 0;
  const relativeX = xPx - leftPadding;
  return Math.max(0, Math.min(100, (relativeX / chartWidth) * 100));
}

export function hitTestSmartPoint(canvasX, canvasY, options = {}) {
  const { points, geom, tolerance = 10, values, maxValue = 65535 } = options || {};
  if (!Array.isArray(points) || !geom) return null;
  const radius = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 10;
  const radiusSq = radius * radius;
  const sorted = points
    .map((point, index) => ({ point, ordinal: index + 1 }))
    .sort((a, b) => (a.point.input ?? 0) - (b.point.input ?? 0));

  const sampleValues = Array.isArray(values) && values.length > 0 ? values : null;
  const maxVal = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 65535;
  const displayMax = normalizeDisplayMax(geom);

  for (let i = 0; i < sorted.length; i++) {
    const { point, ordinal } = sorted[i];
    const xPercent = Number(point?.input ?? 0);
    const x = mapPercentToX(xPercent, geom);

    let absolutePercent = Number(point?.output ?? 0);
    if (sampleValues) {
      const normalizedX = Math.max(0, Math.min(1, xPercent / 100));
      const t = normalizedX * (sampleValues.length - 1);
      const i0 = Math.floor(t);
      const i1 = Math.min(sampleValues.length - 1, i0 + 1);
      const factor = t - i0;
      const interpolated = ((1 - factor) * sampleValues[i0]) + (factor * sampleValues[i1]);
      absolutePercent = (interpolated / maxVal) * 100;
    }

    const clampedPercent = Math.max(0, Math.min(displayMax, absolutePercent));
    const y = mapPercentToY(clampedPercent, geom);

    const dx = canvasX - x;
    const dy = canvasY - y;
    if ((dx * dx) + (dy * dy) <= radiusSq) {
      return {
        ordinal,
        point,
        canvasX: x,
        canvasY: y,
        percent: clampedPercent
      };
    }
  }

  return null;
}

export function resolveSmartPointClickSelection(options = {}) {
  const {
    canvasX,
    canvasY,
    points,
    geom,
    tolerance,
    values,
    maxValue
  } = options || {};

  if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY) || !Array.isArray(points) || points.length === 0 || !geom) {
    return null;
  }

  const hit = hitTestSmartPoint(canvasX, canvasY, {
    points,
    geom,
    tolerance,
    values,
    maxValue
  });

  if (!hit) {
    return null;
  }

  return {
    ordinal: hit.ordinal,
    point: hit.point,
    canvasX: hit.canvasX,
    canvasY: hit.canvasY,
    percent: hit.percent
  };
}

export function clampSmartPointCoordinates(inputPercent, outputPercent, options = {}) {
  const { points, ordinal, geom, minGap = 0.01 } = options || {};
  const clampedInput = Math.max(0, Math.min(100, Number.isFinite(inputPercent) ? inputPercent : 0));
  const displayMax = normalizeDisplayMax(geom);
  const clampedOutput = Math.max(0, Math.min(displayMax, Number.isFinite(outputPercent) ? outputPercent : 0));

  if (!Array.isArray(points) || !Number.isFinite(ordinal) || ordinal < 1) {
    return {
      inputPercent: clampedInput,
      outputPercent: clampedOutput
    };
  }

  const sorted = points
    .map((point) => ({ input: Number(point?.input ?? 0) }))
    .sort((a, b) => a.input - b.input);

  const index = Math.min(sorted.length - 1, ordinal - 1);
  let minX = 0;
  let maxX = 100;
  if (index > 0) {
    minX = sorted[index - 1].input + minGap;
  }
  if (index < sorted.length - 1) {
    maxX = sorted[index + 1].input - minGap;
  }

  const constrainedInput = Math.max(minX, Math.min(maxX, clampedInput));

  return {
    inputPercent: constrainedInput,
    outputPercent: clampedOutput
  };
}

/**
 * Get chart theme colors from CSS custom properties
 * @returns {Object} Chart color scheme
 */
export function getChartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    grid: (styles.getPropertyValue('--chart-grid') || '#e5e7eb').trim(),
    axis: (styles.getPropertyValue('--chart-axis') || '#374151').trim(),
    text: (styles.getPropertyValue('--chart-text') || '#000000').trim(),
    helper: (styles.getPropertyValue('--chart-helper-border') || '#9ca3af').trim(),
    border: (styles.getPropertyValue('--border') || '#e5e7eb').trim(),
    bg: (styles.getPropertyValue('--chart-bg') || 'transparent').trim()
  };
}

/**
 * Create chart geometry object from canvas and display settings
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {number} displayMax - Maximum display value for Y-axis
 * @returns {Object} Chart geometry configuration
 */
export function createChartGeometry(canvas, displayMax = 100, dpr = 1) {
  const width = canvas.width;
  const height = canvas.height;
  const safeScale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const deviceScale = Math.min(Math.max(safeScale, 1), 3);
  const cssTopPadding = 12; // Increased to prevent clipping of top labels
  const cssBottomPadding = 40; // Accommodate gradient + labels
  const cssLeftBase = 36; // base padding for left side
  const cssRightBase = 36; // base padding for right side
  const cssLeftExtra = 26; // extra room for Y-axis labels/titles
  const cssRightExtra = 34;
  const topPadding = cssTopPadding * deviceScale;
  const bottomPadding = cssBottomPadding * deviceScale;
  const leftPadding = (cssLeftBase + cssLeftExtra) * deviceScale;
  const rightPadding = (cssRightBase + cssRightExtra) * deviceScale;
  const chartWidth = Math.max(0, width - leftPadding - rightPadding);
  const chartHeight = Math.max(0, height - topPadding - bottomPadding);

  return {
    width,
    height,
    padding: topPadding,
    bottomPadding,
    leftPadding,
    rightPadding,
    chartWidth,
    chartHeight,
    displayMax,
    dpr: deviceScale
  };
}

/**
 * Draw chart grid lines
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 */
export function drawChartGrid(ctx, geom, colors) {
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  const bottomPadding = geom.bottomPadding || geom.padding;

  // Vertical grid lines (every 10%)
  for (let i = 0; i <= 10; i++) {
    const x = geom.leftPadding + (i * geom.chartWidth / 10);
    ctx.beginPath();
    ctx.moveTo(x, geom.padding);
    ctx.lineTo(x, geom.height - bottomPadding);
    ctx.stroke();
  }

  // Horizontal grid lines (dynamic based on zoom)
  const displayMax = normalizeDisplayMax(geom);
  const tickStep = displayMax <= 50 ? 5 : 10;
  const tickValues = [];
  for (let value = 0; value <= displayMax; value += tickStep) {
    tickValues.push(Math.round(value * 100) / 100);
  }
  if (tickValues[tickValues.length - 1] !== displayMax) {
    tickValues.push(displayMax);
  }

  tickValues.forEach((value) => {
    const y = mapPercentToY(value, geom);
    ctx.beginPath();
    ctx.moveTo(geom.leftPadding, y);
    ctx.lineTo(geom.leftPadding + geom.chartWidth, y);
    ctx.stroke();
  });
}
