import { generateSimpleScalingGain } from './gain-generator.js';
import { applyGainToChannels } from './channel-adjuster.js';
import { configureSimpleScaling } from './config.js';

const EPSILON = 1e-6;

function clampToBand(value, min, max) {
    if (!Number.isFinite(value)) return 1;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function ensureResolutionArray(values, resolution) {
    if (!Array.isArray(values)) {
        return new Array(resolution).fill(0);
    }
    if (values.length === resolution) {
        return values.slice();
    }
    const out = new Array(resolution);
    const lastIndex = values.length - 1;
    for (let i = 0; i < resolution; i += 1) {
        if (lastIndex < 0) {
            out[i] = 0;
            continue;
        }
        const t = i / Math.max(1, resolution - 1);
        const sourceIndex = Math.min(lastIndex, Math.round(t * lastIndex));
        out[i] = Number(values[sourceIndex]) || 0;
    }
    return out;
}

function computeTotals(channelMap, resolution) {
    const totals = new Array(resolution).fill(0);
    if (!channelMap || typeof channelMap !== 'object') {
        return totals;
    }
    Object.keys(channelMap).forEach((name) => {
        const entry = channelMap[name];
        if (!entry) return;
        const samples = ensureResolutionArray(entry.samples, resolution);
        for (let i = 0; i < resolution; i += 1) {
            totals[i] += Number(samples[i]) || 0;
        }
    });
    return totals;
}

function analyzeResidual(targetGain, appliedGain) {
    let max = 0;
    let sum = 0;
    let count = 0;
    const profile = new Array(targetGain.length);
    for (let i = 0; i < targetGain.length; i += 1) {
        const target = Number(targetGain[i]) || 1;
        const applied = Number(appliedGain[i]) || 1;
        const ratio = applied > EPSILON ? target / applied : 1;
        const delta = Math.abs(ratio - 1);
        profile[i] = delta;
        if (delta > max) {
            max = delta;
        }
        sum += delta;
        count += 1;
    }
    return {
        max,
        mean: count > 0 ? sum / count : 0,
        profile
    };
}

function blendChannelSamples(original, updated, resolution, blendFactor) {
    const originalSamples = ensureResolutionArray(original?.samples, resolution);
    const updatedSamples = ensureResolutionArray(updated?.samples, resolution);
    const blended = new Array(resolution);
    for (let i = 0; i < resolution; i += 1) {
        const base = Number(originalSamples[i]) || 0;
        const next = Number(updatedSamples[i]) || 0;
        blended[i] = Math.round(base + (next - base) * blendFactor);
    }
    const originalEnd = Number(original?.endValue) || 0;
    const updatedEnd = Number(updated?.endValue) || originalEnd;
    const blendedEnd = Math.round(originalEnd + (updatedEnd - originalEnd) * blendFactor);
    return {
        samples: blended,
        endValue: blendedEnd,
        baseEnd: Number(updated?.baseEnd ?? originalEnd),
        liftApplied: Math.max(0, blendedEnd - (Number(updated?.baseEnd ?? originalEnd)))
    };
}

export function runSimpleScalingCorrection({
    measurements = [],
    channels = {},
    densityWeights = {},
    options = {}
} = {}) {
    const {
        clampMin,
        clampMax,
        resolution
    } = configureSimpleScaling(options);

    const gainResult = generateSimpleScalingGain(measurements, {
        clampMin,
        clampMax,
        resolution
    });

    const firstPass = applyGainToChannels({
        channels,
        gainCurve: gainResult.samples,
        allowCeilingLift: options.allowCeilingLift === true,
        maxLiftPercent: Number.isFinite(options.maxLiftPercent) ? options.maxLiftPercent : 0.02,
        densityWeights
    });

    const baselineTotals = computeTotals(channels, resolution);
    const firstTotals = computeTotals(firstPass.channels, resolution);
    const appliedGain = baselineTotals.map((value, index) => {
        const total = Math.max(EPSILON, value);
        return firstTotals[index] / total;
    });

    const residualStats = analyzeResidual(gainResult.samples, appliedGain);
    const passes = [{
        gainCurve: gainResult.samples,
        residual: residualStats
    }];

    let workingChannels = firstPass.channels;
    let workingTotals = firstTotals;
    let effectiveGain = appliedGain;

    const maxIterations = Number.isFinite(options.maxIterations) ? Math.max(1, Math.floor(options.maxIterations)) : 2;
    const residualThreshold = Number.isFinite(options.residualThreshold) ? Math.max(0, options.residualThreshold) : 0.05;
    const residualIntensity = Number.isFinite(options.residualIntensity) ? Math.max(0, Math.min(1, options.residualIntensity)) : 0.3;

    if (maxIterations > 1 && residualStats.max > residualThreshold) {
        const residualGain = gainResult.samples.map((target, index) => {
            const applied = effectiveGain[index];
            const correctionRatio = applied > EPSILON ? target / applied : 1;
            const delta = correctionRatio - 1;
            const adjusted = 1 + delta * residualIntensity;
            return clampToBand(adjusted, clampMin, clampMax);
        });

        const secondInput = {};
        Object.keys(workingChannels).forEach((name) => {
            secondInput[name] = {
                samples: workingChannels[name].samples,
                endValue: workingChannels[name].endValue
            };
        });

        const secondPass = applyGainToChannels({
            channels: secondInput,
            gainCurve: residualGain,
            allowCeilingLift: options.allowCeilingLift === true,
            maxLiftPercent: Number.isFinite(options.maxLiftPercent) ? options.maxLiftPercent : 0.02,
            densityWeights
        });

        workingChannels = secondPass.channels;
        workingTotals = computeTotals(workingChannels, resolution);
        effectiveGain = baselineTotals.map((value, index) => {
            const total = Math.max(EPSILON, value);
            return workingTotals[index] / total;
        });
        const secondResidual = analyzeResidual(gainResult.samples, effectiveGain);
        passes.push({
            gainCurve: residualGain,
            residual: secondResidual
        });
    }

    const blendPercent = Number.isFinite(options.blendPercent)
        ? Math.max(0, Math.min(100, options.blendPercent))
        : 100;
    const blendFactor = blendPercent / 100;

    let finalChannels = workingChannels;
    if (blendFactor < 1) {
        finalChannels = {};
        Object.keys(channels).forEach((name) => {
            finalChannels[name] = blendChannelSamples(
                channels[name],
                workingChannels[name],
                resolution,
                blendFactor
            );
        });
    }

    const perChannelLift = {};
    Object.keys(finalChannels).forEach((name) => {
        const baseEnd = Number(channels[name]?.endValue) || 0;
        const nextEnd = Number(finalChannels[name]?.endValue) || baseEnd;
        perChannelLift[name] = Math.max(0, nextEnd - baseEnd);
    });

    return {
        gain: gainResult,
        channels: finalChannels,
        passes,
        metadata: {
            blendPercent,
            perChannelLift,
            residual: passes[passes.length - 1]?.residual || residualStats
        }
    };
}
