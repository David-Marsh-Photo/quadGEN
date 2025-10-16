// quadGEN Chart Manager
// Chart rendering, zoom management, and interaction handling

import { elements, getCurrentPrinter, getAppState, updateAppState, INK_COLORS, TOTAL, isChannelNormalizedToEnd, getLoadedQuadData } from '../core/state.js';
import { getStateManager } from '../core/state-manager.js';
import { InputValidator } from '../core/validation.js';
import { make256 } from '../core/processing-pipeline.js';
import { getCurrentScale } from '../core/scaling-utils.js';
import { SCALING_STATE_FLAG_EVENT } from '../core/scaling-constants.js';
import { ControlPoints, isSmartCurve } from '../curves/smart-curves.js';
import { registerInkChartHandler, triggerPreviewUpdate } from './ui-hooks.js';
import { showStatus } from './status-service.js';
import { LinearizationState, normalizeLinearizationEntry } from '../data/linearization-utils.js';
import { isSmartPointDragEnabled } from '../core/feature-flags.js';
import { isChannelLocked, getChannelLockEditMessage } from '../core/channel-locks.js';
import {
    beginSmartPointDrag,
    updateSmartPointDrag,
    endSmartPointDrag,
    cancelSmartPointDrag,
    isSmartPointDragActive,
    selectSmartPointOrdinal
} from './edit-mode.js';
import {
    normalizeDisplayMax,
    clampPercentForDisplay,
    mapPercentToY,
    mapPercentToX,
    mapYToPercent,
    mapXToPercent,
    getChartColors,
    createChartGeometry,
    drawChartGrid,
    hitTestSmartPoint,
    clampSmartPointCoordinates,
    resolveSmartPointClickSelection
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
import { normalizeDragOutputToAbsolute } from './drag-utils.js';
import { updateProcessingDetail, updateAllProcessingDetails } from './processing-status.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { subscribeCompositeDebugState, getCompositeDebugState } from '../core/composite-debug.js';
import {
    computeLightBlockingCurve,
    isLightBlockingOverlayEnabled as coreIsLightBlockingOverlayEnabled,
    setLightBlockingOverlayEnabled as coreSetLightBlockingOverlayEnabled,
    clearLightBlockingCache as clearLightBlockingOverlayCache
} from '../core/light-blocking.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

function formatPercentDisplay(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.05) {
    return String(rounded);
  }
  return Number(value.toFixed(1)).toString();
}

const SMART_POINT_DRAG_TOLERANCE_PX = 12;

const initialAppStateSnapshot = getAppState();
const CORRECTION_OVERLAY_COLOR = '#ef4444';
const CORRECTION_BASELINE_COLOR = '#a855f7';
const ORIGINAL_CURVE_OVERLAY_COLOR = '#4b5563';
const LIGHT_BLOCKING_OVERLAY_COLOR = '#7c3aed';
const LIGHT_BLOCKING_LABEL_COLOR = '#6d28d9';
const LIGHT_BLOCKING_REFERENCE_COLOR = '#c084fc';
const FLAG_MARKER_EMOJI = '🚩';
const FLAG_MARKER_FALLBACK = '⚑';

const chartDebugSettings = {
    showCorrectionTarget: !!initialAppStateSnapshot.showCorrectionOverlay,
    lastCorrectionOverlay: null,
    showLightBlockingOverlay: false,
    lastLightBlockingCurve: null,
    lastOriginalOverlays: {},
    flaggedSnapshots: [],
    lastSelectionProbe: null
};

function sampleLightBlockingAtPercent(inputPercent) {
    const overlay = chartDebugSettings.lastLightBlockingCurve;
    const curve = overlay?.curve;
    if (!Array.isArray(curve) || curve.length < 2) {
        return null;
    }
    const percent = Math.max(0, Math.min(100, inputPercent));
    const normalized = percent / 100;
    const lastIndex = curve.length - 1;
    const position = normalized * lastIndex;
    const left = Math.floor(position);
    const right = Math.min(lastIndex, left + 1);
    const t = position - left;
    const leftValue = Number(curve[left]) || 0;
    const rightValue = Number(curve[right]) || leftValue;
    return leftValue + (rightValue - leftValue) * t;
}

function sampleRawLightBlockingAtPercent(inputPercent) {
    const overlay = chartDebugSettings.lastLightBlockingCurve;
    if (!overlay) return null;
    const rawCurve = overlay.rawCurve;
    if (!Array.isArray(rawCurve) || rawCurve.length < 2) {
        return null;
    }
    const percent = Math.max(0, Math.min(100, inputPercent));
    const normalized = percent / 100;
    const lastIndex = rawCurve.length - 1;
    const position = normalized * lastIndex;
    const left = Math.floor(position);
    const right = Math.min(lastIndex, left + 1);
    const t = position - left;
    const leftValue = Number(rawCurve[left]) || 0;
    const rightValue = Number(rawCurve[right]) || leftValue;
    return leftValue + (rightValue - leftValue) * t;
}

export function setChartDebugShowCorrectionTarget(enabled = true) {
    chartDebugSettings.showCorrectionTarget = !!enabled;
    updateAppState({ showCorrectionOverlay: chartDebugSettings.showCorrectionTarget });
    const toggle = elements.correctionOverlayToggle;
    if (toggle) {
        toggle.checked = chartDebugSettings.showCorrectionTarget;
        toggle.setAttribute('aria-checked', String(chartDebugSettings.showCorrectionTarget));
    }
    if (!chartDebugSettings.showCorrectionTarget) {
        chartDebugSettings.lastCorrectionOverlay = null;
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.lastCorrectionOverlay = null;
        }
    }
    if (typeof updateInkChart === 'function') {
        try {
            updateInkChart();
        } catch (err) {
            console.warn('[CHART DEBUG] Failed to refresh chart after toggling correction target debug:', err);
        }
    }
    return chartDebugSettings.showCorrectionTarget;
}

export function isChartDebugShowCorrectionTarget() {
    return !!chartDebugSettings.showCorrectionTarget;
}

export function setChartLightBlockingOverlayEnabled(enabled = true) {
    const next = coreSetLightBlockingOverlayEnabled(enabled);
    chartDebugSettings.showLightBlockingOverlay = !!next;
    const toggle = elements.lightBlockingOverlayToggle;
    if (toggle) {
        toggle.checked = chartDebugSettings.showLightBlockingOverlay;
        toggle.setAttribute('aria-checked', String(chartDebugSettings.showLightBlockingOverlay));
    }
    if (!chartDebugSettings.showLightBlockingOverlay) {
        chartDebugSettings.lastLightBlockingCurve = null;
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.lastLightBlockingCurve = null;
        }
    }
    clearLightBlockingOverlayCache();
    if (typeof updateInkChart === 'function') {
        try {
            updateInkChart();
        } catch (err) {
            console.warn('[LightBlocking] Failed to refresh chart after toggle:', err);
        }
    }
    return chartDebugSettings.showLightBlockingOverlay;
}

export function isChartLightBlockingOverlayEnabled() {
    if (!chartDebugSettings.showLightBlockingOverlay) {
        chartDebugSettings.showLightBlockingOverlay = !!coreIsLightBlockingOverlayEnabled();
    }
    return !!chartDebugSettings.showLightBlockingOverlay;
}

if (isBrowser) {
    const debugHelpers = registerDebugNamespace('chartDebug', {
        setShowCorrectionTarget: setChartDebugShowCorrectionTarget,
        isShowCorrectionTargetEnabled: isChartDebugShowCorrectionTarget,
        getLastCorrectionOverlay: () => chartDebugSettings.lastCorrectionOverlay,
        getLastOriginalOverlays: () => ({ ...chartDebugSettings.lastOriginalOverlays }),
        getFlaggedSnapshots: () => chartDebugSettings.flaggedSnapshots.slice(),
        setLightBlockingOverlayEnabled: setChartLightBlockingOverlayEnabled,
        isLightBlockingOverlayEnabled: isChartLightBlockingOverlayEnabled,
        getLastLightBlockingCurve: () => chartDebugSettings.lastLightBlockingCurve,
        getLastSelectionProbe: () => chartDebugSettings.lastSelectionProbe,
        simulateSmartPointSelection: (channel, ordinal, options = {}) => selectSmartPointOrdinal(channel, ordinal, {
            description: options?.description || `Debug select ${channel} point ${ordinal}`,
            silent: options?.silent !== undefined ? options.silent : true,
            skipHistory: true
        })
    }, {
        exposeOnWindow: true,
        windowAliases: [
            'setChartDebugShowCorrectionTarget',
            'isChartDebugShowCorrectionTarget',
            'getChartDebugFlaggedSnapshots',
            'setLightBlockingOverlayEnabled',
            'isLightBlockingOverlayEnabled'
        ]
    });
    if (debugHelpers) {
        Object.defineProperty(debugHelpers, 'lastCorrectionOverlay', {
            configurable: true,
            enumerable: true,
            get() {
                return chartDebugSettings.lastCorrectionOverlay;
            },
            set(value) {
                chartDebugSettings.lastCorrectionOverlay = value;
            }
        });
        Object.defineProperty(debugHelpers, 'lastOriginalOverlays', {
            configurable: true,
            enumerable: true,
            get() {
                return chartDebugSettings.lastOriginalOverlays;
            },
            set(value) {
                if (value && typeof value === 'object') {
                    chartDebugSettings.lastOriginalOverlays = { ...value };
                } else {
                    chartDebugSettings.lastOriginalOverlays = {};
                }
            }
        });
        Object.defineProperty(debugHelpers, 'lastLightBlockingCurve', {
            configurable: true,
            enumerable: true,
            get() {
                return chartDebugSettings.lastLightBlockingCurve;
            },
            set(value) {
                chartDebugSettings.lastLightBlockingCurve = value;
            }
        });
    }
}

let compositeDebugSelection = { index: null, percent: null };
let unsubscribeCompositeDebug = null;
let flaggedSnapshotIndicators = [];
let flaggedSnapshotSignature = '';

function cloneFlagForDebug(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    return {
        index: entry.index,
        percent: entry.percent,
        kind: entry.flag?.kind || null,
        magnitude: entry.flag?.magnitude ?? null,
        channels: Array.isArray(entry.flag?.channels) ? entry.flag.channels.slice() : []
    };
}

function updateFlaggedSnapshotIndicators(state) {
    const flags = state?.flags && typeof state.flags === 'object' ? state.flags : {};
    const snapshots = Array.isArray(state?.snapshots) ? state.snapshots : [];
    const next = [];

    Object.entries(flags).forEach(([key, info]) => {
        const index = Number.parseInt(key, 10);
        if (!Number.isInteger(index) || !info || typeof info !== 'object') {
            return;
        }
        const snapshot = snapshots[index] && snapshots[index]?.index === index
            ? snapshots[index]
            : snapshots.find((entry) => entry && entry.index === index) || null;
        const percent = Number.isFinite(info.inputPercent)
            ? info.inputPercent
            : (snapshot && Number.isFinite(snapshot.inputPercent) ? snapshot.inputPercent : null);
        if (!Number.isFinite(percent)) {
            return;
        }
        const flag = {
            kind: info.kind === 'drop' ? 'drop' : 'rise',
            magnitude: Number.isFinite(info.magnitude) ? info.magnitude : null,
            channels: Array.isArray(info.channels) ? info.channels.slice() : [],
            details: Array.isArray(info.details) ? info.details.map((detail) => ({ ...detail })) : []
        };
        next.push({ index, percent, flag });
    });

    next.sort((a, b) => a.index - b.index);
    const signature = JSON.stringify(next.map((entry) => ({
        i: entry.index,
        p: Math.round(entry.percent * 1000) / 1000,
        k: entry.flag.kind,
        m: entry.flag.magnitude != null ? Math.round(entry.flag.magnitude * 1000) / 1000 : null,
        c: entry.flag.channels
    })));
    const changed = signature !== flaggedSnapshotSignature;
    if (changed) {
        flaggedSnapshotIndicators = next;
        flaggedSnapshotSignature = signature;
        chartDebugSettings.flaggedSnapshots = next.map(cloneFlagForDebug).filter(Boolean);
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.flaggedSnapshots = chartDebugSettings.flaggedSnapshots;
        }
    }
    if (!next.length && chartDebugSettings.flaggedSnapshots.length) {
        chartDebugSettings.flaggedSnapshots = [];
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.flaggedSnapshots = [];
        }
    }
    return changed;
}

function setCompositeDebugSelectionState(state) {
    const nextPercent = Number.isFinite(state?.selection?.percent) ? state.selection.percent : null;
    const nextIndex = Number.isInteger(state?.selection?.index) ? state.selection.index : null;
    const changed = compositeDebugSelection.percent !== nextPercent || compositeDebugSelection.index !== nextIndex;
    compositeDebugSelection = { index: nextIndex, percent: nextPercent };
    const flagsChanged = updateFlaggedSnapshotIndicators(state);
    return changed || flagsChanged;
}

function initializeCompositeDebugChartSubscription() {
    if (!isBrowser) {
        return;
    }
    if (unsubscribeCompositeDebug) {
        return;
    }
    setCompositeDebugSelectionState(getCompositeDebugState());
    unsubscribeCompositeDebug = subscribeCompositeDebugState((nextState) => {
        if (setCompositeDebugSelectionState(nextState)) {
            try {
                updateInkChart();
            } catch (error) {
                console.warn('[CHART] composite debug refresh failed:', error);
            }
        }
    });
}

function getCompositeDebugMarkerPercent() {
    return Number.isFinite(compositeDebugSelection.percent) ? compositeDebugSelection.percent : null;
}

function drawFlaggedSnapshotMarkers(ctx, geom, fontScale) {
    if (!Array.isArray(flaggedSnapshotIndicators) || !flaggedSnapshotIndicators.length) {
        return;
    }
    ctx.save();
    const fontSize = Math.max(12, Math.round(14 * Math.max(1, fontScale)));
    ctx.font = `${fontSize}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ef4444';
    const markerY = Math.max(Number(geom?.padding) || 0, 0) + fontSize + 4;
    flaggedSnapshotIndicators.forEach((entry) => {
        const percent = Math.max(0, Math.min(100, Number(entry?.percent) || 0));
        const x = mapPercentToX(percent, geom);
        ctx.fillText(FLAG_MARKER_EMOJI, x, markerY);
    });
    ctx.restore();
}

function formatFlagTooltip(flag, percent, index) {
    const lines = [];
    if (Number.isInteger(index)) {
        lines.push(`Snapshot #${index}`);
    }
    if (Number.isFinite(percent)) {
        lines.push(`Input ${percent.toFixed(1)}%`);
    }
    if (flag && Array.isArray(flag.channels) && flag.channels.length) {
        if (Array.isArray(flag.details) && flag.details.length) {
            const detailParts = flag.details
                .map((detail) => {
                    if (!detail || typeof detail.channel !== 'string' || !detail.channel) {
                        return null;
                    }
                    if (Number.isFinite(detail.delta)) {
                        const deltaValue = Math.abs(detail.delta).toFixed(1);
                        const sign = detail.delta >= 0 ? '+' : '−';
                        return `${detail.channel}: ${sign}${deltaValue}%`;
                    }
                    if (Number.isFinite(detail.magnitude)) {
                        const deltaValue = Math.abs(detail.magnitude).toFixed(1);
                        const sign = detail.direction === 'drop' ? '−' : '+';
                        return `${detail.channel}: ${sign}${deltaValue}%`;
                    }
                    return detail.channel;
                })
                .filter(Boolean);
            if (detailParts.length) {
                lines.push(`Channels: ${detailParts.join(', ')}`);
            } else {
                lines.push(`Channels: ${flag.channels.join(', ')}`);
            }
        } else {
            lines.push(`Channels: ${flag.channels.join(', ')}`);
        }
    }
    if (flag && Number.isFinite(flag.threshold)) {
        lines.push(`Threshold ≥ ${flag.threshold.toFixed(1)}%`);
    }
    return lines.join('\n');
}

function updateSnapshotFlagOverlay(geom, deviceScale = 1) {
    const overlay = elements.snapshotFlagOverlay;
    const canvas = elements.inkChart;
    if (!overlay || !canvas) {
        return;
    }
    overlay.innerHTML = '';
    if (!Array.isArray(flaggedSnapshotIndicators) || !flaggedSnapshotIndicators.length) {
        overlay.classList.add('hidden');
        return;
    }
    overlay.classList.remove('hidden');
    const width = canvas.width || 1;
    const height = canvas.height || 1;
    const markerYOffset = Math.max(Number(geom?.padding) || 0, 0) + Math.max(12, 14 * Math.max(1, deviceScale)) + 4;
    flaggedSnapshotIndicators.forEach((entry) => {
        const marker = document.createElement('span');
        marker.textContent = FLAG_MARKER_EMOJI;
        marker.className = 'absolute pointer-events-auto select-none text-base font-semibold drop-shadow-sm';
        marker.style.color = '#ef4444';
        marker.style.cursor = 'help';
        marker.dataset.flaggedSnapshot = String(entry.index);
        marker.dataset.flagKind = entry.flag?.kind || 'rise';
        const percent = Math.max(0, Math.min(100, Number(entry?.percent) || 0));
        const x = mapPercentToX(percent, geom);
        const top = markerYOffset;
        marker.style.left = `${(x / width) * 100}%`;
        marker.style.top = `${(top / height) * 100}%`;
        marker.style.transform = 'translate(-50%, -60%)';
        const tooltip = formatFlagTooltip(entry.flag, percent, entry.index);
        if (tooltip) {
            marker.title = tooltip;
            marker.setAttribute('aria-label', tooltip.replace(/\n/g, ', '));
        } else {
            marker.setAttribute('aria-hidden', 'true');
        }
        overlay.appendChild(marker);
    });
}

const smartDragState = {
    geom: null,
    pointerId: null,
    active: false,
    channel: null,
    ordinal: 0,
    moved: false,
    suppressClick: false,
    hoverOrdinal: null
};

let pendingClickSelection = null;

function resetSmartDragRuntimeState() {
    smartDragState.pointerId = null;
    smartDragState.active = false;
    smartDragState.channel = null;
    smartDragState.ordinal = 0;
    smartDragState.moved = false;
    smartDragState.hoverOrdinal = null;
    pendingClickSelection = null;
}

function isSmartPointDragAvailable() {
    if (!isBrowser) return false;
    if (!isSmartPointDragEnabled()) return false;
    if (typeof globalScope.isEditModeEnabled === 'function' && !globalScope.isEditModeEnabled()) {
        return false;
    }
    return !!(globalScope.EDIT && globalScope.EDIT.selectedChannel);
}

function getSelectedChannelName() {
    return globalScope.EDIT?.selectedChannel || null;
}

function resolveChannelRow(channelName) {
    if (!elements.rows || !channelName) return null;
    const rows = Array.from(elements.rows.children).filter((row) => row.id !== 'noChannelsRow');
    return rows.find((row) => row.getAttribute('data-channel') === channelName) || null;
}

function getChannelPercentForRow(row) {
    if (!row) return 100;
    const percentInput = row.querySelector('.percent-input');
    if (!percentInput) return 100;
    const raw = percentInput.value ?? percentInput.getAttribute('data-base-percent');
    const percent = InputValidator.clampPercent(raw);
    return Number.isFinite(percent) && percent > 0 ? percent : 100;
}

function getCurveSamplesForChannel(channelName, row) {
    if (!row) return null;
    const endInput = row.querySelector('.end-input');
    const endValue = InputValidator.clampEnd(endInput?.value || endInput?.getAttribute('data-base-end') || 0);
    if (!Number.isFinite(endValue) || endValue <= 0) {
        return null;
    }
    const applyLinearization = LinearizationState.globalApplied && LinearizationState.globalData;
    const normalizeToEnd = isChannelNormalizedToEnd(channelName);
    try {
        return {
            values: make256(endValue, channelName, applyLinearization, { normalizeToEnd }),
            endValue
        };
    } catch (err) {
        console.warn('[CHART] Failed to sample curve during drag prep:', err);
        return null;
    }
}

function getPointerCanvasCoordinates(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        canvasX: (event.clientX - rect.left) * scaleX,
        canvasY: (event.clientY - rect.top) * scaleY,
        scaleX,
        scaleY
    };
}

function updateCanvasCursor(canvas, cursor) {
    if (!canvas) return;
    if (canvas.style.cursor === cursor) return;
    canvas.style.cursor = cursor || '';
}

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
    try {
        localStorage.removeItem(CHART_ZOOM_STORAGE_KEY);
    } catch (err) {
        console.warn('Could not clear chart zoom storage:', err);
    }
    setChartZoomPercent(100, { persist: false, refresh: false });
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
        localStorage.removeItem(CHART_ZOOM_STORAGE_KEY);
    } catch (err) {
        console.warn('Could not clear chart zoom storage:', err);
    }
}

/**
 * Get highest active channel percentage
 * @returns {number} Highest percentage among enabled channels
 */
function getHighestActivePercent() {
    const state = getAppState();
    const hasLoadedQuad = !!state.loadedQuadData;
    const hasLinearization = !!state.linearizationData || state.linearizationApplied === true;
    if (!hasLoadedQuad && !hasLinearization) {
        // On the default landing state we ignore any placeholder channel values so zoom
        // guards do not clamp to highlight mode.
        return 0;
    }

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

    let minIndex = CHART_ZOOM_LEVELS.findIndex((level) => level >= target);
    if (minIndex === -1) {
        minIndex = CHART_ZOOM_LEVELS.length - 1;
    }

    // Allow a single highlight inspection step even when a channel reaches 100%
    if (target >= 100 && minIndex >= CHART_ZOOM_LEVELS.length - 1) {
        minIndex = Math.max(0, minIndex - 1);
    }

    return minIndex;
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
    const minIdx = getMinimumAllowedZoomIndex();
    const proposedIdx = currentIdx + (direction >= 0 ? -1 : 1);

    if (direction >= 0 && proposedIdx < minIdx) {
        const clampLevel = CHART_ZOOM_LEVELS[minIdx] ?? CHART_ZOOM_LEVELS[CHART_ZOOM_LEVELS.length - 1];
        const highest = getHighestActivePercent();
        const highestLabel = Number.isFinite(highest) ? Math.round(highest * 10) / 10 : null;
        if (typeof setChartStatusMessage === 'function') {
            const message = highestLabel != null
                ? `Zoom stops at ${clampLevel}% — active channel peaks at ${highestLabel}%`
                : `Zoom stops at ${clampLevel}%`;
            setChartStatusMessage(message, 2600);
        }
    }

    // Invert direction: positive direction decreases index (zoom in = magnify shadows)
    return setChartZoomIndex(proposedIdx, options);
}

/**
 * Update chart zoom buttons state
 */
function updateChartZoomButtons() {
    const currentIdx = getChartZoomIndex();
    const current = getChartZoomPercent();
    const minIdx = getMinimumAllowedZoomIndex();
    const highestActive = getHighestActivePercent();
    const highestRounded = Number.isFinite(highestActive) ? Math.round(highestActive) : null;
    const highestLabel = Number.isFinite(highestActive) ? Math.round(highestActive * 10) / 10 : null;

    if (elements.chartZoomInBtn) {
        // Zoom in = decrease index (magnify shadows). Can't go below minimum index.
        const atZoomInLimit = currentIdx <= minIdx;
        elements.chartZoomInBtn.disabled = atZoomInLimit;
        elements.chartZoomInBtn.setAttribute('aria-disabled', atZoomInLimit ? 'true' : 'false');
        if (atZoomInLimit) {
            const nextLevel = CHART_ZOOM_LEVELS[Math.min(CHART_ZOOM_LEVELS.length - 1, minIdx + 1)];
            const highestTrigger = highestRounded != null && nextLevel != null && highestRounded >= nextLevel;
            const activePeak = highestLabel != null ? highestLabel : highestRounded;
            elements.chartZoomInBtn.title = highestTrigger
                ? `Zoom limited to ${CHART_ZOOM_LEVELS[minIdx]}% — active channel peaks at ${activePeak ?? 100}%`
                : 'Already at maximum zoom';
        } else {
            elements.chartZoomInBtn.title = `Zoom in from ${current}%`;
        }
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
        // Auto clamp the zoom for rendering but avoid persisting so the user's preferred
        // level (stored in localStorage) is restored once the guard relaxes.
        setChartZoomIndex(minZoomIdx, { persist: false, refresh: false });
    }

    // Create chart geometry
    const displayMax = getChartZoomPercent();
    const geom = createChartGeometry(canvas, displayMax, deviceScale);
    ensureSmartPointDragHandlers(geom);

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

    if (chartDebugSettings.showCorrectionTarget) {
        drawCorrectionTargetCurve(ctx, geom);
    }

    // Draw curves for each active channel
    renderChannelCurves(ctx, geom, colors, fontScale);

    if (chartDebugSettings.showLightBlockingOverlay) {
        try {
            const overlayResult = computeLightBlockingCurve({ resolution: 256, normalize: true, skipCache: true });
            if (overlayResult && Array.isArray(overlayResult.curve) && overlayResult.curve.length > 1) {
                drawLightBlockingOverlay(ctx, geom, overlayResult);
                chartDebugSettings.lastLightBlockingCurve = {
                    curve: overlayResult.curve.slice(),
                    maxValue: overlayResult.maxValue,
                    contributingChannels: overlayResult.contributingChannels.slice(),
                    rawCurve: Array.isArray(overlayResult.rawCurve) ? overlayResult.rawCurve.slice() : null,
                    rawMaxValue: Number.isFinite(overlayResult.rawMaxValue) ? overlayResult.rawMaxValue : null,
                    normalizedCurve: Array.isArray(overlayResult.normalizedCurve) ? overlayResult.normalizedCurve.slice() : null,
                    normalizedMaxValue: Number.isFinite(overlayResult.normalizedMaxValue) ? overlayResult.normalizedMaxValue : null
                };
                if (isBrowser && globalScope.__quadDebug?.chartDebug) {
                    globalScope.__quadDebug.chartDebug.lastLightBlockingCurve = chartDebugSettings.lastLightBlockingCurve;
                }
            }
        } catch (error) {
            console.warn('[LightBlocking] Failed to compute overlay curve:', error);
        }
    } else if (chartDebugSettings.lastLightBlockingCurve) {
        chartDebugSettings.lastLightBlockingCurve = null;
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.lastLightBlockingCurve = null;
        }
    }

    drawFlaggedSnapshotMarkers(ctx, geom, fontScale);
    updateSnapshotFlagOverlay(geom, deviceScale);

    const debugMarkerPercent = getCompositeDebugMarkerPercent();
    if (debugMarkerPercent != null) {
        const clamped = Math.max(0, Math.min(100, debugMarkerPercent));
        const markerX = mapPercentToX(clamped, geom);
        const top = geom.padding;
        const bottom = geom.height - (geom.bottomPadding || geom.padding);
        ctx.save();
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(markerX, top);
        ctx.lineTo(markerX, bottom);
        ctx.stroke();
        ctx.restore();
    }

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
    initializeCompositeDebugChartSubscription();

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

function getEffectiveGlobalInkPercent(loadedData, fallbackMax = 100) {
    if (!loadedData || typeof loadedData !== 'object') {
        return fallbackMax;
    }

    let effective = 0;
    let hasValue = false;

    if (loadedData.baselineEnd && typeof loadedData.baselineEnd === 'object') {
        Object.values(loadedData.baselineEnd).forEach((endValue) => {
            const numeric = Math.max(0, Number(endValue) || 0);
            if (numeric > 0) {
                effective += numeric;
                hasValue = true;
            }
        });
    }

    if (!hasValue && loadedData.curves && typeof loadedData.curves === 'object') {
        Object.values(loadedData.curves).forEach((curve) => {
            if (Array.isArray(curve) && curve.length) {
                const lastValue = Math.max(0, Number(curve[curve.length - 1]) || 0);
                effective += lastValue;
                hasValue = hasValue || lastValue > 0;
            }
        });
    }

    if (!hasValue || effective <= 0) {
        return fallbackMax;
    }

    const maxPercent = (effective / TOTAL) * 100;
    if (!Number.isFinite(maxPercent) || maxPercent <= 0) {
        return fallbackMax;
    }

    return Math.max(0.01, maxPercent);
}

function drawCorrectionTargetCurve(ctx, geom) {
    try {
        const globalEntry = typeof LinearizationState.getGlobalData === 'function'
            ? LinearizationState.getGlobalData()
            : LinearizationState.globalData;
        if (!globalEntry) {
            chartDebugSettings.lastCorrectionOverlay = null;
            if (isBrowser && globalScope.__quadDebug?.chartDebug) {
                globalScope.__quadDebug.chartDebug.lastCorrectionOverlay = null;
            }
            return;
        }

        const normalized = normalizeLinearizationEntry(globalEntry);
        const samples = normalized?.samples;
        if (!Array.isArray(samples) || samples.length < 2) {
            chartDebugSettings.lastCorrectionOverlay = null;
            if (isBrowser && globalScope.__quadDebug?.chartDebug) {
                globalScope.__quadDebug.chartDebug.lastCorrectionOverlay = null;
            }
            return;
        }

        const loadedData = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
        let effectiveMaxPercent = getEffectiveGlobalInkPercent(loadedData, geom.displayMax || 100);
        if (!Number.isFinite(effectiveMaxPercent) || effectiveMaxPercent <= 0) {
            effectiveMaxPercent = Math.min(geom.displayMax || 100, 100);
        } else if (geom.displayMax && effectiveMaxPercent > geom.displayMax) {
            effectiveMaxPercent = geom.displayMax;
        }

        const overlayMeta = {
            color: CORRECTION_OVERLAY_COLOR,
            samples: [],
            baseline: null,
            effectiveMaxPercent
        };

        ctx.save();
        ctx.strokeStyle = CORRECTION_OVERLAY_COLOR;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([8, 6]);

        ctx.beginPath();
        for (let i = 0; i < samples.length; i += 1) {
            const inputPercent = (i / (samples.length - 1)) * 100;
            const outputPercent = Math.max(0, Math.min(effectiveMaxPercent, samples[i] * effectiveMaxPercent));
            const x = mapPercentToX(inputPercent, geom);
            const y = mapPercentToY(outputPercent, geom);
            overlayMeta.samples.push({ input: inputPercent, output: outputPercent });
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = CORRECTION_BASELINE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        const baselinePoints = [
            { input: 0, output: 0 },
            { input: 100, output: effectiveMaxPercent }
        ];
        const startX = mapPercentToX(baselinePoints[0].input, geom);
        const startY = mapPercentToY(baselinePoints[0].output, geom);
        const endX = mapPercentToX(baselinePoints[1].input, geom);
        const endY = mapPercentToY(baselinePoints[1].output, geom);
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        overlayMeta.baseline = {
            color: CORRECTION_BASELINE_COLOR,
            points: baselinePoints
        };

        chartDebugSettings.lastCorrectionOverlay = overlayMeta;
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.lastCorrectionOverlay = overlayMeta;
        }

        ctx.restore();
    } catch (error) {
        console.warn('[CHART DEBUG] Failed to draw correction target overlay:', error);
        chartDebugSettings.lastCorrectionOverlay = null;
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            globalScope.__quadDebug.chartDebug.lastCorrectionOverlay = null;
        }
    }
}

function drawOriginalCurveOverlay(ctx, geom, colors, channelName, endValue) {
    try {
        const hasLinearization = LinearizationState.hasAnyLinearization() ||
                                LinearizationState.getPerChannelData(channelName);
        const loadedData = getLoadedQuadData();
        const baselineCurves = typeof LinearizationState?.getGlobalBaselineCurves === 'function'
            ? LinearizationState.getGlobalBaselineCurves()
            : null;
        const originalCurve = loadedData?.originalCurves?.[channelName];
        const referenceCurve = originalCurve && originalCurve.length
            ? originalCurve
            : (baselineCurves?.[channelName] || null);
        const isArrayLike = Array.isArray(referenceCurve) ||
            ArrayBuffer.isView(referenceCurve) ||
            (referenceCurve && typeof referenceCurve.length === 'number');

        if (!isArrayLike || !referenceCurve || referenceCurve.length === 0) {
            if (chartDebugSettings.lastOriginalOverlays[channelName]) {
                delete chartDebugSettings.lastOriginalOverlays[channelName];
                if (isBrowser && globalScope.__quadDebug?.chartDebug?.lastOriginalOverlays) {
                    delete globalScope.__quadDebug.chartDebug.lastOriginalOverlays[channelName];
                }
            }
            return;
        }

        const showOverlay = hasLinearization || !!loadedData;
        if (!showOverlay) {
            if (chartDebugSettings.lastOriginalOverlays[channelName]) {
                delete chartDebugSettings.lastOriginalOverlays[channelName];
                if (isBrowser && globalScope.__quadDebug?.chartDebug?.lastOriginalOverlays) {
                    delete globalScope.__quadDebug.chartDebug.lastOriginalOverlays[channelName];
                }
            }
            return;
        }

        const overlayMeta = {
            channelName,
            color: ORIGINAL_CURVE_OVERLAY_COLOR,
            samples: [],
            percentSamples: []
        };

        ctx.save();
        ctx.strokeStyle = ORIGINAL_CURVE_OVERLAY_COLOR;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.75;
        ctx.setLineDash([4, 2]);

        ctx.beginPath();
        const lastIndex = Math.max(1, referenceCurve.length - 1);
        for (let i = 0; i < referenceCurve.length; i++) {
            const inputPercent = (i / lastIndex) * 100;
            const rawSample = Number(referenceCurve[i]) || 0;
            const rawValue = Math.max(0, Math.min(TOTAL, Math.round(rawSample)));
            overlayMeta.samples.push(rawValue);
            const valuePercent = (rawValue / TOTAL) * 100;
            overlayMeta.percentSamples.push(valuePercent);
            const chartPercent = Math.max(0, Math.min(geom.displayMax, valuePercent));
            const x = mapPercentToX(inputPercent, geom);
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

        chartDebugSettings.lastOriginalOverlays[channelName] = overlayMeta;
        if (isBrowser && globalScope.__quadDebug?.chartDebug) {
            const debugOverlays = globalScope.__quadDebug.chartDebug.lastOriginalOverlays ||
                (globalScope.__quadDebug.chartDebug.lastOriginalOverlays = {});
            debugOverlays[channelName] = overlayMeta;
        }
    } catch (error) {
        console.warn(`Error drawing original overlay for ${channelName}:`, error);
        if (chartDebugSettings.lastOriginalOverlays[channelName]) {
            delete chartDebugSettings.lastOriginalOverlays[channelName];
            if (isBrowser && globalScope.__quadDebug?.chartDebug?.lastOriginalOverlays) {
                delete globalScope.__quadDebug.chartDebug.lastOriginalOverlays[channelName];
            }
        }
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

        const dragActive = typeof isSmartPointDragActive === 'function' && isSmartPointDragActive();

        for (const row of channels) {
            const channelName = row.getAttribute('data-channel');
            if (!channelName) continue;

            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (!percentInput || !endInput) continue;

            const basePercent = InputValidator.clampPercent(percentInput.getAttribute('data-base-percent') ?? percentInput.value);
            const baseEndValue = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);

            if (basePercent === 0 || baseEndValue === 0) {
                const percentHold = percentInput.dataset.userEditing === 'true' || percentInput.dataset.pendingCommitValue != null;
                const endHold = endInput.dataset.userEditing === 'true' || endInput.dataset.pendingCommitValue != null;
                if (!percentHold) {
                percentInput.value = formatPercentDisplay(basePercent);
                }
                if (!endHold) {
                    endInput.value = String(baseEndValue);
                }
                continue;
            }

            const applyLinearization = LinearizationState.globalApplied && LinearizationState.globalData;
            const normalizeToEnd = isChannelNormalizedToEnd(channelName);
            const curveValues = make256(baseEndValue, channelName, applyLinearization, { normalizeToEnd });

            // Draw reference line (target intent curve) if linearization is active
            drawReferenceIntentCurve(ctx, geom, colors, channelName, baseEndValue);

            // Convert curve to chart coordinates and draw
            const curveMeta = drawChannelCurve(ctx, geom, colors, channelName, curveValues, baseEndValue);

            // Draw original loaded curve overlay (dashed) above the channel curve for visibility
            drawOriginalCurveOverlay(ctx, geom, colors, channelName, baseEndValue);
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

            const effectiveEnd = InputValidator.clampEnd(baseEndValue);
            const percentToDisplay = InputValidator.computePercentFromEnd(effectiveEnd);
            const effectivePercent = percentToDisplay;
            const endToDisplay = normalizeToEnd ? effectiveEnd : baseEndValue;
            const endY = mapPercentToY(Math.max(0, Math.min(100, effectivePercent)), geom);

            const percentHold = percentInput.dataset.userEditing === 'true' || percentInput.dataset.pendingCommitValue != null;
            const endHold = endInput.dataset.userEditing === 'true' || endInput.dataset.pendingCommitValue != null;

            const allowBaselineMutation = !dragActive;

            if (!percentHold && allowBaselineMutation) {
                percentInput.value = formatPercentDisplay(percentToDisplay);
            }
            if (allowBaselineMutation) {
                percentInput.setAttribute('data-base-percent', String(percentToDisplay));
            }

            if (!endHold && allowBaselineMutation) {
                endInput.value = String(endToDisplay);
            }
            if (allowBaselineMutation) {
                endInput.setAttribute('data-base-end', String(endToDisplay));
            }

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

function drawPeakMarker(ctx, geom, color, inputPercent, outputPercent) {
    const x = mapPercentToX(inputPercent, geom);
    const y = mapPercentToY(outputPercent, geom);
    const size = Math.max(6, Math.min(12, geom.chartHeight * 0.035));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.75, y - size * 0.2);
    ctx.lineTo(x + size * 0.75, y - size * 0.2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
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

        let peakIndex = -1;
        let peakValue = -Infinity;
        const lastIndex = Math.max(1, curveValues.length - 1);

        for (let i = 0; i < curveValues.length; i++) {
            const rawValue = Number(curveValues[i]) || 0;
            if (rawValue > peakValue) {
                peakValue = rawValue;
                peakIndex = i;
            }

            const inputPercent = (i / lastIndex) * 100;
            const outputPercent = (rawValue / TOTAL) * 100;

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

        if (peakIndex >= 0 && peakValue > 0) {
            const inputPercent = (peakIndex / lastIndex) * 100;
            const outputPercent = (peakValue / TOTAL) * 100;
            drawPeakMarker(ctx, geom, channelColor, inputPercent, outputPercent);

            const loadedData = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
            if (loadedData) {
                if (!loadedData.channelPeaks || typeof loadedData.channelPeaks !== 'object') {
                    loadedData.channelPeaks = {};
                }
                loadedData.channelPeaks[channelName] = peakIndex;
            }
        } else {
            const loadedData = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
            if (loadedData?.channelPeaks && channelName in loadedData.channelPeaks) {
                delete loadedData.channelPeaks[channelName];
            }
        }

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
                    const isDraggingThisChannel = smartDragState.active && smartDragState.channel === channelName;
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
                            boxSize: isDraggingThisChannel ? 9 : 6
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

function drawLightBlockingOverlay(ctx, geom, overlay) {
    const curve = Array.isArray(overlay?.curve) ? overlay.curve : overlay?.normalizedCurve;
    if (!Array.isArray(curve) || curve.length < 2) {
        return;
    }
    const lastIndex = curve.length - 1;
    const displayMax = Number.isFinite(geom?.displayMax) && geom.displayMax > 0 ? geom.displayMax : 100;
    ctx.save();
    ctx.strokeStyle = LIGHT_BLOCKING_OVERLAY_COLOR;
    ctx.lineWidth = Math.max(2, Math.min(4, geom.chartHeight * 0.005));
    ctx.beginPath();
    for (let i = 0; i < curve.length; i += 1) {
        const inputPercent = lastIndex === 0 ? 0 : (i / lastIndex) * 100;
        const normalizedValue = Number(curve[i]) || 0;
        const outputPercent = Math.max(0, Math.min(displayMax, (normalizedValue / 100) * displayMax));
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

    drawLightBlockingReference(ctx, geom);
    drawLightBlockingLabel(ctx, geom, overlay);
}

const LIGHT_BLOCKING_REFERENCE_K = 4.2;
const LIGHT_BLOCKING_REFERENCE_RESOLUTION = 256;

function drawLightBlockingReference(ctx, geom) {
    const displayMax = Number.isFinite(geom?.displayMax) && geom.displayMax > 0 ? geom.displayMax : 100;
    // Saturation occurs when -ln(1 - x) == LIGHT_BLOCKING_REFERENCE_K
    // We remap input so the reference reaches (100, 100) instead of flattening early.
    const saturationPoint = 1 - Math.exp(-LIGHT_BLOCKING_REFERENCE_K);
    ctx.save();
    ctx.strokeStyle = LIGHT_BLOCKING_REFERENCE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < LIGHT_BLOCKING_REFERENCE_RESOLUTION; i += 1) {
        const inputFraction = i / (LIGHT_BLOCKING_REFERENCE_RESOLUTION - 1);
        const remappedFraction = Math.max(0, Math.min(saturationPoint, inputFraction * saturationPoint));
        const safeDelta = Math.max(Number.EPSILON, 1 - remappedFraction);
        let normalizedCorrection = 0;
        if (remappedFraction > 0) {
            normalizedCorrection = Math.max(0, Math.min(1, -Math.log(safeDelta) / LIGHT_BLOCKING_REFERENCE_K));
        }
        const scaledOutput = normalizedCorrection * displayMax;
        const x = mapPercentToX(inputFraction * 100, geom);
        const y = mapPercentToY(scaledOutput, geom);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.lineTo(mapPercentToX(100, geom), mapPercentToY(displayMax, geom));
    ctx.stroke();
    ctx.restore();
}

function drawLightBlockingLabel(ctx, geom, overlay) {
    const normalizedMax = Number.isFinite(overlay?.maxValue) ? overlay.maxValue : Number.isFinite(overlay?.normalizedMaxValue) ? overlay.normalizedMaxValue : 0;
    const rawMax = Number.isFinite(overlay?.rawMaxValue) ? overlay.rawMaxValue : null;
    let label = `Light Block ${normalizedMax.toFixed(1)}%`;
    if (rawMax != null && Math.abs(rawMax - normalizedMax) > 0.05) {
        label += ` (raw ${rawMax.toFixed(1)}%)`;
    }
    ctx.save();
    const fontSize = Math.max(11, Math.min(16, geom.chartHeight * 0.05));
    ctx.font = `600 ${fontSize}px system-ui`;
    ctx.fillStyle = LIGHT_BLOCKING_LABEL_COLOR;
    ctx.textBaseline = 'top';
    const textWidth = ctx.measureText(label).width;
    const rightLimit = geom.leftPadding + geom.chartWidth - 12;
    const left = Math.max(geom.leftPadding + 12, rightLimit - textWidth);
    const displayMax = Number.isFinite(geom?.displayMax) && geom.displayMax > 0 ? geom.displayMax : 100;
    const clampedMax = Math.max(0, Math.min(100, normalizedMax));
    const scaledPercent = (clampedMax / 100) * displayMax;
    const targetY = mapPercentToY(scaledPercent, geom) - fontSize - 8;
    const minY = geom.padding + 8;
    const finalY = Math.max(minY, targetY);
    ctx.fillText(label, left, finalY);
    if (Array.isArray(overlay?.contributingChannels) && overlay.contributingChannels.length) {
        const contributors = overlay.contributingChannels.join(', ');
        const secondaryLabel = `Channels: ${contributors}`;
        const secondaryFont = Math.max(9, Math.min(14, fontSize - 2));
        ctx.font = `500 ${secondaryFont}px system-ui`;
        ctx.fillText(secondaryLabel, left, finalY + fontSize + 2);
    }
    ctx.restore();
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
            if (smartDragState.active) {
                return;
            }
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
                        const locked = isChannelLocked(selCh);
                        const endVal = InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0);
                        if (!locked && endVal > 0) {
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
            const tooltipLines = [`${xPct.toFixed(1)}, ${yPct.toFixed(1)}`];
            if (chartDebugSettings.showLightBlockingOverlay && chartDebugSettings.lastLightBlockingCurve) {
                const lightBlockingValue = sampleLightBlockingAtPercent(xPct);
                if (Number.isFinite(lightBlockingValue)) {
                    let tooltipLabel = `Light Block: ${lightBlockingValue.toFixed(1)}%`;
                    const rawValue = sampleRawLightBlockingAtPercent(xPct);
                    if (Number.isFinite(rawValue) && rawValue > 0) {
                        tooltipLabel += ` (raw ${rawValue.toFixed(1)}%)`;
                    }
                    tooltipLines.push(tooltipLabel);
                }
            }
            if (canInsert) {
                tooltipLines.push('click to add point');
            }
            tip.innerHTML = tooltipLines.join('<br>');
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
            chartDebugSettings.lastSelectionProbe = {
                reason: 'start'
            };
            if (typeof console !== 'undefined') {
                console.log('[CHART] canvas click detected');
            }
            if (smartDragState.suppressClick) {
                smartDragState.suppressClick = false;
                chartDebugSettings.lastSelectionProbe = {
                    reason: 'suppressed'
                };
                return;
            }
            try {
                const isEditMode = typeof globalScope.isEditModeEnabled === 'function' && globalScope.isEditModeEnabled();
                if (!isEditMode || !globalScope.quadGenActions || !globalScope.EDIT || !globalScope.EDIT.selectedChannel) {
                    chartDebugSettings.lastSelectionProbe = {
                        reason: 'editModeUnavailable',
                        isEditMode,
                        hasActions: !!globalScope.quadGenActions,
                        hasEditState: !!globalScope.EDIT
                    };
                    return;
                }

                const selCh = globalScope.EDIT.selectedChannel;
                const row = Array.from(elements.rows.children).find((tr) => tr.getAttribute('data-channel') === selCh);
                if (!row) {
                    chartDebugSettings.lastSelectionProbe = {
                        reason: 'rowMissing',
                        channel: selCh
                    };
                    return;
                }

                const samples = getCurveSamplesForChannel(selCh, row);
                const values = samples?.values || null;
                const endVal = samples?.endValue ?? 0;

                const points = globalScope.ControlPoints?.get(selCh)?.points || [];
                const geomRef = smartDragState.geom;
                let handled = false;

                if (geomRef && points.length > 0 && values) {
                    const coords = getPointerCanvasCoordinates(e, canvas);
                    const tolerancePx = SMART_POINT_DRAG_TOLERANCE_PX * (Number(geomRef?.dpr) || 1);
                    const hit = resolveSmartPointClickSelection({
                        canvasX: coords.canvasX,
                        canvasY: coords.canvasY,
                        points,
                        geom: geomRef,
                        tolerance: tolerancePx,
                        values,
                        maxValue: TOTAL
                    });

                    chartDebugSettings.lastSelectionProbe = {
                        channel: selCh,
                        coords,
                        tolerance: tolerancePx,
                        geomAvailable: !!geomRef,
                        pointsCount: points.length,
                        valuesAvailable: !!values,
                        hit
                    };

                    if (hit && Number.isInteger(hit.ordinal)) {
                        const result = selectSmartPointOrdinal(selCh, hit.ordinal, {
                            description: `Select ${selCh} Smart point ${hit.ordinal} (chart click)`
                        });
                        if (result?.success) {
                            handled = true;
                        }
                    }
                } else {
                    chartDebugSettings.lastSelectionProbe = {
                        channel: selCh,
                        geomAvailable: !!geomRef,
                        pointsCount: points.length,
                        valuesAvailable: !!values,
                        hit: null
                    };
                }

                if (handled) {
                    e.preventDefault();
                    return;
                }

                if (isChannelLocked(selCh)) {
                    showStatus(getChannelLockEditMessage(selCh, 'inserting points'));
                    chartDebugSettings.lastSelectionProbe = {
                        reason: 'channelLocked',
                        channel: selCh
                    };
                    return;
                }

                if (!values || !Number.isFinite(endVal) || endVal <= 0) {
                    chartDebugSettings.lastSelectionProbe = {
                        reason: 'invalidSamples',
                        channel: selCh,
                        valuesAvailable: !!values,
                        endValue: endVal
                    };
                    return;
                }

                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const cx = (e.clientX - rect.left) * scaleX;
                const cy = (e.clientY - rect.top) * scaleY;

                const { leftPadding, chartWidth } = CHART_CURSOR_MAP;
                let xPct = ((cx - leftPadding) / chartWidth) * 100;
                xPct = Math.max(0, Math.min(100, xPct));

                const t = Math.max(0, Math.min(1, (xPct / 100))) * (values.length - 1);
                const i0 = Math.floor(t);
                const i1 = Math.min(values.length - 1, i0 + 1);
                const a = t - i0;
                const v = (1 - a) * values[i0] + (a * values[i1]);
                let yPct = Math.max(0, Math.min(100, (v / TOTAL) * 100));

                const res = globalScope.quadGenActions.insertSmartKeyPointAt(selCh, xPct, yPct);
                if (res && res.success) {
                    console.log('Point inserted successfully at', xPct.toFixed(1), ',', yPct.toFixed(1));

                    try {
                        const kp = globalScope.ControlPoints?.get(selCh)?.points || [];
                        if (kp.length > 0 && globalScope.ControlPoints?.nearestIndex) {
                            const nearest = globalScope.ControlPoints.nearestIndex(kp, xPct, 100);
                            if (nearest && typeof nearest.index === 'number' && nearest.index >= 0) {
                                if (globalScope.EDIT) {
                                    globalScope.EDIT.selectedOrdinal = nearest.index + 1;
                                    console.log('Selected newly inserted point:', globalScope.EDIT.selectedOrdinal);

                                    if (typeof globalScope.edit_refreshPointIndex === 'function') {
                                        globalScope.edit_refreshPointIndex();
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to update point selection:', err);
                    }

                    try {
                        triggerPreviewUpdate();
                    } catch (err) {
                        console.warn('Failed to update preview after point insertion:', err);
                    }
                } else if (res && !res.success && res.message) {
                    showStatus(res.message);
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

function ensureSmartPointDragHandlers(geom) {
    const canvas = elements.inkChart;
    if (!canvas) return;
    if (geom) {
        smartDragState.geom = geom;
    }

    if (canvas._smartPointDragBound) {
        return;
    }

    const OFF_CANVAS_CANCEL_BUFFER = 64;

    const handlePointerDown = (event) => {
        if (event.button !== 0) return;

        pendingClickSelection = null;

        const channelName = getSelectedChannelName();
        if (!channelName) return;

        const geomRef = smartDragState.geom;
        if (!geomRef) {
            chartDebugSettings.lastSelectionProbe = {
                reason: 'geomMissing'
            };
            return;
        }

        const row = resolveChannelRow(channelName);
        const samples = getCurveSamplesForChannel(channelName, row);
        const values = samples?.values;
        if (!values || !Array.isArray(values)) {
            chartDebugSettings.lastSelectionProbe = {
                reason: 'noSamples',
                channel: channelName
            };
            return;
        }

        const entry = ControlPoints.get(channelName);
        const points = entry?.points || [];
        if (points.length === 0) {
            chartDebugSettings.lastSelectionProbe = {
                reason: 'noPoints',
                channel: channelName
            };
            return;
        }

        const coords = getPointerCanvasCoordinates(event, canvas);
        const tolerance = SMART_POINT_DRAG_TOLERANCE_PX * (geomRef?.dpr || 1);
        const hit = hitTestSmartPoint(coords.canvasX, coords.canvasY, {
            points,
            geom: geomRef,
            tolerance,
            values,
            maxValue: TOTAL
        });

        if (!hit) {
            chartDebugSettings.lastSelectionProbe = {
                reason: 'noHit',
                channel: channelName
            };
            return;
        }

        const locked = isChannelLocked(channelName);
        const dragAvailable = isSmartPointDragAvailable();

        pendingClickSelection = {
            channel: channelName,
            ordinal: hit.ordinal,
            pointerId: event.pointerId
        };

        chartDebugSettings.lastSelectionProbe = {
            reason: 'pointerDownHit',
            channel: channelName,
            ordinal: hit.ordinal,
            dragAvailable,
            locked
        };

        if (locked) {
            showStatus(`${channelName} ink limit is locked. Unlock before adjusting points.`);
            updateCanvasCursor(canvas, '');
            return;
        }

        if (!dragAvailable) {
            return;
        }

        const began = beginSmartPointDrag(channelName, hit.ordinal);
        if (!began.success) {
            return;
        }

        smartDragState.pointerId = event.pointerId;
        smartDragState.active = true;
        smartDragState.channel = channelName;
        smartDragState.ordinal = hit.ordinal;
        smartDragState.moved = false;

        if (elements.chartCursorTooltip) {
            elements.chartCursorTooltip.classList.add('hidden');
        }

        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (captureError) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[CHART] Pointer capture failed:', captureError);
            }
        }

        updateCanvasCursor(canvas, 'grabbing');
        showStatus(`Dragging ${channelName} point ${hit.ordinal}`);
        event.preventDefault();
    };

    const handlePointerMove = (event) => {
        if (!smartDragState.geom) {
            return;
        }
        const geomRef = smartDragState.geom;
        const coords = getPointerCanvasCoordinates(event, canvas);

        if (smartDragState.active && smartDragState.pointerId === event.pointerId) {
            const rect = canvas.getBoundingClientRect();
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[CHART] Pointer move', {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    rect
                });
            }
            const outside =
                event.clientX < rect.left - OFF_CANVAS_CANCEL_BUFFER ||
                event.clientX > rect.right + OFF_CANVAS_CANCEL_BUFFER ||
                event.clientY < rect.top - OFF_CANVAS_CANCEL_BUFFER ||
                event.clientY > rect.bottom + OFF_CANVAS_CANCEL_BUFFER;

            if (outside) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[CHART] Cancelling drag: pointer outside', {
                        clientX: event.clientX,
                        clientY: event.clientY,
                        rect
                    });
                }
                const pointerId = smartDragState.pointerId;
                if (pointerId != null) {
                    try {
                        canvas.releasePointerCapture(pointerId);
                    } catch (releaseError) {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.warn('[CHART] Pointer release during cancel failed:', releaseError);
                        }
                    }
                }
                finalizeDrag(false);
                updateCanvasCursor(canvas, '');
                return;
            }

            const channelName = smartDragState.channel;
            if (isChannelLocked(channelName)) {
                return;
            }
            const row = resolveChannelRow(channelName);
            const samples = getCurveSamplesForChannel(channelName, row);
            if (!samples || !Array.isArray(samples.values)) {
                return;
            }
            const entry = ControlPoints.get(channelName);
            const points = entry?.points || [];
            if (points.length === 0) {
                return;
            }

            const rawInput = mapXToPercent(coords.canvasX, geomRef);
            const rawOutput = mapYToPercent(coords.canvasY, geomRef);
            const clamped = clampSmartPointCoordinates(rawInput, rawOutput, {
                points,
                ordinal: smartDragState.ordinal,
                geom: geomRef
            });
            const displayMax = normalizeDisplayMax(geomRef);
            const desiredAbsolute = normalizeDragOutputToAbsolute(clamped.outputPercent, displayMax);

            const updateResult = updateSmartPointDrag(channelName, smartDragState.ordinal, {
                inputPercent: clamped.inputPercent,
                outputPercent: desiredAbsolute
            });

            if (updateResult?.success) {
                smartDragState.moved = true;
                pendingClickSelection = null;
            }
            return;
        }

        if (!isSmartPointDragAvailable()) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
            return;
        }

        const channelName = getSelectedChannelName();
        if (!channelName) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
            return;
        }

        if (isChannelLocked(channelName)) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
            return;
        }

        const row = resolveChannelRow(channelName);
        const samples = getCurveSamplesForChannel(channelName, row);
        if (!samples || !Array.isArray(samples.values)) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
            return;
        }

        const entry = ControlPoints.get(channelName);
        const points = entry?.points || [];
        if (points.length === 0) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
            return;
        }

        const tolerance = SMART_POINT_DRAG_TOLERANCE_PX * (geomRef?.dpr || 1);
        const hit = hitTestSmartPoint(coords.canvasX, coords.canvasY, {
            points,
            geom: geomRef,
            tolerance,
            values: samples.values,
            maxValue: TOTAL
        });

        if (hit) {
            updateCanvasCursor(canvas, 'grab');
            smartDragState.hoverOrdinal = hit.ordinal;
        } else if (smartDragState.hoverOrdinal !== null) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
        }
    };

    function finalizeDrag(commit) {
        if (!smartDragState.active) return;
        const channelName = smartDragState.channel;
        const ordinal = smartDragState.ordinal;
        let statusPosted = false;
        if (commit) {
            const result = endSmartPointDrag();
            if (result?.success) {
                const entry = ControlPoints.get(channelName);
                const points = entry?.points || [];
                const point = points[ordinal - 1];
                if (point) {
                    statusPosted = true;
                    const inputLabel = (point.input ?? 0).toFixed(1);
                    const row = resolveChannelRow(channelName);
                    const channelPercent = getChannelPercentForRow(row);
                    const absolute = ((point.output ?? 0) * (channelPercent / 100)).toFixed(1);
                    showStatus(`Point ${ordinal} set to ${inputLabel}% / ${absolute}% ink`);
                }
            }
            smartDragState.suppressClick = true;
        } else {
            cancelSmartPointDrag();
            smartDragState.suppressClick = false;
            if (smartDragState.moved) {
                showStatus('Drag cancelled');
            }
        }
        if (!statusPosted && commit) {
            showStatus(`Point ${ordinal} updated`);
        }
        resetSmartDragRuntimeState();
    }

    const handlePointerUp = (event) => {
        if (smartDragState.active && smartDragState.pointerId === event.pointerId) {
            try {
                canvas.releasePointerCapture(event.pointerId);
            } catch (releaseError) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[CHART] Pointer release failed:', releaseError);
                }
            }
            const commit = smartDragState.moved;
            if (!commit && smartDragState.channel && Number.isFinite(smartDragState.ordinal)) {
                selectSmartPointOrdinal(smartDragState.channel, smartDragState.ordinal, {
                    description: `Select ${smartDragState.channel} Smart point ${smartDragState.ordinal} (pointer tap)`
                });
                chartDebugSettings.lastSelectionProbe = {
                    reason: 'pointerTap',
                    channel: smartDragState.channel,
                    ordinal: smartDragState.ordinal,
                    pointerId: event.pointerId
                };
            }
            finalizeDrag(commit);
            pendingClickSelection = null;
            updateCanvasCursor(canvas, '');
            return;
        }

        if (pendingClickSelection && pendingClickSelection.pointerId === event.pointerId) {
            const { channel, ordinal } = pendingClickSelection;
            if (channel && Number.isFinite(ordinal)) {
                selectSmartPointOrdinal(channel, ordinal, {
                    description: `Select ${channel} Smart point ${ordinal} (pointer click)`
                });
                chartDebugSettings.lastSelectionProbe = {
                    reason: 'pointerClick',
                    channel,
                    ordinal,
                    pointerId: event.pointerId
                };
            }
            pendingClickSelection = null;
            updateCanvasCursor(canvas, '');
        }
    };

    const handlePointerLeave = (event) => {
        if (smartDragState.active) {
            const pointerId = smartDragState.pointerId;
            if (pointerId != null) {
                try {
                    canvas.releasePointerCapture(pointerId);
                } catch (releaseError) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.warn('[CHART] Pointer release on leave failed:', releaseError);
                    }
                }
            }
            finalizeDrag(false);
            updateCanvasCursor(canvas, '');
            pendingClickSelection = null;
            return;
        }
        if (smartDragState.hoverOrdinal !== null) {
            updateCanvasCursor(canvas, '');
            smartDragState.hoverOrdinal = null;
        }
        pendingClickSelection = null;
    };

    const handlePointerCancel = (event) => {
        if (!smartDragState.active || smartDragState.pointerId !== event.pointerId) {
            return;
        }
        cancelSmartPointDrag();
        resetSmartDragRuntimeState();
        smartDragState.suppressClick = false;
        updateCanvasCursor(canvas, '');
        pendingClickSelection = null;
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('lostpointercapture', handlePointerCancel);
    canvas._smartPointDragBound = true;
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
