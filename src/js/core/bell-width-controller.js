// Bell Curve Width Controller
// Applies left/right widening or tightening for bell-classified channels.

import { ensureLoadedQuadData, getChannelShapeMeta, getEditModeFlag } from './state.js';
import { scaleBellCurve, normalizeWidthFactor } from './bell-width-scale.js';
import { setBellWidthScale, getBellWidthBaselineCurve, setBellWidthBaselineCurve } from './bell-shift-state.js';
import { triggerInkChartUpdate, triggerPreviewUpdate, triggerProcessingDetail } from '../ui/ui-hooks.js';
import { captureState } from './history-manager.js';
import { showStatus } from '../ui/status-service.js';
import { isChannelLocked, getChannelLockEditMessage } from './channel-locks.js';
import { simplifySmartKeyPointsFromCurve, ControlPoints, ControlPolicy, regenerateSmartCurveSamples } from '../curves/smart-curves.js';
import { getBellEditSimplifyOptions } from './bell-edit-helpers.js';

const DEFAULT_PERCENT = 100;
const MIN_PERCENT = normalizeWidthFactor(0.4) * 100; // 40%
const MAX_PERCENT = normalizeWidthFactor(2.5) * 100; // 250%
const NUDGE_STEP = 2;
const EPSILON = 1e-3;

function clampPercent(percent) {
    if (!Number.isFinite(percent)) return DEFAULT_PERCENT;
    const clamped = Math.min(Math.max(percent, MIN_PERCENT), MAX_PERCENT);
    return normalizeWidthFactor(clamped / 100) * 100;
}

function resolveSamples(data, channelName) {
    if (!data || !channelName) return null;
    const curves = data.curves;
    if (!curves || !Array.isArray(curves[channelName])) return null;
    return curves[channelName];
}

function resolveCurrentWidth(meta) {
    if (meta?.bellWidthScale) {
        return {
            leftFactor: normalizeWidthFactor(meta.bellWidthScale.leftFactor ?? 1),
            rightFactor: normalizeWidthFactor(meta.bellWidthScale.rightFactor ?? 1),
            linked: typeof meta.bellWidthScale.linked === 'boolean' ? meta.bellWidthScale.linked : true
        };
    }
    return { leftFactor: 1, rightFactor: 1, linked: true };
}

function factorToPercent(factor) {
    return normalizeWidthFactor(factor ?? 1) * 100;
}

function resolveFactorInput(percentValue, factorValue, fallback) {
    if (Number.isFinite(percentValue)) {
        return normalizeWidthFactor(percentValue / 100);
    }
    if (Number.isFinite(factorValue)) {
        return normalizeWidthFactor(factorValue);
    }
    if (Number.isFinite(fallback)) {
        return normalizeWidthFactor(fallback);
    }
    return 1;
}

function isApproximatelyEqual(a, b) {
    return Math.abs(a - b) < EPSILON;
}

function formatStatus(channelName, leftFactor, rightFactor) {
    const leftPercent = Math.round(leftFactor * 100);
    const rightPercent = Math.round(rightFactor * 100);
    if (Math.abs(leftPercent - rightPercent) <= 1) {
        return `Scaled ${channelName} bell width to ${leftPercent}%`;
    }
    return `Scaled ${channelName} bell width (L ${leftPercent}%, R ${rightPercent}%)`;
}

function adjustSmartPointsAfterWidthScale(channelName, nextFactors, previousFactors, referenceApexPercent, meta) {
    if (!getEditModeFlag()) {
        return;
    }
    const entry = ControlPoints.get(channelName);
    if (!entry?.points || entry.points.length < 2) {
        try {
            simplifySmartKeyPointsFromCurve(channelName, {
                ...getBellEditSimplifyOptions()
            });
        } catch (error) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[BELL WIDTH] Failed to resimplify Smart points:', error);
            }
        }
        return;
    }

    const points = entry.points.map((point) => ({ ...point }));
    const prevLeft = normalizeWidthFactor(previousFactors?.leftFactor ?? 1);
    const prevRight = normalizeWidthFactor(previousFactors?.rightFactor ?? 1);
    const nextLeft = normalizeWidthFactor(nextFactors?.leftFactor ?? 1);
    const nextRight = normalizeWidthFactor(nextFactors?.rightFactor ?? 1);

    if (isApproximatelyEqual(prevLeft, nextLeft) && isApproximatelyEqual(prevRight, nextRight)) {
        return;
    }

    const minGap = ControlPolicy?.minGap || 0.01;
    const fallbackSpan = Number.isFinite(meta?.apexSpanPercent) ? meta.apexSpanPercent : 25;
    const leftSpan = Number.isFinite(meta?.apexSpanLeftPercent) ? meta.apexSpanLeftPercent : fallbackSpan;
    const rightSpan = Number.isFinite(meta?.apexSpanRightPercent) ? meta.apexSpanRightPercent : fallbackSpan;
    const leftFalloff = Math.max(2, leftSpan * 0.5);
    const rightFalloff = Math.max(2, rightSpan * 0.5);

    for (let i = 1; i < points.length - 1; i += 1) {
        const point = points[i];
        const distance = point.input - referenceApexPercent;
        if (Math.abs(distance) < 1e-3) continue;
        const isLeft = distance < 0;
        const prevFactor = isLeft ? prevLeft : prevRight;
        const nextFactor = isLeft ? nextLeft : nextRight;
        if (isApproximatelyEqual(prevFactor, nextFactor)) continue;
        const falloff = isLeft ? leftFalloff : rightFalloff;
        const weight = Math.exp(-Math.abs(distance) / Math.max(1, falloff));
        const prevBlended = 1 + ((prevFactor - 1) * weight);
        const nextBlended = 1 + ((nextFactor - 1) * weight);
        if (isApproximatelyEqual(prevBlended, nextBlended)) continue;
        const baseDistance = Math.abs(prevBlended) > EPSILON ? distance / prevBlended : distance;
        point.input = referenceApexPercent + (baseDistance * nextBlended);
    }

    points[0].input = 0;
    const lastIndex = points.length - 1;
    points[lastIndex].input = 100;
    for (let i = 1; i < lastIndex; i += 1) {
        const prev = points[i - 1].input;
        const remaining = lastIndex - i;
        const upperLimit = 100 - (remaining * minGap);
        const candidate = points[i].input;
        points[i].input = Math.min(Math.max(candidate, prev + minGap), upperLimit);
    }

    try {
        const interpolation = entry.interpolation || 'smooth';
        ControlPoints.persist(channelName, points, interpolation);
        regenerateSmartCurveSamples(channelName, {
            points,
            interpolation
        });
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[BELL WIDTH] Failed to persist Smart key points:', error);
        }
    }
}

function buildScaleOptions(meta) {
    return {
        leftSpanSamples: meta?.apexSpanLeftSamples,
        rightSpanSamples: meta?.apexSpanRightSamples,
        leftSpanPercent: meta?.apexSpanLeftPercent,
        rightSpanPercent: meta?.apexSpanRightPercent,
        fallbackFalloff: meta?.apexSpanSamples
    };
}

export function applyBellWidthScale(channelName, params = {}, options = {}) {
    if (!channelName) {
        return { success: false, reason: 'invalid_channel' };
    }
    const data = ensureLoadedQuadData(() => ({
        curves: {},
        sources: {},
        bellCurveShift: {}
    }));
    const samples = resolveSamples(data, channelName);
    if (!samples) {
        return { success: false, reason: 'no_curve' };
    }
    if (isChannelLocked(channelName)) {
        const message = getChannelLockEditMessage(channelName) || `${channelName} is locked. Unlock to adjust bell width.`;
        if (!options.silent) {
            showStatus(message);
        }
        return { success: false, reason: 'locked', message };
    }

    const meta = getChannelShapeMeta(channelName);
    if (!meta || meta.classification !== 'bell' || !Number.isFinite(meta.peakIndex)) {
        return { success: false, reason: 'not_bell' };
    }

    const current = resolveCurrentWidth(meta);
    const previousFactors = { ...current };
    const resolvedLinked = typeof params.linked === 'boolean' ? params.linked : current.linked;
    let leftFactor = resolveFactorInput(params.leftPercent, params.leftFactor, current.leftFactor);
    let rightFactor = resolveFactorInput(params.rightPercent, params.rightFactor, current.rightFactor);

    if (resolvedLinked) {
        const shared = Number.isFinite(params.leftPercent) || Number.isFinite(params.leftFactor)
            ? leftFactor
            : Number.isFinite(params.rightPercent) || Number.isFinite(params.rightFactor)
                ? rightFactor
                : current.leftFactor;
        leftFactor = shared;
        rightFactor = shared;
    }

    if (isApproximatelyEqual(leftFactor, current.leftFactor) && isApproximatelyEqual(rightFactor, current.rightFactor)) {
        if (typeof params.linked === 'boolean' && params.linked !== current.linked) {
            setBellWidthScale(data, channelName, { linked: resolvedLinked });
        }
        return { success: true, noOp: true };
    }

    let baselineCurve = getBellWidthBaselineCurve(data, channelName);
    if (!Array.isArray(baselineCurve) || baselineCurve.length !== samples.length) {
        setBellWidthBaselineCurve(data, channelName, samples);
        baselineCurve = getBellWidthBaselineCurve(data, channelName) || samples;
    }

    const scaled = scaleBellCurve(
        baselineCurve,
        meta.peakIndex,
        { leftFactor, rightFactor },
        buildScaleOptions(meta),
        previousFactors
    );
    data.curves[channelName] = scaled;
    if (data.rebasedCurves && typeof data.rebasedCurves === 'object') {
        data.rebasedCurves[channelName] = scaled.slice();
    }
    if (data.plotBaseCurves && typeof data.plotBaseCurves === 'object') {
        data.plotBaseCurves[channelName] = scaled.slice();
    }
    setBellWidthScale(data, channelName, {
        leftFactor,
        rightFactor,
        linked: resolvedLinked
    });

    const referenceApex = Number.isFinite(meta?.bellShift?.shiftedApexInputPercent)
        ? meta.bellShift.shiftedApexInputPercent
        : meta?.apexInputPercent ?? 50;

    adjustSmartPointsAfterWidthScale(channelName, { leftFactor, rightFactor }, previousFactors, referenceApex, meta);
    try {
        regenerateSmartCurveSamples(channelName);
    } catch (error) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[BELL WIDTH] Failed to regenerate Smart curve samples:', error);
        }
    }

    captureState(`Bell width scale • ${channelName}`);
    triggerInkChartUpdate();
    triggerPreviewUpdate();
    triggerProcessingDetail(channelName);

    if (!options.silent) {
        showStatus(formatStatus(channelName, leftFactor, rightFactor));
    }

    return {
        success: true,
        leftFactor,
        rightFactor,
        linked: resolvedLinked
    };
}

export function nudgeBellWidthSide(channelName, side = 'both', deltaPercent = NUDGE_STEP, options = {}) {
    const meta = getChannelShapeMeta(channelName);
    if (!meta || meta.classification !== 'bell') {
        return { success: false, reason: 'not_bell' };
    }
    const current = resolveCurrentWidth(meta);
    const linked = typeof options.linked === 'boolean' ? options.linked : current.linked;
    const currentLeftPercent = factorToPercent(current.leftFactor);
    const currentRightPercent = factorToPercent(current.rightFactor);
    const nextLeftPercent = clampPercent(currentLeftPercent + (side === 'right' ? 0 : deltaPercent));
    const nextRightPercent = clampPercent(currentRightPercent + (side === 'left' ? 0 : deltaPercent));

    if (linked || side === 'both') {
        const combined = clampPercent(currentLeftPercent + deltaPercent);
        return applyBellWidthScale(channelName, { leftPercent: combined, rightPercent: combined, linked }, options);
    }

    if (side === 'left') {
        return applyBellWidthScale(channelName, { leftPercent: nextLeftPercent, rightPercent: currentRightPercent, linked }, options);
    }
    if (side === 'right') {
        return applyBellWidthScale(channelName, { rightPercent: nextRightPercent, leftPercent: currentLeftPercent, linked }, options);
    }
    return applyBellWidthScale(channelName, { leftPercent: factorToPercent(current.leftFactor), rightPercent: factorToPercent(current.rightFactor), linked }, options);
}

export function resetBellWidthScale(channelName, options = {}) {
    return applyBellWidthScale(
        channelName,
        { leftPercent: DEFAULT_PERCENT, rightPercent: DEFAULT_PERCENT },
        options
    );
}

export function setBellWidthLink(channelName, linked) {
    if (typeof linked !== 'boolean') {
        return { success: false, reason: 'invalid_link_flag' };
    }
    const data = ensureLoadedQuadData(() => ({
        curves: {},
        sources: {},
        bellCurveShift: {}
    }));
    const meta = getChannelShapeMeta(channelName);
    if (!meta || meta.classification !== 'bell') {
        return { success: false, reason: 'not_bell' };
    }
    setBellWidthScale(data, channelName, { linked });
    triggerProcessingDetail(channelName);
    return { success: true, linked };
}
