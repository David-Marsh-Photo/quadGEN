// Bell Curve Shift State Helpers
// Normalizes bell apex metadata storage on loadedQuadData.

const DEFAULT_WIDTH_SCALE = {
    leftFactor: 1,
    rightFactor: 1,
    linked: true,
    baselineHash: null,
    lastCurveHash: null,
    baselineCurve: null
};

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

function ensureWidthScale(entry) {
    if (!entry) return null;
    if (!entry.widthScale || typeof entry.widthScale !== 'object') {
        entry.widthScale = { ...DEFAULT_WIDTH_SCALE };
    } else {
        if (!Number.isFinite(entry.widthScale.leftFactor)) {
            entry.widthScale.leftFactor = 1;
        }
        if (!Number.isFinite(entry.widthScale.rightFactor)) {
            entry.widthScale.rightFactor = 1;
        }
        if (typeof entry.widthScale.linked !== 'boolean') {
            entry.widthScale.linked = true;
        }
        if (entry.widthScale.baselineHash == null) {
            entry.widthScale.baselineHash = null;
        }
        if (entry.widthScale.lastCurveHash == null) {
            entry.widthScale.lastCurveHash = null;
        }
        if (!Array.isArray(entry.widthScale.baselineCurve)) {
            entry.widthScale.baselineCurve = null;
        }
    }
    return entry.widthScale;
}

export function getBellWidthScale(loadedData, channelName) {
    const entry = getBellShiftEntry(loadedData, channelName, { create: false });
    if (!entry) return null;
    return cloneWidthScale(ensureWidthScale(entry));
}

export function setBellWidthScale(loadedData, channelName, updates = {}) {
    const entry = getBellShiftEntry(loadedData, channelName, { create: true });
    if (!entry) return null;
    const scale = ensureWidthScale(entry);
    if (!scale) return null;
    if (Number.isFinite(updates.leftFactor)) {
        scale.leftFactor = updates.leftFactor;
    }
    if (Number.isFinite(updates.rightFactor)) {
        scale.rightFactor = updates.rightFactor;
    }
    if (typeof updates.linked === 'boolean') {
        scale.linked = updates.linked;
    }
    if (Array.isArray(updates.baselineCurve)) {
        scale.baselineCurve = updates.baselineCurve.slice();
    }
    if (updates.invalidateBaseline) {
        scale.baselineHash = null;
        scale.lastCurveHash = null;
        scale.baselineCurve = null;
    }
    return cloneWidthScale(scale);
}

export function getBellShiftEntry(loadedData, channelName, { create = false } = {}) {
    if (!channelName) return null;
    const map = ensureContainer(loadedData);
    if (!map) return null;
    if (!map[channelName] && create) {
        map[channelName] = {};
    }
    const entry = map[channelName] || null;
    if (entry && create) {
        ensureWidthScale(entry);
    }
    return entry;
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

function cloneWidthScale(scale) {
    if (!scale) {
        return { ...DEFAULT_WIDTH_SCALE };
    }
    return {
        leftFactor: Number.isFinite(scale.leftFactor) ? scale.leftFactor : 1,
        rightFactor: Number.isFinite(scale.rightFactor) ? scale.rightFactor : 1,
        linked: typeof scale.linked === 'boolean' ? scale.linked : true,
        baselineHash: scale.baselineHash ?? null,
        lastCurveHash: scale.lastCurveHash ?? null
    };
}

function applyCurveHashToWidthScale(scale, curveHash) {
    if (!scale || !Number.isFinite(curveHash)) {
        return;
    }
    if (scale.baselineHash == null) {
        scale.baselineHash = curveHash;
        scale.lastCurveHash = curveHash;
        return;
    }
    if (scale.lastCurveHash !== curveHash) {
        scale.lastCurveHash = curveHash;
        scale.baselineHash = curveHash;
    }
}

export function getBellWidthBaselineCurve(loadedData, channelName) {
    const entry = getBellShiftEntry(loadedData, channelName, { create: false });
    if (!entry) return null;
    const scale = ensureWidthScale(entry);
    if (!scale?.baselineCurve || !Array.isArray(scale.baselineCurve)) {
        return null;
    }
    return scale.baselineCurve;
}

export function setBellWidthBaselineCurve(loadedData, channelName, samples) {
    if (!Array.isArray(samples)) return null;
    const entry = getBellShiftEntry(loadedData, channelName, { create: true });
    if (!entry) return null;
    const scale = ensureWidthScale(entry);
    scale.baselineCurve = samples.slice();
    return scale.baselineCurve;
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

    const widthScale = ensureWidthScale(entry);
    applyCurveHashToWidthScale(widthScale, classificationMeta?.curveHash);

    return {
        shift: cloneEntry(entry),
        widthScale: cloneWidthScale(widthScale)
    };
}

export function markBellShiftRequest(loadedData, channelName, requestedInputPercent) {
    if (!Number.isFinite(requestedInputPercent)) return null;
    const entry = getBellShiftEntry(loadedData, channelName, { create: true });
    if (!entry) return null;
    entry.requestedInputPercent = requestedInputPercent;
    entry.lastRequestedTs = Date.now();
    return entry;
}
