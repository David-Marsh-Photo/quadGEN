// quadGEN Chart Divider
// Handles draggable chart height resizing and panel width resizing

// ===== HORIZONTAL DIVIDER (Chart Height) =====
const STORAGE_KEY = 'quadgen.chartHeight';
const DEFAULT_HEIGHT = '60vh';
const MIN_HEIGHT_PX = 320;
const MAX_HEIGHT_VH = 80;

let isDragging = false;
let startY = 0;
let startHeight = 0;
let dividerElement = null;
let chartContainer = null;

// ===== VERTICAL DIVIDER (Panel Width) =====
const PANEL_STORAGE_KEY = 'quadgen.rightPanelWidth';
const DEFAULT_PANEL_WIDTH = '256px';
const MIN_PANEL_WIDTH_PX = 256;
const MIN_CHART_WIDTH_PX = 450;

let isPanelDragging = false;
let startX = 0;
let startPanelWidth = 0;
let startChartWidth = 0;
let panelDividerElement = null;
let chartPanelElement = null;
let rightPanelElement = null;

/**
 * Initialize the chart divider system
 */
export function initChartDivider() {
    dividerElement = document.getElementById('chartDivider');
    chartContainer = document.getElementById('chartContainer');

    if (!dividerElement || !chartContainer) {
        console.warn('[ChartDivider] Required elements not found in DOM');
        return;
    }

    // Restore saved height or use default
    const savedHeight = getSavedHeight();
    updateChartHeight(savedHeight, false);

    // Attach drag listeners
    dividerElement.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // Touch support for mobile
    dividerElement.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startDrag({ clientY: touch.clientY });
        e.preventDefault();
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        drag({ clientY: touch.clientY });
        e.preventDefault();
    });

    document.addEventListener('touchend', endDrag);

    console.log('[ChartDivider] Initialized with height:', savedHeight);
}

/**
 * Start dragging the divider
 * @param {MouseEvent} e - Mouse event
 */
function startDrag(e) {
    isDragging = true;
    startY = e.clientY;
    startHeight = chartContainer.offsetHeight;

    dividerElement.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    e.preventDefault();
}

/**
 * Handle drag movement
 * @param {MouseEvent} e - Mouse event
 */
function drag(e) {
    if (!isDragging) return;

    const deltaY = e.clientY - startY;
    const newHeight = startHeight + deltaY;

    // Calculate viewport height constraints
    const viewportHeight = window.innerHeight;
    const maxHeightPx = (MAX_HEIGHT_VH / 100) * viewportHeight;

    // Apply constraints
    const constrainedHeight = Math.max(MIN_HEIGHT_PX, Math.min(newHeight, maxHeightPx));

    // Update the chart container height
    chartContainer.style.height = `${constrainedHeight}px`;

    // Update CSS variable for tab container calculations
    document.documentElement.style.setProperty('--chart-height', `${constrainedHeight}px`);

    e.preventDefault();
}

/**
 * End dragging and save state
 * @param {MouseEvent} e - Mouse event
 */
function endDrag(e) {
    if (!isDragging) return;

    isDragging = false;
    dividerElement.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Save the final height
    const finalHeight = chartContainer.style.height;
    persistHeight(finalHeight);

    // Trigger chart resize
    triggerChartResize();

    console.log('[ChartDivider] Drag ended, height:', finalHeight);
}

/**
 * Update chart height (programmatically or on init)
 * @param {string} height - CSS height value (px, vh, etc.)
 * @param {boolean} save - Whether to save to localStorage (default: true)
 */
export function updateChartHeight(height, save = true) {
    if (!chartContainer) return;

    chartContainer.style.height = height;
    document.documentElement.style.setProperty('--chart-height', height);

    if (save) {
        persistHeight(height);
    }

    // Trigger chart resize after a brief delay to ensure layout is applied
    setTimeout(() => {
        triggerChartResize();
    }, 50);
}

/**
 * Get saved height from localStorage
 * @returns {string} Saved height or default
 */
function getSavedHeight() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return saved;
        }
    } catch (error) {
        console.warn('[ChartDivider] Failed to read from localStorage:', error);
    }
    return DEFAULT_HEIGHT;
}

/**
 * Save height to localStorage
 * @param {string} height - Height value to save
 */
function persistHeight(height) {
    try {
        localStorage.setItem(STORAGE_KEY, height);
    } catch (error) {
        console.warn('[ChartDivider] Failed to save to localStorage:', error);
    }
}

/**
 * Trigger chart resize event
 * The existing ResizeObserver in chart-manager.js will handle the redraw
 */
function triggerChartResize() {
    // The chart's ResizeObserver will automatically detect the size change
    // and trigger updateInkChart(). No manual trigger needed.

    // But we can dispatch a custom event for any other listeners
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('chart-height-changed'));
    }
}

// ===================================================================
// VERTICAL PANEL DIVIDER FUNCTIONS
// ===================================================================

/**
 * Initialize the panel divider system (left/right panels)
 */
export function initPanelDivider() {
    panelDividerElement = document.getElementById('panelDivider');
    chartPanelElement = document.getElementById('chartPanel');
    rightPanelElement = document.getElementById('rightPanel');

    if (!panelDividerElement || !chartPanelElement || !rightPanelElement) {
        console.warn('[PanelDivider] Required elements not found in DOM - panel resize disabled');
        return;
    }

    // Restore saved panel width or use default
    const savedWidth = getSavedPanelWidth();
    updatePanelWidth(savedWidth, false);

    // Attach drag listeners
    panelDividerElement.addEventListener('mousedown', startPanelDrag);
    document.addEventListener('mousemove', dragPanel);
    document.addEventListener('mouseup', endPanelDrag);

    // Touch support for mobile
    panelDividerElement.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startPanelDrag({ clientX: touch.clientX });
        e.preventDefault();
    });

    document.addEventListener('touchmove', (e) => {
        if (!isPanelDragging) return;
        const touch = e.touches[0];
        dragPanel({ clientX: touch.clientX });
        e.preventDefault();
    });

    document.addEventListener('touchend', endPanelDrag);

    console.log('[PanelDivider] Initialized with width:', savedWidth);
}

/**
 * Start dragging the panel divider
 * @param {MouseEvent} e - Mouse event
 */
function startPanelDrag(e) {
    isPanelDragging = true;
    startX = e.clientX;
    startPanelWidth = rightPanelElement.offsetWidth;
    startChartWidth = chartPanelElement.offsetWidth;

    panelDividerElement.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    e.preventDefault();
}

/**
 * Handle panel drag movement
 * @param {MouseEvent} e - Mouse event
 */
function dragPanel(e) {
    if (!isPanelDragging) return;

    const deltaX = e.clientX - startX;

    // Calculate new widths (dragging right shrinks panel, dragging left expands panel)
    const newPanelWidth = startPanelWidth - deltaX;
    const newChartWidth = startChartWidth + deltaX;

    // Get container total width (app-layout, not main-content-area)
    const containerWidth = chartPanelElement.parentElement.parentElement.offsetWidth - 10; // 10px for divider

    // Apply constraints
    const constrainedPanelWidth = Math.max(
        MIN_PANEL_WIDTH_PX,
        Math.min(newPanelWidth, containerWidth * 0.5) // Max 50% of container
    );

    const constrainedChartWidth = Math.max(
        MIN_CHART_WIDTH_PX,
        containerWidth - constrainedPanelWidth - 10
    );

    // Verify both constraints can be satisfied
    if (constrainedChartWidth + constrainedPanelWidth + 10 > containerWidth) {
        // Can't satisfy both constraints - prioritize minimum widths
        return;
    }

    // Update panel widths using flex-basis for better control
    // main-content-area (chartPanel's parent) and rightPanel are siblings in app-layout
    const mainContentArea = chartPanelElement.parentElement;
    mainContentArea.style.flexBasis = `${constrainedChartWidth}px`;
    rightPanelElement.style.flexBasis = `${constrainedPanelWidth}px`;

    // Update CSS variables for potential use elsewhere
    document.documentElement.style.setProperty('--main-content-width', `${constrainedChartWidth}px`);
    document.documentElement.style.setProperty('--right-panel-width', `${constrainedPanelWidth}px`);

    e.preventDefault();
}

/**
 * End panel dragging and save state
 * @param {MouseEvent} e - Mouse event
 */
function endPanelDrag(e) {
    if (!isPanelDragging) return;

    isPanelDragging = false;
    panelDividerElement.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Save the final width (as percentage for responsive behavior)
    const finalWidth = rightPanelElement.offsetWidth;
    const containerWidth = chartPanelElement.parentElement.parentElement.offsetWidth;
    const widthPercent = (finalWidth / containerWidth) * 100;

    persistPanelWidth(`${widthPercent.toFixed(2)}%`);

    // Trigger chart resize
    triggerChartResize();

    console.log('[PanelDivider] Drag ended, width:', `${widthPercent.toFixed(2)}%`);
}

/**
 * Update panel width (programmatically or on init)
 * @param {string} width - CSS width value (px, %, etc.)
 * @param {boolean} save - Whether to save to localStorage (default: true)
 */
export function updatePanelWidth(width, save = true) {
    if (!rightPanelElement || !chartPanelElement) return;

    const mainContentArea = chartPanelElement.parentElement;
    if (!mainContentArea) return;

    // Parse width to determine type
    if (width.endsWith('%')) {
        // Percentage - set flex-basis
        rightPanelElement.style.flexBasis = width;
        mainContentArea.style.flexBasis = `${100 - parseFloat(width)}%`;
    } else {
        // Pixel value - set flex-basis
        rightPanelElement.style.flexBasis = width;
        mainContentArea.style.flexBasis = 'auto';
    }

    document.documentElement.style.setProperty('--right-panel-width', width);

    if (save) {
        persistPanelWidth(width);
    }

    // Trigger chart resize after a brief delay to ensure layout is applied
    setTimeout(() => {
        triggerChartResize();
    }, 50);
}

/**
 * Get current panel width
 * @returns {string} Current panel width
 */
export function getPanelWidth() {
    if (!rightPanelElement) return DEFAULT_PANEL_WIDTH;

    const width = rightPanelElement.offsetWidth;
    const containerWidth = chartPanelElement?.parentElement?.parentElement?.offsetWidth || 1;
    const widthPercent = (width / containerWidth) * 100;

    return `${widthPercent.toFixed(2)}%`;
}

/**
 * Get saved panel width from localStorage
 * @returns {string} Saved width or default
 */
function getSavedPanelWidth() {
    try {
        const saved = localStorage.getItem(PANEL_STORAGE_KEY);
        if (saved) {
            return saved;
        }
    } catch (error) {
        console.warn('[PanelDivider] Failed to read from localStorage:', error);
    }
    return DEFAULT_PANEL_WIDTH;
}

/**
 * Save panel width to localStorage
 * @param {string} width - Width value to save
 */
function persistPanelWidth(width) {
    try {
        localStorage.setItem(PANEL_STORAGE_KEY, width);
    } catch (error) {
        console.warn('[PanelDivider] Failed to save to localStorage:', error);
    }
}

/**
 * Expose chart divider functions to window for debugging
 */
if (typeof window !== 'undefined') {
    window.ChartDivider = {
        // Chart height functions
        updateChartHeight,
        getCurrentHeight: () => chartContainer?.style.height || DEFAULT_HEIGHT,

        // Panel width functions
        updatePanelWidth,
        getPanelWidth,
        initPanelDivider
    };
}
