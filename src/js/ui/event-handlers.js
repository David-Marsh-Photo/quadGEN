// quadGEN UI Event Handlers
// Centralized event handler management for UI interactions

import { elements, getCurrentPrinter, setLoadedQuadData, getLoadedQuadData, ensureLoadedQuadData, getAppState, updateAppState, TOTAL, getPlotSmoothingPercent, setPlotSmoothingPercent, getCorrectionGain, getReferenceQuadData, setReferenceQuadData, clearReferenceQuadData, isReferenceQuadLoaded } from '../core/state.js';
import { getStateManager } from '../core/state-manager.js';
import { ensureChannelLock, setChannelLock, isChannelLocked, updateChannelLockBounds, subscribeToChannelLock, clampAbsoluteToChannelLock, getChannelLockInfo, getLockedChannels, getGlobalScaleLockMessage } from '../core/channel-locks.js';
import { sanitizeFilename, debounce, formatScalePercent } from './ui-utils.js';
import { generateFilename, downloadFile, readFileAsText } from '../files/file-operations.js';
import { loadReferenceQuadFile } from '../files/reference-quad-loader.js';
import { InputValidator } from '../core/validation.js';
import { parseQuadFile, parseLinearizationFile } from '../parsers/file-parsers.js';
import {
    updateInkChart,
    stepChartZoom,
    setChartDebugShowCorrectionTarget,
    isChartDebugShowCorrectionTarget,
    setLabSpotMarkerOverlayEnabled,
    isLabSpotMarkerOverlayEnabled,
    syncLabSpotMarkerToggleAvailability,
    setChartLightBlockingOverlayEnabled,
    isChartLightBlockingOverlayEnabled,
    setChartInkLoadOverlayEnabled,
    isChartInkLoadOverlayEnabled,
    applyCorrectionGainPercent
} from './chart-manager.js';
import { setInkLoadThreshold, getInkLoadThreshold } from '../core/ink-load.js';
import { getCurrentScale, reapplyCurrentGlobalScale, updateScaleBaselineForChannel as updateScaleBaselineForChannelCore, validateScalingStateSync } from '../core/scaling-utils.js';
import { SCALING_STATE_FLAG_EVENT } from '../core/scaling-constants.js';
import scalingCoordinator from '../core/scaling-coordinator.js';
import { updateCompactChannelsList, updateChannelCompactState, updateNoChannelsMessage } from './compact-channels.js';
import { registerChannelRow, getChannelRow } from './channel-registry.js';
import { updateProcessingDetail, updateSessionStatus } from './graph-status.js';
import { LinearizationState, normalizeLinearizationEntry, getEditedDisplayName, getBasePointCountLabel } from '../data/linearization-utils.js';
import { maybeAutoRaiseInkLimits } from '../core/auto-raise-on-import.js';
import { ControlPoints, extractAdaptiveKeyPointsFromValues, KP_SIMPLIFY, isSmartCurve, isSmartCurveSourceTag, rescaleSmartCurveForInkLimit, refreshPlotSmoothingSnapshotsForSmartEdit } from '../curves/smart-curves.js';
import { isEditModeEnabled, setEditMode, populateChannelDropdown, refreshSmartCurvesFromMeasurements, reinitializeChannelSmartCurves, persistSmartPoints, setGlobalBakedState, isSmartPointDragActive } from './edit-mode.js';
import { getTargetRelAt } from '../data/lab-parser.js';
import { postLinearizationSummary } from './labtech-summaries.js';
import { updatePreview } from './quad-preview.js';
import { getPreset, canApplyIntentRemap, updateIntentDropdownState } from './intent-system.js';
import { getHistoryManager } from '../core/history-manager.js';
import { clamp01, createPCHIPSpline } from '../math/interpolation.js';
import {
    updateRevertButtonsState,
    computeGlobalRevertState,
    resetSmartPointsForChannels,
    resetChannelSmartPointsToMeasurement
} from './revert-controls.js';
import { showStatus } from './status-service.js';
import { initializeHelpSystem } from './help-system.js';
import { setPrinter, registerChannelRowSetup, syncPrinterForQuadData } from './printer-manager.js';
import { make256, beginCompositeLabRedistribution, finalizeCompositeLabRedistribution, replayCompositeDebugSessionFromCache, getCompositeCoverageSummary } from '../core/processing-pipeline.js';
import {
    getLabNormalizationMode,
    setLabNormalizationMode,
    isDensityNormalizationEnabled,
    subscribeLabNormalizationMode,
    LAB_NORMALIZATION_MODES,
    getLabSmoothingPercent,
    setLabSmoothingPercent,
    subscribeLabSmoothingPercent,
    mapSmoothingPercentToWiden
} from '../core/lab-settings.js';
import { rebuildLabSamplesFromOriginal } from '../data/lab-parser.js';
import { isLabLinearizationData } from '../data/lab-legacy-bypass.js';
import { isSmartPointDragEnabled, setSmartPointDragEnabled, isRedistributionSmoothingWindowEnabled, setRedistributionSmoothingWindowEnabled, isAutoRaiseInkLimitsEnabled, setAutoRaiseInkLimitsEnabled } from '../core/feature-flags.js';
import {
    setCompositeWeightingMode,
    getCompositeWeightingMode,
    subscribeCompositeWeightingMode,
    COMPOSITE_WEIGHTING_MODES
} from '../core/composite-settings.js';
import { setCompositeDebugEnabled, isCompositeDebugEnabled, subscribeCompositeDebugState } from '../core/composite-debug.js';
import {
    setManualChannelDensity,
   setSolverChannelDensity,
   getResolvedChannelDensity as getResolvedDensity,
   subscribeChannelDensities,
   formatDensityValue as formatDensityInput,
   clearChannelDensity,
   getDensityOverridesSnapshot,
   isAutoDensityComputeEnabled,
   DEFAULT_CHANNEL_DENSITIES
} from '../core/channel-densities.js';
import { CORRECTION_METHODS, getCorrectionMethod, setCorrectionMethod, subscribeCorrectionMethod } from '../core/correction-method.js';
import { runSimpleScalingCorrection } from '../core/simple-scaling/index.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

function getCompositeAuditConfig() {
    const auditConfig = globalScope && typeof globalScope === 'object' ? globalScope.__COMPOSITE_AUDIT__ : null;
    if (!auditConfig || auditConfig.enabled === false) {
        return null;
    }
    const index = Number.isFinite(auditConfig.sampleIndex) ? Math.max(0, Math.floor(auditConfig.sampleIndex)) : 242;
    if (!Array.isArray(auditConfig.events)) {
        auditConfig.events = [];
    }

    const log = typeof auditConfig.log === 'function'
        ? auditConfig.log
        : (stage, payload) => {
            try {
                console.log('[COMPOSITE_AUDIT]', stage, payload);
            } catch (err) {
                // ignore logging failure
            }
        };
    return { index, log, events: auditConfig.events };
}

function emitCompositeAudit(stage, payloadFactory) {
    try {
        const config = getCompositeAuditConfig();
        if (!config) return;
        const payload = typeof payloadFactory === 'function' ? payloadFactory(config.index) : payloadFactory;
        if (payload === null || payload === undefined) {
            return;
        }
        config.log(stage, payload);
        if (Array.isArray(config.events)) {
            config.events.push({
                stage,
                payload,
                ts: Date.now()
            });
        }
    } catch (err) {
        console.warn('[COMPOSITE_AUDIT] ui emit failed:', err);
    }
}

function cloneBaselineCurvesFromLoadedData(loadedData) {
    if (!loadedData || typeof loadedData !== 'object') {
        return null;
    }

    const tryClone = (map) => {
        if (!map || typeof map !== 'object') {
            return null;
        }
        const clone = {};
        let hasAny = false;
        Object.entries(map).forEach(([channelName, curve]) => {
            if (Array.isArray(curve)) {
                clone[channelName] = curve.slice();
                hasAny = true;
            }
        });
        return hasAny ? clone : null;
    };

    return tryClone(loadedData.plotBaseCurvesBaseline)
        || tryClone(loadedData._plotSmoothingOriginalCurves)
        || tryClone(loadedData.plotBaseCurves)
        || null;
}

function ensureBaselineStore(loadedData, channelName, curve, options = {}) {
    if (!loadedData || !channelName || !Array.isArray(curve)) {
        return;
    }
    if (!loadedData.plotBaseCurvesBaseline || typeof loadedData.plotBaseCurvesBaseline !== 'object') {
        loadedData.plotBaseCurvesBaseline = {};
    }
    const { force = false } = options;
    if (!Array.isArray(loadedData.plotBaseCurvesBaseline[channelName]) || force) {
        loadedData.plotBaseCurvesBaseline[channelName] = curve.slice();
    }
}

function isBakedMeasurement(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    if (entry.meta && (entry.meta.baked === true || entry.meta.bakedGlobal === true)) {
        return true;
    }
    const filename = typeof entry.filename === 'string' ? entry.filename : '';
    if (filename.includes('*BAKED*')) {
        return true;
    }
    const sourceTag = typeof entry.source === 'string' ? entry.source.toLowerCase() : '';
    if (sourceTag.includes('baked')) {
        return true;
    }
    if (typeof LinearizationState?.isGlobalBaked === 'function' && LinearizationState.isGlobalBaked()) {
        return true;
    }
    return false;
}

let unsubscribeScalingStateInput = null;
let unsubscribeLabNormalizationMode = null;
let unsubscribeLabSmoothingPercent = null;
let unsubscribeCompositeDebugState = null;
let unsubscribeCompositeWeightingMode = null;
let unsubscribeChannelDensityStore = null;
let unsubscribeCorrectionMethod = null;
let scalingStateFlagListenerAttached = false;
let lastScalingStateValue = null;
let scaleHandlerRetryCount = 0;
const SCALE_HANDLER_MAX_RETRIES = 5;

let latestCoverageSummary = null;
const COVERAGE_INDICATOR_TOLERANCE = 0.003;
const COVERAGE_INDICATOR_FLOAT_EPSILON = 1e-6;

const SATURATION_THRESHOLD = 0.995;
const PLOT_SMOOTHING_PEAK_EPSILON = 0.5;

function captureCoverageSummarySnapshot() {
    if (!isBrowser) {
        latestCoverageSummary = null;
        return;
    }
    try {
        const summary = typeof getCompositeCoverageSummary === 'function' ? getCompositeCoverageSummary() : null;
        if (summary && typeof summary === 'object') {
            latestCoverageSummary = summary;
        } else {
            latestCoverageSummary = null;
        }
    } catch (error) {
        latestCoverageSummary = null;
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[coverage] unable to read composite coverage summary:', error);
        }
    }
}

function lookupCoverageSummaryEntry(channelName) {
    if (!latestCoverageSummary || !channelName) {
        return null;
    }
    const normalizeKey = (key) => (typeof key === 'string' ? key : '');
    if (latestCoverageSummary instanceof Map) {
        const direct = latestCoverageSummary.get(channelName);
        if (direct) return direct;
        const upper = latestCoverageSummary.get(normalizeKey(channelName).toUpperCase());
        if (upper) return upper;
        const lower = latestCoverageSummary.get(normalizeKey(channelName).toLowerCase());
        if (lower) return lower;
        return null;
    }
    if (latestCoverageSummary[channelName]) {
        return latestCoverageSummary[channelName];
    }
    const upper = normalizeKey(channelName).toUpperCase();
    if (latestCoverageSummary[upper]) {
        return latestCoverageSummary[upper];
    }
    const lower = normalizeKey(channelName).toLowerCase();
    if (latestCoverageSummary[lower]) {
        return latestCoverageSummary[lower];
    }
    return null;
}

function formatNormalizedPercent(value, digits = 1) {
    if (!Number.isFinite(value)) {
        return '—';
    }
    const clamped = clamp01(value);
    const scaled = clamped * 100;
    const formatted = scaled.toFixed(digits);
    const cleaned = formatted.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    return `${cleaned}%`;
}

function updateCoverageIndicatorForRow(row, channelName) {
    if (!row || !isBrowser) {
        return;
    }
    const indicator = row.querySelector('[data-coverage-indicator]');
    if (!indicator) {
        return;
    }
    const entry = lookupCoverageSummaryEntry(channelName);
    if (!entry) {
        indicator.textContent = '';
        indicator.classList.add('hidden');
        indicator.classList.remove('text-amber-600');
        indicator.classList.add('text-gray-500');
        indicator.removeAttribute('title');
        return;
    }

    const maxNormalized = Number.isFinite(entry.maxNormalized) ? clamp01(entry.maxNormalized) : null;
    const bufferedLimit = Number.isFinite(entry.bufferedLimit)
        ? clamp01(entry.bufferedLimit)
        : (Number.isFinite(entry.limit) ? clamp01(entry.limit) : null);

    if (maxNormalized === null || bufferedLimit === null) {
        indicator.textContent = '';
        indicator.classList.add('hidden');
        indicator.classList.remove('text-amber-600');
        indicator.classList.add('text-gray-500');
        indicator.removeAttribute('title');
        return;
    }

    indicator.textContent = `Coverage ${formatNormalizedPercent(maxNormalized)} / ${formatNormalizedPercent(bufferedLimit)}`;
    indicator.classList.remove('hidden');

    const headroom = bufferedLimit - maxNormalized;
    const overflowCount = Number(entry.overflow) || 0;
    const highlight = overflowCount > 0 || headroom <= COVERAGE_INDICATOR_TOLERANCE + COVERAGE_INDICATOR_FLOAT_EPSILON;
    indicator.classList.toggle('text-amber-600', highlight);
    indicator.classList.toggle('text-gray-500', !highlight);

    if (overflowCount > 0 && Array.isArray(entry.clampedSamples) && entry.clampedSamples.length) {
        const samples = entry.clampedSamples.slice(0, 3).map((sample) => {
            if (Number.isFinite(sample.inputPercent)) {
                return `${sample.inputPercent.toFixed(1)}%`;
            }
            if (Number.isInteger(sample.index)) {
                return `sample ${sample.index}`;
            }
            return 'sample';
        });
        const suffix = entry.clampedSamples.length > 3 ? '…' : '';
        indicator.title = `Clamped at ${samples.join(', ')}${suffix}`;
    } else if (highlight) {
        indicator.title = 'Coverage ceiling reached for this channel.';
    } else {
        indicator.removeAttribute('title');
    }
}

function updateCoverageIndicators() {
    if (!isBrowser || !elements.rows) {
        latestCoverageSummary = null;
        return;
    }
    captureCoverageSummarySnapshot();
    const rows = elements.rows.querySelectorAll('tr.channel-row[data-channel]');
    rows.forEach((row) => {
        const channel = row.getAttribute('data-channel');
        updateCoverageIndicatorForRow(row, channel);
    });
}

function applyDensityStateToRow(row, state) {
    if (!row) return;
    const densityInput = row.querySelector('.density-input');
    const source = state?.source || 'unset';
    const value = Number.isFinite(state?.value) ? state.value : null;
    const display = value !== null ? formatDensityInput(value) : '';

    if (densityInput) {
        const isEditing = densityInput.dataset.userEditing === 'true';
        if (!isEditing && document.activeElement !== densityInput) {
            densityInput.value = display;
        }
        densityInput.setAttribute('data-density-source', source);
        densityInput.dataset.densitySource = source;
        densityInput.placeholder = display ? '' : '—';
    }
    const channelAttribute = row.getAttribute('data-channel');
    updateCoverageIndicatorForRow(row, channelAttribute);
}

function formatSamplePercent(index) {
    const pct = (index / 255) * 100;
    return `${pct.toFixed(1).replace(/\\.0$/, '')}%`;
}

function collectCurveWarnings(entries) {
    const saturationByChannel = new Map();
    const saturationByIndex = new Map();

    entries.forEach((entry) => {
        const curve = entry?.curve;
        const endValue = Math.max(0, Number(entry?.currentEnd) || 0);
        if (!Array.isArray(curve) || curve.length === 0 || endValue <= 0) {
            return;
        }

        for (let i = 0; i < curve.length; i += 1) {
            const value = curve[i];
            const inputPercent = (i / 255) * 100;
            if (value >= endValue * SATURATION_THRESHOLD && inputPercent < 95) {
                if (!saturationByChannel.has(entry.channelName)) {
                    saturationByChannel.set(entry.channelName, formatSamplePercent(i));
                }
                const names = saturationByIndex.get(i) || [];
                names.push(entry.channelName);
                saturationByIndex.set(i, names);
            }
        }
    });

    const warnings = [];
    saturationByChannel.forEach((percent, channel) => {
        warnings.push(`${channel} channel reaches ≥99% ink near ${percent}`);
    });

    saturationByIndex.forEach((names, index) => {
        if (names.length >= 2) {
            warnings.push(`Multiple channels (${names.join(', ')}) saturate near ${formatSamplePercent(index)}`);
        }
    });

    return warnings;
}

function syncScaleInputFromStateValue(value) {
    if (!elements.scaleAllInput) return;

    const numeric = Number(value);
    const fallback = getCurrentScale();
    const target = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    const formatted = formatScalePercent(target);

    if (elements.scaleAllInput.value !== formatted) {
        elements.scaleAllInput.value = formatted;
    }

    lastScalingStateValue = target;
}

function configureScalingStateSubscription() {
    if (!elements.scaleAllInput) {
        return;
    }

    if (unsubscribeScalingStateInput) {
        try {
            unsubscribeScalingStateInput();
        } catch (err) {
            console.warn('Failed to remove scaling state subscription', err);
        }
        unsubscribeScalingStateInput = null;
        if (isBrowser) {
            globalScope.__scalingStateSubscribed = false;
        }
    }

    const enabled = !!(isBrowser && globalScope.__USE_SCALING_STATE);
    if (!enabled) {
        lastScalingStateValue = null;
        syncScaleInputFromStateValue(getCurrentScale());
        return;
    }

    let stateManager;
    try {
        stateManager = getStateManager();
    } catch (error) {
        console.warn('Scaling state manager unavailable:', error);
        return;
    }

    if (!stateManager || typeof stateManager.subscribe !== 'function') {
        return;
    }

    try {
        syncScaleInputFromStateValue(stateManager.get('scaling.globalPercent'));
    } catch (readError) {
        console.warn('Unable to read scaling.globalPercent from state', readError);
    }

    unsubscribeScalingStateInput = stateManager.subscribe(['scaling.globalPercent'], (_, newValue) => {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('🔁 [SCALE STATE] scaling.globalPercent changed', newValue);
        }
        if (!elements.scaleAllInput) return;

        if (lastScalingStateValue != null) {
            const numeric = Number(newValue);
            if (Number.isFinite(numeric) && Math.abs(numeric - lastScalingStateValue) < 1e-6) {
                return;
            }
        }

        syncScaleInputFromStateValue(newValue);
    });

    if (isBrowser) {
        globalScope.__scalingStateSubscribed = true;
    }

    try {
        validateScalingStateSync({ reason: 'subscription:resync', throwOnMismatch: false });
    } catch (validationError) {
        console.warn('Scaling state validation failed after subscription resync', validationError);
    }
}

function setRevertInProgress(active) {
    if (!isBrowser) return;
    globalScope.__quadRevertInProgress = !!active;
    const root = document.body;
    if (root) {
        root.classList.toggle('revert-in-progress', !!active);
    }
}

function getPerChannelMaps() {
    const appState = getAppState();
    return {
        linearization: { ...(appState.perChannelLinearization || {}) },
        enabled: { ...(appState.perChannelEnabled || {}) },
        filenames: { ...(appState.perChannelFilenames || {}) }
    };
}

function syncPerChannelAppState(channelName, data) {
    try {
        const next = { ...(getAppState().perChannelLinearization || {}) };
        if (data) next[channelName] = data;
        else delete next[channelName];
        updateAppState({ perChannelLinearization: next });
    } catch (err) {
        console.warn('Unable to sync per-channel state', err);
    }
}

const debouncedPreviewUpdate = debounce(() => {
    updatePreview();
}, 300);

function syncLabNormalizationCheckboxes(mode = getLabNormalizationMode()) {
    const isDensity = mode === LAB_NORMALIZATION_MODES.DENSITY;
    if (elements.labDensityToggle) {
        elements.labDensityToggle.checked = isDensity;
        elements.labDensityToggle.setAttribute('aria-checked', String(isDensity));
    }
    if (elements.manualLstarDensityToggle) {
        elements.manualLstarDensityToggle.checked = isDensity;
        elements.manualLstarDensityToggle.setAttribute('aria-checked', String(isDensity));
    }
}

function syncLabSmoothingControls(percent = getLabSmoothingPercent()) {
    const numeric = Number(percent);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(300, Math.round(numeric))) : getLabSmoothingPercent();
    if (elements.labSmoothingSlider) {
        if (Number(elements.labSmoothingSlider.value) !== clamped) {
            elements.labSmoothingSlider.value = String(clamped);
        }
    }
    if (elements.labSmoothingValue) {
        const widen = mapSmoothingPercentToWiden(clamped);
        elements.labSmoothingValue.textContent = `${clamped}% (×${widen.toFixed(2)})`;
    }
}

function syncPlotSmoothingBaselines(loadedData, channelNames = null, options = {}) {
    if (!loadedData) {
        return;
    }
    const {
        source = 'curves',
        force = false,
        preserveExistingSnapshot = false
    } = typeof options === 'object' && options !== null
        ? options
        : {};

    const sourceMap = (() => {
        if (source === 'rebasedCurves') return loadedData.rebasedCurves;
        if (source === 'rebasedSources') return loadedData.rebasedSources;
        if (source && typeof source === 'object') return source;
        return loadedData.curves;
    })();

    if (!sourceMap || typeof sourceMap !== 'object') {
        return;
    }

    const names = Array.isArray(channelNames) && channelNames.length
        ? channelNames
        : Object.keys(sourceMap);
    if (!Array.isArray(names) || !names.length) {
        return;
    }

    if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
        loadedData.plotBaseCurves = {};
    }
    if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
        loadedData._plotSmoothingOriginalCurves = {};
    }
    if (!loadedData._plotSmoothingBaselineCurves || typeof loadedData._plotSmoothingBaselineCurves !== 'object') {
        loadedData._plotSmoothingBaselineCurves = {};
    }
    if (!loadedData._plotSmoothingOriginalEnds || typeof loadedData._plotSmoothingOriginalEnds !== 'object') {
        loadedData._plotSmoothingOriginalEnds = {};
    }
    if (!loadedData.baselineEnd || typeof loadedData.baselineEnd !== 'object') {
        loadedData.baselineEnd = {};
    }

    names.forEach((channelName) => {
        if (!channelName) return;
        const curve = Array.isArray(sourceMap[channelName]) ? sourceMap[channelName] : null;
        if (!curve || !curve.length) return;

        const cloned = curve.slice();
        const peak = cloned.reduce((max, value) => (value > max ? value : max), 0);
        const existingOriginalCurve = Array.isArray(loadedData._plotSmoothingOriginalCurves[channelName])
            ? loadedData._plotSmoothingOriginalCurves[channelName]
            : null;
        const existingOriginalEnd = Number(
            loadedData._plotSmoothingOriginalEnds && loadedData._plotSmoothingOriginalEnds[channelName]
        );
        const existingPeak = Number.isFinite(existingOriginalEnd)
            ? existingOriginalEnd
            : (Array.isArray(existingOriginalCurve)
                ? existingOriginalCurve.reduce((max, value) => (value > max ? value : max), 0)
                : Number.NaN);
        const hasExistingSnapshot = Array.isArray(existingOriginalCurve) && existingOriginalCurve.length > 0;

        const shouldReplaceSnapshot = (() => {
            if (!hasExistingSnapshot) {
                return true;
            }
            if (!Number.isFinite(existingPeak)) {
                return true;
            }
            if (peak > existingPeak + PLOT_SMOOTHING_PEAK_EPSILON) {
                return true;
            }
            if (preserveExistingSnapshot && peak < existingPeak - PLOT_SMOOTHING_PEAK_EPSILON) {
                return false;
            }
            return force && !preserveExistingSnapshot;
        })();

        if (shouldReplaceSnapshot) {
            loadedData.plotBaseCurves[channelName] = cloned.slice();
            loadedData._plotSmoothingOriginalCurves[channelName] = cloned.slice();
            loadedData._plotSmoothingBaselineCurves[channelName] = cloned.slice();
            loadedData._plotSmoothingOriginalEnds[channelName] = peak;
            loadedData.baselineEnd[channelName] = peak;
            return;
        }

        const resolvedPeak = Number.isFinite(existingPeak) ? existingPeak : peak;
        if (!Array.isArray(loadedData.plotBaseCurves[channelName])) {
            loadedData.plotBaseCurves[channelName] = existingOriginalCurve
                ? existingOriginalCurve.slice()
                : cloned.slice();
        }
        if (!Array.isArray(loadedData._plotSmoothingBaselineCurves[channelName])) {
            loadedData._plotSmoothingBaselineCurves[channelName] = existingOriginalCurve
                ? existingOriginalCurve.slice()
                : cloned.slice();
        }
        if (!Number.isFinite(existingOriginalEnd) || resolvedPeak > existingOriginalEnd + PLOT_SMOOTHING_PEAK_EPSILON) {
            loadedData._plotSmoothingOriginalEnds[channelName] = resolvedPeak;
        }
        if (!Number.isFinite(loadedData.baselineEnd[channelName]) || preserveExistingSnapshot) {
            loadedData.baselineEnd[channelName] = resolvedPeak;
        }
    });
}

function applyPlotSmoothingToCurve(values, percent) {
    if (!Array.isArray(values) || values.length === 0) {
        return Array.isArray(values) ? values.slice() : [];
    }
    const numeric = Number(percent);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return values.slice();
    }
    const radius = Math.max(1, Math.round((numeric / 100) * 12));
    const len = values.length;
    const smoothed = new Array(len);
    for (let i = 0; i < len; i += 1) {
        let weightedSum = 0;
        let weightTotal = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
            const idx = Math.min(len - 1, Math.max(0, i + offset));
            const weight = radius - Math.abs(offset) + 1;
            weightedSum += values[idx] * weight;
            weightTotal += weight;
        }
        smoothed[i] = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : values[i];
    }
    if (len > 0) {
        smoothed[0] = values[0];
    }
    return smoothed;
}

function clampCurveToSupport(values, support) {
    if (!Array.isArray(values)) {
        return Array.isArray(support) ? new Array(support.length).fill(0) : [];
    }
    if (!Array.isArray(support) || support.length === 0) {
        return values.slice();
    }
    const limit = Math.min(values.length, support.length);
    const clamped = values.slice();
    for (let i = 0; i < limit; i += 1) {
        const supportValue = Number(support[i]) || 0;
        if (supportValue <= 0) {
            clamped[i] = 0;
        } else if (clamped[i] > supportValue) {
            clamped[i] = supportValue;
        }
    }
    return clamped;
}

const SINGLE_PEAK_LOCK_RATIO = 0.32;

function enforceSinglePeak(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    return values.slice();
}

const PLOT_SMOOTHING_TAIL_WINDOW = 6;
const PLOT_SMOOTHING_HEAD_WINDOW = 6;
const PLOT_SMOOTHING_GUARD_FRACTION = 0.98;

function rescaleCurveTowardTarget(values, targetEnd, guardFraction = PLOT_SMOOTHING_GUARD_FRACTION) {
    if (!Array.isArray(values)) {
        return [];
    }
    if (!Number.isFinite(targetEnd) || targetEnd <= 0) {
        return values.slice();
    }
    const copy = values.slice();
    const maxValue = copy.reduce((max, value) => (value > max ? value : max), 0);
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
        return copy;
    }
    const guardTarget = Math.max(0, Math.min(targetEnd * guardFraction, targetEnd - 1));
    if (guardTarget <= 0 || maxValue >= guardTarget) {
        return copy;
    }
    const scale = guardTarget / maxValue;
    for (let i = 0; i < copy.length; i += 1) {
        const scaled = Math.max(0, Number(copy[i]) * scale);
        copy[i] = Math.round(scaled);
    }
    return copy;
}

function blendCurveTailWithBaseline(curve, baseline, targetEnd, options = {}) {
    if (!Array.isArray(curve)) {
        return [];
    }
    const copy = curve.slice();
    const length = copy.length;
    if (length === 0) {
        return copy;
    }
    const windowSize = Math.max(2, Math.min(options.windowSize ?? PLOT_SMOOTHING_TAIL_WINDOW, length));
    const start = Math.max(0, length - windowSize);
    for (let i = start; i < length; i += 1) {
        const relative = windowSize > 1 ? (i - start) / (windowSize - 1) : 1;
        const smoothedValue = Number(copy[i]) || 0;
        const baselineValue = Array.isArray(baseline) && baseline[i] != null ? Number(baseline[i]) || 0 : smoothedValue;
        const weight = 1 - relative; // 1 at window start, 0 at endpoint
        const blended = (weight * smoothedValue) + ((1 - weight) * baselineValue);
        copy[i] = Math.round(Math.max(0, blended));
    }

    const baselineEnd = Array.isArray(baseline) && baseline[length - 1] != null
        ? Number(baseline[length - 1]) || 0
        : (Number(targetEnd) || 0);

    const baselineSecondLast = length >= 2 && Array.isArray(baseline) && baseline[length - 2] != null
        ? Number(baseline[length - 2]) || 0
        : null;
    if (baselineSecondLast != null) {
        const minSecondLast = baselineEnd - (baselineEnd - baselineSecondLast);
        if (copy[length - 2] < minSecondLast) {
            copy[length - 2] = minSecondLast;
        }
    }

    for (let i = start; i < length - 1; i += 1) {
        if (Array.isArray(baseline) && baseline[i] != null) {
            const baselineValue = Number(baseline[i]) || 0;
            if (copy[i] < baselineValue) {
                copy[i] = baselineValue;
            }
        }
    }

    copy[length - 1] = baselineEnd;

    for (let i = start + 1; i < length; i += 1) {
        if (copy[i] < copy[i - 1]) {
            copy[i] = copy[i - 1];
        }
    }

    return copy;
}

function blendCurveHeadWithBaseline(curve, baseline, options = {}) {
    if (!Array.isArray(curve)) {
        return [];
    }
    const copy = curve.slice();
    const length = copy.length;
    if (length === 0) {
        return copy;
    }
    const windowSize = Math.max(2, Math.min(options.windowSize ?? PLOT_SMOOTHING_HEAD_WINDOW, length));
    const end = Math.min(windowSize, length);
    for (let i = 0; i < end; i += 1) {
        const relative = end > 1 ? (i / (end - 1)) : 1;
        const smoothedValue = Number(copy[i]) || 0;
        const baselineValue = Array.isArray(baseline) && baseline[i] != null ? Number(baseline[i]) || 0 : smoothedValue;
        const weight = relative; // 0 at index 0 (baseline), 1 at end (smoothed)
        const blended = (weight * smoothedValue) + ((1 - weight) * baselineValue);
        copy[i] = Math.round(Math.max(0, blended));
    }

    for (let i = 0; i < end; i += 1) {
        const baselineValue = Array.isArray(baseline) && baseline[i] != null ? Number(baseline[i]) || 0 : 0;
        if (copy[i] < baselineValue) {
            copy[i] = baselineValue;
        }
        if (i > 0 && copy[i] < copy[i - 1]) {
            copy[i] = copy[i - 1];
        }
    }

    return copy;
}

function rescaleCurveToEnd(curve, targetEnd) {
    if (!Array.isArray(curve)) {
        return [];
    }
    if (!Number.isFinite(targetEnd) || targetEnd <= 0) {
        return curve.slice();
    }
    const currentMax = Math.max(...curve);
    if (!Number.isFinite(currentMax) || currentMax <= 0) {
        return new Array(curve.length).fill(0);
    }
    const scale = targetEnd / currentMax;
    const result = curve.map((value) => Math.round(Math.max(0, value * scale)));
    const lastIndex = result.length - 1;
    if (lastIndex >= 0) {
        const originalTail = curve[lastIndex] ?? 0;
        const scaledTail = Math.round(Math.max(0, originalTail * scale));
        result[lastIndex] = Math.min(targetEnd, scaledTail);
    }
    return result;
}

function applyPlotSmoothingToEntries(entries, percent, loadedData) {
    if (!Array.isArray(entries) || entries.length === 0 || !loadedData) {
        return;
    }
    const numeric = Math.max(0, Number(percent) || 0);
    if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
        loadedData.plotBaseCurves = {};
    }
    if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
        loadedData._plotSmoothingOriginalCurves = {};
    } else {
        Object.keys(loadedData._plotSmoothingOriginalCurves).forEach((key) => {
            if (!loadedData.plotBaseCurves[key]) {
                delete loadedData._plotSmoothingOriginalCurves[key];
            }
        });
    }
    if (!loadedData._plotSmoothingOriginalEnds || typeof loadedData._plotSmoothingOriginalEnds !== 'object') {
        loadedData._plotSmoothingOriginalEnds = {};
    }
    const originalEnds = loadedData._plotSmoothingOriginalEnds;
    entries.forEach((entry) => {
        const { channelName } = entry;
        if (!channelName || !Array.isArray(entry.curve)) return;
        const base = entry.curve.slice();
        loadedData.plotBaseCurves[channelName] = base.slice();
        if (originalEnds[channelName] == null) {
            const baseMax = Math.max(...base);
            originalEnds[channelName] = Number.isFinite(baseMax) ? baseMax : 0;
        }
        const peakIndex = Number.isFinite(loadedData.channelPeaks?.[channelName])
            ? loadedData.channelPeaks[channelName]
            : null;
        if (numeric > 0) {
            const targetEnd = Math.max(...base);
            const smoothed = clampCurveToSupport(applyPlotSmoothingToCurve(base, numeric), base);
            const rescaled = rescaleCurveToEnd(smoothed, targetEnd);
            entry.curve = enforceSinglePeak(clampCurveToSupport(rescaled, base), peakIndex);
        } else if (peakIndex != null) {
            entry.curve = enforceSinglePeak(base, peakIndex);
        }
    });
    Object.entries(loadedData.plotBaseCurves).forEach(([channelName, curve]) => {
        loadedData._plotSmoothingOriginalCurves[channelName] = Array.isArray(curve) ? curve.slice() : [];
    });
}

function applyPlotSmoothingToLoadedChannels(percent) {
    const loadedData = getLoadedQuadData?.();
    if (!loadedData || !loadedData.curves) {
        return;
    }
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[PlotSmoothing] apply start', { percent });
    }
    const numeric = Math.max(0, Number(percent) || 0);
    if (numeric <= 0 && loadedData._zeroSmoothingCurves && typeof loadedData._zeroSmoothingCurves === 'object') {
        Object.entries(loadedData._zeroSmoothingCurves).forEach(([channelName, curve]) => {
            if (!Array.isArray(curve)) return;
            const cloned = curve.slice();
            if (!loadedData.rebasedSources || typeof loadedData.rebasedSources !== 'object') {
                loadedData.rebasedSources = {};
            }
            if (!loadedData.rebasedCurves || typeof loadedData.rebasedCurves !== 'object') {
                loadedData.rebasedCurves = {};
            }
            loadedData.rebasedSources[channelName] = cloned.slice();
            loadedData.rebasedCurves[channelName] = cloned.slice();
            loadedData.curves[channelName] = cloned.slice();
        });
        syncPlotSmoothingBaselines(loadedData, null, {
            source: loadedData._zeroSmoothingCurves,
            force: true
        });
    }
    if (numeric <= 0) {
        try {
            const printer = getCurrentPrinter();
            const preferredChannels = Array.isArray(printer?.channels) ? printer.channels.slice() : null;
            syncPlotSmoothingBaselines(loadedData, preferredChannels, {
                source: 'rebasedSources',
                force: true,
                preserveExistingSnapshot: true
            });
        } catch (syncErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[PlotSmoothing] Failed to prime baseline caches before zero smoothing apply:', syncErr);
            }
        }
    }
    if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
        loadedData._plotSmoothingOriginalCurves = {};
    }
    if (!loadedData._plotSmoothingOriginalEnds || typeof loadedData._plotSmoothingOriginalEnds !== 'object') {
        loadedData._plotSmoothingOriginalEnds = {};
    }
    const originalCurves = loadedData._plotSmoothingOriginalCurves;
    const originalEnds = loadedData._plotSmoothingOriginalEnds;
    if (loadedData.baselineEnd && typeof loadedData.baselineEnd === 'object') {
        Object.keys(loadedData.baselineEnd).forEach((channelName) => {
            if (typeof originalEnds[channelName] !== 'number') {
                originalEnds[channelName] = loadedData.baselineEnd[channelName];
            }
        });
    }
    const channelNames = Object.keys(loadedData.curves);
    channelNames.forEach((channelName) => {
        const hasStoredOriginal = Array.isArray(originalCurves[channelName]) && originalCurves[channelName].length > 0;

        if (!hasStoredOriginal && Array.isArray(loadedData.plotBaseCurves?.[channelName])) {
            originalCurves[channelName] = loadedData.plotBaseCurves[channelName].slice();
        } else if (!hasStoredOriginal && Array.isArray(loadedData.curves?.[channelName])) {
            originalCurves[channelName] = loadedData.curves[channelName].slice();
        }

        const baselineSnapshot = Array.isArray(loadedData._plotSmoothingBaselineCurves?.[channelName])
            ? loadedData._plotSmoothingBaselineCurves[channelName].slice()
            : null;
        const sourceCurveSnapshot = Array.isArray(loadedData.rebasedSources?.[channelName])
            ? loadedData.rebasedSources[channelName].slice()
            : null;
        let base = Array.isArray(originalCurves[channelName]) && originalCurves[channelName].length
            ? originalCurves[channelName].slice()
            : null;
        const currentCurveSnapshot = Array.isArray(loadedData.curves?.[channelName])
            ? loadedData.curves[channelName].slice()
            : null;
        if (numeric <= 0 && (!Array.isArray(base) || base.length === 0)) {
            const zeroSource = Array.isArray(loadedData._zeroSmoothingCurves?.[channelName])
                ? loadedData._zeroSmoothingCurves[channelName]
                : null;
            if (zeroSource && zeroSource.length) {
                base = zeroSource.slice();
                originalCurves[channelName] = base.slice();
            }
        }
        if (numeric <= 0 && Array.isArray(loadedData._zeroSmoothingCurves?.[channelName])) {
            base = loadedData._zeroSmoothingCurves[channelName].slice();
            originalCurves[channelName] = base.slice();
        }
        if (!base && Array.isArray(sourceCurveSnapshot)) {
            base = sourceCurveSnapshot.slice();
            originalCurves[channelName] = base.slice();
        }
        if (numeric <= 0 && Array.isArray(currentCurveSnapshot)) {
            const storedMax = Array.isArray(base) && base.length
                ? base.reduce((max, value) => (value > max ? value : max), 0)
                : 0;
            const currentMax = currentCurveSnapshot.reduce((max, value) => (value > max ? value : max), 0);
            if (!Array.isArray(base) || currentMax > storedMax + 0.5) {
                base = currentCurveSnapshot.slice();
                originalCurves[channelName] = base.slice();
            }
        }
        if (!base && Array.isArray(baselineSnapshot)) {
            base = baselineSnapshot.slice();
            originalCurves[channelName] = base.slice();
        }
        if (!base && Array.isArray(currentCurveSnapshot)) {
            base = currentCurveSnapshot.slice();
            originalCurves[channelName] = base.slice();
        }
        if (!base) return;
        let targetEnd = typeof originalEnds[channelName] === 'number'
            ? originalEnds[channelName]
            : (typeof loadedData.baselineEnd?.[channelName] === 'number'
                ? loadedData.baselineEnd[channelName]
                : Math.max(...base));
        if (!Number.isFinite(targetEnd) || targetEnd <= 0) {
            const fallbackMax = Math.max(...base);
            targetEnd = Number.isFinite(fallbackMax) && fallbackMax > 0 ? fallbackMax : 0;
            originalEnds[channelName] = targetEnd;
        }
        const peakIndex = Number.isFinite(loadedData.channelPeaks?.[channelName])
            ? loadedData.channelPeaks[channelName]
            : null;
        if (numeric <= 0 || targetEnd <= 0) {
            let restoredBase = base.slice();
            const baseMax = restoredBase.reduce((max, value) => (value > max ? value : max), 0);
            if (numeric <= 0 && targetEnd > 0 && Math.abs(baseMax - targetEnd) > 0.5) {
                restoredBase = rescaleCurveToEnd(restoredBase, targetEnd);
            }
            const restored = enforceSinglePeak(restoredBase, peakIndex);
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[PlotSmoothing] curve restore', channelName, {
                    storedMax: Math.max(...base),
                    targetEnd,
                    currentMax: Array.isArray(currentCurveSnapshot) ? Math.max(...currentCurveSnapshot) : null
                });
            }
            loadedData.curves[channelName] = restored.slice();
            if (!loadedData.rebasedCurves) loadedData.rebasedCurves = {};
            if (!loadedData.rebasedSources) loadedData.rebasedSources = {};
            loadedData.rebasedCurves[channelName] = restored.slice();
            loadedData.rebasedSources[channelName] = restored.slice();
            if (loadedData.baselineEnd && Number.isFinite(targetEnd)) {
                loadedData.baselineEnd[channelName] = targetEnd;
            }
            if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
                loadedData.plotBaseCurves = {};
            }
            loadedData.plotBaseCurves[channelName] = restored.slice();
            if (!loadedData._plotSmoothingBaselineCurves || typeof loadedData._plotSmoothingBaselineCurves !== 'object') {
                loadedData._plotSmoothingBaselineCurves = {};
            }
            loadedData._plotSmoothingBaselineCurves[channelName] = restored.slice();
            originalCurves[channelName] = restored.slice();
            originalEnds[channelName] = targetEnd;
            return;
        }
        const smoothedCurve = clampCurveToSupport(applyPlotSmoothingToCurve(base, numeric), base);
        const guardedCurve = rescaleCurveTowardTarget(smoothedCurve, targetEnd);
        const headBlendedCurve = blendCurveHeadWithBaseline(guardedCurve, base, {
            windowSize: PLOT_SMOOTHING_HEAD_WINDOW
        });
        const blendedCurve = blendCurveTailWithBaseline(headBlendedCurve, base, targetEnd, {
            windowSize: PLOT_SMOOTHING_TAIL_WINDOW
        });
        const clampedBlended = clampCurveToSupport(blendedCurve, base);
        const finalCurve = enforceSinglePeak(clampedBlended, peakIndex);
        loadedData.curves[channelName] = finalCurve.slice();
        if (!loadedData.rebasedCurves) loadedData.rebasedCurves = {};
        if (!loadedData.rebasedSources) loadedData.rebasedSources = {};
        loadedData.rebasedCurves[channelName] = finalCurve.slice();
        if (numeric <= 0) {
            loadedData.rebasedSources[channelName] = finalCurve.slice();
        } else if (!Array.isArray(loadedData.rebasedSources[channelName])) {
            loadedData.rebasedSources[channelName] = base.slice();
        }
        if (loadedData.baselineEnd && Number.isFinite(targetEnd)) {
            loadedData.baselineEnd[channelName] = targetEnd;
        }
        if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
            loadedData.plotBaseCurves = {};
        }
        if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
            loadedData._plotSmoothingOriginalCurves = {};
        }
        if (numeric <= 0) {
            loadedData.plotBaseCurves[channelName] = finalCurve.slice();
            loadedData._plotSmoothingOriginalCurves[channelName] = finalCurve.slice();
        }
    });
    if (numeric <= 0) {
        try {
            syncPlotSmoothingBaselines(loadedData, channelNames, { source: 'curves', force: true });
        } catch (baselineSyncErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[PlotSmoothing] Failed to synchronize baselines after zero smoothing apply:', baselineSyncErr);
            }
        }
        try {
            const zeroCurves = loadedData._zeroSmoothingCurves;
            const signature = loadedData._zeroSmoothingSignature || null;
            const globalFilename = typeof LinearizationState?.getGlobalData === 'function'
                ? LinearizationState.getGlobalData()?.filename || null
                : null;
            const signatureMatches = !signature || !globalFilename || signature === globalFilename;
            const maxOf = (curve) => {
                if (!Array.isArray(curve)) return 0;
                return curve.reduce((max, value) => (value > max ? value : max), 0);
            };
            if (zeroCurves && typeof zeroCurves === 'object' && signatureMatches) {
                let requiresReapply = false;
                Object.entries(zeroCurves).forEach(([channelName, curve]) => {
                    if (!Array.isArray(curve) || !curve.length) return;
                    const snapshotMax = maxOf(curve);
                    const currentMax = maxOf(loadedData.curves?.[channelName]);
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[PlotSmoothing] zero-check', channelName, { snapshotMax, currentMax });
                    }
                    if (snapshotMax > 0 && Math.abs(currentMax - snapshotMax) > 0.5) {
                        requiresReapply = true;
                    }
                });
                if (requiresReapply) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[PlotSmoothing] Reapplying zero-smoothing snapshot to restore baseline amplitude.');
                    }
                    Object.entries(zeroCurves).forEach(([channelName, curve]) => {
                        if (!Array.isArray(curve)) return;
                        const cloned = curve.slice();
                        loadedData.curves[channelName] = cloned.slice();
                        if (!loadedData.rebasedCurves || typeof loadedData.rebasedCurves !== 'object') {
                            loadedData.rebasedCurves = {};
                        }
                        loadedData.rebasedCurves[channelName] = cloned.slice();
                        if (!loadedData.rebasedSources || typeof loadedData.rebasedSources !== 'object') {
                            loadedData.rebasedSources = {};
                        }
                        loadedData.rebasedSources[channelName] = cloned.slice();
                    });
                    syncPlotSmoothingBaselines(loadedData, null, { source: zeroCurves, force: true });
                    loadedData._zeroSmoothingReapplied = true;
                    if (typeof LinearizationState?.setGlobalCorrectedCurves === 'function') {
                        try {
                            LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
                        } catch (snapshotErr) {
                            console.warn('[PlotSmoothing] Failed to push zero-snapshot corrected curves:', snapshotErr);
                        }
                    }
                    const baselineSnapshot = cloneBaselineCurvesFromLoadedData(loadedData);
                    if (baselineSnapshot && typeof LinearizationState?.setGlobalBaselineCurves === 'function') {
                        try {
                            LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
                        } catch (baselineErr) {
                            console.warn('[PlotSmoothing] Failed to push zero-snapshot baseline curves:', baselineErr);
                        }
                    }
                } else if (loadedData._zeroSmoothingReapplied) {
                    loadedData._zeroSmoothingReapplied = false;
                }
            }
        } catch (zeroErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[PlotSmoothing] Failed to validate zero-smoothing snapshot during reset:', zeroErr);
            }
        }
    }
    try { updateInkChart(); } catch (error) { console.warn(error); }
    try { debouncedPreviewUpdate(); } catch (error) { console.warn(error); }
    try {
        const printer = getCurrentPrinter();
        const names = printer?.channels || channelNames;
        names.forEach((channelName) => {
            try { updateProcessingDetail(channelName); } catch (err) { console.warn(err); }
        });
    } catch (error) {
        console.warn(error);
    }
    try { updateSessionStatus(); } catch (error) { console.warn(error); }
    try { postLinearizationSummary(); } catch (error) { console.warn(error); }
    updateCoverageIndicators();
}

const schedulePlotSmoothingRefresh = debounce(() => {
    applyPlotSmoothingToLoadedChannels(getPlotSmoothingPercent());
}, 250);

const scheduleCompositeWeightingRefresh = debounce(() => {
    try {
        if (!LinearizationState?.isGlobalEnabled?.()) {
            return;
        }
        const globalData = LinearizationState.getGlobalData?.();
        if (!globalData || !isLabLinearizationData(globalData)) {
            return;
        }
        const printer = getCurrentPrinter();
        const channelNames = Array.isArray(printer?.channels) ? printer.channels.slice() : [];
        if (!channelNames.length) {
            return;
        }
        rebaseChannelsToCorrectedCurves(channelNames, {
            source: 'compositeWeightingChange',
            useOriginalBaseline: true
        });
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[CompositeWeighting] Failed to refresh after weighting change:', error);
        }
    }
}, 200);

function resetPlotSmoothingCaches() {
    const loadedData = getLoadedQuadData?.();
    if (!loadedData) {
        return;
    }
    loadedData._plotSmoothingOriginalCurves = {};
    loadedData._plotSmoothingOriginalEnds = {};
}

function storeZeroSmoothingSnapshot(filename) {
    const loadedData = getLoadedQuadData?.();
    if (!loadedData || !loadedData.curves) {
        return;
    }
    const snapshot = {};
    Object.entries(loadedData.curves).forEach(([channelName, curve]) => {
        if (Array.isArray(curve)) {
            snapshot[channelName] = curve.slice();
        }
    });
    loadedData._zeroSmoothingCurves = snapshot;
    loadedData._zeroSmoothingSignature = typeof filename === 'string' && filename.trim() ? filename.trim() : null;
    loadedData._zeroSmoothingRestored = false;
}

function restoreZeroSmoothingSnapshot(filename) {
    const loadedData = getLoadedQuadData?.();
    if (!loadedData || !loadedData._zeroSmoothingCurves) {
        return false;
    }
    const signature = typeof filename === 'string' && filename.trim() ? filename.trim() : null;
    if (signature && loadedData._zeroSmoothingSignature && loadedData._zeroSmoothingSignature !== signature) {
        return false;
    }
    const restored = applyCurveSnapshot(loadedData._zeroSmoothingCurves, {
        skipRefresh: false,
        skipScaleBaselineUpdate: true
    });
    if (restored && loadedData) {
        loadedData._zeroSmoothingRestored = true;
        if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
            loadedData.plotBaseCurves = {};
        }
        if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
            loadedData._plotSmoothingOriginalCurves = {};
        }
        if (!loadedData._plotSmoothingOriginalEnds || typeof loadedData._plotSmoothingOriginalEnds !== 'object') {
            loadedData._plotSmoothingOriginalEnds = {};
        }
        if (!loadedData._plotSmoothingBaselineCurves || typeof loadedData._plotSmoothingBaselineCurves !== 'object') {
            loadedData._plotSmoothingBaselineCurves = {};
        }
        Object.entries(loadedData.curves || {}).forEach(([channelName, curve]) => {
            if (!Array.isArray(curve)) {
                return;
            }
            const cloned = curve.slice();
            const peak = cloned.reduce((max, value) => (value > max ? value : max), 0);
            loadedData.plotBaseCurves[channelName] = cloned.slice();
            ensureBaselineStore(loadedData, channelName, cloned);
            loadedData._plotSmoothingOriginalCurves[channelName] = cloned.slice();
            loadedData._plotSmoothingBaselineCurves[channelName] = cloned.slice();
            if (Number.isFinite(peak)) {
                loadedData._plotSmoothingOriginalEnds[channelName] = peak;
                if (loadedData.baselineEnd && typeof loadedData.baselineEnd === 'object') {
                    loadedData.baselineEnd[channelName] = peak;
                }
            }
        });
        syncPlotSmoothingBaselines(loadedData, null, { source: 'curves', force: true });
        if (LinearizationState && typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
            try {
                LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
            } catch (err) {
                console.warn('[ZeroSmoothing] Failed to sync corrected curves after restore:', err);
            }
        }
        const baselineSnapshot = cloneBaselineCurvesFromLoadedData(loadedData);
        if (baselineSnapshot && LinearizationState && typeof LinearizationState.setGlobalBaselineCurves === 'function') {
            try {
                LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
            } catch (err) {
                console.warn('[ZeroSmoothing] Failed to sync baseline curves after restore:', err);
            }
        }
    }
    return restored;
}

function syncPlotSmoothingControls(percent = getPlotSmoothingPercent()) {
    const numeric = Number(percent);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(300, Math.round(numeric))) : getPlotSmoothingPercent();
    if (elements.plotSmoothingSlider && Number(elements.plotSmoothingSlider.value) !== clamped) {
        elements.plotSmoothingSlider.value = String(clamped);
    }
    if (elements.plotSmoothingValue) {
        const widen = mapSmoothingPercentToWiden(clamped);
        elements.plotSmoothingValue.textContent = `${clamped}% (×${widen.toFixed(2)})`;
    }
}

function syncCorrectionGainControls(normalized = getCorrectionGain()) {
    const numeric = Number(normalized);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : getCorrectionGain();
    const percent = Math.round(clamped * 100);

    if (elements.correctionGainSlider && Number(elements.correctionGainSlider.value) !== percent) {
        elements.correctionGainSlider.value = String(percent);
        elements.correctionGainSlider.setAttribute('aria-valuenow', String(percent));
        elements.correctionGainSlider.setAttribute('aria-valuetext', `${percent}%`);
    }
    if (elements.correctionGainInput && Number(elements.correctionGainInput.value) !== percent) {
        elements.correctionGainInput.value = String(percent);
    }
    if (elements.correctionGainValue) {
        elements.correctionGainValue.textContent = `${percent}%`;
    }
}

function initializePlotSmoothingHandlers() {
    syncPlotSmoothingControls();
    if (!elements.plotSmoothingSlider) return;
    elements.plotSmoothingSlider.addEventListener('input', (event) => {
        const percent = Number(event.target.value);
        const applied = setPlotSmoothingPercent(percent);
        syncPlotSmoothingControls(applied);
        schedulePlotSmoothingRefresh();
        const widen = mapSmoothingPercentToWiden(applied);
        showStatus(`Plot smoothing set to ${applied}% (×${widen.toFixed(2)})`);
    });
    schedulePlotSmoothingRefresh();
}

function initializeCorrectionGainOption() {
    syncCorrectionGainControls();
    const slider = elements.correctionGainSlider;
    const input = elements.correctionGainInput;

    const commitGainPercent = (rawPercent, options = {}) => {
        const { showToast = false, forceImmediate = false } = options || {};
        const numeric = Number(rawPercent);
        if (!Number.isFinite(numeric)) {
            syncCorrectionGainControls();
            return getCorrectionGain();
        }
        const applied = applyCorrectionGainPercent(numeric, { announce: showToast, forceImmediate });
        syncCorrectionGainControls(applied);
        return applied;
    };

    if (slider) {
        slider.addEventListener('input', (event) => {
            commitGainPercent(event.target.value, { showToast: false });
        });
        slider.addEventListener('change', (event) => {
            commitGainPercent(event.target.value, { showToast: true, forceImmediate: true });
        });
    }

    if (input) {
        input.addEventListener('input', (event) => {
            const numeric = Number(event.target.value);
            if (!Number.isFinite(numeric)) {
                return;
            }
            syncCorrectionGainControls(numeric / 100);
        });

        const commitFromInput = (event) => {
            commitGainPercent(event.target.value, { showToast: true, forceImmediate: true });
        };

        input.addEventListener('blur', commitFromInput);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commitFromInput(event);
            }
        });
    }
}

function rebuildLabEntryForNormalization(entry) {
    if (!entry || !Array.isArray(entry.originalData) || entry.originalData.length < 2) {
        return entry;
    }

    const mode = getLabNormalizationMode();
    const smoothingPercent = Number(getLabSmoothingPercent());
    const hasSmoothing = Number.isFinite(smoothingPercent) && smoothingPercent > 0;
    const widen = hasSmoothing ? mapSmoothingPercentToWiden(smoothingPercent) : 1;

    const rawSamples = rebuildLabSamplesFromOriginal(entry.originalData, {
        normalizationMode: mode,
        skipDefaultSmoothing: true,
        useBaselineWidenFactor: hasSmoothing
    }) || entry.baseSamples || entry.samples;

    const baseSamples = rebuildLabSamplesFromOriginal(entry.originalData, {
        normalizationMode: mode,
        useBaselineWidenFactor: hasSmoothing
    }) || rawSamples;
    const previewSamples = hasSmoothing
        ? rebuildLabSamplesFromOriginal(entry.originalData, {
            normalizationMode: mode,
            widenFactor: widen
        }) || baseSamples.slice()
        : baseSamples.slice();

    const updated = {
        ...entry,
        samples: hasSmoothing ? previewSamples.slice() : baseSamples.slice(),
        baseSamples: baseSamples.slice(),
        rawSamples: rawSamples.slice(),
        previewSamples: previewSamples.slice(),
        previewSmoothingPercent: smoothingPercent
    };

    if (!Array.isArray(updated.originalSamples)) {
        updated.originalSamples = previewSamples.slice();
    }

    return updated;
}

function refreshLinearizationDataForNormalization() {
    const mode = getLabNormalizationMode();
    const printer = getCurrentPrinter();
    const channels = printer?.channels || [];
    const updatedChannels = [];
    const smoothingPercent = Number(getLabSmoothingPercent?.() || 0);
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[LabNormalization] refreshLinearizationDataForNormalization start', { smoothingPercent });
    }

    const globalData = LinearizationState.getGlobalData();
    if (globalData && isLabLinearizationData(globalData)) {
        const previousBakedMeta = typeof LinearizationState.getGlobalBakedMeta === 'function'
            ? LinearizationState.getGlobalBakedMeta()
            : null;
        const updatedEntry = rebuildLabEntryForNormalization(globalData);
        const previousSource = typeof LinearizationState.getGlobalDataSource === 'function'
            ? LinearizationState.getGlobalDataSource()
            : null;
        LinearizationState.setGlobalData(updatedEntry, LinearizationState.globalApplied, { source: previousSource });
        if (previousBakedMeta && typeof LinearizationState.setGlobalBakedMeta === 'function') {
            LinearizationState.setGlobalBakedMeta(previousBakedMeta);
        }
        updateAppState({
            linearizationData: updatedEntry,
            linearizationApplied: LinearizationState.globalApplied
        });

        if (smoothingPercent <= 0) {
            try {
                const loadedData = getLoadedQuadData?.();
                if (loadedData && loadedData._originalBaselineEnd) {
                    loadedData.baselineEnd = { ...loadedData._originalBaselineEnd };
                }
            } catch (baselineErr) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[LabNormalization] Failed to restore original baseline ends before rebase:', baselineErr);
                }
            }
        }

        if (smoothingPercent > 0) {
            maybeAutoRaiseInkLimits(updatedEntry, {
                scope: 'global',
                label: 'LAB normalization update',
                source: 'lab-normalization'
            });
        }

        if (elements.globalLinearizationBtn) {
            const countLabel = getBasePointCountLabel(updatedEntry);
            elements.globalLinearizationBtn.setAttribute('data-tooltip', `Loaded: ${updatedEntry.filename || 'LAB Data'} (${countLabel})`);
        }
        if (elements.globalLinearizationDetails) {
            const countLabel = getBasePointCountLabel(updatedEntry);
            const formatToken = String(updatedEntry.format || '')
                .split(' ')
                .filter(Boolean)
                .shift() || '';
            const formatLabel = formatToken ? formatToken.toUpperCase() : '';
            const detailParts = [];
            if (countLabel) detailParts.push(countLabel);
            if (formatLabel) detailParts.push(`(${formatLabel})`);
            elements.globalLinearizationDetails.textContent = detailParts.length
                ? ` - ${detailParts.join(' ')}`
                : '';
        }

        if (smoothingPercent > 0) {
            try {
                const loadedData = getLoadedQuadData?.();
                const signature = typeof updatedEntry.filename === 'string' && updatedEntry.filename.trim()
                    ? updatedEntry.filename.trim()
                    : null;
                if (loadedData && (!loadedData._zeroSmoothingCurves || loadedData._zeroSmoothingSignature !== signature)) {
                    storeZeroSmoothingSnapshot(updatedEntry.filename);
                }
            } catch (snapshotErr) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[LabNormalization] Failed to capture zero-smoothing snapshot before widening:', snapshotErr);
                }
            }
        }

        updatedChannels.push(...channels);
    }

    channels.forEach((channelName) => {
        const entry = LinearizationState.getPerChannelData(channelName);
        if (entry && isLabLinearizationData(entry)) {
            const updatedEntry = rebuildLabEntryForNormalization(entry);
            const enabled = LinearizationState.isPerChannelEnabled(channelName);
            LinearizationState.setPerChannelData(channelName, updatedEntry, enabled);
            syncPerChannelAppState(channelName, updatedEntry);
            if (smoothingPercent > 0) {
                maybeAutoRaiseInkLimits(updatedEntry, {
                    scope: 'channel',
                    channelName,
                    label: `${channelName} LAB normalization`,
                    source: 'lab-normalization'
                });
            }
            if (smoothingPercent <= 0) {
                try {
                    const loadedData = getLoadedQuadData?.();
                    if (loadedData && loadedData._originalBaselineEnd && typeof loadedData._originalBaselineEnd === 'object') {
                        const originalEnd = loadedData._originalBaselineEnd[channelName];
                        if (Number.isFinite(originalEnd)) {
                            loadedData.baselineEnd[channelName] = originalEnd;
                        }
                    }
                } catch (baselineErr) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.warn('[LabNormalization] Failed to restore per-channel baseline end:', baselineErr);
                    }
                }
            }
            if (!updatedChannels.includes(channelName)) {
                updatedChannels.push(channelName);
            }
        }
    });

    const loadedDataForZero = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
    const canRestoreZeroDirectly = smoothingPercent <= 0
        && loadedDataForZero
        && loadedDataForZero._zeroSmoothingCurves
        && Object.keys(loadedDataForZero._zeroSmoothingCurves).length > 0
        && globalData
        && typeof globalData.filename === 'string'
        && globalData.filename.trim().length > 0;
    console.log('[LabNormalization] zeroDirectCandidate', {
        smoothingPercent,
        hasLoadedData: !!loadedDataForZero,
        hasZero: !!(loadedDataForZero && loadedDataForZero._zeroSmoothingCurves),
        zeroCount: loadedDataForZero && loadedDataForZero._zeroSmoothingCurves ? Object.keys(loadedDataForZero._zeroSmoothingCurves).length : 0,
        hasGlobalFilename: !!(globalData && globalData.filename),
        canRestoreZeroDirectly
    });

    if (canRestoreZeroDirectly) {
        const targetFilename = globalData.filename.trim();
        const restored = restoreZeroSmoothingSnapshot(targetFilename);
        if (!restored) {
            applyPlotSmoothingToLoadedChannels(0);
            restoreZeroSmoothingSnapshot(targetFilename);
        }
        syncPlotSmoothingBaselines(loadedDataForZero, null, {
            source: loadedDataForZero._zeroSmoothingCurves,
            force: true
        });
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            try {
                const channelSnapshot = Object.entries(loadedDataForZero._zeroSmoothingCurves || {}).reduce((acc, [channelName, curve]) => {
                    if (Array.isArray(curve)) {
                        acc[channelName] = curve.reduce((max, value) => (value > max ? value : max), 0);
                    }
                    return acc;
                }, {});
                console.log('[LabNormalization] zero snapshot restore applied', channelSnapshot);
            } catch (zeroLogErr) {
                console.warn('[LabNormalization] zero snapshot restore log failed:', zeroLogErr);
            }
        }
        updateInkChart();
        updateSessionStatus();
        try {
            postLinearizationSummary();
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to post summary after direct zero restore:', err);
            }
        }
        updateCoverageIndicators();
        return;
    }

    if (updatedChannels.length > 0) {
        if (typeof LinearizationState.setGlobalBakedMeta === 'function') {
            try {
                LinearizationState.setGlobalBakedMeta(null);
            } catch (err) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[LabNormalization] Failed to clear global baked meta:', err);
                }
            }
        }

        try {
            const loadedData = getLoadedQuadData?.();
            if (loadedData && loadedData.keyPointsMeta) {
                updatedChannels.forEach((channelName) => {
                    const meta = loadedData.keyPointsMeta[channelName];
                    if (meta && meta.bakedGlobal) {
                        delete meta.bakedGlobal;
                    }
                });
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to scrub baked metadata:', err);
            }
        }

        rebaseChannelsToCorrectedCurves(updatedChannels, {
            source: 'labNormalizationChange',
            useOriginalBaseline: true,
            resetEndsToBaseline: true
        });
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            try {
                const loadedData = getLoadedQuadData?.();
                if (loadedData && Array.isArray(updatedChannels) && updatedChannels.length) {
                    const snapshot = updatedChannels.reduce((acc, channelName) => {
                        const curve = Array.isArray(loadedData.curves?.[channelName])
                            ? loadedData.curves[channelName]
                            : null;
                        if (curve) {
                            acc[channelName] = curve.reduce((max, value) => (value > max ? value : max), 0);
                        }
                        return acc;
                    }, {});
                    console.log('[LabNormalization] post-rebase maxima', snapshot);
                }
            } catch (rebaseLogErr) {
                console.warn('[LabNormalization] post-rebase maxima log failed:', rebaseLogErr);
            }
        }
        updateInkChart();
        updateSessionStatus();
        try {
            postLinearizationSummary();
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to post summary:', err);
            }
        }
        updateCoverageIndicators();
    }

    if (smoothingPercent <= 0) {
        try {
            const currentGlobal = LinearizationState.getGlobalData?.();
            const restored = restoreZeroSmoothingSnapshot(currentGlobal?.filename);
            if (!restored) {
                applyPlotSmoothingToLoadedChannels(0);
            }
        } catch (restoreErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to restore zero-smoothing curves after normalization:', restoreErr);
            }
        }
        try {
            const loadedData = getLoadedQuadData?.();
            if (loadedData && loadedData._originalBaselineEnd && typeof loadedData._originalBaselineEnd === 'object') {
                Object.entries(loadedData._originalBaselineEnd).forEach(([channelName, originalEnd]) => {
                    const curve = Array.isArray(loadedData.curves?.[channelName]) ? loadedData.curves[channelName] : null;
                    const targetEnd = Number(originalEnd);
                    if (!curve || !Number.isFinite(targetEnd) || targetEnd <= 0) {
                        return;
                    }
                    const currentMax = curve.reduce((max, value) => (value > max ? value : max), 0);
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[LabNormalization] baseline restore check', {
                            channelName,
                            currentMax,
                            targetEnd
                        });
                    }
                    if (Math.abs(currentMax - targetEnd) <= 0.5) {
                        if (loadedData.baselineEnd && typeof loadedData.baselineEnd === 'object') {
                            loadedData.baselineEnd[channelName] = targetEnd;
                        }
                        if (loadedData._plotSmoothingOriginalEnds && typeof loadedData._plotSmoothingOriginalEnds === 'object') {
                            loadedData._plotSmoothingOriginalEnds[channelName] = targetEnd;
                        }
                        return;
                    }
                    const rescaled = rescaleCurveToEnd(curve, targetEnd);
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[LabNormalization] Rescaling baseline', channelName, {
                            currentMax,
                            targetEnd,
                            scaledMax: Math.max(...rescaled)
                        });
                    }
                    loadedData.curves[channelName] = rescaled.slice();
                    if (loadedData.rebasedCurves && typeof loadedData.rebasedCurves === 'object') {
                        loadedData.rebasedCurves[channelName] = rescaled.slice();
                    }
                    if (loadedData.rebasedSources && typeof loadedData.rebasedSources === 'object') {
                        loadedData.rebasedSources[channelName] = rescaled.slice();
                    }
                    if (loadedData.plotBaseCurves && typeof loadedData.plotBaseCurves === 'object') {
                        loadedData.plotBaseCurves[channelName] = rescaled.slice();
                        ensureBaselineStore(loadedData, channelName, rescaled);
                    }
                    if (loadedData._plotSmoothingOriginalCurves && typeof loadedData._plotSmoothingOriginalCurves === 'object') {
                        loadedData._plotSmoothingOriginalCurves[channelName] = rescaled.slice();
                    }
                    if (loadedData._plotSmoothingBaselineCurves && typeof loadedData._plotSmoothingBaselineCurves === 'object') {
                        loadedData._plotSmoothingBaselineCurves[channelName] = rescaled.slice();
                    }
                    if (loadedData._plotSmoothingOriginalEnds && typeof loadedData._plotSmoothingOriginalEnds === 'object') {
                        loadedData._plotSmoothingOriginalEnds[channelName] = targetEnd;
                    }
                    if (loadedData.baselineEnd && typeof loadedData.baselineEnd === 'object') {
                        loadedData.baselineEnd[channelName] = targetEnd;
                    }
                });
                if (LinearizationState && typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                    LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
                }
                const baselineSnapshot = cloneBaselineCurvesFromLoadedData(loadedData);
                if (baselineSnapshot && LinearizationState && typeof LinearizationState.setGlobalBaselineCurves === 'function') {
                    LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
                }
            }
        } catch (scaleErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to rescale curves to original baseline:', scaleErr);
            }
        }
        try {
            const loadedData = getLoadedQuadData?.();
            if (loadedData) {
                syncPlotSmoothingBaselines(loadedData, null, { source: 'curves', force: true });
            }
        } catch (baselineSyncErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to synchronize plot smoothing baselines:', baselineSyncErr);
            }
        }
        try {
            applyPlotSmoothingToLoadedChannels(0);
        } catch (plotErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to reapply zero plot smoothing after normalization:', plotErr);
            }
        }
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            try {
                const loadedData = getLoadedQuadData?.();
                if (loadedData && loadedData.curves) {
                    const summary = Object.entries(loadedData.curves).reduce((acc, [channelName, curve]) => {
                        if (Array.isArray(curve)) {
                            acc[channelName] = curve.reduce((max, value) => (value > max ? value : max), 0);
                        }
                        return acc;
                    }, {});
                    console.log('[LabNormalization] after zero plot smoothing apply', summary);
                }
            } catch (afterPlotLogErr) {
                console.warn('[LabNormalization] Log after zero smoothing apply failed:', afterPlotLogErr);
            }
        }
        try {
            const currentGlobal = LinearizationState.getGlobalData?.();
            restoreZeroSmoothingSnapshot(currentGlobal?.filename);
        } catch (secondaryRestoreErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Subsequent zero-snapshot restore failed:', secondaryRestoreErr);
            }
        }
        try {
            const loadedData = getLoadedQuadData?.();
            const zeroSnapshot = loadedData && loadedData._zeroSmoothingCurves && typeof loadedData._zeroSmoothingCurves === 'object'
                ? loadedData._zeroSmoothingCurves
                : null;
            if (zeroSnapshot) {
                if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
                    loadedData._plotSmoothingOriginalCurves = {};
                }
                if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
                    loadedData.plotBaseCurves = {};
                }
                if (!loadedData._plotSmoothingOriginalEnds || typeof loadedData._plotSmoothingOriginalEnds !== 'object') {
                    loadedData._plotSmoothingOriginalEnds = {};
                }
                if (!loadedData.curves || typeof loadedData.curves !== 'object') {
                    loadedData.curves = {};
                }
                if (!loadedData.rebasedCurves || typeof loadedData.rebasedCurves !== 'object') {
                    loadedData.rebasedCurves = {};
                }
                if (!loadedData.rebasedSources || typeof loadedData.rebasedSources !== 'object') {
                    loadedData.rebasedSources = {};
                }
                if (!loadedData.baselineEnd || typeof loadedData.baselineEnd !== 'object') {
                    loadedData.baselineEnd = {};
                }
                Object.entries(zeroSnapshot).forEach(([channelName, curve]) => {
                    if (!Array.isArray(curve)) {
                        return;
                    }
                    const cloned = curve.slice();
                    const peak = cloned.reduce((max, value) => (value > max ? value : max), 0);
                    loadedData._plotSmoothingOriginalCurves[channelName] = cloned.slice();
                    loadedData.plotBaseCurves[channelName] = cloned.slice();
                    ensureBaselineStore(loadedData, channelName, cloned);
                    loadedData.curves[channelName] = cloned.slice();
                    loadedData.rebasedCurves[channelName] = cloned.slice();
                    loadedData.rebasedSources[channelName] = cloned.slice();
                    if (Number.isFinite(peak) && peak > 0) {
                        if (!Number.isFinite(loadedData._plotSmoothingOriginalEnds[channelName]) || peak > loadedData._plotSmoothingOriginalEnds[channelName]) {
                            loadedData._plotSmoothingOriginalEnds[channelName] = peak;
                        }
                        loadedData.baselineEnd[channelName] = peak;
                    }
                });
                if (LinearizationState && typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                    try {
                        LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
                    } catch (correctedErr) {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.warn('[LabNormalization] Failed to push corrected curves after zero snapshot sync:', correctedErr);
                        }
                    }
                }
                const baselineSnapshot = cloneBaselineCurvesFromLoadedData(loadedData);
                if (baselineSnapshot && LinearizationState && typeof LinearizationState.setGlobalBaselineCurves === 'function') {
                    try {
                        LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
                    } catch (baselineErr) {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.warn('[LabNormalization] Failed to push baseline curves after zero snapshot sync:', baselineErr);
                        }
                    }
                }
            }
        } catch (zeroCurveSyncErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to synchronize zero snapshot into original curves:', zeroCurveSyncErr);
            }
        }
    }

    const isDensity = mode === LAB_NORMALIZATION_MODES.DENSITY;
    const modeLabel = isDensity ? 'log-density (optical)' : 'perceptual L*';
    const extraNote = isDensity ? ' — .quad exports note optical-density mode.' : '';
    showStatus(`Linearization normalization set to ${modeLabel}${extraNote}`);
}

const scheduleNormalizationRefresh = debounce(() => {
    refreshLinearizationDataForNormalization();
}, 250);

function syncSmartPointDragToggle() {
    if (!elements.smartPointDragToggle) {
        return;
    }
    const enabled = isSmartPointDragEnabled();
    elements.smartPointDragToggle.checked = enabled;
    elements.smartPointDragToggle.setAttribute('aria-checked', String(enabled));
}

function initializeSmartPointDragOption() {
    syncSmartPointDragToggle();
    if (!elements.smartPointDragToggle) {
        return;
    }
    elements.smartPointDragToggle.addEventListener('change', (event) => {
        const next = !!event.target.checked;
        setSmartPointDragEnabled(next);
        syncSmartPointDragToggle();
        showStatus(next ? 'Curve point dragging enabled.' : 'Curve point dragging disabled.');
    });
}

function syncCorrectionOverlayToggle() {
    if (!elements.correctionOverlayToggle) {
        return;
    }
    const enabled = isChartDebugShowCorrectionTarget();
    elements.correctionOverlayToggle.checked = enabled;
    elements.correctionOverlayToggle.setAttribute('aria-checked', String(enabled));
}

function initializeCorrectionOverlayOption() {
    syncCorrectionOverlayToggle();
    if (!elements.correctionOverlayToggle) {
        return;
    }
    elements.correctionOverlayToggle.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        setChartDebugShowCorrectionTarget(enabled);
        syncCorrectionOverlayToggle();
        showStatus(enabled ? 'Correction overlay enabled.' : 'Correction overlay disabled.');
    });
}

function syncLabSpotMarkersToggle() {
    if (!elements.labSpotMarkersToggle) {
        return;
    }
    syncLabSpotMarkerToggleAvailability();
    const enabled = isLabSpotMarkerOverlayEnabled();
    elements.labSpotMarkersToggle.checked = enabled;
    elements.labSpotMarkersToggle.setAttribute('aria-checked', String(enabled));
}

function initializeLabSpotMarkersOption() {
    syncLabSpotMarkersToggle();
    if (!elements.labSpotMarkersToggle) {
        return;
    }
    elements.labSpotMarkersToggle.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        setLabSpotMarkerOverlayEnabled(enabled);
        syncLabSpotMarkersToggle();
        const applied = isLabSpotMarkerOverlayEnabled();
        if (applied && enabled) {
            showStatus('Measurement spot markers enabled.');
        } else if (!applied && !enabled) {
            showStatus('Measurement spot markers disabled.');
        }
    });
}

function syncLightBlockingOverlayToggle() {
    if (!elements.lightBlockingOverlayToggle) {
        return;
    }
    const enabled = isChartLightBlockingOverlayEnabled();
    elements.lightBlockingOverlayToggle.checked = enabled;
    elements.lightBlockingOverlayToggle.setAttribute('aria-checked', String(enabled));
}

function initializeLightBlockingOverlayOption() {
    syncLightBlockingOverlayToggle();
    if (!elements.lightBlockingOverlayToggle) {
        return;
    }
    elements.lightBlockingOverlayToggle.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        setChartLightBlockingOverlayEnabled(enabled);
        syncLightBlockingOverlayToggle();
        showStatus(enabled ? 'Light blocking overlay enabled.' : 'Light blocking overlay disabled.');
    });
}

function syncInkLoadOverlayToggle() {
    if (!elements.inkLoadOverlayToggle) {
        return;
    }
    const enabled = isChartInkLoadOverlayEnabled();
    elements.inkLoadOverlayToggle.checked = enabled;
    elements.inkLoadOverlayToggle.setAttribute('aria-checked', String(enabled));
}

function initializeInkLoadOverlayOption() {
    syncInkLoadOverlayToggle();
    if (!elements.inkLoadOverlayToggle) {
        return;
    }
    elements.inkLoadOverlayToggle.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        setChartInkLoadOverlayEnabled(enabled);
        syncInkLoadOverlayToggle();
        showStatus(enabled ? 'Ink load overlay enabled.' : 'Ink load overlay disabled.');
    });
}

function initializeInkLoadThresholdOption() {
    const input = elements.inkLoadThresholdInput;
    if (!input) {
        return;
    }

    const syncValue = () => {
        const threshold = getInkLoadThreshold();
        input.value = String(threshold);
    };

    const commit = (value, { announce = true } = {}) => {
        const applied = setInkLoadThreshold(value);
        input.value = String(applied);
        if (announce) {
            showStatus(`Ink load warning threshold set to ${applied}%.`);
        }
        try {
            updateInkChart();
        } catch (err) {
            console.warn('Failed to refresh chart after ink load threshold update:', err);
        }
    };

    syncValue();

    input.addEventListener('focus', () => {
        try {
            input.select();
        } catch (err) {
            console.warn('Ink load threshold select failed:', err);
        }
    });

    input.addEventListener('blur', (event) => {
        commit(event.target.value);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            syncValue();
            input.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown') {
            setTimeout(() => commit(input.value, { announce: false }), 0);
        }
    });

    input.addEventListener('input', (event) => {
        const nativeEvent = (typeof InputEvent !== 'undefined' && event instanceof InputEvent) ? event : null;
        if (nativeEvent && typeof nativeEvent.inputType === 'string') {
            const skipTypes = new Set([
                'insertText',
                'deleteContentBackward',
                'deleteContentForward',
                'deleteByCut',
                'deleteByDrag',
                'insertFromDrop'
            ]);
            if (skipTypes.has(nativeEvent.inputType)) {
                return;
            }
        }
        commit(event.target.value, { announce: false });
    });
}

function syncCompositeDebugToggle() {
    if (!elements.compositeDebugToggle) {
        return;
    }
    const enabled = isCompositeDebugEnabled();
    elements.compositeDebugToggle.checked = enabled;
    elements.compositeDebugToggle.setAttribute('aria-checked', String(enabled));
}

function initializeCompositeDebugOption() {
    syncCompositeDebugToggle();
    if (!elements.compositeDebugToggle) {
        return;
    }
    if (unsubscribeCompositeDebugState) {
        unsubscribeCompositeDebugState();
        unsubscribeCompositeDebugState = null;
    }
    unsubscribeCompositeDebugState = subscribeCompositeDebugState(() => {
        syncCompositeDebugToggle();
    });
    elements.compositeDebugToggle.addEventListener('change', (event) => {
        const next = !!event.target.checked;
        setCompositeDebugEnabled(next);
        syncCompositeDebugToggle();
        if (next) {
            try {
                replayCompositeDebugSessionFromCache();
            } catch (error) {
                console.warn('[CompositeDebug] Failed to replay cached session:', error);
            }
        }
        showStatus(next ? 'Composite debug overlay enabled.' : 'Composite debug overlay disabled.');
    });
}

function syncRedistributionSmoothingToggle() {
    if (!elements.redistributionSmoothingToggle) {
        return;
    }
    const enabled = isRedistributionSmoothingWindowEnabled();
    elements.redistributionSmoothingToggle.checked = enabled;
    elements.redistributionSmoothingToggle.setAttribute('aria-checked', String(enabled));
}

function initializeRedistributionSmoothingOption() {
    syncRedistributionSmoothingToggle();
    if (!elements.redistributionSmoothingToggle) {
        return;
    }
    elements.redistributionSmoothingToggle.addEventListener('change', (event) => {
        const next = !!event.target.checked;
        setRedistributionSmoothingWindowEnabled(next);
        syncRedistributionSmoothingToggle();
        showStatus(next ? 'Redistribution smoothing window enabled.' : 'Redistribution smoothing window disabled.');
    });
}

function syncAutoRaiseInkToggle() {
    if (!elements.autoRaiseInkToggle) {
        return;
    }
    const enabled = isAutoRaiseInkLimitsEnabled();
    elements.autoRaiseInkToggle.checked = enabled;
    elements.autoRaiseInkToggle.setAttribute('aria-checked', String(enabled));
}

function initializeAutoRaiseInkOption() {
    syncAutoRaiseInkToggle();
    if (!elements.autoRaiseInkToggle) {
        return;
    }
    elements.autoRaiseInkToggle.addEventListener('change', (event) => {
        const next = !!event.target.checked;
        setAutoRaiseInkLimitsEnabled(next);
        syncAutoRaiseInkToggle();
        showStatus(next ? 'Auto-raise ink limits enabled.' : 'Auto-raise ink limits disabled.');
    });
}

function syncCompositeWeightingSelect() {
    if (!elements.compositeWeightingSelect) {
        return;
    }
    const mode = getCompositeWeightingMode();
    elements.compositeWeightingSelect.value = mode;
}

function initializeCompositeWeightingOption() {
    syncCompositeWeightingSelect();
    if (!elements.compositeWeightingSelect) {
        return;
    }
    if (unsubscribeCompositeWeightingMode) {
        unsubscribeCompositeWeightingMode();
        unsubscribeCompositeWeightingMode = null;
    }
    unsubscribeCompositeWeightingMode = subscribeCompositeWeightingMode(() => {
        syncCompositeWeightingSelect();
        resetPlotSmoothingCaches();
        schedulePlotSmoothingRefresh();
        scheduleCompositeWeightingRefresh();
    });

    elements.compositeWeightingSelect.addEventListener('change', (event) => {
        const selection = typeof event.target?.value === 'string' ? event.target.value : '';
        const applied = setCompositeWeightingMode(selection);
        syncCompositeWeightingSelect();
        resetPlotSmoothingCaches();
        schedulePlotSmoothingRefresh();
        scheduleCompositeWeightingRefresh();
        const labelMap = {
            [COMPOSITE_WEIGHTING_MODES.ISOLATED]: 'Isolated',
            [COMPOSITE_WEIGHTING_MODES.NORMALIZED]: 'Normalized',
            [COMPOSITE_WEIGHTING_MODES.MOMENTUM]: 'Momentum',
            [COMPOSITE_WEIGHTING_MODES.EQUAL]: 'Equal'
        };
        const label = labelMap[applied] || 'Isolated';
        showStatus(`Composite weighting set to ${label}.`);
    });
}

function initializeLabNormalizationHandlers() {
    syncLabNormalizationCheckboxes();
    syncLabSmoothingControls();

    if (elements.labDensityToggle) {
        elements.labDensityToggle.addEventListener('change', (event) => {
            const mode = event.target.checked ? LAB_NORMALIZATION_MODES.DENSITY : LAB_NORMALIZATION_MODES.LSTAR;
            setLabNormalizationMode(mode);
        });
    }

    if (elements.manualLstarDensityToggle) {
        elements.manualLstarDensityToggle.addEventListener('change', (event) => {
            const mode = event.target.checked ? LAB_NORMALIZATION_MODES.DENSITY : LAB_NORMALIZATION_MODES.LSTAR;
            setLabNormalizationMode(mode);
        });
    }

    if (elements.labSmoothingSlider) {
        elements.labSmoothingSlider.addEventListener('input', (event) => {
            const percent = Number(event.target.value);
            const applied = setLabSmoothingPercent(percent);
            syncLabSmoothingControls(applied);
            scheduleNormalizationRefresh();
        });
    }

    if (unsubscribeLabNormalizationMode) {
        unsubscribeLabNormalizationMode();
        unsubscribeLabNormalizationMode = null;
    }

    unsubscribeLabNormalizationMode = subscribeLabNormalizationMode((mode) => {
        syncLabNormalizationCheckboxes(mode);
        refreshLinearizationDataForNormalization();
    });

    if (unsubscribeLabSmoothingPercent) {
        unsubscribeLabSmoothingPercent();
        unsubscribeLabSmoothingPercent = null;
    }

    unsubscribeLabSmoothingPercent = subscribeLabSmoothingPercent((percent) => {
        syncLabSmoothingControls(percent);
        scheduleNormalizationRefresh();
        const widen = mapSmoothingPercentToWiden(percent);
        showStatus(`LAB smoothing set to ${percent}% (widen ≈ ${widen.toFixed(2)}×).`);
        const numeric = Number(percent) || 0;
        if (numeric <= 0) {
            try {
                const currentGlobal = LinearizationState.getGlobalData?.();
                restoreZeroSmoothingSnapshot(currentGlobal?.filename);
                applyPlotSmoothingToLoadedChannels(0);
            } catch (err) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[LabNormalization] Failed to restore zero snapshot on smoothing reset:', err);
                }
            }
        }
    });
}

function syncCorrectionMethodRadios(method = getCorrectionMethod()) {
    if (!Array.isArray(elements.correctionMethodRadios) || !elements.correctionMethodRadios.length) {
        return;
    }
    elements.correctionMethodRadios.forEach((input) => {
        if (!input) return;
        const checked = input.value === method;
        input.checked = checked;
        input.setAttribute('aria-checked', String(checked));
    });
}

function initializeCorrectionMethodOption() {
    syncCorrectionMethodRadios();

    if (Array.isArray(elements.correctionMethodRadios)) {
        elements.correctionMethodRadios.forEach((input) => {
            if (!input) return;
            input.addEventListener('change', (event) => {
                if (!event.target.checked) return;
                const next = setCorrectionMethod(event.target.value);
                updateAppState({ correctionMethod: next });
                syncCorrectionMethodRadios(next);
                const message = next === CORRECTION_METHODS.SIMPLE_SCALING
                    ? 'Correction method set to Simple Scaling (legacy).'
                    : 'Correction method set to Density Solver (advanced).';
                showStatus(message);
                scheduleNormalizationRefresh();
            });
        });
    }

    if (unsubscribeCorrectionMethod) {
        unsubscribeCorrectionMethod();
    }
    unsubscribeCorrectionMethod = subscribeCorrectionMethod((method) => {
        updateAppState({ correctionMethod: method });
        syncCorrectionMethodRadios(method);
        scheduleNormalizationRefresh();
    });
}

/**
 * Initialize all UI event handlers
 * Should be called after DOM is ready and elements are initialized
 */
export function initializeEventHandlers() {
    console.log('🎛️ Initializing UI event handlers...');

    if (typeof window !== 'undefined') {
        scalingCoordinator.setEnabled(!!window.__USE_SCALING_COORDINATOR);
    }

    // Core UI handlers
    initializeUndoRedoHandlers();
    initializeDownloadHandlers();
    initializeKeyboardShortcuts();
    initializePrinterHandlers();
    initializeFilenameHandlers();
    initializeScaleHandlers();
    initializeChartHandlers();
    initializeChannelRowHandlers();
    initializeFileHandlers();
    initializeContrastIntentHandlers();
    initializeEditModeHandlers();
    initializeHelpSystem();
    initializeLabNormalizationHandlers();
    initializeCorrectionMethodOption();
    initializePlotSmoothingHandlers();
    initializeCorrectionGainOption();
    initializeSmartPointDragOption();
    initializeCorrectionOverlayOption();
    initializeLabSpotMarkersOption();
    initializeLightBlockingOverlayOption();
    initializeInkLoadOverlayOption();
    initializeInkLoadThresholdOption();
    initializeCompositeWeightingOption();
    initializeRedistributionSmoothingOption();
    initializeAutoRaiseInkOption();
    initializeCompositeDebugOption();

    console.log('✅ UI event handlers initialized');
}

/**
 * Initialize undo/redo button handlers
 */
function initializeUndoRedoHandlers() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            // Note: CurveHistory will be available from extracted modules
            if (typeof CurveHistory !== 'undefined') {
                const result = CurveHistory.undo();
                if (!result.success) {
                    showStatus(`Undo failed: ${result.message}`);
                }
            } else {
                console.warn('CurveHistory not available - undo functionality requires history module');
            }
        });
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            if (typeof CurveHistory !== 'undefined') {
                const result = CurveHistory.redo();
                if (!result.success) {
                    showStatus(`Redo failed: ${result.message}`);
                }
            } else {
                console.warn('CurveHistory not available - redo functionality requires history module');
            }
        });
    }
}

/**
 * Initialize download button handlers
 */
function initializeDownloadHandlers() {
    if (!elements.downloadBtn) return;

    elements.downloadBtn.addEventListener('click', () => {
        try {
            // Note: buildFile will be available from extracted modules
            if (typeof buildFile === 'undefined') {
                console.warn('buildFile not available - download functionality requires file building module');
                showStatus('Download functionality not yet available in modular build');
                return;
            }

            const text = buildFile();
            const p = getCurrentPrinter();

            // Get custom filename or use default
            let filename;
            const customName = elements.filenameInput?.value?.trim() || '';

            if (customName) {
                // Remove .quad extension if user added it, then sanitize
                const cleanName = customName.replace(/\.quad$/, '');
                const sanitizedName = sanitizeFilename(cleanName);

                // If sanitization removed everything, fall back to default
                if (!sanitizedName) {
                    const defaultBase = sanitizeFilename(p.name.replace(/\s+/g, '')) || 'quadGEN';
                    filename = defaultBase + "_linear.quad";
                    showStatus("Invalid filename, using default");
                } else {
                    filename = sanitizedName + '.quad';

                    // Show warning if filename was changed
                    if (sanitizedName !== cleanName) {
                        showStatus(`Filename sanitized: ${filename}`);
                    }
                }
            } else {
                // Use default naming (sanitized printer name)
                const defaultBase = sanitizeFilename(p.name.replace(/\s+/g, '')) || 'quadGEN';
                filename = defaultBase + "_linear.quad";
            }

            // Download the file
            downloadFile(text, filename, 'text/plain;charset=utf-8');
            showStatus(`Downloaded ${filename}`);

        } catch (error) {
            console.error('Download error:', error);
            showStatus("Error downloading file");
        }
    });
}

/**
 * Initialize keyboard shortcuts
 */
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    if (elements.downloadBtn) {
                        elements.downloadBtn.click();
                    }
                    break;
                case 'r':
                    e.preventDefault();
                    if (typeof updatePreview !== 'undefined') {
                        updatePreview();
                    }
                    break;
            }
        }
    });
}

/**
 * Initialize printer selection handlers
 */
function initializePrinterHandlers() {
    if (!elements.printerSelect) return;

    elements.printerSelect.addEventListener('change', (e) => {
        setPrinter(e.target.value);
    });
}

/**
 * Initialize filename input handlers with real-time validation
 */
function initializeFilenameHandlers() {
    if (!elements.filenameInput) return;

    elements.filenameInput.addEventListener('input', (e) => {
        const input = e.target;
        const value = input.value.trim();

        // Mark as user-edited if they've typed something different from auto-generated
        if (value !== generateFilename()) {
            input.dataset.userEdited = 'true';
        } else {
            delete input.dataset.userEdited;
        }

        if (value) {
            const cleanName = value.replace(/\.quad$/, '');
            const sanitized = sanitizeFilename(cleanName);
            const hasInvalidChars = sanitized !== cleanName;

            // Visual feedback for invalid characters
            input.classList.toggle('border-yellow-300', hasInvalidChars);
            input.classList.toggle('bg-yellow-50', hasInvalidChars);
            input.classList.toggle('border-gray-300', !hasInvalidChars);
            input.classList.toggle('bg-white', !hasInvalidChars);

            if (hasInvalidChars) {
                input.title = `Will be saved as: ${sanitized}.quad`;
            } else {
                input.title = '';
            }
        } else {
            input.classList.remove('border-yellow-300', 'bg-yellow-50');
            input.classList.add('border-gray-300', 'bg-white');
            input.title = '';
        }
    });
}

/**
 * Initialize global scale input handlers
 */
function initializeScaleHandlers() {
    if (!elements.scaleAllInput && isBrowser) {
        elements.scaleAllInput = document.getElementById('scaleAllInput');
    }

    if (!elements.scaleAllInput) {
        if (isBrowser && scaleHandlerRetryCount < SCALE_HANDLER_MAX_RETRIES) {
            scaleHandlerRetryCount += 1;
            globalScope.setTimeout(() => {
                initializeScaleHandlers();
            }, 50 * scaleHandlerRetryCount);
        } else {
            console.warn('Scale handlers unable to locate #scaleAllInput element. Dual-read subscription not initialized.');
        }
        return;
    }

    scaleHandlerRetryCount = 0;

    if (isBrowser && !scalingStateFlagListenerAttached) {
        globalScope.addEventListener(SCALING_STATE_FLAG_EVENT, () => {
            console.log('🔁 [SCALE STATE] flag event received', globalScope.__USE_SCALING_STATE);
            configureScalingStateSubscription();
        });
        scalingStateFlagListenerAttached = true;
        globalScope.__scalingStateListenerReady = true;
    }

    configureScalingStateSubscription();
    refreshGlobalScaleLockState();

    const MIN_SCALE = 1;
    const MAX_SCALE = 1000;

    // Debounce rapid scale changes to prevent chart update race conditions
    let scaleDebounceTimeout = null;

    const commitScaleAll = (raw, immediate = false) => {
        console.log(`🔍 [SCALE DEBUG] commitScaleAll called:`, {
            raw,
            immediate,
            timestamp: Date.now(),
            callStack: new Error().stack.split('\n').slice(1, 4)
        });

        if (!elements.scaleAllInput) {
            console.log(`🔍 [SCALE DEBUG] No scaleAllInput element found`);
            return;
        }

        const lockedChannels = getLockedChannels(getCurrentPrinter()?.channels || []);
        if (lockedChannels.length > 0) {
            const lockMessage = getGlobalScaleLockMessage(lockedChannels);
            showStatus(lockMessage);
            elements.scaleAllInput.value = formatScalePercent(getCurrentScale());
            refreshGlobalScaleLockState();
            return;
        }

        let parsed = parseFloat(raw);
        console.log(`🔍 [SCALE DEBUG] Parsed value:`, { raw, parsed });

        if (!Number.isFinite(parsed)) {
            console.warn('🔍 [SCALE DEBUG] Invalid scale value:', raw);
            elements.scaleAllInput.value = '100';
            return;
        }

        // Clamp to valid range
        const beforeClamp = parsed;
        parsed = Math.max(MIN_SCALE, Math.min(MAX_SCALE, parsed));
        console.log(`🔍 [SCALE DEBUG] After clamping:`, { beforeClamp, afterClamp: parsed });

        // Always clear any pending debounced update
        if (scaleDebounceTimeout) {
            console.log(`🔍 [SCALE DEBUG] Clearing existing debounce timeout:`, scaleDebounceTimeout);
            clearTimeout(scaleDebounceTimeout);
            scaleDebounceTimeout = null;
        }

        // Critical: Only scale if there's actually a change (like legacy system)
        const currentScale = getCurrentScale();
        const needsChange = Math.abs(parsed - currentScale) > 0.0001;

        console.log(`🔍 [SCALE DEBUG] Change detection:`, {
            parsed,
            currentScale,
            difference: Math.abs(parsed - currentScale),
            needsChange,
            threshold: 0.0001
        });

        if (!needsChange) {
            // No change needed - just update the input display
            console.log(`🔍 [SCALE DEBUG] No change needed - updating input only`);
            elements.scaleAllInput.value = parsed.toString();
            return;
        }

        elements.scaleAllInput.value = parsed.toString();
        console.log(`🔍 [SCALE DEBUG] Input value updated to:`, parsed.toString());

        const handleCoordinatorError = (error) => {
            console.error('Scaling coordinator error:', error);
            if (elements.scaleAllInput) {
                elements.scaleAllInput.value = formatScalePercent(getCurrentScale());
            }
        };

        if (immediate) {
            console.log(`🔍 [SCALE DEBUG] Executing immediate scaling via coordinator (${parsed})`);
            scalingCoordinator
                .scale(parsed, 'ui', { priority: 'high', metadata: { trigger: 'commitScaleAllImmediate' } })
                .then(() => refreshEffectiveInkDisplays())
                .catch(handleCoordinatorError);
        } else {
            console.log(`🔍 [SCALE DEBUG] Setting up debounced coordinator scaling for:`, parsed);
            scaleDebounceTimeout = setTimeout(() => {
                console.log(`🔍 [SCALE DEBUG] Executing debounced coordinator scaling (${parsed})`);
                scalingCoordinator
                    .scale(parsed, 'ui', { metadata: { trigger: 'commitScaleAllDebounce' } })
                    .then(() => refreshEffectiveInkDisplays())
                    .catch(handleCoordinatorError);
            }, 100);
            console.log(`🔍 [SCALE DEBUG] Coordinator debounce timeout set:`, scaleDebounceTimeout);
        }
    };

    // Focus handler: select all text
    elements.scaleAllInput.addEventListener('focus', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input FOCUS event`);
        if (elements.scaleAllInput) {
            elements.scaleAllInput.select();
        }
    });

    // Blur handler: commit changes (but not if Enter was just pressed)
    let enterJustPressed = false;
    elements.scaleAllInput.addEventListener('blur', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input BLUR event:`, {
            value: e.target.value,
            enterJustPressed,
            timestamp: Date.now()
        });

        if (enterJustPressed) {
            console.log(`🔍 [EVENT DEBUG] Skipping blur processing - Enter was just pressed`);
            enterJustPressed = false; // Reset flag
            return; // Skip blur processing after Enter
        }

        console.log(`🔍 [EVENT DEBUG] Processing blur - calling commitScaleAll("${e.target.value}", false)`);
        commitScaleAll(e.target.value);
    });

    // Keydown handler: Enhanced handling like original
    elements.scaleAllInput.addEventListener('keydown', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input KEYDOWN event:`, {
            key: e.key,
            value: e.target.value,
            timestamp: Date.now()
        });

        if (e.key === 'Enter') {
            console.log(`🔍 [EVENT DEBUG] Enter key pressed - preventing default and setting enterJustPressed flag`);
            e.preventDefault();
            enterJustPressed = true; // Set flag to prevent blur handler
            console.log(`🔍 [EVENT DEBUG] Calling commitScaleAll("${e.target.value}", true) for Enter`);
            commitScaleAll(e.target.value, true); // immediate = true
            console.log(`🔍 [EVENT DEBUG] Calling blur() after Enter processing`);
            e.target.blur();
        } else if (e.key === 'Escape') {
            console.log(`🔍 [EVENT DEBUG] Escape key pressed - resetting to current scale`);
            e.preventDefault();
            // Reset to current stored value
            const currentScale = getCurrentScale();
            console.log(`🔍 [EVENT DEBUG] Resetting to current scale:`, currentScale);
            elements.scaleAllInput.value = currentScale.toString();
            e.target.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
            console.log(`🔍 [EVENT DEBUG] Arrow/Page key pressed:`, e.key);
            // Clear any pending debounced update to prevent conflicts
            if (scaleDebounceTimeout) {
                console.log(`🔍 [EVENT DEBUG] Clearing existing debounce timeout for arrow key`);
                clearTimeout(scaleDebounceTimeout);
                scaleDebounceTimeout = null;
            }
            // Allow default increment/decrement, then commit the new value on the next frame
            console.log(`🔍 [EVENT DEBUG] Setting up next-frame commit for arrow key`);
            setTimeout(() => {
                console.log(`🔍 [EVENT DEBUG] Executing next-frame commit for arrow key - value:`, elements.scaleAllInput.value);
                commitScaleAll(elements.scaleAllInput.value);
            }, 0);
        }
    });

    // Input handler: Real-time scaling with simple debounce
    let inputDebounceTimer = null;

    elements.scaleAllInput.addEventListener('input', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input INPUT event:`, {
            value: e.target.value,
            inputType: e.inputType,
            timestamp: Date.now()
        });

        const value = parseFloat(e.target.value);
        const isValid = Number.isFinite(value) && value >= MIN_SCALE && value <= MAX_SCALE;

        console.log(`🔍 [EVENT DEBUG] Input validation:`, { value, isValid, minScale: MIN_SCALE, maxScale: MAX_SCALE });

        // Visual feedback
        e.target.classList.toggle('border-red-300', !isValid);
        e.target.classList.toggle('border-gray-300', isValid);

        // Real-time scaling with debounce
        if (isValid) {
            if (inputDebounceTimer) {
                clearTimeout(inputDebounceTimer);
            }

            inputDebounceTimer = setTimeout(() => {
                console.log(`🔍 [EVENT DEBUG] Debounced input scaling - value:`, value);

                scalingCoordinator
                    .scale(value, 'ui-input', { metadata: { trigger: 'inputDebounce' } })
                    .catch((error) => {
                        console.error('Scaling coordinator input error:', error);
                        if (elements.scaleAllInput) {
                            elements.scaleAllInput.value = formatScalePercent(getCurrentScale());
                        }
                    });
            }, 150); // 150ms debounce
        }

        console.log(`🔍 [EVENT DEBUG] Input event - real-time scaling ${isValid ? 'enabled' : 'disabled'}`);
    });
}

/**
 * Initialize chart interaction handlers
 */
function initializeChartHandlers() {
    // Chart zoom handlers
    if (elements.chartZoomInBtn) {
        elements.chartZoomInBtn.addEventListener('click', () => {
            stepChartZoom(1); // Zoom in
        });
    }

    if (elements.chartZoomOutBtn) {
        elements.chartZoomOutBtn.addEventListener('click', () => {
            stepChartZoom(-1); // Zoom out
        });
    }

    // AI label toggle
    if (elements.aiLabelToggle) {
        elements.aiLabelToggle.addEventListener('change', () => {
            if (typeof updateChartLabels !== 'undefined') {
                updateChartLabels();
            }
        });
    }
}

/**
 * Initialize channel row input handlers
 * This handles the dynamic channel percentage and end value inputs
 */
function initializeChannelRowHandlers() {
    if (!elements.rows) return;

    // Use event delegation for dynamically created channel rows
    elements.rows.addEventListener('input', (e) => {
        const target = e.target;

        if (target.classList.contains('percent-input')) {
            handlePercentInput(target, { commit: false });
        } else if (target.classList.contains('end-input')) {
            handleEndInput(target, { commit: false });
        }
    });

    elements.rows.addEventListener('change', (e) => {
        const target = e.target;

        if (target.classList.contains('percent-input')) {
            handlePercentInput(target, { commit: true });
        } else if (target.classList.contains('end-input')) {
            handleEndInput(target, { commit: true });
        }
    });

    // Custom event for when channels are changed
    elements.rows.addEventListener('channelsChanged', () => {
        if (typeof updatePreview !== 'undefined') {
            updatePreview();
        }
    });
}

function getBasePercentFromInput(input) {
    if (!input) return 0;
    const data = input.getAttribute('data-base-percent');
    return InputValidator.clampPercent(data !== null ? data : input.value);
}

function getBaseEndFromInput(input) {
    if (!input) return 0;
    const data = input.getAttribute('data-base-end');
    return InputValidator.clampEnd(data !== null ? data : input.value);
}

function setBasePercentOnInput(input, value) {
    if (!input) return;
    const clamped = InputValidator.clampPercent(value);
    input.setAttribute('data-base-percent', String(clamped));
}

function setBaseEndOnInput(input, value) {
    if (!input) return;
    const clamped = InputValidator.clampEnd(value);
    input.setAttribute('data-base-end', String(clamped));
}

function getRowBaselines(row) {
    if (!row) return { percent: 0, end: 0 };
    const percentInput = row.querySelector('.percent-input');
    const endInput = row.querySelector('.end-input');
    return {
        percent: getBasePercentFromInput(percentInput),
        end: getBaseEndFromInput(endInput)
    };
}

function ensureOriginalInkSnapshot(row, channelName) {
    if (!row || !channelName) return;

    const percentInput = row.querySelector('.percent-input');
    const endInput = row.querySelector('.end-input');

    const percentValue = percentInput ? InputValidator.clampPercent(percentInput.value) : 0;
    const endValue = endInput ? InputValidator.clampEnd(endInput.value) : 0;

    if (!row.dataset.originalPercent) {
        row.dataset.originalPercent = String(percentValue);
    }
    if (!row.dataset.originalEnd) {
        row.dataset.originalEnd = String(endValue);
    }

    if (typeof getStateManager === 'function') {
        try {
            const manager = getStateManager();
            const existing = manager?.get(`printer.channelOriginalValues.${channelName}`);
            if (!existing) {
                manager.set(
                    `printer.channelOriginalValues.${channelName}`,
                    { percent: percentValue, end: endValue },
                    { skipHistory: true, allowDuringRestore: true }
                );
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[INK SNAPSHOT] Unable to persist original values for', channelName, err);
            }
        }
    }
}

function markPendingCommitHold(input, numericValue) {
    if (!input) return;
    input.dataset.pendingCommitValue = String(numericValue);
    input.dataset.pendingCommitTimestamp = String(Date.now());
}

function clearPendingCommitHold(input) {
    if (!input) return;
    delete input.dataset.pendingCommitValue;
    delete input.dataset.pendingCommitTimestamp;
}

function formatPercentDisplay(value) {
    if (!Number.isFinite(value)) return '0';
    const roundedInt = Math.round(value);
    if (Math.abs(value - roundedInt) < 0.05) {
        return String(roundedInt);
    }
    return Number(value.toFixed(1)).toString();
}

function resolvePendingCommitHold(input, computedValue, tolerance = 0.5) {
    if (!input) {
        return { hold: false, value: null };
    }

    if (input.dataset.userEditing === 'true') {
        const current = Number(input.value);
        return {
            hold: true,
            value: Number.isFinite(current) ? current : computedValue
        };
    }

    const pendingValueRaw = input.dataset.pendingCommitValue;
    if (pendingValueRaw == null) {
        return { hold: false, value: null };
    }

    const pendingValue = Number(pendingValueRaw);
    if (!Number.isFinite(pendingValue)) {
        clearPendingCommitHold(input);
        return { hold: false, value: null };
    }

    const delta = Math.abs(pendingValue - Number(computedValue));
    if (delta <= tolerance) {
        clearPendingCommitHold(input);
        return { hold: false, value: null };
    }

    return { hold: true, value: pendingValue };
}

function refreshEffectiveInkDisplays() {
    if (!elements.rows) return;

    if (typeof isSmartPointDragActive === 'function' && isSmartPointDragActive()) {
        return;
    }

    const rows = elements.rows.querySelectorAll('tr.channel-row[data-channel]');
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
    rows.forEach((row) => {
        const channelName = row.getAttribute('data-channel');
        if (!channelName) return;
        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        if (!percentInput || !endInput) return;

        const percentActive = percentInput?.dataset.userEditing === 'true';
        const endActive = endInput?.dataset.userEditing === 'true';

        ensureOriginalInkSnapshot(row, channelName);

        if (percentActive || endActive) {
            return;
        }

        const basePercent = getBasePercentFromInput(percentInput);
        const baseEnd = getBaseEndFromInput(endInput);

        if (baseEnd <= 0 || basePercent <= 0) {
            const clampedPercent = InputValidator.clampPercent(basePercent);
            const clampedEnd = InputValidator.clampEnd(baseEnd);

            const percentDecision = resolvePendingCommitHold(percentInput, clampedPercent, 0.01);
            const endDecision = resolvePendingCommitHold(endInput, clampedEnd, 0.25);

            const percentForState = Number.isFinite(percentDecision.value)
                ? percentDecision.value
                : clampedPercent;
            const endForState = Number.isFinite(endDecision.value)
                ? endDecision.value
                : clampedEnd;

            if (!percentActive && !percentDecision.hold) {
                percentInput.value = formatPercentDisplay(percentForState);
            }
            if (!endActive && !endDecision.hold) {
                endInput.value = String(Math.round(endForState));
            }
            setBasePercentOnInput(percentInput, percentForState);
            setBaseEndOnInput(endInput, endForState);
            return;
        }

        try {
            const curveValues = make256(baseEnd, channelName, true);
            const peakValue = Math.max(...curveValues);
            const effectiveEnd = InputValidator.clampEnd(Math.round(peakValue));
            const effectivePercent = InputValidator.computePercentFromEnd(effectiveEnd);

            const percentDecision = resolvePendingCommitHold(percentInput, effectivePercent, 0.01);
            const endDecision = resolvePendingCommitHold(endInput, effectiveEnd, 0.25);

            const percentForState = Number.isFinite(percentDecision.value)
                ? percentDecision.value
                : effectivePercent;
            const endForState = Number.isFinite(endDecision.value)
                ? endDecision.value
                : effectiveEnd;

            if (!percentActive && !percentDecision.hold) {
                percentInput.value = formatPercentDisplay(percentForState);
            }
            if (!endActive && !endDecision.hold) {
                endInput.value = String(Math.round(endForState));
            }

            setBasePercentOnInput(percentInput, percentForState);
            setBaseEndOnInput(endInput, endForState);

            try {
                const loadedData = ensureLoadedQuadData(() => ({ curves: {}, baselineEnd: {}, sources: {}, keyPoints: {}, keyPointsMeta: {}, rebasedCurves: {}, rebasedSources: {} }));
                if (loadedData) {
                    const originalCurve = Array.isArray(curveValues) ? curveValues.slice() : [];
                    let normalizedCurve = originalCurve.slice();
                    if (endDecision.hold && Array.isArray(normalizedCurve) && normalizedCurve.length) {
                        const currentMax = Math.max(...normalizedCurve);
                        const targetMax = Number.isFinite(endForState) ? endForState : currentMax;
                        if (currentMax > 0 && Number.isFinite(targetMax) && targetMax >= 0 && Math.abs(currentMax - targetMax) > 0.25) {
                            const scaleRatio = targetMax / currentMax;
                            normalizedCurve = normalizedCurve.map((value) => {
                                if (!Number.isFinite(value)) return 0;
                                const scaled = value * scaleRatio;
                                return Math.max(0, Math.min(TOTAL, Math.round(scaled)));
                            });
                        }
                    }

                    loadedData.curves = loadedData.curves || {};
                    loadedData.curves[channelName] = normalizedCurve;

                    loadedData.baselineEnd = loadedData.baselineEnd || {};
                    loadedData.baselineEnd[channelName] = endForState;

                    loadedData.rebasedCurves = loadedData.rebasedCurves || {};
                    loadedData.rebasedCurves[channelName] = Array.isArray(normalizedCurve) ? normalizedCurve.slice() : [];

                    loadedData.rebasedSources = loadedData.rebasedSources || {};
                    if (!Array.isArray(loadedData.rebasedSources[channelName]) || !loadedData.rebasedSources[channelName].length) {
                        loadedData.rebasedSources[channelName] = Array.isArray(normalizedCurve) ? normalizedCurve.slice() : [];
                    }
                }
            } catch (stateErr) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[INK DISPLAY] Unable to update loadedData baselines for', channelName, stateErr);
                }
            }

            if (typeof getStateManager === 'function') {
            try {
                const manager = getStateManager();
                const options = { skipHistory: true, allowDuringRestore: true };
                manager.setChannelValue(channelName, 'percentage', Number(percentForState), options);
                manager.setChannelValue(channelName, 'endValue', Math.round(endForState), options);
                manager.setChannelEnabled(channelName, endForState > 0, options);
            } catch (err) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[INK DISPLAY] Failed to sync state for', channelName, err);
                }
            }
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[INK DISPLAY] Failed to compute effective ink for', channelName, err);
            }
        }
    });

}

function rebaseChannelsToCorrectedCurves(channelNames = [], options = {}) {
    if (!Array.isArray(channelNames) || channelNames.length === 0) {
        return;
    }

    const loadedData = ensureLoadedQuadData(() => ({ curves: {}, baselineEnd: {}, sources: {}, keyPoints: {}, keyPointsMeta: {}, rebasedCurves: {}, rebasedSources: {} }));
    if (!loadedData.rebasedCurves) {
        loadedData.rebasedCurves = {};
    }
    if (!loadedData.rebasedSources) {
        loadedData.rebasedSources = {};
    }
    if (!loadedData.baselineEnd) {
        loadedData.baselineEnd = {};
    }

    const manager = typeof getStateManager === 'function' ? getStateManager() : null;
    const rebased = [];
    const appSnapshot = getAppState();
    const correctionMethod = appSnapshot?.correctionMethod || getCorrectionMethod();
    const globalData = LinearizationState.getGlobalData?.();
    const simpleScalingPreferred = correctionMethod === CORRECTION_METHODS.SIMPLE_SCALING;
    const hasLabMeasurement = simpleScalingPreferred &&
        globalData &&
        isLabLinearizationData(globalData) &&
        Array.isArray(globalData.originalData) &&
        globalData.originalData.length >= 2;
    const useSimpleScaling = !!hasLabMeasurement;

    const isGlobalSource = options.source === 'globalLoad' || options.source === 'globalToggle';
    const globalAppliedState = typeof options.globalAppliedState === 'boolean' ? options.globalAppliedState : undefined;
    const useOriginalBaseline = !!options.useOriginalBaseline;
    const skipScaleBaselineUpdate = !!options.skipScaleBaselineUpdate;

    const channelContexts = [];

    channelNames.forEach((channelName) => {
        const row = getChannelRow(channelName);
        if (!row) return;

        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        if (!percentInput || !endInput) return;

        const perChannelEntry = (options.source === 'perChannelLoad')
            ? (LinearizationState.getPerChannelData?.(channelName) || null)
            : null;

        if (isGlobalSource) {
            try {
                if (loadedData?.keyPointsMeta && loadedData.keyPointsMeta[channelName]) {
                    delete loadedData.keyPointsMeta[channelName].bakedGlobal;
                }
                if (typeof setGlobalBakedState === 'function') {
                    setGlobalBakedState(null, { skipHistory: true });
                }
                if (typeof LinearizationState?.setGlobalBakedMeta === 'function') {
                    const existingMeta = LinearizationState.getGlobalBakedMeta?.();
                    if (existingMeta && Array.isArray(existingMeta.channels)) {
                        const nextChannels = existingMeta.channels.filter((name) => name !== channelName);
                        if (nextChannels.length !== existingMeta.channels.length) {
                            LinearizationState.setGlobalBakedMeta({
                                ...existingMeta,
                                channels: nextChannels
                            });
                        }
                    }
                }
            } catch (metaErr) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[INK REBASE] Failed to clear bakedGlobal metadata during global load:', metaErr);
                }
            }
        }

        if (options.source === 'perChannelLoad') {
            try {
                if (!loadedData.sources || typeof loadedData.sources !== 'object') {
                    loadedData.sources = {};
                }

                const previousTag = loadedData.sources[channelName];
                if (isSmartCurveSourceTag(previousTag)) {
                    delete loadedData.sources[channelName];
                }

                const fmt = typeof perChannelEntry?.format === 'string'
                    ? perChannelEntry.format.toLowerCase()
                    : '';

                let nextTag = 'per-channel';
                if (perChannelEntry?.is3DLUT) {
                    nextTag = 'per-lut';
                } else if (fmt.includes('lab') || fmt.includes('manual')) {
                    nextTag = 'per-lab';
                } else if (fmt.includes('acv')) {
                    nextTag = 'per-acv';
                }

                loadedData.sources[channelName] = nextTag;

                if (loadedData.keyPointsMeta && loadedData.keyPointsMeta[channelName]) {
                    delete loadedData.keyPointsMeta[channelName].smartTouched;
                }

            } catch (tagErr) {
                console.warn('[INK REBASE] Failed to normalize source tag for', channelName, tagErr);
            }
        }

        let currentEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);
        if (options.resetEndsToBaseline) {
            if (!loadedData._originalBaselineEnd) {
                loadedData._originalBaselineEnd = {};
            }

            let baselineValue = loadedData._originalBaselineEnd[channelName];
            if (typeof baselineValue !== 'number') {
                if (Array.isArray(loadedData.originalCurves?.[channelName])) {
                    baselineValue = Math.max(...loadedData.originalCurves[channelName]);
                } else if (typeof loadedData.baselineEnd?.[channelName] === 'number') {
                    baselineValue = loadedData.baselineEnd[channelName];
                }
                if (typeof baselineValue === 'number') {
                    loadedData._originalBaselineEnd[channelName] = baselineValue;
                }
            }

            if (typeof baselineValue === 'number') {
                currentEnd = InputValidator.clampEnd(baselineValue);
                if (loadedData.baselineEnd && typeof currentEnd === 'number') {
                    loadedData.baselineEnd[channelName] = currentEnd;
                }
                const percentValue = InputValidator.computePercentFromEnd(currentEnd);
                if (endInput) {
                    endInput.value = String(currentEnd);
                    endInput.setAttribute('data-base-end', String(currentEnd));
                    InputValidator.clearValidationStyling(endInput);
                }
                if (percentInput) {
                    percentInput.value = formatPercentDisplay(percentValue);
                    percentInput.setAttribute('data-base-percent', String(percentValue));
                    InputValidator.clearValidationStyling(percentInput);
                }
            }
        }
        channelContexts.push({
            channelName,
            row,
            percentInput,
            endInput,
            currentEnd,
            perChannelEntry,
            perChannelToggle: row.querySelector('.per-channel-toggle')
        });
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[LabNormalization] Channel context prepared', channelName, { currentEnd });
        }
    });

    if (!channelContexts.length) {
        return;
    }

    const endValuesMap = {};
    channelContexts.forEach((ctx) => {
        endValuesMap[ctx.channelName] = ctx.currentEnd;
    });

    const compositeEligible = !!(
        LinearizationState.isGlobalEnabled?.() &&
        globalData &&
        isLabLinearizationData(globalData)
    );

    const interpolationType = elements.curveSmoothingMethod?.value || 'cubic';
    let smoothingPercent = 0;
    if (compositeEligible) {
        if (globalData && typeof globalData.previewSmoothingPercent === 'number') {
            smoothingPercent = globalData.previewSmoothingPercent;
        } else {
            smoothingPercent = getLabSmoothingPercent();
        }
    }

    const channelNamesForOverrides = channelContexts.map((ctx) => ctx.channelName);
    const densityOverrides = getDensityOverridesSnapshot(channelNamesForOverrides);
    const autoDensityCompute = isAutoDensityComputeEnabled();

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE] preparing begin', {
            compositeEligible,
            channelCount: channelContexts.length,
            autoDensityCompute
        });
    }

    const treatAsBakedMeasurement = isBakedMeasurement(globalData);
    if (treatAsBakedMeasurement) {
        smoothingPercent = 0;
    }

    let compositeSessionActive = false;
    if (!useSimpleScaling) {
        compositeSessionActive = compositeEligible && beginCompositeLabRedistribution({
            channelNames: channelContexts.map((ctx) => ctx.channelName),
            endValues: endValuesMap,
            labEntry: globalData,
            interpolationType,
            smoothingPercent,
            densityOverrides,
            autoComputeDensity: autoDensityCompute,
            analysisOnly: treatAsBakedMeasurement
        });
    }

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE] begin result', { compositeSessionActive, treatAsBakedMeasurement });
    }

    loadedData.plotBaseCurves = {};
    const pendingEntries = [];

    channelContexts.forEach((ctx) => {
        const preferOriginalBaseline = useOriginalBaseline && Array.isArray(loadedData?.originalCurves?.[ctx.channelName]);
        const make256Options = preferOriginalBaseline
            ? { preferOriginalBaseline: true, forceSmartApplied: false }
            : undefined;

        const curve = make256(ctx.currentEnd, ctx.channelName, !useSimpleScaling, make256Options);
        pendingEntries.push({
            ...ctx,
            curve: Array.isArray(curve) ? curve.slice() : []
        });
        rebased.push(ctx.channelName);

        if (options.source === 'perChannelLoad') {
            try {
                if (ctx.perChannelEntry) {
                    LinearizationState.setPerChannelData(ctx.channelName, ctx.perChannelEntry, false);
                }
            } catch (err) {
                console.warn('[INK REBASE] Failed to disable per-channel data after rebase:', ctx.channelName, err);
            }
        }
    });

    if (!pendingEntries.length) {
        LinearizationState.setGlobalWarnings([]);
        return;
    }

    let simpleScalingResult = null;
    if (useSimpleScaling && compositeEligible && Array.isArray(globalData?.originalData)) {
        try {
            const resolution = Array.isArray(pendingEntries[0]?.curve) ? pendingEntries[0].curve.length : 256;
            const channelMap = {};
            pendingEntries.forEach((entry) => {
                channelMap[entry.channelName] = {
                    samples: Array.isArray(entry.curve) ? entry.curve.slice() : [],
                    endValue: Number(entry.currentEnd) || 0,
                    enabled: true
                };
            });
            const densityWeights = {};
            pendingEntries.forEach((entry) => {
                const resolved = getResolvedDensity(entry.channelName);
                densityWeights[entry.channelName] = Number.isFinite(resolved?.value) ? resolved.value : 0;
            });
            const allowCeilingLift = isAutoRaiseInkLimitsEnabled();
            simpleScalingResult = runSimpleScalingCorrection({
                measurements: globalData.originalData,
                channels: channelMap,
                densityWeights,
                options: {
                    resolution,
                    allowCeilingLift,
                    maxLiftPercent: allowCeilingLift ? 0.15 : 0,
                    residualThreshold: 0.01,
                    maxIterations: 2,
                    residualIntensity: 0.35,
                    blendPercent: 100
                }
            });

            const correctedCurves = {};
            pendingEntries.forEach((entry) => {
                const channelResult = simpleScalingResult.channels?.[entry.channelName];
                if (!channelResult) {
                    return;
                }
                const samples = Array.isArray(channelResult.samples) ? channelResult.samples.slice() : entry.curve;
                entry.curve = samples;
                entry.currentEnd = Number(channelResult.endValue) || samples.reduce((max, value) => (value > max ? value : max), 0);
                correctedCurves[entry.channelName] = samples.slice();
            });

            if (LinearizationState && typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                LinearizationState.setGlobalCorrectedCurves(correctedCurves);
            }
            if (LinearizationState && typeof LinearizationState.setGlobalBakedMeta === 'function') {
                LinearizationState.setGlobalBakedMeta({
                    source: 'simpleScaling',
                    timestamp: Date.now(),
                    channels: Object.keys(correctedCurves)
                });
            }
            if (LinearizationState) {
                LinearizationState.globalPeakIndices = null;
                LinearizationState.setCompositeCoverageSummary?.(null);
                LinearizationState.getCompositeDensityProfile = () => null;
                LinearizationState.getCompositeCoverageSummary = () => null;
            }
            loadedData.simpleScalingSummary = simpleScalingResult.metadata;
            loadedData.correctionMethod = CORRECTION_METHODS.SIMPLE_SCALING;
        } catch (simpleErr) {
            console.warn('[SimpleScaling] Failed to compute simple scaling correction:', simpleErr);
        }
    } else if (useSimpleScaling) {
        loadedData.correctionMethod = CORRECTION_METHODS.SIMPLE_SCALING;
    } else {
        loadedData.correctionMethod = CORRECTION_METHODS.DENSITY_SOLVER;
        if (loadedData.simpleScalingSummary) {
            delete loadedData.simpleScalingSummary;
        }
    }

    if (!pendingEntries.length) {
        LinearizationState.setGlobalWarnings([]);
        return;
    }

    let pendingWarnings = [];

    if (simpleScalingResult?.metadata?.residual?.max && simpleScalingResult.metadata.residual.max > 0.05) {
        pendingWarnings.push(`Simple scaling residual exceeds ${(simpleScalingResult.metadata.residual.max * 100).toFixed(1)}% in parts of the range.`);
    }

    if (compositeSessionActive) {
        const compositeResult = finalizeCompositeLabRedistribution();
        if (compositeResult?.curves) {
            pendingEntries.forEach((entry) => {
                const adjusted = compositeResult.curves[entry.channelName];
                if (Array.isArray(adjusted)) {
                    entry.curve = adjusted.slice();
                }
            });
        }
        if (compositeResult?.peakIndices && typeof compositeResult.peakIndices === 'object') {
            loadedData.channelPeaks = { ...compositeResult.peakIndices };
            if (LinearizationState && typeof LinearizationState === 'object') {
                LinearizationState.globalPeakIndices = { ...compositeResult.peakIndices };
            }
        } else {
            delete loadedData.channelPeaks;
            if (LinearizationState && typeof LinearizationState === 'object') {
                delete LinearizationState.globalPeakIndices;
            }
        }
        const warnings = compositeResult?.warnings || [];
        pendingWarnings = warnings.slice();
        if (warnings.length) {
            showStatus(warnings[0]);
        }

    } else {
        delete loadedData.channelPeaks;
        if (LinearizationState && typeof LinearizationState === 'object') {
            delete LinearizationState.globalPeakIndices;
        }
    }

    const plotSmoothingPercent = getPlotSmoothingPercent();
    applyPlotSmoothingToEntries(pendingEntries, plotSmoothingPercent, loadedData);

    pendingEntries.forEach((entry) => {
        const {
            channelName,
            row,
            percentInput,
            endInput,
            perChannelToggle,
            perChannelEntry
        } = entry;

        let finalCurve = entry.curve;
        let effectiveEnd = Array.isArray(finalCurve) && finalCurve.length ? Math.max(...finalCurve) : 0;
        if (plotSmoothingPercent <= 0) {
            const originalTarget = (() => {
                const stored = Number(loadedData._plotSmoothingOriginalEnds?.[channelName]);
                if (Number.isFinite(stored) && stored > 0) {
                    return stored;
                }
                const baselineOriginal = Number(loadedData._originalBaselineEnd?.[channelName]);
                if (Number.isFinite(baselineOriginal) && baselineOriginal > 0) {
                    return baselineOriginal;
                }
                const zeroSnapshot = Array.isArray(loadedData._zeroSmoothingCurves?.[channelName])
                    ? loadedData._zeroSmoothingCurves[channelName]
                    : null;
                if (zeroSnapshot && zeroSnapshot.length) {
                    return zeroSnapshot.reduce((max, value) => (value > max ? value : max), 0);
                }
                return null;
            })();
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[LabNormalization] baseline comparison', {
                    channelName,
                    effectiveEnd,
                    originalTarget
                });
            }
            if (Number.isFinite(originalTarget) && originalTarget > 0 && Math.abs(effectiveEnd - originalTarget) > 0.5) {
                const previousEnd = effectiveEnd;
                const rescaledCurve = rescaleCurveToEnd(finalCurve, originalTarget);
                if (Array.isArray(rescaledCurve) && rescaledCurve.length) {
                    finalCurve = rescaledCurve.slice();
                    entry.curve = finalCurve.slice();
                    effectiveEnd = Math.max(...finalCurve);
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[LabNormalization] rescaled curve to original baseline', {
                            channelName,
                            originalTarget,
                            previousEnd,
                            rescaledEnd: effectiveEnd
                        });
                    }
                }
            }
        }
        const effectivePercent = InputValidator.computePercentFromEnd(effectiveEnd);

        emitCompositeAudit('ui.pendingEntry', (targetIndex) => {
            if (!Array.isArray(finalCurve) || targetIndex >= finalCurve.length) return null;
            return {
                channel: channelName,
                sampleIndex: targetIndex,
                curveValue: finalCurve[targetIndex],
                effectiveEnd,
                normalized: effectiveEnd > 0 ? finalCurve[targetIndex] / effectiveEnd : 0
            };
        });

        entry.currentEnd = effectiveEnd;
        loadedData.curves[channelName] = finalCurve.slice();
        loadedData.rebasedCurves[channelName] = finalCurve.slice();
        if (plotSmoothingPercent <= 0) {
            loadedData.rebasedSources[channelName] = finalCurve.slice();
        } else if (!Array.isArray(loadedData.rebasedSources[channelName])) {
            loadedData.rebasedSources[channelName] = finalCurve.slice();
        }
        loadedData.baselineEnd[channelName] = effectiveEnd;

        if (plotSmoothingPercent <= 0) {
            if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
                loadedData.plotBaseCurves = {};
            }
            loadedData.plotBaseCurves[channelName] = finalCurve.slice();
            if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
                loadedData._plotSmoothingOriginalCurves = {};
            }
            loadedData._plotSmoothingOriginalCurves[channelName] = finalCurve.slice();
        }

        if (compositeSessionActive) {
            if (!loadedData.keyPointsMeta || typeof loadedData.keyPointsMeta !== 'object') {
                loadedData.keyPointsMeta = {};
            }
            const meta = loadedData.keyPointsMeta[channelName] || {};
            if (smoothingPercent > 0) {
                meta.bakedGlobal = true;
            } else if (meta.bakedGlobal) {
                delete meta.bakedGlobal;
            }
            loadedData.keyPointsMeta[channelName] = meta;
        } else if (loadedData?.keyPointsMeta && loadedData.keyPointsMeta[channelName]?.bakedGlobal) {
            delete loadedData.keyPointsMeta[channelName].bakedGlobal;
            if (typeof setGlobalBakedState === 'function') {
                setGlobalBakedState(null, { skipHistory: true });
            }
        }

        percentInput.value = formatPercentDisplay(effectivePercent);
        percentInput.setAttribute('data-base-percent', String(effectivePercent));
        InputValidator.clearValidationStyling(percentInput);

        endInput.value = String(effectiveEnd);
        endInput.setAttribute('data-base-end', String(effectiveEnd));
        InputValidator.clearValidationStyling(endInput);

        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            row.refreshDisplayFn();
        }

        if (manager) {
            try {
                manager.setChannelValue(channelName, 'percentage', effectivePercent);
                manager.setChannelValue(channelName, 'endValue', effectiveEnd);
                manager.setChannelEnabled(channelName, effectiveEnd > 0);
            } catch (stateErr) {
                console.warn('[INK REBASE] Failed to sync state manager for', channelName, stateErr);
            }
        }

        if (!skipScaleBaselineUpdate) {
            updateScaleBaselineForChannelCore(channelName);
        }

        if (options.source === 'perChannelLoad') {
            if (perChannelEntry) {
                try {
                    perChannelEntry.edited = false;
                } catch (err) { /* ignore */ }
            }
            if (perChannelToggle) {
                perChannelToggle.checked = false;
                perChannelToggle.disabled = true;
                perChannelToggle.setAttribute('data-baked', 'true');
                perChannelToggle.title = 'Per-channel correction baked into baseline. Undo or revert to modify.';
            }
        }
    });

    if (!compositeSessionActive) {
        pendingWarnings = collectCurveWarnings(pendingEntries);
        if (pendingWarnings.length) {
            showStatus(pendingWarnings[0]);
        }
    }

    if (plotSmoothingPercent <= 0) {
        if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
            loadedData._plotSmoothingOriginalCurves = {};
        }
        if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
            loadedData.plotBaseCurves = {};
        }
        const zeroSnapshot = loadedData._zeroSmoothingCurves && typeof loadedData._zeroSmoothingCurves === 'object'
            ? loadedData._zeroSmoothingCurves
            : null;
        channelContexts.forEach((ctx) => {
            const sourceCurve = Array.isArray(loadedData.rebasedCurves?.[ctx.channelName])
                ? loadedData.rebasedCurves[ctx.channelName]
                : loadedData.curves?.[ctx.channelName];
            if (!Array.isArray(sourceCurve)) {
                return;
            }
            const zeroCurve = zeroSnapshot && Array.isArray(zeroSnapshot[ctx.channelName])
                ? zeroSnapshot[ctx.channelName]
                : null;
            const existingOriginal = Array.isArray(loadedData._plotSmoothingOriginalCurves[ctx.channelName])
                ? loadedData._plotSmoothingOriginalCurves[ctx.channelName]
                : null;
            const baseCurve = zeroCurve
                ? zeroCurve.slice()
                : existingOriginal
                    ? existingOriginal.slice()
                    : sourceCurve.slice();
            loadedData.plotBaseCurves[ctx.channelName] = baseCurve.slice();
            if (!existingOriginal || existingOriginal.length === 0 || (!zeroCurve && !zeroSnapshot)) {
                loadedData._plotSmoothingOriginalCurves[ctx.channelName] = baseCurve.slice();
            } else if (zeroCurve) {
                loadedData._plotSmoothingOriginalCurves[ctx.channelName] = baseCurve.slice();
            }
        });
        const targetNames = pendingEntries
            .map((entry) => entry.channelName)
            .filter((name, index, arr) => typeof name === 'string' && arr.indexOf(name) === index);
        syncPlotSmoothingBaselines(loadedData, targetNames, {
            source: 'rebasedCurves',
            force: true,
            preserveExistingSnapshot: true
        });
    }

    LinearizationState.setGlobalWarnings(pendingWarnings);

    if (isEditModeEnabled()) {
        try {
            refreshSmartCurvesFromMeasurements();
        } catch (err) {
            console.warn('[INK REBASE] Failed to refresh Smart curves after rebase:', err);
        }
    }

    rebased.forEach((channelName) => {
        try {
            updateProcessingDetail(channelName);
        } catch (err) {
            console.warn('Processing detail refresh failed for', channelName, err);
        }
    });

    try { updateInkChart(); } catch (err) { console.warn('[INK REBASE] Chart update failed:', err); }

    if (typeof debouncedPreviewUpdate === 'function') {
        debouncedPreviewUpdate();
    }

    try { updateSessionStatus(); } catch (err) { console.warn('[INK REBASE] Session status update failed:', err); }

    if (isGlobalSource) {
        try {
            const currentGlobalData = LinearizationState.getGlobalData?.();
            const shouldMarkApplied = globalAppliedState !== undefined ? globalAppliedState : true;
            if (globalData) {
                globalData.applied = shouldMarkApplied;
            }
            LinearizationState.globalApplied = shouldMarkApplied;
            if (manager) {
                manager.set('linearization.global.applied', shouldMarkApplied, { skipHistory: true, allowDuringRestore: true });
            }
            if (shouldMarkApplied && typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                try {
                    LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[INK REBASE] Captured corrected snapshot');
                    }
                } catch (snapshotErr) {
                    console.warn('[INK REBASE] Failed to capture corrected snapshot:', snapshotErr);
                }
            }
        } catch (err) {
            console.warn('[INK REBASE] Failed to ensure global applied state after rebase:', err);
        }
        if (compositeSessionActive && smoothingPercent <= 0) {
            try {
                setGlobalBakedState(null, { skipHistory: true });
            } catch (err) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[INK REBASE] Failed to clear global baked state for zero smoothing:', err);
                }
            }
        }
        if (smoothingPercent <= 0 && globalData?.filename) {
            storeZeroSmoothingSnapshot(globalData.filename);
        }
    }

    if (plotSmoothingPercent <= 0) {
        if (!loadedData._plotSmoothingOriginalCurves || typeof loadedData._plotSmoothingOriginalCurves !== 'object') {
            loadedData._plotSmoothingOriginalCurves = {};
        }
        if (!loadedData.plotBaseCurves || typeof loadedData.plotBaseCurves !== 'object') {
            loadedData.plotBaseCurves = {};
        }
        Object.entries(loadedData.rebasedCurves || {}).forEach(([channelName, curve]) => {
            if (!Array.isArray(curve)) {
                return;
            }
            loadedData.plotBaseCurves[channelName] = curve.slice();
            loadedData._plotSmoothingOriginalCurves[channelName] = curve.slice();
        });
    }

    if (!loadedData._plotSmoothingBaselineCurves || typeof loadedData._plotSmoothingBaselineCurves !== 'object') {
        loadedData._plotSmoothingBaselineCurves = {};
    }
    Object.entries(loadedData.rebasedCurves || {}).forEach(([channelName, curve]) => {
        if (!Array.isArray(curve)) {
            return;
        }
        loadedData._plotSmoothingBaselineCurves[channelName] = curve.slice();
    });
}

function restoreChannelsToRebasedSources(channelNames = [], options = {}) {
    if (!Array.isArray(channelNames) || channelNames.length === 0) {
        return [];
    }

    const { skipRefresh = false, skipScaleBaselineUpdate = false } = typeof options === 'object' && options !== null ? options : {};

    const loadedData = ensureLoadedQuadData(() => ({
        curves: {},
        baselineEnd: {},
        sources: {},
        keyPoints: {},
        keyPointsMeta: {},
        rebasedCurves: {},
        rebasedSources: {}
    }));

    if (!loadedData.rebasedSources) {
        return [];
    }

    const manager = typeof getStateManager === 'function' ? getStateManager() : null;
    const restoredChannels = [];

    channelNames.forEach((channelName) => {
        const sourceCurve = Array.isArray(loadedData.rebasedSources?.[channelName])
            ? loadedData.rebasedSources[channelName]
            : null;
        if (!Array.isArray(sourceCurve) || sourceCurve.length === 0) {
            return;
        }

        const clonedCurve = sourceCurve.slice();
        const effectiveEnd = clonedCurve.length ? Math.max(...clonedCurve) : 0;
        const effectivePercent = InputValidator.computePercentFromEnd(effectiveEnd);

        const row = getChannelRow(channelName);
        if (row) {
            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (percentInput) {
                percentInput.value = formatPercentDisplay(effectivePercent);
                percentInput.setAttribute('data-base-percent', String(effectivePercent));
                InputValidator.clearValidationStyling(percentInput);
            }

            if (endInput) {
                endInput.value = String(effectiveEnd);
                endInput.setAttribute('data-base-end', String(effectiveEnd));
                InputValidator.clearValidationStyling(endInput);
            }

            if (!skipRefresh && row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
                try {
                    row.refreshDisplayFn();
                } catch (err) {
                    console.warn('[INK RESTORE] Failed to refresh row display for', channelName, err);
                }
            }
        }

        loadedData.curves[channelName] = clonedCurve.slice();
        loadedData.rebasedCurves[channelName] = clonedCurve.slice();
        loadedData.baselineEnd[channelName] = effectiveEnd;

        if (manager) {
            try {
                manager.setChannelValue(channelName, 'percentage', effectivePercent);
                manager.setChannelValue(channelName, 'endValue', effectiveEnd);
                manager.setChannelEnabled(channelName, effectiveEnd > 0);
            } catch (err) {
                console.warn('[INK RESTORE] Failed to sync state manager for', channelName, err);
            }
        }

        if (!skipScaleBaselineUpdate) {
            updateScaleBaselineForChannelCore(channelName);
        }
        restoredChannels.push(channelName);
    });

    return restoredChannels;
}

function applyCurveSnapshot(curveMap = {}, options = {}) {
    if (!curveMap || typeof curveMap !== 'object') {
        return false;
    }

    const loadedData = getLoadedQuadData?.();
    if (!loadedData) {
        return false;
    }

    const channels = Object.keys(curveMap).filter((channelName) => Array.isArray(curveMap[channelName]));
    if (!channels.length) {
        return false;
    }

    if (!loadedData.rebasedSources || typeof loadedData.rebasedSources !== 'object') {
        loadedData.rebasedSources = {};
    }

    channels.forEach((channelName) => {
        const curve = curveMap[channelName];
        loadedData.rebasedSources[channelName] = curve.slice();
    });

    restoreChannelsToRebasedSources(channels, {
        skipRefresh: !!options.skipRefresh,
        skipScaleBaselineUpdate: !!options.skipScaleBaselineUpdate
    });

    return true;
}

function isDefaultSmartRamp(points) {
    if (!Array.isArray(points) || points.length !== 2) {
        return false;
    }
    const [p0, p1] = points;
    const nearZero = (value) => Math.abs(Number(value) || 0) <= 0.0001;
    const nearHundred = (value) => Math.abs((Number(value) || 0) - 100) <= 0.0001;
    return nearZero(p0?.input) && nearZero(p0?.output) && nearHundred(p1?.input) && nearHundred(p1?.output);
}

function preserveQuadCurveForInkLimit(channelName, newEndValue) {
    if (!channelName || !Number.isFinite(newEndValue)) {
        return;
    }

    const loadedData = getLoadedQuadData();
    if (!loadedData) {
        return;
    }

    const reference = Array.isArray(loadedData.rebasedCurves?.[channelName])
        ? loadedData.rebasedCurves[channelName]
        : loadedData.curves?.[channelName];
    const fallbackOriginal = loadedData.originalCurves?.[channelName];
    const baselineSourceCurve = Array.isArray(reference) && reference.length ? reference : fallbackOriginal;

    if (!Array.isArray(baselineSourceCurve) || baselineSourceCurve.length === 0) {
        return;
    }

    const baselineSource = loadedData.baselineEnd?.[channelName];
    const baselineEnd = Number.isFinite(baselineSource) && baselineSource > 0
        ? baselineSource
        : Math.max(...baselineSourceCurve);
    if (!baselineEnd || baselineEnd <= 0) {
        return;
    }

    const ratio = newEndValue <= 0 ? 0 : newEndValue / baselineEnd;
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[INK LIMIT preserve] scaling', {
            channelName,
            baselineEnd,
            newEndValue,
            maxBaseline: Math.max(...baselineSourceCurve)
        });
    }
    const scaledCurve = baselineSourceCurve.map((value) => {
        if (!Number.isFinite(value)) return 0;
        const scaled = ratio * value;
        if (!Number.isFinite(scaled)) return 0;
        return Math.max(0, Math.min(TOTAL, Math.round(scaled)));
    });

    if (!loadedData.curves) {
        loadedData.curves = {};
    }
    loadedData.curves[channelName] = scaledCurve;
    if (!loadedData.rebasedCurves) {
        loadedData.rebasedCurves = {};
    }
    loadedData.rebasedCurves[channelName] = scaledCurve.slice();
    if (!loadedData.baselineEnd) {
        loadedData.baselineEnd = {};
    }
    loadedData.baselineEnd[channelName] = newEndValue;

    const keyPoints = loadedData.keyPoints?.[channelName];
    const sourceTag = loadedData.sources?.[channelName];
    if (sourceTag === 'smart' && isDefaultSmartRamp(keyPoints)) {
        if (loadedData.keyPoints) {
            delete loadedData.keyPoints[channelName];
        }
        if (loadedData.keyPointsMeta) {
            delete loadedData.keyPointsMeta[channelName];
        }
        if (loadedData.sources) {
            delete loadedData.sources[channelName];
        }
    }
}

/**
 * Handle percentage input changes with validation
 * @param {HTMLInputElement} input - The percentage input element
 */
function handlePercentInput(input, options = {}) {
    const commit = typeof options === 'object' && options !== null ? !!options.commit : true;
    let rawValue = input ? input.value : '';
    if (commit && input) {
        const initialValue = input.dataset.initialNumericValue || '';
        const normalizedInitial = initialValue !== '' ? String(InputValidator.clampPercent(initialValue)) : '';
        if (normalizedInitial && rawValue && rawValue !== normalizedInitial && rawValue.startsWith(normalizedInitial)) {
            const remainder = rawValue.slice(normalizedInitial.length);
            if (remainder && !Number.isNaN(Number(remainder))) {
                rawValue = remainder;
                input.value = remainder;
            }
        }
    }
    let validatedPercent = commit
        ? InputValidator.validatePercentInput(input)
        : InputValidator.clampPercent(rawValue);

    if (!commit) {
        const rawScalePercent = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
        const activeScalePercent = Number(rawScalePercent);
        const activeScale = Number.isFinite(activeScalePercent) && Math.abs(activeScalePercent - 100) > 1e-6;
        if (activeScale) {
            const basePercent = getBasePercentFromInput(input);
            const row = input?.closest('tr');
            if (input) {
                InputValidator.clearValidationStyling(input);
                input.value = formatPercentDisplay(basePercent);
            }
            if (row) {
                const siblingEnd = row.querySelector('.end-input');
                if (siblingEnd) {
                    const baseEnd = getBaseEndFromInput(siblingEnd);
                    InputValidator.clearValidationStyling(siblingEnd);
                    siblingEnd.value = String(Math.round(baseEnd));
                }
            }
            if (input) {
                setBasePercentOnInput(input, basePercent);
            }
            return basePercent;
        }
        if (input) {
            InputValidator.clearValidationStyling(input);
            if (input.dataset.userEditing === 'true') {
                markPendingCommitHold(input, validatedPercent);
                setBasePercentOnInput(input, validatedPercent);
                const row = input.closest('tr');
                const siblingEnd = row?.querySelector('.end-input');
                if (siblingEnd) {
                    const siblingEndValue = InputValidator.computeEndFromPercent(validatedPercent);
                    markPendingCommitHold(siblingEnd, siblingEndValue);
                    setBaseEndOnInput(siblingEnd, siblingEndValue);
                }
            }
        }
        return validatedPercent;
    }

    if (input) {
        delete input.dataset.userEditing;
    }
    const row = input.closest('tr');
    if (row) {
        delete row.dataset.userEditing;
    }
    const channelName = row?.getAttribute('data-channel');

    if (channelName && isChannelLocked(channelName)) {
        const lockInfo = getChannelLockInfo(channelName);
        const lockedPercent = InputValidator.clampPercent(lockInfo.percentLimit);
        if (input) {
            InputValidator.clearValidationStyling(input);
            input.value = formatPercentDisplay(lockedPercent);
            setBasePercentOnInput(input, lockedPercent);
            clearPendingCommitHold(input);
        }
        const siblingEnd = row?.querySelector('.end-input');
        if (siblingEnd) {
            const lockedEnd = InputValidator.clampEnd(lockInfo.endValue);
            siblingEnd.value = String(lockedEnd);
            setBaseEndOnInput(siblingEnd, lockedEnd);
            InputValidator.clearValidationStyling(siblingEnd);
            clearPendingCommitHold(siblingEnd);
        }
        if (commit) {
            showStatus(`${channelName} ink limit is locked. Unlock before editing.`);
        }
        return lockedPercent;
    }

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[INK LIMIT percentInput]', {
            channelName,
            validatedPercent,
            rawValue: input?.value
        });
    }

    if (globalScope) {
        globalScope.__percentDebug = globalScope.__percentDebug || [];
        globalScope.__percentDebug.push({ stage: 'validated', channelName, value: validatedPercent });
    }

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log(`[INPUT DEBUG] handlePercentInput called for ${channelName}, value: ${validatedPercent}`);
    }

    let previousPercent = null;
    let previousEnd = null;
    if (row) {
        const baselines = getRowBaselines(row);
        previousPercent = baselines.percent;
        previousEnd = baselines.end;
    }

    const requestedPercent = validatedPercent;
    const globalScalePercentRaw = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
    const globalScalePercent = Number(globalScalePercentRaw);
    const globalScaleActive = Number.isFinite(globalScalePercent) && Math.abs(globalScalePercent - 100) > 1e-6;
    let forcedEndValue = null;

    if (globalScaleActive) {
        const baselinePercent = Number.isFinite(previousPercent) && previousPercent > 0
            ? previousPercent
            : (Number.isFinite(globalScalePercent) && globalScalePercent > 0 ? globalScalePercent : null);
        if (baselinePercent !== null && Math.abs(requestedPercent - baselinePercent) > 1e-6) {
            validatedPercent = baselinePercent;
            if (Number.isFinite(previousEnd) && previousEnd > 0) {
                forcedEndValue = previousEnd;
            } else {
                const computedBaselineEnd = InputValidator.computeEndFromPercent(baselinePercent);
                if (Number.isFinite(computedBaselineEnd) && computedBaselineEnd > 0) {
                    forcedEndValue = computedBaselineEnd;
                }
            }
        }
    }

    let manager = null;
    if (channelName) {
        try {
            manager = getStateManager?.() ?? null;
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log(`[INPUT DEBUG] State manager exists: ${!!manager}`);
            }
            if (manager) {
                manager.setChannelValue(channelName, 'percentage', validatedPercent);
            }
        } catch (err) {
            console.warn('Failed to route percentage through state manager:', err);
        }
    }

    // Find corresponding end input and update it
    let newEndValue = null;
    if (row) {
        const endInput = row.querySelector('.end-input');
        if (endInput) {
            if (forcedEndValue !== null) {
                newEndValue = forcedEndValue;
            } else {
                newEndValue = InputValidator.computeEndFromPercent(validatedPercent);
            }
            setBaseEndOnInput(endInput, newEndValue);
            endInput.value = newEndValue;
            InputValidator.clearValidationStyling(endInput);
            clearPendingCommitHold(endInput);

            if (channelName && manager) {
                try {
                    manager.setChannelValue(channelName, 'endValue', newEndValue);
                } catch (err) {
                    console.warn('Failed to sync end value with state manager:', err);
                }
            }
        }

        setBasePercentOnInput(input, validatedPercent);
        if (globalScope) {
            globalScope.__percentDebug.push({ stage: 'setBasePercent', channelName, value: validatedPercent });
        }
        clearPendingCommitHold(input);

        // Update scale baseline for global scale integration
        const rowChannelName = row.getAttribute('data-channel');
        if (rowChannelName) {
            updateScaleBaselineForChannelCore(rowChannelName);
        }

        // Call the row's refreshDisplay function (critical for scaling display logic)
        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            row.refreshDisplayFn();
        }
    }

    if (input) {
        input.value = formatPercentDisplay(validatedPercent);
        if (typeof input.valueAsNumber === 'number') {
            input.valueAsNumber = Number(input.value);
        }
        clearPendingCommitHold(input);
    }

    if (channelName && manager) {
        try {
            manager.setChannelEnabled(channelName, validatedPercent > 0);
        } catch (err) {
            console.warn('Failed to sync channel enabled state with state manager:', err);
        }
    }

    const previousPercentForRescale = Number.isFinite(previousPercent)
        ? previousPercent
        : (previousEnd !== null ? InputValidator.computePercentFromEnd(previousEnd) : null);
    if (
        channelName &&
        Number.isFinite(previousPercentForRescale) &&
        previousPercentForRescale > 0 &&
        validatedPercent > 0 &&
        Math.abs(previousPercentForRescale - validatedPercent) > 1e-6
    ) {
        rescaleSmartCurveForInkLimit(channelName, previousPercentForRescale, validatedPercent, {
            mode: 'preserveRelative',
            historyExtras: { triggeredBy: 'percentInput' }
        });
    }

    if (channelName && Number.isFinite(newEndValue)) {
        try {
            preserveQuadCurveForInkLimit(channelName, newEndValue);
        } catch (err) {
            console.warn('[INK LIMIT] preserveQuadCurveForInkLimit failed:', err);
        }
    }

    const currentScalePercentRaw = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
    const currentScalePercent = Number(currentScalePercentRaw);
    if (Number.isFinite(currentScalePercent) && Math.abs(currentScalePercent - 100) > 1e-6) {
        scalingCoordinator
            .scale(currentScalePercent, 'ui-resync', {
                metadata: {
                    trigger: 'percentInputResync',
                    skipHistory: true
                }
            })
            .catch((err) => {
                console.warn('[SCALE] Coordinator resync after percent edit failed:', err);
            });
    }

    refreshEffectiveInkDisplays();

    // Trigger preview update and chart update
    if (typeof debouncedPreviewUpdate !== 'undefined') {
        debouncedPreviewUpdate();
    }

    // Trigger chart update for immediate visual feedback
    updateInkChart();

    // Update edit mode channel dropdown when channel states change
    setTimeout(() => {
        try {
            populateChannelDropdown();
        } catch (err) {
            console.warn('[EDIT MODE] Channel dropdown update failed:', err);
        }
    }, 0);
}

/**
 * Handle end value input changes with validation
 * @param {HTMLInputElement} input - The end value input element
 */
function handleEndInput(input, options = {}) {
    const commit = typeof options === 'object' && options !== null ? !!options.commit : true;
    let rawValue = input ? input.value : '';
    if (commit && input) {
        const initialValue = input.dataset.initialNumericValue || '';
        const normalizedInitial = initialValue !== '' ? String(InputValidator.clampEnd(initialValue)) : '';
        if (normalizedInitial && rawValue && rawValue !== normalizedInitial && rawValue.startsWith(normalizedInitial)) {
            const remainder = rawValue.slice(normalizedInitial.length);
            if (remainder && !Number.isNaN(Number(remainder))) {
                rawValue = remainder;
                input.value = remainder;
            }
        }
    }
    let validatedEnd = commit
        ? InputValidator.validateEndInput(input)
        : InputValidator.clampEnd(rawValue);

    if (!commit) {
        const rawScalePercent = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
        const activeScalePercent = Number(rawScalePercent);
        const activeScale = Number.isFinite(activeScalePercent) && Math.abs(activeScalePercent - 100) > 1e-6;
        if (activeScale) {
            const baseEnd = getBaseEndFromInput(input);
            const row = input?.closest('tr');
            if (input) {
                InputValidator.clearValidationStyling(input);
                input.value = String(Math.round(baseEnd));
            }
            if (row) {
                const siblingPercent = row.querySelector('.percent-input');
                if (siblingPercent) {
                    const basePercent = getBasePercentFromInput(siblingPercent);
                    InputValidator.clearValidationStyling(siblingPercent);
                    siblingPercent.value = formatPercentDisplay(basePercent);
                }
            }
            if (input) {
                setBaseEndOnInput(input, baseEnd);
            }
            return baseEnd;
        }
        if (input) {
            InputValidator.clearValidationStyling(input);
            if (input.dataset.userEditing === 'true') {
                markPendingCommitHold(input, validatedEnd);
                setBaseEndOnInput(input, validatedEnd);
                const row = input.closest('tr');
                const siblingPercent = row?.querySelector('.percent-input');
                if (siblingPercent) {
                    const siblingPercentValue = InputValidator.computePercentFromEnd(validatedEnd);
                    markPendingCommitHold(siblingPercent, siblingPercentValue);
                    setBasePercentOnInput(siblingPercent, siblingPercentValue);
                }
            }
        }
        return validatedEnd;
    }

    if (input) {
        delete input.dataset.userEditing;
    }
    const row = input.closest('tr');
    if (row) {
        delete row.dataset.userEditing;
    }
    const channelName = row?.getAttribute('data-channel');

    if (channelName && isChannelLocked(channelName)) {
        const lockInfo = getChannelLockInfo(channelName);
        const lockedEnd = InputValidator.clampEnd(lockInfo.endValue);
        const lockedPercent = InputValidator.clampPercent(lockInfo.percentLimit);
        if (input) {
            InputValidator.clearValidationStyling(input);
            input.value = String(lockedEnd);
            setBaseEndOnInput(input, lockedEnd);
            clearPendingCommitHold(input);
        }
        const siblingPercent = row?.querySelector('.percent-input');
        if (siblingPercent) {
            InputValidator.clearValidationStyling(siblingPercent);
            siblingPercent.value = formatPercentDisplay(lockedPercent);
            setBasePercentOnInput(siblingPercent, lockedPercent);
            clearPendingCommitHold(siblingPercent);
        }
        if (commit) {
            showStatus(`${channelName} ink limit is locked. Unlock before editing.`);
        }
        return lockedEnd;
    }

    const baselines = row ? getRowBaselines(row) : { percent: null, end: null };
    let previousPercent = baselines.percent;
    let previousEnd = baselines.end;

    const requestedEnd = validatedEnd;
    const globalScalePercent = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
    const globalScaleActive = Number.isFinite(globalScalePercent) && Math.abs(globalScalePercent - 100) > 1e-6;

    if (globalScaleActive) {
        let baselineEnd = Number.isFinite(previousEnd) && previousEnd > 0 ? previousEnd : null;
        if (baselineEnd == null) {
            const fallbackPercent = Number.isFinite(previousPercent) && previousPercent > 0
                ? previousPercent
                : (Number.isFinite(globalScalePercent) && globalScalePercent > 0 ? globalScalePercent : null);
            if (fallbackPercent !== null) {
                const computed = InputValidator.computeEndFromPercent(fallbackPercent);
                if (Number.isFinite(computed) && computed > 0) {
                    baselineEnd = computed;
                }
            }
        }
        if (baselineEnd !== null && Math.abs(requestedEnd - baselineEnd) > 0.5) {
            validatedEnd = baselineEnd;
        }
    }

    let manager = null;
    if (channelName) {
        try {
            manager = getStateManager?.() ?? null;
            if (manager) {
                manager.setChannelValue(channelName, 'endValue', validatedEnd);
            }
        } catch (err) {
            console.warn('Failed to route end value through state manager:', err);
        }
    }

    let newPercentValue = null;

    // Find corresponding percent input and update it
    if (row) {
        const percentInput = row.querySelector('.percent-input');
        if (percentInput) {
            newPercentValue = InputValidator.computePercentFromEnd(validatedEnd);
            setBasePercentOnInput(percentInput, newPercentValue);
            if (globalScope) {
                globalScope.__percentDebug.push({ stage: 'syncPercent', channelName, value: newPercentValue });
            }
            percentInput.value = formatPercentDisplay(newPercentValue);
            InputValidator.clearValidationStyling(percentInput);
            clearPendingCommitHold(percentInput);

            if (channelName && manager) {
                try {
                    manager.setChannelValue(channelName, 'percentage', Number(newPercentValue));
                } catch (err) {
                    console.warn('Failed to sync percentage with state manager:', err);
                }
            }
        }

        setBaseEndOnInput(input, validatedEnd);
        clearPendingCommitHold(input);

        // Update scale baseline for global scale integration
        const rowChannelName = row.getAttribute('data-channel');
        if (rowChannelName) {
            updateScaleBaselineForChannelCore(rowChannelName);
        }

        // Call the row's refreshDisplay function (critical for scaling display logic)
        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            row.refreshDisplayFn();
        }
    }

    if (channelName && manager) {
        try {
            manager.setChannelEnabled(channelName, validatedEnd > 0);
        } catch (err) {
            console.warn('Failed to sync channel enabled state with state manager (end input):', err);
        }
    }

    const previousPercentForRescale = Number.isFinite(previousPercent)
        ? previousPercent
        : (previousEnd !== null ? InputValidator.computePercentFromEnd(previousEnd) : null);
    if (
        channelName &&
        Number.isFinite(previousPercentForRescale) &&
        previousPercentForRescale > 0 &&
        Number.isFinite(newPercentValue) &&
        newPercentValue > 0 &&
        Math.abs(previousPercentForRescale - newPercentValue) > 1e-6
    ) {
        rescaleSmartCurveForInkLimit(channelName, previousPercentForRescale, newPercentValue, {
            mode: 'preserveRelative',
            historyExtras: { triggeredBy: 'endInput' }
        });
    }

    if (channelName && Number.isFinite(validatedEnd)) {
        try {
            preserveQuadCurveForInkLimit(channelName, validatedEnd);
        } catch (err) {
            console.warn('[INK LIMIT] preserveQuadCurveForInkLimit failed:', err);
        }
    }

    const currentScalePercentRaw = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
    const currentScalePercent = Number(currentScalePercentRaw);
    if (Number.isFinite(currentScalePercent) && Math.abs(currentScalePercent - 100) > 1e-6) {
        scalingCoordinator
            .scale(currentScalePercent, 'ui-resync', {
                metadata: {
                    trigger: 'endInputResync',
                    skipHistory: true
                }
            })
            .catch((err) => {
                console.warn('[SCALE] Coordinator resync after end edit failed:', err);
            });
    }

    refreshEffectiveInkDisplays();

    // Trigger preview update and chart update
    if (typeof debouncedPreviewUpdate !== 'undefined') {
        debouncedPreviewUpdate();
    }

    // Trigger chart update for immediate visual feedback
    updateInkChart();

    // Update edit mode channel dropdown when channel states change
    setTimeout(() => {
        try {
            populateChannelDropdown();
        } catch (err) {
            console.warn('[EDIT MODE] Channel dropdown update failed:', err);
        }
    }, 0);
}

/**
 * Auto-limit toggle handlers
 * Initialize handlers for auto white/black limit toggles
 */
export function initializeAutoLimitHandlers() {
    // Auto white limit toggle
    if (elements.autoWhiteLimitToggle) {
        elements.autoWhiteLimitToggle.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;

            try {
                localStorage.setItem('autoWhiteLimitV1', enabled ? '1' : '0');
            } catch (err) {
                console.warn('Could not save auto white limit preference:', err);
            }

            showStatus(enabled ? 'Auto white limit enabled' : 'Auto white limit disabled');

            // Update processing details and preview
            try {
                const channels = getCurrentPrinter()?.channels || [];
                channels.forEach(ch => {
                    if (typeof updateProcessingDetail !== 'undefined') {
                        updateProcessingDetail(ch);
                    }
                });
            } catch (err) {
                console.warn('Error updating processing details:', err);
            }

            if (typeof updateSessionStatus !== 'undefined') {
                updateSessionStatus();
            }

            if (typeof debouncedPreviewUpdate !== 'undefined') {
                debouncedPreviewUpdate();
            }
        });
    }

    // Auto black limit toggle
    if (elements.autoBlackLimitToggle) {
        elements.autoBlackLimitToggle.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;

            try {
                localStorage.setItem('autoBlackLimitV1', enabled ? '1' : '0');
            } catch (err) {
                console.warn('Could not save auto black limit preference:', err);
            }

            showStatus(enabled ? 'Auto black limit enabled' : 'Auto black limit disabled');

            // Update processing details and preview
            try {
                const channels = getCurrentPrinter()?.channels || [];
                channels.forEach(ch => {
                    if (typeof updateProcessingDetail !== 'undefined') {
                        updateProcessingDetail(ch);
                    }
                });
            } catch (err) {
                console.warn('Error updating processing details:', err);
            }

            if (typeof updateSessionStatus !== 'undefined') {
                updateSessionStatus();
            }

            if (typeof debouncedPreviewUpdate !== 'undefined') {
                debouncedPreviewUpdate();
            }
        });
    }
}

/**
 * Update reference .quad button appearance based on loaded state
 */
function updateReferenceQuadButton() {
    const btn = elements.loadReferenceQuadBtn;
    if (!btn) return;

    const defaultLabel = btn.dataset.defaultLabel || '→ Load Reference';
    const referenceLoaded = isReferenceQuadLoaded();
    const referenceData = getReferenceQuadData();

    if (referenceLoaded && referenceData?.filename) {
        const filename = referenceData.filename;
        const truncated = filename.length > 28 ? `${filename.slice(0, 25)}…` : filename;
        btn.textContent = `Ref ✓ ${truncated}`;
        const loadedLabel = `Loaded reference: ${filename}. Click to clear the reference overlay.`;
        btn.title = loadedLabel;
        btn.setAttribute('aria-label', loadedLabel);
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('ring-2', 'ring-violet-200');
    } else {
        btn.textContent = defaultLabel;
        const loadLabel = 'Load a reference .quad file (non-editable overlay).';
        btn.title = loadLabel;
        btn.setAttribute('aria-label', loadLabel);
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('ring-2', 'ring-violet-200');
    }
}

/**
 * Initialize file loading handlers
 * Handles .quad file loading and processing
 */
function initializeFileHandlers() {
    try {
        console.log('📁 Initializing file handlers...');

        // Load .quad file button click handler
        if (elements.loadQuadBtn) {
            elements.loadQuadBtn.addEventListener('click', () => {
                console.log('📁 Load .quad button clicked');
                if (elements.quadFile) {
                    elements.quadFile.click();
                } else {
                    console.warn('quadFile element not found');
                }
            });
        } else {
            console.warn('loadQuadBtn element not found');
        }

        // Load .quad file change handler
        if (elements.quadFile) {
            elements.quadFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    console.log('📁 Processing .quad file:', file.name);

                    // Check file type
                    if (!file.name.toLowerCase().endsWith('.quad')) {
                        console.error('Please select a .quad file');
                        return;
                    }

                    // Read file content
                    const content = await readFileAsText(file);
                    console.log('📁 File content read, length:', content.length);

                    // Parse .quad file
                    const parsed = parseQuadFile(content);
                    console.log('📁 Parsed result:', parsed);

                    if (!parsed.valid) {
                        console.error(`Error parsing .quad file: ${parsed.error}`);
                        return;
                    }

                    // Clear active measurement data so intent remap can enable after load
                    LinearizationState.clear();
                    updateAppState({
                        linearizationData: null,
                        linearizationApplied: false,
                        perChannelLinearization: {}
                    });
                    if (isBrowser) {
                        globalScope.linearizationData = null;
                        globalScope.linearizationApplied = false;
                        globalScope.perChannelLinearization = {};
                        globalScope.perChannelEnabled = {};
                        globalScope.perChannelFilenames = {};
                    }

                    // Enrich parsed data with filename and immutable originals
                    const enriched = {
                        ...parsed,
                        filename: file.name
                    };

                    const channelList = Array.isArray(enriched.channels) && enriched.channels.length
                        ? enriched.channels
                        : Object.keys(enriched.curves || {});

                    const originalCurves = {};
                    channelList.forEach((channelName) => {
                        const curve = enriched.curves?.[channelName];
                        if (Array.isArray(curve)) {
                            originalCurves[channelName] = curve.slice();
                        }
                    });
                    enriched.originalCurves = originalCurves;
                    if (!enriched.baselineEnd) {
                        enriched.baselineEnd = {};
                        channelList.forEach((channelName) => {
                            const curve = enriched.curves?.[channelName];
                            if (Array.isArray(curve) && curve.length) {
                                enriched.baselineEnd[channelName] = Math.max(...curve);
                            }
                        });
                    }

                    if (!enriched._originalBaselineEnd) {
                        const originalBaselineEnd = {};
                        channelList.forEach((channelName) => {
                            if (typeof enriched.baselineEnd?.[channelName] === 'number') {
                                originalBaselineEnd[channelName] = enriched.baselineEnd[channelName];
                            } else if (Array.isArray(enriched.originalCurves?.[channelName])) {
                                originalBaselineEnd[channelName] = Math.max(...enriched.originalCurves[channelName]);
                            }
                        });
                        enriched._originalBaselineEnd = originalBaselineEnd;
                    }


                    // Store parsed data in global state
                    setLoadedQuadData(enriched);
                    console.log('📁 Stored .quad data in global state');

                    // Synchronize printer/channel UI with loaded data
                    syncPrinterForQuadData(enriched, { silent: false });

                    console.log('✅ .quad file loaded and applied successfully');

                } catch (error) {
                    console.error('Error loading .quad file:', error);
                }

                // Clear the file input for next use
                e.target.value = '';
            });
        } else {
            console.warn('quadFile element not found');
        }

        // Reference .quad loader button click handler
        if (elements.loadReferenceQuadBtn) {
            elements.loadReferenceQuadBtn.addEventListener('click', () => {
                console.log('📁 Load Reference .quad button clicked');

                // If reference is already loaded, clear it
                if (isReferenceQuadLoaded()) {
                    const clearedFilename = clearReferenceQuadData();
                    if (elements.referenceQuadFile) {
                        elements.referenceQuadFile.value = '';
                    }
                    updateReferenceQuadButton();
                    updateInkChart();
                    if (clearedFilename) {
                        showStatus(`Cleared reference overlay (${clearedFilename})`);
                    } else {
                        showStatus('Cleared reference overlay');
                    }
                    return;
                }

                // Otherwise, trigger file picker
                if (elements.referenceQuadFile) {
                    elements.referenceQuadFile.value = '';
                    elements.referenceQuadFile.click();
                } else {
                    console.warn('referenceQuadFile element not found');
                }
            });
        } else {
            console.warn('loadReferenceQuadBtn element not found');
        }

        // Reference .quad file change handler
        if (elements.referenceQuadFile) {
            elements.referenceQuadFile.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                try {
                    console.log('📁 Processing reference .quad file:', file.name);

                    // Load and validate reference file
                    const result = await loadReferenceQuadFile(file);

                    if (!result.success) {
                        console.error('Reference load error:', result.error);
                        showStatus(result.error);
                        if (result.warning) {
                            // Clear reference but don't show as error
                            clearReferenceQuadData();
                            updateReferenceQuadButton();
                        }
                        return;
                    }

                    // Store reference data
                    setReferenceQuadData(result.data);
                    console.log('📁 Reference .quad loaded:', result.filename);

                    // Auto-enable light blocking overlay
                    const lightBlockingToggle = document.getElementById('lightBlockingOverlayToggle');
                    if (lightBlockingToggle && !lightBlockingToggle.checked) {
                        lightBlockingToggle.checked = true;
                        setChartLightBlockingOverlayEnabled(true);
                        updateAppState({ showLightBlockingOverlay: true });
                    }

                    // Update button appearance
                    updateReferenceQuadButton();

                    // Refresh chart to show reference overlay
                    updateInkChart();

                    // Show status message
                    const statusParts = [
                        `Loaded reference ${result.filename}`,
                        `${result.matchedCount}/${result.totalCount} channels matched`
                    ];
                    if (result.unmatchedCount > 0) {
                        statusParts.push(`${result.unmatchedCount} unmatched`);
                    }
                    showStatus(statusParts.join(' · '));

                } catch (error) {
                    console.error('Error loading reference .quad file:', error);
                    showStatus(`Failed to load reference: ${error.message}`);
                }

                // Clear the file input for next use
                e.target.value = '';
            });
        } else {
            console.warn('referenceQuadFile element not found');
        }

        // Global linearization button click handler
        if (elements.globalLinearizationBtn) {
            elements.globalLinearizationBtn.addEventListener('click', () => {
                console.log('📁 Global linearization button clicked');
                if (elements.linearizationFile) {
                    elements.linearizationFile.click();
                } else {
                    console.warn('linearizationFile element not found');
                }
            });
        } else {
            console.warn('globalLinearizationBtn element not found');
        }

        const applyGlobalLinearizationToggle = (enabled) => {
            const globalData = LinearizationState.getGlobalData();
            if (!globalData) {
                if (elements.globalLinearizationToggle) {
                    elements.globalLinearizationToggle.checked = false;
                    elements.globalLinearizationToggle.setAttribute('aria-checked', 'false');
                }
                showStatus('Load a global correction before enabling the toggle.');
                return;
            }

            if (LinearizationState.isGlobalBaked?.() && !enabled) {
                if (elements.globalLinearizationToggle) {
                    elements.globalLinearizationToggle.checked = true;
                    elements.globalLinearizationToggle.setAttribute('aria-checked', 'true');
                }
                showStatus('Global correction is baked into Smart curves. Undo or revert to disable.');
                return;
            }

            const applied = !!enabled;
            LinearizationState.globalApplied = applied;
            globalData.applied = applied;

            if (isBrowser) {
                globalScope.linearizationApplied = applied;
                globalScope.linearizationData = { ...globalData };
            }

            try {
                const manager = getStateManager?.();
                if (manager) {
                    manager.set('linearization.global.applied', applied);
                    manager.set('linearization.global.enabled', applied);
                    manager.set('linearization.global.data', globalData);
                }
            } catch (err) {
                console.warn('Failed to sync global linearization state manager flags:', err);
            }

            try {
                updateAppState({
                    linearizationApplied: applied,
                    linearizationData: { ...globalData }
                });
            } catch (err) {
                console.warn('Failed to update app state for global linearization:', err);
            }

            if (elements.globalLinearizationToggle) {
                elements.globalLinearizationToggle.checked = applied;
                elements.globalLinearizationToggle.setAttribute('aria-checked', String(applied));
            }

            if (applied && isEditModeEnabled()) {
                try {
                    refreshSmartCurvesFromMeasurements();
                } catch (err) {
                    console.warn('Failed to refresh Smart curves after global toggle:', err);
                }
            }

            const printer = getCurrentPrinter();
            const channels = printer?.channels || [];
            const currentGlobalData = LinearizationState.getGlobalData?.();
            const correctedSnapshot = LinearizationState.getGlobalCorrectedCurves?.();
            const baselineSnapshot = LinearizationState.getGlobalBaselineCurves?.();
            const smoothingPercent = typeof currentGlobalData?.previewSmoothingPercent === 'number'
                ? currentGlobalData.previewSmoothingPercent
                : getLabSmoothingPercent();
            let usedSnapshot = false;

            if (channels.length) {
                if (applied) {
                    if (correctedSnapshot) {
                        usedSnapshot = applyCurveSnapshot(correctedSnapshot, {
                            skipScaleBaselineUpdate: true
                        });
                    }
                } else if (baselineSnapshot) {
                    usedSnapshot = applyCurveSnapshot(baselineSnapshot, {
                        skipScaleBaselineUpdate: true
                    });
                }

                if (!usedSnapshot) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[Global Toggle] Falling back to rebase', { applied, hasCorrectedSnapshot: !!correctedSnapshot, hasBaselineSnapshot: !!baselineSnapshot });
                    }
                    rebaseChannelsToCorrectedCurves(channels, {
                        source: 'globalToggle',
                        filename: currentGlobalData?.filename || null,
                        useOriginalBaseline: smoothingPercent > 0,
                        globalAppliedState: applied,
                        skipScaleBaselineUpdate: true
                    });
                } else if (applied && typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                    try {
                        const loadedData = getLoadedQuadData?.();
                        if (loadedData?.curves) {
                            LinearizationState.setGlobalCorrectedCurves(loadedData.curves);
                        }
                    } catch (snapshotErr) {
                        console.warn('[Global Toggle] Failed to refresh corrected snapshot after restore:', snapshotErr);
                    }
                }
            }

            try {
                updateInkChart();
                if (typeof updatePreview !== 'undefined') {
                    updatePreview();
                }

                const printer = getCurrentPrinter();
                const channels = printer?.channels || [];
                channels.forEach((ch) => {
                    try {
                        updateProcessingDetail(ch);
                    } catch (err) {
                        console.warn(`Failed to refresh processing detail for ${ch}:`, err);
                    }
                });

                updateSessionStatus();
            } catch (err) {
                console.warn('Failed to refresh UI after global toggle:', err);
            }

            try {
                updateRevertButtonsState();
            } catch (err) {
                console.warn('Failed to update revert buttons after global toggle:', err);
            }

            showStatus(applied ? 'Global correction enabled' : 'Global correction disabled');
        };

        // Global linearization file input change handler
        if (elements.linearizationFile) {
            elements.linearizationFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    console.log('📁 Processing global linearization file:', file.name);

                    // Read file content based on file type
                    const extension = file.name.toLowerCase().split('.').pop();
                    let fileInput;
                    if (extension === 'acv') {
                        fileInput = await file.arrayBuffer();
                    } else {
                        fileInput = await file.text();
                    }

                    // Parse the linearization file
                    const parsed = await parseLinearizationFile(fileInput, file.name);

                    if (parsed && parsed.samples) {
                        console.log('✅ Global linearization file loaded:', file.name);

                        if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                            CurveHistory.captureState('Before: Load Global Linearization');
                        }

                        // Store in LinearizationState (modular system)
                        const normalized = normalizeLinearizationEntry(parsed);
                        normalized.filename = file.name;

                        // Use LinearizationState for modular system
                        LinearizationState.setGlobalData(normalized, true, { source: 'external' });
                        setGlobalBakedState(null, { skipHistory: true });
                        updateAppState({ linearizationData: normalized, linearizationApplied: true });
                        syncLabSpotMarkersToggle();

                        try {
                            const loadedData = getLoadedQuadData?.();
                            if (loadedData && loadedData.originalCurves && typeof loadedData.originalCurves === 'object') {
                                if (!loadedData.curves || typeof loadedData.curves !== 'object') {
                                    loadedData.curves = {};
                                }
                                loadedData.rebasedCurves = {};
                                loadedData.rebasedSources = {};
                                const baselineEndSnapshot = {};
                                Object.entries(loadedData.originalCurves).forEach(([channelName, curve]) => {
                                    if (!Array.isArray(curve)) {
                                        return;
                                    }
                                    const cloned = curve.slice();
                                    loadedData.curves[channelName] = cloned.slice();
                                    loadedData.rebasedCurves[channelName] = cloned.slice();
                                    loadedData.rebasedSources[channelName] = cloned.slice();
                                    baselineEndSnapshot[channelName] = Math.max(...cloned);
                                });
                                if (Object.keys(baselineEndSnapshot).length) {
                                    loadedData.baselineEnd = { ...baselineEndSnapshot };
                                }
                                const originalChannels = Object.keys(loadedData.originalCurves).filter((name) => Array.isArray(loadedData.originalCurves[name]));
                                if (originalChannels.length) {
                                    restoreChannelsToRebasedSources(originalChannels, {
                                        skipRefresh: false,
                                        skipScaleBaselineUpdate: true
                                    });
                                }
                            }
                        } catch (resetErr) {
                            console.warn('Failed to restore original curves before applying new global linearization:', resetErr);
                        }

                        try {
                            reapplyCurrentGlobalScale({ skipHistory: true, reason: 'globalLinearizationLoad' });
                        } catch (scaleErr) {
                            console.warn('[GLOBAL LOAD] Failed to reapply existing global scale:', scaleErr);
                        }

                        maybeAutoRaiseInkLimits(normalized, {
                            scope: 'global',
                            label: 'global correction',
                            source: 'global-linearization'
                        });

                        if (isEditModeEnabled()) {
                            refreshSmartCurvesFromMeasurements();
                        }

                        // Also store in legacy window variables for compatibility
                        if (isBrowser) {
                            globalScope.linearizationData = normalized;
                            globalScope.linearizationApplied = true;
                        }

                        // Update the filename display element for status bar
                        if (elements.globalLinearizationFilename) {
                            elements.globalLinearizationFilename.textContent = file.name;
                        }

                        if (elements.globalLinearizationDetails) {
                            const countLabel = getBasePointCountLabel(normalized);
                            const formatToken = String(normalized.format || '')
                                .split(' ')
                                .filter(Boolean)
                                .shift() || '';
                            const formatLabel = formatToken ? formatToken.toUpperCase() : '';
                            const detailParts = [];
                            if (countLabel) detailParts.push(countLabel);
                            if (formatLabel) detailParts.push(`(${formatLabel})`);
                            elements.globalLinearizationDetails.textContent = detailParts.length
                                ? ` - ${detailParts.join(' ')}`
                                : '';
                        }

                        if (elements.globalLinearizationBtn) {
                            const countLabel = getBasePointCountLabel(normalized);
                            elements.globalLinearizationBtn.setAttribute('data-tooltip', `Loaded: ${file.name} (${countLabel})`);
                        }

                        if (elements.globalLinearizationToggle) {
                            elements.globalLinearizationToggle.disabled = false;
                            elements.globalLinearizationToggle.checked = true;
                            elements.globalLinearizationToggle.setAttribute('aria-checked', 'true');
                        }

                        if (elements.globalLinearizationInfo) {
                            elements.globalLinearizationInfo.classList.remove('hidden');
                        }

                        if (elements.globalLinearizationHint) {
                            elements.globalLinearizationHint.classList.add('hidden');
                        }

                        // Note: Revert button state is managed by updateRevertButtonsState()
                        try { updateRevertButtonsState(); } catch (err) { /* ignore */ }

                        if (typeof globalScope.updateInterpolationControls === 'function') {
                            try { globalScope.updateInterpolationControls(); } catch (err) { /* ignore */ }
                        }

                        // Update chart to reflect changes
                        updateInkChart();

                        // Update session status to show the loaded file
                        if (typeof updateSessionStatus === 'function') {
                            updateSessionStatus();
                        }

                        try {
                            postLinearizationSummary();
                        } catch (summaryErr) {
                            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                                console.warn('[LabTechSummary] Failed to post summary after global load:', summaryErr);
                            }
                        }
                        updateCoverageIndicators();

                        console.log('✅ Global linearization applied successfully');

                        const countLabel = getBasePointCountLabel(normalized);
                        showStatus(`Loaded global correction: ${file.name} (${countLabel})`);

                        try {
                            const baselineData = getLoadedQuadData?.();
                            if (baselineData) {
                                const originalCurves = baselineData.originalCurves;
                                if (originalCurves && typeof LinearizationState.setGlobalBaselineCurves === 'function') {
                                    const clonedOriginal = {};
                                    Object.keys(originalCurves).forEach((name) => {
                                        const curve = originalCurves[name];
                                        if (Array.isArray(curve)) {
                                            clonedOriginal[name] = curve.slice();
                                        }
                                    });
                                    if (Object.keys(clonedOriginal).length) {
                                        LinearizationState.setGlobalBaselineCurves(clonedOriginal);
                                    }
                                } else {
                                    const baselineSnapshot = cloneBaselineCurvesFromLoadedData(baselineData);
                                    if (baselineSnapshot) {
                                        LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
                                    }
                                }
                            }
                            if (baselineData) {
                                delete baselineData.rebasedCurves;
                                delete baselineData.rebasedSources;
                            }
                        } catch (snapshotErr) {
                            console.warn('Failed to capture global baseline snapshot:', snapshotErr);
                        }

                        if (typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                            try {
                                LinearizationState.setGlobalCorrectedCurves(null);
                            } catch (snapshotErr) {
                                console.warn('Failed to clear global corrected snapshot before reload:', snapshotErr);
                            }
                        }

                        applyGlobalLinearizationToggle(true);

                        if (getLabSmoothingPercent() <= 0) {
                            const restored = restoreZeroSmoothingSnapshot(normalized.filename);
                            if (!restored) {
                                storeZeroSmoothingSnapshot(normalized.filename);
                            }
                        } else {
                            const dataForReset = getLoadedQuadData?.();
                            if (dataForReset) {
                                delete dataForReset._zeroSmoothingCurves;
                                delete dataForReset._zeroSmoothingSignature;
                                delete dataForReset._zeroSmoothingRestored;
                            }
                        }

                        try {
                            refreshLinearizationDataForNormalization();
                        } catch (refreshErr) {
                            console.warn('Failed to refresh normalization after loading global linearization:', refreshErr);
                        }

                        if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                            CurveHistory.captureState('After: Load Global Linearization (rebased)');
                        }

                        if (getLabSmoothingPercent() <= 0) {
                            restoreZeroSmoothingSnapshot(normalized.filename);
                        }

                    } else {
                        throw new Error('Failed to parse linearization data');
                    }

                } catch (error) {
                    console.error('Error loading global linearization file:', error);
                    // TODO: Add user-visible error message
                }

                // Clear the file input for next use
                e.target.value = '';
            });
        } else {
            console.warn('linearizationFile element not found');
        }

        if (elements.globalLinearizationToggle) {
            const toggle = elements.globalLinearizationToggle;
            toggle.addEventListener('change', () => {
                applyGlobalLinearizationToggle(toggle.checked);
            });

            const initialApplied = !!(LinearizationState.getGlobalData() && LinearizationState.globalApplied);
            toggle.checked = initialApplied;
            toggle.setAttribute('aria-checked', String(initialApplied));
        } else {
            console.warn('globalLinearizationToggle element not found');
        }

        // Global Revert Button Handler
        if (elements.revertGlobalToMeasurementBtn) {
            elements.revertGlobalToMeasurementBtn.addEventListener('click', () => {
                // Guard: only perform revert when there's something to revert (Smart Curves exist OR data was edited)
                try {
                    const revertState = computeGlobalRevertState();
                    const { isMeasurement, hasSmartEdits, wasEdited, isBaked, globalData } = revertState;
                    const fmt = String(globalData?.format || '').toUpperCase();
                    const hasOriginal = Array.isArray(globalData?.originalData);
                    const isEnabled = LinearizationState.isGlobalEnabled();
                    const shouldRevert = !isBaked && isMeasurement && (hasSmartEdits || wasEdited);

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log(`[DEBUG REVERT] Button clicked: fmt="${fmt}", hasData=${!!globalData}, applied=${isEnabled}, hasOriginal=${hasOriginal}, isMeasurement=${isMeasurement}, hasSmartEdits=${hasSmartEdits}, wasEdited=${wasEdited}, isBaked=${isBaked}, shouldRevert=${shouldRevert}`);
                    }

                    if (!shouldRevert) {
                        if (isBaked) {
                            showStatus('Global correction already baked into Smart curves. Use undo to restore measurement.');
                        }
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[DEBUG REVERT] Guard check failed - nothing to revert');
                        }
                        return;
                    }
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[DEBUG REVERT] Guard check error:', err);
                    }
                    return;
                }

                const savedSel = (isEditModeEnabled() && typeof EDIT !== 'undefined' && EDIT && EDIT.selectedChannel)
                    ? EDIT.selectedChannel
                    : null;

                try {
                    if (typeof CurveHistory !== 'undefined') {
                        CurveHistory.captureState('Before: Revert Global to Measurement');
                    }
                } catch (err) {
                    console.warn('Failed to capture history state:', err);
                }

                const printer = getCurrentPrinter();
                const channels = printer?.channels || [];
                const smartRestoreSummary = resetSmartPointsForChannels(channels, {
                    skipUiRefresh: true,
                    forceReinitialize: true
                });

                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[DEBUG REVERT] Smart points restored during global revert', smartRestoreSummary);
                }

                const restoredChannels = restoreChannelsToRebasedSources(channels);

                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[DEBUG REVERT] Baselines restored for channels', restoredChannels);
                }

                try {
                    reapplyCurrentGlobalScale({ skipHistory: true, reason: 'globalRevert' });
                } catch (scaleErr) {
                    console.warn('[DEBUG REVERT] Failed to reapply global scale after revert:', scaleErr);
                }

                const globalBtnRef = document.getElementById('revertGlobalToMeasurementBtn');
                if (globalBtnRef) {
                    globalBtnRef.disabled = true;
                    globalBtnRef.setAttribute('disabled', 'disabled');
                }

                // Mark global measurement as clean again
                if (globalData) {
                    globalData.edited = false;
                }

                // Keep linearization state/applied flags in sync for modular + legacy consumers
                if (globalData) {
                    LinearizationState.setGlobalData(globalData, true, { source: 'measurement' });
                    updateAppState({ linearizationData: globalData, linearizationApplied: true });
                    if (isBrowser) {
                        globalScope.linearizationData = globalData;
                        globalScope.linearizationApplied = true;
                    }
                    setGlobalBakedState(null);
                }

                try {
                    // Update UI
                    updateInkChart();
                    if (typeof updatePreview !== 'undefined') {
                        updatePreview();
                    }

                    channels.forEach((ch) => {
                        try {
                            updateProcessingDetail(ch);
                        } catch (err) {
                            console.warn(`Failed to update processing detail for ${ch}:`, err);
                        }
                    });

                    if (typeof updateSessionStatus !== 'undefined') {
                        updateSessionStatus();
                    }
                } catch (uiErr) {
                    console.warn('Failed to refresh UI before revert state sync:', uiErr);
                }

                try {
                    updateRevertButtonsState();
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[DEBUG REVERT] Post-reset revert button state refreshed');
                    }

                    try {
                        const finalState = computeGlobalRevertState();
                        const shouldEnableFinal = !finalState.isBaked && finalState.isMeasurement && (finalState.hasSmartEdits || finalState.wasEdited);
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[DEBUG REVERT] Final global revert state', finalState);
                        }
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[DEBUG REVERT] Final revert state applied', finalState);
                        }
                        if (!shouldEnableFinal) {
                            const globalBtn = document.getElementById('revertGlobalToMeasurementBtn');
                            if (globalBtn) {
                                globalBtn.disabled = true;
                                globalBtn.setAttribute('disabled', 'disabled');
                            }
                        }
                    } catch (stateErr) {
                        console.warn('Failed to enforce final revert button state:', stateErr);
                    }
                } catch (err) {
                    console.warn('Failed to update revert button states:', err);
                }

                try {
                    showStatus('Reverted to measurement (global)');
                } catch (err) {
                    console.warn('Failed to show status after revert:', err);
                }

                try {
                    const scheduleClear = () => {
                        try {
                            setGlobalBakedState(null, { skipHistory: true });
                        } catch (clearErr) {
                            console.warn('Failed to clear baked state after global revert:', clearErr);
                        }
                    };

                    if (typeof queueMicrotask === 'function') {
                        queueMicrotask(scheduleClear);
                    }
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(() => requestAnimationFrame(scheduleClear));
                    }
                    setTimeout(scheduleClear, 0);
                    setTimeout(scheduleClear, 16);
                    setTimeout(scheduleClear, 100);
                } catch (microErr) {
                    console.warn('Failed to schedule baked-state reset after global revert:', microErr);
                }

                // Restore Edit Mode selection
                try {
                    if (savedSel && isEditModeEnabled()) {
                        const row = Array.from(elements.rows.children).find(tr => tr.getAttribute('data-channel') === savedSel);
                        const endVal = row ? InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0) : 0;
                        if (endVal > 0) {
                            if (elements.editChannelSelect) elements.editChannelSelect.value = savedSel;
                            if (typeof EDIT !== 'undefined') EDIT.selectedChannel = savedSel;
                            if (typeof edit_refreshState === 'function') edit_refreshState();
                            updateInkChart();
                        }
                    }
                } catch (err) {
                    console.warn('Failed to restore Edit Mode selection:', err);
                }

            });

            console.log('✅ Global revert button handler initialized');
        } else {
            console.warn('revertGlobalToMeasurementBtn element not found');
        }

        console.log('✅ File handlers initialized');

    } catch (error) {
        console.error('Error initializing file handlers:', error);
    }
}

/**
 * Initialize contrast intent dropdown handlers
 */
function initializeContrastIntentHandlers() {
    const scheduleIntentApply = (fn) => {
        if (typeof globalScope.requestAnimationFrame === 'function') {
            globalScope.requestAnimationFrame(() => globalScope.requestAnimationFrame(fn));
        } else {
            setTimeout(fn, 0);
        }
    };

    // Initialize contrast intent state
    ensureContrastIntentDefault();

    // Expose setContrastIntent globally for compatibility
    if (isBrowser) {
        globalScope.setContrastIntent = setContrastIntent;
    }

    // Contrast intent dropdown change handler
    if (elements.contrastIntentSelect) {
        elements.contrastIntentSelect.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            console.log('🎯 Contrast intent changed to:', selectedId);

            if (selectedId === 'enter_custom') {
                // Handle custom intent modal (not implemented yet)
                console.log('🎯 Custom intent modal not yet implemented');
                // Reset dropdown to current intent
                const currentId = getAppState().contrastIntent?.id || 'linear';
                elements.contrastIntentSelect.value = currentId;
                return;
            }

            // Apply preset intent
            const preset = getPreset(selectedId);
            if (preset) {
                scheduleIntentApply(() => setContrastIntent(preset.id, preset.params, 'preset'));
            } else {
                console.warn('Unknown intent preset:', selectedId);
            }
        });

        console.log('✅ Contrast intent dropdown handler initialized');
    } else {
        console.warn('Contrast intent dropdown not found');
    }

    if (elements.applyIntentToQuadBtn) {
        elements.applyIntentToQuadBtn.addEventListener('click', () => {
            applyIntentToLoadedCurve();
        });
    }
}

/**
 * Apply the active contrast intent to the loaded .quad curves
 * Mirrors legacy applyIntentToLoadedCurve behavior
 */
function applyIntentToLoadedCurve() {
    if (!canApplyIntentRemap()) {
        const hasQuad = !!(getLoadedQuadData()?.curves);
        const measurementActive = !!(LinearizationState?.getGlobalData?.() && LinearizationState.globalApplied);

        if (!hasQuad) {
            showStatus('Load a .quad before remapping intent');
        } else if (measurementActive) {
            showStatus('Disable or remove global measurement data (LAB/CGATS/TI3) before remapping intent');
        } else {
            showStatus('Intent remap is currently unavailable');
        }
        return;
    }

    const loadedData = getLoadedQuadData();
    if (!loadedData || !loadedData.curves) {
        showStatus('No curve data available for intent remap');
        return;
    }

    const channelList = Array.isArray(loadedData.channels) && loadedData.channels.length
        ? [...loadedData.channels]
        : Object.keys(loadedData.curves);

    if (!channelList.length) {
        showStatus('No channels available for intent remap');
        return;
    }

    const intent = getAppState().contrastIntent || { id: 'linear', name: 'Linear' };
    const intentId = String(intent.id || 'linear');
    const intentName = intent.name || 'Linear';
    const restoringLinear = intentId === 'linear';

    const actions = [];
    const updatedChannels = [];
    const total = TOTAL;
    const history = getHistoryManager?.() ?? null;
    const previousBatchFlag = history ? history.isBatchOperation : false;
    if (history) {
        history.isBatchOperation = true;
    }

    try {
        for (const channelName of channelList) {
            const existingCurve = loadedData.curves[channelName];
            if (!Array.isArray(existingCurve) || existingCurve.length === 0) continue;

            const length = existingCurve.length;
            const denom = Math.max(1, length - 1);
            const oldCurve = existingCurve.slice();

            const oldKeyPointsRaw = loadedData.keyPoints?.[channelName] || null;
            const oldKeyPoints = oldKeyPointsRaw ? oldKeyPointsRaw.map(p => ({ input: p.input, output: p.output })) : null;
            const oldInterpolation = loadedData.keyPointsMeta?.[channelName]?.interpolationType || null;
            const oldSource = loadedData.sources?.[channelName];

            let newCurve;
            const originalCurveForChannel = Array.isArray(loadedData.originalCurves?.[channelName])
                ? loadedData.originalCurves[channelName]
                : null;

            if (restoringLinear) {
                const originalCurve = originalCurveForChannel;
                if (!Array.isArray(originalCurve) || originalCurve.length !== length) {
                    console.warn('Intent remap: missing original curve for', channelName);
                    continue;
                }

                const row = getChannelRow(channelName);
                const endInput = row?.querySelector('.end-input');
                const currentEnd = endInput ? InputValidator.clampEnd(endInput.value) : total;
                const baselineEnd = loadedData.baselineEnd?.[channelName] ?? Math.max(...originalCurve, 0);
                const scale = baselineEnd > 0 ? (currentEnd / baselineEnd) : 0;

                newCurve = originalCurve.map((value) => {
                    const scaled = Math.round(value * scale);
                    return Math.max(0, Math.min(total, Number.isFinite(scaled) ? scaled : 0));
                });

                if (newCurve.length) {
                    newCurve[0] = Math.max(0, Math.min(total, Math.round(originalCurve[0] * scale)));
                    newCurve[length - 1] = Math.max(0, Math.min(total, Math.round(originalCurve[length - 1] * scale)));
                }

                try {
                    if (loadedData.keyPoints?.[channelName]) delete loadedData.keyPoints[channelName];
                    if (loadedData.keyPointsMeta?.[channelName]) delete loadedData.keyPointsMeta[channelName];
                    if (loadedData.sources?.[channelName]) delete loadedData.sources[channelName];
                } catch (err) {
                    console.warn('Intent remap: failed clearing Smart metadata for', channelName, err);
                }
            } else {
                const baselineCurve = (Array.isArray(originalCurveForChannel) && originalCurveForChannel.length === length)
                    ? originalCurveForChannel
                    : existingCurve;

                const xs = new Array(length);
                const ys = new Array(length);
                for (let i = 0; i < length; i++) {
                    xs[i] = denom === 0 ? 0 : i / denom;
                    ys[i] = clamp01(baselineCurve[i] / total);
                }

                let sampler = null;
                try {
                    sampler = createPCHIPSpline(xs, ys);
                } catch (err) {
                    console.warn('Intent remap: PCHIP creation failed for', channelName, err);
                }

                const sample = (t) => {
                    const tt = clamp01(t);
                    if (sampler) {
                        try {
                            const val = sampler(tt);
                            if (Number.isFinite(val)) {
                                return clamp01(val);
                            }
                        } catch (err) {
                            console.warn('Intent remap: sampler error for', channelName, err);
                        }
                    }

                    if (tt <= 0) return ys[0];
                    if (tt >= 1) return ys[length - 1];
                    const pos = tt * denom;
                    const i0 = Math.floor(pos);
                    const i1 = Math.min(length - 1, i0 + 1);
                    const frac = pos - i0;
                    return clamp01(ys[i0] + frac * (ys[i1] - ys[i0]));
                };

                newCurve = new Array(length);
                for (let i = 0; i < length; i++) {
                    const inputT = denom === 0 ? 0 : i / denom;
                    const target = clamp01(getTargetRelAt(inputT));
                    const drive = sample(target);
                    newCurve[i] = Math.round(clamp01(drive) * total);
                }

                if (newCurve.length) {
                    newCurve[0] = Math.max(0, Math.min(total, newCurve[0]));
                    newCurve[length - 1] = Math.max(0, Math.min(total, newCurve[length - 1]));
                }

                try {
                    const adaptivePoints = extractAdaptiveKeyPointsFromValues(newCurve, {
                        maxErrorPercent: KP_SIMPLIFY.maxErrorPercent,
                        maxPoints: KP_SIMPLIFY.maxPoints
                    });
                    ControlPoints.persist(channelName, adaptivePoints, oldInterpolation || 'smooth');
                    const meta = loadedData.keyPointsMeta?.[channelName];
                    if (meta && meta.bakedGlobal) {
                        delete meta.bakedGlobal;
                    }
                } catch (err) {
                    console.warn('Intent remap: failed to persist key points for', channelName, err);
                }
            }

            loadedData.curves[channelName] = newCurve;

            let newKeyPoints = null;
            let newInterpolation = null;
            if (!restoringLinear && loadedData.keyPoints?.[channelName]) {
                newKeyPoints = loadedData.keyPoints[channelName].map(p => ({ input: p.input, output: p.output }));
                newInterpolation = loadedData.keyPointsMeta?.[channelName]?.interpolationType || oldInterpolation || 'smooth';
            }

            actions.push({
                channelName,
                type: 'curve',
                oldValue: oldCurve,
                newValue: newCurve.slice(),
                oldKeyPoints,
                newKeyPoints,
                oldInterpolation,
                newInterpolation,
                oldSource,
                newSource: loadedData.sources?.[channelName] ?? oldSource,
                clearKeyPoints: restoringLinear,
                linearRestore: restoringLinear
            });

            updatedChannels.push(channelName);
        }
    } catch (error) {
        if (history) {
            history.isBatchOperation = previousBatchFlag;
        }
        console.error('Intent remap failed:', error);
        showStatus(error?.message ? `Intent remap failed: ${error.message}` : 'Intent remap failed');
        return;
    }

    if (history) {
        history.isBatchOperation = previousBatchFlag;
    }

    if (!actions.length) {
        showStatus('No eligible channel data to remap intent');
        return;
    }

    const description = restoringLinear ? 'Intent remap → Linear (restore original)' : `Intent remap → ${intentName}`;
    if (history?.recordBatchAction) {
        history.recordBatchAction(description, actions);
    }

    try {
        if (typeof updatePreview === 'function') {
            updatePreview();
        } else updatePreview();
    } catch (err) {
        console.warn('Intent remap: failed to update preview', err);
    }

    try { updateInkChart(); } catch (err) { console.warn('Intent remap: chart update failed', err); }
    try { updateCompactChannelsList(); } catch (err) { console.warn('Intent remap: compact list update failed', err); }
    try {
        updatedChannels.forEach((channelName) => {
            try { updateProcessingDetail(channelName); } catch (err) { console.warn('Intent remap: processing detail update failed for', channelName, err); }
        });
    } catch (err) {
        console.warn('Intent remap: processing detail batch update failed', err);
    }

    try { updateSessionStatus(); } catch (err) { console.warn('Intent remap: session status update failed', err); }
    updateIntentDropdownState();

    const statusIntent = restoringLinear ? 'Linear' : intentName;
    showStatus(`Applied ${statusIntent} intent to ${updatedChannels.length} channel${updatedChannels.length === 1 ? '' : 's'}`);
}

if (isBrowser) {
    globalScope.applyIntentToLoadedCurve = applyIntentToLoadedCurve;
}

function refreshGlobalScaleLockState() {
    if (!elements?.scaleAllInput) {
        return;
    }

    const printer = typeof getCurrentPrinter === 'function' ? getCurrentPrinter() : null;
    const lockedChannels = getLockedChannels(printer?.channels || []);
    const anyLocked = lockedChannels.length > 0;
    const message = getGlobalScaleLockMessage(lockedChannels);

    elements.scaleAllInput.disabled = anyLocked;
    elements.scaleAllInput.classList.toggle('bg-gray-50', anyLocked);
    elements.scaleAllInput.classList.toggle('cursor-not-allowed', anyLocked);

    if (anyLocked && message) {
        elements.scaleAllInput.setAttribute('title', message);
        elements.scaleAllInput.dataset.tooltip = message;
        elements.scaleAllInput.setAttribute('aria-disabled', 'true');
    } else {
        elements.scaleAllInput.removeAttribute('title');
        delete elements.scaleAllInput.dataset.tooltip;
        elements.scaleAllInput.removeAttribute('aria-disabled');
    }
}

/**
 * Update channel rows with data from loaded .quad file
 * @param {Object} quadData - Parsed .quad file data
 */
/**
 * Setup virtual checkbox mechanism for a channel row
 * This creates the virtual checkbox that enables/disables channels
 * @param {HTMLElement} tr - Channel row element
 */
export function setupChannelRow(tr) {
    if (tr && typeof tr._lockCleanup === 'function') {
        try {
            tr._lockCleanup();
        } catch (err) {
            console.warn('Failed to cleanup existing lock subscription for row', tr.dataset?.channel, err);
        }
        delete tr._lockCleanup;
    }

    const percentInput = tr.querySelector('.percent-input');
    const endInput = tr.querySelector('.end-input');
    const disabledTag = tr.querySelector('[data-disabled]');
    const processingLabel = tr.querySelector('.processing-label');
    const channelName = tr.dataset.channel;
    const densityInput = tr.querySelector('.density-input');

    const lockBtn = tr.querySelector('.channel-lock-btn');


    const LOCK_ICONS = {
        locked: '<svg class="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="11" width="13" height="9.5" rx="2"></rect><path d="M16 11V8a4 4 0 00-8 0v3"></path><path d="M12 15v2.5"></path></svg>',
        unlocked: '<svg class="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="11" width="13" height="9.5" rx="2"></rect><path d="M16 11V8.5a4 4 0 00-7.5-2"></path></svg>'
    };

    const applyLockDisabledState = (inputEl, locked) => {
        if (!inputEl) return;
        if (locked) {
            if (inputEl.dataset.lockDisabled !== 'true') {
                inputEl.dataset.lockDisabled = 'true';
                inputEl.dataset.lockPrevDisabled = inputEl.disabled ? 'true' : 'false';
            }
            inputEl.disabled = true;
            inputEl.classList.add('bg-gray-50');
        } else if (inputEl.dataset.lockDisabled === 'true') {
            const wasDisabled = inputEl.dataset.lockPrevDisabled === 'true';
            inputEl.disabled = wasDisabled;
            delete inputEl.dataset.lockPrevDisabled;
            delete inputEl.dataset.lockDisabled;
            if (!inputEl.disabled) {
                inputEl.classList.remove('bg-gray-50');
            }
        } else if (!inputEl.disabled) {
            inputEl.classList.remove('bg-gray-50');
        }
    };

    const initialPercentValue = percentInput ? InputValidator.clampPercent(percentInput.value) : 0;
    const initialEndValue = endInput ? InputValidator.clampEnd(endInput.value) : 0;
    const initialLockState = ensureChannelLock(channelName, {
        percentLimit: initialPercentValue,
        endValue: initialEndValue
    });

    const updateLockButtonUI = (state) => {
        if (!lockBtn) return;
        const locked = !!state?.locked;
        lockBtn.innerHTML = locked ? LOCK_ICONS.locked : LOCK_ICONS.unlocked;
        lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
        lockBtn.dataset.locked = locked ? 'true' : 'false';
        const tooltip = locked
            ? 'Unlock to allow edits'
            : 'Lock to prevent edits';
        lockBtn.dataset.tooltip = tooltip;
        lockBtn.title = tooltip;
        lockBtn.classList.toggle('bg-slate-600', locked);
        lockBtn.classList.toggle('text-white', locked);
        lockBtn.classList.toggle('border-gray-300', !locked);
        lockBtn.classList.toggle('text-gray-600', !locked);
        lockBtn.classList.toggle('bg-white', !locked);
        applyLockDisabledState(percentInput, locked);
        applyLockDisabledState(endInput, locked);
        applyLockDisabledState(densityInput, locked);
        refreshGlobalScaleLockState();
    };

    updateLockButtonUI(initialLockState);
    applyDensityStateToRow(tr, getResolvedDensity(channelName));
    let unsubscribeLock = null;
    if (lockBtn) {
        unsubscribeLock = subscribeToChannelLock(channelName, updateLockButtonUI);
        lockBtn.addEventListener('click', () => {
            const history = getHistoryManager?.();
            const beforeState = getChannelLockInfo(channelName);
            const currentlyLocked = !!beforeState.locked;
            const lockBounds = {
                percentLimit: InputValidator.clampPercent(percentInput ? percentInput.value : initialPercentValue),
                endValue: InputValidator.clampEnd(endInput ? endInput.value : initialEndValue)
            };

            if (!currentlyLocked) {
                updateChannelLockBounds(channelName, lockBounds);
            }

            setChannelLock(channelName, !currentlyLocked, lockBounds);

            if (history && typeof history.recordChannelAction === 'function') {
                try {
                    const afterState = getChannelLockInfo(channelName);
                    history.recordChannelAction(channelName, 'lock', beforeState.locked, afterState.locked, {
                        beforeLock: beforeState,
                        afterLock: afterState
                    });
                } catch (err) {
                    console.warn('[history] Failed to record lock toggle for', channelName, err);
                }
            }

            const statusMessage = !currentlyLocked
                ? `${channelName} ink limit locked`
                : `${channelName} ink limit unlocked`;
            showStatus(statusMessage);
        });
    }

    if (typeof unsubscribeLock === 'function') {
        tr._lockCleanup = unsubscribeLock;
    }

    ensureOriginalInkSnapshot(tr, channelName);

    if (processingLabel) {
        processingLabel.textContent = '→ Linear ramp';
        processingLabel.setAttribute('title', 'Linear ramp');
        console.log('[status] seeded default label', channelName);
    } else {
        console.log('[status] no processing label found during setup', channelName);
    }

    const perChannelBtn = tr.querySelector('.per-channel-btn');
    const perChannelFile = tr.querySelector('.per-channel-file');
    const perChannelToggle = tr.querySelector('.per-channel-toggle');
    const perChannelRevert = tr.querySelector('.per-channel-revert');

    const { linearization: perChannelLinearizationMap, enabled: perChannelEnabledMap, filenames: perChannelFilenamesMap } = getPerChannelMaps();

    let existingPerChannelData = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName) || null;
    if (existingPerChannelData) {
        perChannelLinearizationMap[channelName] = existingPerChannelData;
        if (!perChannelFilenamesMap[channelName]) {
            perChannelFilenamesMap[channelName] = existingPerChannelData.filename || null;
        }
        const initialEnabled = perChannelEnabledMap[channelName];
        const enabledState = typeof initialEnabled === 'boolean' ? initialEnabled : LinearizationState.isPerChannelEnabled(channelName);
        perChannelEnabledMap[channelName] = enabledState !== false;
        LinearizationState.setPerChannelData(channelName, existingPerChannelData, perChannelEnabledMap[channelName]);
        syncPerChannelAppState(channelName, existingPerChannelData);
    } else {
        perChannelEnabledMap[channelName] = false;
    }

    const hasSmartCurveActive = () => (typeof isSmartCurve === 'function' && isSmartCurve(channelName));

    const refreshPerChannelDisplay = () => {
        const data = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName) || null;
        if (data && perChannelLinearizationMap[channelName] !== data) {
            perChannelLinearizationMap[channelName] = data;
        }
        if (perChannelBtn) {
            if (data) {
                const displayName = getEditedDisplayName(perChannelFilenamesMap[channelName] || data.filename || 'unknown file', !!data.edited);
                perChannelBtn.setAttribute('data-tooltip', `Loaded: ${displayName}`);
            } else {
                perChannelBtn.setAttribute('data-tooltip', 'Load LUT.cube, LABdata.txt, or .acv curve files');
            }
        }
        const hasMeasurement = !!data;
        const smartTag = getLoadedQuadData()?.sources?.[channelName] || null;
        const hasSmart = hasSmartCurveActive() || smartTag === 'smart';

        if (hasMeasurement) {
            tr.removeAttribute('data-allow-toggle');
        }

        const allowToggleFlag = tr.getAttribute('data-allow-toggle') === 'true';
        const toggleBaked = perChannelToggle?.getAttribute('data-baked') === 'true';
        const shouldAllowToggle = (!toggleBaked) && (hasMeasurement || hasSmart || allowToggleFlag);

        if (perChannelToggle) {
            const isEnabled = hasMeasurement && (perChannelEnabledMap[channelName] !== false);
            perChannelToggle.disabled = !shouldAllowToggle || toggleBaked;
            perChannelToggle.checked = !toggleBaked && hasMeasurement && isEnabled;
        }
        if (perChannelRevert) {
            perChannelRevert.disabled = !hasMeasurement && !hasSmart;
            if (hasMeasurement) {
                perChannelRevert.title = `Revert ${channelName} to measurement`;
            } else if (hasSmart) {
                perChannelRevert.title = `Clear Smart on ${channelName}`;
            } else {
                perChannelRevert.title = 'No measurement loaded';
            }
            perChannelRevert.classList.toggle('invisible', perChannelRevert.disabled);

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && channelName === 'MK') {
                console.log('[DEBUG REFRESH] MK button state', {
                    hasMeasurement,
                    hasSmart,
                    disabled: perChannelRevert.disabled
                });
            }
        }
    };

    const handlePerChannelFileLoad = async (file) => {
        if (!file || !perChannelBtn) return;

        try {
            if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                // Capture current channel state for debugging
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    const row = document.querySelector(`[data-channel="${channelName}"]`);
                    const percentInput = row?.querySelector('.percent-input');
                    const checkbox = row?._virtualCheckbox;
                    console.log(`[UNDO DEBUG] Before snapshot for ${channelName}:`, {
                        percent: percentInput?.value,
                        enabled: checkbox?.checked
                    });
                }
                CurveHistory.captureState(`Before: Load Per-Channel Linearization (${channelName})`);
            }

            const extension = file.name.toLowerCase().split('.').pop();
            const fileInput = extension === 'acv' ? await file.arrayBuffer() : await file.text();
            const parsed = await parseLinearizationFile(fileInput, file.name);
            const normalized = normalizeLinearizationEntry(parsed);
            normalized.edited = false;

            perChannelLinearizationMap[channelName] = normalized;
            perChannelEnabledMap[channelName] = true;
            perChannelFilenamesMap[channelName] = file.name;
            existingPerChannelData = normalized;

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[per-channel] parsed 1D LUT', channelName, {
                    format: normalized.format,
                    sampleCount: Array.isArray(normalized.samples) ? normalized.samples.length : 'n/a',
                    first: normalized.samples?.[0],
                    mid: normalized.samples?.[Math.floor((normalized.samples?.length || 1) / 2)],
                    last: normalized.samples?.[normalized.samples?.length - 1]
                });
            }

            LinearizationState.setPerChannelData(channelName, normalized, true);
            syncPerChannelAppState(channelName, normalized);

            maybeAutoRaiseInkLimits(normalized, {
                scope: 'channel',
                channelName,
                label: `${channelName} correction`,
                source: 'per-channel-linearization'
            });

            if (perChannelToggle) {
                perChannelToggle.disabled = false;
                perChannelToggle.checked = true;
            }

            rebaseChannelsToCorrectedCurves([channelName], { source: 'perChannelLoad' });

            perChannelEnabledMap[channelName] = false;

            if (typeof updateInterpolationControls === 'function') {
                try { updateInterpolationControls(); } catch (err) { /* ignore */ }
            } else if (typeof globalScope.updateInterpolationControls === 'function') {
                try { globalScope.updateInterpolationControls(); } catch (err) { /* ignore */ }
            }

            const formatLabel = getBasePointCountLabel(normalized) || `${Array.isArray(normalized.samples) ? normalized.samples.length : 0} points`;
            const fmtLower = String(normalized.format || '').toLowerCase();
            let methodNote = '';
            if (fmtLower.includes('lab') || fmtLower.includes('manual')) {
                methodNote = ' (CIE density; Gaussian-weighted reconstruction with PCHIP interpolation)';
            }

            if (normalized.is3DLUT) {
                const count = Array.isArray(normalized.samples) ? normalized.samples.length : 0;
                const sizeSuffix = normalized.lutSize ? ` (${normalized.lutSize}³ grid)` : '';
                showStatus(`Loaded 3D LUT and extracted ${count} neutral axis points for ${channelName}${sizeSuffix}`);
            } else {
                showStatus(`Loaded per-channel correction for ${channelName}: ${formatLabel}${methodNote}`);
            }

            refreshPerChannelDisplay();
            updateProcessingDetail(channelName);
            updateInkChart();
            debouncedPreviewUpdate();

            // Reinitialize Smart Curves if edit mode is active
            if (typeof globalScope.reinitializeChannelSmartCurves === 'function') {
                try {
                    globalScope.reinitializeChannelSmartCurves(channelName);
                } catch (err) {
                    console.warn('[per-channel] Failed to reinitialize Smart Curves for', channelName, err);
                }
            }

            updateSessionStatus();
            updateRevertButtonsState();

            // Capture "After:" snapshot to pair with "Before:" for proper undo/redo
            if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                try {
                    CurveHistory.captureState(`After: Load Per-Channel Linearization (${channelName})`);
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.warn('[per-channel] Failed to capture After snapshot:', err);
                    }
                }
            }
        } catch (error) {
            console.error('Per-channel linearization file error:', error);
            showStatus(`Error loading ${channelName} linearization: ${error.message}`);
            delete perChannelLinearizationMap[channelName];
            delete perChannelFilenamesMap[channelName];
            perChannelEnabledMap[channelName] = false;
            existingPerChannelData = null;
            LinearizationState.clearPerChannel(channelName);
            syncPerChannelAppState(channelName, null);
            if (perChannelToggle) {
                perChannelToggle.disabled = true;
                perChannelToggle.checked = false;
            }
            refreshPerChannelDisplay();
            updateProcessingDetail(channelName);
            updateInkChart();
            refreshEffectiveInkDisplays();
        } finally {
            if (perChannelFile) {
                perChannelFile.value = '';
            }
        }
    };

    if (perChannelBtn) {
        perChannelBtn.addEventListener('click', () => {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[per-channel] load click', channelName, { hasInput: !!perChannelFile });
            }
            if (perChannelFile) {
                try {
                    perChannelFile.value = '';
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) console.warn('[per-channel] unable to reset file input', err);
                }
                perChannelFile.click();
            } else {
                showStatus(`Unable to open file picker for ${channelName} (input missing)`);
            }
        });
    }

    if (perChannelFile) {
        perChannelFile.addEventListener('change', (event) => {
            const file = event.target?.files?.[0];
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[per-channel] file selected', channelName, { hasFile: !!file, name: file?.name });
            }
            if (file) {
                handlePerChannelFileLoad(file);
            }
        });
    }

    if (perChannelToggle) {
        perChannelToggle.addEventListener('change', (event) => {
            const data = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName);
            if (!data) {
                perChannelToggle.checked = false;
                return;
            }

            const enabled = !!event.target.checked;
            perChannelEnabledMap[channelName] = enabled;
            LinearizationState.setPerChannelData(channelName, data, enabled);
            syncPerChannelAppState(channelName, data);

            showStatus(enabled ? `Enabled per-channel linearization for ${channelName}` : `Disabled per-channel linearization for ${channelName}`);

            refreshPerChannelDisplay();
            updateProcessingDetail(channelName);
            updateInkChart();
            debouncedPreviewUpdate();
            updateRevertButtonsState();
        });
    }

    if (perChannelRevert) {
        perChannelRevert.addEventListener('click', () => {
            const savedSel = (isEditModeEnabled() && typeof EDIT !== 'undefined' && EDIT && EDIT.selectedChannel)
                ? EDIT.selectedChannel
                : null;

            const measurement = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName) || null;
            const hasMeasurement = !!measurement;
            const hasSmart = hasSmartCurveActive();

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[DEBUG REVERT] Per-channel revert click', {
                    channelName,
                    hasMeasurement,
                    hasSmart,
                    measurementLabel: measurement?.filename || measurement?.format || null,
                    linearizationEnabled: LinearizationState.isPerChannelEnabled(channelName)
                });
            }

            if (!hasMeasurement && !hasSmart) {
                showStatus(`No per-channel measurement to revert for ${channelName}`);
                return;
            }

            setRevertInProgress(true);

            try {
                if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                    CurveHistory.captureState(`Before: Revert ${channelName} to Measurement`);
                }

                const manager = typeof getStateManager === 'function' ? getStateManager() : null;
                const loadedData = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {}, baselineEnd: {}, rebasedCurves: {}, rebasedSources: {} }));
                let restoredBaselines = [];

                if (hasMeasurement) {
                    restoredBaselines = restoreChannelsToRebasedSources([channelName]);

                    tr.removeAttribute('data-allow-toggle');
                    try { measurement.edited = false; } catch (err) {}
                    perChannelEnabledMap[channelName] = true;
                    LinearizationState.setPerChannelData(channelName, measurement, true);
                    syncPerChannelAppState(channelName, measurement);
                    existingPerChannelData = measurement;

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log(`[DEBUG REVERT] Restoring Smart points for ${channelName}`);
                    }

                    const restoreResult = resetChannelSmartPointsToMeasurement(channelName, {
                        skipUiRefresh: true,
                        forceReinitialize: true
                    });

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        const refreshed = ControlPoints.get(channelName)?.points?.length || null;
                        console.log(`[DEBUG REVERT] Post-restore state for ${channelName}`, {
                            restoredFromSeed: restoreResult?.restoredFromSeed,
                            pointCount: refreshed,
                            rebasedBaselineRestored: restoredBaselines.includes(channelName)
                        });
                    }
                } else {
                    tr.setAttribute('data-allow-toggle', 'true');
                    perChannelEnabledMap[channelName] = false;
                    delete perChannelLinearizationMap[channelName];
                    delete perChannelFilenamesMap[channelName];
                    LinearizationState.clearPerChannel(channelName);
                    syncPerChannelAppState(channelName, null);
                    existingPerChannelData = null;

                    let restored = false;
                    const originalCurve = loadedData?.originalCurves?.[channelName];
                    if (Array.isArray(originalCurve) && originalCurve.length) {
                        const originalEnd = Math.max(...originalCurve);
                        const originalPercent = InputValidator.computePercentFromEnd(originalEnd);
                        const percentInput = tr.querySelector('.percent-input');
                        const endInput = tr.querySelector('.end-input');

                        if (percentInput) {
                percentInput.value = formatPercentDisplay(originalPercent);
                            percentInput.setAttribute('data-base-percent', String(originalPercent));
                            InputValidator.clearValidationStyling(percentInput);
                        }

                        if (endInput) {
                            endInput.value = String(originalEnd);
                            endInput.setAttribute('data-base-end', String(originalEnd));
                            InputValidator.clearValidationStyling(endInput);
                        }

                        if (manager) {
                            try {
                                manager.setChannelValue(channelName, 'percentage', originalPercent);
                                manager.setChannelValue(channelName, 'endValue', originalEnd);
                                manager.setChannelEnabled(channelName, originalEnd > 0);
                            } catch (err) {
                                console.warn('[DEBUG REVERT] Failed to sync state manager for original restore on', channelName, err);
                            }
                        }

                        loadedData.curves = loadedData.curves || {};
                        loadedData.curves[channelName] = originalCurve.slice();
                        loadedData.rebasedCurves = loadedData.rebasedCurves || {};
                        loadedData.rebasedCurves[channelName] = originalCurve.slice();

                        if (loadedData.rebasedSources && loadedData.rebasedSources[channelName]) {
                            delete loadedData.rebasedSources[channelName];
                        }

                        loadedData.baselineEnd = loadedData.baselineEnd || {};
                        loadedData.baselineEnd[channelName] = originalEnd;

                        updateScaleBaselineForChannelCore(channelName);
                        restored = true;
                    } else {
                        if (loadedData.curves?.[channelName]) delete loadedData.curves[channelName];
                        if (loadedData.rebasedCurves?.[channelName]) delete loadedData.rebasedCurves[channelName];
                        if (loadedData.baselineEnd?.[channelName]) delete loadedData.baselineEnd[channelName];
                        if (loadedData.rebasedSources?.[channelName]) delete loadedData.rebasedSources[channelName];
                    }

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log(`[DEBUG REVERT] Cleared per-channel measurement for ${channelName}`, { restored });
                    }
                }

                refreshPerChannelDisplay();

                if (perChannelToggle) {
                    perChannelToggle.disabled = false;
                    perChannelToggle.checked = hasMeasurement;
                }

                showStatus(hasMeasurement
                    ? `Reverted ${channelName} to measurement`
                    : `Cleared Smart on ${channelName} (restored loaded .quad)`);

                if (tr.refreshDisplayFn) {
                    try { tr.refreshDisplayFn(); } catch (err) {}
                }

                updateProcessingDetail(channelName);
                debouncedPreviewUpdate();
                updateInkChart();

                if (typeof updateInterpolationControls === 'function') {
                    try { updateInterpolationControls(); } catch (err) {}
                } else if (typeof globalScope.updateInterpolationControls === 'function') {
                    try { globalScope.updateInterpolationControls(); } catch (err) {}
                }

                updateRevertButtonsState();
                updateSessionStatus();

                try {
                    if (savedSel && isEditModeEnabled()) {
                        const row = Array.from(elements.rows.children).find(tr => tr.getAttribute('data-channel') === savedSel);
                        const endVal = row ? InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0) : 0;
                        if (endVal > 0) {
                            if (elements.editChannelSelect) elements.editChannelSelect.value = savedSel;
                            EDIT.selectedChannel = savedSel;
                            edit_refreshState();
                            updateInkChart();
                        }
                    }
                } catch (err) {}
            } finally {
                setRevertInProgress(false);
                try {
                    updateRevertButtonsState();
                } catch (err) {
                    console.warn('[revert-global] final button refresh failed:', err);
                }
            }
        });
    }

    refreshPerChannelDisplay();

    // Create virtual checkbox object since physical checkbox is removed
    // Chips section now handles enable/disable, but we need compatibility with existing logic
    const enableCheckbox = {
        checked: !tr.hasAttribute('data-user-disabled'),
        addEventListener: function(event, handler) {
            // Store the handler for later use by chips
            tr._checkboxChangeHandler = handler;
        },
        dispatchEvent: function(event) {
            if (tr._checkboxChangeHandler && event.type === 'change') {
                tr._checkboxChangeHandler();
            }
        }
    };

    // Store virtual checkbox on tr for chips access
    tr._virtualCheckbox = enableCheckbox;

    registerChannelRow(channelName, tr);

    // Store original values for restoration when re-enabling
    const markEditing = (input, commitFn) => {
        if (!input) return;
        input.addEventListener('focus', () => {
            clearPendingCommitHold(input);
            input.dataset.userEditing = 'true';
            input.dataset.userEditingNew = 'true';
            tr.dataset.userEditing = 'true';
            input.dataset.initialNumericValue = input.value ?? '';
        });
        input.addEventListener('keydown', (event) => {
            if (input.dataset.userEditing !== 'true') {
                return;
            }
            if (event.key && event.key.length === 1 && /[0-9]/.test(event.key)) {
                if (input.dataset.userEditingNew === 'true') {
                    input.value = event.key;
                    input.dataset.userEditingNew = 'false';
                    event.preventDefault();
                    return;
                }
            } else if (event.key !== 'Shift') {
                input.dataset.userEditingNew = 'false';
            }
        });
        input.addEventListener('blur', () => {
            delete input.dataset.userEditing;
            delete input.dataset.userEditingNew;
            delete tr.dataset.userEditing;
            if (typeof commitFn === 'function') {
                commitFn();
            }
        });
    };

    markEditing(percentInput, () => handlePercentInput(percentInput, { commit: true }));
    markEditing(endInput, () => handleEndInput(endInput, { commit: true }));

    const commitDensityInput = () => {
        if (!densityInput) return;
        const raw = typeof densityInput.value === 'string' ? densityInput.value.trim() : '';
        const numeric = raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(numeric)) {
            clearChannelDensity(channelName);
            applyDensityStateToRow(tr, getResolvedDensity(channelName));
            return;
        }
        if (numeric === 0) {
            const fallback = DEFAULT_CHANNEL_DENSITIES[channelName];
            const fallbackValue = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[density] immediate fallback', channelName, fallbackValue);
            }
            const result = setSolverChannelDensity(channelName, fallbackValue) || {
                value: fallbackValue,
                source: 'solver'
            };
            applyDensityStateToRow(tr, result);
            return;
        }
        const result = setManualChannelDensity(channelName, numeric);
        applyDensityStateToRow(tr, result);
    };

    if (densityInput) {
        markEditing(densityInput, () => commitDensityInput());
        densityInput.addEventListener('change', () => commitDensityInput());
    }

    const originalPercent = parseFloat((percentInput?.getAttribute('data-base-percent') ?? percentInput?.value) || 0);
    const originalEnd = parseFloat((endInput?.getAttribute('data-base-end') ?? endInput?.value) || 0);

    // Store original values on the row element
    tr._originalPercent = originalPercent;
    tr._originalEnd = originalEnd;

    // Set up change handler for virtual checkbox
    enableCheckbox.addEventListener('change', () => {
        if (enableCheckbox.checked) {
            // Enable channel
            tr.removeAttribute('data-user-disabled');
            if (disabledTag) {
                disabledTag.classList.add('invisible');
            }

            // Restore original values if they were stored, otherwise use reasonable defaults
            if (percentInput) {
                if (tr._originalPercent > 0) {
                    setBasePercentOnInput(percentInput, tr._originalPercent);
                    percentInput.value = tr._originalPercent.toString();
                } else {
                    setBasePercentOnInput(percentInput, 100);
                    percentInput.value = '100';
                }
            }
            if (endInput) {
                if (tr._originalEnd > 0) {
                    setBaseEndOnInput(endInput, tr._originalEnd);
                    endInput.value = tr._originalEnd.toString();
                } else {
                    const newEndValue = Math.round((parseFloat(percentInput?.value || 100) / 100) * 65535);
                    setBaseEndOnInput(endInput, newEndValue);
                    endInput.value = newEndValue.toString();
                }
            }
        } else {
            // Disable channel - but first save current values as the new "original" values
            tr._originalPercent = parseFloat((percentInput?.getAttribute('data-base-percent') ?? percentInput?.value) || 0);
            tr._originalEnd = parseFloat((endInput?.getAttribute('data-base-end') ?? endInput?.value) || 0);

            tr.setAttribute('data-user-disabled', 'true');
            if (disabledTag) {
                disabledTag.classList.remove('invisible');
            }

            // Set values to zero
            if (percentInput) {
                setBasePercentOnInput(percentInput, 0);
                percentInput.value = '0';
            }
            if (endInput) {
                setBaseEndOnInput(endInput, 0);
                endInput.value = '0';
            }
        }

        // Update chart after change
        if (typeof updateInkChart === 'function') {
            updateInkChart();
        }

        // Update compact channels list
        updateCompactChannelsList();

        // Update "No channels enabled" message state
        updateNoChannelsMessage();

        // Call refreshDisplay to update channel visibility after value changes
        if (tr.refreshDisplayFn && typeof tr.refreshDisplayFn === 'function') {
            tr.refreshDisplayFn();
        }
    });

    // Create the refreshDisplay function (critical for global scale integration)
    function refreshDisplay() {
        const endVal = InputValidator.clampEnd(endInput.value);
        endInput.value = String(endVal);

        const isUserDisabled = tr.hasAttribute('data-user-disabled');
        const isAtZero = endVal === 0;
        const percentValue = InputValidator.clampPercent(percentInput.value);

        if (!isChannelLocked(channelName)) {
            updateChannelLockBounds(channelName, {
                percent: percentValue,
                endValue: endVal
            });
        }

        // Show disabled label if channel is at 0 (either user-disabled or set to 0%)
        if (disabledTag) {
            disabledTag.classList.toggle('invisible', !isAtZero);
        }
        if (densityInput) {
            densityInput.disabled = isAtZero || densityInput.dataset.lockDisabled === 'true';
            densityInput.classList.toggle('bg-gray-50', densityInput.disabled);
        }
        // Handle ultra-compact layout for disabled channels
        const inputsEditing = (percentInput?.dataset.userEditing === 'true')
            || (endInput?.dataset.userEditing === 'true')
            || (densityInput?.dataset.userEditing === 'true');

        if (inputsEditing) {
            tr.setAttribute('data-compact', 'false');
            tr.style.display = '';
        } else if (isAtZero) {
            tr.setAttribute('data-compact', 'true');
            tr.style.display = 'none';
        } else {
            tr.setAttribute('data-compact', 'false');
            tr.style.display = '';
        }
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[compact] refresh', channelName, { isAtZero, attr: tr.getAttribute('data-compact') });
        }
        updateCompactChannelsList();

        // Update "No channels enabled" message state
        updateNoChannelsMessage();

        // Update checkbox state based on channel status
        enableCheckbox.checked = !isAtZero;

        if (typeof updateProcessingDetail === 'function') {
            try {
                updateProcessingDetail(tr.dataset.channel);
            } catch (err) {
                console.warn('Failed to refresh processing detail:', err);
            }
        }

        updateLockButtonUI(getChannelLockInfo(channelName));
    }

    // Store refreshDisplay function on the tr element for access from scaling functions
    tr.refreshDisplayFn = refreshDisplay;

    // Set initial state based on current values
    const currentPercent = parseFloat(percentInput?.value || 0);
    const currentEnd = parseFloat(endInput?.value || 0);

    if (currentPercent > 0 || currentEnd > 0) {
        enableCheckbox.checked = true;
        tr.removeAttribute('data-user-disabled');
        if (disabledTag) {
            disabledTag.classList.add('invisible');
        }
    } else {
        enableCheckbox.checked = false;
        tr.setAttribute('data-user-disabled', 'true');
        if (disabledTag) {
            disabledTag.classList.remove('invisible');
        }
    }

    // CRITICAL: Sync initial channel values to state manager for proper undo/redo
    // Without this, the state manager has empty values and snapshots will be wrong
    try {
        const manager = getStateManager?.() ?? null;
        if (manager && channelName) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log(`[INIT DEBUG] Syncing initial values for ${channelName}: percent=${currentPercent}, end=${currentEnd}`);
            }
            manager.setChannelValue(channelName, 'percentage', currentPercent);
            manager.setChannelValue(channelName, 'endValue', currentEnd);
            manager.setChannelEnabled(channelName, currentPercent > 0 || currentEnd > 0);
        }
    } catch (err) {
        console.warn(`Failed to sync initial channel values for ${channelName}:`, err);
    }

    // Initial refresh to set up display state
    refreshDisplay();
    refreshPerChannelDisplay();
}

registerChannelRowSetup(setupChannelRow);

if (unsubscribeChannelDensityStore) {
    unsubscribeChannelDensityStore();
}
unsubscribeChannelDensityStore = subscribeChannelDensities((channelName, payload) => {
    const row = getChannelRow(channelName);
    if (!row) return;
    if (payload && typeof payload === 'object') {
        applyDensityStateToRow(row, payload);
    }
});


/**
 * Initialize edit mode button handlers
 * Handles the edit mode toggle button functionality
 */
function initializeEditModeHandlers() {
    const editModeToggleBtn = elements.editModeToggleBtn;

    if (editModeToggleBtn) {
        editModeToggleBtn.addEventListener('click', () => {
            const currentState = isEditModeEnabled();
            setEditMode(!currentState, { recordHistory: true });
        });

        console.log('✅ Edit mode toggle button handler initialized');
    } else {
        console.warn('Edit mode toggle button not found');
    }

    // Initialize edit mode help button
    const editModeHelpBtn = document.getElementById('editModeHelpBtn');
    const editModeHelpPopup = document.getElementById('editModeHelpPopup');
    const closeEditModeHelpBtn = document.getElementById('closeEditModeHelpBtn');

    if (editModeHelpBtn && editModeHelpPopup) {
        editModeHelpBtn.addEventListener('click', () => {
            editModeHelpPopup.classList.remove('hidden');
        });
    }

    if (closeEditModeHelpBtn && editModeHelpPopup) {
        closeEditModeHelpBtn.addEventListener('click', () => {
            editModeHelpPopup.classList.add('hidden');
        });

        // Also close on backdrop click
        editModeHelpPopup.addEventListener('click', (e) => {
            if (e.target === editModeHelpPopup) {
                editModeHelpPopup.classList.add('hidden');
            }
        });
    }

    // Start with edit mode disabled by default
    setEditMode(false, { recordHistory: false });
    console.log('🔄 Edit mode initialized to OFF state');
}

/**
 * Remove all event listeners (cleanup function)
 * This can be used when reinitializing or cleaning up
 */
export function removeEventHandlers() {
    // Note: This is a placeholder for cleanup functionality
    // In practice, we would track listeners and remove them here
    console.log('🧹 Event handlers cleanup requested (placeholder)');
    if (unsubscribeChannelDensityStore) {
        unsubscribeChannelDensityStore();
        unsubscribeChannelDensityStore = null;
    }
}
function ensureContrastIntentDefault() {
    const preset = getPreset('linear');
    const defaultIntent = {
        id: 'linear',
        name: preset?.label || 'Linear',
        params: preset?.params || {},
        source: 'preset'
    };

    const state = getAppState();
    if (!state.contrastIntent) {
        updateAppState({ contrastIntent: defaultIntent });
    }

    if (isBrowser && !globalScope.contrastIntent) {
        globalScope.contrastIntent = defaultIntent;
    }
}

function setContrastIntent(id, params = {}, source = 'preset') {
    const preset = getPreset(id) || {};
    const mergedParams = { ...(preset.params || {}), ...params };
    const intent = {
        id,
        name: preset.label || id,
        params: mergedParams,
        source
    };

    updateAppState({ contrastIntent: intent });
    if (isBrowser) {
        globalScope.contrastIntent = intent;
    }

    if (typeof updateIntentDropdownState === 'function') {
        updateIntentDropdownState();
    }

    if (typeof updateSessionStatus === 'function') {
        updateSessionStatus();
    }

    updateInkChart();
   debouncedPreviewUpdate();
}

export const __plotSmoothingTestUtils = {
    applyPlotSmoothingToLoadedChannels,
    applyPlotSmoothingToEntries,
    applyPlotSmoothingToCurve,
    blendCurveHeadWithBaseline,
    blendCurveTailWithBaseline,
    storeZeroSmoothingSnapshot,
    restoreZeroSmoothingSnapshot,
    schedulePlotSmoothingRefresh,
    refreshLinearizationDataForNormalization,
    refreshPlotSmoothingSnapshotsForSmartEdit
};
