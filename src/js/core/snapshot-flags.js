// Snapshot flagging utilities

export const SNAPSHOT_FLAG_THRESHOLD_PERCENT = 7;
const DEFAULT_THRESHOLD = SNAPSHOT_FLAG_THRESHOLD_PERCENT;
const FLOAT_PRECISION = 3;

function clampNormalized(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function round(value, places = FLOAT_PRECISION) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const factor = 10 ** Math.max(0, Math.min(6, places));
    return Math.round(value * factor) / factor;
}

function extractNormalized(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const candidates = [
        entry.normalizedAfter,
        entry.normalized,
        entry.normalizedBefore
    ];
    for (let idx = 0; idx < candidates.length; idx += 1) {
        const normalized = clampNormalized(Number(candidates[idx]));
        if (normalized !== null) {
            return normalized;
        }
    }
    return null;
}

function toUniqueChannels(list = []) {
    const seen = new Set();
    const ordered = [];
    list.forEach((name) => {
        if (typeof name !== 'string' || !name) return;
        if (seen.has(name)) return;
        seen.add(name);
        ordered.push(name);
    });
    return ordered;
}

function buildFlagEntry(index, snapshot, flaggedChannels, threshold) {
    if (!flaggedChannels.length) return null;
    flaggedChannels.sort((a, b) => b.magnitude - a.magnitude);
    const dominant = flaggedChannels[0];
    const kind = dominant.delta >= 0 ? 'rise' : 'drop';
    const details = flaggedChannels.map((entry) => ({
        channel: entry.channel,
        delta: round(entry.delta, FLOAT_PRECISION),
        magnitude: round(entry.magnitude, FLOAT_PRECISION),
        direction: entry.delta >= 0 ? 'rise' : 'drop'
    }));
    const channels = flaggedChannels.map((entry) => entry.channel);

    const payload = {
        index,
        kind,
        magnitude: round(dominant.magnitude, FLOAT_PRECISION),
        threshold,
        channels,
        details
    };
    if (snapshot && Number.isFinite(snapshot.inputPercent)) {
        payload.inputPercent = Number(snapshot.inputPercent);
    }
    return payload;
}

export function computeSnapshotFlags(snapshots, options = {}) {
    const {
        thresholdPercent = DEFAULT_THRESHOLD,
        autoRaiseInProgress = false,
        channelNames = null
    } = options;

    if (!Array.isArray(snapshots) || snapshots.length < 2) {
        return {};
    }
    const threshold = Number.isFinite(thresholdPercent) && thresholdPercent > 0
        ? thresholdPercent
        : DEFAULT_THRESHOLD;
    if (autoRaiseInProgress) {
        return {};
    }

    const result = {};
    for (let i = 1; i < snapshots.length; i += 1) {
        const snapshot = snapshots[i];
        const previous = snapshots[i - 1];
        if (!snapshot || !previous) continue;

        const channels = toUniqueChannels(
            Array.isArray(channelNames) && channelNames.length
                ? channelNames
                : [
                    ...Object.keys(snapshot.perChannel || {}),
                    ...Object.keys(previous.perChannel || {})
                ]
        );
        if (!channels.length) continue;

        const flagged = [];
        channels.forEach((channel) => {
            const currentEntry = snapshot.perChannel?.[channel];
            const previousEntry = previous.perChannel?.[channel];
            if (!currentEntry || !previousEntry) return;

            const currentNormalized = extractNormalized(currentEntry);
            const previousNormalized = extractNormalized(previousEntry);
            if (currentNormalized === null || previousNormalized === null) {
                return;
            }

            const currentPercent = currentNormalized * 100;
            const previousPercent = previousNormalized * 100;
            const delta = currentPercent - previousPercent;
            const magnitude = Math.abs(delta);
            if (magnitude >= threshold) {
                flagged.push({
                    channel,
                    delta,
                    magnitude
                });
            }
        });

        const flagEntry = buildFlagEntry(
            Number.isInteger(snapshot?.index) ? snapshot.index : i,
            snapshot,
            flagged,
            threshold
        );
        if (flagEntry) {
            result[flagEntry.index] = flagEntry;
        }
    }
    return result;
}

function sanitizeDetail(detail) {
    if (!detail || typeof detail !== 'object') {
        return null;
    }
    const channel = typeof detail.channel === 'string' && detail.channel ? detail.channel : null;
    if (!channel) return null;
    const delta = Number(detail.delta);
    const magnitudeSource = Number.isFinite(detail.magnitude)
        ? Math.abs(detail.magnitude)
        : (Number.isFinite(delta) ? Math.abs(delta) : null);
    const magnitude = magnitudeSource != null ? round(magnitudeSource, FLOAT_PRECISION) : null;
    const direction = detail.direction === 'drop'
        ? 'drop'
        : (detail.direction === 'rise'
            ? 'rise'
            : (Number.isFinite(delta) && delta < 0 ? 'drop' : 'rise'));
    return {
        channel,
        delta: Number.isFinite(delta) ? round(delta, FLOAT_PRECISION) : null,
        magnitude,
        direction
    };
}

export function sanitizeSnapshotFlags(flags) {
    if (!flags || typeof flags !== 'object') {
        return {};
    }
    const sanitized = {};
    Object.entries(flags).forEach(([key, value]) => {
        if (!value || typeof value !== 'object') return;
        const index = Number.parseInt(key, 10);
        if (!Number.isInteger(index)) return;

        const threshold = Number.isFinite(value.threshold)
            ? Math.max(0, value.threshold)
            : DEFAULT_THRESHOLD;

        const channels = toUniqueChannels(
            Array.isArray(value.channels)
                ? value.channels
                : []
        );

        const details = Array.isArray(value.details)
            ? value.details.map(sanitizeDetail).filter(Boolean)
            : [];

        if (!channels.length && details.length) {
            details.forEach((detail) => {
                if (channels.includes(detail.channel)) return;
                channels.push(detail.channel);
            });
        }

        const magnitudeSource = Number.isFinite(value.magnitude)
            ? Math.abs(value.magnitude)
            : (details.length
                ? Math.max(...details.map((detail) => Math.abs(detail.magnitude ?? detail.delta ?? 0)))
                : null);
        const magnitude = magnitudeSource != null ? round(magnitudeSource, FLOAT_PRECISION) : null;

        const entry = {
            index,
            kind: value.kind === 'drop' ? 'drop' : 'rise',
            magnitude,
            threshold,
            channels,
            details
        };
        if (Number.isFinite(value.inputPercent)) {
            entry.inputPercent = Number(value.inputPercent);
        }
        sanitized[index] = entry;
    });
    return sanitized;
}

export function cloneSnapshotFlags(flags) {
    const sanitized = sanitizeSnapshotFlags(flags);
    const clone = {};
    Object.entries(sanitized).forEach(([key, entry]) => {
        clone[key] = {
            index: entry.index,
            kind: entry.kind,
            magnitude: entry.magnitude,
            threshold: entry.threshold,
            channels: Array.isArray(entry.channels) ? entry.channels.slice() : [],
            details: Array.isArray(entry.details)
                ? entry.details.map((detail) => ({ ...detail }))
                : [],
            inputPercent: Number.isFinite(entry.inputPercent) ? entry.inputPercent : undefined
        };
        if (!Number.isFinite(clone[key].inputPercent)) {
            delete clone[key].inputPercent;
        }
    });
    return clone;
}
