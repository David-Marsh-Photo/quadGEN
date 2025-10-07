// quadGEN Chart Manager
// Chart rendering, zoom management, and interaction handling

import { elements, getCurrentPrinter, getAppState, updateAppState, INK_COLORS, TOTAL, isChannelNormalizedToEnd } from '../core/state.js';
import { getStateManager } from '../core/state-manager.js';
import { InputValidator } from '../core/validation.js';
import { make256 } from '../core/processing-pipeline.js';
import { getCurrentScale } from '../core/scaling-utils.js';
import { SCALING_STATE_FLAG_EVENT } from '../core/scaling-constants.js';
import { ControlPoints, isSmartCurve } from '../curves/smart-curves.js';
import { registerInkChartHandler, triggerPreviewUpdate } from './ui-hooks.js';
import { showStatus } from './status-service.js';
import { LinearizationState } from '../data/linearization-utils.js';
import {
    normalizeDisplayMax,
    clampPercentForDisplay,
    mapPercentToY,
    mapPercentToX,
    mapYToPercent,
    mapXToPercent,
    getChartColors,
    createChartGeometry,
    drawChartGrid
} from './chart-utils.js';
import {
    drawChartAxes,
    drawCurve,
    renderChartFrame,
    drawSmartKeyPointOverlays,
    drawInkLevelGradient,
    drawInputLevelGradient,
    drawAxisLabels,
    drawAxisTitles,
    getTickValues
} from './chart-renderer.js';
import { updateProcessingDetail, updateAllProcessingDetails } from './processing-status.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

let unsubscribeScalingStateChart = null;
let scalingStateChartListenerAttached = false;

function configureChartScalingStateSubscription() {
    if (!isBrowser) {
        return;
    }

    if (unsubscribeScalingStateChart) {
        try {
            unsubscribeScalingStateChart();
        } catch (err) {
            console.warn('Failed to unsubscribe chart scaling listener', err);
        }
        unsubscribeScalingStateChart = null;
    }

    const enabled = !!globalScope.__USE_SCALING_STATE;
    if (!enabled) {
        return;
    }

    let stateManager;
    try {
        stateManager = getStateManager();
    } catch (error) {
        console.warn('Unable to obtain state manager for chart scaling subscription', error);
        return;
    }

    if (!stateManager || typeof stateManager.subscribe !== 'function') {
        return;
    }

    unsubscribeScalingStateChart = stateManager.subscribe(['scaling.globalPercent'], () => {
        try {
            updateInkChart();
        } catch (chartError) {
            console.warn('Failed to refresh chart after scaling state change', chartError);
        }
    });

    try {
        updateInkChart();
    } catch (initialError) {
        console.warn('Initial chart refresh after scaling state subscription failed', initialError);
    }
}

const ENABLE_RESPONSIVE_CHART = true;
const DEFAULT_CHART_ASPECT_RATIO = 4 / 3;
const DEFAULT_CHART_FIXED_HEIGHT = 586;
const MIN_CHART_HEIGHT = 320;
const VIEWPORT_MARGIN = 48;
let responsiveInitScheduled = false;
let responsiveInitialPasses = 0;
const RESPONSIVE_INITIAL_MAX_PASSES = 8;
let columnResizeObserver = null;
let chartRegionResizeObserver = null;

if (isBrowser && !scalingStateChartListenerAttached) {
    globalScope.addEventListener(SCALING_STATE_FLAG_EVENT, () => {
        configureChartScalingStateSubscription();
    });
    scalingStateChartListenerAttached = true;

    if (globalScope.__USE_SCALING_STATE) {
        const schedule = typeof queueMicrotask === 'function'
            ? queueMicrotask
            : (fn) => Promise.resolve().then(fn);
        schedule(() => configureChartScalingStateSubscription());
    }
}

function getChartWrapper() {
    return elements.inkChart ? elements.inkChart.closest('[data-chart-wrapper]') : null;
}

function getLinearizationColumn() {
    if (typeof document === 'undefined') return null;
    return document.querySelector('[data-linearization-column]');
}

function getChartRegion() {
    if (typeof document === 'undefined') return null;
    return document.querySelector('[data-chart-region]');
}

function updateResponsiveWrapperDimensions() {
    if (!ENABLE_RESPONSIVE_CHART) {
        return;
    }
    const wrapper = getChartWrapper();
    if (!wrapper) {
        return;
    }
    const chartRegion = getChartRegion();
    if (!chartRegion) {
        return;
    }
    const width = wrapper.clientWidth;
    if (!width) {
        return;
    }
    const rect = wrapper.getBoundingClientRect();
    const viewportHeight = isBrowser ? globalScope.innerHeight : 0;
    const availableViewportHeight = Number.isFinite(viewportHeight) && viewportHeight > 0
        ? Math.max(MIN_CHART_HEIGHT, viewportHeight - rect.top - VIEWPORT_MARGIN)
        : width / DEFAULT_CHART_ASPECT_RATIO;
    const widthBasedHeight = width / DEFAULT_CHART_ASPECT_RATIO;
    let columnHeightLimit = Infinity;
    const linearizationColumn = getLinearizationColumn();
    if (linearizationColumn) {
        const colRect = linearizationColumn.getBoundingClientRect();
        const offsetHeight = linearizationColumn.offsetHeight;
        const styles = isBrowser ? globalScope.getComputedStyle(linearizationColumn) : null;
        const parse = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const marginAdjustment = styles ? parse(styles.marginTop) + parse(styles.marginBottom) : 0;
        const columnHeight = Number.isFinite(offsetHeight) && offsetHeight > 0
            ? offsetHeight + marginAdjustment
            : (colRect && Number.isFinite(colRect.height) ? colRect.height + marginAdjustment : 0);
        if (columnHeight >= 0) {
            columnHeightLimit = Math.max(MIN_CHART_HEIGHT, columnHeight);
        }
    }
    const targetHeight = Math.max(
        MIN_CHART_HEIGHT,
        Math.min(widthBasedHeight, availableViewportHeight, columnHeightLimit)
    );
    chartRegion.style.setProperty('--chart-max-height', `${Math.round(targetHeight)}px`);
}

/**
 * Chart zoom levels (percentages for Y-axis maximum)
 * Matches legacy 10-level granularity for fine zoom control
 */
export const CHART_ZOOM_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * Chart cursor tooltip state
 */
let CHART_CURSOR_MAP = null;

/**
 * Tracks the last applied canvas pixel dimensions so we can avoid redundant redraws
 */
const lastCanvasMetrics = {
    width: 0,
    height: 0,
    dpr: 0
};

/**
 * Resize observer / fallback handler state
 */
let chartResizeObserver = null;
let windowResizeHandler = null;
let resizeRafId = null;

/**
 * Local storage key for chart zoom persistence
 */
const CHART_ZOOM_STORAGE_KEY = 'quadgen_chart_zoom_v1';

/**
 * Initialize chart zoom from localStorage
 */
export function initializeChartZoom() {
    const savedZoom = localStorage.getItem(CHART_ZOOM_STORAGE_KEY);
    if (savedZoom) {
        const percent = parseFloat(savedZoom);
        if (Number.isFinite(percent)) {
            setChartZoomPercent(percent, { persist: false, refresh: false });
        }
    }
}

/**
 * Get current chart zoom percentage
 * @returns {number} Current zoom percentage
 */
export function getChartZoomPercent() {
    const state = getAppState();
    return CHART_ZOOM_LEVELS[state.chartZoomIndex] || 100;
}

/**
 * Get current chart zoom index
 * @returns {number} Current zoom index
 */
export function getChartZoomIndex() {
    const state = getAppState();
    return state.chartZoomIndex || 0;
}

/**
 * Persist chart zoom to localStorage
 */
function persistChartZoom() {
    try {
        localStorage.setItem(CHART_ZOOM_STORAGE_KEY, String(getChartZoomPercent()));
    } catch (err) {
        console.warn('Could not persist chart zoom:', err);
    }
}

/**
 * Get highest active channel percentage
 * @returns {number} Highest percentage among enabled channels
 */
function getHighestActivePercent() {
    let maxPercent = 0;
    try {
        const rowNodes = elements.rows?.children ? Array.from(elements.rows.children) : [];
        rowNodes.forEach((row) => {
            if (!row || row.id === 'noChannelsRow') return;
            const endInput = row.querySelector('.end-input');
            const rawValue = endInput?.value ?? 0;
            const endVal = InputValidator.clampEnd(rawValue);
            if (endVal <= 0) return;
            const percent = InputValidator.computePercentFromEnd(endVal);
            if (Number.isFinite(percent)) {
                maxPercent = Math.max(maxPercent, percent);
            }
        });
    } catch (err) {
        console.warn('Error calculating highest active percent:', err);
    }
    return Math.max(0, Math.min(100, maxPercent));
}

/**
 * Get minimum allowed zoom index based on active channels
 * Prevents zooming in so far that any channel clips off the top of the chart
 * @returns {number} Minimum zoom index
 */
export function getMinimumAllowedZoomIndex() {
    const highest = getHighestActivePercent();
    if (!Number.isFinite(highest) || highest <= 0) return 0;

    // Round up to nearest 10% to ensure full curve visibility
    const target = Math.min(100, Math.max(0, Math.ceil(highest / 10) * 10));

    // Find first zoom level that can show the full curve
    for (let i = 0; i < CHART_ZOOM_LEVELS.length; i++) {
        if (CHART_ZOOM_LEVELS[i] >= target) return i;
    }

    return CHART_ZOOM_LEVELS.length - 1;
}

/**
 * Set chart zoom by index
 * @param {number} idx - Zoom level index
 * @param {Object} options - Options for zoom setting
 * @returns {number} New zoom percentage
 */
export function setChartZoomIndex(idx, options = {}) {
    const { persist = true, refresh = true } = options;

    const minIdx = getMinimumAllowedZoomIndex();
    const clampedIdx = Math.max(minIdx, Math.min(CHART_ZOOM_LEVELS.length - 1, idx));
    const currentIdx = getChartZoomIndex();
    const changed = clampedIdx !== currentIdx;

    updateAppState({ chartZoomIndex: clampedIdx });

    if (persist) {
        persistChartZoom();
    }

    updateChartZoomButtons();

    if (changed && typeof updateSessionStatus !== 'undefined') {
        try {
            updateSessionStatus();
        } catch (err) {
            console.warn('Error updating session status after zoom change:', err);
        }
    }

    if (refresh && changed) {
        try {
            updateInkChart();
        } catch (err) {
            console.warn('Error refreshing chart after zoom change:', err);
        }
    }

    return getChartZoomPercent();
}

/**
 * Set chart zoom by percentage
 * @param {number} percent - Target zoom percentage
 * @param {Object} options - Options for zoom setting
 * @returns {number} Actual zoom percentage set
 */
export function setChartZoomPercent(percent, options = {}) {
    const target = Number(percent);
    if (!Number.isFinite(target)) return getChartZoomPercent();

    // Find closest zoom level
    let nearest = CHART_ZOOM_LEVELS[0];
    let nearestDiff = Math.abs(target - nearest);

    for (const level of CHART_ZOOM_LEVELS) {
        const diff = Math.abs(target - level);
        if (diff < nearestDiff) {
            nearest = level;
            nearestDiff = diff;
        }
    }

    return setChartZoomIndex(CHART_ZOOM_LEVELS.indexOf(nearest), options);
}

/**
 * Step chart zoom in a direction
 * @param {number} direction - Direction to zoom (1 for in, -1 for out)
 * @param {Object} options - Options for zoom setting
 * @returns {number} New zoom percentage
 */
export function stepChartZoom(direction, options = {}) {
    const currentIdx = getChartZoomIndex();
    // Invert direction: positive direction decreases index (zoom in = magnify shadows)
    const newIdx = currentIdx + (direction >= 0 ? -1 : 1);
    return setChartZoomIndex(newIdx, options);
}

/**
 * Update chart zoom buttons state
 */
function updateChartZoomButtons() {
    const currentIdx = getChartZoomIndex();
    const current = getChartZoomPercent();
    const minIdx = getMinimumAllowedZoomIndex();

    if (elements.chartZoomInBtn) {
        // Zoom in = decrease index (magnify shadows). Can't go below minimum index.
        const atZoomInLimit = currentIdx <= minIdx;
        elements.chartZoomInBtn.disabled = atZoomInLimit;
        elements.chartZoomInBtn.setAttribute('aria-disabled', atZoomInLimit ? 'true' : 'false');
        elements.chartZoomInBtn.title = atZoomInLimit
            ? 'Already at maximum zoom'
            : `Zoom in from ${current}%`;
    }

    if (elements.chartZoomOutBtn) {
        // Zoom out = increase index (widen view). Can't go above max index.
        const atZoomOutLimit = currentIdx >= CHART_ZOOM_LEVELS.length - 1;
        elements.chartZoomOutBtn.disabled = atZoomOutLimit;
        elements.chartZoomOutBtn.setAttribute('aria-disabled', atZoomOutLimit ? 'true' : 'false');
        elements.chartZoomOutBtn.title = atZoomOutLimit
            ? 'Cannot zoom out further'
            : `Zoom out from ${current}%`;
    }
}

/**
 * Draw ink level gradient (vertical beside Y-axis)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {number} fontScale - Device pixel ratio scale factor for fonts and spacing
*/
/**
 * Draw status messages directly on the chart canvas
 * Renders session status and temporary messages at the top of the chart
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Color scheme
 */
// Status message timer
let statusMessageTimer = null;

/**
 * Set a status message to display on the chart (DOM-based, like quadgen.html)
 * @param {string} message - Message to display
 * @param {number} duration - Duration in milliseconds (default 2000)
 */
export function setChartStatusMessage(message, duration = 2000) {
    console.log('📊 setChartStatusMessage:', message);

    // Get the status element
    let statusElement = elements.status;
    if (!statusElement) {
        console.warn('⚠️ Status element not found in elements object, trying direct DOM lookup...');
        statusElement = document.getElementById('status');
        if (statusElement) {
            console.log('✅ Found status element via direct DOM lookup');
            elements.status = statusElement;
        } else {
            console.error('❌ Status element not found in DOM!');
            return;
        }
    }

    // Show the message (exactly like quadgen.html showStatus function)
    statusElement.textContent = message;
    statusElement.style.opacity = '1';

    console.log('✅ Status message displayed:', message);

    // Clear any existing timer
    if (statusMessageTimer) {
        clearTimeout(statusMessageTimer);
    }

    // Set timer to clear message after duration
    statusMessageTimer = setTimeout(() => {
        console.log('📊 Clearing status message');
        if (statusElement) {
            statusElement.style.opacity = '0';
            // Clear text after fade animation completes
            setTimeout(() => {
                if (statusElement) {
                    statusElement.textContent = '\u00A0'; // Non-breaking space
                }
            }, 500); // Match the CSS transition duration
        }
    }, duration);
}


/**
 * Main chart update function
 * This is the core chart rendering pipeline
 */
export function updateInkChart() {
    console.log('🎨 updateInkChart called'); // Debug log
    if (!elements.inkChart || !elements.rows) {
        console.log('🎨 updateInkChart exiting early - missing elements:', {
            inkChart: !!elements.inkChart,
            rows: !!elements.rows
        });
        return;
    }
    console.log('🎨 updateInkChart proceeding with chart update...');

    // Get chart elements
    const canvas = elements.inkChart;

    if (ENABLE_RESPONSIVE_CHART) {
        updateResponsiveWrapperDimensions();
    }

    // Adjust canvas resolution to match display size for crisp rendering
    const dpr = globalScope.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const deviceScale = Math.min(Math.max(dpr, 1), 3);
    const LABEL_SCALE_MIN_WIDTH = 300;
    const widthProgress = Math.max(0, Math.min(1, (cssWidth - LABEL_SCALE_MIN_WIDTH) / LABEL_SCALE_MIN_WIDTH));
    const fontScale = 1 + (deviceScale - 1) * widthProgress;

    if (!rect.width || !rect.height) {
        console.log('🎨 updateInkChart skipping render - canvas is hidden or has zero size');
        return;
    }

    // Set the canvas buffer size to the physical pixel size of its display area
    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        console.log(`🎨 Resized canvas to ${canvas.width}x${canvas.height} (DPR: ${dpr})`);
    }

    lastCanvasMetrics.width = targetWidth;
    lastCanvasMetrics.height = targetHeight;
    lastCanvasMetrics.dpr = dpr;

    const ctx = canvas.getContext('2d');
    const colors = getChartColors();
    console.log('🎨 Got canvas context and colors');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log('🎨 Canvas cleared, starting chart drawing...');

    // Check and adjust zoom based on active channels
    const minZoomIdx = getMinimumAllowedZoomIndex();
    const currentIdx = getChartZoomIndex();
    if (currentIdx < minZoomIdx) {
        setChartZoomIndex(minZoomIdx, { persist: true, refresh: false });
    }

    // Create chart geometry
    const displayMax = getChartZoomPercent();
    const geom = createChartGeometry(canvas, displayMax, deviceScale);

    // Draw chart background if specified
    if (colors.bg && colors.bg !== 'transparent') {
        ctx.save();
        ctx.fillStyle = colors.bg;
        ctx.fillRect(geom.leftPadding, geom.padding, geom.chartWidth, geom.chartHeight);
        ctx.restore();
    }

    // Auto-toggle overlays based on active channels
    const activeChannelCount = Array.from(elements.rows.children).reduce((count, row) => {
        if (row.id === 'noChannelsRow') return count;
        const input = row.querySelector('.end-input');
        if (!input) return count;
        const endVal = InputValidator.clampEnd(input.value);
        return count + (endVal > 0 ? 1 : 0);
    }, 0);

    // Auto-toggle off overlays when multiple channels are enabled
    const state = getAppState();
    if (elements.aiLabelToggle) {
        if (activeChannelCount > 1) {
            if (elements.aiLabelToggle.checked && !state.overlayAutoToggledOff) {
                elements.aiLabelToggle.checked = false;
                updateAppState({ overlayAutoToggledOff: true });
            }
        } else {
            // Reset guard when back to single/no channels
            updateAppState({ overlayAutoToggledOff: false });
        }
    }

    // Draw chart components
    drawChartGrid(ctx, geom, colors);
    drawChartAxes(ctx, geom, colors);

    // Draw gradients and capture their dimensions for label alignment
    const inkGradientInfo = drawInkLevelGradient(ctx, geom, colors);
    const inputGradientInfo = drawInputLevelGradient(ctx, geom, colors);

    // Draw axis labels and titles using gradient dimensions
    const tickValues = getTickValues(geom.displayMax);
    drawAxisLabels(ctx, geom, colors, tickValues, inkGradientInfo, inputGradientInfo);
    drawAxisTitles(ctx, geom, colors, inkGradientInfo);

    // Draw curves for each active channel
    renderChannelCurves(ctx, geom, colors, fontScale);

    // Setup chart cursor tooltip interaction
    setupChartCursorTooltip(geom);

    // Update zoom buttons
    updateChartZoomButtons();

    // Update processing status for all channels
    updateAllProcessingDetails();
}

registerInkChartHandler(updateInkChart);

/**
 * Initialize chart system
 */
export function initializeChart() {
    console.log('📊 Initializing chart system...');

    configureChartScalingStateSubscription();

    if (elements.inkChart) {
        const wrapper = getChartWrapper();
        if (wrapper) {
            if (ENABLE_RESPONSIVE_CHART) {
                wrapper.dataset.chartResponsive = 'true';
                wrapper.style.removeProperty('--chart-fixed-height');
                updateResponsiveWrapperDimensions();
                ensureColumnResizeObserver();
                if (isBrowser) {
                    globalScope.addEventListener('resize', updateResponsiveWrapperDimensions, { passive: true });
                    if (document.fonts && typeof document.fonts.ready === 'object') {
                        document.fonts.ready.then(() => {
                            updateResponsiveWrapperDimensions();
                            updateInkChart();
                            scheduleAdditionalResponsivePasses();
                        }).catch(() => {});
                    }
                    globalScope.addEventListener('load', () => {
                        updateResponsiveWrapperDimensions();
                        updateInkChart();
                        scheduleAdditionalResponsivePasses();
                    }, { once: true });
                    globalScope.setTimeout(() => {
                        updateResponsiveWrapperDimensions();
                        updateInkChart();
                    }, 500);
                    globalScope.setTimeout(() => {
                        updateResponsiveWrapperDimensions();
                        updateInkChart();
                    }, 1000);
                    globalScope.setTimeout(() => {
                        updateResponsiveWrapperDimensions();
                        updateInkChart();
                    }, 2000);
                }
            } else {
                wrapper.dataset.chartResponsive = 'false';
                wrapper.style.setProperty('--chart-fixed-height', `${DEFAULT_CHART_FIXED_HEIGHT}px`);
                wrapper.style.removeProperty('--chart-dynamic-height');
            }
        }
    }

    // Initialize zoom from saved preferences
    initializeChartZoom();

    // Initial chart render
    if (elements.inkChart) {
        ensureChartResizeObserver();
        updateInkChart();
        if (ENABLE_RESPONSIVE_CHART && !responsiveInitScheduled && isBrowser && typeof globalScope.requestAnimationFrame === 'function') {
            responsiveInitScheduled = true;
            globalScope.requestAnimationFrame(() => {
                responsiveInitScheduled = false;
                updateResponsiveWrapperDimensions();
                updateInkChart();
                scheduleAdditionalResponsivePasses();
            });
        }
    }

    console.log('✅ Chart system initialized');
}

function scheduleAdditionalResponsivePasses() {
    if (!ENABLE_RESPONSIVE_CHART || !isBrowser || typeof globalScope.requestAnimationFrame !== 'function') {
        return;
    }
    responsiveInitialPasses = 0;
    const runPass = () => {
        responsiveInitialPasses += 1;
        updateResponsiveWrapperDimensions();
        updateInkChart();
        if (responsiveInitialPasses < RESPONSIVE_INITIAL_MAX_PASSES) {
            globalScope.requestAnimationFrame(() => {
                globalScope.setTimeout(runPass, 100);
            });
        }
    };
    runPass();
}

function ensureColumnResizeObserver() {
    if (!ENABLE_RESPONSIVE_CHART || !isBrowser) {
        return;
    }
    const column = getLinearizationColumn();
    if (!column || !('ResizeObserver' in globalScope)) {
        return;
    }
    if (!columnResizeObserver) {
        columnResizeObserver = new ResizeObserver(() => {
            updateResponsiveWrapperDimensions();
            updateInkChart();
        });
    }
    columnResizeObserver.observe(column);
}

function ensureChartResizeObserver() {
    const canvas = elements.inkChart;
    if (!canvas || !isBrowser) return;

    const scheduleResize = () => {
        if (!elements.inkChart) return;

        if (ENABLE_RESPONSIVE_CHART) {
            updateResponsiveWrapperDimensions();
        }

        // Skip if nothing changed since last render to avoid redundant work
        const dpr = globalScope.devicePixelRatio || 1;
        const rect = elements.inkChart.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }
        const width = Math.round(rect.width * dpr);
        const height = Math.round(rect.height * dpr);
        if (
            width === lastCanvasMetrics.width &&
            height === lastCanvasMetrics.height &&
            dpr === lastCanvasMetrics.dpr
        ) {
            return;
        }

        if (resizeRafId) return;
        resizeRafId = globalScope.requestAnimationFrame(() => {
            resizeRafId = null;
            updateInkChart();
        });
    };

    if ('ResizeObserver' in window && !chartResizeObserver) {
        chartResizeObserver = new ResizeObserver(scheduleResize);
        chartResizeObserver.observe(canvas);
    } else if (!windowResizeHandler) {
        windowResizeHandler = () => scheduleResize();
        globalScope.addEventListener('resize', windowResizeHandler, { passive: true });
    }
}

/**
 * Draw reference intent curve (dotted line showing target)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {string} channelName - Channel name
 * @param {number} endValue - Channel end value
 */
function drawReferenceIntentCurve(ctx, geom, colors, channelName, endValue) {
    try {
        // Only show reference if linearization is active or Smart Curve is applied
        const hasLinearization = LinearizationState.hasAnyLinearization() ||
                                LinearizationState.getPerChannelData(channelName);
        const isAICurve = isSmartCurve(channelName);
        const hasLoadedQuad = !!getLoadedQuadData()?.curves;
        const showRef = hasLinearization || isAICurve || hasLoadedQuad;

        if (!showRef) return;

        // Get channel color
        const inkColor = INK_COLORS[channelName] || '#000000';

        // Build intent-based reference: y = Intent(t) scaled to current End
        const refValues = [];
        const Nvals = 256;
        for (let i = 0; i < Nvals; i++) {
            const t = i / (Nvals - 1);
            // Get relative target value (0-1) from current contrast intent
            let yRel;
            if (typeof globalScope.getTargetRelAt === 'function') {
                yRel = Math.max(0, Math.min(1, globalScope.getTargetRelAt(t)));
            } else {
                // Fallback to linear if getTargetRelAt is not available
                yRel = Math.max(0, Math.min(1, t));
            }
            refValues.push(Math.round(yRel * endValue));
        }

        // Draw faded reference line (dotted)
        ctx.save();
        ctx.strokeStyle = inkColor;

        // Check if this is the selected channel in edit mode
        const isEdit = typeof globalScope.isEditModeEnabled === 'function' && globalScope.isEditModeEnabled();
        const isSelectedChannel = isEdit && globalScope.EDIT && globalScope.EDIT.selectedChannel === channelName;

        // Dim further when Edit Mode is on and this is not the selected channel
        ctx.globalAlpha = (isEdit && !isSelectedChannel) ? 0.125 : 0.25;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]); // Dotted line

        ctx.beginPath();
        for (let i = 0; i < refValues.length; i++) {
            const x = geom.leftPadding + (i / (refValues.length - 1)) * geom.chartWidth;
            const valuePercent = (refValues[i] / TOTAL) * 100;
            const chartPercent = Math.max(0, Math.min(geom.displayMax, valuePercent));
            const y = mapPercentToY(chartPercent, geom);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash
        ctx.restore();

    } catch (error) {
        console.warn(`Error drawing reference curve for ${channelName}:`, error);
    }
}

function drawOriginalCurveOverlay(ctx, geom, colors, channelName, endValue) {
    try {
        const hasLinearization = LinearizationState.hasAnyLinearization() ||
                                LinearizationState.getPerChannelData(channelName);
        const loadedData = getLoadedQuadData();
        const originalCurve = loadedData?.originalCurves?.[channelName];
        if (!Array.isArray(originalCurve) || originalCurve.length === 0) return;

        const showOverlay = hasLinearization || !!loadedData;
        if (!showOverlay) return;

        const baselineEnd = loadedData?.baselineEnd?.[channelName];
        const scale = baselineEnd > 0 ? endValue / baselineEnd : 1;

        ctx.save();
        ctx.strokeStyle = '#9CA3AF';
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);

        ctx.beginPath();
        for (let i = 0; i < originalCurve.length; i++) {
            const x = geom.leftPadding + (i / (originalCurve.length - 1)) * geom.chartWidth;
            const scaledValue = Math.max(0, Math.min(TOTAL, Math.round(originalCurve[i] * scale)));
            const valuePercent = (scaledValue / TOTAL) * 100;
            const chartPercent = Math.max(0, Math.min(geom.displayMax, valuePercent));
            const y = mapPercentToY(chartPercent, geom);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    } catch (error) {
        console.warn(`Error drawing original overlay for ${channelName}:`, error);
    }
}

/**
 * Render curves for all active channels
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {number} fontScale - Device pixel ratio scale factor for labels
*/
function renderChannelCurves(ctx, geom, colors, fontScale) {
    try {
        if (!elements.rows) return;

        const channels = Array.from(elements.rows.children).filter(row => row.id !== 'noChannelsRow');
        const labels = [];
        const drawMeta = [];
        if (isBrowser) {
            globalScope.__chartDrawMeta = drawMeta;
        }

        for (const row of channels) {
            const channelName = row.getAttribute('data-channel');
            if (!channelName) continue;

            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (!percentInput || !endInput) continue;

            const basePercent = InputValidator.clampPercent(percentInput.getAttribute('data-base-percent') ?? percentInput.value);
            const baseEndValue = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);

            if (basePercent === 0 || baseEndValue === 0) {
                percentInput.value = basePercent.toFixed(1);
                endInput.value = String(baseEndValue);
                continue;
            }

            const applyLinearization = LinearizationState.globalApplied && LinearizationState.globalData;
            const normalizeToEnd = isChannelNormalizedToEnd(channelName);
            const curveValues = make256(baseEndValue, channelName, applyLinearization, { normalizeToEnd });

            // Draw reference line (target intent curve) if linearization is active
            drawReferenceIntentCurve(ctx, geom, colors, channelName, baseEndValue);

            // Draw original loaded curve overlay (dashed) when linearization is active
            drawOriginalCurveOverlay(ctx, geom, colors, channelName, baseEndValue);

            // Convert curve to chart coordinates and draw
            const curveMeta = drawChannelCurve(ctx, geom, colors, channelName, curveValues, baseEndValue);
            if (curveMeta) {
                drawMeta.push({
                    channelName,
                    alpha: curveMeta.strokeAlpha,
                    lineWidth: curveMeta.strokeWidth,
                    isSelected: curveMeta.isSelectedChannel,
                    editMode: curveMeta.isEditMode
                });
            }

            // Collect label info for ink labels
            const inkColor = INK_COLORS[channelName] || '#000000';
            let peakValue = 0;
            for (let i = 0; i < curveValues.length; i++) {
                const v = curveValues[i];
                if (Number.isFinite(v) && v > peakValue) peakValue = v;
            }

            const peakPercent = (peakValue / TOTAL) * 100;
            const effectivePercent = InputValidator.clampPercent(peakPercent);
            const effectiveEnd = InputValidator.clampEnd(Math.round(peakValue));

            const shouldUseEffective = !LinearizationState.globalApplied
                || LinearizationState.isGlobalBaked?.();
            const percentToDisplay = shouldUseEffective ? effectivePercent : basePercent;
            const endToDisplay = shouldUseEffective ? effectiveEnd : baseEndValue;
            const endY = mapPercentToY(Math.max(0, Math.min(100, effectivePercent)), geom);

            percentInput.value = percentToDisplay.toFixed(1);
            percentInput.setAttribute('data-base-percent', String(percentToDisplay));
            endInput.value = String(endToDisplay);
            endInput.setAttribute('data-base-end', String(endToDisplay));

            labels.push({
                channelName,
                percent: Math.round(effectivePercent),
                inkColor,
                endY
            });
        }

        // Draw ink labels at right edge
        if (labels.length > 0) {
            drawInkLabels(ctx, geom, labels, fontScale);
        }

    } catch (error) {
        console.error('Error rendering channel curves:', error);
    }
}

/**
 * Draw a single channel curve
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Object} colors - Chart colors
 * @param {string} channelName - Channel name
 * @param {Array<number>} curveValues - Curve values (0-65535)
 * @param {number} endValue - Channel end value
 */
function drawChannelCurve(ctx, geom, colors, channelName, curveValues, endValue) {
    try {
        // Get channel color from INK_COLORS
        const channelColor = INK_COLORS[channelName] || '#000000';

        const isEditMode = typeof globalScope.isEditModeEnabled === 'function' && globalScope.isEditModeEnabled();
        const isSelectedChannel = isEditMode && globalScope.EDIT && globalScope.EDIT.selectedChannel === channelName;
        const dimUnselected = isEditMode && !isSelectedChannel;

        const strokeAlpha = dimUnselected ? 0.45 : 0.95;
        const strokeWidth = dimUnselected ? 2 : 3;

        ctx.save();
        ctx.strokeStyle = channelColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = strokeAlpha;

        ctx.beginPath();

        for (let i = 0; i < curveValues.length; i++) {
            // Convert from curve index to input percentage (0-100)
            const inputPercent = (i / (curveValues.length - 1)) * 100;

            // Convert from curve value to output percentage (0-100)
            // Note: Normalize to TOTAL (65535) to show actual ink percentages, not to endValue
            const outputPercent = (curveValues[i] / TOTAL) * 100;

            // Map to chart coordinates
            const x = mapPercentToX(inputPercent, geom);
            const y = mapPercentToY(outputPercent, geom);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
        ctx.restore();

        // Draw Smart key point overlays if in edit mode and this is the selected channel
        try {
            // Debug logging - always log for now to diagnose
            console.log(`[OVERLAY DEBUG] ${channelName}: editMode=${isEditMode}, selectedChannel=${globalScope.EDIT?.selectedChannel}, isSelectedChannel=${isSelectedChannel}`);

            if (isSelectedChannel) {
                // Get Smart key points for this channel
                const smartPoints = ControlPoints.get(channelName);
                console.log(`[OVERLAY DEBUG] ${channelName}: smartPoints exist=${!!smartPoints?.points}, count=${smartPoints?.points?.length || 0}`);
                if (smartPoints?.points) {
                    console.log(`[OVERLAY DEBUG] ${channelName}: points=`, smartPoints.points.slice(0, 3));
                }
                if (smartPoints && smartPoints.points && smartPoints.points.length > 0) {
                    const selectedOrdinal = globalScope.EDIT.selectedOrdinal || 1;

                    // Draw the overlays
                    drawSmartKeyPointOverlays(
                        ctx,
                        geom,
                        colors,
                        channelName,
                        smartPoints.points,
                        curveValues,
                        TOTAL,
                        selectedOrdinal,
                        channelColor,
                        {
                            drawMarkers: true,
                            showLabels: elements.aiLabelToggle ? elements.aiLabelToggle.checked : true,
                            boxSize: 6
                        }
                    );
                }
            }
        } catch (overlayError) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn(`Smart key point overlay error for ${channelName}:`, overlayError);
            }
        }

        return {
            isEditMode,
            isSelectedChannel,
            strokeAlpha,
            strokeWidth
        };

    } catch (error) {
        console.error(`Error drawing curve for ${channelName}:`, error);
        return null;
    }
}

/**
 * Draw ink labels at the right edge of the chart
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} geom - Chart geometry
 * @param {Array} labels - Array of label objects with channelName, percent, inkColor, endY
 * @param {number} fontScale - Device pixel ratio scale factor for fonts and spacing
*/
function drawInkLabels(ctx, geom, labels, fontScale) {
    try {
        const scaledValue = (value) => Math.max(1, Math.round(value * fontScale));
        const scaledFloat = (value) => value * fontScale;

        // Sort labels by Y position to handle overlaps
        labels.sort((a, b) => a.endY - b.endY);

        const fontSize = Math.max(10, Math.round(11 * fontScale * 10) / 10);
        ctx.font = `bold ${fontSize}px system-ui`;
        ctx.textAlign = 'left';

        const minSpacing = scaledValue(20); // Minimum spacing between labels
        // Position labels at right edge, accounting for right padding to prevent overflow
        const endX = geom.leftPadding + geom.chartWidth;

        // Get theme colors from CSS variables
        const styles = getComputedStyle(document.documentElement);
        const labelBG = (styles.getPropertyValue('--bg-elevated') || '#ffffff').trim();
        const labelBorder = (styles.getPropertyValue('--border') || '#e5e7eb').trim();
        const labelTextColor = (styles.getPropertyValue('--text') || '#111827').trim();

        // Adjust label positions to avoid overlaps
        for (let i = 0; i < labels.length; i++) {
            let labelY = labels[i].endY + scaledFloat(4);

            // Check for overlap with previous label
            if (i > 0) {
                const prevLabelY = labels[i-1].adjustedY || (labels[i-1].endY + scaledFloat(4));
                if (labelY - prevLabelY < minSpacing) {
                    labelY = prevLabelY + minSpacing;
                }
            }

            // Store adjusted position
            labels[i].adjustedY = labelY;

            // Draw the label with background and ink color chip
            const labelText = `${labels[i].channelName} ${labels[i].percent}%`;
            const textMetrics = ctx.measureText(labelText);
            const chipW = scaledValue(8);
            const chipH = scaledValue(12);
            const pad = scaledValue(6);
            const textHeight = scaledValue(16); // Background height for scaled text
            const bgW = chipW + pad + Math.ceil(textMetrics.width) + pad; // chip + gap + text + pad
            const bgH = textHeight + scaledValue(2);

            // Anchor label so it ends before the right edge of the canvas (with small margin)
            const rightMargin = scaledValue(4);
            const bgX = Math.min(endX, geom.width - geom.rightPadding + scaledValue(4)); // allow labels to extend slightly into padding
            // Ensure label doesn't overflow canvas right edge
            const maxBgX = geom.width - bgW - rightMargin;
            const finalBgX = Math.min(bgX, maxBgX);
            const bgY = labelY - textHeight + scaledFloat(5); // shift down a bit for clarity

            // Background + border
            ctx.fillStyle = labelBG;
            ctx.fillRect(finalBgX, bgY, bgW, bgH);
            ctx.strokeStyle = labelBorder;
            ctx.lineWidth = 1;
            ctx.strokeRect(finalBgX + 0.5, bgY + 0.5, bgW - 1, bgH - 1);

            // Ink color chip
            const chipX = finalBgX + pad / 2;
            const chipY = bgY + Math.round((bgH - chipH)/2);
            ctx.fillStyle = labels[i].inkColor;
            ctx.fillRect(Math.round(chipX) + 0.5, Math.round(chipY) + 0.5, chipW, chipH);
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.strokeRect(Math.round(chipX) + 0.5, Math.round(chipY) + 0.5, chipW, chipH);

            // Text
            const textX = finalBgX + chipW + pad;
            const textCenterY = bgY + Math.round(bgH/2) + scaledFloat(5) - scaledFloat(2); // vertical align tweak
            ctx.fillStyle = labelTextColor;
            ctx.fillText(labelText, textX, textCenterY);
        }

    } catch (error) {
        console.error('Error drawing ink labels:', error);
    }
}

/**
 * Get chart interaction coordinates
 * @param {MouseEvent} event - Mouse event
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @returns {Object} Chart coordinates
 */
export function getChartCoordinates(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    const geom = createChartGeometry(canvas, getChartZoomPercent(), scaleX);
    const inputPercent = mapXToPercent(canvasX, geom);
    const outputPercent = mapYToPercent(canvasY, geom);

    return {
        canvasX,
        canvasY,
        inputPercent: Math.round(inputPercent * 10) / 10,
        outputPercent: Math.round(outputPercent * 10) / 10
    };
}

/**
 * Setup chart cursor tooltip functionality
 * Shows X,Y coordinates as mouse moves over chart
 * @param {Object} geom - Chart geometry object
 */
export function setupChartCursorTooltip(geom) {
    CHART_CURSOR_MAP = geom;
    const canvas = elements.inkChart;
    const tip = elements.chartCursorTooltip;

    if (!canvas || !tip) {
        console.warn('Chart cursor tooltip setup failed: missing elements', { canvas: !!canvas, tip: !!tip });
        return;
    }

    if (!canvas._cursorTooltipBound) {
        const container = canvas.closest('.relative') || canvas.parentElement || document.body;

        const onMove = (e) => {
            if (!CHART_CURSOR_MAP) return;

            // Re-render chart to clear prior cursor marker overlay
            try {
                updateInkChart();
            } catch (err) {
                console.warn('Chart update during tooltip failed:', err);
            }

            // Convert mouse coordinates to canvas coordinates
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const cx = (e.clientX - rect.left) * scaleX;
            const cy = (e.clientY - rect.top) * scaleY;

            // Convert to chart coordinates
            const { leftPadding, chartWidth } = CHART_CURSOR_MAP;
            let xPct = ((cx - leftPadding) / chartWidth) * 100;
            xPct = Math.max(0, Math.min(100, xPct));
            let yPct = mapYToPercent(cy, CHART_CURSOR_MAP);
            let drawX = cx;
            let drawY = mapPercentToY(yPct, CHART_CURSOR_MAP);

            // Check if we're in edit mode and have a selected channel
            // For now, we'll implement basic tooltip without edit mode dependencies
            let canInsert = false;
            try {
                // Basic check for edit mode functionality - can be enhanced later
                if (typeof globalScope.isEditModeEnabled === 'function' && globalScope.isEditModeEnabled()) {
                    const editModeEnabled = globalScope.isEditModeEnabled();
                    if (editModeEnabled && globalScope.EDIT && globalScope.EDIT.selectedChannel) {
                        const selCh = globalScope.EDIT.selectedChannel;
                        const row = Array.from(elements.rows.children).find(tr =>
                            tr.getAttribute('data-channel') === selCh
                        );
                        if (row) {
                            const endVal = InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0);
                            if (endVal > 0) {
                                canInsert = true;
                                // Generate curve values and lock Y to curve
                                const values = make256(endVal, selCh, true, { normalizeToEnd: isChannelNormalizedToEnd(selCh) });
                                const t = Math.max(0, Math.min(1, (xPct/100))) * (values.length - 1);
                                const i0 = Math.floor(t);
                                const i1 = Math.min(values.length - 1, i0 + 1);
                                const a = t - i0;
                                const v = (1 - a) * values[i0] + a * values[i1];
                                const vPct = Math.max(0, Math.min(100, (v / TOTAL) * 100));
                                yPct = vPct; // Lock tooltip Y to curve value
                                drawY = mapPercentToY(vPct, CHART_CURSOR_MAP);

                                // Draw cursor indicator circle on the curve
                                const ctx = canvas.getContext('2d');
                                if (ctx) {
                                    const inkColor = INK_COLORS[selCh] || '#000000';
                                    ctx.save();
                                    ctx.beginPath();
                                    ctx.arc(Math.max(leftPadding, Math.min(leftPadding + chartWidth, drawX)), drawY, 8, 0, Math.PI * 2);
                                    ctx.lineWidth = 4;
                                    ctx.strokeStyle = inkColor;
                                    ctx.stroke();
                                    ctx.restore();
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('Edit mode tooltip integration failed:', err);
            }

            // Update tooltip content and position
            tip.innerHTML = `${xPct.toFixed(1)}, ${yPct.toFixed(1)}${canInsert ? '<br>click to add point' : ''}`;
            const contRect = container.getBoundingClientRect();
            const left = e.clientX - contRect.left + 12;
            const top = e.clientY - contRect.top - 24;
            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
            tip.classList.remove('hidden');
        };

        const onLeave = () => {
            tip.classList.add('hidden');
            try {
                updateInkChart();
            } catch (err) {
                console.warn('Chart update during tooltip leave failed:', err);
            }
        };

        const onClick = (e) => {
            try {
                // Basic click handling - can be enhanced with edit mode integration
                if (typeof globalScope.isEditModeEnabled === 'function' && globalScope.isEditModeEnabled() && globalScope.quadGenActions) {
                    if (!globalScope.isEditModeEnabled() || !globalScope.EDIT || !globalScope.EDIT.selectedChannel) return;

                    const selCh = globalScope.EDIT.selectedChannel;
                    const row = Array.from(elements.rows.children).find(tr =>
                        tr.getAttribute('data-channel') === selCh
                    );
                    if (!row) return;

                    const endVal = InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0);
                    if (endVal <= 0) return;

                    // Calculate click coordinates
                    const rect = canvas.getBoundingClientRect();
                    const scaleX = canvas.width / rect.width;
                    const scaleY = canvas.height / rect.height;
                    const cx = (e.clientX - rect.left) * scaleX;
                    const cy = (e.clientY - rect.top) * scaleY;

                    const { leftPadding, chartWidth } = CHART_CURSOR_MAP;
                    let xPct = ((cx - leftPadding) / chartWidth) * 100;
                    xPct = Math.max(0, Math.min(100, xPct));

                    // Sample curve at click position and insert point
                    const values = make256(endVal, selCh, true, { normalizeToEnd: isChannelNormalizedToEnd(selCh) });
                    const t = Math.max(0, Math.min(1, (xPct/100))) * (values.length - 1);
                    const i0 = Math.floor(t);
                    const i1 = Math.min(values.length - 1, i0 + 1);
                    const a = t - i0;
                    const v = (1 - a) * values[i0] + a * values[i1];
                    let yPct = Math.max(0, Math.min(100, (v / TOTAL) * 100));

                    const res = globalScope.quadGenActions.insertSmartKeyPointAt(selCh, xPct, yPct);
                    if (res && res.success) {
                        console.log('Point inserted successfully at', xPct.toFixed(1), ',', yPct.toFixed(1));

                        // Set selection to the newly inserted point (matching legacy behavior)
                        try {
                            const kp = globalScope.ControlPoints?.get(selCh)?.points || [];
                            if (kp.length > 0 && globalScope.ControlPoints?.nearestIndex) {
                                const nearest = globalScope.ControlPoints.nearestIndex(kp, xPct, 100); // large tolerance
                                if (nearest && typeof nearest.index === 'number' && nearest.index >= 0) {
                                    if (globalScope.EDIT) {
                                        globalScope.EDIT.selectedOrdinal = nearest.index + 1; // Convert to 1-based
                                        console.log('Selected newly inserted point:', globalScope.EDIT.selectedOrdinal);

                                        // Refresh the point index display
                                        if (typeof globalScope.edit_refreshPointIndex === 'function') {
                                            globalScope.edit_refreshPointIndex();
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('Failed to update point selection:', err);
                        }

                        try { triggerPreviewUpdate(); } catch (err) {
                            console.warn('Failed to update preview after point insertion:', err);
                        }
                    } else if (res && !res.success && res.message) {
                        showStatus(res.message);
                    }
                }
            } catch (err) {
                console.warn('Click-to-insert failed:', err);
            }
        };

        // Add event listeners
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseenter', onMove);
        canvas.addEventListener('mouseleave', onLeave);
        canvas.addEventListener('click', onClick);
        canvas._cursorTooltipBound = true;

        console.log('📊 Chart cursor tooltip setup complete');
    }
}

/**
 * Export for global access during transition
 */
if (isBrowser) {
    globalScope.updateInkChart = updateInkChart;
    globalScope.setChartStatusMessage = setChartStatusMessage;

    // Debug function for testing canvas status messages
    globalScope.testChartStatusMessage = () => {
        console.log('🔍 Testing chart status message...');
        setChartStatusMessage('Preview updated', 3000);
    };
}

/**
 * Export chart utilities for backward compatibility
 */
export {
    normalizeDisplayMax,
    clampPercentForDisplay,
    mapPercentToY,
    mapPercentToX,
    mapYToPercent,
    mapXToPercent,
    getChartColors,
    createChartGeometry,
    drawChartGrid
} from './chart-utils.js';
