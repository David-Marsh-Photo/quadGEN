// quadGEN Edit Mode State Management
// Handles edit mode toggle functionality and UI state

import { elements, getLoadedQuadData, ensureLoadedQuadData, getEditModeFlag, setEditModeFlag, TOTAL } from '../core/state.js';
import { InputValidator } from '../core/validation.js';
import {
    adjustSmartKeyPointByIndex,
    insertSmartKeyPointAt,
    deleteSmartKeyPointByIndex,
    simplifySmartKeyPointsFromCurve,
    ControlPoints,
    setSmartKeyPoints,
    createDefaultKeyPoints,
    extractAdaptiveKeyPointsFromValues,
    toRelativeOutput,
    toAbsoluteOutput,
    KP_SIMPLIFY
} from '../curves/smart-curves.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { getChannelRow } from './channel-registry.js';
import { getStateManager } from '../core/state-manager.js';
import { triggerInkChartUpdate, triggerProcessingDetail, triggerProcessingDetailAll, triggerRevertButtonsUpdate, triggerPreviewUpdate } from './ui-hooks.js';
import { initializeBellShiftControls, updateBellShiftControl } from './bell-shift-controls.js';
import { initializeBellWidthControls, updateBellWidthControls } from './bell-width-controls.js';
import { updateSessionStatus } from './graph-status.js';
import { registerDebugNamespace, getDebugRegistry } from '../utils/debug-registry.js';
import { showStatus } from './status-service.js';
import { getLegacyHelper, invokeLegacyHelper } from '../legacy/legacy-helpers.js';
import { getHistoryManager } from '../core/history-manager.js';
import { isChannelLocked, getChannelLockEditMessage } from '../core/channel-locks.js';
import { make256 as make256Direct } from '../core/processing-pipeline.js';

/**
 * Edit mode global state
 */
const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
const isBrowser = typeof document !== 'undefined';

const EDIT_STATE = {
    selectedChannel: null,
    selectedOrdinal: 1
};

let editModePrimed = isBrowser && globalScope.__EDIT_MODE_PRIMED === true;

let cachedStateManager = null;

function getStateManagerSafe() {
    if (!cachedStateManager) {
        try {
            cachedStateManager = getStateManager();
        } catch (err) {
            cachedStateManager = null;
        }
    }
    return cachedStateManager;
}

const SmartPointDragContext = {
    active: false,
    channel: null,
    ordinal: 0,
    originalPoints: null,
    originalInterpolation: 'smooth',
    selectionBefore: null,
    originalCurve: null,
    originalSource: null,
    transactionId: null,
    historyDescription: null,
    originalInkLimits: null
};

function clonePoints(points) {
    if (!Array.isArray(points)) return null;
    return points.map((p) => ({ input: Number(p.input), output: Number(p.output) }));
}

const CURVE_RESOLUTION = 256;
const SEED_TOLERANCE_PERCENT = 0.5;

function editModeDebugLog(message, payload = null) {
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        if (payload) {
            console.warn(`[EDIT MODE] ${message}`, payload);
        } else {
            console.warn(`[EDIT MODE] ${message}`);
        }
    }
}

function getFallbackCurveSamples(channelName) {
    const data = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
    if (!data) return null;
    const sources = [
        data.originalCurves?.[channelName],
        data.plotBaseCurves?.[channelName],
        data.rebasedCurves?.[channelName],
        data.curves?.[channelName]
    ];
    for (let i = 0; i < sources.length; i += 1) {
        const candidate = sources[i];
        const isArrayLike = Array.isArray(candidate) || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(candidate));
        if (isArrayLike && candidate && candidate.length === CURVE_RESOLUTION) {
            return Array.from(candidate);
        }
    }
    return null;
}

function shouldPreferFallbackSamples(primary, fallback, tolerancePercent = SEED_TOLERANCE_PERCENT) {
    if (!Array.isArray(fallback) || fallback.length !== CURVE_RESOLUTION) {
        return false;
    }
    if (!Array.isArray(primary) || primary.length !== CURVE_RESOLUTION) {
        return true;
    }
    const peak = fallback.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);
    const tolerance = Math.max(10, Math.round((peak * tolerancePercent) / 100));
    for (let i = 0; i < fallback.length; i += 1) {
        const primaryValue = Number(primary[i]) || 0;
        const fallbackValue = Number(fallback[i]) || 0;
        const delta = Math.abs(primaryValue - fallbackValue);
        if (delta > tolerance) {
            return true;
        }
        if (fallbackValue === 0 && primaryValue > 0) {
            return true;
        }
        if (fallbackValue > 0 && fallbackValue <= tolerance && delta > Math.max(5, fallbackValue * 2)) {
            return true;
        }
    }
    return false;
}

function isSampleApproximatelyLinear(samples, tolerancePercent = SEED_TOLERANCE_PERCENT) {
    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        return true;
    }
    const lastIndex = samples.length - 1;
    if (lastIndex <= 0) {
        return true;
    }

    const start = Number(samples[0]) || 0;
    const end = Number(samples[lastIndex]) || 0;

    const peak = samples.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), Math.max(start, end));
    const tolerance = Math.max(10, Math.round((Math.max(1, peak) * tolerancePercent) / 100));

    for (let i = 1; i < lastIndex; i += 1) {
        const expected = start + ((end - start) * (i / lastIndex));
        const delta = Math.abs((Number(samples[i]) || 0) - expected);
        if (delta > tolerance) {
            return false;
        }
    }
    return true;
}

function resolveSeedingSamples(channelName, endValue, applyLinearization, contextLabel = 'default') {
    editModeDebugLog(`resolveSeedingSamples called for ${channelName}`, { endValue, contextLabel });
    let samples = sampleLinearizedCurve(channelName, endValue, applyLinearization);
    const fallback = getFallbackCurveSamples(channelName);
    const fallbackValid = Array.isArray(fallback) && fallback.length === CURVE_RESOLUTION;
    const loadedData = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
    const measurementActive = !!(applyLinearization && LinearizationState?.hasAnyLinearization?.());

    if (typeof globalScope !== 'undefined') {
        globalScope.__EDIT_LAST_SAMPLES = {
            channel: channelName,
            context: contextLabel,
            hasFallback: fallbackValid,
            usedFallback: false,
            preview: fallbackValid ? fallback.slice(0, 6) : []
        };
        globalScope.__EDIT_LAST_SAMPLES_LOG = globalScope.__EDIT_LAST_SAMPLES_LOG || {};
        globalScope.__EDIT_LAST_SAMPLES_LOG[channelName] = {
            channel: channelName,
            context: contextLabel,
            hasFallback: fallbackValid,
            preview: fallbackValid ? fallback.slice(0, 6) : []
        };
    }

    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        if (fallbackValid) {
            editModeDebugLog(`Using fallback samples for ${channelName}`, { context: contextLabel, reason: 'primary_missing' });
            if (loadedData) {
                loadedData.curves = loadedData.curves || {};
                loadedData.curves[channelName] = fallback.slice();
                if (loadedData.sources && loadedData.sources[channelName] === 'smart') {
                    loadedData.sources[channelName] = 'quad';
                }
            }
            if (typeof globalScope !== 'undefined' && globalScope.__EDIT_LAST_SAMPLES) {
                globalScope.__EDIT_LAST_SAMPLES.usedFallback = true;
                if (globalScope.__EDIT_LAST_SAMPLES_LOG && globalScope.__EDIT_LAST_SAMPLES_LOG[channelName]) {
                    globalScope.__EDIT_LAST_SAMPLES_LOG[channelName].usedFallback = true;
                }
            }
            seedChannelFromSamples(channelName, fallback, `${contextLabel}:fallback-primary-missing`);
            return fallback;
        }
        return null;
    }

    // When measurement corrections are active, the fallback (.quad) curve is expected to differ from make256().
    // Don't override corrected samples with the fallback just because they don't match.
    if (!measurementActive && fallbackValid && shouldPreferFallbackSamples(samples, fallback)) {
        editModeDebugLog(`Fallback samples preferred for ${channelName}`, { context: contextLabel, reason: 'mismatch' });
        if (loadedData) {
            loadedData.curves = loadedData.curves || {};
            loadedData.curves[channelName] = fallback.slice();
            if (loadedData.sources && loadedData.sources[channelName] === 'smart') {
                loadedData.sources[channelName] = 'quad';
            }
        }
        if (typeof globalScope !== 'undefined' && globalScope.__EDIT_LAST_SAMPLES) {
            globalScope.__EDIT_LAST_SAMPLES.usedFallback = true;
            if (globalScope.__EDIT_LAST_SAMPLES_LOG && globalScope.__EDIT_LAST_SAMPLES_LOG[channelName]) {
                globalScope.__EDIT_LAST_SAMPLES_LOG[channelName].usedFallback = true;
            }
        }
        seedChannelFromSamples(channelName, fallback, `${contextLabel}:fallback-mismatch`);
        return fallback;
    }

    return samples;
}

function seedChannelFromSamples(channelName, samples, contextLabel = 'default') {
    editModeDebugLog('seedChannelFromSamples invoked', {
        channelName,
        context: contextLabel,
        sampleCount: Array.isArray(samples) ? samples.length : 0
    });
    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        return false;
    }
    const fallbackSamples = getFallbackCurveSamples(channelName);
    const fallbackValid = Array.isArray(fallbackSamples) && fallbackSamples.length === CURVE_RESOLUTION;
    const verificationTarget = fallbackValid
        ? fallbackSamples
        : samples;
    const measurementActive = !!(LinearizationState?.hasAnyLinearization?.());
    if (!measurementActive && Array.isArray(fallbackSamples) && fallbackSamples.length === CURVE_RESOLUTION && shouldPreferFallbackSamples(samples, fallbackSamples)) {
        editModeDebugLog(`Seed samples overridden by fallback for ${channelName}`, { context: contextLabel });
        samples = fallbackSamples.slice();
        if (typeof globalScope !== 'undefined' && globalScope.__EDIT_LAST_SAMPLES) {
            globalScope.__EDIT_LAST_SAMPLES.usedFallback = true;
        }
        if (typeof globalScope !== 'undefined' && globalScope.__EDIT_LAST_SAMPLES_LOG && globalScope.__EDIT_LAST_SAMPLES_LOG[channelName]) {
            globalScope.__EDIT_LAST_SAMPLES_LOG[channelName].usedFallback = true;
        }
    }
    const peak = samples.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);
    const row = elements.rows ? Array.from(elements.rows.children).find((tr) => tr.getAttribute('data-channel') === channelName) : null;
    const percentInput = row?.querySelector('.percent-input');
    const endInput = row?.querySelector('.end-input');
    const resolvedEnd = Number.parseInt(endInput?.value || '0', 10);
    const scaleMax = Math.max(1, Number.isFinite(resolvedEnd) && resolvedEnd > 0 ? resolvedEnd : peak);
    const linearSource = isSampleApproximatelyLinear(samples);

    let activeSamples = samples;
    let seedResult = deriveSeedPointsFromSamples(channelName, activeSamples, { scaleMax });

    if ((!seedResult || !Array.isArray(seedResult.points) || seedResult.points.length < 2) && fallbackValid) {
        const fallbackResult = deriveSeedPointsFromSamples(channelName, fallbackSamples, { scaleMax });
        if (fallbackResult && Array.isArray(fallbackResult.points) && fallbackResult.points.length > (seedResult?.points?.length || 0)) {
            seedResult = fallbackResult;
            activeSamples = fallbackSamples;
        }
    }
    if (!seedResult || !Array.isArray(seedResult.points) || seedResult.points.length < 2) {
        console.warn('[EDIT MODE] seedChannelFromSamples failed', {
            channelName,
            context: contextLabel,
            samplePreview: activeSamples.slice(0, 8),
            pointCount: seedResult?.points?.length || 0,
            scaleMax
        });
        return false;
    }

    if (seedResult.points.length <= 2 && !linearSource) {
        editModeDebugLog(`Rejected 2-point Smart seed for ${channelName}`, {
            context: contextLabel,
            reason: 'non_linear_source',
            peak,
            scaleMax
        });
        return false;
    }

    let channelPercent = Number.parseFloat(percentInput?.value || '0');
    if (!Number.isFinite(channelPercent) || channelPercent <= 0) {
        channelPercent = InputValidator.computePercentFromEnd(Number.isFinite(resolvedEnd) && resolvedEnd > 0 ? resolvedEnd : TOTAL);
    }

    const referenceSamples = fallbackValid ? fallbackSamples : activeSamples;
    const sampleLastIndex = referenceSamples.length - 1;
    const safeTotal = Number.isFinite(TOTAL) && TOTAL > 0 ? TOTAL : 65535;

    const convertToAbsolutePoints = (points) => points.map((point) => {
        const normalizedOutput = Math.max(0, Math.min(100, Number(point.output)));
        const input = Number(point.input);
        let absolutePercent = null;

        if (sampleLastIndex >= 0) {
            const sampleIndex = Math.max(0, Math.min(sampleLastIndex, Math.round((input / 100) * sampleLastIndex)));
            const sampleValue = Number(referenceSamples[sampleIndex]);
            if (Number.isFinite(sampleValue) && safeTotal > 0) {
                absolutePercent = (sampleValue / safeTotal) * 100;
            }
        }

        if (!Number.isFinite(absolutePercent)) {
            absolutePercent = Number.isFinite(channelPercent) && channelPercent > 0
                ? (normalizedOutput / 100) * channelPercent
                : normalizedOutput;
        }

        return {
            input,
            output: Math.max(0, Math.min(100, absolutePercent))
        };
    });

    const absolutePoints = convertToAbsolutePoints(seedResult.points);

    persistSmartPoints(channelName, absolutePoints, 'smooth', {
        channelPercentOverride: channelPercent,
        pointsAreRelative: false,
        smartTouched: false,
        skipUiRefresh: false,
        includeBakedFlags: false,
        sourceSamples: referenceSamples
    });

    let effectivePoints = absolutePoints;

    const verification = verifySmartCurveMatchesSource(channelName, verificationTarget, 0.05);
    if (!verification.ok) {
        editModeDebugLog(`Smart seed mismatch detected for ${channelName}`, {
            context: contextLabel,
            ...verification
        });
        const tightened = deriveSeedPointsFromSamples(channelName, activeSamples, {
            scaleMax,
            maxErrorPercent: Math.max(0.02, KP_SIMPLIFY.maxErrorPercent * 0.5),
            maxPoints: KP_SIMPLIFY.maxPoints
        });
        if (tightened && Array.isArray(tightened.points) && tightened.points.length >= 2) {
            const tightenedAbsolute = convertToAbsolutePoints(tightened.points);
            persistSmartPoints(channelName, tightenedAbsolute, 'smooth', {
                channelPercentOverride: channelPercent,
                pointsAreRelative: false,
                smartTouched: false,
                skipUiRefresh: false,
                includeBakedFlags: false,
                sourceSamples: referenceSamples
            });
            const secondaryCheck = verifySmartCurveMatchesSource(channelName, verificationTarget, 0.05);
            if (secondaryCheck.ok) {
                effectivePoints = tightenedAbsolute;
            } else {
                editModeDebugLog(`Tightened reseed still mismatched for ${channelName}`, secondaryCheck);
            }
        }
    }

    editModeDebugLog(`Seeded ${effectivePoints.length} Smart key points for ${channelName}`, { context: contextLabel });
    if (typeof globalScope !== 'undefined') {
        globalScope.__EDIT_LAST_SEED = {
            channelName,
            context: contextLabel,
            pointCount: effectivePoints.length,
            linearSource,
            peak: seedResult?.peak ?? peak,
            scaleMax,
            preview: activeSamples.slice(0, 8)
        };
        globalScope.__EDIT_SEED_AUDIT = globalScope.__EDIT_SEED_AUDIT || {};
        globalScope.__EDIT_SEED_AUDIT[channelName] = {
            context: contextLabel,
            absolutePreview: absolutePoints.slice(0, 6),
            samplePreview: activeSamples.slice(0, 6)
        };
    }
    return true;
}

function seedSmartPointsFromStoredCurve(channelName, contextLabel = 'stored') {
    const samples = getFallbackCurveSamples(channelName);
    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        console.warn('[EDIT MODE] seedSmartPointsFromStoredCurve missing samples', { channelName, contextLabel });
        return false;
    }
    return seedChannelFromSamples(channelName, samples, contextLabel);
}

function buildInflectionPointsFromSamples(samples, scaleMax = TOTAL) {
    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        return createDefaultKeyPoints();
    }
    const lastIndex = samples.length - 1;
    const clamp = (value) => {
        const percent = scaleMax > 0 ? (value / scaleMax) * 100 : 0;
        return Math.max(0, Math.min(100, percent));
    };
    const points = [];
    let previous = samples[0];
    points.push({ input: 0, output: clamp(previous) });
    for (let i = 1; i < lastIndex; i += 1) {
        const current = samples[i];
        if (current !== previous) {
            const input = (i / lastIndex) * 100;
            const output = clamp(current);
            if (!points.some((point) => Math.abs(point.input - input) <= 0.05)) {
                points.push({ input, output });
            }
            previous = current;
        }
    }
    const tail = samples[lastIndex];
    points.push({ input: 100, output: clamp(tail) });
    return ControlPoints.normalize(points);
}

function ensurePlateauAnchors(channelName, samples, keyPoints, options = {}) {
    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        return keyPoints;
    }
    if (!Array.isArray(keyPoints) || keyPoints.length >= 3) {
        return keyPoints;
    }

    const { scaleMax = TOTAL, peak = 0 } = options || {};
    const lastIndex = samples.length - 1;
    if (lastIndex < 2) {
        return keyPoints;
    }

    const startValue = Number(samples[0]) || 0;
    const endValue = Number(samples[lastIndex]) || 0;
    if (!Number.isFinite(endValue) || endValue <= startValue) {
        return keyPoints;
    }

    let firstRiseIndex = -1;
    for (let i = 1; i < lastIndex; i += 1) {
        const value = Number(samples[i]) || 0;
        if (value > startValue) {
            firstRiseIndex = i;
            break;
        }
    }

    if (firstRiseIndex <= 0 || firstRiseIndex >= lastIndex) {
        return keyPoints;
    }

    const plateauFraction = firstRiseIndex / lastIndex;
    // Require at least ~5% of the curve to be flat before we treat it as a plateau.
    if (!Number.isFinite(plateauFraction) || plateauFraction < 0.05) {
        return keyPoints;
    }

    const safeScaleMax = Math.max(1, Number(scaleMax) || TOTAL);
    const clampPercent = (value) => Math.max(0, Math.min(100, (Number(value) || 0) / safeScaleMax * 100));
    const plateauInput = (firstRiseIndex / lastIndex) * 100;
    const plateauOutput = clampPercent(samples[firstRiseIndex]);

    const addedAnchors = [];
    const maybeAddAnchor = (input, output) => {
        if (!Number.isFinite(input) || !Number.isFinite(output)) {
            return;
        }
        const alreadyPresent = keyPoints.some((point) => Math.abs(point.input - input) <= 0.05 && Math.abs(point.output - output) <= 0.1)
            || addedAnchors.some((point) => Math.abs(point.input - input) <= 0.05 && Math.abs(point.output - output) <= 0.1);
        if (!alreadyPresent) {
            addedAnchors.push({ input, output });
        }
    };

    maybeAddAnchor(plateauInput, plateauOutput);

    // If the plateau covers a large portion of the ramp, also capture a mid-slope point
    if (plateauFraction > 0.25) {
        const midIndex = Math.min(lastIndex - 1, Math.round((firstRiseIndex + lastIndex) / 2));
        if (midIndex > firstRiseIndex) {
            const midInput = (midIndex / lastIndex) * 100;
            const midOutput = clampPercent(samples[midIndex]);
            maybeAddAnchor(midInput, midOutput);
        }
    }

    if (addedAnchors.length === 0) {
        return keyPoints;
    }

    const merged = ControlPoints.normalize([...keyPoints, ...addedAnchors]);
    if (merged.length >= 3) {
        editModeDebugLog(`Plateau anchors injected for ${channelName}`, {
            plateauFraction: Number(plateauFraction.toFixed(3)),
            added: merged.length - keyPoints.length,
            peak
        });
    }
    return merged;
}

function deriveSeedPointsFromSamples(channelName, samples, options = {}) {
    if (!Array.isArray(samples) || samples.length !== CURVE_RESOLUTION) {
        return null;
    }
    const peak = samples.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);
    if (peak <= 0) {
        return {
            points: createDefaultKeyPoints(),
            samples: samples.slice(),
            peak
        };
    }

    const scaleMax = Math.max(1, Number(options.scaleMax) || TOTAL);
    const extractionOptions = {
        maxErrorPercent: options.maxErrorPercent ?? KP_SIMPLIFY.maxErrorPercent,
        maxPoints: options.maxPoints ?? KP_SIMPLIFY.maxPoints,
        scaleMax
    };

    let keyPoints = extractAdaptiveKeyPointsFromValues(samples, extractionOptions);

    // For linear ramps, 2 points is the correct result - skip fallback attempts
    const samplesAreLinear = isSampleApproximatelyLinear(samples);

    if ((!Array.isArray(keyPoints) || keyPoints.length <= 2) && !samplesAreLinear) {
        const refined = extractAdaptiveKeyPointsFromValues(samples, {
            maxErrorPercent: Math.max(0.02, extractionOptions.maxErrorPercent * 0.25),
            maxPoints: Math.max(16, extractionOptions.maxPoints + 10),
            scaleMax
        });
        if (Array.isArray(refined) && refined.length > keyPoints.length) {
            keyPoints = refined;
        }
    }

    if ((!Array.isArray(keyPoints) || keyPoints.length <= 2) && !samplesAreLinear) {
        editModeDebugLog(`Adaptive extraction fallback for ${channelName}`, {
            pointCount: keyPoints?.length || 0,
            peak,
            scaleMax
        });
        keyPoints = buildInflectionPointsFromSamples(samples, scaleMax);
    }

    if (Array.isArray(keyPoints) && keyPoints.length <= 2 && !samplesAreLinear) {
        keyPoints = ensurePlateauAnchors(channelName, samples, keyPoints, { scaleMax, peak });
    }

    return {
        points: ControlPoints.normalize(keyPoints),
        samples: samples.slice(),
        peak
    };
}

function verifySmartCurveMatchesSource(channelName, sourceSamples, tolerancePercent = SEED_TOLERANCE_PERCENT) {
    if (!Array.isArray(sourceSamples) || sourceSamples.length !== CURVE_RESOLUTION) {
        return { ok: true, maxDelta: 0, tolerance: 0, worstIndex: 0 };
    }
    const data = typeof getLoadedQuadData === 'function' ? getLoadedQuadData() : null;
    const current = data?.curves?.[channelName];
    if (!Array.isArray(current) || current.length !== sourceSamples.length) {
        return { ok: true, maxDelta: 0, tolerance: 0, worstIndex: 0 };
    }
    const peak = sourceSamples.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);
    const tolerance = Math.max(10, Math.round((peak * tolerancePercent) / 100));
    let maxDelta = 0;
    let worstIndex = 0;
    for (let i = 0; i < sourceSamples.length; i += 1) {
        const delta = Math.abs(sourceSamples[i] - current[i]);
        if (delta > maxDelta) {
            maxDelta = delta;
            worstIndex = i;
        }
    }
    const ok = maxDelta <= tolerance;
    if (!ok) {
        editModeDebugLog(`Smart curve mismatch for ${channelName}`, { maxDelta, tolerance, worstIndex });
    }
    return { ok, maxDelta, tolerance, worstIndex };
}

function formatPercentForBaseline(value) {
    if (!Number.isFinite(value)) return '0';
    const roundedInt = Math.round(value);
    if (Math.abs(value - roundedInt) < 0.05) {
        return String(roundedInt);
    }
    return Number(value.toFixed(1)).toString();
}

function restoreInkLimitBaseline(channelName, baseline) {
    if (!channelName || !baseline) {
        return;
    }

    const row = getChannelRow(channelName);
    if (!row) {
        return;
    }

    const percentInput = row.querySelector('.percent-input');
    const endInput = row.querySelector('.end-input');

    const percentValue = Number.isFinite(baseline.percent) ? baseline.percent : 0;
    const endValue = Number.isFinite(baseline.end) ? baseline.end : 0;

    if (percentInput) {
        percentInput.value = formatPercentForBaseline(percentValue);
        percentInput.setAttribute('data-base-percent', String(percentValue));
    }

    if (endInput) {
        const roundedEnd = Math.round(endValue);
        endInput.value = String(roundedEnd);
        endInput.setAttribute('data-base-end', String(roundedEnd));
    }

    try {
        const manager = getStateManagerSafe();
        if (manager) {
            manager.setChannelValue(channelName, 'percentage', percentValue, { skipHistory: true, allowDuringRestore: true });
            manager.setChannelValue(channelName, 'endValue', Math.round(endValue), { skipHistory: true, allowDuringRestore: true });
        }
    } catch (err) {
        console.warn('[EDIT MODE] Failed to restore ink baseline in state manager:', err);
    }

    try {
        const loadedData = ensureLoadedQuadData?.(() => ({
            curves: {},
            baselineEnd: {},
            sources: {},
            keyPoints: {},
            keyPointsMeta: {},
            rebasedCurves: {},
            rebasedSources: {}
        }));
        if (loadedData) {
            if (!loadedData.baselineEnd) {
                loadedData.baselineEnd = {};
            }
            loadedData.baselineEnd[channelName] = Math.round(endValue);
        }
    } catch (stateErr) {
        console.warn('[EDIT MODE] Failed to restore baselineEnd data:', stateErr);
    }
}

export function isSmartPointDragActive() {
    return SmartPointDragContext.active;
}

export function beginSmartPointDrag(channelName, ordinal) {
    if (!isEditModeEnabled()) {
        return { success: false, message: 'Edit mode is off' };
    }
    if (!channelName || !Number.isFinite(ordinal) || ordinal < 1) {
        return { success: false, message: 'Invalid drag target' };
    }

    if (isChannelLocked(channelName)) {
        showStatus(`${channelName} ink limit is locked. Unlock before adjusting points.`);
        return { success: false, message: 'Channel is locked' };
    }

    ensureSmartKeyPointsForChannel(channelName);
    const entry = ControlPoints.get(channelName);
    const points = entry?.points;
    if (!points || points.length < ordinal) {
        return { success: false, message: 'Smart key point unavailable' };
    }

    SmartPointDragContext.active = true;
    SmartPointDragContext.channel = channelName;
    SmartPointDragContext.ordinal = ordinal;
    SmartPointDragContext.originalPoints = clonePoints(points);
    SmartPointDragContext.originalInterpolation = entry?.interpolation || 'smooth';
    SmartPointDragContext.selectionBefore = {
        channel: EDIT_STATE.selectedChannel,
        ordinal: EDIT_STATE.selectedOrdinal
    };
    const loadedData = getLoadedQuadData?.();
    SmartPointDragContext.originalCurve = Array.isArray(loadedData?.curves?.[channelName])
        ? loadedData.curves[channelName].slice()
        : null;
    SmartPointDragContext.originalSource = loadedData?.sources?.[channelName] ?? null;
    SmartPointDragContext.historyDescription = `Drag ${channelName} point ${ordinal}`;
    SmartPointDragContext.transactionId = null;
    SmartPointDragContext.originalInkLimits = (() => {
        const row = getChannelRow(channelName);
        if (!row) return null;
        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        if (!percentInput && !endInput) return null;

        const percentAttr = percentInput?.getAttribute('data-base-percent');
        const endAttr = endInput?.getAttribute('data-base-end');

        const percentBase = Number(percentAttr ?? (percentInput?.value ?? '0'));
        const endBase = Number(endAttr ?? (endInput?.value ?? '0'));

        return {
            percent: Number.isFinite(percentBase) ? percentBase : 0,
            end: Number.isFinite(endBase) ? endBase : 0
        };
    })();

    const history = getHistoryManager?.();
    if (history && typeof history.beginTransaction === 'function') {
        try {
            SmartPointDragContext.transactionId = history.beginTransaction(SmartPointDragContext.historyDescription);
        } catch (err) {
            console.warn('[EDIT MODE] Failed to start history transaction for drag:', err);
            SmartPointDragContext.transactionId = null;
        }
    }

    setEditSelectionState(channelName, ordinal, { skipHistory: true });
    refreshEditState();
    updatePointDisplay();

    return { success: true };
}

export function updateSmartPointDrag(channelName, ordinal, coords = {}) {
    if (!SmartPointDragContext.active || SmartPointDragContext.channel !== channelName || SmartPointDragContext.ordinal !== ordinal) {
        return { success: false, message: 'Drag state mismatch' };
    }

    if (isChannelLocked(channelName)) {
        return { success: false, message: 'Channel is locked' };
    }

    const { inputPercent, outputPercent } = coords || {};
    const params = {};
    if (Number.isFinite(inputPercent)) {
        params.inputPercent = inputPercent;
    }
    if (Number.isFinite(outputPercent)) {
        params.outputPercent = outputPercent;
    }

    const result = adjustSmartKeyPointByIndex(channelName, ordinal, params);
    if (result.success) {
        refreshEditState();
        updatePointDisplay();
        triggerInkChartUpdate();
        return result;
    }
    return result;
}

function restoreSelection(selection) {
    if (!selection) return;
    const { channel, ordinal } = selection;
    if (channel) {
        setEditSelectionState(channel, ordinal ?? 1, { skipHistory: true });
        refreshEditState();
        updatePointDisplay();
    }
}

function keyPointsChanged(beforePoints, afterPoints, beforeInterpolation, afterInterpolation) {
    if (beforeInterpolation !== afterInterpolation) {
        return true;
    }
    if ((!beforePoints || beforePoints.length === 0) && (!afterPoints || afterPoints.length === 0)) {
        return false;
    }
    if (!beforePoints || !afterPoints || beforePoints.length !== afterPoints.length) {
        return true;
    }
    for (let i = 0; i < beforePoints.length; i++) {
        const prev = beforePoints[i];
        const next = afterPoints[i];
        if (!next) return true;
        if (Math.abs((prev.input ?? 0) - (next.input ?? 0)) > 0.0001) {
            return true;
        }
        if (Math.abs((prev.output ?? 0) - (next.output ?? 0)) > 0.0001) {
            return true;
        }
    }
    return false;
}

export function endSmartPointDrag(options = {}) {
    if (!SmartPointDragContext.active) {
        return { success: false, message: 'No drag in progress' };
    }

    const history = getHistoryManager?.();
    const { commit = true } = options || {};
    const channelName = SmartPointDragContext.channel;
    const ordinal = SmartPointDragContext.ordinal;

    if (commit && isChannelLocked(channelName)) {
        return endSmartPointDrag({ ...options, commit: false });
    }

    const originalPoints = SmartPointDragContext.originalPoints ? clonePoints(SmartPointDragContext.originalPoints) : null;
    const originalInterpolation = SmartPointDragContext.originalInterpolation;
    const selectionBefore = SmartPointDragContext.selectionBefore;
    const originalCurve = Array.isArray(SmartPointDragContext.originalCurve)
        ? SmartPointDragContext.originalCurve.slice()
        : (SmartPointDragContext.originalCurve || null);
    const originalSource = SmartPointDragContext.originalSource;
    const transactionId = SmartPointDragContext.transactionId;
    const historyDescription = SmartPointDragContext.historyDescription;

    const inkBaseline = SmartPointDragContext.originalInkLimits;

    const resetDragContext = () => {
        SmartPointDragContext.active = false;
        SmartPointDragContext.channel = null;
        SmartPointDragContext.ordinal = 0;
        SmartPointDragContext.originalPoints = null;
        SmartPointDragContext.originalInterpolation = 'smooth';
        SmartPointDragContext.selectionBefore = null;
        SmartPointDragContext.originalCurve = null;
        SmartPointDragContext.originalSource = null;
        SmartPointDragContext.transactionId = null;
        SmartPointDragContext.historyDescription = null;
        SmartPointDragContext.originalInkLimits = null;
    };

    if (!commit) {
        if (originalPoints) {
            setSmartKeyPoints(channelName, originalPoints, originalInterpolation, { skipHistory: true, skipMarkEdited: true, allowWhenEditModeOff: true });
            restoreSelection(selectionBefore);
            triggerInkChartUpdate();
            triggerPreviewUpdate();
        }
        if (transactionId && history && typeof history.rollback === 'function') {
            try {
                history.rollback(transactionId);
            } catch (err) {
                console.warn('[EDIT MODE] Failed to rollback drag transaction:', err);
            }
        }
        if (inkBaseline) {
            restoreInkLimitBaseline(channelName, inkBaseline);
        }
        resetDragContext();
        return { success: true, reverted: true };
    }

    const entry = ControlPoints.get(channelName);
    const finalPoints = clonePoints(entry?.points || []);
    const finalInterpolation = entry?.interpolation || 'smooth';

    const loadedData = getLoadedQuadData?.();
    const newCurve = Array.isArray(loadedData?.curves?.[channelName])
        ? loadedData.curves[channelName].slice()
        : null;
    const newSource = loadedData?.sources?.[channelName] ?? null;

    const changed = originalPoints
        ? keyPointsChanged(originalPoints, finalPoints, originalInterpolation, finalInterpolation)
        : (finalPoints.length > 0);

    if (changed && history) {
        try {
            if (typeof history.recordKeyPointsChange === 'function') {
                history.recordKeyPointsChange(channelName, originalPoints, finalPoints, originalInterpolation, finalInterpolation);
            }
            if (typeof history.recordChannelAction === 'function') {
                const extras = {
                    oldKeyPoints: originalPoints,
                    newKeyPoints: finalPoints,
                    oldInterpolation: originalInterpolation,
                    newInterpolation: finalInterpolation,
                    oldSource: originalSource,
                    newSource,
                    selectedOrdinalBefore: selectionBefore?.ordinal ?? ordinal,
                    selectedChannelBefore: selectionBefore?.channel ?? channelName,
                    selectedOrdinalAfter: ordinal,
                    selectedChannelAfter: channelName
                };
                if (historyDescription) {
                    extras.description = historyDescription;
                }
history.recordChannelAction(channelName, 'curve', originalCurve, newCurve, extras);
            }
        } catch (err) {
            console.warn('[EDIT MODE] History recording failed after drag:', err);
        }
    }

    if (transactionId && history && typeof history.commit === 'function') {
        try {
            history.commit(transactionId);
        } catch (err) {
            console.warn('[EDIT MODE] Failed to commit drag transaction:', err);
        }
    }

    refreshEditState();
    updatePointDisplay();
    triggerInkChartUpdate();
    triggerPreviewUpdate();

    resetDragContext();

    return { success: true, channel: channelName, ordinal };
}

export function cancelSmartPointDrag() {
    return endSmartPointDrag({ commit: false });
}

function getCurrentGlobalFilename() {
    const globalData = LinearizationState.getGlobalData?.();
    if (globalData?.filename) return globalData.filename;
    if (elements.globalLinearizationFilename?.dataset?.originalFilename) {
        return elements.globalLinearizationFilename.dataset.originalFilename;
    }
    const existing = elements.globalLinearizationFilename?.textContent?.trim();
    return existing || '';
}

function formatBakedLabel(filename) {
    const name = filename || 'correction';
    return `*BAKED* ${name}`;
}

function metasEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.filename === b.filename;
}

export function setGlobalBakedState(meta, options = {}) {
    const previousMeta = LinearizationState.getGlobalBakedMeta?.() || null;
    if (metasEqual(previousMeta, meta || null)) {
        return;
    }

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[EDIT MODE] setGlobalBakedState', { previousMeta, meta, options });
    }

    if (meta && isBrowser && typeof globalScope.CurveHistory?.captureState === 'function') {
        try {
            globalScope.CurveHistory.captureState('Before: Bake global correction');
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[EDIT MODE] Failed to capture history before baking global correction:', err);
            }
        }
    }

    LinearizationState.setGlobalBakedMeta?.(meta || null);

    const manager = getStateManagerSafe();
    if (manager) {
        manager.set('linearization.global.baked', meta || null, options);
        if (meta) {
            manager.set('linearization.global.applied', false, { skipHistory: true });
            manager.set('linearization.global.enabled', false, { skipHistory: true });
        }
    }

    // Persist original filename for restoration
    if (elements.globalLinearizationFilename && LinearizationState.getGlobalData?.()?.filename) {
        elements.globalLinearizationFilename.dataset.originalFilename = LinearizationState.getGlobalData().filename;
    }

    const hasBaked = !!meta;
    const filename = hasBaked
        ? (meta?.filename || getCurrentGlobalFilename())
        : getCurrentGlobalFilename();

    if (elements.globalLinearizationFilename) {
        elements.globalLinearizationFilename.textContent = hasBaked
            ? formatBakedLabel(filename)
            : filename || '';
    }

    if (elements.globalLinearizationToggle) {
        const toggle = elements.globalLinearizationToggle;
        if (hasBaked) {
            toggle.disabled = true;
            toggle.setAttribute('aria-disabled', 'true');
            toggle.dataset.baked = 'true';
            toggle.checked = true;
            toggle.setAttribute('aria-checked', 'true');
            toggle.title = 'Global correction baked into Smart curves. Undo or revert to modify.';
            LinearizationState.globalApplied = false;
            if (LinearizationState.globalData) {
                LinearizationState.globalData.applied = false;
            }
        } else {
            const hasGlobal = !!LinearizationState.getGlobalData?.();
            toggle.disabled = !hasGlobal;
            toggle.removeAttribute('aria-disabled');
            delete toggle.dataset.baked;
            toggle.title = '';
            if (!hasGlobal) {
                toggle.checked = false;
                toggle.setAttribute('aria-checked', 'false');
            }
            LinearizationState.globalApplied = hasGlobal;
            if (LinearizationState.globalData) {
                LinearizationState.globalData.applied = hasGlobal;
            }
        }
    }

    if (!hasBaked) {
        try {
            const loadedData = getLoadedQuadData?.();
            if (loadedData?.keyPointsMeta && typeof loadedData.keyPointsMeta === 'object') {
                Object.keys(loadedData.keyPointsMeta).forEach((channelName) => {
                    const metaForChannel = loadedData.keyPointsMeta[channelName];
                    if (metaForChannel && typeof metaForChannel === 'object' && metaForChannel.bakedGlobal) {
                        delete metaForChannel.bakedGlobal;
                    }
                });
            }
        } catch (metaErr) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[EDIT MODE] Failed to clear bakedGlobal metadata while resetting state:', metaErr);
            }
        }
    }

    if (hasBaked && (!previousMeta || previousMeta.filename !== filename)) {
        showStatus(`Global correction baked into Smart curves (${filename || 'correction'}). Use undo or revert to edit.`);
    }

    try {
        updateSessionStatus();
    } catch (err) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[EDIT MODE] Failed to update session status after baked state change:', err);
        }
    }

    try {
        triggerProcessingDetailAll();
    } catch (err) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[EDIT MODE] Failed to refresh processing details after baked state change:', err);
        }
    }

    try {
        const rows = Array.from(document.querySelectorAll('tr[data-channel]'));
        const graph = globalScope?.graphStatus;
        rows.forEach((row) => {
            const channelName = row.getAttribute('data-channel');
            if (!channelName) return;
            setTimeout(() => {
                if (graph && typeof graph.updateProcessingDetail === 'function') {
                    graph.updateProcessingDetail(channelName);
                } else {
                    triggerProcessingDetail(channelName);
                }
            }, 0);
        });
    } catch (err) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[EDIT MODE] Failed to refresh processing detail after baked state change:', err);
        }
    }

    try {
        triggerRevertButtonsUpdate();
    } catch (err) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[EDIT MODE] Failed to refresh revert buttons after baked state change:', err);
        }
    }
}

if (isBrowser) {
    globalScope.__quadSetGlobalBakedState = setGlobalBakedState;
}

export const __TEST_ONLY__ = {
    isSampleApproximatelyLinear,
    ensurePlateauAnchors,
    deriveSeedPointsFromSamples,
    buildInflectionPointsFromSamples,
    seedChannelFromSamples
};

function persistEditModeFlag(enabled) {
    const manager = getStateManagerSafe();
    if (manager && typeof manager.setEditMode === 'function') {
        manager.setEditMode(enabled);
    }
}

function setEditModePrimed(value) {
    editModePrimed = !!value;
    if (isBrowser) {
        globalScope.__EDIT_MODE_PRIMED = editModePrimed;
    }
}

function setEditSelectionState(channel, ordinal = EDIT_STATE.selectedOrdinal, options = {}) {
    const prevChannel = EDIT_STATE.selectedChannel;
    const prevOrdinal = EDIT_STATE.selectedOrdinal;

    const nextChannel = channel ?? null;
    const nextOrdinal = Number.isFinite(ordinal) ? ordinal : 1;

    EDIT_STATE.selectedChannel = nextChannel;
    EDIT_STATE.selectedOrdinal = nextOrdinal;

    const manager = getStateManagerSafe();
    if (manager && typeof manager.setEditSelection === 'function') {
        manager.setEditSelection(nextChannel, nextOrdinal, {
            ...options,
            previousSelection: {
                channel: prevChannel,
                ordinal: prevOrdinal
            }
        });
    }
}

function setSelectedOrdinalState(ordinal) {
    setEditSelectionState(EDIT_STATE.selectedChannel, ordinal, { skipHistory: true });
}

let EDIT_CONTROLS_BOUND = false;
let EDIT_DROPDOWN_BOUND = false;
const DIRECT_SEED_LAB_MAX_POINTS = 64;
const MEASUREMENT_ADAPTIVE_ERROR = 0.1;
const MEASUREMENT_ADAPTIVE_MAX_POINTS = 42;

function resolveMake256Helper() {
    try {
        const registry = getDebugRegistry();
        const helper = registry?.processingPipeline?.make256;
        if (typeof helper === 'function') {
            return helper;
        }
    } catch (err) {
        console.warn('[EDIT MODE] Failed to resolve make256 from registry:', err);
    }
    const legacyHelper = getLegacyHelper('make256');
    return typeof legacyHelper === 'function' ? legacyHelper : null;
}

function getOrderedSmartPoints(channelName) {
    const entry = ControlPoints.get(channelName);
    if (!entry || !Array.isArray(entry.points)) return [];

    return entry.points
        .map((point, idx) => ({ ...point, rawOrdinal: idx + 1 }))
        .sort((a, b) => {
            if (a.input === b.input) {
                return a.rawOrdinal - b.rawOrdinal;
            }
            return a.input - b.input;
        });
}

function getSelectedPointContext(channelName) {
    const orderedPoints = getOrderedSmartPoints(channelName);
    if (orderedPoints.length === 0) {
        return {
            orderedPoints,
            sortedOrdinal: 0,
            sortedIndex: -1,
            point: null,
            rawOrdinal: null
        };
    }

    let sortedOrdinal = EDIT_STATE.selectedOrdinal || 1;
    sortedOrdinal = Math.max(1, Math.min(orderedPoints.length, sortedOrdinal));
    setSelectedOrdinalState(sortedOrdinal);

    const sortedIndex = sortedOrdinal - 1;
    const point = orderedPoints[sortedIndex];

    return {
        orderedPoints,
        sortedOrdinal,
        sortedIndex,
        point,
        rawOrdinal: point.rawOrdinal
    };
}

function getNudgeStepFromEvent(event) {
    if (event?.shiftKey) return 5;
    if (event?.altKey || event?.metaKey) return 0.1;
    return 1;
}

function applyNudgeToSelectedPoint(deltaInput, deltaOutput, event) {
    if (typeof console !== 'undefined') {
        console.log('[EDIT MODE] applyNudgeToSelectedPoint invoked', { deltaInput, deltaOutput });
    }
    if (!isEditModeEnabled()) {
        showStatus('Edit mode is off');
        return;
    }

    const channelName = EDIT_STATE.selectedChannel;
    if (!channelName) return;

    if (isChannelLocked(channelName)) {
        showStatus(getChannelLockEditMessage(channelName, 'deleting points'));
        return;
    }

    if (!editIsChannelEnabled(channelName)) {
        showStatus('Channel disabled – enable in Channels to edit');
        return;
    }

    ensureSmartKeyPointsForChannel(channelName);

    let context = getSelectedPointContext(channelName);
    if (!context.point) {
        reinitializeChannelSmartCurves(channelName, { forceIfEditModeEnabling: true });
        ensureSmartKeyPointsForChannel(channelName);
        setSelectedOrdinalState(1);
        context = getSelectedPointContext(channelName);
    }

    if (typeof console !== 'undefined') {
        console.log('[EDIT MODE] nudge context', context);
    }
    if (!context.point) {
        showStatus('No Smart key points available — add or recompute points first');
        return;
    }

    const { point, rawOrdinal } = context;
    const params = {};
    const step = getNudgeStepFromEvent(event);

    if (deltaInput !== 0) {
        params.deltaInput = deltaInput * step;
    }

    if (deltaOutput !== 0) {
        const currentAbsolute = toAbsoluteOutput(channelName, point.output);
        const nextAbsolute = Math.max(0, Math.min(100, currentAbsolute + deltaOutput * step));
        params.outputPercent = nextAbsolute;
    }

    if (isBrowser) {
        globalScope.__EDIT_LAST_NUDGE = {
            channelName,
            rawOrdinal,
            params: { ...params },
            before: ControlPoints.get(channelName)?.points || []
        };
    }

    const adjustFn = (isBrowser &&
        globalScope.quadGenActions &&
        typeof globalScope.quadGenActions.adjustSmartKeyPointByIndex === 'function')
        ? globalScope.quadGenActions.adjustSmartKeyPointByIndex.bind(globalScope.quadGenActions)
        : adjustSmartKeyPointByIndex;

    const result = adjustFn(channelName, rawOrdinal, params);
    if (isBrowser) {
        globalScope.__EDIT_LAST_NUDGE_RESULT = {
            ...result,
            after: ControlPoints.get(channelName)?.points || []
        };
    }
    if (!result?.success) {
        showStatus(result?.message || 'Edit failed');
        return;
    }

    refreshEditState();
    updateChartAndPreview();
}

function isDefaultRampPoints(points) {
    if (!Array.isArray(points) || points.length !== 2) return false;
    const [p0, p1] = points;
    const nearZero = (value) => Math.abs(value) <= 0.0001;
    const nearHundred = (value) => Math.abs(value - 100) <= 0.0001;
    return nearZero(p0?.input) && nearZero(p0?.output) && nearHundred(p1?.input) && nearHundred(p1?.output);
}

function updateMeasurementSeedMeta(channelName, seed) {
    const loadedData = ensureLoadedQuadData(() => ({ keyPointsMeta: {} }));
    loadedData.keyPointsMeta = loadedData.keyPointsMeta || {};
    const prevMeta = loadedData.keyPointsMeta[channelName] || {};

    if (seed) {
        loadedData.keyPointsMeta[channelName] = {
            ...prevMeta,
            measurementSeed: seed
        };
    } else if (prevMeta.measurementSeed) {
        const { measurementSeed, ...rest } = prevMeta;
        loadedData.keyPointsMeta[channelName] = rest;
    }
}

export function persistSmartPoints(channelName, points, interpolation = 'smooth', options = {}) {
    const {
        measurementSeed,
        smartTouched = false,
        skipUiRefresh = true,
        pointsAreRelative = false,
        channelPercentOverride = null,
        includeBakedFlags = true
    } = options || {};

    if (typeof globalScope !== 'undefined') {
        globalScope.__PERSIST_TRIPPED = (globalScope.__PERSIST_TRIPPED || 0) + 1;
    }

    let bakedFlags = {};
    if (includeBakedFlags) {
        const autoWhiteOn = !!elements?.autoWhiteLimitToggle?.checked;
        const autoBlackOn = !!elements?.autoBlackLimitToggle?.checked;
        bakedFlags = {
            bakedAutoLimit: autoWhiteOn || autoBlackOn,
            bakedAutoWhite: autoWhiteOn,
            bakedAutoBlack: autoBlackOn
        };

        const globalData = LinearizationState.getGlobalData?.();
        const globalApplied = !!(LinearizationState.globalApplied && globalData);
        const bakedMeta = typeof LinearizationState.getGlobalBakedMeta === 'function'
            ? LinearizationState.getGlobalBakedMeta()
            : null;

        if (globalApplied || bakedMeta) {
            bakedFlags.bakedGlobal = true;
            const bakedLabel = bakedMeta?.filename || globalData?.filename || getCurrentGlobalFilename();
            if (bakedLabel) {
                bakedFlags.bakedFilename = bakedLabel;
            }
        }
    }

    const channelPercent = Number.isFinite(channelPercentOverride)
        ? channelPercentOverride
        : getChannelPercent(channelName);

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[EDIT MODE] persistSmartPoints channel percent', channelName, {
            override: channelPercentOverride,
            resolved: channelPercent
        });
    }

    const relativePoints = points.map((p) => {
        const input = Number(p.input);
        const outputAbsolute = Number(p.output);
        let output;
        if (pointsAreRelative) {
            output = Math.max(0, Math.min(100, outputAbsolute));
        } else {
            const percent = Number.isFinite(channelPercent) && channelPercent > 0
                ? (outputAbsolute / channelPercent) * 100
                : outputAbsolute;
            output = Math.max(0, percent);
        }
        return { input, output };
    });

    if (typeof globalScope !== 'undefined') {
        globalScope.__PERSIST_DEBUG = globalScope.__PERSIST_DEBUG || [];
        globalScope.__PERSIST_DEBUG.push({
            channelName,
            channelPercent,
            override: channelPercentOverride,
            sample: relativePoints.slice(0, 5)
        });
    }

    const result = setSmartKeyPoints(channelName, relativePoints, interpolation, {
        skipHistory: true,
        skipMarkEdited: true,
        skipUiRefresh,
        bakedFlags,
        includeBakedFlags,
        allowWhenEditModeOff: true,
        smartTouched
    });

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[EDIT MODE] persistSmartPoints setSmartKeyPoints result', channelName, result);
    }

    if (!result?.success) {
        ControlPoints.persist(channelName, relativePoints, interpolation);
        const data = ensureLoadedQuadData(() => ({ keyPointsMeta: {} }));
        data.keyPointsMeta = data.keyPointsMeta || {};
        const fallbackMeta = {
            ...(data.keyPointsMeta[channelName] || {}),
            interpolationType: interpolation,
            ...(includeBakedFlags ? bakedFlags : {})
        };
        if (!includeBakedFlags) {
            delete fallbackMeta.bakedGlobal;
            delete fallbackMeta.bakedFilename;
            delete fallbackMeta.bakedAutoLimit;
            delete fallbackMeta.bakedAutoWhite;
            delete fallbackMeta.bakedAutoBlack;
        }
        if ('smartTouched' in fallbackMeta) {
            delete fallbackMeta.smartTouched;
        }
        data.keyPointsMeta[channelName] = fallbackMeta;
        if (!skipUiRefresh) {
            try {
                triggerPreviewUpdate();
                triggerProcessingDetail(channelName);
                triggerInkChartUpdate();
                triggerRevertButtonsUpdate();
            } catch (err) {
                console.warn('[EDIT MODE] Failed to refresh UI after persist fallback:', err);
            }
        }
    }

    if (measurementSeed) {
        const measurementSeedMeta = {
            ...measurementSeed,
            points: points.map((p) => ({
                input: Number(p.input),
                output: Number(p.output)
            }))
        };
        updateMeasurementSeedMeta(channelName, measurementSeedMeta);
    }

    if (!skipUiRefresh) {
        try {
            triggerProcessingDetail(channelName);
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[EDIT MODE] Failed to refresh processing detail after persistSmartPoints:', err);
            }
        }
    }
}

function getMeasurementContext(channelName) {
    const perData = LinearizationState.getPerChannelData(channelName);
    const perFmt = (perData?.format || '').toUpperCase();
    if (LinearizationState.isPerChannelEnabled(channelName) && perData) {
        if ((perFmt.includes('LAB') || perFmt.includes('MANUAL')) && Array.isArray(perData.originalData) && perData.originalData.length > 0) {
            return {
                scope: 'per',
                format: perFmt,
                count: perData.originalData.length,
                data: perData
            };
        }
    }

    if (LinearizationState.hasAnyLinearization()) {
        const globalData = LinearizationState.getGlobalData();
        const glbFmt = (globalData?.format || '').toUpperCase();
        if (globalData && (glbFmt.includes('LAB') || glbFmt.includes('MANUAL')) && Array.isArray(globalData.originalData) && globalData.originalData.length > 0) {
            return {
                scope: 'global',
                format: glbFmt,
                count: globalData.originalData.length,
                data: globalData
            };
        }
    }

    return null;
}

function sampleLinearizedCurve(channelName, endValue, applyLinearization = true) {
    const make256Helper = resolveMake256Helper();
    const candidates = [];
    if (typeof make256Helper === 'function') {
        candidates.push(make256Helper);
    }
    if (typeof make256Direct === 'function' && make256Direct !== make256Helper) {
        candidates.push(make256Direct);
    }
    for (let i = 0; i < candidates.length; i += 1) {
        const runner = candidates[i];
        try {
            const result = runner(endValue, channelName, applyLinearization, { forceSmartApplied: false });
            if (Array.isArray(result) && result.length === CURVE_RESOLUTION) {
                const fallback = getFallbackCurveSamples(channelName);
                if (Array.isArray(fallback) && fallback.length === CURVE_RESOLUTION && shouldPreferFallbackSamples(result, fallback)) {
                    editModeDebugLog(`Primary make256 samples deviated for ${channelName}`, { stage: 'sampleLinearizedCurve' });
                    return fallback.slice();
                }
                return result;
            }
        } catch (err) {
            editModeDebugLog(`make256 execution failed for ${channelName}`, { error: err?.message });
        }
    }
    editModeDebugLog(`make256 helper unavailable for ${channelName}`);
    return null;
}

export function refreshSmartCurvesFromMeasurements() {
    if (!isEditModeEnabled()) {
        return;
    }
    if (!elements.rows) {
        return;
    }

    const rows = Array.from(elements.rows.children).filter((tr) => tr.id !== 'noChannelsRow');
    rows.forEach((row) => {
        const channelName = row.getAttribute('data-channel');
        if (!channelName) return;
        try {
            reinitializeChannelSmartCurves(channelName, { forceIfEditModeEnabling: true });
        } catch (err) {
            console.warn('[EDIT MODE] Measurement refresh failed for', channelName, err);
        }
    });
}

function measurementSeedMatches(seed, context, existingLength) {
    if (!seed || !context) return false;
    if (seed.scope !== context.scope) return false;
    if (seed.format !== context.format) return false;
    if (typeof context.count === 'number' && context.count > 0) {
        if (seed.count !== context.count) return false;
        const expectedLength = Array.isArray(seed.points) && seed.points.length > 0
            ? seed.points.length
            : context.count;
        if (typeof existingLength === 'number' && existingLength > 0 && existingLength !== expectedLength) {
            return false;
        }
    }
    return true;
}

/**
 * Check if edit mode is currently enabled
 * @returns {boolean} True if edit mode is enabled
 */
export function isEditModeEnabled() {
    return getEditModeFlag();
}

/**
 * Set edit mode on/off with UI updates
 * @param {boolean} on - Whether to enable edit mode
 * @param {Object} opts - Options object
 * @param {boolean} opts.recordHistory - Whether to record this change in history
 * @returns {boolean} Success status
 */
export function setEditMode(on, opts = {}) {
    const options = opts || {};
    const prev = isEditModeEnabled();
    const target = typeof on === 'boolean' ? on : !prev;

    setEditModeFlag(target);
    persistEditModeFlag(target);

    // Update toggle button visuals
    updateEditModeButtonVisuals(target);

    // On first enable, initialize edit mode for applicable channels
    const wasPrimed = editModePrimed;

    if (target && !editModePrimed) {
        try {
            initializeEditModeForChannels();
            setEditModePrimed(true);
        } catch (err) {
            console.warn('[EDIT MODE] Initialization error:', err);
        }
    }

    // On subsequent enables, check if LAB data was loaded while edit mode was off
    // and reinitialize Smart Curves to incorporate measurement data
    if (target && editModePrimed && wasPrimed) {
        try {
            const hasMeasurementData = LinearizationState.hasAnyLinearization();
            if (hasMeasurementData) {
                console.log('[EDIT MODE] LAB data detected - checking for Smart Curves regeneration...');

                // Check if any enabled channels have existing Smart Curves that don't reflect LAB data
                const enabledChannels = [];
                if (elements.rows) {
                    const rows = Array.from(elements.rows.children).filter(tr => tr.id !== 'noChannelsRow');
                    rows.forEach(row => {
                        const channelName = row.getAttribute('data-channel');
                        if (!channelName) return;

                        const percentInput = row.querySelector('.percent-input');
                        const endInput = row.querySelector('.end-input');
                        const percent = parseFloat(percentInput?.value || '0');
                        const endValue = parseInt(endInput?.value || '0', 10);

                        if (percent > 0 || endValue > 0) {
                            enabledChannels.push(channelName);
                        }
                    });
                }

                const globalData = LinearizationState.getGlobalData();
                const hasGlobalMeasurement = !!(globalData && LinearizationState.globalApplied);

                // Reinitialize Smart Curves for channels with LAB data
                enabledChannels.forEach(channelName => {
                    const hasPerMeasurement = LinearizationState.isPerChannelEnabled(channelName);
                    if (hasPerMeasurement || hasGlobalMeasurement) {
                        const sourceLabel = hasPerMeasurement ? 'per-channel' : 'global';
                        console.log(`[EDIT MODE] Regenerating Smart Curves for ${channelName} with ${sourceLabel} LAB data`);
                        reinitializeChannelSmartCurves(channelName, { forceIfEditModeEnabling: true });
                    }
                });
            }
        } catch (err) {
            console.warn('[EDIT MODE] LAB data reinitialize error:', err);
        }
    }

    // Record history if requested
    if (options.recordHistory) {
        const curveHistory = getLegacyHelper('CurveHistory');
        if (curveHistory && typeof curveHistory.recordUIAction === 'function') {
            try {
                const desc = on ? 'Enable Edit Mode' : 'Disable Edit Mode';
                curveHistory.recordUIAction('editMode', prev, on, desc);
            } catch (err) {
                console.warn('[EDIT MODE] History recording failed:', err);
            }
        }
    }

    // Update UI state
    if (on) {
        // When enabling edit mode, populate the channel dropdown first
        populateChannelSelect();
    }
    refreshEditState();

    // Notify other components
    try {
        triggerInkChartUpdate();
        invokeLegacyHelper('updateInterpolationControls');
    } catch (err) {
        console.warn('[EDIT MODE] Component update error:', err);
    }

    return true;
}

/**
 * Get current edit state
 * @returns {Object} Current edit state
 */
export function getEditState() {
    return {
        enabled: getEditModeFlag(),
        selectedChannel: EDIT_STATE.selectedChannel,
        selectedOrdinal: EDIT_STATE.selectedOrdinal
    };
}

/**
 * Populate channel dropdown (exported for use by event handlers)
 * @returns {void}
 */
export function populateChannelDropdown() {
    populateChannelSelect();
}

/**
 * Set selected channel for editing
 * @param {string} channelName - Channel name to select
 */
export function setSelectedChannel(channelName, options = {}) {
    const description = options.description
        || (channelName ? `Select channel ${channelName}` : 'Clear edit selection');
    setEditSelectionState(channelName, 1, { ...options, description });

    // Ensure Smart key points exist for this channel
    if (channelName) {
        ensureSmartKeyPointsForChannel(channelName);
    }

    refreshEditState();
}

export function selectSmartPointOrdinal(channelName, ordinal, options = {}) {
    if (!isEditModeEnabled()) {
        return { success: false, message: 'Edit mode is off' };
    }

    const targetChannel = channelName || EDIT_STATE.selectedChannel;
    if (!targetChannel) {
        showStatus('No channel selected');
        return { success: false, message: 'No channel selected' };
    }

    ensureSmartKeyPointsForChannel(targetChannel);
    const entry = ControlPoints.get(targetChannel);
    const points = entry?.points || [];
    if (!Array.isArray(points) || points.length === 0) {
        showStatus('No Smart key points available — add or recompute points first');
        return { success: false, message: 'No Smart key points available' };
    }

    const roundedOrdinal = Math.round(Number(ordinal) || 1);
    const clampedOrdinal = Math.max(1, Math.min(points.length, roundedOrdinal));
    const description = options?.description || `Select ${targetChannel} Smart point ${clampedOrdinal}`;

    setEditSelectionState(targetChannel, clampedOrdinal, {
        description,
        skipHistory: options?.skipHistory ?? false
    });

    refreshEditState();
    updatePointDisplay();
    triggerInkChartUpdate();

    if (!options?.silent) {
        const point = points[clampedOrdinal - 1] || null;
        const inputLabel = point ? formatPercentForBaseline(point.input ?? 0) : String(clampedOrdinal);
        showStatus(`Selected ${targetChannel} point ${clampedOrdinal} (${inputLabel}%)`);
    }

    return {
        success: true,
        channel: targetChannel,
        ordinal: clampedOrdinal
    };
}

/**
 * Ensure Smart key points exist for a channel
 * @param {string} channelName - Channel name
 */
function ensureSmartKeyPointsForChannel(channelName) {
    const { points } = ControlPoints.get(channelName);

    // If no points exist, create default linear ramp
    if (!points || points.length === 0 || isDefaultRampPoints(points)) {
        const row = elements.rows ? Array.from(elements.rows.children).find(tr => tr.getAttribute('data-channel') === channelName) : null;
        const percentInput = row?.querySelector('.percent-input');
        const endInput = row?.querySelector('.end-input');
        const channelPercent = Number.parseFloat(percentInput?.value || '0');
        const endValue = Number.parseInt(endInput?.value || '0', 10);

        const resolvedSamples = resolveSeedingSamples(channelName, endValue, true, 'ensure');
        if (Array.isArray(resolvedSamples) && resolvedSamples.length === CURVE_RESOLUTION && seedChannelFromSamples(channelName, resolvedSamples, 'ensure')) {
            return;
        }

        if (seedSmartPointsFromStoredCurve(channelName, 'ensure-stored')) {
            return;
        }

        const defaultPoints = createDefaultKeyPoints(0, 100);
        ControlPoints.persist(channelName, defaultPoints, 'smooth');
        console.log(`[EDIT MODE] Created default key points for ${channelName}`);
    }
}

/**
 * Update edit mode button visual state
 * @param {boolean} on - Whether edit mode is on
 */
function updateEditModeButtonVisuals(on) {
    try {
        const btn = document.getElementById('editModeToggleBtn');
        const label = document.getElementById('editModeLabel');

        if (btn) {
            btn.setAttribute('aria-pressed', String(!!on));
            btn.setAttribute('aria-checked', String(!!on));

            // Reset color classes
            btn.classList.remove(
                'bg-slate-600', 'hover:bg-slate-700',
                'bg-black', 'hover:bg-gray-900',
                'bg-orange-600', 'hover:bg-orange-700',
                'bg-rose-800', 'hover:bg-rose-900',
                'border', 'border-blue-200'
            );

            // Always ensure white bold text and no border
            btn.classList.add('text-white', 'font-bold', 'border-0');

            if (on) {
                // Black style when ON
                btn.classList.add('bg-black', 'hover:bg-gray-900');
            } else {
                // Slate style when OFF
                btn.classList.add('bg-slate-600', 'hover:bg-slate-700');
            }
        }

        if (label) {
            label.textContent = on ? '◈ Edit Mode: ON' : '⟐ Edit Mode: OFF';
        }
    } catch (err) {
        console.warn('[EDIT MODE] Button update error:', err);
    }
}

/**
 * Initialize edit mode for applicable channels (simplified version)
 * Note: Full implementation would require Smart Curves module
 */
/**
 * Reinitialize Smart Curves for a specific channel when new linearization data is loaded
 * @param {string} channelName - The channel to reinitialize
 */
export function reinitializeChannelSmartCurves(channelName, options = {}) {
    if (!isEditModeEnabled() && !options.forceIfEditModeEnabling) {
        console.log(`[EDIT MODE] Skip reinitializing ${channelName} - edit mode not active`);
        return;
    }

    if (!elements.rows) return;

    const existing = ControlPoints.get(channelName);
    const existingPoints = existing?.points || null;
    const existingMeta = getLoadedQuadData()?.keyPointsMeta?.[channelName] || {};
    const isDefaultRamp = isDefaultRampPoints(existingPoints);
    if (existingMeta.smartTouched && !isDefaultRamp) {
        console.log(`[EDIT MODE] Skip reinitializing ${channelName} - Smart curve already edited`);
        return;
    }

    const rows = Array.from(elements.rows.children).filter(tr => tr.id !== 'noChannelsRow');
    const channelRow = rows.find(row => row.getAttribute('data-channel') === channelName);
    if (!channelRow) {
        console.log(`[EDIT MODE] Channel row not found for ${channelName}`);
        return;
    }

    const percentInput = channelRow.querySelector('.percent-input');
    const endInput = channelRow.querySelector('.end-input');
    const percent = parseFloat(percentInput?.value || '0');
    const endValue = parseInt(endInput?.value || '0', 10);

    if (percent <= 0 && endValue <= 0) {
        console.log(`[EDIT MODE] Skip reinitializing ${channelName} - channel not enabled`);
        return;
    }

    console.log(`[EDIT MODE] Reinitializing Smart key points for ${channelName}...`);

    const hasMeasurementData = LinearizationState.hasAnyLinearization();
    const globalEntry = hasMeasurementData ? LinearizationState.getGlobalData() : null;
    const globalFormat = (globalEntry?.format || '').toUpperCase();

        try {
            let keyPoints = null;
            let seedMeta = null;
            let bakedMetaPending = null;
            let seedSamples = null;

        if (hasMeasurementData && LinearizationState.isPerChannelEnabled(channelName)) {
            const perChannelData = LinearizationState.getPerChannelData(channelName);
            const perFormat = (perChannelData?.format || '').toUpperCase();
            const DIRECT_SEED_MAX_POINTS = 25;

            const perOriginalPoints = Array.isArray(perChannelData?.originalData)
                ? perChannelData.originalData.slice(0, DIRECT_SEED_LAB_MAX_POINTS)
                : null;

            if (perOriginalPoints && perOriginalPoints.length > 0 &&
                perOriginalPoints.length <= DIRECT_SEED_MAX_POINTS) {
                console.log(`[EDIT MODE] 🎯 Directly mapping ${perOriginalPoints.length} per-channel measurement points for ${channelName}`);

                const TOTAL = 65535;
                const values = sampleLinearizedCurve(channelName, endValue, true);

                if (values && values.length === 256) {
                    const lastIndex = values.length - 1;
                    keyPoints = perOriginalPoints.map(point => {
                        const rawInput = Number(point.input ?? point.GRAY ?? point.gray ?? point.Gray ?? 0);
                        const inputPercent = Math.max(0, Math.min(100, rawInput));
                        const t = (inputPercent / 100) * lastIndex;
                        const i0 = Math.floor(t);
                        const i1 = Math.min(lastIndex, Math.ceil(t));
                        const alpha = t - i0;
                        const curveValue = (1 - alpha) * values[i0] + alpha * values[i1];
                        const outputPercent = Math.max(0, Math.min(100, (curveValue / TOTAL) * 100));
                        return { input: inputPercent, output: outputPercent };
                    });

                    seedMeta = {
                        measurementSeed: {
                            scope: 'per',
                            format: perFormat,
                            count: perChannelData.originalData.length || 0
                        }
                    };
                }
            } else if (perChannelData && perChannelData.originalData &&
                Array.isArray(perChannelData.originalData) &&
                perChannelData.originalData.length <= DIRECT_SEED_MAX_POINTS &&
                typeof perChannelData.getSmoothingControlPoints === 'function') {

                console.log(`[EDIT MODE] 🎯 Direct seeding ${channelName} from ${perChannelData.originalData.length} per-channel measurement points via getSmoothingControlPoints`);

                const TOTAL = 65535;

                try {
                    const controlPointData = perChannelData.getSmoothingControlPoints(0);
                    if (controlPointData && controlPointData.samples && controlPointData.xCoords) {
                        keyPoints = controlPointData.xCoords.map((x, i) => {
                            const inputPercent = x * 100;
                            const outputValue = controlPointData.samples[i] * endValue;
                            const outputPercent = Math.max(0, Math.min(100, (outputValue / TOTAL) * 100));
                            return { input: inputPercent, output: outputPercent };
                        });

                        seedMeta = {
                            measurementSeed: {
                                scope: 'per',
                                format: perFormat,
                                count: perChannelData.originalData.length || 0
                            }
                        };
                    }
                } catch (error) {
                    console.warn(`[EDIT MODE] Per-channel getSmoothingControlPoints failed for ${channelName}:`, error);
                }
            } else if (perChannelData && perChannelData.format === 'ACV' &&
                       Array.isArray(perChannelData.controlPointsTransformed) &&
                       perChannelData.controlPointsTransformed.length >= 2 &&
                       perChannelData.controlPointsTransformed.length <= DIRECT_SEED_MAX_POINTS) {

                console.log(`[EDIT MODE] 🎯 Direct seeding ${channelName} from ${perChannelData.controlPointsTransformed.length} per-channel ACV anchor points`);

                keyPoints = perChannelData.controlPointsTransformed.map(point => ({
                    input: point.input,
                    output: point.output
                }));
            } else {
                console.log(`[EDIT MODE] Creating measurement-based key points for ${channelName} from per-channel data`);

                const values = sampleLinearizedCurve(channelName, endValue, true);

                if (values && values.length === 256) {
                    const TOTAL = 65535;
                    const lastIndex = values.length - 1;
                    const origPoints = Array.isArray(perChannelData?.originalData)
                        ? perChannelData.originalData
                        : null;

                    if (origPoints && origPoints.length > 0) {
                        const limited = origPoints.slice(0, DIRECT_SEED_LAB_MAX_POINTS);

                        keyPoints = limited.map(point => {
                            const rawInput = Number(point.input ?? point.GRAY ?? point.gray ?? point.Gray ?? 0);
                            const inputPercent = Math.max(0, Math.min(100, rawInput));
                            const t = (inputPercent / 100) * lastIndex;
                            const i0 = Math.floor(t);
                            const i1 = Math.min(lastIndex, Math.ceil(t));
                            const alpha = t - i0;
                            const curveValue = (1 - alpha) * values[i0] + alpha * values[i1];
                            const outputPercent = Math.max(0, Math.min(100, (curveValue / TOTAL) * 100));
                            return { input: inputPercent, output: outputPercent };
                        });
                        keyPointsAreRelative = false;

                        seedMeta = {
                            measurementSeed: {
                                scope: 'per',
                                format: perFormat,
                                count: perChannelData.originalData.length || 0
                            }
                        };

                        console.log(`[EDIT MODE] ✅ Directly mapped ${keyPoints.length} measurement points for ${channelName}`);
                    } else {
                        keyPoints = extractAdaptiveKeyPointsFromValues(values, {
                            maxErrorPercent: KP_SIMPLIFY.maxErrorPercent,
                            maxPoints: KP_SIMPLIFY.maxPoints
                        });
                        console.log(`[EDIT MODE] ✅ Created ${keyPoints.length} adaptive key points for ${channelName} from measurement curve`);
                    }
                }
            }
        } else if (hasMeasurementData && LinearizationState.globalApplied) {
            const DIRECT_SEED_MAX_POINTS = 25;

            if (globalEntry && Array.isArray(globalEntry.originalData) &&
                globalEntry.originalData.length > 0) {
                const measurementCount = globalEntry.originalData.length;
                const TOTAL = 65535;
                const curveValues = sampleLinearizedCurve(channelName, endValue, true);

                if (curveValues && curveValues.length === 256) {
                    const curveArray = Array.from(curveValues);
                    const lastIndex = curveArray.length - 1;

                    const sampleCurvePercent = (inputPercent) => {
                        const clampedInput = Math.max(0, Math.min(100, inputPercent));
                        const t = (clampedInput / 100) * lastIndex;
                        const i0 = Math.floor(t);
                        const i1 = Math.min(lastIndex, Math.ceil(t));
                        const alpha = t - i0;
                        const curveValue = (1 - alpha) * curveArray[i0] + alpha * curveArray[i1];
                        const absolutePercent = TOTAL > 0 ? (curveValue / TOTAL) * 100 : 0;
                        return Math.max(0, Math.min(100, absolutePercent));
                    };

                    const measurementPoints = globalEntry.originalData.map((point) => {
                        const rawInput = Number(point.input ?? point.GRAY ?? point.gray ?? point.Gray ?? 0);
                        const inputPercent = Math.max(0, Math.min(100, rawInput));
                        const outputPercent = sampleCurvePercent(inputPercent);
                        const entry = {
                            input: inputPercent,
                            output: outputPercent
                        };
                        if (typeof point.LAB_L === 'number') {
                            entry.labL = point.LAB_L;
                        }
                        return entry;
                    });

                    if (measurementCount <= DIRECT_SEED_MAX_POINTS) {
                        console.log(`[EDIT MODE] 🎯 Directly mapping ${measurementCount} global measurement points for ${channelName}`);
                        keyPoints = measurementPoints;
                        seedMeta = {
                            measurementSeed: {
                                scope: 'global',
                                format: globalFormat,
                                count: measurementCount,
                                originalPoints: measurementPoints
                            }
                        };
                    } else {
                        const targetPoints = Math.max(25, Math.min(100, curveArray.length));
                        const uniformPoints = [];
                        for (let i = 0; i < targetPoints; i += 1) {
                            const input = targetPoints === 1 ? 0 : (i / (targetPoints - 1)) * 100;
                            const indexFloat = targetPoints === 1 ? 0 : (i / (targetPoints - 1)) * lastIndex;
                            const idx0 = Math.floor(indexFloat);
                            const idx1 = Math.min(lastIndex, Math.ceil(indexFloat));
                            const t = indexFloat - idx0;
                            const value0 = curveArray[idx0] ?? 0;
                            const value1 = curveArray[idx1] ?? value0;
                            const blended = ((1 - t) * value0) + (t * value1);
                            const relativeOutput = endValue > 0 ? (blended / endValue) * 100 : 0;
                            uniformPoints.push({
                                input,
                                output: Math.max(0, Math.min(100, relativeOutput))
                            });
                        }

                        keyPoints = uniformPoints;
                        seedMeta = {
                            measurementSeed: {
                                scope: 'global',
                                format: globalFormat,
                                count: measurementCount,
                                originalPoints: measurementPoints
                            }
                        };

                        console.log(`[EDIT MODE] ✅ Extracted ${keyPoints.length} Smart key points for ${channelName} from corrected curve samples`);
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[EDIT MODE] Global measurement fallback count (reinitialize)', keyPoints.length, channelName);
                        }
                    }
                }
            } else if (globalEntry &&
                Array.isArray(globalEntry.originalData) &&
                globalEntry.originalData.length <= DIRECT_SEED_MAX_POINTS &&
                typeof globalEntry.getSmoothingControlPoints === 'function') {

                console.log(`[EDIT MODE] 🎯 Direct seeding ${channelName} from ${globalEntry.originalData.length} global measurement points via getSmoothingControlPoints`);

                const TOTAL = 65535;

                try {
                    const controlPointData = globalEntry.getSmoothingControlPoints(0);
                    if (controlPointData && controlPointData.samples && controlPointData.xCoords) {
                        keyPoints = controlPointData.xCoords.map((x, i) => {
                            const inputPercent = x * 100;
                            const outputValue = controlPointData.samples[i] * endValue;
                            const outputPercent = Math.max(0, Math.min(100, (outputValue / TOTAL) * 100));
                            return { input: inputPercent, output: outputPercent };
                        });

                        seedMeta = {
                            measurementSeed: {
                                scope: 'global',
                                format: globalFormat,
                                count: globalEntry.originalData.length || 0
                            }
                        };
                    }
                } catch (error) {
                    console.warn(`[EDIT MODE] getSmoothingControlPoints failed for ${channelName}:`, error);
                }
            } else if (globalEntry && globalEntry.format === 'ACV' &&
                       Array.isArray(globalEntry.controlPointsTransformed) &&
                       globalEntry.controlPointsTransformed.length >= 2 &&
                       globalEntry.controlPointsTransformed.length <= DIRECT_SEED_MAX_POINTS) {

                console.log(`[EDIT MODE] 🎯 Direct seeding ${channelName} from ${globalEntry.controlPointsTransformed.length} global ACV anchor points`);

                keyPoints = globalEntry.controlPointsTransformed.map(point => ({
                    input: point.input,
                    output: point.output
                }));
            }
        }

        if (keyPoints && keyPoints.length >= 2) {
            const channelPercent = Number.isFinite(percent) && percent > 0 ? percent : null;
            const relativePoints = keyPoints.map((point) => {
                const absolute = Number(point.output);
                const relative = channelPercent && channelPercent > 0
                    ? (absolute / channelPercent) * 100
                    : absolute;
                return {
                    input: Number(point.input),
                    output: Math.max(0, Math.min(100, relative))
                };
            });
            const seededFromMeasurement = !!(seedMeta && seedMeta.measurementSeed);
            if (seededFromMeasurement) {
                bakedMetaPending = null;
            }
            const persistOptions = {
                ...(seedMeta || {}),
                channelPercentOverride: channelPercent,
                pointsAreRelative: true,
                skipUiRefresh: false,
                includeBakedFlags: !seededFromMeasurement
            };
            persistSmartPoints(channelName, relativePoints, 'smooth', persistOptions);
            if (!seededFromMeasurement && bakedMetaPending) {
                setGlobalBakedState(bakedMetaPending);
            }
            console.log(`[EDIT MODE] ✅ Reinitialized ${keyPoints.length} Smart key points for ${channelName}`);
            triggerInkChartUpdate();
        } else {
            console.log(`[EDIT MODE] No measurement-based key points available for ${channelName}, keeping existing Smart Curves`);
        }

    } catch (err) {
        console.warn(`[EDIT MODE] Failed to reinitialize Smart key points for ${channelName}:`, err);
    }
}

function initializeEditModeForChannels() {
    console.log('[EDIT MODE] Initializing Smart key points for enabled channels...');

    // Check if measurement data is currently active
    const hasMeasurementData = LinearizationState.hasAnyLinearization();
    const globalData = hasMeasurementData ? LinearizationState.getGlobalData() : null;
    const globalFormat = (globalData?.format || '').toUpperCase();
    console.log(`[EDIT MODE] Measurement data active: ${hasMeasurementData}`);

    // If measurement data is active, create Smart key points FROM the measurement-corrected data
    // This preserves the LAB/measurement corrections when entering Edit Mode
    if (hasMeasurementData) {
        console.log('[EDIT MODE] 📊 Measurement data detected - creating Smart key points from corrected curves');
        console.log('[EDIT MODE] 💡 This preserves LAB/measurement corrections in Edit Mode');
    }

    // Get all enabled channels from the printer rows
    if (!elements.rows) return;

    const enabledChannels = [];
    const rows = Array.from(elements.rows.children).filter(tr => tr.id !== 'noChannelsRow');

    rows.forEach(row => {
        const channelName = row.getAttribute('data-channel');
        if (!channelName) return;

        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        const percent = parseFloat(percentInput?.value || '0');
        const endValue = parseInt(endInput?.value || '0', 10);

        // Channel is enabled if percent > 0 or endValue > 0
        if (percent > 0 || endValue > 0) {
            enabledChannels.push(channelName);
        }
    });

    console.log(`[EDIT MODE] Found ${enabledChannels.length} enabled channels:`, enabledChannels);
    console.log('[EDIT MODE] Enabled channel list for initialization:', enabledChannels);
    if (typeof globalScope !== 'undefined') {
        globalScope.__EDIT_INIT_CONTEXT = {
            hasMeasurementData,
            enabledChannels: enabledChannels.slice()
        };
    }

    // Create Smart key points for each enabled channel that doesn't have them
    enabledChannels.forEach(channelName => {
        const existing = ControlPoints.get(channelName);
        const existingPoints = existing.points;
        const hasDefaultRamp = isDefaultRampPoints(existingPoints);
        const existingMeta = getLoadedQuadData()?.keyPointsMeta?.[channelName] || {};
        const measurementContext = getMeasurementContext(channelName);
        const measurementSeedOk = measurementSeedMatches(existingMeta.measurementSeed, measurementContext, existingPoints?.length);

        let needsSeed = false;
        if (existingMeta.smartTouched && !hasDefaultRamp) {
            needsSeed = false;
        } else if (!existingPoints || existingPoints.length < 2) {
            needsSeed = true;
        } else if (measurementContext) {
            needsSeed = !measurementSeedOk || hasDefaultRamp;
        }

        if (!needsSeed && hasDefaultRamp) {
            needsSeed = true;
        }

        console.log(`[EDIT MODE] Channel ${channelName}: existing=${existingPoints?.length || 0}, measurementContext=${measurementContext ? `${measurementContext.scope}:${measurementContext.format}:${measurementContext.count}` : 'none'}, needsSeed=${needsSeed}`);

        if (needsSeed) {
            console.log(`[EDIT MODE] Creating Smart key points for ${channelName}...`);
            try {
                let keyPoints = null;
                let seedMeta = null;
                let bakedMetaPending = null;
                let keyPointsAreRelative = false;
                let seedSamples = null;
                let seededFromCurve = false;

                const channelRow = Array.from(elements.rows.children).find(tr =>
                    tr.getAttribute('data-channel') === channelName
                );
                const percentInputEl = channelRow?.querySelector('.percent-input');
                const endInputEl = channelRow?.querySelector('.end-input');
                const channelPercent = parseFloat(percentInputEl?.value || '0');
                const endValue = parseInt(endInputEl?.value || '0', 10);

                const resolvedSamples = resolveSeedingSamples(channelName, endValue, hasMeasurementData, 'initialize');
                if (Array.isArray(resolvedSamples) && resolvedSamples.length === CURVE_RESOLUTION) {
                    if (seedChannelFromSamples(channelName, resolvedSamples, 'initialize')) {
                        seededFromCurve = true;
                        seedSamples = resolvedSamples;
                        keyPointsAreRelative = true;
                        keyPoints = ControlPoints.get(channelName)?.points || null;
                    }
                }

                // If measurement data exists, create key points at regular measurement-like intervals
                if (!seededFromCurve && hasMeasurementData && LinearizationState.isPerChannelEnabled(channelName)) {
                    const perChannelData = LinearizationState.getPerChannelData(channelName);
                    const perFormat = (perChannelData?.format || '').toUpperCase();
                    console.log(`[EDIT MODE] Creating measurement-like key points for ${channelName}`);

                    const values = sampleLinearizedCurve(channelName, endValue, true);

                if (values && values.length === 256) {
                    const TOTAL = 65535;
                    const lastIndex = values.length - 1;
                    const origPoints = Array.isArray(perChannelData?.originalData)
                        ? perChannelData.originalData
                        : null;

                    if (origPoints && origPoints.length > 0) {
                        const limited = origPoints.slice(0, DIRECT_SEED_LAB_MAX_POINTS);

                        const adaptivePoints = extractAdaptiveKeyPointsFromValues(values, {
                            maxErrorPercent: MEASUREMENT_ADAPTIVE_ERROR,
                            maxPoints: MEASUREMENT_ADAPTIVE_MAX_POINTS,
                            scaleMax: endValue > 0 ? endValue : TOTAL
                        });

                        keyPoints = adaptivePoints.map((pt) => ({
                            input: Math.max(0, Math.min(100, Number(pt.input))),
                            output: Math.max(0, Math.min(100, Number(pt.output)))
                        }));
                        keyPointsAreRelative = true;

                        const measurementPoints = limited.map((point) => {
                            const rawInput = Number(point.input ?? point.GRAY ?? point.gray ?? point.Gray ?? 0);
                            const inputPercent = Math.max(0, Math.min(100, rawInput));
                            const t = (inputPercent / 100) * lastIndex;
                            const i0 = Math.floor(t);
                            const i1 = Math.min(lastIndex, Math.ceil(t));
                            const alpha = t - i0;
                            const curveValue = (1 - alpha) * values[i0] + alpha * values[i1];
                            const outputPercent = Math.max(0, Math.min(100, (curveValue / TOTAL) * 100));
                            return {
                                input: inputPercent,
                                output: outputPercent
                            };
                        });

                        seedMeta = {
                            measurementSeed: {
                                scope: 'per',
                                format: perFormat,
                                count: perChannelData.originalData.length || 0,
                                originalPoints: measurementPoints
                            }
                        };

                        console.log(`[EDIT MODE] ✅ Adaptive per-channel measurement points for ${channelName} (${keyPoints.length})`);
                    } else {
                        const adaptivePoints = extractAdaptiveKeyPointsFromValues(values, {
                            maxErrorPercent: MEASUREMENT_ADAPTIVE_ERROR,
                            maxPoints: MEASUREMENT_ADAPTIVE_MAX_POINTS,
                            scaleMax: endValue > 0 ? endValue : TOTAL
                        });
                        keyPoints = adaptivePoints.map((pt) => ({
                            input: Math.max(0, Math.min(100, Number(pt.input))),
                            output: Math.max(0, Math.min(100, Number(pt.output)))
                        }));
                        keyPointsAreRelative = true;
                        console.log(`[EDIT MODE] ✅ Created ${keyPoints.length} adaptive key points for ${channelName} from measurement curve`);
                    }
                }
        } else if (!seededFromCurve && hasMeasurementData && LinearizationState.globalApplied) {
            // Check if global linearization has original measurement data for direct seeding
            const DIRECT_SEED_MAX_POINTS = 25; // Legacy quadgen.html constant

            if (globalData && Array.isArray(globalData.originalData) &&
                globalData.originalData.length > 0) {

                const measurementCount = globalData.originalData.length;
                const TOTAL = 65535;
                const curveValues = sampleLinearizedCurve(channelName, endValue, true);
                const normalizedSamples = Array.isArray(globalData.samples) ? globalData.samples : null;

                if (curveValues && curveValues.length === 256) {
                    const curveArray = Array.from(curveValues);
                    const lastIndex = curveArray.length - 1;

                    const sampleCurvePercent = (inputPercent) => {
                        const clampedInput = Math.max(0, Math.min(100, inputPercent));
                        const t = (clampedInput / 100) * lastIndex;
                        const i0 = Math.floor(t);
                        const i1 = Math.min(lastIndex, Math.ceil(t));
                        const alpha = t - i0;
                        const curveValue = (1 - alpha) * curveArray[i0] + alpha * curveArray[i1];
                        const absolutePercent = TOTAL > 0 ? (curveValue / TOTAL) * 100 : 0;
                        return Math.max(0, Math.min(100, absolutePercent));
                    };

                    const measurementPoints = globalData.originalData.map((d) => {
                        const inputPercent = Math.max(0, Math.min(100, Number(d.input ?? d.GRAY ?? d.gray ?? 0)));
                        const outputPercent = sampleCurvePercent(inputPercent);
                        const entry = {
                            input: inputPercent,
                            output: outputPercent
                        };

                        if (typeof d.LAB_L === 'number') {
                            entry.labL = d.LAB_L;
                        }

                        return entry;
                    });

                    if (measurementCount <= DIRECT_SEED_MAX_POINTS) {
                        console.log(`[EDIT MODE] 🎯 Direct seeding ${channelName} from ${measurementCount} global measurement points`);
                        console.log('[EDIT MODE] 💡 This replicates legacy quadgen.html LAB → Smart Curves workflow');

                        const adaptivePoints = extractAdaptiveKeyPointsFromValues(curveArray, {
                            maxErrorPercent: 0.1,
                            maxPoints: 42,
                            scaleMax: endValue > 0 ? endValue : TOTAL
                        });

                        keyPoints = adaptivePoints.map((pt) => ({
                            input: Math.max(0, Math.min(100, Number(pt.input))),
                            output: Math.max(0, Math.min(100, Number(pt.output)))
                        }));
                        keyPointsAreRelative = true;

                        seedMeta = {
                            measurementSeed: {
                                scope: 'global',
                                format: globalFormat,
                                count: measurementCount,
                                originalPoints: measurementPoints
                            }
                        };

                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[EDIT MODE] Global measurement adaptive count', keyPoints.length, channelName);
                        }
                    } else {
                        const targetPoints = Math.max(25, Math.min(MEASUREMENT_ADAPTIVE_MAX_POINTS, curveArray.length));
                        const uniformPoints = [];
                        for (let i = 0; i < targetPoints; i += 1) {
                            const input = targetPoints === 1 ? 0 : (i / (targetPoints - 1)) * 100;
                            const indexFloat = targetPoints === 1 ? 0 : (i / (targetPoints - 1)) * lastIndex;
                            const idx0 = Math.floor(indexFloat);
                            const idx1 = Math.min(lastIndex, Math.ceil(indexFloat));
                            const t = indexFloat - idx0;
                            const value0 = curveArray[idx0] ?? 0;
                            const value1 = curveArray[idx1] ?? value0;
                            const blended = ((1 - t) * value0) + (t * value1);
                            const relativeOutput = endValue > 0 ? (blended / endValue) * 100 : 0;
                            uniformPoints.push({
                                input,
                                output: Math.max(0, Math.min(100, relativeOutput))
                            });
                        }

                        keyPoints = uniformPoints;
                        keyPointsAreRelative = true;
                        bakedMetaPending = {
                            scope: 'global',
                            filename: globalData?.filename || getCurrentGlobalFilename(),
                            pointCount: keyPoints.length,
                            timestamp: Date.now()
                        };

                        seedMeta = {
                            measurementSeed: {
                                scope: 'global',
                                format: globalFormat,
                                count: measurementCount,
                                originalPoints: measurementPoints
                            }
                        };

                        console.log(`[EDIT MODE] ✅ Extracted ${keyPoints.length} Smart key points for ${channelName} from corrected curve samples`);

                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[EDIT MODE] Global measurement fallback count', keyPoints.length, channelName);
                        }
                    }
                } else if (normalizedSamples && normalizedSamples.length === 256) {
                    const Nvals = normalizedSamples.length - 1;
                    keyPoints = globalData.originalData.map(d => {
                        const inputPercent = Math.max(0, Math.min(100, Number(d.input ?? d.GRAY ?? d.gray ?? 0)));
                        const t = (inputPercent / 100) * Nvals;
                        const i0 = Math.floor(t);
                        const i1 = Math.min(Nvals, Math.ceil(t));
                        const a = t - i0;
                        const vNorm = (1 - a) * normalizedSamples[i0] + a * normalizedSamples[i1];
                        const outputValue = vNorm * endValue;
                        const outputPercent = Math.max(0, Math.min(100, (outputValue / TOTAL) * 100));
                        return { input: inputPercent, output: outputPercent };
                    });

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[EDIT MODE] Global normalized key points count', keyPoints.length, channelName);
                    }

                    bakedMetaPending = {
                        scope: 'global',
                        filename: globalData?.filename || getCurrentGlobalFilename(),
                        pointCount: keyPoints.length,
                        timestamp: Date.now()
                    };

                    seedMeta = {
                        measurementSeed: {
                            scope: 'global',
                            format: globalFormat,
                            count: measurementCount
                        }
                    };

                    console.log(`[EDIT MODE] ✅ Generated ${keyPoints.length} key points for ${channelName} using normalized measurement fallback`);
                }
            }
        } else if (!seededFromCurve) {
            // Fallback: extract key points from curve using stored samples when helpers are unavailable
            const channelRow = Array.from(elements.rows.children).find(tr =>
                tr.getAttribute('data-channel') === channelName
            );
            const endInput = channelRow?.querySelector('.end-input');
            const endValue = parseInt(endInput?.value || '0', 10);

                if (!seededFromCurve && Array.isArray(resolvedSamples) && resolvedSamples.length === CURVE_RESOLUTION) {
                    if (seedChannelFromSamples(channelName, resolvedSamples, 'initialize-fallback')) {
                        seededFromCurve = true;
                        seedSamples = resolvedSamples;
                        keyPointsAreRelative = true;
                        keyPoints = ControlPoints.get(channelName)?.points || null;
                    }
                }
        }

                // Apply the key points if we have them
                if (keyPoints && keyPoints.length >= 2 && !seededFromCurve) {
                    const channelPercentValid = Number.isFinite(channelPercent) && channelPercent > 0 ? channelPercent : null;
                   const seededFromMeasurement = !!(seedMeta && seedMeta.measurementSeed);
                   const persistOptions = {
                       ...(seedMeta || {}),
                       channelPercentOverride: channelPercentValid,
                       pointsAreRelative: true,
                       skipUiRefresh: false,
                       includeBakedFlags: true,
                       sourceSamples: seedSamples
                   };

                   const basePercent = channelPercentValid && channelPercentValid > 0
                       ? channelPercentValid
                       : null;

                   const relativePoints = keyPoints.map((point) => {
                       const absolute = Number(point.output);
                       let relativeValue;
                       if (persistOptions.pointsAreRelative) {
                           if (keyPointsAreRelative) {
                               relativeValue = absolute;
                           } else if (basePercent) {
                               relativeValue = (absolute / basePercent) * 100;
                           } else {
                               relativeValue = absolute;
                           }
                       } else {
                           relativeValue = absolute;
                       }
                        return {
                            input: Number(point.input),
                            output: Math.max(0, Math.min(100, relativeValue))
                       };
                    });
                   persistSmartPoints(channelName, relativePoints, 'smooth', persistOptions);
                   if (!seededFromMeasurement && Array.isArray(seedSamples) && seedSamples.length === CURVE_RESOLUTION) {
                       const verification = verifySmartCurveMatchesSource(channelName, seedSamples);
                       if (!verification.ok) {
                           const fallbackAbsolute = buildInflectionPointsFromSamples(seedSamples, TOTAL);
                           if (Array.isArray(fallbackAbsolute) && fallbackAbsolute.length >= 2) {
                               const fallbackRelative = fallbackAbsolute.map((point) => {
                                   const absolute = Number(point.output);
                                   if (channelPercentValid && channelPercentValid > 0) {
                                       return {
                                           input: Number(point.input),
                                           output: Math.max(0, Math.min(100, (absolute / channelPercentValid) * 100))
                                       };
                                   }
                                   return {
                                       input: Number(point.input),
                                       output: Math.max(0, Math.min(100, absolute))
                                   };
                               });
                               editModeDebugLog(`Retrying Smart seed with inflection fallback for ${channelName}`, verification);
                               persistSmartPoints(channelName, fallbackRelative, 'smooth', {
                                   channelPercentOverride: channelPercentValid,
                                   pointsAreRelative: true,
                                   skipUiRefresh: false,
                                   includeBakedFlags: true,
                                   smartTouched: true
                               });
                           }
                       }
                       seedSamples = null;
                   }
                    let bakeMeta = null;
                    if (seededFromMeasurement) {
                        if (measurementContext?.scope === 'global') {
                            const filename = (
                                measurementContext?.data?.filename
                                || LinearizationState.getGlobalData?.()?.filename
                                || getCurrentGlobalFilename()
                            ) || undefined;
                            bakeMeta = {
                                scope: 'global',
                                filename,
                                pointCount: relativePoints.length,
                                timestamp: Date.now()
                            };
                        }
                    } else if (bakedMetaPending) {
                        bakeMeta = bakedMetaPending;
                    }
                    if (bakeMeta) {
                        setGlobalBakedState(bakeMeta);
                    }
                } else if (!seededFromCurve) {
                    // Final fallback: create simple linear points
                    const linearPoints = createDefaultKeyPoints();
                    const channelPercentValid = Number.isFinite(channelPercent) && channelPercent > 0 ? channelPercent : null;
                    const relativeLinear = linearPoints.map((point) => {
                        const absolute = Number(point.output);
                        const relative = channelPercentValid
                            ? (absolute / channelPercentValid) * 100
                            : absolute;
                        return {
                            input: Number(point.input),
                            output: Math.max(0, Math.min(100, relative))
                        };
                    });
                    const fallbackOptions = {
                        channelPercentOverride: channelPercentValid,
                        pointsAreRelative: true,
                        smartTouched: false,
                        skipUiRefresh: false
                    };
                    persistSmartPoints(channelName, relativeLinear, 'smooth', fallbackOptions);
                    console.log(`[EDIT MODE] ✅ Created default linear points for ${channelName}`);
                } else {
                    console.log(`[EDIT MODE] ✅ Preserved existing Smart key points for ${channelName} from fallback samples`);
                }

                const finalPoints = ControlPoints.get(channelName)?.points || [];
                if (!Array.isArray(finalPoints) || finalPoints.length <= 2 || isDefaultRampPoints(finalPoints)) {
                    if (seedSmartPointsFromStoredCurve(channelName, 'initialize-final')) {
                        console.log(`[EDIT MODE] ✅ Rebuilt Smart key points for ${channelName} from stored curve`);
                    }
                }
            } catch (err) {
                console.warn(`[EDIT MODE] Failed to create Smart key points for ${channelName}:`, err);
            }
        } else {
            console.log(`[EDIT MODE] ${channelName} already has ${existingPoints.length} Smart key points`);
        }
    });

    if (hasMeasurementData && LinearizationState.isGlobalEnabled?.()) {
        try {
            const globalData = LinearizationState.getGlobalData?.();
            if (globalData) {
                const firstChannel = enabledChannels[0] || null;
                const pointCount = firstChannel
                    ? (ControlPoints.get(firstChannel)?.points?.length || 0)
                    : 0;
                setGlobalBakedState({
                    scope: 'global',
                    filename: globalData.filename || getCurrentGlobalFilename(),
                    pointCount,
                    timestamp: Date.now()
                }, { skipHistory: true });
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[EDIT MODE] Unable to mark global correction baked during initialization:', err);
            }
        }
    }

    if (LinearizationState.isGlobalEnabled?.()) {
        const loadedData = getLoadedQuadData?.() || null;
        enabledChannels.forEach((channelName) => {
            const meta = loadedData?.keyPointsMeta?.[channelName] || {};
            const hasMeasurementSeed = !!meta.measurementSeed;
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[EDIT MODE] Simplify check', channelName, meta);
            }
            if (hasMeasurementSeed) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[EDIT MODE] Skipping Smart simplification for', channelName, 'due to measurement seed');
                }
                return;
            }
            try {
                simplifySmartKeyPointsFromCurve(channelName, {
                    maxErrorPercent: 0.05,
                    maxPoints: 50,
                    minPoints: 20,
                    skipUiRefresh: true
                });
            } catch (err) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[EDIT MODE] Failed to resimplify Smart points after measurement load for', channelName, err);
                }
            }
        });
    }

    // Set first enabled channel as selected if none is selected
    if (enabledChannels.length > 0 && !EDIT_STATE.selectedChannel) {
        setEditSelectionState(enabledChannels[0], 1);
        console.log(`[EDIT MODE] ✅ Selected ${enabledChannels[0]} as default edit channel`);
    }
}

/**
 * Helper function to find the first enabled channel
 */
function findFirstEnabledChannel() {
    if (!elements.rows) return null;

    const rows = Array.from(elements.rows.children).filter(tr => tr.id !== 'noChannelsRow');

    for (const row of rows) {
        const channelName = row.getAttribute('data-channel');
        if (!channelName) continue;

        if (isChannelRowEnabled(row, channelName)) {
            return channelName;
        }
    }

    return null;
}

/**
 * Populate channel dropdown with enabled channels
 */
function populateChannelSelect() {
    if (!elements.editChannelSelect || !elements.rows) return;

    const sel = elements.editChannelSelect;
    const rows = Array.from(elements.rows.children).filter(tr => tr.id !== 'noChannelsRow');

    const enabled = rows
        .map(tr => {
            const channelName = tr.getAttribute('data-channel');
            if (!channelName) return null;
            return isChannelRowEnabled(tr, channelName) ? channelName : null;
        })
        .filter(Boolean);

    const prev = sel.value;
    const prevChannel = EDIT_STATE.selectedChannel || prev;
    const prevOrdinal = EDIT_STATE.selectedOrdinal || 1;

    sel.innerHTML = '';

    if (enabled.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No channels enabled';
        opt.disabled = true;
        opt.selected = true;
        sel.appendChild(opt);
        setEditSelectionState(null, 1);
        setControlsEnabled(false);
        if (elements.editChannelState) {
            elements.editChannelState.textContent = '';
        }
        return;
    }

    // Populate dropdown with enabled channels
    enabled.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch;
        opt.textContent = ch;
        sel.appendChild(opt);
    });

    // Determine which channel to select
    const desired = enabled.includes(prevChannel) ? prevChannel : enabled[0];
    sel.value = desired;

    const changed = EDIT_STATE.selectedChannel !== desired;
    const nextOrdinal = changed ? 1 : prevOrdinal;
    setEditSelectionState(desired, nextOrdinal, { skipHistory: !changed });

    // Ensure Smart key points exist for the selected channel
    if (desired) {
        ensureSmartKeyPointsForChannel(desired);
    }

    refreshEditState();
}

/**
 * Refresh edit state and update UI controls
 */
function refreshEditState() {
    const ch = EDIT_STATE.selectedChannel;

    if (!isEditModeEnabled()) {
        setControlsEnabled(false);
        if (elements.editChannelState) {
            elements.editChannelState.textContent = '';
        }
        return;
    }

    const isEnabled = editIsChannelEnabled(ch);
    setControlsEnabled(isEnabled);

    try {
        updateBellShiftControl(ch);
    } catch (err) {
        console.warn('[EDIT MODE] Failed to refresh bell apex control:', err);
    }
    try {
        updateBellWidthControls(ch);
    } catch (err) {
        console.warn('[EDIT MODE] Failed to refresh bell width controls:', err);
    }

    // Update channel state display
    if (elements.editChannelState) {
        if (ch && isEnabled) {
            elements.editChannelState.textContent = `Editing: ${ch}`;
        } else if (ch) {
            elements.editChannelState.textContent = `${ch} (disabled)`;
        } else {
            elements.editChannelState.textContent = 'No channel selected';
        }
    }

    // Update point display
    updatePointDisplay();
}

/**
 * Check if a channel is enabled for editing
 * @param {string} channelName - Channel to check
 * @returns {boolean} Whether channel is enabled
 */
function isChannelRowEnabled(row, channelName) {
    if (!row) return false;

    const percentValueRaw = row.querySelector('.percent-input')?.value ?? '';
    const endValueRaw = row.querySelector('.end-input')?.value ?? '';
    const percentValue = Number.parseFloat(percentValueRaw);
    const endValue = Number.parseInt(endValueRaw, 10);
    const hasPercent = Number.isFinite(percentValue) && percentValue > 0;
    const hasEnd = Number.isFinite(endValue) && endValue > 0;
    const perChannelToggle = row.querySelector('.per-channel-toggle');
    const toggleEnabled = !!perChannelToggle && perChannelToggle.checked;
    const perChannelActive = !!channelName && LinearizationState.isPerChannelEnabled(channelName);

    return hasPercent || hasEnd || toggleEnabled || perChannelActive;
}

function editIsChannelEnabled(channelName) {
    if (!channelName) return false;
    const row = getChannelRow(channelName);
    return isChannelRowEnabled(row, channelName);
}

/**
 * Enable/disable edit mode controls
 * @param {boolean} enabled - Whether to enable controls
 */
function setControlsEnabled(enabled) {
    try {
        // Apply dimming/disabled class to the entire edit panel body
        if (elements.editPanelBody) {
            elements.editPanelBody.classList.toggle('edit-panel-disabled', !enabled);
        }

        // Enable/disable various edit controls
        const controls = [
            'editChannelSelect',
            'editChannelPrev',
            'editChannelNext',
            'editRecomputeBtn',
            'editPointLeft',
            'editPointRight',
            'editXYInput',
            'editDeleteBtn',
            'editNudgeXNeg',
            'editNudgeXPos',
            'editNudgeYUp',
            'editNudgeYDown',
            'editMaxError',
            'editMaxPoints'
        ];

        controls.forEach(id => {
            const el = elements[id] || document.getElementById(id);
            if (el) {
                el.disabled = !enabled;
            }
        });

        // Update point index display state
        const pointIndexElement = elements.editPointIndex || document.getElementById('editPointIndex');
        if (pointIndexElement) {
            pointIndexElement.classList.toggle('is-disabled', !enabled);
        }

        // Update disabled hint visibility
        if (elements.editDisabledHint) {
            const hideHint = enabled || !isEditModeEnabled();
            elements.editDisabledHint.classList.toggle('hidden', hideHint);
        }
    } catch (err) {
        console.warn('[EDIT MODE] Controls update error:', err);
    }
}

/**
 * Cycle edit-mode channel selection using navigation buttons
 * @param {number} direction -1 for previous, +1 for next
 */
function cycleSelectedChannel(direction) {
    if (!isEditModeEnabled()) {
        showStatus('Edit mode is off');
        return;
    }

    const select = elements.editChannelSelect || document.getElementById('editChannelSelect');
    if (!select) return;

    const options = Array.from(select.options).filter(opt => !opt.disabled && opt.value);
    if (options.length === 0) {
        showStatus('No channels enabled');
        return;
    }

    const currentValue = select.value && options.some(opt => opt.value === select.value)
        ? select.value
        : options[0].value;

    const currentIndex = options.findIndex(opt => opt.value === currentValue);
    const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = ((normalizedIndex + direction) % options.length + options.length) % options.length;
    const nextValue = options[nextIndex].value;

    if (!nextValue || nextValue === EDIT_STATE.selectedChannel) {
        return;
    }

    setSelectedChannel(nextValue, { description: `Select channel ${nextValue}` });

    if (select.value !== nextValue) {
        select.value = nextValue;
    }

    try {
        triggerInkChartUpdate();
    } catch (err) {
        console.warn('[EDIT MODE] Failed to update chart after channel cycle:', err);
    }
}

/**
 * Initialize edit mode system
 * Should be called during app initialization
 */
export function initializeEditMode() {
    // Set initial state
    setEditModeFlag(false);
    setEditSelectionState(null, 1, { skipHistory: true });
    persistEditModeFlag(false);

    // Clear any existing priming flag
    setEditModePrimed(false);

    // Initialize channel dropdown event handler
    initializeChannelDropdownHandler();

    // Initialize edit control handlers
    initializeEditControlHandlers();
    initializeBellShiftControls();
    initializeBellWidthControls();

    console.log('✅ Edit mode system initialized');
}

/**
 * Initialize channel dropdown change handler
 */
function initializeChannelDropdownHandler() {
    if (EDIT_DROPDOWN_BOUND) return;
    if (elements.editChannelSelect) {
        EDIT_DROPDOWN_BOUND = true;
        elements.editChannelSelect.addEventListener('change', (e) => {
            setEditSelectionState(e.target.value || null, 1, { description: `Select channel ${e.target.value || 'none'}` });
            refreshEditState();
            try {
                triggerInkChartUpdate();
            } catch (err) {
                console.warn('[EDIT MODE] Chart update failed:', err);
            }
        });
    }
}

/**
 * Handle Recompute button click
 */
function handleRecompute() {
    if (!isEditModeEnabled()) {
        showStatus('Edit mode is off');
        return;
    }

    const channelName = EDIT_STATE.selectedChannel;
    if (!channelName) {
        showStatus('No channel selected');
        return;
    }

    if (!editIsChannelEnabled(channelName)) {
        showStatus('Channel disabled – enable in Channels to recompute');
        return;
    }

    try {
        // Get parameters from UI
        const maxErrorElement = document.getElementById('editMaxError');
        const maxPointsElement = document.getElementById('editMaxPoints');

        const defaultMaxError = KP_SIMPLIFY.maxErrorPercent;
        const maxError = maxErrorElement
            ? Math.max(0.05, Math.min(5, parseFloat(maxErrorElement.value || String(defaultMaxError))))
            : defaultMaxError;
        const maxPoints = maxPointsElement ?
            Math.max(2, Math.min(21, parseInt(maxPointsElement.value || '21', 10))) : 21;

        const previousOrdinal = EDIT_STATE.selectedOrdinal || 1;

        const result = simplifySmartKeyPointsFromCurve(channelName, {
            maxErrorPercent: maxError,
            maxPoints: maxPoints,
            allowMeasurementResimplify: true
        });

        if (result.success) {
            const ordered = getOrderedSmartPoints(channelName);
            const clampedOrdinal = Math.max(1, Math.min(previousOrdinal, ordered.length || 1));
            setSelectedOrdinalState(clampedOrdinal);
            refreshEditState();
            updateChartAndPreview();
            showStatus(`Recomputed ${channelName} Key Points (${maxPoints} max, ${maxError}% max error)`);
            try {
                triggerRevertButtonsUpdate();
            } catch (err) {
                console.warn('[EDIT MODE] updateRevertButtonsState failed after recompute:', err);
            }
        } else {
            showStatus(result.message || 'Recompute failed');
        }
    } catch (err) {
        console.warn('[EDIT MODE] Recompute error:', err);
        showStatus('Recompute error: ' + err.message);
    }
}

/**
 * Handle key point navigation (previous/next)
 */
function navigateKeyPoint(direction) {
    if (!isEditModeEnabled()) {
        showStatus('Edit mode is off');
        return;
    }

    const channelName = EDIT_STATE.selectedChannel;
    if (!channelName) return;

    const { orderedPoints, sortedOrdinal } = getSelectedPointContext(channelName);
    if (orderedPoints.length === 0) return;

    const len = orderedPoints.length;
    const newSortedOrdinal = ((sortedOrdinal - 1 + direction) % len + len) % len + 1;
    setSelectedOrdinalState(newSortedOrdinal);
    refreshEditState();
    updatePointDisplay();

    // Re-render chart to update selected point highlight
    triggerInkChartUpdate();
}

/**
 * Handle Delete button click
 */
function handleDeleteKeyPoint() {
    if (!isEditModeEnabled()) {
        showStatus('Edit mode is off');
        return;
    }

    const channelName = EDIT_STATE.selectedChannel;
    if (!channelName) return;

    if (isChannelLocked(channelName)) {
        showStatus(getChannelLockEditMessage(channelName, 'deleting points'));
        return;
    }

    if (!editIsChannelEnabled(channelName)) {
        showStatus('Channel disabled – enable in Channels to edit');
        return;
    }

    const { orderedPoints, sortedOrdinal } = getSelectedPointContext(channelName);
    if (orderedPoints.length === 0) {
        showStatus('No key points to delete');
        return;
    }

    const rawOrdinal = orderedPoints[sortedOrdinal - 1].rawOrdinal;

    try {
        const result = deleteSmartKeyPointByIndex(channelName, rawOrdinal, { allowEndpoint: false });

        if (result.success) {
            showStatus(`Deleted key point ${sortedOrdinal} from ${channelName}`);

            // Adjust selected ordinal if needed
            const nextOrdered = getOrderedSmartPoints(channelName);
            const clampedSorted = Math.min(sortedOrdinal, nextOrdered.length);
            setSelectedOrdinalState(clampedSorted > 0 ? clampedSorted : 1);

            refreshEditState();
            updateChartAndPreview();
        } else {
            showStatus(result.message || 'Delete failed');
        }
    } catch (err) {
        console.warn('[EDIT MODE] Delete error:', err);
        showStatus('Delete error: ' + err.message);
    }
}

/**
 * Handle X,Y coordinate input commit
 */
function handleXYInput() {
    if (!isEditModeEnabled()) {
        showStatus('Edit mode is off');
        return;
    }

    const channelName = EDIT_STATE.selectedChannel;
    if (!channelName) return;

    const xyInput = document.getElementById('editXYInput');
    if (!xyInput) return;

    const rawValue = String(xyInput.value || '').trim();
    const parts = rawValue.split(',');

    if (parts.length !== 2) {
        xyInput.classList.add('border-red-300');
        showStatus('Invalid format. Use X,Y (e.g., 25.5, 72.3)');
        setTimeout(() => xyInput.classList.remove('border-red-300'), 1500);
        return;
    }

    const x = parseFloat(parts[0].trim());
    const y = parseFloat(parts[1].trim());

    if (isNaN(x) || isNaN(y)) {
        xyInput.classList.add('border-red-300');
        showStatus('Invalid numbers. Use format: X,Y');
        setTimeout(() => xyInput.classList.remove('border-red-300'), 1500);
        return;
    }

    let absoluteY = y;
    try {
        const row = document.querySelector(`tr[data-channel="${channelName}"]`);
        const percentInput = row?.querySelector('.percent-input');
        const percentValue = percentInput ? InputValidator.clampPercent(percentInput.getAttribute('data-base-percent') ?? percentInput.value) : 100;
        if (Number.isFinite(percentValue) && percentValue > 0) {
            if (y > percentValue && y <= 100) {
                absoluteY = (y / 100) * percentValue;
            } else if (y > 100) {
                absoluteY = percentValue;
            }
        }
    } catch (percentErr) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[EDIT MODE] XY input percent clamp failed', percentErr);
        }
    }

    const { orderedPoints, sortedOrdinal, rawOrdinal } = getSelectedPointContext(channelName);
    if (orderedPoints.length === 0 || rawOrdinal == null) {
        xyInput.classList.add('border-red-300');
        showStatus('No key point selected');
        setTimeout(() => xyInput.classList.remove('border-red-300'), 1500);
        return;
    }

    try {
        const result = adjustSmartKeyPointByIndex(channelName, rawOrdinal, {
            inputPercent: x,
            outputPercent: absoluteY
        });

        if (result.success) {
            showStatus(`Updated key point ${sortedOrdinal} to ${x.toFixed(1)}, ${absoluteY.toFixed(1)}`);
            refreshEditState();
            updateChartAndPreview();
            xyInput.classList.remove('border-red-300');
        } else {
            xyInput.classList.add('border-red-300');
            showStatus(result.message || 'Edit failed');
            setTimeout(() => xyInput.classList.remove('border-red-300'), 1500);
        }
    } catch (err) {
        console.warn('[EDIT MODE] XY input error:', err);
        xyInput.classList.add('border-red-300');
        showStatus('Edit error: ' + err.message);
        setTimeout(() => xyInput.classList.remove('border-red-300'), 1500);
    }
}

/**
 * Update point display (X,Y input and point index)
 */
function updatePointDisplay() {
    const channelName = EDIT_STATE.selectedChannel;
    if (!channelName || !editIsChannelEnabled(channelName)) {
        const pointIndexElement = document.getElementById('editPointIndex');
        if (pointIndexElement) {
            pointIndexElement.textContent = '–';
            pointIndexElement.classList.add('is-disabled');
        }
        const xyInputFallback = document.getElementById('editXYInput');
        if (xyInputFallback) {
            xyInputFallback.value = '';
            xyInputFallback.disabled = true;
        }
        return;
    }

    const { orderedPoints, sortedOrdinal, point } = getSelectedPointContext(channelName);
    if (orderedPoints.length === 0 || !point) {
        const pointIndexElement = document.getElementById('editPointIndex');
        if (pointIndexElement) {
            pointIndexElement.textContent = '–';
            pointIndexElement.classList.add('is-disabled');
        }
        const xyInputFallback = document.getElementById('editXYInput');
        if (xyInputFallback) {
            xyInputFallback.value = '';
            xyInputFallback.disabled = true;
        }
        return;
    }

    // Update point index display
    const pointIndexElement = document.getElementById('editPointIndex');
    if (pointIndexElement) {
        pointIndexElement.textContent = String(sortedOrdinal);
        pointIndexElement.classList.remove('is-disabled');
    }

    // Update X,Y input field
    const xyInput = document.getElementById('editXYInput');
    if (xyInput) {
        const absoluteOutput = toAbsoluteOutput(channelName, point.output);
        xyInput.value = `${point.input.toFixed(1)},${absoluteOutput.toFixed(1)}`;
        xyInput.disabled = false;
    }
}

/**
 * Initialize all edit control handlers
 */
function initializeEditControlHandlers() {
    if (EDIT_CONTROLS_BOUND) return;
    EDIT_CONTROLS_BOUND = true;
    // Recompute button
    const recomputeBtn = document.getElementById('editRecomputeBtn');
    if (recomputeBtn) {
        recomputeBtn.addEventListener('click', handleRecompute);
    }

    // Channel navigation
    const prevBtn = document.getElementById('editChannelPrev');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => cycleSelectedChannel(-1));
    }

    const nextBtn = document.getElementById('editChannelNext');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => cycleSelectedChannel(1));
    }

    // Key point navigation
    const pointLeftBtn = document.getElementById('editPointLeft');
    const pointRightBtn = document.getElementById('editPointRight');

    if (pointLeftBtn) {
        pointLeftBtn.addEventListener('click', () => navigateKeyPoint(-1));
    }
    if (pointRightBtn) {
        pointRightBtn.addEventListener('click', () => navigateKeyPoint(1));
    }

    // Delete button
    const deleteBtn = document.getElementById('editDeleteBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteKeyPoint);
    }

    // X,Y input field
    const xyInput = document.getElementById('editXYInput');
    if (xyInput) {
        xyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleXYInput();
            }
        });
        xyInput.addEventListener('blur', handleXYInput);
    }

    const bindNudge = (button, deltaX, deltaY) => {
        if (!button) return;
        button.addEventListener('click', (evt) => {
            evt.preventDefault();
            applyNudgeToSelectedPoint(deltaX, deltaY, evt);
        });
    };

    bindNudge(document.getElementById('editNudgeXNeg'), -1, 0);
    bindNudge(document.getElementById('editNudgeXPos'), 1, 0);
    bindNudge(document.getElementById('editNudgeYUp'), 0, 1);
    bindNudge(document.getElementById('editNudgeYDown'), 0, -1);

    console.log('✅ Edit control handlers initialized');
}

/**
 * Update chart and preview after edits
 */
function updateChartAndPreview() {
    try {
        triggerInkChartUpdate();
        triggerPreviewUpdate();
        triggerProcessingDetail(EDIT_STATE.selectedChannel);
    } catch (err) {
        console.warn('[EDIT MODE] Chart/preview update failed:', err);
    }
}

// Make functions available globally (for legacy compatibility)
registerDebugNamespace('editMode', {
    isEditModeEnabled,
    setEditMode,
    reinitializeChannelSmartCurves,
    EDIT: EDIT_STATE,
    EDIT_STATE,
    refreshEditState,
    updatePointDisplay,
    edit_refreshPointIndex: updatePointDisplay,
    beginSmartPointDrag,
    updateSmartPointDrag,
    endSmartPointDrag,
    cancelSmartPointDrag,
    selectSmartPointOrdinal,
    isSmartPointDragActive
}, {
    exposeOnWindow: true,
    windowAliases: [
        'isEditModeEnabled',
        'setEditMode',
        'reinitializeChannelSmartCurves',
        'EDIT',
        'refreshEditState',
        'edit_refreshPointIndex',
        'beginSmartPointDrag',
        'updateSmartPointDrag',
        'endSmartPointDrag',
        'cancelSmartPointDrag',
        'isSmartPointDragActive',
        'selectSmartPointOrdinal'
    ]
});

// Auto-initialize when module is loaded
if (typeof window !== 'undefined') {
    initializeEditMode();
}
