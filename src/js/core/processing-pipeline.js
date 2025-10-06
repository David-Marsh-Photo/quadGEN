// quadGEN Core Processing Pipeline
// Main curve generation, LUT application, and file building functions

import { CURVE_RESOLUTION, DataSpace } from '../data/processing-utils.js';
import { elements, getCurrentPrinter, getAppState, TOTAL, getLoadedQuadData } from './state.js';
import { InputValidator } from './validation.js';
import { ControlPoints, isSmartCurve } from '../curves/smart-curves.js';
import { LinearizationState, ensurePrinterSpaceData, normalizeLinearizationEntry } from '../data/linearization-utils.js';
import { createCubicSpline, createCatmullRomSpline, createPCHIPSpline, clamp01 } from '../math/interpolation.js';
import { captureMake256Step } from '../debug/debug-make256.js';
import { CurveSimplification, normalizeSmoothingAlgorithm } from '../data/curve-simplification.js';
import { isLabLinearizationData, processLabLegacy } from '../data/lab-legacy-bypass.js';
import { AUTO_LIMIT_CONFIG } from './auto-limit-config.js';
import { setChannelAutoLimitMeta, clearChannelAutoLimitMeta } from './auto-limit-state.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getLegacyLinearizationBridge } from '../legacy/linearization-bridge.js';
import { isActiveRangeLinearizationEnabled, isCubeEndpointAnchoringEnabled } from './feature-flags.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
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

/**
 * Processing pipeline constants
 */
export const PROCESSING_CONSTANTS = {
    CURVE_RESOLUTION,
    TOTAL,
    N: CURVE_RESOLUTION // Legacy alias
};

const DENOM = CURVE_RESOLUTION - 1;

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
export function buildBaseCurve(endValue, channelName, smartCurveDetected = false) {
    try {
        if (endValue === 0) {
            return {
                shortCircuit: true,
                values: new Array(CURVE_RESOLUTION).fill(0)
            };
        }

        const data = getLoadedQuadData();

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

            let treatAsSmart = smartCurveDetected;
            if (!treatAsSmart) {
                try {
                    const curveMax = Math.max(...loadedCurve);
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
                        curveMax: Math.max(...loadedCurve)
                    });
                }

                return {
                    shortCircuit: false,
                    values: loadedCurve.slice()
                };
            }

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[buildBaseCurve] treat as loaded measurement', { channelName, endValue });
            }

            const baseline = (data.baselineEnd && typeof data.baselineEnd[channelName] === 'number')
                ? data.baselineEnd[channelName]
                : Math.max(...loadedCurve);
            const scale = baseline > 0 ? (endValue / baseline) : 0;
            return {
                shortCircuit: false,
                values: loadedCurve.map((v) => Math.round(v * scale))
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

    const previewSmoothing = typeof normalizedEntry.previewSmoothingPercent === 'number'
        ? normalizedEntry.previewSmoothingPercent
        : smoothingPercent;

    captureMake256Step(channelName, 'per_baseValues', values);

    const lutSource = {
        ...normalizedEntry,
        __debugChannelName: channelName,
        __debugStage: 'per',
        smoothingAlgorithm: normalizeSmoothingAlgorithm(normalizedEntry.smoothingAlgorithm || 'smoothing-splines')
    };

    captureMake256Step(channelName, 'per_lutSamples', Array.isArray(lutSource.samples) ? lutSource.samples : []);

    let result = apply1DLUT(
        values,
        lutSource,
        domainMin,
        domainMax,
        endValue,
        interpolationType,
        previewSmoothing
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
            previewSmoothing
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
    const bakedGlobal = !!meta.bakedGlobal;
    const shouldSkipGlobal = bakedGlobal || smartApplied;

    if (shouldSkipGlobal) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[global] skipped', { channelName, bakedGlobal, smartApplied });
        }
        return values;
    }

    const printerSpaceEntry = ensurePrinterSpaceData(globalData) || globalData;
    const normalizedEntry = normalizeLinearizationEntry(printerSpaceEntry);

    if (!normalizedEntry || !Array.isArray(normalizedEntry.samples) || normalizedEntry.samples.length < 2) {
        return values;
    }

    const domainMin = typeof normalizedEntry.domainMin === 'number' ? normalizedEntry.domainMin : 0;
    const domainMax = typeof normalizedEntry.domainMax === 'number' ? normalizedEntry.domainMax : 1;
    const previewSmoothing = typeof normalizedEntry.previewSmoothingPercent === 'number'
        ? normalizedEntry.previewSmoothingPercent
        : smoothingPercent;

    let lutSource = normalizedEntry;
    if (previewSmoothing > 0 && Array.isArray(normalizedEntry.baseSamples)) {
        lutSource = {
            ...normalizedEntry,
            samples: normalizedEntry.baseSamples.slice()
        };
    }

    return apply1DLUT(
        values,
        lutSource,
        domainMin,
        domainMax,
        endValue,
        interpolationType,
        previewSmoothing
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
        const base = buildBaseCurve(endValue, channelName, smartApplied);
        if (base.shortCircuit) {
            return base.values;
        }

        let arr = base.values.slice();

        if (debugEnabled) {
            console.log('[MAKE256] after base', { channelName, first: arr.slice(0, 10), mid: arr[Math.floor(arr.length / 2)], last: arr.slice(-10) });
        }

        // Get interpolation type from UI
        const interpolationType = elements.curveSmoothingMethod?.value || 'cubic';
        // For LAB data, use the tuning smoothing percentage; otherwise use 0 (deprecated slider)
        const globalData = LinearizationState.getGlobalData();
        const globalApplied = LinearizationState.globalApplied;
        const perChannelData = LinearizationState.getPerChannelData(channelName);
        const hasLabData = (globalData && globalApplied && isLabLinearizationData(globalData)) ||
                          (perChannelData && isLabLinearizationData(perChannelData));
        const smoothingPercent = (hasLabData && elements.tuningSmoothingPercent) ?
                                 (Number(elements.tuningSmoothingPercent.value) || 0) : 0;

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

        arr = applyAutoEndpointAdjustments(arr, endValue, channelName, smartApplied);

        if (debugEnabled) {
            console.log('[MAKE256] final', { channelName, first: arr.slice(0, 10), mid: arr[Math.floor(arr.length / 2)], last: arr.slice(-10) });
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

        return result;

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
        return enforceMonotonic(remapped);
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
    applyGlobalLinearizationStep
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['make256', 'apply1DLUT', 'buildFile', 'buildBaseCurve']
});
