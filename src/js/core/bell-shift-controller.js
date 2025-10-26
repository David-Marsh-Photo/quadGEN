// Bell Curve Apex Shift Controller
// Applies weighted apex shifts to bell-classified channels and keeps UI/state in sync.

import { ensureLoadedQuadData, getChannelShapeMeta, getEditModeFlag, elements } from './state.js';
import { shiftBellCurve, clampInputPercent } from './bell-shift.js';
import { ensureBellShiftContainer, markBellShiftRequest } from './bell-shift-state.js';
import { triggerInkChartUpdate, triggerProcessingDetail, triggerPreviewUpdate } from '../ui/ui-hooks.js';
import { captureState } from './history-manager.js';
import { showStatus } from '../ui/status-service.js';
import { isChannelLocked, getChannelLockEditMessage } from './channel-locks.js';
import { simplifySmartKeyPointsFromCurve, ControlPoints, ControlPolicy } from '../curves/smart-curves.js';

const DEFAULT_NUDGE_STEP = 0.5;

function adjustSmartPointsAfterShift(channelName, deltaPercent, referenceApex, meta) {
    if (typeof getEditModeFlag === 'function' && !getEditModeFlag()) {
        return;
    }
    const entry = ControlPoints.get(channelName);
    if (!entry?.points || entry.points.length < 2) {
        try {
            simplifySmartKeyPointsFromCurve(channelName, {
                ...getEditSimplifyOptions()
            });
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[BELL SHIFT] Fallback resimplify failed:', err);
            }
        }
        return;
    }

    const points = entry.points.map((point) => ({ ...point }));
    const falloff = (() => {
        const span = Number.isFinite(meta?.bellShift?.apexSpanPercent)
            ? meta.bellShift.apexSpanPercent
            : Number.isFinite(meta?.apexSpanPercent)
                ? meta.apexSpanPercent
                : 25;
        return Math.max(2, span * 0.4);
    })();
    const minGap = ControlPolicy?.minGap || 0.01;

    // Apply weighted offsets (skip endpoints)
    for (let i = 1; i < points.length - 1; i += 1) {
        const point = points[i];
        const distance = Math.abs(point.input - referenceApex);
        const weight = Math.exp(-distance / falloff);
        point.input = point.input + deltaPercent * weight;
    }

    // Enforce ordering + min gap while keeping endpoints anchored
    points[0].input = 0;
    const lastIndex = points.length - 1;
    points[lastIndex].input = 100;

    for (let i = 1; i < lastIndex; i += 1) {
        const prev = points[i - 1].input;
        const remaining = lastIndex - i;
        const upperLimit = 100 - (remaining * minGap);
        const candidate = points[i].input;
        const clamped = Math.min(Math.max(candidate, prev + minGap), upperLimit);
        points[i].input = clamped;
    }

    try {
        ControlPoints.persist(channelName, points, entry.interpolation || 'smooth');
    } catch (err) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[BELL SHIFT] Failed to persist Smart key points after shift:', err);
        }
    }
}

function getEditSimplifyOptions() {
    const options = {};
    const errorInput = elements.editMaxError;
    if (errorInput) {
        const value = Number(errorInput.value);
        if (Number.isFinite(value) && value > 0) {
            options.maxErrorPercent = value;
        }
    }
    const pointsInput = elements.editMaxPoints;
    if (pointsInput) {
        const count = Number(pointsInput.value);
        if (Number.isInteger(count) && count >= 2) {
            options.maxPoints = count;
        }
    }
    return options;
}

function getSamplesForChannel(data, channelName) {
    if (!data || !channelName) return null;
    const curves = data.curves;
    if (!curves || !Array.isArray(curves[channelName])) return null;
    return curves[channelName];
}

function formatStatus(channelName, value) {
    const display = Number(value).toFixed(1).replace(/\.0$/, '');
    return `Shifted ${channelName} bell apex to ${display}% input`;
}

export function applyBellShiftTarget(channelName, targetInputPercent, options = {}) {
    if (!channelName) return { success: false, reason: 'invalid_channel' };
    const data = ensureLoadedQuadData(() => ({
        curves: {},
        sources: {},
        keyPoints: {},
        keyPointsMeta: {},
        bellCurveShift: {}
    }));

    const samples = getSamplesForChannel(data, channelName);
    if (!samples) {
        return { success: false, reason: 'no_curve' };
    }

    if (isChannelLocked(channelName)) {
        const message = getChannelLockEditMessage(channelName) || `${channelName} is locked. Unlock to shift bell apex.`;
        if (!options.silent) {
            showStatus(message);
        }
        return { success: false, reason: 'locked', message };
    }

    const meta = getChannelShapeMeta(channelName);
    if (!meta || meta.classification !== 'bell' || typeof meta.peakIndex !== 'number') {
        return { success: false, reason: 'not_bell' };
    }

    const currentApex = Number.isFinite(meta.bellShift?.shiftedApexInputPercent)
        ? meta.bellShift.shiftedApexInputPercent
        : meta.peakInputPercent;

    const clampedTarget = clampInputPercent(Number(targetInputPercent));
    if (!Number.isFinite(clampedTarget)) {
        return { success: false, reason: 'invalid_target' };
    }

    if (Number.isFinite(currentApex) && Math.abs(clampedTarget - currentApex) < 1e-3) {
        return { success: true, noOp: true, targetInputPercent: clampedTarget };
    }

    const referenceApex = Number.isFinite(currentApex) ? currentApex : meta.peakInputPercent;
    const deltaPercent = clampedTarget - referenceApex;
    const shiftedSamples = shiftBellCurve(samples, meta.peakIndex, deltaPercent, {
        apexInputPercent: meta.peakInputPercent,
        currentInputPercent: referenceApex,
        targetInputPercent: clampedTarget
    });

    data.curves[channelName] = shiftedSamples;
    ensureBellShiftContainer(data);
    markBellShiftRequest(data, channelName, clampedTarget);
    adjustSmartPointsAfterShift(channelName, deltaPercent, referenceApex, meta);

    captureState(`Bell apex shift • ${channelName}`);
    triggerInkChartUpdate();
    triggerPreviewUpdate();
    triggerProcessingDetail(channelName);

    if (!options.silent) {
        showStatus(formatStatus(channelName, clampedTarget));
    }

    return { success: true, targetInputPercent: clampedTarget };
}

export function nudgeBellShift(channelName, deltaPercent = DEFAULT_NUDGE_STEP, options = {}) {
    const meta = getChannelShapeMeta(channelName);
    const currentApex = Number.isFinite(meta?.bellShift?.shiftedApexInputPercent)
        ? meta.bellShift.shiftedApexInputPercent
        : meta?.peakInputPercent;
    if (!Number.isFinite(currentApex)) {
        return { success: false, reason: 'no_apex' };
    }
    const target = currentApex + Number(deltaPercent || 0);
    return applyBellShiftTarget(channelName, target, options);
}

export function resetBellShift(channelName, options = {}) {
    const meta = getChannelShapeMeta(channelName);
    const baseline = meta?.bellShift?.baselineInputPercent;
    if (!Number.isFinite(baseline)) {
        return { success: false, reason: 'no_baseline' };
    }
    return applyBellShiftTarget(channelName, baseline, options);
}

export function getBellShiftStep() {
    return DEFAULT_NUDGE_STEP;
}
