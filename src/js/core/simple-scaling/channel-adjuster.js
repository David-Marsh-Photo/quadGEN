import { TOTAL } from '../state.js';

const EPSILON = 1e-6;
const MAX_RELATIVE_GAIN = 0.15;
const KEY_CHANNELS = new Set(['K', 'MK', 'PK']);

function resolveArray(values, resolution) {
    if (!Array.isArray(values)) {
        return new Array(resolution).fill(0);
    }
    if (values.length === resolution) {
        return values.slice();
    }
    const out = new Array(resolution).fill(0);
    const lastIdx = values.length - 1;
    if (lastIdx < 0) {
        return out;
    }
    for (let i = 0; i < resolution; i += 1) {
        const t = i / Math.max(1, resolution - 1);
        const sourceIndex = Math.min(lastIdx, Math.round(t * lastIdx));
        out[i] = Number(values[sourceIndex]) || 0;
    }
    return out;
}

function clampValueToLimit(value, min = 0, max = TOTAL) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function applyGainToChannels({
    channels,
    gainCurve,
    allowCeilingLift = false,
    maxLiftPercent = MAX_RELATIVE_GAIN,
    densityWeights = {}
}) {
    if (!channels || typeof channels !== 'object') {
        throw new Error('applyGainToChannels requires channels map');
    }
    if (!Array.isArray(gainCurve) || !gainCurve.length) {
        throw new Error('applyGainToChannels requires gainCurve samples');
    }

    const resolution = gainCurve.length;
    const channelNames = Object.keys(channels).filter((name) => {
        const entry = channels[name];
        if (!entry || entry.enabled === false) {
            return false;
        }
        const samples = resolveArray(entry.samples, resolution);
        return samples.some((value) => Math.abs(value) > EPSILON);
    });

    const channelStates = channelNames.map((name) => {
        const entry = channels[name] || {};
        const baseEnd = clampValueToLimit(Number(entry.endValue) || 0, 0, TOTAL);
        const samples = resolveArray(entry.samples, resolution);
        const isKeyChannel = KEY_CHANNELS.has((name || '').toUpperCase());

        let requestedPeak = 0;
        for (let i = 0; i < resolution; i += 1) {
            const gain = Number.isFinite(gainCurve[i]) ? gainCurve[i] : 1;
            const candidate = clampValueToLimit(samples[i] * gain, 0, TOTAL);
            if (candidate > requestedPeak) {
                requestedPeak = candidate;
            }
        }

        const requestedLiftRatio = baseEnd > 0
            ? Math.max(0, (requestedPeak - baseEnd) / baseEnd)
            : 0;
        const normalizedLiftPercent = isKeyChannel
            ? 0
            : Math.min(
                Math.max(0, Number(maxLiftPercent) || 0),
                requestedLiftRatio,
                MAX_RELATIVE_GAIN
            );
        const maxLift = allowCeilingLift
            ? Math.min(TOTAL, Math.round(baseEnd * (1 + normalizedLiftPercent)))
            : baseEnd;
        return {
            name,
            baseEnd,
            maxLift,
            currentLimit: baseEnd,
            samples,
            adjustedSamples: new Array(resolution).fill(0),
            sampleCaps: new Array(resolution).fill(maxLift),
            liftApplied: 0,
            requestedPeak,
            requestedLiftRatio,
            isKeyChannel
        };
    });

    const densityWeightMap = {};
    let densitySum = 0;
    channelStates.forEach((state) => {
        const raw = Math.max(0, Number(densityWeights[state.name]) || 0);
        densityWeightMap[state.name] = raw;
        densitySum += raw;
    });
    if (densitySum <= EPSILON) {
        channelStates.forEach((state) => {
            densityWeightMap[state.name] = 1;
        });
        densitySum = channelStates.length || 1;
    }

    const residualOverflow = new Array(resolution).fill(0);

    for (let index = 0; index < resolution; index += 1) {
        const gain = Number.isFinite(gainCurve[index]) ? gainCurve[index] : 1;
        const baselineTotals = channelStates.reduce((sum, state) => sum + (state.samples[index] || 0), 0);

        const scaledEntries = channelStates.map((state) => {
            const baseValue = state.samples[index] || 0;
            const requestedValue = clampValueToLimit(baseValue * gain, 0, TOTAL);
            const requestedGain = Math.max(0, gain - 1);
            const allowedGain = Math.min(requestedGain, MAX_RELATIVE_GAIN);

            let sampleLimit;
            if (baseValue > EPSILON) {
                sampleLimit = clampValueToLimit(baseValue * (1 + allowedGain), 0, state.maxLift);
            } else if (requestedValue > 0) {
                sampleLimit = clampValueToLimit(state.baseEnd * allowedGain, 0, state.maxLift);
            } else {
                sampleLimit = 0;
            }

            if (state.isKeyChannel) {
                sampleLimit = Math.min(sampleLimit, baseValue);
            } else {
                sampleLimit = Math.min(sampleLimit, state.maxLift);
            }
            state.sampleCaps[index] = sampleLimit;

            const applied = Math.min(sampleLimit, requestedValue);
            const overflow = Math.max(0, requestedValue - applied);

            state.adjustedSamples[index] = applied;
            state.currentLimit = Math.max(state.currentLimit, applied);
            if (applied > state.baseEnd) {
                state.liftApplied = Math.max(state.liftApplied, applied - state.baseEnd);
            }

            return {
                state,
                baseValue,
                applied,
                overflow,
                share: baselineTotals > EPSILON ? baseValue / baselineTotals : 0
            };
        });

        let overflowRemaining = scaledEntries.reduce((sum, entry) => sum + entry.overflow, 0);
        let safety = 0;

        while (overflowRemaining > EPSILON && safety < 6) {
            safety += 1;
            const recipients = scaledEntries
                .map((entry) => {
                    const sampleCap = entry.state.sampleCaps?.[index] ?? entry.state.maxLift;
                    const capacity = Math.max(0, sampleCap - entry.state.adjustedSamples[index]);
                    if (capacity <= EPSILON) {
                        return null;
                    }
                    const densityNormalized = densityWeightMap[entry.state.name] / densitySum;
                    const baseShare = entry.share;
                    const weight = (0.55 * baseShare) + (0.35 * densityNormalized) + 0.1;
                    return {
                        entry,
                        capacity,
                        weight: weight * capacity
                    };
                })
                .filter(Boolean);

            if (!recipients.length) {
                break;
            }

            const totalWeight = recipients.reduce((sum, candidate) => sum + candidate.weight, 0);
            if (totalWeight <= EPSILON) {
                break;
            }

            let consumed = 0;
            recipients.forEach((candidate) => {
                if (overflowRemaining <= EPSILON) {
                    return;
                }
                const share = (candidate.weight / totalWeight) * overflowRemaining;
                const applied = Math.min(candidate.capacity, share);
                if (applied > EPSILON) {
                    const state = candidate.entry.state;
                    const sampleCap = state.sampleCaps?.[index] ?? state.maxLift;
                    const nextValue = Math.min(sampleCap, state.adjustedSamples[index] + applied);
                    const appliedDelta = Math.max(0, nextValue - state.adjustedSamples[index]);
                    if (appliedDelta > EPSILON) {
                        state.adjustedSamples[index] = nextValue;
                        state.currentLimit = Math.max(state.currentLimit, nextValue);
                        if (nextValue > state.baseEnd) {
                            state.liftApplied = Math.max(state.liftApplied, nextValue - state.baseEnd);
                        }
                        consumed += appliedDelta;
                    }
                }
            });

            overflowRemaining = Math.max(0, overflowRemaining - consumed);
        }

        if (overflowRemaining > EPSILON) {
            residualOverflow[index] = overflowRemaining;
        }
    }

    const updatedChannels = {};
    channelStates.forEach((state) => {
        const finalLimit = Math.round(Math.min(state.currentLimit, state.maxLift));
        updatedChannels[state.name] = {
            samples: state.adjustedSamples.map((value) => Math.round(clampValueToLimit(value, 0, TOTAL))),
            endValue: finalLimit,
            liftApplied: Math.max(0, Math.round(finalLimit - state.baseEnd)),
            baseEnd: state.baseEnd
        };
    });

    return {
        channels: updatedChannels,
        metadata: {
            residualOverflow,
            perChannelLift: channelStates.reduce((acc, state) => {
                acc[state.name] = Math.max(0, Math.round(Math.min(state.currentLimit, state.maxLift) - state.baseEnd));
                return acc;
            }, {}),
            requestedLiftRatio: channelStates.reduce((acc, state) => {
                acc[state.name] = Number.isFinite(state.requestedLiftRatio) ? state.requestedLiftRatio : 0;
                return acc;
            }, {})
        }
    };
}
