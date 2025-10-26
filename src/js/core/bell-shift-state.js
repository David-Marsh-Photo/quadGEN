// Bell Curve Shift State Helpers
// Normalizes bell apex metadata storage on loadedQuadData.

function ensureContainer(loadedData) {
    if (!loadedData || typeof loadedData !== 'object') {
        return null;
    }
    if (!loadedData.bellCurveShift || typeof loadedData.bellCurveShift !== 'object') {
        loadedData.bellCurveShift = {};
    }
    return loadedData.bellCurveShift;
}

export function ensureBellShiftContainer(loadedData) {
    return ensureContainer(loadedData);
}

export function getBellShiftEntry(loadedData, channelName, { create = false } = {}) {
    if (!channelName) return null;
    const map = ensureContainer(loadedData);
    if (!map) return null;
    if (!map[channelName] && create) {
        map[channelName] = {};
    }
    return map[channelName] || null;
}

export function clearBellShiftEntry(loadedData, channelName) {
    if (!channelName) return;
    const map = ensureContainer(loadedData);
    if (!map || !map[channelName]) return;
    delete map[channelName];
}

function cloneEntry(entry) {
    if (!entry) return null;
    return {
        baselineInputPercent: Number.isFinite(entry.baselineInputPercent) ? entry.baselineInputPercent : null,
        baselineOutputPercent: Number.isFinite(entry.baselineOutputPercent) ? entry.baselineOutputPercent : null,
        latestInputPercent: Number.isFinite(entry.latestInputPercent) ? entry.latestInputPercent : null,
        latestOutputPercent: Number.isFinite(entry.latestOutputPercent) ? entry.latestOutputPercent : null,
        offsetPercent: Number.isFinite(entry.offsetPercent) ? entry.offsetPercent : 0,
        requestedInputPercent: Number.isFinite(entry.requestedInputPercent) ? entry.requestedInputPercent : null,
        lastClassificationTs: entry.lastClassificationTs || null,
        lastRequestedTs: entry.lastRequestedTs || null
    };
}

export function syncBellShiftFromMeta(loadedData, channelName, classificationMeta) {
    const map = ensureContainer(loadedData);
    if (!map) return null;

    if (!classificationMeta || classificationMeta.classification !== 'bell') {
        if (map[channelName]) {
            delete map[channelName];
        }
        return null;
    }

    const apexInput = Number.isFinite(classificationMeta.apexInputPercent)
        ? classificationMeta.apexInputPercent
        : Number.isFinite(classificationMeta.peakInputPercent)
            ? classificationMeta.peakInputPercent
            : null;
    const apexOutput = Number.isFinite(classificationMeta.apexOutputPercent)
        ? classificationMeta.apexOutputPercent
        : Number.isFinite(classificationMeta.normalizedPeak)
            ? classificationMeta.normalizedPeak * 100
            : null;

    const entry = getBellShiftEntry(loadedData, channelName, { create: true });
    if (entry) {
        if (!Number.isFinite(entry.baselineInputPercent) && Number.isFinite(apexInput)) {
            entry.baselineInputPercent = apexInput;
        }
        if (!Number.isFinite(entry.baselineOutputPercent) && Number.isFinite(apexOutput)) {
            entry.baselineOutputPercent = apexOutput;
        }
        entry.latestInputPercent = apexInput;
        entry.latestOutputPercent = apexOutput;
        if (Number.isFinite(entry.baselineInputPercent) && Number.isFinite(apexInput)) {
            entry.offsetPercent = apexInput - entry.baselineInputPercent;
        } else {
            entry.offsetPercent = 0;
        }
        if (!Number.isFinite(entry.requestedInputPercent) && Number.isFinite(apexInput)) {
            entry.requestedInputPercent = apexInput;
        }
        entry.lastClassificationTs = Date.now();
    }

    return cloneEntry(entry);
}

export function markBellShiftRequest(loadedData, channelName, requestedInputPercent) {
    if (!Number.isFinite(requestedInputPercent)) return null;
    const entry = getBellShiftEntry(loadedData, channelName, { create: true });
    if (!entry) return null;
    entry.requestedInputPercent = requestedInputPercent;
    entry.lastRequestedTs = Date.now();
    return entry;
}
