// quadGEN Core Processing Pipeline
// Main curve generation, LUT application, and file building functions

import { CURVE_RESOLUTION, DataSpace } from '../data/processing-utils.js';
import { elements, getCurrentPrinter, getAppState, TOTAL, getLoadedQuadData, isChannelNormalizedToEnd } from './state.js';
import { InputValidator } from './validation.js';
import { ControlPoints, isSmartCurve, isSmartCurveSourceTag } from '../curves/smart-curves.js';
import { LinearizationState, ensurePrinterSpaceData, normalizeLinearizationEntry } from '../data/linearization-utils.js';
import { createCubicSpline, createCatmullRomSpline, createPCHIPSpline, clamp01 } from '../math/interpolation.js';
import { buildInkInterpolatorFromMeasurements } from '../data/lab-utils.js';
import { captureMake256Step } from '../debug/debug-make256.js';
import { CurveSimplification, normalizeSmoothingAlgorithm } from '../data/curve-simplification.js';
import { isLabLinearizationData, processLabLegacy } from '../data/lab-legacy-bypass.js';
import { AUTO_LIMIT_CONFIG } from './auto-limit-config.js';
import { setChannelAutoLimitMeta, clearChannelAutoLimitMeta } from './auto-limit-state.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getLegacyLinearizationBridge } from '../legacy/linearization-bridge.js';
import {
    isActiveRangeLinearizationEnabled,
    isCompositeLabRedistributionEnabled,
    isCompositeHighlightGuardEnabled,
    isCubeEndpointAnchoringEnabled,
    isRedistributionSmoothingWindowEnabled,
    getRedistributionSmoothingWindowConfig,
    isCompositePerSampleCeilingEnabled,
    isSlopeKernelSmoothingEnabled
} from './feature-flags.js';
import {
    isCompositeDebugEnabled,
    storeCompositeDebugSession
} from './composite-debug.js';
import { getAutoRaiseAuditState } from './auto-raise-on-import.js';
import {
    getCompositeWeightingMode,
    COMPOSITE_WEIGHTING_MODES
} from './composite-settings.js';
import { computeChannelMomentum } from './composite-momentum.js';
import { getLabSmoothingPercent, mapSmoothingPercentToWiden, isLabBaselineSmoothingEnabled } from './lab-settings.js';
import { DEFAULT_CHANNEL_DENSITIES } from './channel-densities.js';
import { computeSnapshotFlags, SNAPSHOT_FLAG_THRESHOLD_PERCENT } from './snapshot-flags.js';
import {
    applySnapshotSlopeLimiter,
    syncSnapshotsWithSlopeLimiter
} from './snapshot-slope-limiter.js';
import { applySnapshotSlopeKernel } from './snapshot-slope-kernel.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

function computeEffectiveHeadroom(info) {
    if (!info) {
        return 0;
    }
    const rawHeadroom = Number.isFinite(info.headroomNormalized) ? Math.max(0, info.headroomNormalized) : 0;
    const baseReserve = Number.isFinite(info.frontReserveBase) ? Math.max(0, info.frontReserveBase) : 0;
    const appliedReserve = Number.isFinite(info.frontReserveApplied) ? Math.max(0, info.frontReserveApplied) : 0;
    const remainingReserve = Math.max(0, baseReserve - appliedReserve);
    return Math.max(0, rawHeadroom - remainingReserve);
}

function computeAvailableCapacityNormalized(info, {
    coverageCapacity = Number.POSITIVE_INFINITY,
    effectiveHeadroom = Number.POSITIVE_INFINITY,
    endCapacity = Number.POSITIVE_INFINITY
} = {}) {
    if (!info) {
        return 0;
    }
    const coverage = Number.isFinite(coverageCapacity)
        ? Math.max(0, coverageCapacity)
        : Number.POSITIVE_INFINITY;
    const effective = Number.isFinite(effectiveHeadroom)
        ? Math.max(0, effectiveHeadroom)
        : (Number.isFinite(info?.effectiveHeadroomNormalized)
            ? Math.max(0, info.effectiveHeadroomNormalized)
            : computeEffectiveHeadroom(info));
    const end = Number.isFinite(endCapacity)
        ? Math.max(0, endCapacity)
        : (Number.isFinite(info?.headroomNormalized)
            ? Math.max(0, info.headroomNormalized)
            : Number.POSITIVE_INFINITY);

    const capacity = Math.min(coverage, effective, end);
    if (!Number.isFinite(capacity)) {
        const fallback = Math.min(effective, end);
        return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
    }
    return Math.max(0, capacity);
}

function getCompositeAuditConfig() {
    const auditConfig = globalScope && typeof globalScope === 'object' ? globalScope.__COMPOSITE_AUDIT__ : null;
    if (!auditConfig || auditConfig.enabled === false) {
        return null;
    }
    const index = Number.isFinite(auditConfig?.sampleIndex) ? Math.max(0, Math.floor(auditConfig.sampleIndex)) : 242;
    if (!Array.isArray(auditConfig.events)) {
        auditConfig.events = [];
    }
    return {
        index,
        events: auditConfig.events,
        log: typeof auditConfig?.log === 'function'
            ? auditConfig.log
            : (stage, payload) => {
                try {
                    console.log('[COMPOSITE_AUDIT]', stage, payload);
                } catch (err) {
                    // ignore logging failure
                }
            }
    };
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
        console.warn('[COMPOSITE_AUDIT] emit failed:', err);
    }
}

function mapToPlainObject(source) {
    if (!source) {
        return {};
    }
    if (source instanceof Map) {
        const out = {};
        source.forEach((value, key) => {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) {
                out[key] = numeric;
            }
        });
        return out;
    }
    if (typeof source === 'object') {
        const out = {};
        Object.keys(source).forEach((key) => {
            const numeric = Number(source[key]);
            if (Number.isFinite(numeric)) {
                out[key] = numeric;
            }
        });
        return out;
    }
    return {};
}

function cloneCoverageSummary(source) {
    if (!source || typeof source !== 'object') {
        return {};
    }
    const out = {};
    Object.keys(source).forEach((channel) => {
        const entry = source[channel];
        if (!entry || typeof entry !== 'object') {
            return;
        }
        const clampedSamples = Array.isArray(entry.clampedSamples)
            ? entry.clampedSamples.map((sample) => {
                if (!sample || typeof sample !== 'object') {
                    return null;
                }
                return {
                    index: Number.isInteger(sample.index) ? sample.index : null,
                    inputPercent: Number.isFinite(sample.inputPercent) ? sample.inputPercent : null,
                    normalizedBefore: Number.isFinite(sample.normalizedBefore) ? sample.normalizedBefore : null,
                    normalizedAfter: Number.isFinite(sample.normalizedAfter) ? sample.normalizedAfter : null,
                    desiredNormalizedAfter: Number.isFinite(sample.desiredNormalizedAfter) ? sample.desiredNormalizedAfter : null,
                    overflowNormalized: Number.isFinite(sample.overflowNormalized) ? sample.overflowNormalized : 0,
                    bufferedLimit: Number.isFinite(sample.bufferedLimit) ? sample.bufferedLimit : null,
                    limit: Number.isFinite(sample.limit) ? sample.limit : null,
                    truncatedByThreshold: sample.truncatedByThreshold === true,
                    truncatedByEnd: sample.truncatedByEnd === true,
                    truncatedByBlend: sample.truncatedByBlend === true
                };
            }).filter(Boolean)
            : [];
        out[channel] = {
            limit: Number.isFinite(entry.limit) ? Number(entry.limit) : 0,
            buffer: Number.isFinite(entry.buffer) ? Number(entry.buffer) : 0,
            bufferedLimit: Number.isFinite(entry.bufferedLimit) ? Number(entry.bufferedLimit) : 0,
            maxNormalized: Number.isFinite(entry.maxNormalized) ? Number(entry.maxNormalized) : 0,
            overflow: Number.isFinite(entry.overflow) ? Number(entry.overflow) : clampedSamples.length,
            overflowNormalized: Number.isFinite(entry.overflowNormalized) ? Number(entry.overflowNormalized) : 0,
            clampedSamples
        };
    });
    return out;
}

export function buildCoverageSummary(channelNames, {
    coverageLimits,
    coverageBuffers,
    coverageThresholds,
    coverageUsage,
    coverageClampEvents
}) {
    const summaryMap = new Map();
    const summaryPlain = {};
    channelNames.forEach((name) => {
        const limit = Math.max(0, coverageLimits?.get?.(name) || 0);
        const buffer = coverageBuffers?.get?.(name) || 0;
        const threshold = coverageThresholds?.get?.(name);
        const bufferedLimit = Number.isFinite(threshold) ? threshold : (limit + buffer);
        const usageValue = coverageUsage?.get?.(name);
        const clampEntries = coverageClampEvents?.get?.(name) || [];
        const maxNormalized = Number.isFinite(usageValue)
            ? Math.max(0, Math.min(usageValue, Number.isFinite(bufferedLimit) ? bufferedLimit : Math.max(usageValue, 0)))
            : 0;
        const overflowNormalized = clampEntries.reduce((sum, entry) => {
            const value = Number(entry?.overflowNormalized);
            return Number.isFinite(value) ? sum + Math.max(0, value) : sum;
        }, 0);
        const clampedSamples = clampEntries.map((entry) => {
            const index = Number.isInteger(entry?.index) ? entry.index : null;
            const explicitInputPercent = Number(entry?.inputPercent);
            const inputPercent = Number.isFinite(explicitInputPercent)
                ? explicitInputPercent
                : (index != null ? (index / (CURVE_RESOLUTION - 1)) * 100 : null);
            return {
                index,
                inputPercent,
                normalizedBefore: Number.isFinite(entry?.normalizedBefore) ? entry.normalizedBefore : null,
                normalizedAfter: Number.isFinite(entry?.normalizedAfter) ? entry.normalizedAfter : null,
                desiredNormalizedAfter: Number.isFinite(entry?.desiredNormalizedAfter) ? entry.desiredNormalizedAfter : null,
                overflowNormalized: Number.isFinite(entry?.overflowNormalized) ? entry.overflowNormalized : 0,
                bufferedLimit: Number.isFinite(entry?.bufferedLimit) ? entry.bufferedLimit : null,
                limit: Number.isFinite(entry?.limit) ? entry.limit : null,
                truncatedByThreshold: entry?.truncatedByThreshold === true,
                truncatedByEnd: entry?.truncatedByEnd === true
            };
        });
        const summary = {
            limit,
            buffer,
            bufferedLimit,
            maxNormalized,
            overflow: clampEntries.length,
            overflowNormalized,
            clampedSamples
        };
        summaryMap.set(name, summary);
        summaryPlain[name] = { ...summary };
    });
    return {
        map: summaryMap,
        plain: summaryPlain
    };
}

function ensureLadderBlendTracker() {
    if (!(compositeLabSession.ladderBlendTracker instanceof Map)) {
        compositeLabSession.ladderBlendTracker = new Map();
    }
    return compositeLabSession.ladderBlendTracker;
}

function clearLadderBlendTracker() {
    if (compositeLabSession.ladderBlendTracker instanceof Map) {
        compositeLabSession.ladderBlendTracker.clear();
    } else {
        compositeLabSession.ladderBlendTracker = new Map();
    }
}

function ensureShadowBlendTracker() {
    if (!(compositeLabSession.shadowBlendTracker instanceof Map)) {
        compositeLabSession.shadowBlendTracker = new Map();
    }
    return compositeLabSession.shadowBlendTracker;
}

function clearShadowBlendTracker() {
    if (compositeLabSession.shadowBlendTracker instanceof Map) {
        compositeLabSession.shadowBlendTracker.clear();
    } else {
        compositeLabSession.shadowBlendTracker = new Map();
    }
}

function ensureFrontReservePeakMap() {
    if (!(compositeLabSession.frontReservePeaks instanceof Map)) {
        compositeLabSession.frontReservePeaks = new Map();
    }
    return compositeLabSession.frontReservePeaks;
}

function clearFrontReservePeakMap() {
    if (compositeLabSession.frontReservePeaks instanceof Map) {
        compositeLabSession.frontReservePeaks.clear();
    } else {
        compositeLabSession.frontReservePeaks = new Map();
    }
}

function computeBlendCapForProgress(progress = 0) {
    const clampedProgress = Math.max(0, Math.min(progress, LADDER_BLEND_WINDOW_SAMPLES - 1));
    const baseCap = LADDER_BLEND_CAP_STEP * (clampedProgress + 1);
    return Math.min(LADDER_BLEND_CAP_MAX, baseCap);
}

function computeReserveMeta(info) {
    if (!info) {
        return { state: 'exhausted', allowance: 0 };
    }
    const baseReserve = Number.isFinite(info.frontReserveBase) ? Math.max(0, info.frontReserveBase) : 0;
    const rawHeadroom = Number.isFinite(info.headroomNormalized) ? Math.max(0, info.headroomNormalized) : 0;
    const appliedReserve = Number.isFinite(info.frontReserveApplied) ? Math.max(0, info.frontReserveApplied) : 0;
    const remainingReserve = Math.max(0, baseReserve - appliedReserve);
    const effectiveHeadroom = Math.max(0, computeEffectiveHeadroom(info));
    const reserveExhaustThreshold = Math.max(DENSITY_EPSILON, baseReserve * RESERVE_EXHAUST_FRACTION);

    let state;
    if (baseReserve <= DENSITY_EPSILON) {
        state = rawHeadroom > DENSITY_EPSILON ? 'approaching' : 'exhausted';
    } else if (rawHeadroom <= DENSITY_EPSILON) {
        state = 'exhausted';
    } else if (effectiveHeadroom <= DENSITY_EPSILON && rawHeadroom <= reserveExhaustThreshold + DENSITY_EPSILON) {
        state = 'exhausted';
    } else if (rawHeadroom <= baseReserve + DENSITY_EPSILON) {
        state = 'within';
    } else {
        state = 'approaching';
    }

    let allowance = 0;
    if (state === 'approaching' && rawHeadroom > baseReserve) {
        const slack = Math.max(0, rawHeadroom - baseReserve);
        const cap = Math.max(DENSITY_EPSILON, baseReserve * RESERVE_APPROACHING_FRACTION);
        allowance = Math.min(slack, cap);
    } else if (state === 'within') {
        const reserveCeiling = Math.max(DENSITY_EPSILON, Math.min(remainingReserve, baseReserve));
        const blendFactor = baseReserve > DENSITY_EPSILON
            ? Math.max(0, Math.min(1, rawHeadroom / baseReserve))
            : 0;
        const cap = Math.max(DENSITY_EPSILON, baseReserve * RESERVE_WITHIN_FRACTION);
        const scaledAllowance = blendFactor * reserveCeiling;
        allowance = Math.min(cap, scaledAllowance, rawHeadroom);
    }

    return {
        state,
        allowance: Math.max(0, allowance)
    };
}
const legacyLinearizationBridge = getLegacyLinearizationBridge();

/**
 * Helper function to get channel row element
 * @param {string} channelName - Channel name
 * @returns {HTMLElement|null} Channel row element
 */
function getChannelRow(channelName) {
    if (typeof document === 'undefined') return null;
    return document.querySelector(`tr[data-channel="${channelName}"]`);
}

const DENOM = CURVE_RESOLUTION - 1;

const COMPOSITE_SATURATION_THRESHOLD = 0.995;

const COMPOSITE_DENSITY_REGULARIZATION = 1e-4;
const DENSITY_DOMINANCE_THRESHOLD = 0.9;
const DENSITY_SUPPORT_THRESHOLD = 0.2;
const DENSITY_MIN_SHARE = 0.01;
const DENSITY_EPSILON = 1e-6;
const DENSITY_MAX_ITERATIONS = 8;
const HIGHLIGHT_DENSITY_NORMALIZED_THRESHOLD = 0.12;
const HIGHLIGHT_POSITIVE_DELTA_TOLERANCE = 0.005;
const REGION_PRIMARY_BIAS = 4;
const REGION_SECONDARY_SCALE = 0.1;
const REGION_BLEND_MARGIN = 3;
const ISOLATED_BASELINE_RETENTION = 0.08;
const SINGLE_PEAK_LOCK_RATIO = 0.32;
const PEAK_RISE_EPSILON = 5e-4;
const PEAK_DROP_TOLERANCE = 0.015;
const PEAK_MIN_NORMALIZED = 0.05;
const PEAK_REEVAL_WINDOW_RATIO = 0.15;
const MOMENTUM_WINDOW_RADIUS = 3;
const MOMENTUM_SIGMA = 1.25;
const MOMENTUM_GAIN = 1.5;
const MOMENTUM_SHARE_FLOOR = 0.02;
const FRONT_RESERVE_MAX_NORMALIZED = 0.035;
const FRONT_RESERVE_RELEASE_START = 0.1;
const FRONT_RESERVE_RELEASE_END = 0.2;
const FRONT_RESERVE_TAPER_START_FACTOR = 9;
const FRONT_RESERVE_TAPER_END_FACTOR = 1.0;
const FRONT_RESERVE_DECAY_FACTOR = 0.9;
const DENSITY_CEILING_BUFFER = 0.005;
const DENSITY_CEILING_TOLERANCE = 0.005;
const LADDER_BLEND_WINDOW_SAMPLES = 4;
const LADDER_BLEND_CAP_STEP = 0.0008;
const LADDER_BLEND_CAP_MAX = 0.008;
const LADDER_BLEND_CAPACITY_THRESHOLD = 0.0001;
const LADDER_BLEND_APPROACH_RATIO = 0.4;
const SHADOW_BLEND_WINDOW_SAMPLES = 6;
const SHADOW_BLEND_CAP_STEP = 0.01;
const SHADOW_BLEND_CAP_MAX = 0.02;
const SHADOW_BLEND_CAPACITY_THRESHOLD = 0.0025;
const SHADOW_BLEND_SHARE_FRACTION = 0.45;
const RESERVE_EXHAUST_FRACTION = 0.25;
const RESERVE_WITHIN_FRACTION = 0.35;
const RESERVE_APPROACHING_FRACTION = 0.15;

/**
 * Processing pipeline constants
 */
export const PROCESSING_CONSTANTS = {
    CURVE_RESOLUTION,
    TOTAL,
    N: CURVE_RESOLUTION, // Legacy alias
    LADDER_BLEND_CAPACITY_THRESHOLD
};

const compositeLabSession = {
    active: false,
    channels: [],
    endValues: {},
    baseCurves: {},
    densityWeights: new Map(),
    densityConstants: new Map(),
    densityProfiles: [],
    densityCumulative: {},
    densityCoverage: new Map(),
    densityCoverageSummary: {},
    densityCoverageLimits: new Map(),
    densityCoverageBuffers: new Map(),
    densityCoverageThresholds: new Map(),
    densityCoverageThresholdsNormalized: new Map(),
    densityCoverageUsage: new Map(),
    measurementDeltas: [],
    measurementSamples: [],
    densityInputs: [],
    densityOverrides: new Map(),
    densitySources: new Map(),
    normalizedEntry: null,
    domainMin: 0,
    domainMax: 1,
    interpolationType: 'cubic',
    smoothingPercent: 0,
    warnings: [],
    preparedContext: null,
    weightingMode: COMPOSITE_WEIGHTING_MODES.NORMALIZED,
    weightingStrength: 1,
    momentumByChannel: new Map(),
    momentumSummary: {},
    momentumOptions: null,
    lastDebugSession: null,
    autoComputeDensity: true,
    autoRaiseAdjustments: [],
    autoRaiseContext: null,
    densityLadder: [],
    densityLadderIndex: new Map(),
    ladderBlendTracker: new Map(),
    shadowBlendTracker: new Map()
};

export function beginCompositeLabRedistribution(config = {}) {
    const { channelNames = [], endValues = {}, labEntry = null } = config;
    if (!isCompositeLabRedistributionEnabled() || !labEntry) {
        compositeLabSession.active = false;
        compositeLabSession.channels = [];
        compositeLabSession.baseCurves = {};
        compositeLabSession.densityWeights = new Map();
        compositeLabSession.densityConstants = new Map();
        compositeLabSession.densityProfiles = [];
        compositeLabSession.densityCumulative = {};
        compositeLabSession.densityCoverage = new Map();
        compositeLabSession.densityCoverageSummary = {};
        compositeLabSession.densityCoverageLimits = new Map();
        compositeLabSession.densityCoverageBuffers = new Map();
        compositeLabSession.densityCoverageThresholds = new Map();
        compositeLabSession.densityCoverageThresholdsNormalized = new Map();
        compositeLabSession.densityCoverageUsage = new Map();
        compositeLabSession.measurementDeltas = [];
        compositeLabSession.measurementSamples = [];
        compositeLabSession.densityInputs = [];
        compositeLabSession.densityOverrides = new Map();
        compositeLabSession.densitySources = new Map();
        compositeLabSession.preparedContext = null;
        compositeLabSession.warnings = [];
        compositeLabSession.weightingMode = COMPOSITE_WEIGHTING_MODES.NORMALIZED;
        compositeLabSession.lastDebugSession = null;
        compositeLabSession.momentumByChannel = new Map();
        compositeLabSession.momentumSummary = {};
        compositeLabSession.momentumOptions = null;
        compositeLabSession.autoComputeDensity = true;
        compositeLabSession.autoRaiseAdjustments = [];
        compositeLabSession.autoRaiseContext = null;
        compositeLabSession.analysisOnly = false;
        compositeLabSession.densityLadder = [];
        compositeLabSession.densityLadderIndex = new Map();
        compositeLabSession.ladderBlendTracker = new Map();
        compositeLabSession.shadowBlendTracker = new Map();
        return false;
    }

    const printerSpaceEntry = ensurePrinterSpaceData(labEntry) || labEntry;
    const normalizedEntry = normalizeLinearizationEntry(printerSpaceEntry);

    if (!normalizedEntry || !Array.isArray(normalizedEntry.samples) || normalizedEntry.samples.length < 2) {
        compositeLabSession.active = false;
        compositeLabSession.channels = [];
        compositeLabSession.baseCurves = {};
        compositeLabSession.densityWeights = new Map();
        compositeLabSession.densityConstants = new Map();
        compositeLabSession.densityProfiles = [];
        compositeLabSession.densityCumulative = {};
        compositeLabSession.densityCoverage = new Map();
        compositeLabSession.densityCoverageSummary = {};
        compositeLabSession.densityCoverageLimits = new Map();
        compositeLabSession.densityCoverageBuffers = new Map();
        compositeLabSession.densityCoverageThresholds = new Map();
        compositeLabSession.densityCoverageThresholdsNormalized = new Map();
        compositeLabSession.densityCoverageUsage = new Map();
        compositeLabSession.measurementDeltas = [];
        compositeLabSession.densityInputs = [];
        compositeLabSession.measurementSamples = [];
        compositeLabSession.densityOverrides = new Map();
        compositeLabSession.densitySources = new Map();
        compositeLabSession.preparedContext = null;
        compositeLabSession.warnings = [];
        compositeLabSession.weightingMode = COMPOSITE_WEIGHTING_MODES.NORMALIZED;
        compositeLabSession.lastDebugSession = null;
        compositeLabSession.momentumByChannel = new Map();
        compositeLabSession.momentumSummary = {};
        compositeLabSession.momentumOptions = null;
        compositeLabSession.autoComputeDensity = true;
        compositeLabSession.autoRaiseAdjustments = [];
        compositeLabSession.autoRaiseContext = null;
        compositeLabSession.analysisOnly = false;
        compositeLabSession.densityLadder = [];
        compositeLabSession.densityLadderIndex = new Map();
        compositeLabSession.ladderBlendTracker = new Map();
        compositeLabSession.shadowBlendTracker = new Map();
        return false;
    }

    compositeLabSession.active = true;
    compositeLabSession.channels = Array.isArray(channelNames) ? channelNames.slice() : [];
    compositeLabSession.endValues = { ...endValues };
    compositeLabSession.baseCurves = {};
    compositeLabSession.densityWeights = new Map();
    compositeLabSession.densityConstants = new Map();
    compositeLabSession.densityProfiles = [];
    compositeLabSession.densityCumulative = {};
    compositeLabSession.densityCoverage = new Map();
    compositeLabSession.densityCoverageSummary = {};
    compositeLabSession.densityCoverageLimits = new Map();
    compositeLabSession.densityCoverageBuffers = new Map();
    compositeLabSession.densityCoverageThresholds = new Map();
    compositeLabSession.densityCoverageThresholdsNormalized = new Map();
    compositeLabSession.densityCoverageUsage = new Map();
    compositeLabSession.measurementDeltas = [];
    compositeLabSession.measurementSamples = [];
    compositeLabSession.densityInputs = [];
    compositeLabSession.normalizedEntry = normalizedEntry;
    compositeLabSession.domainMin = typeof normalizedEntry.domainMin === 'number' ? normalizedEntry.domainMin : 0;
    compositeLabSession.domainMax = typeof normalizedEntry.domainMax === 'number' ? normalizedEntry.domainMax : 1;
    compositeLabSession.interpolationType = config.interpolationType || 'cubic';
    compositeLabSession.smoothingPercent = Number.isFinite(config.smoothingPercent) ? Number(config.smoothingPercent) : 0;
    compositeLabSession.warnings = [];
    compositeLabSession.preparedContext = null;
    compositeLabSession.momentumByChannel = new Map();
    compositeLabSession.momentumSummary = {};
    compositeLabSession.momentumOptions = null;
    compositeLabSession.lastDebugSession = null;
    compositeLabSession.densityLadder = [];
    compositeLabSession.densityLadderIndex = new Map();
    compositeLabSession.ladderBlendTracker = new Map();
    compositeLabSession.shadowBlendTracker = new Map();
    const autoRaiseAudit = typeof getAutoRaiseAuditState === 'function' ? getAutoRaiseAuditState() : null;
    const sanitizedAutoRaiseAdjustments = [];
    if (autoRaiseAudit && Array.isArray(autoRaiseAudit.adjustments) && autoRaiseAudit.adjustments.length) {
        const channelLookup = new Map();
        compositeLabSession.channels.forEach((name) => {
            if (typeof name === 'string') {
                channelLookup.set(name, name);
                channelLookup.set(name.toUpperCase(), name);
                channelLookup.set(name.toLowerCase(), name);
            }
        });
        autoRaiseAudit.adjustments.forEach((entry) => {
            if (!entry || typeof entry.channelName !== 'string') {
                return;
            }
            const rawName = entry.channelName.trim();
            if (!rawName) {
                return;
            }
            const canonical = channelLookup.get(rawName) || channelLookup.get(rawName.toUpperCase()) || rawName;
            sanitizedAutoRaiseAdjustments.push({
                channel: canonical,
                channelName: canonical,
                previousPercent: Number.isFinite(entry.previousPercent) ? entry.previousPercent : null,
                newPercent: Number.isFinite(entry.newPercent) ? entry.newPercent : null,
                desiredPercent: Number.isFinite(entry.desiredPercent) ? entry.desiredPercent : Number.isFinite(autoRaiseAudit.targetPercent) ? autoRaiseAudit.targetPercent : null,
                absoluteTarget: Number.isFinite(entry.absoluteTarget) ? entry.absoluteTarget : null,
                previousEnd: Number.isFinite(entry.previousEnd) ? entry.previousEnd : null,
                newEnd: Number.isFinite(entry.newEnd) ? entry.newEnd : null,
                raised: entry.raised === true,
                source: entry.source || autoRaiseAudit.context?.source || null,
                timestamp: autoRaiseAudit.timestamp || Date.now()
            });
        });
    }
    compositeLabSession.autoRaiseAdjustments = sanitizedAutoRaiseAdjustments;
    compositeLabSession.autoRaiseContext = sanitizedAutoRaiseAdjustments.length
        ? {
            targetPercent: Number.isFinite(autoRaiseAudit?.targetPercent) ? autoRaiseAudit.targetPercent : null,
            label: typeof autoRaiseAudit?.context?.label === 'string' ? autoRaiseAudit.context.label : null,
            scope: autoRaiseAudit?.context?.scope || null,
            timestamp: autoRaiseAudit?.timestamp || Date.now()
        }
        : null;
    const overrideInputs = config.densityOverrides;
    const overrideMap = new Map();
    const overrideSources = new Map();
    if (overrideInputs && typeof overrideInputs === 'object') {
        const iterable = overrideInputs instanceof Map
            ? overrideInputs.entries()
            : Object.entries(overrideInputs);
        Array.from(iterable).forEach(([name, entry]) => {
            if (!name) return;
            const rawValue = entry && typeof entry === 'object' && entry !== null
                ? entry.value
                : entry;
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric)) return;
            const sanitized = numeric < 0 ? 0 : numeric;
            overrideMap.set(name, sanitized);
            const source = entry && typeof entry === 'object' && typeof entry.source === 'string'
                ? entry.source
                : 'manual';
            overrideSources.set(name, source);
        });
    }
    compositeLabSession.densityOverrides = overrideMap;
    compositeLabSession.densitySources = overrideSources;
    compositeLabSession.autoComputeDensity = config.autoComputeDensity !== false;
    compositeLabSession.analysisOnly = config.analysisOnly === true;
    const configuredMode = config.weightingMode || getCompositeWeightingMode();
    compositeLabSession.weightingMode = Object.values(COMPOSITE_WEIGHTING_MODES).includes(configuredMode)
        ? configuredMode
        : COMPOSITE_WEIGHTING_MODES.NORMALIZED;
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE] begin redistribution', {
            channels: compositeLabSession.channels,
            smoothingPercent: compositeLabSession.smoothingPercent,
            weightingMode: compositeLabSession.weightingMode,
            autoCompute: compositeLabSession.autoComputeDensity
        });
    }
    return true;
}

export function registerCompositeLabBase(channelName, values) {
    if (!compositeLabSession.active || !channelName || !Array.isArray(values)) {
        return;
    }
    compositeLabSession.baseCurves[channelName] = values.slice();
}

function solveLinearSystemSymmetric(matrix, vector) {
    const n = matrix.length;
    const augmented = new Array(n);

    for (let i = 0; i < n; i += 1) {
        augmented[i] = new Array(n + 1);
        for (let j = 0; j < n; j += 1) {
            augmented[i][j] = matrix[i][j];
        }
        augmented[i][n] = vector[i];
    }

    for (let i = 0; i < n; i += 1) {
        let pivot = i;
        let pivotValue = Math.abs(augmented[i][i]);
        for (let r = i + 1; r < n; r += 1) {
            const candidate = Math.abs(augmented[r][i]);
            if (candidate > pivotValue) {
                pivotValue = candidate;
                pivot = r;
            }
        }

        if (pivotValue <= 1e-12) {
            return null;
        }

        if (pivot !== i) {
            const temp = augmented[i];
            augmented[i] = augmented[pivot];
            augmented[pivot] = temp;
        }

        const divisor = augmented[i][i];
        for (let c = i; c <= n; c += 1) {
            augmented[i][c] /= divisor;
        }

        for (let r = 0; r < n; r += 1) {
            if (r === i) continue;
            const factor = augmented[r][i];
            if (Math.abs(factor) <= 1e-12) continue;
            for (let c = i; c <= n; c += 1) {
                augmented[r][c] -= factor * augmented[i][c];
            }
        }
    }

    const solution = new Array(n);
    for (let i = 0; i < n; i += 1) {
        solution[i] = augmented[i][n];
    }
    return solution;
}

function sampleArrayAt(samples, t) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return 0;
    }
    if (samples.length === 1) {
        return clamp01(Number(samples[0]) || 0);
    }
    const clampedT = clamp01(Number.isFinite(t) ? t : 0);
    const position = clampedT * (samples.length - 1);
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const frac = position - leftIndex;
    const leftValue = clamp01(Number(samples[leftIndex]) || 0);
    const rightValue = clamp01(Number(samples[rightIndex]) || 0);
    return leftValue + ((rightValue - leftValue) * frac);
}

function recordSampleForSmoothing(context, index, delta, contributions, weightMap) {
    if (!context) return;
    const filtered = {};
    Object.keys(contributions || {}).forEach((channel) => {
        const amount = contributions[channel];
        if (amount > DENSITY_EPSILON) {
            filtered[channel] = amount;
        }
    });
    const record = {
        index,
        delta,
        contributions: filtered,
        weightMap: { ...weightMap },
        inputPercent: (index / DENOM) * 100,
        smoothingWindows: []
    };
    if (!Array.isArray(context.sampleRecords)) {
        context.sampleRecords = new Array(CURVE_RESOLUTION).fill(null);
    }
    context.sampleRecords[index] = record;
    if (!(context.channelHistory instanceof Map)) {
        context.channelHistory = new Map();
    }
    Object.keys(filtered).forEach((channel) => {
        let history = context.channelHistory.get(channel);
        if (!history) {
            history = [];
            context.channelHistory.set(channel, history);
        }
        history.push(index);
    });
}

function computeCompositeDensityWeights(channels, baseCurves, endValues, normalizedEntry, options = {}) {
    const weightingMode = options.weightingMode || COMPOSITE_WEIGHTING_MODES.NORMALIZED;
    const weights = new Map();
    const constants = new Map();
    const measurementDeltas = new Array(CURVE_RESOLUTION).fill(0);
    const densityProfiles = new Array(CURVE_RESOLUTION).fill(null);
    const momentumEnabled = weightingMode === COMPOSITE_WEIGHTING_MODES.MOMENTUM;
    const momentumByChannel = new Map();
    const momentumSummary = {};
    const momentumOptions = momentumEnabled ? { windowRadius: MOMENTUM_WINDOW_RADIUS, sigma: MOMENTUM_SIGMA } : null;
    const autoRaiseAdjustments = Array.isArray(compositeLabSession.autoRaiseAdjustments)
        ? compositeLabSession.autoRaiseAdjustments
        : [];
    const forcedAutoRaiseChannels = new Set();
    const forcedAutoRaiseMeta = new Map();
    autoRaiseAdjustments.forEach((entry) => {
        if (!entry || entry.raised !== true) return;
        const name = typeof entry.channelName === 'string' ? entry.channelName : entry.channel;
        if (!name) return;
        forcedAutoRaiseChannels.add(name);
        forcedAutoRaiseMeta.set(name, entry);
    });

    const perSampleCeilingEnabled = isCompositePerSampleCeilingEnabled();
    const smoothingEnabled = isRedistributionSmoothingWindowEnabled();
    const smoothingContext = smoothingEnabled
        ? createRedistributionSmoothingContext(getRedistributionSmoothingWindowConfig(), {
            forcedChannels: forcedAutoRaiseChannels,
            forcedChannelMetadata: forcedAutoRaiseMeta,
            perSampleCeiling: perSampleCeilingEnabled
        })
        : null;
    const cumulativeDensity = {};
    const coverageLimits = new Map();
    const coverageBuffers = new Map();
    const coverageBufferThreshold = new Map();
    const coverageBufferThresholdNormalized = new Map();
    const coverageUsage = new Map();
    const coverageClampEvents = new Map();
    const densityInputs = new Array(CURVE_RESOLUTION).fill(0);
    const remainingByChannel = Object.create(null);
    let totalWeight = 0;
    let solved = false;
    let totalDensity = 0;

    const samples = Array.isArray(normalizedEntry?.samples) ? normalizedEntry.samples : null;

    function createRedistributionSmoothingContext(rawConfig = {}, extras = {}) {
        const minSamplesRaw = Number.isFinite(rawConfig.minSamples) ? Math.round(rawConfig.minSamples) : 3;
        const minSamples = Math.max(3, Math.min(12, minSamplesRaw));
        const maxSamplesRaw = Number.isFinite(rawConfig.maxSamples) ? Math.round(rawConfig.maxSamples) : 9;
        const maxSamples = Math.max(minSamples, Math.min(12, maxSamplesRaw));
        const targetSpanRaw = Number.isFinite(rawConfig.targetSpan) ? rawConfig.targetSpan : 0.07;
        const targetSpan = Math.max(0.01, Math.min(0.5, targetSpanRaw));
        const alphaRaw = Number.isFinite(rawConfig.alpha) ? rawConfig.alpha : 1.5;
        const alpha = Math.max(0.5, Math.min(4, alphaRaw));
        const momentumBias = Number.isFinite(rawConfig.momentumBias) ? rawConfig.momentumBias : 0;
        const perSampleActive = extras && extras.perSampleCeiling === true;
        return {
            config: {
                minSamples,
                maxSamples,
                targetSpan,
                targetSpanPercent: targetSpan * 100,
                alpha,
                momentumBias,
                maxIncomingScan: Math.max(maxSamples, 6),
                allowShortWindows: perSampleActive
            },
            sampleRecords: new Array(CURVE_RESOLUTION).fill(null),
            channelHistory: new Map(),
            saturationByChannel: new Map(),
            clampIndicesByChannel: new Map(),
            perSampleCeiling: perSampleActive,
            windows: [],
            debugRows: [],
            nextWindowId: 1,
            syntheticClampWindows: new Map(),
            forcedChannels: extras && extras.forcedChannels instanceof Set ? new Set(extras.forcedChannels) : new Set(),
            forcedChannelMetadata: extras && extras.forcedChannelMetadata instanceof Map
                ? new Map(extras.forcedChannelMetadata)
                : new Map()
        };
    }

    function buildSmoothingWindowIndices(history, sampleRecords, config, limitIndex = null) {
        const historyLength = Array.isArray(history) ? history.length : 0;
        if (historyLength === 0) {
            return [];
        }
        const allowShortWindows = !!config?.allowShortWindows;
        if (!allowShortWindows && historyLength < config.minSamples) {
            return [];
        }
        const minSamplesTarget = allowShortWindows
            ? Math.min(config.minSamples, Math.max(2, historyLength))
            : config.minSamples;
        const maxSamplesTarget = config.maxSamples;
        const windowIndices = [];
        let accumulatedSpan = 0;
        let previousInput = null;
        for (let idx = historyLength - 1; idx >= 0; idx -= 1) {
            const sampleIndex = history[idx];
            if (Number.isInteger(limitIndex) && sampleIndex > limitIndex) {
                continue;
            }
            const record = sampleRecords[sampleIndex];
            if (!record) {
                continue;
            }
            const input = Number.isFinite(record.inputPercent) ? record.inputPercent : (sampleIndex / DENOM) * 100;
            if (previousInput != null) {
                accumulatedSpan += Math.abs(previousInput - input);
            }
            windowIndices.unshift(sampleIndex);
            previousInput = input;
            if (windowIndices.length >= minSamplesTarget && accumulatedSpan >= config.targetSpanPercent) {
                break;
            }
            if (windowIndices.length >= maxSamplesTarget) {
                break;
            }
        }
        let backfillIndex = historyLength - windowIndices.length - 1;
        while (windowIndices.length < minSamplesTarget && backfillIndex >= 0) {
            const sampleIndex = history[backfillIndex];
            if (Number.isInteger(limitIndex) && sampleIndex > limitIndex) {
                backfillIndex -= 1;
                continue;
            }
            const record = sampleRecords[sampleIndex];
            if (!record) {
                break;
            }
            windowIndices.unshift(sampleIndex);
            backfillIndex -= 1;
        }
        return windowIndices;
    }

    function identifyIncomingChannels(context, outgoingChannel, windowIndices) {
        const sampleRecords = context.sampleRecords;
        const config = context.config;
        const incomingSet = new Set();
        windowIndices.forEach((sampleIndex) => {
            const record = sampleRecords[sampleIndex];
            if (!record || !record.contributions) return;
            Object.entries(record.contributions).forEach(([channel, amount]) => {
                if (channel === outgoingChannel) return;
                if (amount > DENSITY_EPSILON) {
                    incomingSet.add(channel);
                }
            });
        });
        const endIndex = windowIndices.length ? windowIndices[windowIndices.length - 1] : -1;
        for (let idx = endIndex + 1; idx < sampleRecords.length && idx >= 0 && incomingSet.size < config.maxIncomingScan; idx += 1) {
            const record = sampleRecords[idx];
            if (!record || !record.contributions) continue;
            Object.entries(record.contributions).forEach(([channel, amount]) => {
                if (channel === outgoingChannel) return;
                if (amount > DENSITY_EPSILON) {
                    incomingSet.add(channel);
                }
            });
        }
        if (!incomingSet.size) {
            const referenceIndex = windowIndices.length ? windowIndices[windowIndices.length - 1] : null;
            const referenceRecord = Number.isInteger(referenceIndex) ? sampleRecords[referenceIndex] : null;
            if (referenceRecord && referenceRecord.weightMap) {
                const weightEntries = Object.entries(referenceRecord.weightMap)
                    .filter(([channel, value]) => channel !== outgoingChannel && Number(value) > 0)
                    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
                weightEntries.slice(0, 3).forEach(([channel]) => incomingSet.add(channel));
            }
        }
        if (!incomingSet.size && context.forcedChannelMetadata instanceof Map) {
            const entries = [];
            context.forcedChannelMetadata.forEach((meta, name) => {
                if (!meta || name === outgoingChannel) return;
                const previousPercent = Number(meta.previousPercent);
                if (!Number.isFinite(previousPercent) || previousPercent <= 0) return;
                entries.push({ name, weight: previousPercent });
            });
            entries
                .sort((a, b) => (b.weight || 0) - (a.weight || 0))
                .slice(0, 3)
                .forEach(({ name }) => incomingSet.add(name));
        }
        if (!incomingSet.size && context.forcedChannels instanceof Set) {
            Array.from(context.forcedChannels)
                .filter((name) => name !== outgoingChannel)
                .slice(0, 3)
                .forEach((name) => incomingSet.add(name));
        }
        return incomingSet;
    }

    function detectSmoothingDropIndex(history, channel, sampleRecords) {
        if (!Array.isArray(history) || history.length === 0) {
            return null;
        }
        for (let idx = history.length - 2; idx >= 0; idx -= 1) {
            const currentIndex = history[idx];
            const nextIndex = history[idx + 1];
            const currentRecord = sampleRecords[currentIndex];
            const nextRecord = sampleRecords[nextIndex];
            if (!currentRecord || !nextRecord) {
                continue;
            }
            const currentValue = Number(currentRecord.contributions?.[channel]) || 0;
            const nextValue = Number(nextRecord.contributions?.[channel]) || 0;
            if (currentValue <= DENSITY_EPSILON) {
                continue;
            }
            if (nextValue <= currentValue * 0.6) {
                return currentIndex;
            }
        }
        return history[history.length - 1];
    }

    function redistributeSampleForWindow(params) {
        const {
            delta,
            outgoingChannel,
            newOutgoing,
            originalContributions,
            incomingChannels,
            weightMap
        } = params;
        const newContributions = {};
        const cappedOutgoing = Math.max(0, Math.min(delta, newOutgoing));
        newContributions[outgoingChannel] = cappedOutgoing;
        const available = Math.max(0, delta - cappedOutgoing);
        let othersOriginalTotal = 0;
        Object.entries(originalContributions).forEach(([channel, amount]) => {
            if (channel === outgoingChannel) return;
            if (amount > DENSITY_EPSILON) {
                othersOriginalTotal += amount;
            }
        });
        if (othersOriginalTotal > DENSITY_EPSILON && available > DENSITY_EPSILON) {
            const scale = available / othersOriginalTotal;
            Object.entries(originalContributions).forEach(([channel, amount]) => {
                if (channel === outgoingChannel) return;
                const scaled = amount * scale;
                if (scaled > DENSITY_EPSILON) {
                    newContributions[channel] = scaled;
                }
            });
        } else if (available > DENSITY_EPSILON) {
            let totalWeight = 0;
            incomingChannels.forEach((channel) => {
                const weight = Math.max(0, Number(weightMap?.[channel]) || 0);
                if (weight > 0) {
                    totalWeight += weight;
                }
            });
            if (totalWeight <= DENSITY_EPSILON && incomingChannels.length) {
                totalWeight = incomingChannels.length;
            }
            incomingChannels.forEach((channel) => {
                const rawWeight = Math.max(0, Number(weightMap?.[channel]) || 0);
                const weight = totalWeight > DENSITY_EPSILON ? (rawWeight || 1) / totalWeight : 1 / incomingChannels.length;
                const portion = available * weight;
                if (portion > DENSITY_EPSILON) {
                    newContributions[channel] = (newContributions[channel] || 0) + portion;
                }
            });
        }
        let sum = Object.values(newContributions).reduce((acc, value) => acc + value, 0);
        if (sum <= DENSITY_EPSILON) {
            return { contributions: { ...originalContributions } };
        }
        const diff = delta - sum;
        if (Math.abs(diff) > 1e-6) {
            const targets = incomingChannels.length ? incomingChannels : Object.keys(newContributions);
            const distribute = diff / Math.max(1, targets.length);
            targets.forEach((channel) => {
                newContributions[channel] = (newContributions[channel] || 0) + distribute;
            });
        }
        Object.keys(newContributions).forEach((channel) => {
            if (newContributions[channel] <= DENSITY_EPSILON) {
                delete newContributions[channel];
            }
        });
        sum = Object.values(newContributions).reduce((acc, value) => acc + value, 0);
        if (!Number.isFinite(sum) || sum <= DENSITY_EPSILON) {
            return { contributions: { ...originalContributions } };
        }
        const correction = delta / sum;
        Object.keys(newContributions).forEach((channel) => {
            newContributions[channel] *= correction;
        });
        return { contributions: newContributions };
    }

    function applySmoothingWindow(context, outgoingChannel, windowIndices, densityProfiles, options = {}) {
        if (!windowIndices.length) {
            return;
        }
        const forcedWindow = options && options.forced === true;
        const incomingSet = identifyIncomingChannels(context, outgoingChannel, windowIndices);
        if (!incomingSet.size) {
            return;
        }
        const incomingChannels = Array.from(incomingSet);
        const denominator = windowIndices.length > 1 ? (windowIndices.length - 1) : 1;
        const windowId = context.nextWindowId++;
        windowIndices.forEach((sampleIndex, ordinal) => {
            const record = context.sampleRecords[sampleIndex];
            if (!record || !Number.isFinite(record.delta) || record.delta <= DENSITY_EPSILON) {
                return;
            }
            const originalContributions = record.contributions || {};
            const outgoingOriginal = originalContributions[outgoingChannel] || 0;
            if (outgoingOriginal <= DENSITY_EPSILON) {
                return;
            }
            const position = denominator > 0 ? (ordinal / denominator) : 1;
            const attenuation = Math.pow(Math.max(0, 1 - position), context.config.alpha);
            const newOutgoing = outgoingOriginal * attenuation;
            const result = redistributeSampleForWindow({
                delta: record.delta,
                outgoingChannel,
                newOutgoing,
                originalContributions,
                incomingChannels,
                weightMap: record.weightMap || {}
            });
            record.contributions = result.contributions;
            const profile = densityProfiles[sampleIndex];
            if (profile) {
                const newShares = {};
                Object.entries(result.contributions).forEach(([channel, amount]) => {
                    if (amount > DENSITY_EPSILON) {
                        newShares[channel] = clamp01(amount / record.delta);
                    }
                });
                profile.shares = newShares;
                if (!Array.isArray(profile.smoothingWindows)) {
                    profile.smoothingWindows = [];
                }
                profile.smoothingWindows.push({
                    id: windowId,
                    outgoingChannel,
                    incomingChannels: incomingChannels.slice(),
                    position,
                    outFactor: attenuation,
                    forced: forcedWindow
                });
            }
            record.smoothingWindows = record.smoothingWindows || [];
            record.smoothingWindows.push({
                id: windowId,
                outgoingChannel,
                incomingChannels: incomingChannels.slice(),
                position,
                outFactor: attenuation,
                forced: forcedWindow
            });
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                const incomingPayload = {};
                incomingChannels.forEach((channel) => {
                    incomingPayload[channel] = result.contributions[channel] || 0;
                });
                context.debugRows.push({
                    windowId,
                    sampleIndex,
                    inputPercent: record.inputPercent,
                    outgoingOriginal,
                    outgoingAdjusted: result.contributions[outgoingChannel] || 0,
                    delta: record.delta,
                    incoming: incomingPayload,
                    forced: forcedWindow
                });
            }
        });
        const startRecord = context.sampleRecords[windowIndices[0]];
        const endRecord = context.sampleRecords[windowIndices[windowIndices.length - 1]];
        context.windows.push({
            id: windowId,
            outgoingChannel,
            incomingChannels: incomingChannels.slice(),
            startIndex: windowIndices[0],
            endIndex: windowIndices[windowIndices.length - 1],
            inputStart: startRecord ? startRecord.inputPercent : null,
            inputEnd: endRecord ? endRecord.inputPercent : null,
            forced: forcedWindow
        });
    }

    function processRedistributionSmoothingWindows(context, densityProfiles) {
        if (!context) return;
        const forcedChannels = context.forcedChannels instanceof Set ? context.forcedChannels : null;
        const clampMap = context.clampIndicesByChannel instanceof Map ? context.clampIndicesByChannel : null;
        const perSampleCeilingActive = context.perSampleCeiling === true;
        context.channelHistory.forEach((history, channel) => {
            if (!Array.isArray(history) || !history.length) {
                return;
            }

            let handledClamp = false;
            if (perSampleCeilingActive && clampMap) {
                const clampIndices = clampMap.get(channel);
                if (Array.isArray(clampIndices) && clampIndices.length) {
                    const uniqueClampIndices = Array.from(new Set(clampIndices)).sort((a, b) => a - b);
                    uniqueClampIndices.forEach((clampIndex) => {
                        if (!Number.isInteger(clampIndex)) {
                            return;
                        }
                        let windowIndices = buildSmoothingWindowIndices(
                            history,
                            context.sampleRecords,
                            context.config,
                            clampIndex
                        );
                        if (windowIndices.length < 2) {
                            const eligible = history.filter((idx) => Number.isInteger(idx) && idx <= clampIndex);
                            if (eligible.length >= 2) {
                                const start = Math.max(0, eligible.length - context.config.minSamples);
                                windowIndices = eligible.slice(start);
                            }
                        }
                        if (windowIndices.length >= 2) {
                            applySmoothingWindow(context, channel, windowIndices, densityProfiles, { forced: true });
                            handledClamp = true;
                        }
                    });
                    clampMap.set(channel, []);
                }
            }

            const isForced = forcedChannels ? forcedChannels.has(channel) : false;
            let limitIndex = context.saturationByChannel?.get(channel);
            if (!Number.isInteger(limitIndex)) {
                limitIndex = detectSmoothingDropIndex(history, channel, context.sampleRecords);
            }
            if (!Number.isInteger(limitIndex) && isForced) {
                limitIndex = history[history.length - 1];
            }
            if (handledClamp && !isForced) {
                return;
            }
            const windowIndices = buildSmoothingWindowIndices(history, context.sampleRecords, context.config, limitIndex);
            const minSamplesRequired = isForced ? Math.min(context.config.minSamples, 2) : context.config.minSamples;
            if (windowIndices.length >= minSamplesRequired && windowIndices.length > 0) {
                applySmoothingWindow(context, channel, windowIndices, densityProfiles, { forced: isForced });
            }
        });
    }

    function recomputeCumulativeDensityFromSamples(context, cumulativeDensityTarget) {
        if (!context) return;
        const totals = {};
        context.sampleRecords.forEach((record) => {
            if (!record || !record.contributions) return;
            Object.entries(record.contributions).forEach(([channel, amount]) => {
                if (!Number.isFinite(amount) || amount <= DENSITY_EPSILON) return;
                totals[channel] = (totals[channel] || 0) + amount;
            });
        });
        Object.keys(cumulativeDensityTarget).forEach((channel) => {
            cumulativeDensityTarget[channel] = totals[channel] || 0;
        });
        Object.keys(totals).forEach((channel) => {
            if (!Object.prototype.hasOwnProperty.call(cumulativeDensityTarget, channel)) {
                cumulativeDensityTarget[channel] = totals[channel];
            }
        });
    }

    const smoothingPercent = Number.isFinite(options.smoothingPercent)
        ? Number(options.smoothingPercent)
        : compositeLabSession.smoothingPercent;

    const baselineSmoothingEnabled = isLabBaselineSmoothingEnabled();
    const widenFactor = smoothingPercent > 0
        ? mapSmoothingPercentToWiden(smoothingPercent)
        : (baselineSmoothingEnabled ? 1 : 1);

    let measurementEvaluator = null;
    if (Array.isArray(normalizedEntry?.originalData) && normalizedEntry.originalData.length >= 2) {
        try {
            const helper = buildInkInterpolatorFromMeasurements(normalizedEntry.originalData, {
                skipDefaultSmoothing: !baselineSmoothingEnabled && smoothingPercent <= 0,
                widenFactor
            });
            if (helper && typeof helper.evaluate === 'function') {
                measurementEvaluator = helper.evaluate;
            }
        } catch (error) {
            console.warn('[COMPOSITE] Failed to build density evaluator from measurements:', error);
        }
    }

    const active = [];
    channels.forEach((name) => {
        const curve = baseCurves[name];
        const endValue = Math.max(0, Number(endValues[name]) || 0);
        if (!Array.isArray(curve) || curve.length === 0 || endValue <= 0) {
            return;
        }
        const maxValue = curve.reduce((max, value) => {
            const val = Number(value) || 0;
            return val > max ? val : max;
        }, 0);
        if (maxValue <= 0) {
            return;
        }
        active.push({ name, curve, endValue });
        if (momentumEnabled) {
            const momentumSeries = computeChannelMomentum(curve, endValue, momentumOptions || undefined);
            momentumByChannel.set(name, momentumSeries);
            const peak = Array.isArray(momentumSeries)
                ? momentumSeries.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
                : 0;
            momentumSummary[name] = peak;
        }
    });

    if (!active.length) {
        return {
            weights,
            totalWeight,
            solved,
            constants,
            measurementDeltas,
            profiles: densityProfiles,
            cumulativeDensity,
            totalDensity,
            inputs: densityInputs
        };
    }

    const sampleCount = measurementEvaluator
        ? CURVE_RESOLUTION
        : Math.min(CURVE_RESOLUTION, Array.isArray(samples) ? samples.length : 0);

    const manualOverridesRaw = options.manualDensityOverrides;
    const manualOverrides = new Map();
    const manualSources = new Map();
    if (manualOverridesRaw && typeof manualOverridesRaw === 'object') {
        const iterable = manualOverridesRaw instanceof Map
            ? manualOverridesRaw.entries()
            : Object.entries(manualOverridesRaw);
        Array.from(iterable).forEach(([channelName, entry]) => {
            if (!channelName) return;
            const rawValue = entry && typeof entry === 'object' && entry !== null
                ? entry.value
                : entry;
            const numeric = Number(rawValue);
            if (!Number.isFinite(numeric)) return;
            const sanitized = numeric < 0 ? 0 : numeric;
            manualOverrides.set(channelName, sanitized);
            const source = entry && typeof entry === 'object' && typeof entry.source === 'string'
                ? entry.source
                : 'manual';
            manualSources.set(channelName, source);
        });
    }

    const autoComputeEnabled = options.autoComputeEnabled !== false;

    const activeIndexByName = new Map();
    active.forEach((entry, idx) => {
        activeIndexByName.set(entry.name, idx);
    });

    const manualOnlyMap = new Map();
    manualOverrides.forEach((value, channelName) => {
        if (activeIndexByName.has(channelName)) {
            manualOnlyMap.set(channelName, value);
        }
    });

    const manualChannels = new Set(manualOnlyMap.keys());
    const solverChannels = active.filter(({ name }) => !manualChannels.has(name) && autoComputeEnabled);
    const solverChannelNames = solverChannels.map(({ name }) => name);

    const solverRows = [];
    const solverTargets = [];

    if (sampleCount >= 2) {
        for (let i = 0; i < sampleCount; i += 1) {
            const normalizedAll = new Array(active.length);
            let hasInk = false;

            for (let j = 0; j < active.length; j += 1) {
                const { curve, endValue } = active[j];
                const current = Number(curve[i]) || 0;
                const normalized = endValue > 0 ? clamp01(current / endValue) : 0;
                normalizedAll[j] = normalized;
                if (normalized > 1e-6) {
                    hasInk = true;
                }
            }

            if (!hasInk) {
                continue;
            }

            let targetValue;
            if (measurementEvaluator) {
                const t = sampleCount > 1 ? i / (sampleCount - 1) : 0;
                targetValue = clamp01(Number(measurementEvaluator(t)) || 0);
            } else if (samples && samples.length) {
                const sampleIndex = Math.min(i, samples.length - 1);
                targetValue = clamp01(Number(samples[sampleIndex]) || 0);
            } else {
                targetValue = solverRows.length > 1 ? i / (sampleCount - 1) : 0;
            }

            let manualContribution = 0;
            manualOnlyMap.forEach((manualValue, channelName) => {
                const idx = activeIndexByName.get(channelName);
                if (idx == null) return;
                manualContribution += manualValue * (normalizedAll[idx] || 0);
            });

            const residual = Math.max(0, targetValue - manualContribution);

            if (solverChannelNames.length) {
                const solverRow = new Array(solverChannelNames.length);
                let solverHasInk = false;
                for (let s = 0; s < solverChannelNames.length; s += 1) {
                    const idx = activeIndexByName.get(solverChannelNames[s]);
                    const normalized = idx != null ? normalizedAll[idx] || 0 : 0;
                    solverRow[s] = normalized;
                    if (normalized > 1e-6) {
                        solverHasInk = true;
                    }
                }
                if (solverHasInk || residual > DENSITY_EPSILON) {
                    solverRows.push(solverRow);
                    solverTargets.push(residual);
                }
            }
        }
    }

    const densitySources = new Map();

    if (solverRows.length && solverChannelNames.length) {
        const cols = solverChannelNames.length;
        const ata = Array.from({ length: cols }, () => new Array(cols).fill(0));
        const atb = new Array(cols).fill(0);

        solverRows.forEach((row, rowIndex) => {
            const y = solverTargets[rowIndex];
            for (let j = 0; j < cols; j += 1) {
                const vj = row[j];
                atb[j] += vj * y;
                for (let k = 0; k < cols; k += 1) {
                    ata[j][k] += vj * row[k];
                }
            }
        });

        for (let j = 0; j < cols; j += 1) {
            ata[j][j] += COMPOSITE_DENSITY_REGULARIZATION;
        }

        const solution = solveLinearSystemSymmetric(ata, atb);
        if (solution) {
            solution.forEach((value, index) => {
                if (!Number.isFinite(value) || value <= 0) {
                    return;
                }
                const weight = value;
                const channelName = solverChannelNames[index];
                weights.set(channelName, weight);
                constants.set(channelName, weight);
                densitySources.set(channelName, 'solver');
                totalWeight += weight;
            });
            solved = solution.some((value) => Number.isFinite(value) && value > 0);
        }
    }

    manualOnlyMap.forEach((manualValue, channelName) => {
        if (!Number.isFinite(manualValue)) return;
        weights.set(channelName, manualValue);
        constants.set(channelName, manualValue);
        densitySources.set(channelName, manualSources.get(channelName) || 'manual');
        totalWeight += manualValue;
        solved = true;
    });

    const measurementSamples = new Array(CURVE_RESOLUTION).fill(0);
    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
        const t = DENOM > 0 ? i / DENOM : 0;
        let value;
        if (measurementEvaluator) {
            value = measurementEvaluator(t);
        } else if (samples && samples.length >= 2) {
            value = sampleArrayAt(samples, t);
        } else {
            value = t;
        }
        measurementSamples[i] = clamp01(Number(value) || 0);
        densityInputs[i] = (i / DENOM) * 100;
    }

    for (let i = 1; i < CURVE_RESOLUTION; i += 1) {
        const delta = Math.max(0, measurementSamples[i] - measurementSamples[i - 1]);
        measurementDeltas[i] = delta;
        totalDensity += delta;
    }
    measurementDeltas[0] = 0;

    let maxMeasurementDeviation = 0;
    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
        const t = DENOM > 0 ? i / DENOM : 0;
        const measurementValue = measurementSamples[i];
        if (Number.isFinite(measurementValue)) {
            const deviation = Math.abs(measurementValue - t);
            if (deviation > maxMeasurementDeviation) {
                maxMeasurementDeviation = deviation;
            }
        }
    }

    const shareTable = {};
    active.forEach(({ name }) => {
        shareTable[name] = new Array(CURVE_RESOLUTION).fill(0);
        cumulativeDensity[name] = 0;
    });

    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
        let total = 0;
        active.forEach(({ name, curve }) => {
            total += Math.max(0, Number(curve[i]) || 0);
        });
        if (total <= DENSITY_EPSILON) continue;
        active.forEach(({ name, curve }) => {
            const share = Math.max(0, Number(curve[i]) || 0) / total;
            shareTable[name][i] = share;
        });
    }

    const useNormalizedWeighting = weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED;

    let channelOrdering = [];
    if (!useNormalizedWeighting) {
        channelOrdering = active.map(({ name }) => {
            const shareArray = shareTable[name];
            let firstDominance = -1;
            for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
                if (measurementDeltas[i] <= DENSITY_EPSILON) continue;
                if (shareArray[i] >= DENSITY_DOMINANCE_THRESHOLD) {
                firstDominance = i;
                break;
            }
        }
        if (firstDominance === -1) {
            for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
                if (measurementDeltas[i] <= DENSITY_EPSILON) continue;
                if (shareArray[i] >= DENSITY_SUPPORT_THRESHOLD) {
                    firstDominance = i;
                    break;
                }
            }
        }
        if (firstDominance === -1) {
            for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
                if (shareArray[i] > DENSITY_MIN_SHARE) {
                    firstDominance = i;
                    break;
                }
            }
        }
        if (firstDominance === -1) {
            firstDominance = Number.POSITIVE_INFINITY;
        }
        return { name, firstDominance, shareArray };
    }).sort((a, b) => a.firstDominance - b.firstDominance);

        const calibratedNames = [];
        channelOrdering.forEach(({ name, shareArray }) => {
            let residualSum = 0;
            let shareSum = 0;

            for (let i = 1; i < CURVE_RESOLUTION; i += 1) {
                const delta = measurementDeltas[i];
                if (delta <= DENSITY_EPSILON) continue;
                const share = shareArray[i];
                if (share <= DENSITY_MIN_SHARE) continue;

                let residual = delta;
                calibratedNames.forEach((prevName) => {
                    const prevConstant = constants.get(prevName) || 0;
                    const prevShare = shareTable[prevName]?.[i] || 0;
                    if (prevConstant > 0 && prevShare > 0) {
                        residual -= prevConstant * prevShare;
                    }
                });

                if (residual <= DENSITY_EPSILON) continue;

                residualSum += residual;
                shareSum += share;
            }

            if (shareSum <= DENSITY_EPSILON || totalDensity <= DENSITY_EPSILON) {
                constants.set(name, 0);
                calibratedNames.push(name);
                return;
            }

            let constant = residualSum / shareSum;
            if (!Number.isFinite(constant) || constant < 0) {
                constant = 0;
            }

            const used = Array.from(constants.values()).reduce((sum, value) => sum + value, 0);
            const remaining = Math.max(0, totalDensity - used);
            if (remaining <= DENSITY_EPSILON) {
                constants.set(name, 0);
                calibratedNames.push(name);
                return;
            }

            if (constant > remaining) {
                constant = remaining;
            }

            constants.set(name, constant);
            calibratedNames.push(name);
        });

        const sumConstants = Array.from(constants.values()).reduce((sum, value) => sum + value, 0);
        if (totalDensity > DENSITY_EPSILON && sumConstants < (totalDensity - DENSITY_EPSILON) && channelOrdering.length) {
            const lastName = channelOrdering[channelOrdering.length - 1].name;
            const additional = Math.max(0, totalDensity - sumConstants);
            constants.set(lastName, (constants.get(lastName) || 0) + additional);
        }
    } else {
        active.forEach(({ name }) => {
            let channelDensity = 0;
            for (let i = 1; i < CURVE_RESOLUTION; i += 1) {
                const delta = measurementDeltas[i];
                if (delta <= DENSITY_EPSILON) continue;
                const share = shareTable[name][i] || 0;
                if (share <= DENSITY_MIN_SHARE) continue;
                channelDensity += delta * share;
            }
            constants.set(name, channelDensity);
        });
        channelOrdering = active.map(({ name }) => ({ name }));
    }

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[density] constants size', constants.size, 'mode', weightingMode);
    }

    manualOnlyMap.forEach((manualValue, channelName) => {
        if (!Number.isFinite(manualValue)) return;
        constants.set(channelName, manualValue);
        densitySources.set(channelName, manualSources.get(channelName) || 'manual');
    });

    if (weightingMode === COMPOSITE_WEIGHTING_MODES.EQUAL) {
        const equalValue = 1;
        totalWeight = 0;
        solved = true;
        active.forEach(({ name }) => {
            weights.set(name, equalValue);
            totalWeight += equalValue;
        });
    }
    const channelOrderingList = channelOrdering.length ? channelOrdering : active.map(({ name }) => ({ name }));
    channelOrderingList.forEach(({ name }) => {
        const endValue = Math.max(0, Number(endValues[name]) || 0);
        const endNormalized = endValue > 0 ? Math.max(0, Math.min(1, endValue / TOTAL)) : 0;

        let limit = Math.max(0, constants.get(name) || 0);
        let sourceTag = densitySources.get(name);
        const fixedDensity = Number.isFinite(DEFAULT_CHANNEL_DENSITIES[name])
            ? DEFAULT_CHANNEL_DENSITIES[name]
            : null;
        if (fixedDensity != null) {
            limit = fixedDensity;
            constants.set(name, limit);
            if (!sourceTag || sourceTag === 'solver' || sourceTag === 'pending') {
                densitySources.set(name, 'fixed');
                sourceTag = 'fixed';
            }
        }
        if (!Number.isFinite(limit) || limit <= DENSITY_EPSILON) {
            if (endNormalized > DENSITY_EPSILON) {
                limit = endNormalized;
                constants.set(name, limit);
                if (!sourceTag) {
                    densitySources.set(name, 'end');
                    sourceTag = 'end';
                }
            } else {
                limit = 0;
                constants.set(name, limit);
            }
        } else if (endNormalized > DENSITY_EPSILON && limit > endNormalized + DENSITY_EPSILON) {
            limit = endNormalized;
            constants.set(name, limit);
        }

        const coverageLimit = limit;
        coverageLimits.set(name, coverageLimit);
        const buffer = coverageLimit > 0 ? DENSITY_CEILING_BUFFER : 0;
        coverageBuffers.set(name, buffer);
        const thresholdAbsolute = coverageLimit + buffer;
        coverageBufferThreshold.set(name, thresholdAbsolute);
        coverageBufferThresholdNormalized.set(name, 0);
        coverageUsage.set(name, 0);
        if (!perSampleCeilingEnabled) {
            remainingByChannel[name] = Math.max(0, Number.isFinite(thresholdAbsolute) ? thresholdAbsolute : 0);
        }
    });

    for (let i = 1; i < CURVE_RESOLUTION; i += 1) {
        const delta = measurementDeltas[i];
        if (delta <= DENSITY_EPSILON) {
            const profile = { density: 0, shares: {} };
            if (momentumEnabled) {
                const snapshotMomentum = {};
                momentumByChannel.forEach((series, name) => {
                    snapshotMomentum[name] = Array.isArray(series) ? series[i] || 0 : 0;
                });
                profile.momentum = snapshotMomentum;
            }
            densityProfiles[i] = profile;
            continue;
        }

        const weightMap = {};
        const sampleMomentum = momentumEnabled ? {} : null;
        let candidateCount = 0;
        active.forEach(({ name }) => {
            const share = shareTable[name][i] || 0;
            const remaining = remainingByChannel[name] || 0;
            let momentumValue = 0;
            if (sampleMomentum) {
                const momentumSeries = momentumByChannel.get(name);
                momentumValue = Array.isArray(momentumSeries) ? momentumSeries[i] || 0 : 0;
                sampleMomentum[name] = momentumValue;
            }
            if (remaining <= DENSITY_EPSILON) {
                return;
            }
            let effectiveShare = share;
            let weightBias = 1;
            if (sampleMomentum) {
                weightBias += momentumValue * MOMENTUM_GAIN;
                if (effectiveShare <= DENSITY_MIN_SHARE) {
                    effectiveShare = Math.max(effectiveShare, momentumValue * MOMENTUM_SHARE_FLOOR);
                }
            }
            if (effectiveShare > DENSITY_MIN_SHARE) {
                const baseWeight = constants.get(name) || 0;
                weightMap[name] = baseWeight * effectiveShare * weightBias;
                if (weightMap[name] > 0 || remaining > DENSITY_EPSILON) {
                    candidateCount += 1;
                }
            }
        });

        if (!candidateCount) {
            const profile = { density: delta, shares: {} };
            if (sampleMomentum) {
                profile.momentum = sampleMomentum;
            }
            densityProfiles[i] = profile;
            continue;
        }

        const preRemainingByChannel = smoothingContext ? {} : null;
        if (preRemainingByChannel) {
            active.forEach(({ name }) => {
                preRemainingByChannel[name] = Number(remainingByChannel[name]) || 0;
            });
        }

        const contributions = {};
        let deltaRemaining = delta;
        let iteration = 0;
        let candidateNames = Object.keys(weightMap);
        if (!candidateNames.length) {
            candidateNames = Object.keys(remainingByChannel).filter((name) => (remainingByChannel[name] || 0) > DENSITY_EPSILON);
        }

        while (deltaRemaining > DENSITY_EPSILON && candidateNames.length && iteration < DENSITY_MAX_ITERATIONS) {
            iteration += 1;
            let totalWeight = 0;
            candidateNames.forEach((name) => {
                totalWeight += weightMap[name] || 0;
            });

            if (totalWeight <= DENSITY_EPSILON) {
                const equalShare = deltaRemaining / candidateNames.length;
                let consumed = 0;
                candidateNames.forEach((name) => {
                    const remaining = remainingByChannel[name] || 0;
                    if (remaining <= DENSITY_EPSILON) return;
                    const amount = Math.min(equalShare, remaining);
                    if (amount > 0) {
                        contributions[name] = (contributions[name] || 0) + amount;
                        remainingByChannel[name] = remaining - amount;
                        consumed += amount;
                    }
                });
                if (consumed <= DENSITY_EPSILON) {
                    break;
                }
                deltaRemaining -= consumed;
            } else {
                let consumed = 0;
                candidateNames.forEach((name) => {
                    const remaining = remainingByChannel[name] || 0;
                    if (remaining <= DENSITY_EPSILON) return;
                    const portion = ((weightMap[name] || 0) / totalWeight) * deltaRemaining;
                    const amount = Math.min(portion, remaining);
                    if (amount > 0) {
                        contributions[name] = (contributions[name] || 0) + amount;
                        remainingByChannel[name] = remaining - amount;
                        consumed += amount;
                    }
                });
                if (consumed <= DENSITY_EPSILON) {
                    break;
                }
                deltaRemaining -= consumed;
            }

            candidateNames = candidateNames.filter((name) => (remainingByChannel[name] || 0) > DENSITY_EPSILON);
        }

        if (deltaRemaining > DENSITY_EPSILON) {
            let fallbackName = null;
            let fallbackValue = 0;
            active.forEach(({ name }) => {
                const remaining = remainingByChannel[name] || 0;
                const share = shareTable[name][i] || 0;
                if (remaining > fallbackValue && share > DENSITY_MIN_SHARE) {
                    fallbackName = name;
                    fallbackValue = remaining;
                }
            });
            if (fallbackName) {
                const amount = Math.min(deltaRemaining, fallbackValue);
                if (amount > 0) {
                    contributions[fallbackName] = (contributions[fallbackName] || 0) + amount;
                    remainingByChannel[fallbackName] = fallbackValue - amount;
                    deltaRemaining -= amount;
                }
            }
        }

        if (smoothingContext && preRemainingByChannel) {
            const saturationMap = smoothingContext.saturationByChannel;
            active.forEach(({ name }) => {
                if (saturationMap.has(name)) {
                    return;
                }
                const before = preRemainingByChannel[name] || 0;
                const after = remainingByChannel[name] || 0;
                if (before > DENSITY_EPSILON && after <= DENSITY_EPSILON) {
                    saturationMap.set(name, i);
                }
            });
        }

        if (smoothingContext) {
            recordSampleForSmoothing(smoothingContext, i, delta, contributions, weightMap);
        }

        const shareEntries = {};
        Object.keys(contributions).forEach((name) => {
            const amount = contributions[name];
            if (amount <= DENSITY_EPSILON) return;
            shareEntries[name] = clamp01(amount / delta);
            cumulativeDensity[name] += amount;
        });

        const profile = {
            density: delta,
            shares: shareEntries
        };
        if (sampleMomentum) {
            profile.momentum = sampleMomentum;
        }
        densityProfiles[i] = profile;
    }

    if (smoothingContext) {
        processRedistributionSmoothingWindows(smoothingContext, densityProfiles);
        recomputeCumulativeDensityFromSamples(smoothingContext, cumulativeDensity);
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && Array.isArray(smoothingContext.debugRows) && smoothingContext.debugRows.length) {
            try {
                console.table(smoothingContext.debugRows.slice(-Math.min(20, smoothingContext.debugRows.length)));
            } catch (error) {
                console.log('[smoothingWindow]', smoothingContext.debugRows.slice(-Math.min(20, smoothingContext.debugRows.length)));
            }
        }
    }

    if (!densityProfiles[0]) {
        const profile = { density: 0, shares: {} };
        if (momentumEnabled) {
            const baseMomentum = {};
            momentumByChannel.forEach((series, name) => {
                baseMomentum[name] = Array.isArray(series) ? series[0] || 0 : 0;
            });
            profile.momentum = baseMomentum;
        }
        densityProfiles[0] = profile;
    } else if (momentumEnabled && !densityProfiles[0].momentum) {
        const baseMomentum = {};
        momentumByChannel.forEach((series, name) => {
            baseMomentum[name] = Array.isArray(series) ? series[0] || 0 : 0;
        });
        densityProfiles[0].momentum = baseMomentum;
    }

    const summaryChannels = channelOrderingList.length
        ? channelOrderingList.map(({ name }) => name)
        : channels;
    const { map: coverageSummaryMap, plain: coverageSummaryPlain } = buildCoverageSummary(summaryChannels, {
        coverageLimits,
        coverageBuffers,
        coverageThresholds: coverageBufferThreshold,
        coverageUsage,
        coverageClampEvents
    });
    const smoothingWindows = smoothingContext ? smoothingContext.windows.slice() : [];
    if (perSampleCeilingEnabled && smoothingContext && smoothingWindows.length === 0) {
        const synthetic = [];
        Object.entries(coverageSummaryPlain || {}).forEach(([channel, entry]) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }
            const clampedSamples = Array.isArray(entry.clampedSamples) ? entry.clampedSamples : [];
            const firstClamp = clampedSamples.find((sample) => Number.isFinite(sample?.index));
            if (!firstClamp) {
                return;
            }
            const clampIndexRaw = Number(firstClamp.index);
            if (!Number.isFinite(clampIndexRaw)) {
                return;
            }
            const clampIndex = Math.trunc(clampIndexRaw);
            const inputValue = Number.isFinite(firstClamp.inputPercent)
                ? firstClamp.inputPercent
                : (clampIndex / DENOM) * 100;
            const windowId = Number.isFinite(smoothingContext.nextWindowId)
                ? smoothingContext.nextWindowId++
                : synthetic.length + 1;
            const syntheticWindow = {
                id: windowId,
                outgoingChannel: channel,
                incomingChannels: [],
                startIndex: clampIndex,
                endIndex: clampIndex,
                inputStart: inputValue,
                inputEnd: inputValue,
                forced: true,
                synthetic: true
            };
            synthetic.push(syntheticWindow);
        });
        if (synthetic.length) {
            smoothingWindows.push(...synthetic);
            if (Array.isArray(smoothingContext.windows)) {
                smoothingContext.windows.push(...synthetic);
            }
        }
    }

    return {
        weights,
        totalWeight,
        solved,
        constants,
        measurementDeltas,
        profiles: densityProfiles,
        cumulativeDensity,
        totalDensity,
        inputs: densityInputs,
        measurementSamples,
        momentumByChannel,
        momentumSummary,
        momentumOptions,
        densitySources,
        coverageSummary: coverageSummaryPlain,
        coverageByChannel: coverageSummaryMap,
        coverageLimits,
        coverageBuffers,
        coverageThresholds: coverageBufferThreshold,
        coverageThresholdsNormalized: coverageBufferThresholdNormalized,
        coverageClampEvents,
        coverageUsage,
        smoothingWindows,
        smoothingConfig: smoothingContext ? { ...smoothingContext.config } : null,
        remainingByChannel: { ...remainingByChannel },
        smoothingContext,
        perSampleCeilingEnabled
    };
}

function prepareCompositeInterpolation() {
    if (!compositeLabSession.active) return null;
    if (compositeLabSession.preparedContext) return compositeLabSession.preparedContext;

    const context = prepareLUTInterpolation(
        compositeLabSession.normalizedEntry,
        compositeLabSession.domainMin,
        compositeLabSession.domainMax,
        compositeLabSession.interpolationType,
        compositeLabSession.smoothingPercent
    );

    compositeLabSession.preparedContext = context;
    return context;
}

function formatSamplePercent(index) {
    const pct = (index / DENOM) * 100;
    return `${pct.toFixed(1).replace(/\\.0$/, '')}%`;
}

export function finalizeCompositeLabRedistribution() {
    if (!compositeLabSession.active) {
        return null;
    }

    const perSampleCeilingEnabled = isCompositePerSampleCeilingEnabled();
    const analysisOnly = compositeLabSession.analysisOnly === true;

    const { channels, endValues, baseCurves } = compositeLabSession;
    const context = prepareCompositeInterpolation();

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE] finalize redistribution', {
            activeChannels: channels?.length || 0,
            perSampleCeilingEnabled,
            smoothingEnabled: isRedistributionSmoothingWindowEnabled(),
            autoCompute: compositeLabSession.autoComputeDensity,
            debugEnabled: isCompositeDebugEnabled()
        });
    }

    if (!context || !channels.length) {
        compositeLabSession.active = false;
        compositeLabSession.preparedContext = null;
        return null;
    }

    const { interpolationFunction, lutDomainMin, domainSpan } = context;
    if (!channels.length) {
        compositeLabSession.active = false;
        compositeLabSession.preparedContext = null;
        return null;
    }

    clearFrontReservePeakMap();

    const correctedCurves = {};
    const baselineSnapshot = {};
    const saturationByChannel = new Map();
    const saturationByIndex = new Map();

    channels.forEach((name) => {
        const source = baseCurves[name];
        if (Array.isArray(source)) {
            correctedCurves[name] = source.slice();
            baselineSnapshot[name] = source.slice(); // Immutable snapshot for reading
        }
    });

    const baselineTotals = new Array(CURVE_RESOLUTION).fill(0);
    let baselineMax = 0;

    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
        let baseTotal = 0;
        channels.forEach((name) => {
            const curve = baselineSnapshot[name];
            if (curve) {
                baseTotal += curve[i];
            }
        });
        baselineTotals[i] = baseTotal;
        if (baseTotal > baselineMax) {
            baselineMax = baseTotal;
        }
    }

    if (baselineMax <= 0) {
        compositeLabSession.active = false;
        compositeLabSession.preparedContext = null;
        return null;
    }

    const weightingMode = compositeLabSession.weightingMode || COMPOSITE_WEIGHTING_MODES.NORMALIZED;

    const densityWeightsInfo = computeCompositeDensityWeights(
        channels,
        baselineSnapshot,  // Use snapshot for weight computation
        endValues,
        compositeLabSession.normalizedEntry,
        {
            weightingMode,
            smoothingPercent: compositeLabSession.smoothingPercent,
            manualDensityOverrides: compositeLabSession.densityOverrides,
            autoComputeEnabled: compositeLabSession.autoComputeDensity
        }
    );
    const smoothingContext = densityWeightsInfo.smoothingContext || null;
    const densityWeights = densityWeightsInfo.weights;
    compositeLabSession.densityWeights = densityWeights;
    const solverConstantsMap = densityWeightsInfo.constants instanceof Map
        ? densityWeightsInfo.constants
        : new Map(densityWeightsInfo.constants ? Object.entries(densityWeightsInfo.constants) : []);
    compositeLabSession.densityConstants = solverConstantsMap instanceof Map
        ? new Map(solverConstantsMap)
        : solverConstantsMap;
    if (typeof globalThis !== 'undefined') {
        try {
            delete globalThis.__solverConstantsEntries;
            delete globalThis.__solverConstantsMap;
        } catch (error) {
            // ignore
        }
    }
    compositeLabSession.densityProfiles = Array.isArray(densityWeightsInfo.profiles)
        ? densityWeightsInfo.profiles
        : [];
    compositeLabSession.densityCumulative = densityWeightsInfo.cumulativeDensity || {};
    compositeLabSession.measurementDeltas = Array.isArray(densityWeightsInfo.measurementDeltas)
        ? densityWeightsInfo.measurementDeltas
        : [];
    compositeLabSession.densityInputs = Array.isArray(densityWeightsInfo.inputs)
        ? densityWeightsInfo.inputs
        : [];
    compositeLabSession.measurementSamples = Array.isArray(densityWeightsInfo.measurementSamples)
        ? densityWeightsInfo.measurementSamples
        : [];
    compositeLabSession.momentumByChannel = densityWeightsInfo.momentumByChannel instanceof Map
        ? densityWeightsInfo.momentumByChannel
        : new Map(densityWeightsInfo.momentumByChannel ? Object.entries(densityWeightsInfo.momentumByChannel) : []);
    compositeLabSession.momentumSummary = densityWeightsInfo.momentumSummary || {};
    compositeLabSession.momentumOptions = densityWeightsInfo.momentumOptions || null;
    compositeLabSession.densitySources = densityWeightsInfo.densitySources instanceof Map
        ? densityWeightsInfo.densitySources
        : new Map(densityWeightsInfo.densitySources ? Object.entries(densityWeightsInfo.densitySources) : []);
    compositeLabSession.densityCoverage = densityWeightsInfo.coverageByChannel instanceof Map
        ? densityWeightsInfo.coverageByChannel
        : new Map(
            Object.entries(densityWeightsInfo.coverageByChannel || {}).map(([channel, summary]) => [
                channel,
                summary && typeof summary === 'object'
                    ? { ...summary }
                    : { limit: 0, buffer: 0, bufferedLimit: 0, maxNormalized: 0, overflow: 0, overflowNormalized: 0, clampedSamples: [] }
            ])
        );
    compositeLabSession.densityCoverageSummary = {};
    compositeLabSession.densityCoverageLimits = densityWeightsInfo.coverageLimits instanceof Map
        ? densityWeightsInfo.coverageLimits
        : new Map(Object.entries(densityWeightsInfo.coverageLimits || {}));
    compositeLabSession.densityCoverageBuffers = densityWeightsInfo.coverageBuffers instanceof Map
        ? densityWeightsInfo.coverageBuffers
        : new Map(Object.entries(densityWeightsInfo.coverageBuffers || {}));
    compositeLabSession.densityCoverageThresholds = densityWeightsInfo.coverageThresholds instanceof Map
        ? densityWeightsInfo.coverageThresholds
        : new Map(Object.entries(densityWeightsInfo.coverageThresholds || {}));
    compositeLabSession.densityCoverageThresholdsNormalized = densityWeightsInfo.coverageThresholdsNormalized instanceof Map
        ? densityWeightsInfo.coverageThresholdsNormalized
        : new Map(
            Object.entries(densityWeightsInfo.coverageThresholdsNormalized || {}).map(([channel, value]) => [
                channel,
                Number.isFinite(value) ? Number(value) : value
            ])
        );
    compositeLabSession.densityCoverageUsage = densityWeightsInfo.coverageUsage instanceof Map
        ? densityWeightsInfo.coverageUsage
        : new Map(Object.entries(densityWeightsInfo.coverageUsage || {}));
    compositeLabSession.densityCoverageClampEvents = densityWeightsInfo.coverageClampEvents instanceof Map
        ? densityWeightsInfo.coverageClampEvents
        : new Map(Object.entries(densityWeightsInfo.coverageClampEvents || {}).map(([channel, events]) => [
            channel,
            Array.isArray(events) ? events.slice() : []
        ]));
    compositeLabSession.perSampleCeilingEnabled = perSampleCeilingEnabled;

    const coverageLimits = compositeLabSession.densityCoverageLimits instanceof Map
        ? compositeLabSession.densityCoverageLimits
        : new Map();
    const coverageBuffers = compositeLabSession.densityCoverageBuffers instanceof Map
        ? compositeLabSession.densityCoverageBuffers
        : new Map();
    const coverageUsage = compositeLabSession.densityCoverageUsage instanceof Map
        ? compositeLabSession.densityCoverageUsage
        : new Map();
    const coverageClampEvents = compositeLabSession.densityCoverageClampEvents instanceof Map
        ? compositeLabSession.densityCoverageClampEvents
        : new Map();
    const coverageBufferThreshold = compositeLabSession.densityCoverageThresholds instanceof Map
        ? compositeLabSession.densityCoverageThresholds
        : new Map();
    const coverageBufferThresholdNormalized = compositeLabSession.densityCoverageThresholdsNormalized instanceof Map
        ? compositeLabSession.densityCoverageThresholdsNormalized
        : new Map();
    const remainingByChannel = Object.assign(
        Object.create(null),
        densityWeightsInfo.remainingByChannel && typeof densityWeightsInfo.remainingByChannel === 'object'
            ? densityWeightsInfo.remainingByChannel
            : {}
    );
    compositeLabSession.smoothingWindows = Array.isArray(densityWeightsInfo.smoothingWindows)
        ? densityWeightsInfo.smoothingWindows.slice()
        : [];
    compositeLabSession.smoothingConfig = densityWeightsInfo.smoothingConfig
        ? { ...densityWeightsInfo.smoothingConfig }
        : null;

    if (analysisOnly) {
        const coverageSummaryPlain = cloneCoverageSummary(densityWeightsInfo.coverageSummary || {});
        compositeLabSession.densityCoverageSummary = coverageSummaryPlain;
        const summaryWarnings = Array.isArray(densityWeightsInfo.warnings)
            ? densityWeightsInfo.warnings.slice()
            : [];

            const maxima = {};
            if (Array.isArray(channels)) {
                channels.forEach((name) => {
                    const raw = Number(endValues?.[name]);
                    maxima[name] = Number.isFinite(raw) ? raw : 0;
                });
            }
            const densityWeightsPlain = mapToPlainObject(densityWeights);
            const densityConstantsPlain = mapToPlainObject(compositeLabSession.densityConstants);
            const densitySourcesPlain = mapToPlainObject(compositeLabSession.densitySources);
            const cumulativeDensityPlain = mapToPlainObject(compositeLabSession.densityCumulative);
            const momentumSummaryPlain = compositeLabSession.momentumSummary
                ? { ...compositeLabSession.momentumSummary }
                : null;
            const debugSnapshots = new Array(CURVE_RESOLUTION).fill(null);
            const measurementSamples = compositeLabSession.measurementSamples || [];
            const measurementDeltas = compositeLabSession.measurementDeltas || [];
            const densityInputs = compositeLabSession.densityInputs || [];

            for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
                const baselineInk = baselineTotals[i] || 0;
                const perChannelDebug = {};
                channels.forEach((name) => {
                    const curve = baselineSnapshot[name] || [];
                    const baselineValue = Number(curve[i]) || 0;
                    const endValue = Math.max(0, Number(endValues[name]) || 0);
                    const normalized = endValue > 0 ? clamp01(baselineValue / endValue) : 0;
                    const weight = densityWeights.get(name) || 0;
                    const share = baselineInk > 0 ? baselineValue / baselineInk : 0;
                    const thresholdNormalized = Number(coverageBufferThresholdNormalized.get(name));
                    const headroom = Number.isFinite(thresholdNormalized)
                        ? Math.max(0, thresholdNormalized - normalized)
                        : (endValue > 0 ? Math.max(0, 1 - normalized) : 0);
                    const endNormalized = endValue > 0 ? Math.max(0, Math.min(1, endValue / TOTAL)) : 0;
                    const usageValue = normalized * endNormalized;
                    const recordedUsage = coverageUsage.get(name) || 0;
                    if (usageValue > recordedUsage) {
                        coverageUsage.set(name, usageValue);
                    }
                    const densityContribution = weight * normalized;
                    perChannelDebug[name] = {
                        baselineValue,
                        correctedValue: baselineValue,
                        valueDelta: 0,
                        normalizedBefore: normalized,
                        normalizedAfter: normalized,
                        normalizedDelta: 0,
                        weight,
                        shareBefore: share,
                        shareAfter: share,
                        weightingShare: share,
                        densityShareBefore: share,
                        densityShareAfter: share,
                        headroomBefore: headroom,
                        headroomAfter: headroom,
                        densityContributionBefore: densityContribution,
                        densityContributionAfter: densityContribution,
                        densityContributionDelta: 0,
                        momentum: 0
                    };
                });
                const measurementDensity = Array.isArray(measurementSamples)
                    ? measurementSamples[i] ?? null
                    : null;
                debugSnapshots[i] = {
                    index: i,
                    inputPercent: (i / DENOM) * 100,
                    targetDensity: measurementDensity,
                    measurementDensity,
                    deltaDensity: 0,
                    baselineInk,
                    correctedInk: baselineInk,
                    inkDelta: 0,
                    perChannel: perChannelDebug,
                    weightingMode
                };
            }

            const summaryPayload = {
                channelNames: Array.isArray(channels) ? channels.slice() : [],
                channelMaxima: maxima,
                densityWeights: densityWeightsPlain,
                densityConstants: densityConstantsPlain,
                cumulativeDensity: cumulativeDensityPlain,
                totalDensity: Number.isFinite(densityWeightsInfo.totalDensity) ? densityWeightsInfo.totalDensity : null,
                measurementSamples: Array.isArray(measurementSamples) ? measurementSamples.slice() : null,
                measurementDeltas: Array.isArray(measurementDeltas) ? measurementDeltas.slice() : null,
                densityInputs: Array.isArray(densityInputs) ? densityInputs.slice() : null,
                densitySources: densitySourcesPlain,
                densityLadder: densityLadder.slice(),
                ladderOrderIndex: { ...ladderIndicesPlain },
                warnings: summaryWarnings.slice(),
                peakIndices: null,
                weightingMode,
                momentumPeaks: momentumSummaryPlain,
                momentumWindow: compositeLabSession.momentumOptions?.windowRadius ?? null,
                momentumSigma: compositeLabSession.momentumOptions?.sigma ?? null,
                coverageSummary: cloneCoverageSummary(coverageSummaryPlain),
                coverageLimits: mapToPlainObject(coverageLimits),
                coverageBuffers: mapToPlainObject(coverageBuffers),
                smoothingWindows: [],
                smoothingConfig: null
            };
            const sessionPayload = {
                summary: summaryPayload,
                snapshots: debugSnapshots,
                selectionIndex: null
            };
            compositeLabSession.lastDebugSession = sessionPayload;
            storeCompositeDebugSession(sessionPayload);
            if (typeof globalScope === 'object' && globalScope) {
                globalScope.__COMPOSITE_DEBUG_CACHE__ = sessionPayload;
            }

        compositeLabSession.warnings = summaryWarnings;
        compositeLabSession.peakIndices = {};
        compositeLabSession.active = false;
        compositeLabSession.preparedContext = null;
        compositeLabSession.analysisOnly = false;

        if (LinearizationState && typeof LinearizationState === 'object') {
            if (typeof LinearizationState.setGlobalBaselineCurves === 'function') {
                LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
            }
            if (typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
                LinearizationState.setGlobalCorrectedCurves(correctedCurves);
            }
            if (typeof LinearizationState.setGlobalWarnings === 'function') {
                LinearizationState.setGlobalWarnings(summaryWarnings);
            }
            if (typeof LinearizationState.setCompositeCoverageSummary === 'function') {
                LinearizationState.setCompositeCoverageSummary(coverageSummaryPlain);
            }
        }

        return {
            curves: correctedCurves,
            warnings: summaryWarnings,
            peakIndices: {},
            weights: densityWeights instanceof Map
                ? Array.from(densityWeights.entries())
                : [],
            measurementSamples: Array.isArray(compositeLabSession.measurementSamples)
                ? compositeLabSession.measurementSamples.slice()
                : []
        };
    }

    const debugEnabled = isCompositeDebugEnabled();
    const captureDebug = true;
    let debugSnapshots = captureDebug ? new Array(CURVE_RESOLUTION).fill(null) : null;
    let debugSummary = null;
    let debugSelectionIndex = null;
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[COMPOSITE] debug capture state', { captureDebug, debugEnabled });
    }
    if (captureDebug) {
        const maxima = {};
        if (Array.isArray(channels)) {
            channels.forEach((name) => {
                const raw = Number(endValues?.[name]);
                maxima[name] = Number.isFinite(raw) ? raw : 0;
            });
        }
        debugSummary = {
            channelNames: Array.isArray(channels) ? channels.slice() : [],
            channelMaxima: maxima,
            densityWeights: mapToPlainObject(densityWeights),
            densityConstants: mapToPlainObject(compositeLabSession.densityConstants),
            cumulativeDensity: mapToPlainObject(compositeLabSession.densityCumulative),
            totalDensity: Number.isFinite(densityWeightsInfo.totalDensity) ? densityWeightsInfo.totalDensity : null,
            measurementSamples: Array.isArray(compositeLabSession.measurementSamples) ? compositeLabSession.measurementSamples.slice() : null,
            measurementDeltas: Array.isArray(compositeLabSession.measurementDeltas) ? compositeLabSession.measurementDeltas.slice() : null,
            densityInputs: Array.isArray(compositeLabSession.densityInputs) ? compositeLabSession.densityInputs.slice() : null,
            densitySources: mapToPlainObject(compositeLabSession.densitySources),
            warnings: [],
            peakIndices: null,
            weightingMode,
            momentumPeaks: compositeLabSession.momentumSummary ? { ...compositeLabSession.momentumSummary } : null,
            momentumWindow: compositeLabSession.momentumOptions?.windowRadius ?? null,
            momentumSigma: compositeLabSession.momentumOptions?.sigma ?? null,
            coverageSummary: cloneCoverageSummary(densityWeightsInfo.coverageSummary || {}),
            coverageLimits: mapToPlainObject(densityWeightsInfo.coverageLimits),
            coverageBuffers: mapToPlainObject(densityWeightsInfo.coverageBuffers),
            coverageClampEvents: (() => {
                if (!(densityWeightsInfo.coverageClampEvents instanceof Map)) {
                    return {};
                }
                const out = {};
                densityWeightsInfo.coverageClampEvents.forEach((events, channel) => {
                    out[channel] = Array.isArray(events)
                        ? events.map((entry) => ({ ...entry }))
                        : [];
                });
                return out;
            })(),
            perSampleCeilingEnabled,
            smoothingWindows: Array.isArray(compositeLabSession.smoothingWindows)
                ? compositeLabSession.smoothingWindows.map((entry) => (
                    entry ? {
                        id: entry.id ?? null,
                        outgoingChannel: entry.outgoingChannel ?? null,
                        incomingChannels: Array.isArray(entry.incomingChannels) ? entry.incomingChannels.slice() : [],
                        startIndex: entry.startIndex ?? null,
                        endIndex: entry.endIndex ?? null,
                        inputStart: entry.inputStart ?? null,
                        inputEnd: entry.inputEnd ?? null
                    } : null
                )).filter(Boolean)
                : [],
            smoothingConfig: compositeLabSession.smoothingConfig ? { ...compositeLabSession.smoothingConfig } : null
        };
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[COMPOSITE] debug summary seeded', {
                channelCount: debugSummary.channelNames.length,
                smoothingWindowCount: debugSummary.smoothingWindows.length
            });
        }
    }

    const normalizedBaselineByChannel = new Map();
    channels.forEach((name) => {
        const baselineCurve = baselineSnapshot[name];
        const endValue = Math.max(0, Number(endValues[name]) || 0);
        if (!Array.isArray(baselineCurve) || endValue <= 0) {
            normalizedBaselineByChannel.set(name, new Array(CURVE_RESOLUTION).fill(0));
            return;
        }
        const normalized = baselineCurve.map((value) => clamp01((Number(value) || 0) / endValue));
        normalizedBaselineByChannel.set(name, normalized);
    });

    const dominantOwners = new Array(CURVE_RESOLUTION);
    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
        let bestName = null;
        let bestValue = 0;
        channels.forEach((name) => {
            const normalized = normalizedBaselineByChannel.get(name)?.[i] || 0;
            if (normalized > bestValue + DENSITY_EPSILON) {
                bestValue = normalized;
                bestName = name;
            }
        });
        dominantOwners[i] = bestValue > DENSITY_EPSILON ? bestName : null;
    }

    const channelRegions = new Map();
    let currentOwner = dominantOwners[0];
    let segmentStart = 0;
    for (let i = 1; i < CURVE_RESOLUTION; i += 1) {
        const owner = dominantOwners[i];
        if (owner !== currentOwner) {
            if (currentOwner) {
                const regions = channelRegions.get(currentOwner) || [];
                regions.push({ start: segmentStart, end: i - 1 });
                channelRegions.set(currentOwner, regions);
            }
            currentOwner = owner;
            segmentStart = i;
        }
    }
    if (currentOwner) {
        const regions = channelRegions.get(currentOwner) || [];
        regions.push({ start: segmentStart, end: CURVE_RESOLUTION - 1 });
        channelRegions.set(currentOwner, regions);
    }

    const preferredRegionByChannel = new Map();
    channelRegions.forEach((regions, name) => {
        if (!Array.isArray(regions) || regions.length === 0) return;
        let bestRegion = regions[0];
        for (let idx = 1; idx < regions.length; idx += 1) {
            const region = regions[idx];
            if (region.start < bestRegion.start) {
                bestRegion = region;
            } else if (region.start === bestRegion.start) {
                const bestLength = bestRegion.end - bestRegion.start;
                const length = region.end - region.start;
                if (length > bestLength) {
                    bestRegion = region;
                }
            }
        }
        const normalized = normalizedBaselineByChannel.get(name) || [];
        const startIndex = bestRegion.start;
        const endIndex = bestRegion.end;
        let peakIndex = startIndex;
        let peakValue = normalized[startIndex] || 0;
        for (let idx = startIndex + 1; idx <= endIndex; idx += 1) {
            const value = normalized[idx] || 0;
            if (value > peakValue + DENSITY_EPSILON) {
                peakValue = value;
                peakIndex = idx;
            } else if (value + DENSITY_EPSILON < peakValue) {
                break;
            }
        }
        const primaryEnd = peakIndex;
        const effectiveStart = Math.max(0, startIndex - REGION_BLEND_MARGIN);
        const effectiveEnd = Math.min(DENOM, primaryEnd + REGION_BLEND_MARGIN);
        preferredRegionByChannel.set(name, {
            start: startIndex,
            end: endIndex,
            primaryEnd,
            effectiveStart,
            effectiveEnd
        });
    });

    const totalNormalizedByChannel = new Map();
    normalizedBaselineByChannel.forEach((normalized, name) => {
        const sum = Array.isArray(normalized)
            ? normalized.reduce((acc, value) => acc + (Number(value) || 0), 0)
            : 0;
        totalNormalizedByChannel.set(name, sum);
    });

    const channelsByDensity = channels.slice().sort((a, b) => {
        const totalA = totalNormalizedByChannel.get(a) || 0;
        const totalB = totalNormalizedByChannel.get(b) || 0;
        return totalB - totalA;
    });

    const getDensityWeight = (name) => {
        if (densityWeights instanceof Map) {
            return Number(densityWeights.get(name));
        }
        if (densityWeights && typeof densityWeights === 'object') {
            return Number(densityWeights[name]);
        }
        return Number.NaN;
    };

    const densityLadder = channels.slice().sort((a, b) => {
        const weightA = getDensityWeight(a);
        const weightB = getDensityWeight(b);
        const validWeightA = Number.isFinite(weightA) ? weightA : Number.POSITIVE_INFINITY;
        const validWeightB = Number.isFinite(weightB) ? weightB : Number.POSITIVE_INFINITY;
        if (Math.abs(validWeightA - validWeightB) > DENSITY_EPSILON) {
            return validWeightA - validWeightB;
        }
        const totalA = totalNormalizedByChannel.get(a) || 0;
        const totalB = totalNormalizedByChannel.get(b) || 0;
        return totalA - totalB;
    });
    const ladderIndexByChannel = new Map();
    densityLadder.forEach((name, idx) => {
        ladderIndexByChannel.set(name, idx);
    });
    const ladderIndicesPlain = {};
    ladderIndexByChannel.forEach((idx, name) => {
        ladderIndicesPlain[name] = idx;
    });
    compositeLabSession.densityLadder = densityLadder.slice();
    compositeLabSession.densityLadderIndex = new Map(ladderIndexByChannel);

    const orderIndexByChannel = new Map();
    channelsByDensity.forEach((name, idx) => {
        orderIndexByChannel.set(name, idx);
    });

    const peakCompleted = new Map();
    channels.forEach((name) => {
        peakCompleted.set(name, false);
    });

    const peakStateByChannel = new Map();
    channels.forEach((name) => {
        peakStateByChannel.set(name, {
            maxNormalized: 0,
            maxValue: 0,
            peakIndex: 0,
            locked: false
        });
    });

    const computeRegionMultiplier = (channelName, sampleIndex) => {
        const region = preferredRegionByChannel.get(channelName);
        if (!region) {
            return 0;
        }
        const { start, primaryEnd, effectiveStart, effectiveEnd } = region;
        const primaryMultiplier = 1 + REGION_PRIMARY_BIAS;
        if (sampleIndex < effectiveStart || sampleIndex > effectiveEnd) {
            return 0;
        }
        if (sampleIndex >= start && sampleIndex <= primaryEnd) {
            return primaryMultiplier;
        }
        if (sampleIndex < start) {
            const distance = start - sampleIndex;
            const t = 1 - (distance / (REGION_BLEND_MARGIN + 1));
            const clampedT = Math.max(0, Math.min(1, t));
            return REGION_SECONDARY_SCALE + (primaryMultiplier - REGION_SECONDARY_SCALE) * clampedT;
        }
        const distance = sampleIndex - primaryEnd;
        const t = 1 - (distance / (REGION_BLEND_MARGIN + 1));
        const clampedT = Math.max(0, Math.min(1, t));
        return REGION_SECONDARY_SCALE * clampedT;
    };

    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
        const correctedTotal = channels.reduce((sum, name) => {
            const curve = correctedCurves[name];
            if (!Array.isArray(curve)) return sum;
            const value = Number(curve[i]) || 0;
            return value > 0 ? sum + value : sum;
        }, 0);

        if (correctedTotal <= 0) {
            continue;
        }

        const densityProfile = Array.isArray(compositeLabSession.densityProfiles)
            ? compositeLabSession.densityProfiles[i]
            : null;
        const densityShareMap = densityProfile && densityProfile.shares ? densityProfile.shares : null;
        const momentumProfile = densityProfile && densityProfile.momentum ? densityProfile.momentum : null;

        const channelInfo = new Map();
        const weightMap = {};

        channels.forEach((name) => {
            const correctedCurve = correctedCurves[name];
            const baselineCurve = baselineSnapshot[name];
            if (!correctedCurve || !baselineCurve) return;

            const endValue = Math.max(0, Number(endValues[name]) || 0);
            if (endValue <= 0) return;

            const correctedValue = Array.isArray(correctedCurve) ? Math.max(0, Number(correctedCurve[i]) || 0) : 0;
            const baselineValue = Array.isArray(baselineCurve) ? Math.max(0, Number(baselineCurve[i]) || 0) : 0;
            const baselineNormalized = endValue > 0 ? clamp01(baselineValue / endValue) : 0;
            const baselineContribution = (densityWeights.get(name) || 0) * baselineNormalized;
            const baselineTotal = baselineTotals[i] || 0;
            const baselineShare = baselineTotal > 0 ? baselineValue / baselineTotal : 0;
            const current = correctedValue;
            const headroom = Math.max(0, endValue - current);
            const weight = densityWeights.get(name) || 0;
            const normalized = endValue > 0 ? clamp01(current / endValue) : 0;
            const headroomNormalized = endValue > 0 ? headroom / endValue : 0;
            const channelMomentum = momentumProfile && Number.isFinite(momentumProfile[name])
                ? Math.max(0, momentumProfile[name])
                : 0;

            const densityWeight = Math.max(DENSITY_EPSILON, weight || densityWeights.get(name) || 0);
            const thresholdAbsoluteRaw = coverageBufferThreshold.get(name);
            const coverageLimit = coverageLimits.get(name);
            const densityLimit = Number.isFinite(thresholdAbsoluteRaw)
                ? Math.max(0, thresholdAbsoluteRaw)
                : null;

            const info = {
                curve: correctedCurve,
                endValue,
                endNormalized: endValue > 0 ? Math.max(0, Math.min(1, endValue / TOTAL)) : 0,
                current,
                headroom,
                headroomNormalized,
                normalized,
                weight,
                baselineValue,
                baselineNormalized,
                baselineContribution,
                baselineShare,
                share: correctedTotal > 0 ? Math.max(0, current) / correctedTotal : 0,
                densityShare: 0,
                regionShareOverride: false,
                momentum: channelMomentum,
                densityWeight,
                densityLimit,
                coverageLimit: Number.isFinite(coverageLimit) ? coverageLimit : null,
                coverageFloorNormalized: 0,
                layerNormalized: 0,
                allowedNormalized: null,
                reserveReleaseScale: 1,
                reserveReleaseHeadroom: headroomNormalized,
                capacityBeforeNormalized: 0,
                capacityAfterNormalized: 0,
                blendCapNormalized: Number.POSITIVE_INFINITY,
                blendAppliedNormalized: 0,
                blendWindow: 0,
                blendProgress: 0,
                shadowBlendCapNormalized: Number.POSITIVE_INFINITY,
                shadowBlendAppliedNormalized: 0,
                shadowBlendWindow: 0,
                shadowBlendProgress: 0,
                shadowBlendFromChannel: null,
                reserveState: 'approaching',
                reserveAllowanceNormalized: 0,
                reserveAllowanceRemaining: 0
            };

            channelInfo.set(name, info);
            weightMap[name] = weight;
        });

        const descendingLadder = densityLadder.slice().reverse();
        let cumulativeNormalizedStack = 0;

        descendingLadder.forEach((name) => {
            const info = channelInfo.get(name);
            if (!info) {
                return;
            }

            const densityWeight = info.densityWeight;
            const densityLimit = info.densityLimit;
            const coverageLimit = info.coverageLimit;
            const curve = info.curve;
            const floorNormalized = Math.max(info.baselineNormalized, cumulativeNormalizedStack);
            info.coverageFloorNormalized = floorNormalized;

            let allowedNormalized = 1;
            if (densityLimit != null && densityWeight > DENSITY_EPSILON) {
                const maxAdditionNormalized = Math.max(0, densityLimit / densityWeight);
                allowedNormalized = Math.min(1, floorNormalized + maxAdditionNormalized);
            }
            info.allowedNormalized = allowedNormalized;

            const previousNormalized = info.normalized;
            if (previousNormalized > allowedNormalized + DENSITY_EPSILON) {
                const clampedNormalized = allowedNormalized;
                const clampedValue = Math.round(clampedNormalized * info.endValue);
                curve[i] = clampedValue;
                info.current = clampedValue;
                info.normalized = clampedNormalized;
                info.headroom = Math.max(0, info.endValue - clampedValue);
                info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;

                const overflowNormalized = previousNormalized - clampedNormalized;
                if (overflowNormalized > DENSITY_EPSILON) {
                    const clampList = coverageClampEvents.get(name) || [];
                    clampList.push({
                        index: i,
                        inputPercent: (i / DENOM) * 100,
                        normalizedBefore: previousNormalized,
                        normalizedAfter: info.normalized,
                        desiredNormalizedAfter: clampedNormalized,
                        overflowNormalized,
                        bufferedLimit: densityLimit,
                        limit: coverageLimit,
                        truncatedByThreshold: true,
                        truncatedByEnd: false,
                        floorNormalized
                    });
                    coverageClampEvents.set(name, clampList);
                }
            }

            const layerNormalized = Math.max(0, info.normalized - floorNormalized);
            info.layerNormalized = layerNormalized;
            if (densityLimit != null && info.allowedNormalized != null) {
                info.headroomNormalized = Math.max(0, info.allowedNormalized - info.normalized);
            } else {
                info.headroomNormalized = info.endValue > 0
                    ? Math.max(0, info.endValue - info.current) / info.endValue
                    : 0;
            }
            info.effectiveHeadroomNormalized = computeEffectiveHeadroom(info);

            const coverageCapacityNormalized = info.allowedNormalized != null
                ? Math.max(0, info.allowedNormalized - info.normalized)
                : Number.POSITIVE_INFINITY;
            const endCapacityNormalized = Number.isFinite(info.headroomNormalized)
                ? Math.max(0, info.headroomNormalized)
                : Number.POSITIVE_INFINITY;
            const effectiveCapacityNormalized = Number.isFinite(info.effectiveHeadroomNormalized)
                ? Math.max(0, info.effectiveHeadroomNormalized)
                : Number.POSITIVE_INFINITY;
            info.capacityBeforeNormalized = computeAvailableCapacityNormalized(info, {
                coverageCapacity: coverageCapacityNormalized,
                effectiveHeadroom: effectiveCapacityNormalized,
                endCapacity: endCapacityNormalized
            });
            info.capacityAfterNormalized = info.capacityBeforeNormalized;

            if (densityLimit != null) {
                const layerDensity = layerNormalized * densityWeight;
                coverageUsage.set(name, info.normalized);
                remainingByChannel[name] = Math.max(0, densityLimit - layerDensity);
                coverageBufferThresholdNormalized.set(name, info.allowedNormalized ?? info.normalized);
            } else {
                coverageUsage.set(name, info.normalized);
                coverageBufferThresholdNormalized.set(name, 1);
                if (perSampleCeilingEnabled) {
                    remainingByChannel[name] = Math.max(0, densityWeight * (info.effectiveHeadroomNormalized ?? info.headroomNormalized));
                }
            }

            cumulativeNormalizedStack = Math.max(cumulativeNormalizedStack, info.normalized);
        });

        if (weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
            const reservePeakMap = ensureFrontReservePeakMap();
            let darkerHeadroomTotal = 0;
            for (let idx = densityLadder.length - 1; idx >= 0; idx -= 1) {
                const name = densityLadder[idx];
                const info = channelInfo.get(name);
                if (!info) {
                    continue;
                }
                const normalized = Number.isFinite(info.normalized) ? info.normalized : 0;
                const allowed = Number.isFinite(info.allowedNormalized) ? info.allowedNormalized : normalized;
                const headroomNormalized = Math.max(0, allowed - normalized);
                const previousState = reservePeakMap.get(name);
                const previousPeak = Number.isFinite(previousState?.peak)
                    ? Math.max(0, previousState.peak)
                    : 0;
                const previousBase = Number.isFinite(previousState?.base)
                    ? Math.max(0, previousState.base)
                    : 0;

                info.frontReserveBase = 0;
                info.frontReserveDarkerHeadroom = darkerHeadroomTotal;
                info.frontReserveApplied = 0;

                let peakValue = 0;
                let baseValue = 0;
                if (darkerHeadroomTotal > DENSITY_EPSILON && headroomNormalized > DENSITY_EPSILON) {
                    const candidateBase = Math.min(headroomNormalized, FRONT_RESERVE_MAX_NORMALIZED);
                    peakValue = Math.min(
                        FRONT_RESERVE_MAX_NORMALIZED,
                        Math.max(previousPeak, candidateBase)
                    );
                    if (!Number.isFinite(previousBase) || previousBase <= DENSITY_EPSILON || candidateBase >= previousBase) {
                        baseValue = candidateBase;
                    } else {
                        baseValue = Math.max(
                            candidateBase,
                            previousBase * FRONT_RESERVE_DECAY_FACTOR
                        );
                    }
                } else if (headroomNormalized > DENSITY_EPSILON) {
                    const clamped = Math.min(headroomNormalized, FRONT_RESERVE_MAX_NORMALIZED);
                    peakValue = clamped;
                    baseValue = clamped;
                } else {
                    peakValue = 0;
                    baseValue = 0;
                }

                info.frontReservePeak = peakValue;
                info.frontReserveBase = baseValue;

                reservePeakMap.set(name, {
                    peak: peakValue,
                    base: baseValue
                });
                darkerHeadroomTotal += headroomNormalized;
                info.effectiveHeadroomNormalized = computeEffectiveHeadroom(info);

                const reserveMeta = computeReserveMeta(info);
                info.reserveState = reserveMeta.state;
                info.reserveAllowanceNormalized = reserveMeta.allowance;
                info.reserveAllowanceRemaining = reserveMeta.allowance;

                if (reserveMeta.allowance > DENSITY_EPSILON) {
                    info.effectiveHeadroomNormalized = Math.max(
                        0,
                        (info.effectiveHeadroomNormalized || 0) + reserveMeta.allowance
                    );
                }
            }
        } else {
            clearFrontReservePeakMap();
            channelInfo.forEach((info) => {
                info.frontReserveBase = 0;
                info.frontReservePeak = 0;
                info.frontReserveDarkerHeadroom = 0;
                info.frontReserveApplied = 0;
                info.effectiveHeadroomNormalized = computeEffectiveHeadroom(info);
                info.reserveState = 'approaching';
                info.reserveAllowanceNormalized = 0;
                info.reserveAllowanceRemaining = 0;
            });
        }

        channelInfo.forEach((info) => {
            const preferredShare = weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED
                ? (info.baselineShare > DENSITY_EPSILON ? info.baselineShare : info.share)
                : info.share;
            info.weightingShare = preferredShare;
        });

        let baselineInkTotal = 0;
        if (captureDebug && debugSnapshots) {
            channelInfo.forEach((info) => {
                baselineInkTotal += info.baselineValue || 0;
            });
        }

        const highlightGuardEnabled = isCompositeHighlightGuardEnabled();
        let activeOrderIndex = channelsByDensity.findIndex((name) => !peakCompleted.get(name));
        if (activeOrderIndex === -1) {
            activeOrderIndex = channelsByDensity.length - 1;
        }

        const getPreferredShare = (info) => {
            const value = info?.weightingShare;
            if (Number.isFinite(value) && value > DENSITY_EPSILON) {
                return value;
            }
            const fallback = info?.share;
            return Number.isFinite(fallback) && fallback > DENSITY_EPSILON ? fallback : 0;
        };

        const useEqualWeighting = weightingMode === COMPOSITE_WEIGHTING_MODES.EQUAL;

        const shareInputs = new Map();
        if (densityShareMap) {
            channelInfo.forEach((info, name) => {
                let shareWeight = typeof densityShareMap[name] === 'number'
                    ? clamp01(densityShareMap[name])
                    : 0;
                const fallbackShare = info.share || 0;
                const useHighlightFallback = highlightGuardEnabled &&
                    info.normalized <= HIGHLIGHT_DENSITY_NORMALIZED_THRESHOLD;
                const preferredShare = getPreferredShare(info);
                if (useHighlightFallback) {
                    shareWeight = fallbackShare > 0 ? fallbackShare : preferredShare;
                } else if (shareWeight <= DENSITY_EPSILON) {
                    shareWeight = preferredShare > DENSITY_EPSILON ? preferredShare : fallbackShare;
                }
                shareInputs.set(name, shareWeight);
            });
        } else {
            channelInfo.forEach((info, name) => {
                shareInputs.set(name, getPreferredShare(info));
            });
        }

        const candidateNames = [];
        const channelShareState = new Map();

        channelInfo.forEach((info, name) => {
            const baselineNormalized = normalizedBaselineByChannel.get(name)?.[i] || 0;
            let multiplier = weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED
                ? 1
                : computeRegionMultiplier(name, i);
            const orderIndex = orderIndexByChannel.get(name);
            const peakLocked = peakCompleted.get(name);
            info.lockPositive = !!peakLocked;
            if (useEqualWeighting && multiplier <= DENSITY_EPSILON) {
                const hasBaselinePresence = baselineNormalized > DENSITY_EPSILON;
                const hasHeadroom = info.headroomNormalized > DENSITY_EPSILON;
                if (hasBaselinePresence && hasHeadroom && !peakLocked) {
                    multiplier = 1;
                }
            }

            if (weightingMode !== COMPOSITE_WEIGHTING_MODES.NORMALIZED && !peakLocked && orderIndex != null) {
                if (orderIndex < activeOrderIndex) {
                    multiplier = 0;
                } else if (orderIndex === activeOrderIndex) {
                    // keep multiplier as-is
                } else if (orderIndex === activeOrderIndex + 1 && multiplier > REGION_SECONDARY_SCALE) {
                    // allow transitional contribution
                } else {
                    multiplier = 0;
                }
            } else if (!peakLocked) {
                multiplier = 0;
            }

            const inputShare = shareInputs.get(name) ?? 0;
            const fallbackShare = getPreferredShare(info);
            const manualOverride = densityShareMap && typeof densityShareMap[name] === 'number'
                ? densityShareMap[name] > DENSITY_EPSILON
                : false;
            const preferredShare = inputShare > DENSITY_EPSILON ? inputShare
                : (fallbackShare > DENSITY_EPSILON ? fallbackShare : 0);
            const isCandidate = multiplier > DENSITY_EPSILON;
            if (isCandidate) {
                candidateNames.push(name);
            }
            const allowNegativeFallback = weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED
                ? true
                : (multiplier > DENSITY_EPSILON || peakLocked);

            channelShareState.set(name, {
                multiplier,
                preferredShare,
                allowNegativeFallback,
                isCandidate,
                manualOverride
            });
        });

        const candidateSet = new Set(candidateNames);
        const equalShare = candidateNames.length ? 1 / candidateNames.length : 0;

        channelInfo.forEach((info, name) => {
            const state = channelShareState.get(name);
            if (!state) {
                info.densityShare = 0;
                info.regionShareOverride = false;
                info.allowNegativeFallback = false;
                return;
            }
            const { multiplier, preferredShare, allowNegativeFallback, isCandidate } = state;
            if (multiplier <= DENSITY_EPSILON) {
                info.densityShare = 0;
                info.regionShareOverride = false;
                info.allowNegativeFallback = allowNegativeFallback;
                return;
            }
            const baseShare = preferredShare > DENSITY_EPSILON ? preferredShare : getPreferredShare(info);
            const shareValue = useEqualWeighting && isCandidate && candidateSet.has(name)
                ? equalShare
                : baseShare;
            const weightedShare = shareValue * multiplier;
            if (weightedShare > DENSITY_EPSILON) {
                info.densityShare = weightedShare;
                info.regionShareOverride = true;
                info.allowNegativeFallback = weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED ? true : false;
            } else {
                info.densityShare = 0;
                info.regionShareOverride = false;
                info.allowNegativeFallback = allowNegativeFallback;
            }
        });

        const inputNormalized = DENOM > 0 ? i / DENOM : 0;
        const targetNormalized = clamp01(interpolationFunction(lutDomainMin + inputNormalized * domainSpan));
        // Use the linearized target from the interpolation function, not the raw measurement
        const targetDensity = targetNormalized;
        let measurementSample = null;
        if (Array.isArray(compositeLabSession.measurementSamples) && compositeLabSession.measurementSamples.length > i) {
            const value = compositeLabSession.measurementSamples[i];
            if (Number.isFinite(value)) {
                measurementSample = clamp01(value);
            }
        }

        let currentDensity = 0;
        channelInfo.forEach((info) => {
            if (!info || !Number.isFinite(info.weight) || info.weight <= DENSITY_EPSILON) {
                return;
            }
            currentDensity += info.weight * info.normalized;
        });

        if (measurementSample != null && Number.isFinite(measurementSample) &&
            measurementSample >= (targetDensity - DENSITY_EPSILON) &&
            currentDensity > measurementSample + DENSITY_EPSILON) {
            const recomputeDensity = () => {
                let total = 0;
                channelInfo.forEach((entry) => {
                    const weight = entry.weight || 0;
                    if (weight > DENSITY_EPSILON) {
                        total += weight * (entry.normalized || 0);
                    }
                });
                return total;
            };

            const scale = measurementSample / Math.max(currentDensity, DENSITY_EPSILON);
            channelInfo.forEach((info) => {
                if (!info || !info.curve || info.endValue <= 0) return;
                const scaledNormalized = clamp01((info.normalized || 0) * scale);
                const newValue = Math.round(scaledNormalized * info.endValue);
                info.curve[i] = newValue;
                info.current = newValue;
                info.normalized = info.endValue > 0 ? newValue / info.endValue : 0;
                info.headroom = Math.max(0, info.endValue - newValue);
                info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;
            });

            currentDensity = recomputeDensity();
            let safetyIterations = 0;
            const maxSafetyIterations = channels.length * 4;
            const sortedChannels = Array.from(channelInfo.entries());
            const sortByContributionDesc = () => {
                sortedChannels.sort((a, b) => {
                    const weightA = a[1].weight || 0;
                    const weightB = b[1].weight || 0;
                    const contribA = weightA * (a[1].normalized || 0);
                    const contribB = weightB * (b[1].normalized || 0);
                    return contribB - contribA;
                });
            };
            sortByContributionDesc();

            while (currentDensity > measurementSample + DENSITY_EPSILON &&
                safetyIterations < maxSafetyIterations) {
                safetyIterations += 1;
                let adjusted = false;
                for (const [, info] of sortedChannels) {
                    if (!info || !info.curve || info.endValue <= 0) continue;
                    if (info.current <= 0) continue;
                    info.current = Math.max(0, info.current - 1);
                    info.curve[i] = info.current;
                    info.normalized = info.endValue > 0 ? info.current / info.endValue : 0;
                    info.headroom = Math.max(0, info.endValue - info.current);
                    info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;
                    adjusted = true;
                    break;
                }
                if (!adjusted) {
                    break;
                }
                sortByContributionDesc();
                currentDensity = recomputeDensity();
            }

            channelInfo.forEach((info, name) => {
                const thresholdNormalized = coverageBufferThresholdNormalized.get(name);
                if (Number.isFinite(thresholdNormalized)) {
                    remainingByChannel[name] = Math.max(0, thresholdNormalized - info.normalized);
                } else {
                    remainingByChannel[name] = info.headroomNormalized;
                }
            });
        }

        if (measurementSample != null && Number.isFinite(measurementSample) &&
            measurementSample <= targetDensity + DENSITY_EPSILON) {
            channelInfo.forEach((info) => {
                const baselineValue = info.baselineValue || 0;
                if (info.current > baselineValue) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[COMPOSITE] reverting to baseline', {
                            sampleIndex: i,
                            baselineValue,
                            correctedValue: info.current
                        });
                    }
                    info.curve[i] = baselineValue;
                    info.current = baselineValue;
                    info.normalized = info.endValue > 0 ? baselineValue / info.endValue : 0;
                    info.headroom = Math.max(0, info.endValue - baselineValue);
                    info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;
                }
            });
            let recalculatedDensity = 0;
            channelInfo.forEach((info) => {
                const weight = info.weight || 0;
                if (weight > DENSITY_EPSILON) {
                    recalculatedDensity += weight * (info.normalized || 0);
                }
            });
            currentDensity = recalculatedDensity;
        }

        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && (i === Math.round(0.05 * DENOM))) {
            console.log('[COMPOSITE] 5% diagnostics', {
                sampleIndex: i,
                measurementSample,
                targetDensity,
                currentDensity
            });
        }

        let deltaDensity;
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[deltaCheck.before]', { sample: i, measurementSample, targetDensity, currentDensity });
        }
        if (measurementSample != null && Number.isFinite(measurementSample)) {
            deltaDensity = targetDensity - measurementSample;
        } else {
            deltaDensity = targetDensity - currentDensity;
        }

        if (deltaDensity > 0 &&
            Number.isFinite(targetDensity)) {
            const highlightLevel = Number.isFinite(measurementSample)
                ? Math.min(targetDensity, measurementSample)
                : targetDensity;
            if (highlightLevel <= HIGHLIGHT_DENSITY_NORMALIZED_THRESHOLD) {
                const positiveDelta = Number.isFinite(measurementSample)
                    ? targetDensity - measurementSample
                    : deltaDensity;
                if (positiveDelta <= HIGHLIGHT_POSITIVE_DELTA_TOLERANCE) {
                    deltaDensity = 0;
                }
            }
        }

        if (analysisOnly) {
            deltaDensity = 0;
        }
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[deltaCheck.after]', { sample: i, deltaDensity });
        }

        emitCompositeAudit('sample.beforeDistribution', (targetIndex) => {
            if (i !== targetIndex) return null;
            const perChannel = Array.from(channelInfo.entries()).map(([name, info]) => ({
                channel: name,
                baselineValue: info.current,
                normalized: info.normalized,
                headroom: info.headroom,
                weight: info.weight,
                share: info.share,
                densityShare: info.densityShare,
                densityContribution: info.weight * info.normalized
            }));
            return {
                sampleIndex: targetIndex,
                targetDensity,
                measurementSample,
                currentDensity,
                deltaDensity,
                perChannel
            };
        });

        // Debug logging for sample 242 (95%)
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && i === 242) {
            console.log('[DEBUG Sample 242 @ 95%]', {
                sample: i,
                inputPercent: (i / DENOM) * 100,
                channelData: Array.from(channelInfo.entries()).map(([name, info]) => ({
                    channel: name,
                    current: info.current,
                    normalized: info.normalized,
                    weight: info.weight,
                    densityContribution: info.weight * info.normalized,
                    share: info.share,
                    densityShare: info.densityShare
                })),
                currentDensity,
                targetDensity,
                deltaDensity,
                measurementDelta: Array.isArray(compositeLabSession.measurementDeltas)
                    ? compositeLabSession.measurementDeltas[i] || 0
                    : 0
            });
        }

        const isAnchorSample = (i === 0 || i === DENOM);
        const measurementDelta = Array.isArray(compositeLabSession.measurementDeltas)
            ? compositeLabSession.measurementDeltas[i] || 0
            : 0;

        channelInfo.forEach((info) => {
            if (!info) return;
            info.blendAppliedNormalized = 0;
            info.blendCapNormalized = Number.POSITIVE_INFINITY;
            info.blendWindow = 0;
            info.blendProgress = 0;
            info.pendingBlendCap = undefined;
            info.pendingBlendWindow = undefined;
            info.pendingBlendProgress = undefined;
            info.shadowBlendAppliedNormalized = 0;
            info.shadowBlendCapNormalized = Number.POSITIVE_INFINITY;
            info.shadowBlendWindow = 0;
            info.shadowBlendProgress = 0;
            info.pendingShadowBlendCap = undefined;
            info.pendingShadowBlendWindow = undefined;
            info.pendingShadowBlendProgress = undefined;
            info.shadowBlendFromChannel = undefined;
        });
        if (weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
            const blendTracker = ensureLadderBlendTracker();
            const shadowTracker = ensureShadowBlendTracker();
            const positiveDeltaRequest = deltaDensity > DENSITY_EPSILON;
            const negativeDeltaRequest = deltaDensity < -DENSITY_EPSILON;
            if (positiveDeltaRequest) {
                shadowTracker.clear();
                const activeChannels = new Set();
                for (let idxLadder = 1; idxLadder < densityLadder.length; idxLadder += 1) {
                    const channelName = densityLadder[idxLadder];
                    const lighterName = densityLadder[idxLadder - 1];
                    const channelInfoEntry = channelInfo.get(channelName);
                    const lighterInfo = channelInfo.get(lighterName);
                    if (!channelInfoEntry || !lighterInfo) {
                        continue;
                    }
                    const lighterEffective = Math.max(0, Number(lighterInfo.effectiveHeadroomNormalized) || 0);
                    const lighterCapacity = Math.max(0, Number(lighterInfo.capacityBeforeNormalized) || 0);
                    const lighterState = typeof lighterInfo.reserveState === 'string' ? lighterInfo.reserveState : 'approaching';
                    const lighterReserveRemaining = Number.isFinite(lighterInfo.reserveAllowanceRemaining)
                        ? Math.max(0, lighterInfo.reserveAllowanceRemaining)
                        : null;
                    const lighterEffectiveForBlend = lighterReserveRemaining != null
                        ? lighterReserveRemaining
                        : lighterEffective;
                    const lighterBaseReserve = Number.isFinite(lighterInfo.frontReserveBase)
                        ? Math.max(0, lighterInfo.frontReserveBase)
                        : 0;
                    const reserveRatio = (lighterBaseReserve > DENSITY_EPSILON && lighterReserveRemaining != null)
                        ? lighterReserveRemaining / lighterBaseReserve
                        : Number.POSITIVE_INFINITY;
                    const approachingNearReserve = lighterState === 'approaching' && reserveRatio <= LADDER_BLEND_APPROACH_RATIO;
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[blendCandidate]', {
                            sample: i,
                            channel: channelName,
                            lighter: lighterName,
                            lighterState,
                            lighterReserveRemaining,
                            lighterEffectiveForBlend,
                            lighterCapacity,
                            lighterBaseReserve,
                            reserveRatio
                        });
                    }
                    const lighterSaturated =
                        lighterState === 'exhausted' ||
                        lighterState === 'within' ||
                        (lighterReserveRemaining != null && lighterReserveRemaining <= LADDER_BLEND_CAPACITY_THRESHOLD) ||
                        Math.min(lighterEffectiveForBlend, lighterCapacity) <= LADDER_BLEND_CAPACITY_THRESHOLD ||
                        approachingNearReserve;
                    if (!lighterSaturated) {
                        continue;
                    }
                    const currentState = blendTracker.get(channelName) || {
                        progress: 0,
                        window: LADDER_BLEND_WINDOW_SAMPLES,
                        fromChannel: lighterName,
                        startIndex: i
                    };
                    currentState.fromChannel = lighterName;
                    if (!Number.isInteger(currentState.startIndex)) {
                        currentState.startIndex = i;
                    }
                    currentState.window = Math.max(LADDER_BLEND_WINDOW_SAMPLES, currentState.window || LADDER_BLEND_WINDOW_SAMPLES);
                    blendTracker.set(channelName, currentState);
                    activeChannels.add(channelName);
                    channelInfoEntry.pendingBlendCap = Math.max(DENSITY_EPSILON, LADDER_BLEND_CAP_STEP);
                    channelInfoEntry.pendingBlendWindow = LADDER_BLEND_WINDOW_SAMPLES;
                    channelInfoEntry.pendingBlendProgress = currentState.progress || 0;
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[blendActivate]', { sample: i, channel: channelName, lighter: lighterName, lighterState });
                    }
                }
                blendTracker.forEach((state, channelName) => {
                    if (!activeChannels.has(channelName)) {
                        blendTracker.delete(channelName);
                        return;
                    }
                    const info = channelInfo.get(channelName);
                    if (!info) {
                        blendTracker.delete(channelName);
                        return;
                    }
                    const progress = Math.max(0, Math.min(state.progress || 0, (state.window || LADDER_BLEND_WINDOW_SAMPLES) - 1));
                    const capForProgress = computeBlendCapForProgress(progress);
                    const capacityLimit = Number.isFinite(info.capacityBeforeNormalized)
                        ? Math.max(0, info.capacityBeforeNormalized)
                        : Number.POSITIVE_INFINITY;
                    const blendCap = Number.isFinite(capacityLimit)
                        ? Math.min(capacityLimit, capForProgress)
                        : capForProgress;
                    const allowed = Math.max(DENSITY_EPSILON, blendCap);
                    state.allowed = allowed;
                    state.progress = progress;
                    info.blendCapNormalized = allowed;
                    info.blendWindow = state.window || LADDER_BLEND_WINDOW_SAMPLES;
                    info.blendProgress = progress;
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[blendState]', {
                            sample: i,
                            channel: channelName,
                            allowed,
                            progress,
                            lighter: state.fromChannel
                        });
                    }
                });
            } else if (negativeDeltaRequest) {
                blendTracker.clear();
                const activeShadowChannels = new Set();
                for (let idxLadder = densityLadder.length - 2; idxLadder >= 0; idxLadder -= 1) {
                    const lighterName = densityLadder[idxLadder];
                    const darkerName = densityLadder[idxLadder + 1];
                    const lighterInfo = channelInfo.get(lighterName);
                    const darkerInfo = channelInfo.get(darkerName);
                    if (!lighterInfo || !darkerInfo) {
                        continue;
                    }
                    const lighterCapacity = Math.max(
                        Number.isFinite(lighterInfo.capacityBeforeNormalized) ? lighterInfo.capacityBeforeNormalized : 0,
                        lighterInfo.normalized ?? 0
                    );
                    if (lighterCapacity <= SHADOW_BLEND_CAPACITY_THRESHOLD) {
                        shadowTracker.delete(darkerName);
                        continue;
                    }
                    const state = shadowTracker.get(darkerName) || {
                        progress: 0,
                        window: SHADOW_BLEND_WINDOW_SAMPLES,
                        fromChannel: lighterName
                    };
                    if (state.fromChannel !== lighterName) {
                        state.progress = 0;
                        state.fromChannel = lighterName;
                    }
                    const progress = Math.max(0, Number.isFinite(state.progress) ? state.progress : 0);
                    const window = Math.max(
                        SHADOW_BLEND_WINDOW_SAMPLES,
                        Number.isFinite(state.window) ? state.window : SHADOW_BLEND_WINDOW_SAMPLES
                    );
                    const cap = Math.min(SHADOW_BLEND_CAP_MAX, SHADOW_BLEND_CAP_STEP * (progress + 1));
                    state.window = window;
                    state.cap = cap;
                    shadowTracker.set(darkerName, state);
                    darkerInfo.pendingShadowBlendCap = Math.max(DENSITY_EPSILON, cap);
                    darkerInfo.pendingShadowBlendWindow = window;
                    darkerInfo.pendingShadowBlendProgress = progress;
                    darkerInfo.shadowBlendFromChannel = lighterName;
                    activeShadowChannels.add(darkerName);
                }
                shadowTracker.forEach((state, channelName) => {
                    if (!activeShadowChannels.has(channelName)) {
                        shadowTracker.delete(channelName);
                    }
                });
            } else {
                blendTracker.clear();
                shadowTracker.clear();
            }
        } else {
            clearLadderBlendTracker();
            clearShadowBlendTracker();
        }

        const inputPercent = (i / DENOM) * 100;

        const applyNormalizedDelta = (name, info, deltaNormalized, weight, context = {}) => {
            if (!info || !info.curve || info.endValue <= 0 || !Number.isFinite(weight) || weight <= DENSITY_EPSILON) {
                return 0;
            }

            const desiredDelta = deltaNormalized;
            let clampedDelta = deltaNormalized;
        const limit = coverageLimits.get(name);
        const thresholdAbsolute = coverageBufferThreshold.get(name);
        const thresholdNormalized = coverageBufferThresholdNormalized.get(name);
        const bufferedLimitNormalized = Number.isFinite(thresholdNormalized) ? thresholdNormalized : null;
        const bufferedLimitAbsolute = Number.isFinite(thresholdAbsolute) ? thresholdAbsolute : null;
        let truncatedByThreshold = false;
        let truncatedByEnd = false;
        let truncatedByBlend = false;
        let shadowBlendRemaining = Number.POSITIVE_INFINITY;
        let thresholdHeadroom = bufferedLimitNormalized != null
            ? Math.max(0, bufferedLimitNormalized - info.normalized)
            : Number.POSITIVE_INFINITY;
        let reserveApplied = 0;
        const positiveDelta = clampedDelta > 0;
        const baseReserve = Number.isFinite(info.frontReserveBase) ? Math.max(0, info.frontReserveBase) : 0;
        const allowanceRemaining = positiveDelta
            ? Math.max(0, Number(info.reserveAllowanceRemaining) || 0)
            : 0;
        if (positiveDelta && Number.isFinite(info.pendingBlendCap)) {
            const perSampleBlendCap = Math.max(DENSITY_EPSILON, info.pendingBlendCap);
            info.blendCapNormalized = perSampleBlendCap;
            const pendingWindow = Number.isFinite(info.pendingBlendWindow) && info.pendingBlendWindow > 0
                ? info.pendingBlendWindow
                : LADDER_BLEND_WINDOW_SAMPLES;
            info.blendWindow = pendingWindow;
            const pendingProgress = Number.isFinite(info.pendingBlendProgress) && info.pendingBlendProgress >= 0
                ? info.pendingBlendProgress
                : 0;
            info.blendProgress = pendingProgress;
        }
        const blendCapNormalized = positiveDelta && Number.isFinite(info.blendCapNormalized)
            ? Math.max(0, info.blendCapNormalized)
            : Number.POSITIVE_INFINITY;
        const blendApplied = positiveDelta
            ? Math.max(0, Number(info.blendAppliedNormalized) || 0)
            : 0;
        const blendRemaining = positiveDelta && Number.isFinite(blendCapNormalized)
            ? Math.max(0, blendCapNormalized - blendApplied)
            : Number.POSITIVE_INFINITY;
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && positiveDelta && (name === 'C' || name === 'LK')) {
            console.log('[blendCapCheck]', {
                sample: i,
                channel: name,
                blendCapNormalized: info.blendCapNormalized,
                blendApplied,
                blendRemaining
            });
        }
        if (positiveDelta && blendRemaining <= DENSITY_EPSILON) {
            clampedDelta = 0;
            truncatedByBlend = true;
        } else if (positiveDelta && Number.isFinite(blendRemaining) && clampedDelta > blendRemaining + DENSITY_EPSILON) {
            clampedDelta = blendRemaining;
            truncatedByBlend = true;
        }
        if (!positiveDelta && Number.isFinite(info.pendingShadowBlendCap)) {
            const perSampleShadowCap = Math.max(DENSITY_EPSILON, info.pendingShadowBlendCap);
            info.shadowBlendCapNormalized = perSampleShadowCap;
            const pendingShadowWindow = Number.isFinite(info.pendingShadowBlendWindow) && info.pendingShadowBlendWindow > 0
                ? info.pendingShadowBlendWindow
                : SHADOW_BLEND_WINDOW_SAMPLES;
            info.shadowBlendWindow = pendingShadowWindow;
            const pendingShadowProgress = Number.isFinite(info.pendingShadowBlendProgress) && info.pendingShadowBlendProgress >= 0
                ? info.pendingShadowBlendProgress
                : 0;
            info.shadowBlendProgress = pendingShadowProgress;
        }
        const shadowBlendCap = !positiveDelta && Number.isFinite(info.shadowBlendCapNormalized)
            ? Math.max(0, info.shadowBlendCapNormalized)
            : Number.POSITIVE_INFINITY;
        const shadowBlendApplied = !positiveDelta
            ? Math.max(0, Number(info.shadowBlendAppliedNormalized) || 0)
            : 0;
        shadowBlendRemaining = !positiveDelta && Number.isFinite(shadowBlendCap)
            ? Math.max(0, shadowBlendCap - shadowBlendApplied)
            : Number.POSITIVE_INFINITY;
        if (!positiveDelta && Number.isFinite(shadowBlendRemaining)) {
            if (shadowBlendRemaining <= DENSITY_EPSILON) {
                clampedDelta = 0;
                truncatedByBlend = true;
            } else {
                const magnitude = Math.abs(clampedDelta);
                if (magnitude > shadowBlendRemaining + DENSITY_EPSILON) {
                    clampedDelta = -shadowBlendRemaining;
                    truncatedByBlend = true;
                }
            }
        }
        let coverageCapacityNormalized = bufferedLimitNormalized != null
            ? Math.max(0, bufferedLimitNormalized - info.normalized)
            : Number.POSITIVE_INFINITY;
        if (positiveDelta && coverageCapacityNormalized <= DENSITY_EPSILON && allowanceRemaining > DENSITY_EPSILON && bufferedLimitNormalized == null) {
            coverageCapacityNormalized = allowanceRemaining;
        }
        if (positiveDelta) {
            const baseReserve = Number.isFinite(info.frontReserveBase) ? Math.max(0, info.frontReserveBase) : 0;
            const appliedReserveTotal = Number.isFinite(info.frontReserveApplied) ? Math.max(0, info.frontReserveApplied) : 0;
            const remainingReserve = Math.max(0, baseReserve - appliedReserveTotal);
            if (!context.allowReserveRelease &&
                weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
                const darkerHeadroom = Number.isFinite(info.frontReserveDarkerHeadroom)
                    ? info.frontReserveDarkerHeadroom
                    : 0;
                if (remainingReserve > DENSITY_EPSILON && darkerHeadroom > DENSITY_EPSILON && thresholdHeadroom > DENSITY_EPSILON) {
                    const deltaMagnitude = Math.abs(context.deltaDensityForSample ?? 0);
                    let reserveScale = 1;
                    if (deltaMagnitude >= FRONT_RESERVE_RELEASE_END) {
                        reserveScale = 0;
                    } else if (deltaMagnitude > FRONT_RESERVE_RELEASE_START) {
                        const span = Math.max(FRONT_RESERVE_RELEASE_END - FRONT_RESERVE_RELEASE_START, DENSITY_EPSILON);
                        reserveScale = Math.max(0, 1 - ((deltaMagnitude - FRONT_RESERVE_RELEASE_START) / span));
                    }
                    if (reserveScale > DENSITY_EPSILON) {
                        const reserveNormalized = remainingReserve * reserveScale;
                        const effectiveReserve = Math.min(reserveNormalized, thresholdHeadroom);
                        if (effectiveReserve > DENSITY_EPSILON) {
                            thresholdHeadroom = Math.max(0, thresholdHeadroom - effectiveReserve);
                            reserveApplied = effectiveReserve;
                        }
                    }
                }
            }
            const effectiveReserveOutstanding = Math.max(0, baseReserve - (appliedReserveTotal + reserveApplied));
            const previewHeadroomRaw = bufferedLimitNormalized != null
                ? Math.max(0, thresholdHeadroom)
                : Math.max(0, (Number.isFinite(info.headroomNormalized) ? info.headroomNormalized : 0) - effectiveReserveOutstanding);
            let previewHeadroom = Math.max(0, previewHeadroomRaw);
            if (allowanceRemaining > DENSITY_EPSILON && bufferedLimitNormalized == null) {
                previewHeadroom = Math.max(previewHeadroom, allowanceRemaining);
            }
            info.effectiveHeadroomNormalized = previewHeadroom;
            coverageCapacityNormalized = bufferedLimitNormalized != null
                ? Math.max(0, thresholdHeadroom)
                : Math.max(0, previewHeadroom);

            let reserveReleaseScale = 1;
            if (!context.allowReserveRelease &&
                weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED &&
                baseReserve > DENSITY_EPSILON &&
                previewHeadroom <= (baseReserve * FRONT_RESERVE_TAPER_START_FACTOR) + DENSITY_EPSILON) {
                const startHeadroom = baseReserve * FRONT_RESERVE_TAPER_START_FACTOR;
                const endHeadroom = baseReserve * FRONT_RESERVE_TAPER_END_FACTOR;
                if (startHeadroom > endHeadroom + DENSITY_EPSILON) {
                    if (previewHeadroom <= endHeadroom + DENSITY_EPSILON) {
                        reserveReleaseScale = 0;
                    } else {
                        const span = Math.max(startHeadroom - endHeadroom, DENSITY_EPSILON);
                        const clampedHeadroom = Math.min(startHeadroom, Math.max(endHeadroom, previewHeadroom));
                        reserveReleaseScale = Math.max(0, Math.min(1, (clampedHeadroom - endHeadroom) / span));
                    }
                } else if (previewHeadroom <= baseReserve + DENSITY_EPSILON) {
                    reserveReleaseScale = 0;
                }
            }
            if (reserveReleaseScale < 1 - DENSITY_EPSILON) {
                clampedDelta *= reserveReleaseScale;
            }
            info.reserveReleaseScale = reserveReleaseScale;
            info.reserveReleaseHeadroom = previewHeadroom;
            const endCapacityNormalized = Number.isFinite(info.headroomNormalized)
                ? Math.max(0, info.headroomNormalized)
                : Number.POSITIVE_INFINITY;
            const availableBefore = computeAvailableCapacityNormalized(info, {
                coverageCapacity: coverageCapacityNormalized,
                effectiveHeadroom: previewHeadroom,
                endCapacity: endCapacityNormalized
            });
            info.capacityBeforeNormalized = availableBefore;
            let clampLimit = availableBefore;
            if (!Number.isFinite(clampLimit)) {
                clampLimit = previewHeadroom;
            }
            if (Number.isFinite(blendRemaining)) {
                clampLimit = Math.min(clampLimit, blendRemaining);
            }
            if (clampLimit <= DENSITY_EPSILON) {
                const coverageTriggers = Number.isFinite(coverageCapacityNormalized) && coverageCapacityNormalized <= DENSITY_EPSILON;
                const endTriggers = Number.isFinite(endCapacityNormalized) && endCapacityNormalized <= DENSITY_EPSILON;
                if (coverageTriggers || (!coverageTriggers && !endTriggers)) {
                    truncatedByThreshold = true;
                }
                if (Number.isFinite(blendRemaining) && blendRemaining <= DENSITY_EPSILON) {
                    truncatedByBlend = true;
                }
                if (endTriggers) {
                    truncatedByEnd = true;
                }
                clampedDelta = 0;
            } else if (clampedDelta > clampLimit + DENSITY_EPSILON) {
                const closeToCoverage = Number.isFinite(coverageCapacityNormalized) &&
                    coverageCapacityNormalized <= clampLimit + DENSITY_EPSILON;
                const closeToEnd = Number.isFinite(endCapacityNormalized) &&
                    endCapacityNormalized <= clampLimit + DENSITY_EPSILON;
                if (closeToCoverage || (!closeToCoverage && !closeToEnd)) {
                    truncatedByThreshold = true;
                }
                if (closeToEnd) {
                    truncatedByEnd = true;
                }
                if (Number.isFinite(blendRemaining) && clampLimit === blendRemaining) {
                    truncatedByBlend = true;
                }
                clampedDelta = clampLimit;
            }
        } else {
            info.capacityBeforeNormalized = Math.max(0, info.normalized);
            clampedDelta = Math.max(clampedDelta, -info.normalized);
            if (weightingMode !== COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
                const baselineNormalized = normalizedBaselineByChannel.get(name)?.[i] || 0;
                if (baselineNormalized > DENSITY_EPSILON) {
                    const minNormalized = Math.min(baselineNormalized, baselineNormalized * ISOLATED_BASELINE_RETENTION);
                    if (info.normalized > minNormalized + DENSITY_EPSILON) {
                        const minDelta = minNormalized - info.normalized;
                        clampedDelta = Math.max(clampedDelta, minDelta);
                    }
                }
            }
        }

            if (Math.abs(clampedDelta) <= DENSITY_EPSILON) {
                if (positiveDelta && truncatedByBlend) {
                    remainingByChannel[name] = Number.isFinite(blendRemaining)
                        ? Math.max(0, blendRemaining)
                        : 0;
                } else if (!positiveDelta && truncatedByBlend) {
                    remainingByChannel[name] = Number.isFinite(shadowBlendRemaining)
                        ? Math.max(0, shadowBlendRemaining)
                        : 0;
                }
                if (clampedDelta > 0 && weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED &&
                    !context.allowReserveRelease && Number.isFinite(info.frontReserveBase)) {
                    const baseReserve = Math.max(0, Number(info.frontReserveBase) || 0);
                    const appliedReserveTotal = Math.max(0, Number(info.frontReserveApplied) || 0);
                    const updatedApplied = baseReserve;
                    info.frontReserveApplied = updatedApplied;
                    info.effectiveHeadroomNormalized = 0;
                    info.reserveLocked = true;
                    remainingByChannel[name] = 0;
                }
                return 0;
            }

            const prevNormalized = info.normalized;
            let newNormalized = clamp01(prevNormalized + clampedDelta);
            if (perSampleCeilingEnabled && Number.isFinite(thresholdNormalized) &&
                newNormalized > thresholdNormalized + DENSITY_EPSILON) {
                newNormalized = thresholdNormalized;
                truncatedByThreshold = true;
            }
            if (Math.abs(newNormalized - prevNormalized) <= DENSITY_EPSILON) {
                return 0;
            }

            const newValue = Math.max(0, Math.min(info.endValue, Math.round(newNormalized * info.endValue)));
            if (newValue === info.current) {
                newNormalized = info.endValue > 0 ? newValue / info.endValue : 0;
            }

            info.curve[i] = newValue;
            info.current = newValue;
            info.normalized = info.endValue > 0 ? newValue / info.endValue : 0;
            const normalizedApplied = info.normalized - prevNormalized;
            if (positiveDelta && normalizedApplied > DENSITY_EPSILON) {
                info.blendAppliedNormalized = (info.blendAppliedNormalized || 0) + normalizedApplied;
                if (Number.isFinite(info.reserveAllowanceRemaining)) {
                    const remainingAllowance = Math.max(0, Number(info.reserveAllowanceRemaining) || 0);
                    info.reserveAllowanceRemaining = Math.max(0, remainingAllowance - normalizedApplied);
                }
            } else if (!positiveDelta && normalizedApplied < -DENSITY_EPSILON) {
                const appliedMagnitude = Math.abs(normalizedApplied);
                info.shadowBlendAppliedNormalized = (info.shadowBlendAppliedNormalized || 0) + appliedMagnitude;
            }
            info.headroom = Math.max(0, info.endValue - newValue);
            if (perSampleCeilingEnabled && Number.isFinite(thresholdNormalized)) {
                info.headroomNormalized = Math.max(0, thresholdNormalized - info.normalized);
            } else {
                info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;
            }
            const effectiveBase = computeEffectiveHeadroom(info);
            const allowanceCarry = Number.isFinite(info.reserveAllowanceRemaining)
                ? Math.max(0, Number(info.reserveAllowanceRemaining))
                : 0;
            info.effectiveHeadroomNormalized = Math.max(0, effectiveBase + allowanceCarry);
            info.layerNormalized = Math.max(0, info.normalized - (info.coverageFloorNormalized ?? 0));
            if (reserveApplied > DENSITY_EPSILON) {
                const previousReserve = Number.isFinite(info.frontReserveApplied) ? info.frontReserveApplied : 0;
                info.frontReserveApplied = previousReserve + reserveApplied;
            }

            if (Number.isFinite(thresholdNormalized)) {
                remainingByChannel[name] = Math.max(0, thresholdNormalized - info.normalized);
            } else {
                const effectiveRemaining = Number.isFinite(info.effectiveHeadroomNormalized)
                    ? Math.max(0, info.effectiveHeadroomNormalized)
                    : Math.max(0, info.headroomNormalized || 0);
                const blendRemainingAfterPositive = positiveDelta && Number.isFinite(info.blendCapNormalized)
                    ? Math.max(0, info.blendCapNormalized - (info.blendAppliedNormalized || 0))
                    : Number.POSITIVE_INFINITY;
                const shadowRemainingAfter = !positiveDelta && Number.isFinite(info.shadowBlendCapNormalized)
                    ? Math.max(0, info.shadowBlendCapNormalized - (info.shadowBlendAppliedNormalized || 0))
                    : Number.POSITIVE_INFINITY;
                const blendRemainingAfter = positiveDelta ? blendRemainingAfterPositive : shadowRemainingAfter;
                const allowanceRemainingAfter = (info.reserveState === 'within')
                    ? Math.max(0, Number(info.reserveAllowanceRemaining) || 0)
                    : effectiveRemaining;
                const combinedRemaining = Math.min(
                    effectiveRemaining,
                    allowanceRemainingAfter,
                    blendRemainingAfter
                );
                remainingByChannel[name] = combinedRemaining;
            }

            const recordedUsage = coverageUsage.get(name) || 0;
            const updatedUsage = Math.max(recordedUsage, info.normalized);
            coverageUsage.set(name, updatedUsage);

            const postCoverageCapacity = bufferedLimitNormalized != null
                ? Math.max(0, bufferedLimitNormalized - info.normalized)
                : Number.POSITIVE_INFINITY;
            const postEndCapacity = Number.isFinite(info.headroomNormalized)
                ? Math.max(0, info.headroomNormalized)
                : Number.POSITIVE_INFINITY;
            const postEffectiveCapacity = Number.isFinite(info.effectiveHeadroomNormalized)
                ? Math.max(0, info.effectiveHeadroomNormalized)
                : postEndCapacity;
            info.capacityAfterNormalized = computeAvailableCapacityNormalized(info, {
                coverageCapacity: postCoverageCapacity,
                effectiveHeadroom: postEffectiveCapacity,
                endCapacity: postEndCapacity
            });

            const allowanceRemainingValue = Math.max(0, Number(info.reserveAllowanceRemaining) || 0);
            const postReserveMeta = computeReserveMeta(info);
            info.reserveState = postReserveMeta.state;
            info.reserveAllowanceNormalized = postReserveMeta.allowance;
            info.reserveAllowanceRemaining = Math.min(allowanceRemainingValue, postReserveMeta.allowance);
            info.blendLimited = truncatedByBlend;

            if (perSampleCeilingEnabled && desiredDelta > 0) {
                const normalizedApplied = info.normalized - prevNormalized;
                const desiredNormalizedAfter = clamp01(prevNormalized + desiredDelta);
                const overflowNormalized = Math.max(0, desiredNormalizedAfter - info.normalized);
                const nearBufferedLimit = bufferedLimitNormalized != null
                    ? (bufferedLimitNormalized - info.normalized) <= DENSITY_CEILING_TOLERANCE
                    : info.headroomNormalized <= DENSITY_CEILING_TOLERANCE;
                if ((truncatedByThreshold || truncatedByEnd || overflowNormalized > DENSITY_EPSILON || nearBufferedLimit) &&
                    normalizedApplied > DENSITY_EPSILON) {
                    const list = coverageClampEvents.get(name) || [];
                    list.push({
                        index: i,
                        inputPercent,
                        normalizedBefore: prevNormalized,
                        normalizedAfter: info.normalized,
                        desiredNormalizedAfter,
                        overflowNormalized,
                        bufferedLimit: bufferedLimitAbsolute != null ? bufferedLimitAbsolute : 1,
                        limit: Number.isFinite(limit) ? limit : null,
                        truncatedByThreshold,
                        truncatedByEnd,
                        truncatedByBlend,
                        floorNormalized: info.coverageFloorNormalized ?? null
                    });
                    coverageClampEvents.set(name, list);
                    if (smoothingContext && smoothingContext.perSampleCeiling === true) {
                        const clampMap = smoothingContext.clampIndicesByChannel instanceof Map
                            ? smoothingContext.clampIndicesByChannel
                            : null;
                        if (clampMap) {
                            if (smoothingContext.channelHistory instanceof Map) {
                                const history = smoothingContext.channelHistory.get(name);
                                if (Array.isArray(history)) {
                                    const lastSeenIndex = history[history.length - 1];
                                    if (lastSeenIndex !== i) {
                                        history.push(i);
                                    }
                                } else {
                                    smoothingContext.channelHistory.set(name, [i]);
                                }
                            }
                            const indices = clampMap.get(name);
                            if (Array.isArray(indices)) {
                                if (indices[indices.length - 1] !== i) {
                                    indices.push(i);
                                }
                            } else {
                                clampMap.set(name, [i]);
                            }
                            let addedSyntheticWindow = false;
                            const syntheticMap = smoothingContext.syntheticClampWindows instanceof Map
                                ? smoothingContext.syntheticClampWindows
                                : null;
                            if (syntheticMap && !syntheticMap.has(name)) {
                                syntheticMap.set(name, i);
                                addedSyntheticWindow = true;
                            }
                            if (addedSyntheticWindow && Array.isArray(smoothingContext.windows)) {
                                const record = Array.isArray(smoothingContext.sampleRecords)
                                    ? smoothingContext.sampleRecords[i]
                                    : null;
                                const windowId = Number.isFinite(smoothingContext.nextWindowId)
                                    ? smoothingContext.nextWindowId++
                                    : 0;
                                const inputValue = record && Number.isFinite(record.inputPercent)
                                    ? record.inputPercent
                                    : (i / DENOM) * 100;
                                smoothingContext.windows.push({
                                    id: windowId,
                                    outgoingChannel: name,
                                    incomingChannels: [],
                                    startIndex: i,
                                    endIndex: i,
                                    inputStart: inputValue,
                                    inputEnd: inputValue,
                                    forced: true,
                                    synthetic: true
                                });
                            }
                        }
                    }
                }
            }

            if (info.endValue > 0 && info.current >= info.endValue * COMPOSITE_SATURATION_THRESHOLD && inputPercent < 95) {
                if (!saturationByChannel.has(name)) {
                    saturationByChannel.set(name, formatSamplePercent(i));
                }
                const indices = saturationByIndex.get(i) || [];
                indices.push(name);
                saturationByIndex.set(i, indices);
            }

            return weight * (info.normalized - prevNormalized);
        };

        const preRemainingByChannel = smoothingContext ? {} : null;
        if (preRemainingByChannel) {
            channelInfo.forEach((_, name) => {
                preRemainingByChannel[name] = Number(remainingByChannel[name]) || 0;
            });
        }

        let ladderTraceSnapshot = null;

        const distributeDensity = (densityDelta) => {
            const contributions = {};
            let remaining = densityDelta;
            const localTrace = {
                direction: densityDelta > DENSITY_EPSILON ? 'increase'
                    : (densityDelta < -DENSITY_EPSILON ? 'decrease' : 'flat'),
                blocked: [],
                sequence: []
            };
            const maxIterations = Math.max(4, channelInfo.size * 4);
        const getNormalizedHeadroom = (entry, channelName) => {
            if (!entry) return 0;
            const effective = Number.isFinite(entry.effectiveHeadroomNormalized)
                ? Math.max(0, entry.effectiveHeadroomNormalized)
                : null;
            if (effective != null) {
                return effective;
            }
            const thresholdNormalized = coverageBufferThresholdNormalized.get(channelName);
            if (Number.isFinite(thresholdNormalized)) {
                return Math.max(0, thresholdNormalized - (entry.normalized || 0));
            }
            const headroom = entry.headroomNormalized;
            return Number.isFinite(headroom) ? Math.max(0, headroom) : 0;
        };
        const getNormalizedUsage = (entry) => {
            if (!entry) return 0;
            const normalized = entry.normalized;
            return Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
        };
        for (let iter = 0; iter < maxIterations && Math.abs(remaining) > DENSITY_EPSILON; iter += 1) {
            const positive = remaining > 0;
            const candidates = [];
            let reserveLockTriggered = false;
            channelInfo.forEach((info, name) => {
                if (!info || !info.curve || info.endValue <= 0) return;
                if (positive && info.reserveLocked) {
                    info.reserveLocked = false;
                    return;
                }
                const weight = info.weight;
                if (!Number.isFinite(weight) || weight <= DENSITY_EPSILON) return;
                if (positive && info.lockPositive) return;
                const shareState = channelShareState.get(name);
                const manualOverride = !!(shareState && shareState.manualOverride);
                const effectiveHeadroom = Number.isFinite(info.effectiveHeadroomNormalized)
                    ? Math.max(0, info.effectiveHeadroomNormalized)
                    : Math.max(0, info.headroomNormalized || 0);
                let capacity;
                if (positive) {
                    const normalizedThreshold = coverageBufferThresholdNormalized.get(name);
                    const coverageCapacity = Number.isFinite(normalizedThreshold)
                        ? Math.max(0, normalizedThreshold - info.normalized)
                        : Number.POSITIVE_INFINITY;
                    const endCapacity = Number.isFinite(info.headroomNormalized)
                        ? Math.max(0, info.headroomNormalized)
                        : Number.POSITIVE_INFINITY;
                    capacity = computeAvailableCapacityNormalized(info, {
                        coverageCapacity,
                        effectiveHeadroom,
                        endCapacity
                    });
                    info.capacityBeforeNormalized = capacity;
                } else {
                    capacity = Math.max(0, info.normalized);
                    info.capacityBeforeNormalized = capacity;
                }
                if (capacity <= DENSITY_EPSILON) return;
                    if (!manualOverride && weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED && ladderIndexByChannel.has(name)) {
                        const ladderIndex = ladderIndexByChannel.get(name);
                        if (positive && ladderIndex != null && ladderIndex > 0) {
                            let lighterBlocking = null;
                            for (let idx = ladderIndex - 1; idx >= 0; idx -= 1) {
                                const lighterName = densityLadder[idx];
                                if (lighterName === name) continue;
                                const lighterInfo = channelInfo.get(lighterName);
                                if (!lighterInfo) continue;
                                const lighterHeadroom = getNormalizedHeadroom(lighterInfo, lighterName);
                                if (lighterHeadroom > DENSITY_CEILING_TOLERANCE) {
                                    lighterBlocking = { lighterName, lighterHeadroom };
                                    break;
                                }
                            }
                            if (lighterBlocking) {
                                if (captureDebug) {
                                    localTrace.blocked.push({
                                        channel: name,
                                        reason: 'lighter-headroom',
                                        blockedBy: lighterBlocking.lighterName,
                                        headroom: lighterBlocking.lighterHeadroom
                                    });
                                }
                                return;
                            }
                        } else if (!positive && ladderIndex != null && ladderIndex < densityLadder.length - 1) {
                            let heavierBlocking = null;
                            for (let idx = ladderIndex + 1; idx < densityLadder.length; idx += 1) {
                                const heavierName = densityLadder[idx];
                                if (heavierName === name) continue;
                                const heavierInfo = channelInfo.get(heavierName);
                                if (!heavierInfo) continue;
                                const heavierUsage = getNormalizedUsage(heavierInfo);
                                if (heavierUsage > DENSITY_CEILING_TOLERANCE) {
                                    heavierBlocking = { heavierName, heavierUsage };
                                    break;
                                }
                            }
                            if (heavierBlocking) {
                                if (captureDebug) {
                                    localTrace.blocked.push({
                                        channel: name,
                                        reason: 'heavier-usage',
                                        blockedBy: heavierBlocking.heavierName,
                                        usage: heavierBlocking.heavierUsage
                                    });
                                }
                                return;
                            }
                        }
                    }
                    let share = 0;
                    if (info.regionShareOverride) {
                        share = info.densityShare || 0;
                        if (share <= DENSITY_EPSILON) {
                            if (positive || !info.allowNegativeFallback) {
                                return;
                            }
                            share = info.weightingShare || info.share || 0;
                        }
                    } else {
                        share = info.densityShare || info.weightingShare || info.share || 0;
                    }
                    if (share <= DENSITY_EPSILON) {
                        share = weight;
                    }
                    if (share <= DENSITY_EPSILON) return;
                    const activity = capacity;
                    if (activity > DENSITY_EPSILON) {
                        const bias = Math.pow(activity, 1.5);
                        share *= (1 + bias);
                    }
                    if (!positive && Number.isFinite(info.pendingShadowBlendCap)) {
                        share *= SHADOW_BLEND_SHARE_FRACTION;
                    }
                    candidates.push({
                        name,
                        info,
                        weight,
                        share,
                        ladderIndex: ladderIndexByChannel.has(name) ? ladderIndexByChannel.get(name) : null
                    });
                });

                if (!candidates.length) {
                    break;
                }

                if (weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
                    candidates.sort((a, b) => {
                        const idxA = Number.isFinite(a.ladderIndex) ? a.ladderIndex : (positive ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                        const idxB = Number.isFinite(b.ladderIndex) ? b.ladderIndex : (positive ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                        return positive ? (idxA - idxB) : (idxB - idxA);
                    });
                }

                let shareSum = candidates.reduce((sum, entry) => sum + entry.share, 0);
                if (shareSum <= DENSITY_EPSILON) {
                    shareSum = candidates.length;
                    candidates.forEach((entry) => { entry.share = 1; });
                }

                const iterationRemaining = remaining;
                let appliedThisRound = 0;
                candidates.forEach((entry) => {
                    const { name, info, weight, share } = entry;
                    if (Math.abs(iterationRemaining) <= DENSITY_EPSILON) {
                        return;
                    }
                    let desiredNormalizedChange = (iterationRemaining * (share / shareSum)) / weight;
                    if (positive) {
                        desiredNormalizedChange = Math.max(0, desiredNormalizedChange);
                    } else {
                        desiredNormalizedChange = Math.min(0, desiredNormalizedChange);
                    }
                    if (Math.abs(desiredNormalizedChange) <= DENSITY_EPSILON) {
                        return;
                    }
                    const contribution = applyNormalizedDelta(name, info, desiredNormalizedChange, weight, {
                        deltaDensityForSample: deltaDensity,
                        allowReserveRelease: false
                    });
                    if (info.reserveLocked === true) {
                        reserveLockTriggered = true;
                        info.reserveLocked = false;
                        info.effectiveHeadroomNormalized = 0;
                        return;
                    }
                    if (Math.abs(contribution) > DENSITY_EPSILON) {
                        const normalizedApplied = contribution / weight;
                        contributions[name] = (contributions[name] || 0) + normalizedApplied;
                        remaining -= contribution;
                        appliedThisRound += Math.abs(contribution);
                        if (captureDebug) {
                            localTrace.sequence.push({
                                channel: name,
                                ladderIndex: Number.isFinite(entry.ladderIndex) ? entry.ladderIndex : null,
                                normalizedApplied,
                                iteration: iter,
                                weight
                            });
                        }
                    }
                });

                if (appliedThisRound <= DENSITY_EPSILON) {
                    if (reserveLockTriggered) {
                        continue;
                    }
                    break;
                }
            }

            if (captureDebug) {
                localTrace.remaining = remaining;
            }
            ladderTraceSnapshot = captureDebug ? localTrace : null;
            return contributions;
        };

        const contributions = distributeDensity(deltaDensity);

        if (weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
            const blendTracker = ensureLadderBlendTracker();
            blendTracker.forEach((state, channelName) => {
                if (!state || state.active !== true) {
                    return;
                }
                const info = channelInfo.get(channelName);
                if (!info) {
                    blendTracker.delete(channelName);
                    return;
                }
                const appliedNormalized = Math.max(0, Number(info.blendAppliedNormalized) || 0);
                if (appliedNormalized > DENSITY_EPSILON || deltaDensity <= DENSITY_EPSILON) {
                    state.progress = Math.min((state.progress || 0) + 1, state.window || LADDER_BLEND_WINDOW_SAMPLES);
                }
                state.lastSample = i;
                if ((state.progress || 0) >= (state.window || LADDER_BLEND_WINDOW_SAMPLES) || !Number.isFinite(info.blendCapNormalized)) {
                    blendTracker.delete(channelName);
                } else {
                    info.blendProgress = state.progress || 0;
                    info.blendWindow = state.window || LADDER_BLEND_WINDOW_SAMPLES;
                    blendTracker.set(channelName, state);
                }
            });
        }

        if (weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
            const shadowTracker = ensureShadowBlendTracker();
            if (deltaDensity < -DENSITY_EPSILON) {
                shadowTracker.forEach((state, channelName) => {
                    if (!state) {
                        shadowTracker.delete(channelName);
                        return;
                    }
                    const info = channelInfo.get(channelName);
                    if (!info) {
                        shadowTracker.delete(channelName);
                        return;
                    }
                    const appliedMagnitude = Math.max(0, Number(info.shadowBlendAppliedNormalized) || 0);
                    const capForChannel = Number.isFinite(info.shadowBlendCapNormalized)
                        ? info.shadowBlendCapNormalized
                        : Number.POSITIVE_INFINITY;
                    if (appliedMagnitude > DENSITY_EPSILON &&
                        capForChannel < Number.POSITIVE_INFINITY &&
                        appliedMagnitude >= capForChannel - (SHADOW_BLEND_CAP_STEP * 0.25)) {
                        state.progress = Math.min((state.progress || 0) + 1, state.window || SHADOW_BLEND_WINDOW_SAMPLES);
                    }
                    state.lastSample = i;
                    if ((state.progress || 0) >= (state.window || SHADOW_BLEND_WINDOW_SAMPLES) ||
                        !Number.isFinite(info.shadowBlendCapNormalized)) {
                        shadowTracker.delete(channelName);
                        info.shadowBlendCapNormalized = Number.POSITIVE_INFINITY;
                    } else {
                        info.shadowBlendProgress = state.progress || 0;
                        info.shadowBlendWindow = state.window || SHADOW_BLEND_WINDOW_SAMPLES;
                        shadowTracker.set(channelName, state);
                    }
                });
            } else if (deltaDensity > -DENSITY_EPSILON) {
                clearShadowBlendTracker();
            }
        }

        if (weightingMode === COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
            const blendTracker = ensureLadderBlendTracker();
            blendTracker.forEach((state, channelName) => {
                if (!state || state.active !== true) {
                    return;
                }
                const info = channelInfo.get(channelName);
                if (!info) {
                    blendTracker.delete(channelName);
                    return;
                }
                const appliedNormalized = Math.max(0, Number(info.blendAppliedNormalized) || 0);
                if (appliedNormalized > DENSITY_EPSILON || deltaDensity <= DENSITY_EPSILON) {
                    state.progress = Math.min((state.progress || 0) + 1, state.window || LADDER_BLEND_WINDOW_SAMPLES);
                }
                state.lastSample = i;
                if ((state.progress || 0) >= (state.window || LADDER_BLEND_WINDOW_SAMPLES) || !Number.isFinite(info.blendCapNormalized)) {
                    blendTracker.delete(channelName);
                } else {
                    info.blendProgress = state.progress || 0;
                    info.blendWindow = state.window || LADDER_BLEND_WINDOW_SAMPLES;
                    blendTracker.set(channelName, state);
                }
            });
        }

        channelInfo.forEach((info, name) => {
            if (!info || !info.curve) return;
            const normalizedThreshold = coverageBufferThresholdNormalized.get(name);
            const coverageCapacity = Number.isFinite(normalizedThreshold)
                ? Math.max(0, normalizedThreshold - info.normalized)
                : Number.POSITIVE_INFINITY;
            const endCapacity = Number.isFinite(info.headroomNormalized)
                ? Math.max(0, info.headroomNormalized)
                : Number.POSITIVE_INFINITY;
            const effectiveCapacity = Number.isFinite(info.effectiveHeadroomNormalized)
                ? Math.max(0, info.effectiveHeadroomNormalized)
                : endCapacity;
            if (!Number.isFinite(info.capacityBeforeNormalized)) {
                info.capacityBeforeNormalized = computeAvailableCapacityNormalized(info, {
                    coverageCapacity,
                    effectiveHeadroom: effectiveCapacity,
                    endCapacity
                });
            }
            info.capacityAfterNormalized = computeAvailableCapacityNormalized(info, {
                coverageCapacity,
                effectiveHeadroom: effectiveCapacity,
                endCapacity
            });
        });

        if (deltaDensity <= -DENSITY_EPSILON && i > 0) {
            channelInfo.forEach((info, name) => {
                if (!info || !info.curve || !Array.isArray(info.curve)) return;
                const previousValue = info.curve[i - 1];
                const currentValue = info.curve[i];
                if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) {
                    return;
                }
                if (currentValue > previousValue + DENSITY_EPSILON) {
                    const clampedValue = previousValue;
                    info.curve[i] = clampedValue;
                    info.current = clampedValue;
                    info.normalized = info.endValue > 0 ? clampedValue / info.endValue : 0;
                    info.headroom = Math.max(0, info.endValue - clampedValue);
                    info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;
                }
            });
        }

        if (smoothingContext) {
            recordSampleForSmoothing(smoothingContext, i, deltaDensity, contributions, weightMap);
        }

        if (weightingMode !== COMPOSITE_WEIGHTING_MODES.NORMALIZED) {
            channelInfo.forEach((info, name) => {
                if (!info || !info.curve) return;
                const baselineValue = Array.isArray(baselineSnapshot[name]) ? baselineSnapshot[name][i] : null;
                if (!Number.isFinite(baselineValue) || baselineValue <= 0) return;
                const minValue = Math.max(0, Math.round(baselineValue * ISOLATED_BASELINE_RETENTION));
                if (info.curve[i] < minValue) {
                    const clamped = Math.min(info.endValue > 0 ? info.endValue : TOTAL, minValue);
                    info.curve[i] = clamped;
                    info.current = clamped;
                    info.normalized = info.endValue > 0 ? clamped / info.endValue : 0;
                    info.headroom = Math.max(0, (info.endValue > 0 ? info.endValue : TOTAL) - clamped);
                    info.headroomNormalized = info.endValue > 0 ? info.headroom / info.endValue : 0;
                }
            });
        }

        if (captureDebug && debugSnapshots) {
            const ladderSelection = [];
            if (contributions && typeof contributions === 'object') {
                Object.entries(contributions).forEach(([name, normalized]) => {
                    const info = channelInfo.get(name);
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && name === 'C' && i === 16) {
                        console.log('[blendDebug]', {
                            i,
                            channel: name,
                            blendCap: info?.blendCapNormalized,
                            blendApplied: info?.blendAppliedNormalized
                        });
                    }
                    ladderSelection.push({
                        channel: name,
                        ladderIndex: ladderIndexByChannel.has(name) ? ladderIndexByChannel.get(name) : null,
                        normalizedApplied: Number(normalized) || 0,
                        floorNormalized: info ? info.coverageFloorNormalized : null,
                        allowedNormalized: info ? info.allowedNormalized : null,
                        layerNormalized: info ? info.layerNormalized : null,
                        blendCapNormalized: info && Number.isFinite(info.blendCapNormalized) ? info.blendCapNormalized : null,
                        blendAppliedNormalized: info ? info.blendAppliedNormalized : null,
                        blendWindow: info ? info.blendWindow : null,
                        blendProgress: info ? info.blendProgress : null,
                        reserveState: info ? info.reserveState : null,
                        shadowBlendCapNormalized: info && Number.isFinite(info.shadowBlendCapNormalized) ? info.shadowBlendCapNormalized : null,
                        shadowBlendAppliedNormalized: info ? info.shadowBlendAppliedNormalized : null,
                        shadowBlendWindow: info ? info.shadowBlendWindow : null,
                        shadowBlendProgress: info ? info.shadowBlendProgress : null,
                        shadowBlendFromChannel: info ? info.shadowBlendFromChannel : null
                    });
                });
                ladderSelection.sort((a, b) => {
                    const idxA = Number.isFinite(a.ladderIndex) ? a.ladderIndex : Number.POSITIVE_INFINITY;
                    const idxB = Number.isFinite(b.ladderIndex) ? b.ladderIndex : Number.POSITIVE_INFINITY;
                    return idxA - idxB;
                });
            }
            const ladderBlocked = Array.isArray(ladderTraceSnapshot?.blocked)
                ? ladderTraceSnapshot.blocked.map((entry) => ({
                    channel: entry?.channel || null,
                    reason: entry?.reason || null,
                    blockedBy: entry?.blockedBy || null,
                    headroom: typeof entry?.headroom === 'number' ? entry.headroom : null,
                    usage: typeof entry?.usage === 'number' ? entry.usage : null
                }))
                : [];
            const perChannelDebug = {};
            const correctedValues = new Map();
            let correctedInkTotal = 0;
            channelInfo.forEach((info, name) => {
                const correctedValue = Array.isArray(info.curve) ? Math.max(0, Number(info.curve[i]) || 0) : 0;
                correctedValues.set(name, correctedValue);
                correctedInkTotal += correctedValue;
            });
            channelInfo.forEach((info, name) => {
                const correctedValue = correctedValues.get(name) || 0;
                const endValue = info.endValue > 0 ? info.endValue : Math.max(0, Number(endValues[name]) || 0);
                const normalizedAfter = info.normalized;
                const baselineValue = info.baselineValue || 0;
                const baselineNormalized = info.baselineNormalized || 0;
                const baselineContribution = info.baselineContribution || 0;
                const densityContributionAfter = (info.weight || 0) * normalizedAfter;
                const thresholdNormalized = coverageBufferThresholdNormalized.get(name);
                const headroomBefore = Number.isFinite(thresholdNormalized)
                    ? Math.max(0, thresholdNormalized - baselineNormalized)
                    : (endValue > 0 ? Math.max(0, endValue - baselineValue) / endValue : 0);
                const headroomAfter = Number.isFinite(thresholdNormalized)
                    ? Math.max(0, thresholdNormalized - normalizedAfter)
                    : info.headroomNormalized;
                const ladderIndex = ladderIndexByChannel.has(name) ? ladderIndexByChannel.get(name) : null;

                perChannelDebug[name] = {
                    baselineValue,
                    correctedValue,
                    valueDelta: correctedValue - baselineValue,
                    normalizedBefore: baselineNormalized,
                    normalizedAfter,
                    normalizedDelta: normalizedAfter - baselineNormalized,
                    weight: info.weight || 0,
                    shareBefore: baselineInkTotal > 0 ? baselineValue / baselineInkTotal : 0,
                    shareAfter: correctedInkTotal > 0 ? correctedValue / correctedInkTotal : 0,
                    weightingShare: info.weightingShare,
                    densityShareBefore: baselineInkTotal > 0 ? baselineValue / baselineInkTotal : 0,
                    densityShareAfter: info.densityShare || 0,
                    headroomBefore,
                    headroomAfter,
                    densityContributionBefore: baselineContribution,
                    densityContributionAfter,
                    densityContributionDelta: densityContributionAfter - baselineContribution,
                    momentum: info.momentum || 0,
                    ladderIndex,
                    ladderHeadroom: headroomAfter,
                    coverageFloorNormalized: info.coverageFloorNormalized ?? 0,
                    allowedNormalized: info.allowedNormalized ?? null,
                    layerNormalized: info.layerNormalized ?? 0,
                    effectiveHeadroomAfter: info.effectiveHeadroomNormalized ?? headroomAfter,
                    frontReserveBase: info.frontReserveBase ?? 0,
                    frontReservePeak: info.frontReservePeak ?? 0,
                    frontReserveApplied: info.frontReserveApplied ?? 0,
                    frontReserveDarkerHeadroom: info.frontReserveDarkerHeadroom ?? 0,
                    reserveState: info.reserveState || null,
                    reserveAllowance: info.reserveAllowanceNormalized ?? 0,
                    reserveAllowanceRemaining: info.reserveAllowanceRemaining ?? 0,
                    capacityBeforeNormalized: Number.isFinite(info.capacityBeforeNormalized)
                        ? info.capacityBeforeNormalized
                        : null,
                    capacityAfterNormalized: Number.isFinite(info.capacityAfterNormalized)
                        ? info.capacityAfterNormalized
                        : null,
                    reserveReleaseScale: info.reserveReleaseScale ?? 1,
                    reserveReleaseHeadroom: info.reserveReleaseHeadroom ?? (info.effectiveHeadroomNormalized ?? headroomAfter),
                    blendCapNormalized: Number.isFinite(info.blendCapNormalized) ? info.blendCapNormalized : null,
                    blendAppliedNormalized: info.blendAppliedNormalized ?? 0,
                    blendWindow: info.blendWindow ?? null,
                    blendProgress: info.blendProgress ?? null,
                    blendLimited: info.blendLimited === true,
                    pendingBlendCap: Number.isFinite(info.pendingBlendCap) ? info.pendingBlendCap : null,
                    shadowBlendCapNormalized: Number.isFinite(info.shadowBlendCapNormalized) ? info.shadowBlendCapNormalized : null,
                    shadowBlendAppliedNormalized: info.shadowBlendAppliedNormalized ?? 0,
                    shadowBlendWindow: info.shadowBlendWindow ?? null,
                    shadowBlendProgress: info.shadowBlendProgress ?? null,
                    shadowBlendFromChannel: info.shadowBlendFromChannel ?? null
                };
            });
            const correctedInk = correctedInkTotal;
            debugSnapshots[i] = {
                index: i,
                inputPercent: (i / DENOM) * 100,
                targetDensity,
                measurementDensity: measurementSample != null ? measurementSample : null,
                deltaDensity,
                baselineInk: baselineInkTotal,
                correctedInk,
                inkDelta: correctedInk - baselineInkTotal,
                perChannel: perChannelDebug,
                weightingMode
            };
            debugSnapshots[i].ladderSelection = ladderSelection;
            debugSnapshots[i].ladderBlocked = ladderBlocked;
            debugSnapshots[i].ladderDirection = ladderTraceSnapshot?.direction || null;
            if (ladderTraceSnapshot) {
                debugSnapshots[i].ladderTrace = {
                    direction: ladderTraceSnapshot.direction || null,
                    remaining: typeof ladderTraceSnapshot.remaining === 'number' ? ladderTraceSnapshot.remaining : 0,
                    blocked: Array.isArray(ladderTraceSnapshot.blocked)
                        ? ladderTraceSnapshot.blocked.map((entry) => ({
                            channel: entry?.channel || null,
                            reason: entry?.reason || null,
                            blockedBy: entry?.blockedBy || null,
                            headroom: typeof entry?.headroom === 'number' ? entry.headroom : null,
                            usage: typeof entry?.usage === 'number' ? entry.usage : null
                        }))
                        : [],
                    sequence: Array.isArray(ladderTraceSnapshot.sequence)
                        ? ladderTraceSnapshot.sequence.map((entry) => ({
                            channel: entry?.channel || null,
                            ladderIndex: typeof entry?.ladderIndex === 'number' ? entry.ladderIndex : null,
                            normalizedApplied: typeof entry?.normalizedApplied === 'number' ? entry.normalizedApplied : 0,
                            iteration: typeof entry?.iteration === 'number' ? entry.iteration : null,
                            weight: typeof entry?.weight === 'number' ? entry.weight : null
                        }))
                        : []
                };
            }
                const smoothingForSample = Array.isArray(densityProfile?.smoothingWindows)
                    ? densityProfile.smoothingWindows.map((entry) => (
                        entry ? {
                            id: entry.id ?? null,
                            outgoingChannel: entry.outgoingChannel ?? null,
                            incomingChannels: Array.isArray(entry.incomingChannels) ? entry.incomingChannels.slice() : [],
                            position: entry.position ?? entry.t ?? 0,
                            outFactor: entry.outFactor ?? null,
                            forced: entry.forced === true
                        } : null
                    )).filter(Boolean)
                    : [];
            if (smoothingForSample.length) {
                debugSnapshots[i].smoothingWindows = smoothingForSample;
            }
            if (debugSelectionIndex == null && Math.abs(deltaDensity || 0) > 1e-4) {
                debugSelectionIndex = i;
            }
        }

        channelInfo.forEach((info, name) => {
            const state = peakStateByChannel.get(name);
            if (!state) return;
            const curve = correctedCurves[name];
            const value = Array.isArray(curve) ? Math.max(0, Number(curve[i]) || 0) : 0;
            const endValue = info.endValue > 0 ? info.endValue : Math.max(0, Number(endValues[name]) || 0);
            const normalized = endValue > 0 ? clamp01(value / endValue) : 0;
            if (!state.locked && normalized > state.maxNormalized + PEAK_RISE_EPSILON) {
                state.maxNormalized = normalized;
                state.maxValue = value;
                state.peakIndex = i;
            } else if (state.locked &&
                state.maxNormalized > PEAK_MIN_NORMALIZED &&
                normalized > state.maxNormalized + PEAK_RISE_EPSILON &&
                (i - state.peakIndex) <= Math.floor(DENOM * PEAK_REEVAL_WINDOW_RATIO)) {
                state.maxNormalized = normalized;
                state.maxValue = value;
                state.peakIndex = i;
           } else if (!state.locked &&
               state.maxNormalized > PEAK_MIN_NORMALIZED &&
               normalized + PEAK_DROP_TOLERANCE < state.maxNormalized &&
               (DENOM > 0 ? (i / DENOM) : 0) <= (SINGLE_PEAK_LOCK_RATIO + 0.02)) {
               state.locked = true;
               peakCompleted.set(name, true);
           }

            if (!state.locked) {
                const region = preferredRegionByChannel.get(name);
                if (region && i >= region.primaryEnd) {
                    state.locked = true;
                }
            }
        });

        emitCompositeAudit('sample.afterDistribution', (targetIndex) => {
            if (i !== targetIndex) return null;
            const measurementSample = Array.isArray(compositeLabSession.measurementSamples)
                ? compositeLabSession.measurementSamples[targetIndex]
                : null;
            const perChannel = Array.from(channelInfo.entries()).map(([name, info]) => {
                const correctedCurve = correctedCurves[name];
                const value = Array.isArray(correctedCurve) ? correctedCurve[targetIndex] : 0;
                const endValue = info.endValue;
                const normalized = endValue > 0 ? clamp01(value / endValue) : 0;
                const contribution = info.weight > 0 ? info.weight * normalized : 0;
                return {
                    channel: name,
                    correctedValue: value,
                    endValue,
                    normalized,
                    weight: info.weight,
                    densityContribution: contribution
                };
            });
            const correctedDensity = perChannel.reduce((sum, entry) => sum + entry.densityContribution, 0);
            return {
                sampleIndex: targetIndex,
                targetDensity,
                measurementSample,
                correctedDensity,
                perChannel
            };
        });

    channelInfo.forEach((_, name) => {
        if (peakCompleted.get(name)) return;
        const region = preferredRegionByChannel.get(name);
        if (!region) {
            peakCompleted.set(name, true);
            return;
        }
        if (i >= region.effectiveEnd) {
            peakCompleted.set(name, true);
        }
    });
}

    const autoRaiseInProgress = !!(compositeLabSession.autoRaiseContext && compositeLabSession.autoRaiseContext.evaluated === false);
    let slopeKernelResult = null;
    let slopeLimiterNormalized = null;
    const normalizedAggregate = {};
    let limiterChannelList = channels.slice();
    if (!autoRaiseInProgress && isSlopeKernelSmoothingEnabled()) {
        slopeKernelResult = applySnapshotSlopeKernel(correctedCurves, {
            channelNames: channels,
            endValues,
            thresholdPercent: SNAPSHOT_FLAG_THRESHOLD_PERCENT,
            debugSnapshots: captureDebug ? debugSnapshots : null
        });
        if (slopeKernelResult && slopeKernelResult.normalizedSeriesByChannel) {
            Object.assign(normalizedAggregate, slopeKernelResult.normalizedSeriesByChannel);
        }
        if (slopeKernelResult && Array.isArray(slopeKernelResult.appliedChannels) && slopeKernelResult.appliedChannels.length) {
            const skipLimiterSet = new Set(slopeKernelResult.appliedChannels);
            if (Array.isArray(slopeKernelResult.channelsNeedingLimiter)) {
                slopeKernelResult.channelsNeedingLimiter.forEach((name) => {
                    skipLimiterSet.delete(name);
                });
            }
            limiterChannelList = channels.filter((name) => !skipLimiterSet.has(name));
        }
    }
    if (!autoRaiseInProgress && limiterChannelList.length) {
        slopeLimiterNormalized = applySnapshotSlopeLimiter(correctedCurves, {
            channelNames: limiterChannelList,
            endValues
        });
        if (slopeLimiterNormalized) {
            Object.assign(normalizedAggregate, slopeLimiterNormalized);
        }
    }
    if (captureDebug && debugSnapshots && Object.keys(normalizedAggregate).length) {
        syncSnapshotsWithSlopeLimiter(debugSnapshots, {
            channelNames: channels,
            normalizedSeriesByChannel: normalizedAggregate,
            correctedCurves,
            endValues,
            densityWeights
        });
        if (debugSummary && typeof debugSummary === 'object' && debugSummary.channelMaxima) {
            channels.forEach((name) => {
                const curve = correctedCurves[name];
                if (!Array.isArray(curve)) {
                    return;
                }
                const maxValue = curve.reduce((max, value) => {
                    const numeric = Number(value) || 0;
                    return numeric > max ? numeric : max;
                }, 0);
                debugSummary.channelMaxima[name] = maxValue;
            });
        }
    }

    const peakIndexByChannel = new Map();
    Object.entries(correctedCurves).forEach(([name, curve]) => {
        if (!Array.isArray(curve) || curve.length !== CURVE_RESOLUTION) {
            return;
        }
        const state = peakStateByChannel.get(name);
        let peakIndex = state && Number.isFinite(state.peakIndex) ? state.peakIndex : 0;
        if (!Number.isFinite(peakIndex) || peakIndex < 0 || peakIndex > DENOM) {
            let localPeakIndex = 0;
            let localPeakValue = -Infinity;
            for (let idx = 0; idx < curve.length; idx += 1) {
                const value = Number(curve[idx]) || 0;
                if (value > localPeakValue) {
                    localPeakValue = value;
                    localPeakIndex = idx;
                }
            }
            peakIndex = localPeakIndex;
        }
        peakIndex = Math.max(0, Math.min(DENOM, peakIndex));
        const peakClamp = Math.round(Math.min(SINGLE_PEAK_LOCK_RATIO, 0.30) * DENOM);
        peakIndex = Math.min(peakIndex, peakClamp);
        peakIndexByChannel.set(name, peakIndex);
    });

    const warnings = [];
    saturationByChannel.forEach((percent, channelName) => {
        warnings.push(`${channelName} channel reaches ≥99% ink near ${percent}`);
    });

    saturationByIndex.forEach((names, index) => {
        if (names.length >= 2) {
            warnings.push(`Multiple channels (${names.join(', ')}) saturate near ${formatSamplePercent(index)}`);
        }
    });

    const peakIndices = {};
    peakIndexByChannel.forEach((value, name) => {
        peakIndices[name] = value;
    });

    channels.forEach((name) => {
        const curve = correctedCurves[name];
        const baseline = baselineSnapshot[name];
        if (Array.isArray(curve)) {
            correctedCurves[name] = preserveLeadingInk(curve, baseline);
        }
    });

    const recomputedCoverageUsage = new Map();
    channels.forEach((name) => {
        const endValue = Math.max(0, Number(endValues[name]) || 0);
        const curve = correctedCurves[name];
        if (!endValue || !Array.isArray(curve) || !curve.length) {
            recomputedCoverageUsage.set(name, 0);
            return;
        }
        let maxUsage = 0;
        for (let idx = 0; idx < curve.length; idx += 1) {
            const value = Math.max(0, Number(curve[idx]) || 0);
            const usage = Math.max(0, Math.min(1, value / TOTAL));
            if (usage > maxUsage) {
                maxUsage = usage;
            }
        }
        recomputedCoverageUsage.set(name, maxUsage);
    });
    if (coverageUsage instanceof Map) {
        coverageUsage.clear();
        recomputedCoverageUsage.forEach((value, name) => {
            coverageUsage.set(name, value);
        });
    }

    const refreshedCoverage = buildCoverageSummary(channels, {
        coverageLimits,
        coverageBuffers,
        coverageThresholds: coverageBufferThreshold,
        coverageUsage,
        coverageClampEvents
    });
    const refreshedCoverageSummary = cloneCoverageSummary(refreshedCoverage.plain);
    compositeLabSession.densityCoverage = refreshedCoverage.map;
    compositeLabSession.densityCoverageSummary = refreshedCoverageSummary;
    densityWeightsInfo.coverageByChannel = refreshedCoverage.map;
    densityWeightsInfo.coverageSummary = refreshedCoverageSummary;
    if (debugSummary) {
        debugSummary.coverageSummary = cloneCoverageSummary(refreshedCoverageSummary);
        debugSummary.coverageLimits = mapToPlainObject(coverageLimits);
        debugSummary.coverageBuffers = mapToPlainObject(coverageBuffers);
        const clampSnapshot = {};
        if (coverageClampEvents instanceof Map) {
            coverageClampEvents.forEach((events, channel) => {
                clampSnapshot[channel] = Array.isArray(events)
                    ? events.map((entry) => ({ ...(entry || {}) }))
                    : [];
            });
        } else if (coverageClampEvents && typeof coverageClampEvents === 'object') {
            Object.keys(coverageClampEvents).forEach((channel) => {
                const events = coverageClampEvents[channel];
                clampSnapshot[channel] = Array.isArray(events)
                    ? events.map((entry) => ({ ...(entry || {}) }))
                    : [];
            });
        }
        debugSummary.coverageClampEvents = clampSnapshot;
    }

    if (captureDebug) {
        const summaryPayload = debugSummary ? { ...debugSummary } : {};
        if (summaryPayload.channelMaxima && typeof summaryPayload.channelMaxima === 'object') {
            Object.keys(summaryPayload.channelMaxima).forEach((name) => {
                const curve = correctedCurves[name];
                if (!Array.isArray(curve)) {
                    return;
                }
                const maxValue = curve.reduce((max, value) => {
                    const numeric = Number(value) || 0;
                    return numeric > max ? numeric : max;
                }, 0);
                summaryPayload.channelMaxima[name] = maxValue;
            });
        }
        summaryPayload.warnings = warnings.slice();
        summaryPayload.peakIndices = { ...peakIndices };
        summaryPayload.densityLadder = densityLadder.slice();
        summaryPayload.ladderOrderIndex = { ...ladderIndicesPlain };
        const snapshotsPayload = Array.isArray(debugSnapshots) ? debugSnapshots.slice() : [];
        const snapshotFlags = computeSnapshotFlags(snapshotsPayload, {
            thresholdPercent: SNAPSHOT_FLAG_THRESHOLD_PERCENT,
            autoRaiseInProgress: !!(compositeLabSession.autoRaiseContext && compositeLabSession.autoRaiseContext.evaluated === false),
            channelNames: Array.isArray(summaryPayload.channelNames) && summaryPayload.channelNames.length
                ? summaryPayload.channelNames.slice()
                : Array.isArray(channels) ? channels.slice() : []
        });
        if (Object.keys(snapshotFlags).length) {
            summaryPayload.snapshotFlags = {
                count: Object.keys(snapshotFlags).length,
                thresholdPercent: SNAPSHOT_FLAG_THRESHOLD_PERCENT
            };
        } else if (Object.prototype.hasOwnProperty.call(summaryPayload, 'snapshotFlags')) {
            delete summaryPayload.snapshotFlags;
        }
        const sessionPayload = {
            summary: summaryPayload,
            snapshots: snapshotsPayload,
            selectionIndex: debugSelectionIndex,
            snapshotFlags,
            flags: snapshotFlags
        };
        compositeLabSession.lastDebugSession = sessionPayload;
        storeCompositeDebugSession(sessionPayload);
        if (typeof globalScope === 'object' && globalScope) {
            globalScope.__COMPOSITE_DEBUG_CACHE__ = sessionPayload;
        }
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[COMPOSITE] debug payload ready', {
                summaryKeys: Object.keys(summaryPayload),
                snapshotCount: snapshotsPayload.filter((entry) => !!entry).length
            });
        }
    } else {
        compositeLabSession.lastDebugSession = null;
        storeCompositeDebugSession(null);
        if (typeof globalScope === 'object' && globalScope && Object.prototype.hasOwnProperty.call(globalScope, '__COMPOSITE_DEBUG_CACHE__')) {
            globalScope.__COMPOSITE_DEBUG_CACHE__ = null;
        }
    }

    compositeLabSession.warnings = warnings;
    compositeLabSession.peakIndices = peakIndices;
    compositeLabSession.active = false;
    compositeLabSession.preparedContext = null;

    if (LinearizationState && typeof LinearizationState === 'object') {
        if (typeof LinearizationState.setGlobalBaselineCurves === 'function') {
            LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
        }
        if (typeof LinearizationState.setGlobalCorrectedCurves === 'function') {
            LinearizationState.setGlobalCorrectedCurves(correctedCurves);
        }
        if (typeof LinearizationState.setGlobalWarnings === 'function') {
            LinearizationState.setGlobalWarnings(warnings);
        }
        if (typeof LinearizationState.setGlobalBakedMeta === 'function') {
            LinearizationState.setGlobalBakedMeta({
                source: 'compositeLab',
                timestamp: Date.now(),
                channels: Array.isArray(channels) ? channels.slice() : []
            });
        }
        if (typeof LinearizationState.setCompositeCoverageSummary === 'function') {
            LinearizationState.setCompositeCoverageSummary(compositeLabSession.densityCoverageSummary);
        }
    }

    const densityAccessor = (inputPercent) => getCompositeDensityProfile(inputPercent);
    const coverageAccessor = () => getCompositeCoverageSummary();
    if (LinearizationState && typeof LinearizationState === 'object') {
        LinearizationState.getCompositeDensityProfile = densityAccessor;
        LinearizationState.getCompositeCoverageSummary = coverageAccessor;
    }
    if (globalScope && typeof globalScope.LinearizationState === 'object') {
        try {
            Object.defineProperty(globalScope.LinearizationState, 'getCompositeDensityProfile', {
                value: densityAccessor,
                configurable: true,
                writable: true
            });
            Object.defineProperty(globalScope.LinearizationState, 'getCompositeCoverageSummary', {
                value: coverageAccessor,
                configurable: true,
                writable: true
            });
        } catch (error) {
            globalScope.LinearizationState.getCompositeDensityProfile = densityAccessor;
            globalScope.LinearizationState.getCompositeCoverageSummary = coverageAccessor;
        }
    }
    if (globalScope && typeof globalScope === 'object') {
        globalScope.getCompositeDensityProfile = densityAccessor;
        globalScope.getCompositeCoverageSummary = coverageAccessor;
    }

    return {
        curves: correctedCurves,
        warnings,
        peakIndices,
        weights: compositeLabSession.densityWeights instanceof Map
            ? Array.from(compositeLabSession.densityWeights.entries())
            : [],
        measurementSamples: Array.isArray(compositeLabSession.measurementSamples)
            ? compositeLabSession.measurementSamples.slice()
            : []
    };
}

export function replayCompositeDebugSessionFromCache() {
    if (!isCompositeDebugEnabled()) {
        return false;
    }
    const payload = compositeLabSession.lastDebugSession;
    if (!payload || !payload.summary || !Array.isArray(payload.snapshots)) {
        return false;
    }
    storeCompositeDebugSession(payload);
    return true;
}

export function getCompositeDebugSessionCache() {
    const payload = compositeLabSession.lastDebugSession;
    if (!payload || !payload.summary || !Array.isArray(payload.snapshots)) {
        return null;
    }
    return {
        summary: payload.summary,
        snapshotCount: payload.snapshots.filter((entry) => !!entry).length,
        selectionIndex: payload.selectionIndex ?? null
    };
}

export function getCompositeLabWarnings() {
    return compositeLabSession.warnings ? compositeLabSession.warnings.slice() : [];
}

export function estimateCompositeDensity(channelNames, overrides = null, options = {}) {
    if (!compositeLabSession.active) {
        return null;
    }
    const targetChannels = Array.isArray(channelNames) && channelNames.length
        ? channelNames
        : compositeLabSession.channels;
    if (!Array.isArray(targetChannels) || !targetChannels.length) {
        return null;
    }
    let effectiveOverrides = overrides;
    const hasOverrides =
        effectiveOverrides instanceof Map
            ? effectiveOverrides.size > 0
            : effectiveOverrides && typeof effectiveOverrides === 'object'
                ? Object.keys(effectiveOverrides).length > 0
                : false;
    if (!hasOverrides) {
        effectiveOverrides = compositeLabSession.densityOverrides instanceof Map
            ? compositeLabSession.densityOverrides
            : compositeLabSession.densityOverrides || null;
    }
    const weightInfo = computeCompositeDensityWeights(
        targetChannels,
        compositeLabSession.baseCurves,
        compositeLabSession.endValues,
        compositeLabSession.normalizedEntry,
        {
            weightingMode: compositeLabSession.weightingMode,
            smoothingPercent: compositeLabSession.smoothingPercent,
            manualDensityOverrides: effectiveOverrides || undefined,
            autoComputeEnabled: options.autoComputeEnabled !== false
        }
    );
    return weightInfo || null;
}

export function estimateChannelDensity(channelName, overrides = null, options = {}) {
    if (!channelName) return null;
    const info = estimateCompositeDensity(compositeLabSession.channels, overrides, options);
    if (!info || !info.weights) {
        return null;
    }
    const value = info.weights instanceof Map
        ? info.weights.get(channelName)
        : info.weights[channelName];
    return Number.isFinite(value) ? value : null;
}

export function getCompositeDensityProfile(inputPercent = 0) {
    const profiles = compositeLabSession.densityProfiles;
    const constantsMap = compositeLabSession.densityConstants instanceof Map
        ? compositeLabSession.densityConstants
        : null;

    if (Array.isArray(profiles) && profiles.length > 0) {
        const cumulative = compositeLabSession.densityCumulative || {};
        const channelNames = Array.isArray(compositeLabSession.channels) ? compositeLabSession.channels : [];
        return buildDensityProfileResponse(
            inputPercent,
            profiles,
            constantsMap,
            cumulative,
            channelNames,
            compositeLabSession.measurementDeltas
        );
    }

    const globalData = LinearizationState?.getGlobalData?.();
    const correctedCurves = LinearizationState?.globalCorrectedCurves;
    if (!globalData || !correctedCurves) {
        return null;
    }

    const normalizedEntry = normalizeLinearizationEntry(ensurePrinterSpaceData(globalData));
    if (!normalizedEntry) {
        return null;
    }

    const channelNames = Object.keys(correctedCurves).filter((name) => {
        const arr = correctedCurves[name];
        return Array.isArray(arr) && arr.length === CURVE_RESOLUTION;
    });
    if (!channelNames.length) {
        return null;
    }

    const endValues = {};
    channelNames.forEach((name) => {
        const curve = correctedCurves[name];
        let maxVal = 0;
        for (let i = 0; i < curve.length; i += 1) {
            const value = Number(curve[i]) || 0;
            if (value > maxVal) {
                maxVal = value;
            }
        }
        endValues[name] = maxVal;
    });

    const fallbackMode = getCompositeWeightingMode();

    const densityContext = computeCompositeDensityWeights(
        channelNames,
        correctedCurves,
        endValues,
        normalizedEntry,
        {
            weightingMode: fallbackMode,
            smoothingPercent: normalizedEntry?.previewSmoothingPercent ?? getLabSmoothingPercent()
        }
    );

    return buildDensityProfileResponse(
        inputPercent,
        densityContext.profiles,
        densityContext.constants,
        densityContext.cumulativeDensity,
        channelNames,
        densityContext.measurementDeltas
    );
}

function buildDensityProfileResponse(inputPercent, profiles, constants, cumulative, channelNames, measurementDeltas) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        return null;
    }

    const normalized = clamp01(Number.isFinite(inputPercent) ? inputPercent / 100 : 0);
    const index = Math.max(0, Math.min(DENOM, Math.round(normalized * DENOM)));
    const profile = profiles[index];
    if (!profile) {
        return null;
    }

    const constantsMap = constants instanceof Map
        ? constants
        : new Map(constants ? Object.entries(constants) : []);

    const perChannel = {};
    const nameSet = new Set([
        ...(Array.isArray(channelNames) ? channelNames : []),
        ...Array.from(constantsMap.keys())
    ]);

    nameSet.forEach((name) => {
        if (!name) return;
        const shareValue = profile.shares && typeof profile.shares[name] === 'number' ? profile.shares[name] : 0;
        const constantValue = constantsMap.get(name) || 0;
        perChannel[name] = {
            share: shareValue,
            constant: constantValue,
            cumulative: cumulative?.[name] || 0
        };
    });

    return {
        input: Math.round((index / DENOM) * 100),
        densityDelta: profile.density || (Array.isArray(measurementDeltas) ? measurementDeltas[index] || 0 : 0),
        perChannel
    };
}

export function getCompositeCoverageSummary() {
    if (compositeLabSession.densityCoverageSummary && Object.keys(compositeLabSession.densityCoverageSummary).length) {
        return cloneCoverageSummary(compositeLabSession.densityCoverageSummary);
    }
    if (LinearizationState && typeof LinearizationState.getCompositeCoverageSummary === 'function') {
        const summary = LinearizationState.getCompositeCoverageSummary();
        if (summary) {
            return summary;
        }
    }
    return null;
}

if (LinearizationState && typeof LinearizationState === 'object' &&
    typeof LinearizationState.getCompositeDensityProfile !== 'function') {
    LinearizationState.getCompositeDensityProfile = (inputPercent) => getCompositeDensityProfile(inputPercent);
}
if (LinearizationState && typeof LinearizationState === 'object' &&
    typeof LinearizationState.getCompositeCoverageSummary !== 'function') {
    LinearizationState.getCompositeCoverageSummary = () => getCompositeCoverageSummary();
}
if (globalScope && typeof globalScope === 'object' &&
    globalScope.LinearizationState &&
    typeof globalScope.LinearizationState === 'object' &&
    typeof globalScope.LinearizationState.getCompositeDensityProfile !== 'function') {
    globalScope.LinearizationState.getCompositeDensityProfile = (inputPercent) => getCompositeDensityProfile(inputPercent);
}
if (globalScope && typeof globalScope === 'object' &&
    globalScope.LinearizationState &&
    typeof globalScope.LinearizationState === 'object' &&
    typeof globalScope.LinearizationState.getCompositeCoverageSummary !== 'function') {
    globalScope.LinearizationState.getCompositeCoverageSummary = () => getCompositeCoverageSummary();
}
if (globalScope && typeof globalScope === 'object' &&
    typeof globalScope.getCompositeDensityProfile !== 'function') {
    globalScope.getCompositeDensityProfile = (inputPercent) => getCompositeDensityProfile(inputPercent);
}
if (globalScope && typeof globalScope === 'object' &&
    typeof globalScope.getCompositeCoverageSummary !== 'function') {
    globalScope.getCompositeCoverageSummary = () => getCompositeCoverageSummary();
}

/**
 * Auto endpoint rolloff configuration and processing
 * This handles the soft knee/toe application for preventing flat ceilings/floors
 */
export const AutoEndpointRolloff = {
    /**
     * Apply auto endpoint rolloff to values
     * @param {Array<number>} values - Input curve values
     * @param {number} endValue - Channel end value
     * @param {string} channelName - Channel name
     * @param {Object} options - Rolloff options
     * @returns {Array<number>} Values with rolloff applied
     */
    apply(values, endValue, channelName, options = {}) {
        try {
            const Np = values.length;
            if (Np < 8 || endValue <= 0) return values;

            const applyWhite = !!options.applyWhite;
            const applyBlack = !!options.applyBlack;
            if (!applyWhite && !applyBlack) return values;

            const arr = values.slice();
            const last = Np - 1;

            // Get configuration parameters
            const limitProximityPct = AUTO_LIMIT_CONFIG.getNumber('limitProximityPct');
            const slopeAbsolutePct = AUTO_LIMIT_CONFIG.getNumber('slopeAbsolutePct');
            const sustain = Math.max(1, Math.round(AUTO_LIMIT_CONFIG.getNumber('sustainSamples')));
            const minWidthPct = AUTO_LIMIT_CONFIG.getNumber('minWidthPct');
            const blackShoulderScanStartPct = AUTO_LIMIT_CONFIG.getNumber('blackShoulderScanStartPct');
            const whiteToeScanEndPct = AUTO_LIMIT_CONFIG.getNumber('whiteToeScanEndPct');
            const fallbackPlateauPct = AUTO_LIMIT_CONFIG.getNumber('fallbackPlateauPct');

            // Compute slopes (first differences)
            const slopes = new Array(Np).fill(0);
            for (let i = 1; i < Np; i++) slopes[i] = arr[i] - arr[i-1];

            // Thresholds
            const epsY = Math.max(1, Math.round((limitProximityPct / 100) * endValue));
            const slopeThresholdFraction = Math.max(0, slopeAbsolutePct) / 100;
            const normalizedDenom = Math.max(1, endValue);
            const minWidthIdx = Math.max(1, Math.round((minWidthPct / 100) * last));
            const fallbackRequirementIdx = Math.max(sustain, Math.round((fallbackPlateauPct / 100) * last));

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[AUTO LIMIT] begin', {
                    channelName,
                    Np,
                    endValue,
                    epsY,
                    slopeThresholdFraction,
                    sustain,
                    minWidthIdx,
                    arrHead: arr.slice(0,8),
                    arrTail: arr.slice(-8)
                });
            }

            let whiteStart = null; // shoulder toward channel end (black limit)
            if (applyBlack) {
                // Scan the right-hand side of the curve (high input near the ink ceiling)
                const startScanW = Math.max(1, Math.floor((blackShoulderScanStartPct / 100) * last));
                for (let i = startScanW; i <= last - sustain; i++) {
                    const nearCap = (endValue - arr[i]) <= epsY;
                    if (!nearCap) continue;
                    // Rolling low slope sustain
                    let ok = true;
                    for (let k = 0; k < sustain; k++) {
                        const normalizedSlope = Math.abs(slopes[i + k]) / normalizedDenom;
                        if (normalizedSlope > slopeThresholdFraction) { ok = false; break; }
                    }
                    if (ok) { whiteStart = i; break; }
                }
            }

            if (applyBlack && whiteStart == null) {
                let capCount = 0;
                for (let i = last; i >= 0; i--) {
                    if ((endValue - arr[i]) <= epsY) capCount++;
                    else break;
                }
                const requiredCap = Math.max(fallbackRequirementIdx, minWidthIdx);
                if (capCount >= requiredCap) {
                    whiteStart = Math.max(1, Math.round(0.88 * last));
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[AUTO LIMIT] fallback white knee', { whiteStart, capCount, requiredCap });
                    }
                }
            }

            if (applyBlack && whiteStart != null) {
                const capAllowance = Math.max(1, Math.round(epsY / 2));
                if ((endValue - arr[whiteStart]) > capAllowance) {
                    let search = whiteStart;
                    while (search <= last && (endValue - arr[search]) > capAllowance) search++;
                    if (search <= last && (endValue - arr[search]) <= capAllowance) {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[AUTO LIMIT] adjusting white knee forward', { prev: whiteStart, next: search });
                        }
                        whiteStart = search;
                    } else {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[AUTO LIMIT] skipping white knee; delta too large', { whiteStart, value: arr[whiteStart], capAllowance });
                        }
                        whiteStart = null;
                    }
                }
            }

            if (applyBlack && whiteStart != null) {
                const targetWidth = Math.max(3, minWidthIdx);
                if ((last - whiteStart) < targetWidth) {
                    whiteStart = Math.max(1, last - targetWidth);
                }
            }

            let blackEnd = null; // toe near zero output (white limit)
            if (applyWhite) {
                // Scan the left-hand side (low input near zero ink)
                const endScanB = Math.min(last-1, Math.ceil((whiteToeScanEndPct / 100) * last));
                for (let j = endScanB; j >= sustain; j--) {
                    const nearFloor = arr[j] <= epsY;
                    if (!nearFloor) continue;
                    let ok = true;
                    for (let k = 0; k < sustain; k++) {
                        const normalizedSlope = Math.abs(slopes[j - k]) / normalizedDenom;
                        if (normalizedSlope > slopeThresholdFraction) { ok = false; break; }
                    }
                    if (ok) { blackEnd = j; break; }
                }
            }

            if (applyWhite && blackEnd == null) {
                let floorCount = 0;
                for (let i = 0; i <= last; i++) {
                    if (arr[i] <= epsY) floorCount++;
                    else break;
                }
                const requiredFloor = Math.max(fallbackRequirementIdx, minWidthIdx);
                if (floorCount >= requiredFloor) {
                    blackEnd = Math.min(last - 1, Math.round((whiteToeScanEndPct / 100) * last));
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[AUTO LIMIT] fallback black toe', { blackEnd, floorCount, requiredFloor });
                    }
                }
            }

            if (applyWhite && blackEnd != null) {
                const floorAllowance = Math.max(1, Math.round(epsY / 2));
                if (arr[blackEnd] > floorAllowance) {
                    let search = blackEnd;
                    while (search >= 0 && arr[search] > floorAllowance) search--;
                    if (search >= 0 && arr[search] <= floorAllowance) {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[AUTO LIMIT] adjusting black toe backward', { prev: blackEnd, next: search });
                        }
                        blackEnd = search;
                    } else {
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[AUTO LIMIT] skipping black toe; delta too large', { blackEnd, value: arr[blackEnd], floorAllowance });
                        }
                        blackEnd = null;
                    }
                }
            }

            if (applyWhite && blackEnd != null) {
                const targetWidth = Math.max(3, minWidthIdx);
                if (blackEnd < targetWidth) {
                    blackEnd = Math.min(last - 1, targetWidth);
                }
            }

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[AUTO LIMIT] detected indices', { whiteStart, blackEnd });
            }

            // Apply soft shoulder for white end (black limit)
            let whiteWidth = 0;
            if (applyBlack && whiteStart != null) {
                // Backtrack to ensure y0 is meaningfully below End (avoid degenerate knee)
                let ws = whiteStart;
                const backLimit = Math.max(0, ws - Math.round(0.10 * last)); // search up to 10% back
                while (ws > backLimit && (endValue - arr[ws]) < epsY) ws--;
                if ((endValue - arr[ws]) >= epsY) whiteStart = ws;

                // Fallback: if still too close to End, force a start earlier than the first near-cap crossing
                if ((endValue - arr[whiteStart]) < epsY) {
                    const capThresh = Math.max(Math.round(0.02 * endValue), 2 * epsY); // ≥2% or 2×epsY
                    let firstCross = last;
                    for (let i = Math.floor(0.70 * last); i <= last; i++) {
                        if ((endValue - arr[i]) <= epsY) { firstCross = i; break; }
                    }
                    let forced = Math.max(1, firstCross - Math.round(0.05 * last));
                    while (forced > 1 && (endValue - arr[forced]) < capThresh) forced--;
                    whiteStart = Math.max(1, Math.min(whiteStart, forced));
                }

                const width = last - whiteStart;
                const debugBefore = (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) ?
                    arr.slice(Math.max(0, whiteStart - 2), Math.min(last + 1, whiteStart + Math.max(6, Math.round(0.2 * width)))) : null;

                if (width >= Math.max(3, minWidthIdx)) {
                    // Ensure the join value is not below the left neighbor to keep monotone
                    const y0 = Math.max(arr[whiteStart], arr[Math.max(0, whiteStart - 1)] || 0);
                    const m0 = Math.max(0, slopes[Math.max(1, whiteStart)]); // incoming slope
                    const m1 = 0; // flat at the endpoint
                    const W = (last - whiteStart) || 1;

                    // C1-continuous cubic Hermite shoulder
                    for (let i = whiteStart; i <= last; i++) {
                        const t = (i - whiteStart) / W;
                        const t2 = t * t, t3 = t2 * t;
                        const h00 = 2*t3 - 3*t2 + 1;
                        const h10 = t3 - 2*t2 + t;
                        const h01 = -2*t3 + 3*t2;
                        const h11 = t3 - t2;
                        let y = h00 * y0 + h10 * m0 * W + h01 * endValue + h11 * m1 * W;
                        y = Math.max(0, Math.min(endValue, y));
                        const prev = (i > 0) ? arr[i-1] : 0;
                        arr[i] = Math.max(prev, Math.round(y)); // enforce monotone non-decreasing
                    }
                    whiteWidth = Math.round((width / last) * 1000) / 10; // percentage with 0.1 precision

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        const debugAfter = arr.slice(Math.max(0, whiteStart - 2), Math.min(last + 1, whiteStart + Math.max(6, Math.round(0.2 * width))));
                        console.log('[AUTO LIMIT] black segment', { startIndex: whiteStart, width, before: debugBefore, after: debugAfter });
                    }
                } else {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[AUTO LIMIT] white knee too narrow, skipping', { whiteStart, width, minWidthIdx });
                    }
                }
            }

            // Apply soft toe for black end (white limit)
            let blackWidth = 0;
            if (applyWhite && blackEnd != null) {
                // Advance to ensure y1 is meaningfully above 0 (avoid degenerate toe)
                let be = blackEnd;
                const fwdLimit = Math.min(last, be + Math.round(0.10 * last));
                while (be < fwdLimit && arr[be] < epsY) be++;
                if (arr[be] >= epsY) blackEnd = be;

                // Fallback: if still near 0, force a later join beyond the floor crossing
                if (arr[blackEnd] < epsY) {
                    const floorThresh = Math.max(Math.round(0.02 * endValue), 2 * epsY);
                    let lastFloor = 0;
                    for (let i = Math.ceil(0.30 * last); i >= 0; i--) {
                        if (arr[i] <= epsY) { lastFloor = i; break; }
                    }
                    let forced = Math.min(last - 1, lastFloor + Math.round(0.05 * last));
                    while (forced < last - 1 && arr[forced] < floorThresh) forced++;
                    blackEnd = Math.min(blackEnd, forced);
                }

                const width = blackEnd - 0;
                const debugBeforeB = (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) ?
                    arr.slice(Math.max(0, blackEnd - Math.max(6, Math.round(0.2 * width))), Math.min(last + 1, blackEnd + 2)) : null;

                if (width >= Math.max(3, minWidthIdx)) {
                    const y1 = arr[blackEnd];
                    const m0 = 0; // slope 0 at x=0
                    // outgoing slope at the join (use forward diff if possible)
                    const m1 = Math.max(0, slopes[Math.max(1, blackEnd)]);
                    const W = Math.max(1, blackEnd - 0);

                    for (let i = 0; i <= blackEnd; i++) {
                        const t = i / W;
                        const t2 = t * t, t3 = t2 * t;
                        const h00 = 2*t3 - 3*t2 + 1;
                        const h10 = t3 - 2*t2 + t;
                        const h01 = -2*t3 + 3*t2;
                        const h11 = t3 - t2;
                        let y = h00 * 0 + h10 * m0 * W + h01 * y1 + h11 * m1 * W;
                        y = Math.max(0, Math.min(endValue, y));
                        // Raise toward y but do not exceed the later segment
                        const next = (i < last) ? arr[Math.min(last, i+1)] : y;
                        arr[i] = Math.min(Math.max(arr[i], Math.round(y)), next);
                    }
                    blackWidth = Math.round((width / last) * 1000) / 10;

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        const debugAfterB = arr.slice(Math.max(0, blackEnd - Math.max(6, Math.round(0.2 * width))), Math.min(last + 1, blackEnd + 2));
                        console.log('[AUTO LIMIT] white segment', { endIndex: blackEnd, width, before: debugBeforeB, after: debugAfterB });
                    }
                } else {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[AUTO LIMIT] black toe too narrow, skipping', { blackEnd, width, minWidthIdx });
                    }
                }
            }

            // Record meta for UI labels
            try {
                const meta = { debug: { epsY, slopeThresholdFraction, sustain, minWidthIdx, whiteStart, blackEnd } };
                if (applyBlack && whiteStart != null && whiteWidth > 0) {
                    meta.black = { startIndex: whiteStart, widthPercent: whiteWidth };
                }
                if (applyWhite && blackEnd != null && blackWidth > 0) {
                    meta.white = { endIndex: blackEnd, widthPercent: blackWidth };
                }
                if (channelName) {
                    if (meta.black || meta.white) {
                        setChannelAutoLimitMeta(channelName, meta);
                    } else {
                        clearChannelAutoLimitMeta(channelName);
                    }
                }
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && channelName) {
                    console.log('[AUTO LIMIT] result', channelName, meta);
                }
            } catch (err) {}

            return arr;

        } catch (error) {
            console.warn('Auto rolloff error:', error);
            return values.slice();
        }
    },

    /**
     * Check if auto rolloff should be applied
     * @param {string} type - 'white' or 'black'
     * @returns {boolean} True if should apply
     */
    shouldApply(type) {
        if (type === 'white') {
            return elements.autoWhiteLimitToggle?.checked || false;
        } else if (type === 'black') {
            return elements.autoBlackLimitToggle?.checked || false;
        }
        return false;
    }
};

/**
 * Build base curve for a channel
 * This is the foundation curve before any corrections are applied
 * @param {number} endValue - Channel end value
 * @param {string} channelName - Channel name
 * @param {boolean} smartCurveDetected - Whether Smart Curve is detected
 * @returns {Object} Base curve result
 */
export function buildBaseCurve(endValue, channelName, smartCurveDetected = false, options = {}) {
    try {
        if (endValue === 0) {
            return {
                shortCircuit: true,
                values: new Array(CURVE_RESOLUTION).fill(0)
            };
        }

        const data = getLoadedQuadData();
        const preferOriginalBaseline = !!(options && options.preferOriginalBaseline);
        const sourceTag = data?.sources?.[channelName];
        const isTaggedSmart = isSmartCurveSourceTag(sourceTag);
        const originalCurve = Array.isArray(data?.originalCurves?.[channelName])
            ? data.originalCurves[channelName]
            : null;

        if (data && data.curves && data.curves[channelName]) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[buildBaseCurve] using loaded curve', {
                    channelName,
                    smartCurveDetected,
                    sourceTag: data.sources?.[channelName],
                    max: Math.max(...data.curves[channelName]),
                    sample0: data.curves[channelName][0],
                    sample128: data.curves[channelName][128],
                    sample255: data.curves[channelName][255]
                });
            }
            const loadedCurve = data.curves[channelName];
            if (!Array.isArray(loadedCurve) || loadedCurve.length === 0 || Math.max(...loadedCurve) === 0) {
                return {
                    shortCircuit: true,
                    values: new Array(CURVE_RESOLUTION).fill(0)
                };
            }

            const baselineCurve = preferOriginalBaseline && originalCurve ? originalCurve : loadedCurve;

            let treatAsSmart = (smartCurveDetected || isTaggedSmart) && !preferOriginalBaseline;
            if (!treatAsSmart && isTaggedSmart) {
                try {
                    const curveMax = Math.max(...baselineCurve);
                    const baseline = data?.baselineEnd?.[channelName];
                    if (curveMax >= TOTAL * 0.99 && typeof baseline === 'number' && baseline > 0) {
                        treatAsSmart = true;
                    }
                } catch (err) {
                    // ignore heuristic failure
                }
            }

            if (treatAsSmart) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[buildBaseCurve] treat as Smart (using stored Smart samples)', {
                        channelName,
                        endValue,
                        curveMax: Math.max(...baselineCurve)
                    });
                }

                return {
                    shortCircuit: false,
                    values: baselineCurve.slice()
                };
            }

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[buildBaseCurve] treat as loaded measurement', {
                    channelName,
                    endValue,
                    preferOriginalBaseline,
                    hasOriginalCurve: !!originalCurve
                });
            }

            const baseline = (data.baselineEnd && typeof data.baselineEnd[channelName] === 'number')
                ? data.baselineEnd[channelName]
                : Math.max(...baselineCurve);
            const scale = baseline > 0 ? (endValue / baseline) : 0;
            return {
                shortCircuit: false,
                values: baselineCurve.map((v) => Math.round(v * scale))
            };
        }

        const controlPoints = ControlPoints.get(channelName);
        if (controlPoints && controlPoints.points && controlPoints.points.length >= 2) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[buildBaseCurve] falling back to ControlPoints sample', { channelName, endValue, pointCount: controlPoints.points.length });
            }
            const interp = controlPoints.interpolation === 'linear' ? 'linear' : 'smooth';
            const normalized = ControlPoints.normalize(controlPoints.points);
            const values = new Array(CURVE_RESOLUTION);

            for (let i = 0; i < CURVE_RESOLUTION; i++) {
                const x = (i / DENOM) * 100;
                const percent = ControlPoints.sampleY(normalized, interp, x);
                const clamped = Math.max(0, Math.min(100, percent));
                values[i] = Math.round((clamped / 100) * endValue);
            }

            return {
                shortCircuit: false,
                values
            };
        }

        const ramp = new Array(CURVE_RESOLUTION);
        const step = endValue / DENOM;
        for (let i = 0; i < CURVE_RESOLUTION; i++) {
            ramp[i] = Math.round(i * step);
        }
        return {
            shortCircuit: false,
            values: ramp
        };

    } catch (error) {
        console.warn('Error in buildBaseCurve:', error);
        return {
            shortCircuit: true,
            values: new Array(CURVE_RESOLUTION).fill(0)
        };
    }
}

/**
 * Apply per-channel linearization step
 * @param {Array<number>} values - Input values
 * @param {Object} options - Processing options
 * @returns {Array<number>} Processed values
 */
export function applyPerChannelLinearizationStep(values, options = {}) {
    const { channelName, endValue, interpolationType, smoothingPercent, smartApplied } = options;

    if (!channelName || smartApplied) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[per-channel] skipped', { channelName, smartApplied });
        }
        return values;
    }

    let perEntry = LinearizationState.getPerChannelData(channelName);
    if (!perEntry) {
        perEntry = legacyLinearizationBridge.getPerChannelData(channelName);
    }

    if (!perEntry) {
        return values;
    }

    let enabled = LinearizationState.isPerChannelEnabled(channelName);
    if (!enabled) {
        enabled = legacyLinearizationBridge.isPerChannelEnabled(channelName);
    }

    if (!enabled) {
        return values;
    }

    // SURGICAL BYPASS: If per-channel linearization data is LAB, use legacy processor
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[PER-CHANNEL DEBUG] Checking LAB bypass for channel:', channelName, {
            hasPerEntry: !!perEntry,
            perEntryFormat: perEntry?.format
        });
    }


    const printerSpaceEntry = ensurePrinterSpaceData(perEntry) || perEntry;
    const normalizedEntry = normalizeLinearizationEntry(printerSpaceEntry);

    if (!normalizedEntry || !Array.isArray(normalizedEntry.samples) || normalizedEntry.samples.length < 2) {
        return values;
    }

    const domainMin = typeof normalizedEntry.domainMin === 'number' ? normalizedEntry.domainMin : 0;
    const domainMax = typeof normalizedEntry.domainMax === 'number' ? normalizedEntry.domainMax : 1;

    const effectiveSmoothing = Number.isFinite(smoothingPercent)
        ? smoothingPercent
        : (typeof normalizedEntry.previewSmoothingPercent === 'number'
            ? normalizedEntry.previewSmoothingPercent
            : 0);

    captureMake256Step(channelName, 'per_baseValues', values);

    let lutSmoothing = effectiveSmoothing;
    let lutSource = {
        ...normalizedEntry,
        __debugChannelName: channelName,
        __debugStage: 'per',
        smoothingAlgorithm: normalizeSmoothingAlgorithm(normalizedEntry.smoothingAlgorithm || 'smoothing-splines')
    };

    if (effectiveSmoothing > 0 && Array.isArray(normalizedEntry.previewSamples)) {
        lutSource = {
            ...lutSource,
            samples: normalizedEntry.previewSamples.slice()
        };
        lutSmoothing = 0;
    }

    captureMake256Step(channelName, 'per_lutSamples', Array.isArray(lutSource.samples) ? lutSource.samples : []);

    let result = apply1DLUT(
        values,
        lutSource,
        domainMin,
        domainMax,
        endValue,
        interpolationType,
        lutSmoothing
    );

    captureMake256Step(channelName, 'per_afterApply1DLUT', result);



    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[per-channel] apply1DLUT', {
            channel: channelName,
            samples: normalizedEntry.samples.length,
            domainMin,
            domainMax,
            first: lutSource.samples[0],
            mid: lutSource.samples[Math.floor(lutSource.samples.length / 2)],
            last: lutSource.samples[lutSource.samples.length - 1],
            effectiveSmoothing: lutSmoothing
        });
    }

    return result;
}

/**
 * Apply global linearization step
 * @param {Array<number>} values - Input values
 * @param {Object} options - Processing options
 * @returns {Array<number>} Processed values
 */
export function applyGlobalLinearizationStep(values, options = {}) {
    const { channelName, endValue, applyLinearization, interpolationType, smoothingPercent, smartApplied } = options;

    const globalData = LinearizationState.getGlobalData();
    const globalApplied = LinearizationState.globalApplied;

    if (!globalData || !globalApplied || !applyLinearization) {
        return values;
    }

    // LAB data should be processed normally with full linearization corrections
    // (Removed LAB bypass - modular system should apply LAB corrections properly)


    // Check if this channel should skip global linearization
    const meta = getLoadedQuadData()?.keyPointsMeta?.[channelName] || {};

    let bakedGlobal = !!meta.bakedGlobal;
    if (!bakedGlobal && typeof LinearizationState?.isGlobalBaked === 'function' && LinearizationState.isGlobalBaked()) {
        const bakedMeta = typeof LinearizationState.getGlobalBakedMeta === 'function'
            ? LinearizationState.getGlobalBakedMeta()
            : null;
        if (bakedMeta && Array.isArray(bakedMeta.channels) && bakedMeta.channels.length > 0) {
            bakedGlobal = bakedMeta.channels.includes(channelName);
        } else {
            bakedGlobal = true;
        }
    }

    const shouldSkipGlobal = bakedGlobal || smartApplied;

    if (shouldSkipGlobal) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[global] skipped', { channelName, bakedGlobal, smartApplied });
        }
        return values;
    }

    if (compositeLabSession.active) {
        registerCompositeLabBase(channelName, values);
    }

    const printerSpaceEntry = ensurePrinterSpaceData(globalData) || globalData;
    const normalizedEntry = normalizeLinearizationEntry(printerSpaceEntry);

    if (!normalizedEntry || !Array.isArray(normalizedEntry.samples) || normalizedEntry.samples.length < 2) {
        return values;
    }

    const domainMin = typeof normalizedEntry.domainMin === 'number' ? normalizedEntry.domainMin : 0;
    const domainMax = typeof normalizedEntry.domainMax === 'number' ? normalizedEntry.domainMax : 1;
    const effectiveSmoothing = Number.isFinite(smoothingPercent)
        ? smoothingPercent
        : (typeof normalizedEntry.previewSmoothingPercent === 'number'
            ? normalizedEntry.previewSmoothingPercent
            : 0);

    let lutSource = normalizedEntry;
    let lutSmoothing = effectiveSmoothing;
    if (effectiveSmoothing > 0 && Array.isArray(normalizedEntry.previewSamples)) {
        lutSource = {
            ...normalizedEntry,
            samples: normalizedEntry.previewSamples.slice()
        };
        lutSmoothing = 0;
    }

    return apply1DLUT(
        values,
        lutSource,
        domainMin,
        domainMax,
        endValue,
        interpolationType,
        lutSmoothing
    );
}

/**
 * Apply auto endpoint adjustments
 * @param {Array<number>} values - Input values
 * @param {number} endValue - Channel end value
 * @param {string} channelName - Channel name
 * @param {boolean} smartApplied - Whether Smart Curve is applied
 * @returns {Array<number>} Values with auto adjustments
 */
export function applyAutoEndpointAdjustments(values, endValue, channelName, smartApplied) {
    const applyWhite = AutoEndpointRolloff.shouldApply('white');
    const applyBlack = AutoEndpointRolloff.shouldApply('black');

    if (!applyWhite && !applyBlack) {
        return values;
    }

    return AutoEndpointRolloff.apply(values, endValue, channelName, {
        applyWhite,
        applyBlack
    });
}

/**
 * Main curve generation function - make256
 * Generates a 256-point curve for a channel with all corrections applied
 * @param {number} endValue - Channel end value (0-65535)
 * @param {string} channelName - Channel name
 * @param {boolean} applyLinearization - Whether to apply linearization
 * @returns {Array<number>} 256-point curve
 */
export function make256(endValue, channelName, applyLinearization = false, options = {}) {
    try {
        if (endValue === 0) {
            return new Array(CURVE_RESOLUTION).fill(0);
        }

        const debugEnabled = typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS;

        if (debugEnabled) {
            console.log('[MAKE256] start', { channelName, endValue, applyLinearization });
        }

        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('DEBUG: make256() called:', {
                endValue,
                channelName,
                applyLinearization,
                hasGlobalLinearizationData: !!LinearizationState.getGlobalData(),
                globalLinearizationApplied: LinearizationState.globalApplied,
                hasPerChannelLinearization: !!LinearizationState.getPerChannelData(channelName)
            });
        }

        const opts = options || {};
        let smartApplied = isSmartCurve(channelName);
        if (debugEnabled) {
            console.log('[MAKE256] smartApplied initial', { channelName, smartApplied });
        }
        if (Object.prototype.hasOwnProperty.call(opts, 'forceSmartApplied')) {
            smartApplied = !!opts.forceSmartApplied;
            if (debugEnabled) {
                console.log('[MAKE256] smartApplied forced override', { channelName, smartApplied });
            }
        }

        // Build base curve
        const base = buildBaseCurve(endValue, channelName, smartApplied, opts);
        if (base.shortCircuit) {
            return base.values;
        }

        let arr = base.values.slice();

        if (debugEnabled) {
            console.log('[MAKE256] after base', { channelName, first: arr.slice(0, 10), mid: arr[Math.floor(arr.length / 2)], last: arr.slice(-10) });
        }

        emitCompositeAudit('make256.base', (targetIndex) => {
            if (!Array.isArray(arr) || targetIndex >= arr.length) return null;
            return {
                channelName,
                sampleIndex: targetIndex,
                value: arr[targetIndex],
                stage: 'base'
            };
        });

        // Get interpolation type from UI
        const interpolationType = elements.curveSmoothingMethod?.value || 'cubic';
        // For LAB data, reuse the entry's preview smoothing percent (Options panel slider)
        const globalData = LinearizationState.getGlobalData();
        const globalApplied = LinearizationState.globalApplied;
        const perChannelData = LinearizationState.getPerChannelData(channelName);
        const hasLabData = (globalData && globalApplied && isLabLinearizationData(globalData)) ||
                          (perChannelData && isLabLinearizationData(perChannelData));
        let smoothingPercent = 0;
        if (hasLabData) {
            const smoothingSource = isLabLinearizationData(perChannelData) ? perChannelData : globalData;
            if (smoothingSource && typeof smoothingSource.previewSmoothingPercent === 'number') {
                smoothingPercent = smoothingSource.previewSmoothingPercent;
            } else {
                smoothingPercent = getLabSmoothingPercent();
            }
        }

        // Apply processing steps in order
        arr = applyPerChannelLinearizationStep(arr, {
            channelName,
            endValue,
            interpolationType,
            smoothingPercent,
            smartApplied
        });

        if (debugEnabled) {
            console.log('[MAKE256] after per-channel', { channelName, first: arr.slice(0, 10), mid: arr[Math.floor(arr.length / 2)], last: arr.slice(-10) });
        }

        emitCompositeAudit('make256.afterPerChannel', (targetIndex) => {
            if (!Array.isArray(arr) || targetIndex >= arr.length) return null;
            return {
                channelName,
                sampleIndex: targetIndex,
                value: arr[targetIndex],
                stage: 'afterPerChannel'
            };
        });

        arr = applyGlobalLinearizationStep(arr, {
            channelName,
            endValue,
            applyLinearization,
            interpolationType,
            smoothingPercent,
            smartApplied
        });

        if (debugEnabled) {
            console.log('[MAKE256] after global', { channelName, first: arr.slice(0, 10), mid: arr[Math.floor(arr.length / 2)], last: arr.slice(-10) });
        }

        emitCompositeAudit('make256.afterGlobal', (targetIndex) => {
            if (!Array.isArray(arr) || targetIndex >= arr.length) return null;
            return {
                channelName,
                sampleIndex: targetIndex,
                value: arr[targetIndex],
                stage: 'afterGlobal'
            };
        });

        arr = applyAutoEndpointAdjustments(arr, endValue, channelName, smartApplied);

        if (debugEnabled) {
            console.log('[MAKE256] final', { channelName, first: arr.slice(0, 10), mid: arr[Math.floor(arr.length / 2)], last: arr.slice(-10) });
        }

        emitCompositeAudit('make256.final', (targetIndex) => {
            if (!Array.isArray(arr) || targetIndex >= arr.length) return null;
            return {
                channelName,
                sampleIndex: targetIndex,
                value: arr[targetIndex],
                stage: 'final'
            };
        });

        const shouldNormalize = (() => {
            if (options && Object.prototype.hasOwnProperty.call(options, 'normalizeToEnd')) {
                return !!options.normalizeToEnd;
            }
            return isChannelNormalizedToEnd(channelName);
        })();

        const targetMax = Number.isFinite(endValue) ? Math.max(0, Math.min(TOTAL, Math.round(endValue))) : 0;
        if (shouldNormalize && targetMax > 0) {
            let currentMax = 0;
            for (let i = 0; i < arr.length; i += 1) {
                const value = arr[i];
                if (Number.isFinite(value) && value > currentMax) {
                    currentMax = value;
                }
            }

            if (currentMax > 0 && Math.abs(currentMax - targetMax) > 0.5) {
                const scaleRatio = targetMax / currentMax;
                if (debugEnabled) {
                    console.log('[MAKE256] normalizeToEnd', { channelName, currentMax, targetMax, scaleRatio });
                }
                for (let i = 0; i < arr.length; i += 1) {
                    const scaled = arr[i] * scaleRatio;
                    arr[i] = Math.max(0, Math.min(TOTAL, Math.round(scaled)));
                }
            }
        }

        return arr;

    } catch (error) {
        console.error('Error in make256:', error);
        return new Array(CURVE_RESOLUTION).fill(0);
    }
}

/**
 * Apply 1D LUT with interpolation - apply1DLUT
 * @param {Array<number>} values - Input values
 * @param {Object|Array} lutOrData - LUT data or linearization object
 * @param {number} domainMin - Domain minimum
 * @param {number} domainMax - Domain maximum
 * @param {number} maxValue - Maximum output value
 * @param {string} interpolationType - Interpolation type
 * @param {number} smoothingPercent - Smoothing percentage
 * @returns {Array<number>} Processed values
 */
function prepareLUTInterpolation(lutOrData, domainMin, domainMax, interpolationType, smoothingPercent) {
    try {
        const entry = lutOrData || {};
        const debugChannel = typeof entry === 'object' && entry.__debugChannelName ? entry.__debugChannelName : null;
        const lutDomainMin = typeof entry.domainMin === 'number' ? entry.domainMin : domainMin;
        const lutDomainMax = typeof entry.domainMax === 'number' ? entry.domainMax : domainMax;
        const domainSpan = Math.abs(lutDomainMax - lutDomainMin) > 1e-9 ? lutDomainMax - lutDomainMin : 1;

        const smoothingAlgorithm = normalizeSmoothingAlgorithm(
            (typeof entry === 'object' && entry.smoothingAlgorithm) ||
            (elements?.tuningPostAlgorithm?.value) ||
            'smoothing-splines'
        );

        let processedSamples = [];
        let lutX = [];
        let sourceSpace = entry.sourceSpace;

        const ensureDomainCoords = (count) => {
            const coords = new Array(count);
            for (let i = 0; i < count; i++) {
                coords[i] = lutDomainMin + (count === 1 ? 0 : (i / (count - 1)) * domainSpan);
            }
            return coords;
        };

        const cloneIfArray = (candidate) => Array.isArray(candidate) ? candidate.slice() : [];

        if (Array.isArray(lutOrData)) {
            processedSamples = cloneIfArray(lutOrData);
            if (smoothingPercent > 0) {
                processedSamples = CurveSimplification.applySmoothingReduction(processedSamples, smoothingPercent, smoothingAlgorithm);
            }
            lutX = ensureDomainCoords(processedSamples.length);
        } else if (entry && typeof entry === 'object') {
            let handled = false;
            if (typeof entry.getSmoothingControlPoints === 'function') {
                let controlPoints = null;
                if (smoothingPercent > 0) {
                    try {
                        controlPoints = entry.getSmoothingControlPoints(smoothingPercent);
                    } catch (error) {
                        console.warn('getSmoothingControlPoints failed, falling back to base samples:', error);
                    }
                }

                if (controlPoints && Array.isArray(controlPoints.samples) && controlPoints.samples.length >= 2) {
                    processedSamples = controlPoints.samples.slice();
                    const cx = Array.isArray(controlPoints.xCoords) && controlPoints.xCoords.length === processedSamples.length
                        ? controlPoints.xCoords.slice()
                        : null;
                    if (cx) {
                        lutX = cx.map((x) => lutDomainMin + clamp01(x) * domainSpan);
                    } else {
                        lutX = ensureDomainCoords(processedSamples.length);
                    }
                    if (controlPoints.sourceSpace) {
                        sourceSpace = DataSpace.normalizeSpace(controlPoints.sourceSpace);
                    }
                    handled = true;
                }
            }

            if (!handled) {
                if (smoothingPercent > 0 && Array.isArray(entry.baseSamples) && entry.baseSamples.length) {
                    processedSamples = entry.baseSamples.slice();
                } else if (Array.isArray(entry.samples) && entry.samples.length) {
                    processedSamples = entry.samples.slice();
                } else if (Array.isArray(entry.originalSamples) && entry.originalSamples.length) {
                    processedSamples = entry.originalSamples.slice();
                }

                if (processedSamples.length >= 2 && smoothingPercent > 0) {
                    processedSamples = CurveSimplification.applySmoothingReduction(processedSamples, smoothingPercent, smoothingAlgorithm);
                }

                const controlPointCount = Math.max(3, Math.round(processedSamples.length));
                lutX = new Array(controlPointCount);
                for (let i = 0; i < controlPointCount; i++) {
                    lutX[i] = lutDomainMin + (i / Math.max(1, controlPointCount - 1)) * domainSpan;
                }
                sourceSpace = entry.sourceSpace;
            }
        }

        if (!Array.isArray(processedSamples) || processedSamples.length < 2) {
            return null;
        }

        const converted = DataSpace.convertSamples(processedSamples, {
            from: sourceSpace,
            to: DataSpace.SPACE.PRINTER,
            metadata: entry.conversionMeta || {}
        });
        processedSamples = converted.values.map(clamp01);
        sourceSpace = converted.sourceSpace;

        if (isCubeEndpointAnchoringEnabled()) {
            processedSamples[0] = 0;
            processedSamples[processedSamples.length - 1] = 1;
        }

        if (!Array.isArray(lutX) || lutX.length !== processedSamples.length) {
            lutX = ensureDomainCoords(processedSamples.length);
        }

        if (debugChannel) {
            captureMake256Step(debugChannel, `${entry.__debugStage || 'per'}_lutSamplesProcessed`, processedSamples.slice());
        }

        const type = String(interpolationType || 'cubic').toLowerCase();
        let interpolationFunction;

        if (type === 'pchip' || type === 'smooth') {
            interpolationFunction = createPCHIPSpline(lutX, processedSamples);
        } else if (type === 'catmull') {
            const tensionValue = Number(elements?.catmullTension?.value) || 0;
            interpolationFunction = createCatmullRomSpline(lutX, processedSamples, Math.max(0, Math.min(1, tensionValue / 100)));
        } else if (type === 'linear') {
            interpolationFunction = (t) => {
                if (t <= lutX[0]) return processedSamples[0];
                if (t >= lutX[lutX.length - 1]) return processedSamples[processedSamples.length - 1];

                let leftIndex = 0;
                for (let i = 0; i < lutX.length - 1; i++) {
                    if (t >= lutX[i] && t <= lutX[i + 1]) {
                        leftIndex = i;
                        break;
                    }
                }

                const rightIndex = Math.min(leftIndex + 1, lutX.length - 1);
                const x0 = lutX[leftIndex];
                const x1 = lutX[rightIndex];
                const y0 = processedSamples[leftIndex];
                const y1 = processedSamples[rightIndex];
                if (x1 === x0) return y0;
                const alpha = (t - x0) / (x1 - x0);
                return (1 - alpha) * y0 + alpha * y1;
            };
        } else {
            interpolationFunction = createCubicSpline(lutX, processedSamples);
        }

        return {
            interpolationFunction,
            lutDomainMin,
            lutDomainMax,
            domainSpan
        };
    } catch (error) {
        console.error('Error preparing LUT interpolation:', error);
        return null;
    }
}

function preserveLeadingInk(result) {
    return result;
}

export function apply1DLUT(values, lutOrData, domainMin = 0, domainMax = 1, maxValue = TOTAL, interpolationType = 'cubic', smoothingPercent = 0) {
    if (isActiveRangeLinearizationEnabled()) {
        return apply1DLUTActiveRange(values, lutOrData, domainMin, domainMax, maxValue, interpolationType, smoothingPercent);
    }

    return apply1DLUTFixedDomain(values, lutOrData, domainMin, domainMax, maxValue, interpolationType, smoothingPercent);
}

export function apply1DLUTFixedDomain(values, lutOrData, domainMin = 0, domainMax = 1, maxValue = TOTAL, interpolationType = 'cubic', smoothingPercent = 0) {
    try {
        if (!Array.isArray(values) || values.length === 0) {
            return [];
        }

        const context = prepareLUTInterpolation(lutOrData, domainMin, domainMax, interpolationType, smoothingPercent);
        if (!context) {
            return values.slice();
        }

        const { interpolationFunction, lutDomainMin, lutDomainMax, domainSpan } = context;

        const maxOutput = Math.max(1, maxValue || TOTAL);
        const enableDebug = typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS;

        const result = values.map((value, index) => {
            const normalized = clamp01(maxOutput > 0 ? value / maxOutput : 0);
            const t = lutDomainMin + normalized * domainSpan;
            const lutValue = clamp01(interpolationFunction(t));
            const output = Math.round(lutValue * maxOutput);
            if (enableDebug && index % 32 === 0) {
                console.log('[apply1DLUT]', { index, value, normalized, t, lutValue, output });
            }
            return output;
        });

        return preserveLeadingInk(result, values);

    } catch (error) {
        console.error('Error in apply1DLUT:', error);
        return values.slice();
    }
}

export function apply1DLUTActiveRange(values, lutOrData, domainMin = 0, domainMax = 1, maxValue = TOTAL, interpolationType = 'cubic', smoothingPercent = 0) {
    try {
        if (!Array.isArray(values) || values.length === 0) {
            return [];
        }

        const context = prepareLUTInterpolation(lutOrData, domainMin, domainMax, interpolationType, smoothingPercent);
        if (!context) {
            return values.slice();
        }

        const { interpolationFunction, lutDomainMin, lutDomainMax } = context;
        const maxOutput = Math.max(1, maxValue || TOTAL);

        const targets = calculateLinearizationTargets(maxOutput, interpolationFunction, lutDomainMin, lutDomainMax, values.length);
        const activeRange = detectActiveRange(values);
        const remapped = remapActiveRange(values, targets, activeRange, { maxOutput });
        const monotonic = enforceMonotonic(remapped);
        return preserveLeadingInk(monotonic, values);
    } catch (error) {
        console.error('Error in apply1DLUTActiveRange:', error);
        return values.slice();
    }
}

export function detectActiveRange(curve, { threshold = 0 } = {}) {
    if (!Array.isArray(curve) || curve.length === 0) {
        return {
            startIndex: -1,
            endIndex: -1,
            span: 0,
            isActive: false
        };
    }

    const effectiveThreshold = Number.isFinite(threshold) ? threshold : 0;
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < curve.length; i++) {
        if (curve[i] > effectiveThreshold) {
            startIndex = i;
            break;
        }
    }

    for (let i = curve.length - 1; i >= 0; i--) {
        if (curve[i] > effectiveThreshold) {
            endIndex = i;
            break;
        }
    }

    const isActive = startIndex >= 0 && endIndex >= startIndex;

    return {
        startIndex,
        endIndex,
        span: isActive ? (endIndex - startIndex) : 0,
        isActive
    };
}

export function calculateLinearizationTargets(maxValue, interpolationFunction, domainMin = 0, domainMax = 1, resolution = CURVE_RESOLUTION) {
    if (typeof interpolationFunction !== 'function' || resolution <= 0) {
        return new Array(Math.max(0, resolution)).fill(0);
    }

    const targets = new Array(resolution);
    const domainSpan = Math.abs(domainMax - domainMin) > 1e-9 ? domainMax - domainMin : 1;
    const maxOutput = Math.max(1, Number(maxValue) || TOTAL);

    for (let i = 0; i < resolution; i++) {
        const inputNormalized = resolution === 1 ? 0 : i / (resolution - 1);
        const t = domainMin + inputNormalized * domainSpan;
        const lutValue = clamp01(interpolationFunction(t));
        targets[i] = Math.round(lutValue * maxOutput);
    }

    return targets;
}

export function remapActiveRange(baseCurve, targets, activeRange, options = {}) {
    if (!Array.isArray(baseCurve) || baseCurve.length === 0) {
        return [];
    }

    if (!Array.isArray(targets) || targets.length === 0) {
        return baseCurve.slice();
    }

    const effectiveActiveRange = activeRange && typeof activeRange === 'object'
        ? activeRange
        : detectActiveRange(baseCurve);

    if (!effectiveActiveRange || !effectiveActiveRange.isActive) {
        return baseCurve.slice();
    }

    const targetRange = detectActiveRange(targets, { threshold: options.targetThreshold ?? 0 });
    if (!targetRange.isActive) {
        return baseCurve.slice();
    }

    const result = new Array(baseCurve.length).fill(0);
    const maxOutput = Math.max(1, Number(options.maxOutput) || TOTAL);

    const baseSpan = Math.max(1, effectiveActiveRange.span || 0);
    const targetSpan = Math.max(1, targetRange.span || 0);

    const clampTargetIndex = (index) => {
        if (Number.isNaN(index)) return targetRange.startIndex;
        return Math.max(targetRange.startIndex, Math.min(targetRange.endIndex, index));
    };

    const safeTargetValue = (index) => {
        const clamped = clampTargetIndex(index);
        return targets[clamped] ?? 0;
    };

    for (let i = 0; i < baseCurve.length; i++) {
        if (i < effectiveActiveRange.startIndex || i > effectiveActiveRange.endIndex) {
            result[i] = 0;
            continue;
        }

        const fraction = baseSpan === 0 ? 0 : (i - effectiveActiveRange.startIndex) / baseSpan;
        const targetIndexFloat = targetRange.startIndex + fraction * targetSpan;

        if (!Number.isFinite(targetIndexFloat)) {
            result[i] = 0;
            continue;
        }

        const lowerIndex = Math.floor(targetIndexFloat);
        const upperIndex = Math.ceil(targetIndexFloat);
        const alpha = clamp01(targetIndexFloat - lowerIndex);
        const lowerValue = safeTargetValue(lowerIndex);
        const upperValue = safeTargetValue(upperIndex);
        const interpolated = (1 - alpha) * lowerValue + alpha * upperValue;

        result[i] = Math.round(Math.max(0, Math.min(maxOutput, interpolated)));
    }

    return result;
}

export function enforceMonotonic(curve) {
    if (!Array.isArray(curve) || curve.length === 0) {
        return [];
    }

    const result = curve.slice();
    for (let i = 1; i < result.length; i++) {
        if (result[i] < result[i - 1]) {
            result[i] = result[i - 1];
        }
    }

    return result;
}

/**
 * Build .quad file content - buildFile
 * @returns {string} Complete .quad file content
 */
export function buildFile() {
    try {
        const p = getCurrentPrinter();
        const lines = [
            "## QuadToneRIP " + p.channels.join(","),
            "# Printer: " + p.name,
            `# quadGEN modular build`
        ];

        // Add user notes if provided
        const userNotes = elements.userNotes?.value?.trim();
        if (userNotes) {
            lines.push("#");
            lines.push("# Notes:");
            userNotes.split('\n').forEach(line => {
                const t = line.trim();
                lines.push(t ? ("# " + t) : "#");
            });
        }

        // Add linearization information
        const hasLinearization = LinearizationState.hasAnyLinearization();
        if (hasLinearization) {
            lines.push("#");
            lines.push("# Linearization Applied:");

            const globalData = LinearizationState.getGlobalData();
            if (globalData && LinearizationState.globalApplied) {
                lines.push(`# - Global: ${globalData.filename || 'unknown file'} (affects all channels)`);
            }

            // Add per-channel linearization info
            Object.keys(LinearizationState.perChannelData).forEach(channelName => {
                if (LinearizationState.isPerChannelEnabled(channelName)) {
                    const data = LinearizationState.getPerChannelData(channelName);
                    lines.push(`# - ${channelName}: ${data?.filename || 'unknown file'}`);
                }
            });
        }

        lines.push("");

        // Generate curve data for each channel
        p.channels.forEach(channelName => {
            const row = getChannelRow(channelName);
            if (!row) return;

            const endInput = row.querySelector('.end-input');
            const endVal = endInput ? InputValidator.clampEnd(endInput.value) : 0;

            if (endVal > 0) {
                const values = make256(endVal, channelName, true);
                const auditScope = typeof globalThis !== 'undefined'
                    ? globalThis
                    : (typeof window !== 'undefined' ? window : null);
                if (auditScope && auditScope.__COMPOSITE_AUDIT__ && auditScope.__COMPOSITE_AUDIT__.enabled) {
                    try {
                        const audit = auditScope.__COMPOSITE_AUDIT__;
                        const events = Array.isArray(audit.events)
                            ? audit.events
                            : (audit.events = []);
                        const eventPayload = {
                            channelName,
                            stage: 'export',
                            valueSample_242: Array.isArray(values) && values.length > 242 ? values[242] : null,
                            endValue: endVal
                        };
                        events.push({
                            stage: 'export.make256',
                            payload: eventPayload,
                            ts: Date.now()
                        });
                        if (typeof audit.log === 'function') {
                            audit.log('export.make256', eventPayload);
                        }
                    } catch (auditError) {
                        console.warn('[COMPOSITE_AUDIT] export logging failed:', auditError);
                    }
                }
                values.forEach(value => {
                    lines.push(value.toString());
                });
            } else {
                // Disabled channel - output zeros
                for (let i = 0; i < CURVE_RESOLUTION; i++) {
                    lines.push("0");
                }
            }
        });

        return lines.join("\n") + "\n";

    } catch (error) {
        console.error('Error in buildFile:', error);
        return "# Error generating .quad file\n";
    }
}

/**
 * Export for global access during transition
 */
registerDebugNamespace('processingPipeline', {
    make256,
    apply1DLUT,
    apply1DLUTFixedDomain,
    apply1DLUTActiveRange,
    detectActiveRange,
    calculateLinearizationTargets,
    remapActiveRange,
    enforceMonotonic,
    buildFile,
    buildBaseCurve,
    applyPerChannelLinearizationStep,
    applyGlobalLinearizationStep,
    replayCompositeDebugSessionFromCache,
    getCompositeDebugSessionCache
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['make256', 'apply1DLUT', 'buildFile', 'buildBaseCurve']
});
