// quadGEN LAB and CGATS helper utilities
// Ported from legacy quadgen.html implementation

import { DataSpace } from './processing-utils.js';
import { CONTRAST_INTENT_PRESETS } from '../core/config.js';
import {
  clamp01,
  filmicSoftShoulder,
  popsCompatStandard
} from '../math/interpolation.js';
import {
  applySmoothingSequence,
  buildTargetFnFromSamples
} from './curve-simplification.js';
import { buildInkInterpolatorFromMeasurements } from './lab-utils.js';
import { enforceMonotonicSamples } from './linearization-utils.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { cieDensityFromLstar } from '../utils/lab-math.js';
import {
  LAB_NORMALIZATION_MODES,
  getLabNormalizationMode,
  getLabSmoothingPercent,
  getLabWidenFactor,
  mapSmoothingPercentToWiden
} from '../core/lab-settings.js';
export { lstarToY_CIE, cieDensityFromLstar, log10Safe as log10_safe } from '../utils/lab-math.js';

const DEFAULT_LAB_TUNING = {
  K_NEIGHBORS: 4,
  SIGMA_FLOOR: 0.036,
  SIGMA_CEIL: 0.30,
  SIGMA_ALPHA: 2.0
};

const DEFAULT_SMOOTHING_SEQUENCE = Object.freeze({
  passes: 2,
  percent: 30,
  algorithm: 'smoothing-splines'
});

export const LAB_TUNING = {
  overrides: null,

  setOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object') {
      this.overrides = null;
      return;
    }

    const sanitized = {};
    const addNumber = (key, value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        sanitized[key] = numeric;
      }
    };

    addNumber('K_NEIGHBORS', overrides.K_NEIGHBORS);
    addNumber('SIGMA_FLOOR', overrides.SIGMA_FLOOR);
    addNumber('SIGMA_CEIL', overrides.SIGMA_CEIL);
    addNumber('SIGMA_ALPHA', overrides.SIGMA_ALPHA);

    this.overrides = Object.keys(sanitized).length ? sanitized : null;
  },

  get(key, fallback) {
    const source = this.overrides && this.overrides[key];
    if (Number.isFinite(source)) return source;
    return DEFAULT_LAB_TUNING[key] !== undefined ? DEFAULT_LAB_TUNING[key] : fallback;
  },

  exportOverrides() {
    return this.overrides ? { ...this.overrides } : null;
  }
};

LAB_TUNING.setOverrides({
  K_NEIGHBORS: DEFAULT_LAB_TUNING.K_NEIGHBORS,
  SIGMA_FLOOR: DEFAULT_LAB_TUNING.SIGMA_FLOOR,
  SIGMA_CEIL: DEFAULT_LAB_TUNING.SIGMA_CEIL,
  SIGMA_ALPHA: DEFAULT_LAB_TUNING.SIGMA_ALPHA
});

let intentCache = {
  key: null,
  targetFn: (t) => clamp01(t)
};

function getActiveContrastIntent() {
  const scope = typeof globalThis !== 'undefined' ? globalThis : {};
  const globalIntent = scope?.contrastIntent;
  if (globalIntent && typeof globalIntent === 'object') {
    return globalIntent;
  }
  return { id: 'linear', name: 'Linear', params: {} };
}

function transformImageSamples(samples) {
  const transformed = DataSpace.convertSamples(samples, {
    from: DataSpace.SPACE.IMAGE,
    to: DataSpace.SPACE.PRINTER
  });
  return transformed.values;
}

function applyDefaultLabSmoothing(samples) {
  return computePreviewSamples(samples, getLabSmoothingPercent());
}

function computePreviewSamples(samples, percent = getLabSmoothingPercent()) {
  if (!Array.isArray(samples)) return [];
  let result = samples.slice();
  if (result.length < 2) {
    if (result.length === 1) result[0] = 0;
    return result;
  }

  const pct = Math.max(0, Number(percent) || 0);

  if (pct > 0) {
    result = applySmoothingSequence(result, pct, 'smoothing-splines');
    result = applySmoothingSequence(result, pct, 'smoothing-splines');
  }

  result[0] = 0;
  result[result.length - 1] = 1;
  return result;
}

function getGaussianDefaults() {
  return {
    neighbors: LAB_TUNING.get('K_NEIGHBORS', DEFAULT_LAB_TUNING.K_NEIGHBORS),
    sigmaFloor: LAB_TUNING.get('SIGMA_FLOOR', DEFAULT_LAB_TUNING.SIGMA_FLOOR),
    sigmaCeil: LAB_TUNING.get('SIGMA_CEIL', DEFAULT_LAB_TUNING.SIGMA_CEIL),
    sigmaAlpha: LAB_TUNING.get('SIGMA_ALPHA', DEFAULT_LAB_TUNING.SIGMA_ALPHA)
  };
}

export function getLabSmoothingDebug() {
  return {
    gaussian: getGaussianDefaults(),
    smoothingSequence: DEFAULT_SMOOTHING_SEQUENCE,
    anchorToUnitRange: true
  };
}

function buildCacheKey(id, params) {
  if (!params) return id;
  const entries = Object.keys(params)
    .sort()
    .map((key) => `${key}:${params[key]}`);
  return `${id}::${entries.join(',')}`;
}

export function getTargetRelAt(t) {
  const intent = getActiveContrastIntent();
  const id = intent?.id || 'linear';

  if (id === 'linear') {
    return clamp01(t);
  }

  const preset = CONTRAST_INTENT_PRESETS?.[id];

  if (preset && preset.curveFunction) {
    const presetParams = preset.params || {};

    if (typeof presetParams.gamma === 'number') {
      const imageGamma = presetParams.gamma;
      const printerGamma = 1 / Math.max(0.01, imageGamma);
      return Math.pow(clamp01(t), printerGamma);
    }

    try {
      const cacheKey = buildCacheKey(id, presetParams);
      if (intentCache.key !== cacheKey || typeof intentCache.targetFn !== 'function') {
        const samples = new Array(256);
        for (let i = 0; i < 256; i++) {
          samples[i] = clamp01(preset.curveFunction(i / 255));
        }
        intentCache = {
          key: cacheKey,
          targetFn: buildTargetFnFromSamples(transformImageSamples(samples))
        };
      }
      return intentCache.targetFn(t);
    } catch (error) {
      console.warn('Intent preset processing failed for', id, error);
      return clamp01(t);
    }
  }

  if (id === 'pops_standard') {
    try {
      const cacheKey = buildCacheKey(id, intent?.params);
      if (intentCache.key !== cacheKey || typeof intentCache.targetFn !== 'function') {
        const samples = new Array(256);
        for (let i = 0; i < 256; i++) {
          samples[i] = popsCompatStandard(i / 255);
        }
        intentCache = {
          key: cacheKey,
          targetFn: buildTargetFnFromSamples(transformImageSamples(samples))
        };
      }
      return intentCache.targetFn(t);
    } catch (error) {
      console.warn('Intent processing failed for pops_standard:', error);
      return clamp01(t);
    }
  }

  if (id === 'custom_gamma') {
    try {
      const imageGamma = Number(intent?.params?.gamma);
      const gamma = Number.isFinite(imageGamma) && imageGamma > 0 ? imageGamma : 1.0;
      const printerGamma = 1 / gamma;
      return Math.pow(clamp01(t), printerGamma);
    } catch (error) {
      console.warn('Intent processing failed for custom_gamma:', error);
      return clamp01(t);
    }
  }

  if (id === 'custom_filmic') {
    try {
      const gain = Number(intent?.params?.gain);
      const shoulder = Number(intent?.params?.shoulder);
      const cacheKey = buildCacheKey(id, { gain, shoulder });
      if (intentCache.key !== cacheKey || typeof intentCache.targetFn !== 'function') {
        const samples = new Array(256);
        const gainValue = Number.isFinite(gain) ? gain : 0.55;
        const shoulderValue = Number.isFinite(shoulder) ? shoulder : 0.35;
        for (let i = 0; i < 256; i++) {
          samples[i] = filmicSoftShoulder(i / 255, gainValue, shoulderValue);
        }
        intentCache = {
          key: cacheKey,
          targetFn: buildTargetFnFromSamples(transformImageSamples(samples))
        };
      }
      return intentCache.targetFn(t);
    } catch (error) {
      console.warn('Intent processing failed for custom_filmic:', error);
      return clamp01(t);
    }
  }

  if (id === 'custom_points' && typeof intent?.targetFn === 'function') {
    try {
      return clamp01(intent.targetFn(clamp01(t)));
    } catch (error) {
      console.warn('Intent processing failed for custom_points:', error);
      return clamp01(t);
    }
  }

  return clamp01(t);
}

export function tokenizeCgatsLine(line) {
  const tokens = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (ch === '#' || ch === ';')) {
      if (current) tokens.push(current);
      return tokens;
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

export function parseCgatsNumber(token) {
  if (token === undefined || token === null || token === '') return NaN;
  const cleaned = String(token).replace(/,/g, '').trim();
  if (!cleaned) return NaN;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

export function parseLabData(fileContent, filename, options = {}) {
  try {
    const lines = fileContent.split(/\r?\n/);
    const dataPoints = [];
    const normalizationMode = options.normalizationMode || getLabNormalizationMode();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      if (trimmed.toUpperCase().includes('GRAY') && trimmed.toUpperCase().includes('LAB_L')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;

      const grayPercent = parseFloat(parts[0]);
      const labL = parseFloat(parts[1]);

      if (!Number.isFinite(grayPercent) || !Number.isFinite(labL)) continue;
      if (labL < 0 || labL > 100) continue;

      const normalizedGray = grayPercent > 100 ? (grayPercent / 255) * 100 : grayPercent;
      if (normalizedGray < 0) continue;

      dataPoints.push({ input: normalizedGray, lab: labL });
    }

    if (dataPoints.length < 2) {
      throw new Error('Not enough valid LAB measurement data points found. Expected format: GRAY\tLAB_L\tLAB_A\tLAB_B');
    }

    dataPoints.sort((a, b) => a.input - b.input);
    const originalDataPoints = dataPoints.map((point) => ({ ...point }));

    const measuredSourceNormalizedList = (() => {
      if (!originalDataPoints.length) {
        return [];
      }
      if (normalizationMode === LAB_NORMALIZATION_MODES.LSTAR) {
        const maxLab = Math.max(...originalDataPoints.map(point => point.lab));
        const minLab = Math.min(...originalDataPoints.map(point => point.lab));
        const span = Math.max(1e-6, maxLab - minLab);
        return originalDataPoints.map(point => clamp01((maxLab - point.lab) / span));
      }
      const densityValues = originalDataPoints.map(point => cieDensityFromLstar(point.lab));
      const minDensity = Math.min(...densityValues);
      const maxDensity = Math.max(...densityValues);
      const span = Math.max(1e-6, maxDensity - minDensity);
      return densityValues.map(value => clamp01((value - minDensity) / span));
    })();

    const smoothingPercent = getLabSmoothingPercent();

    const helper = buildInkInterpolatorFromMeasurements(originalDataPoints, {
      neighbors: LAB_TUNING.get('K_NEIGHBORS', 6),
      sigmaFloor: LAB_TUNING.get('SIGMA_FLOOR', 0.02),
      sigmaCeil: LAB_TUNING.get('SIGMA_CEIL', 0.15),
      sigmaAlpha: LAB_TUNING.get('SIGMA_ALPHA', 3.0),
      normalizationMode,
      skipDefaultSmoothing: smoothingPercent <= 0,
      widenFactor: 1
    });

    const targetFn = (t) => clamp01(getTargetRelAt(t));

    const buildInverseEvaluator = (widenFactor = 1) => {
        const measuredEvaluator = helper.createEvaluator(Math.max(0.1, widenFactor));
        const baseline0 = measuredEvaluator(0);
        const baseline1 = measuredEvaluator(1);
        return (t) => {
            const clampedT = clamp01(t);
            const targetValue = clamp01(targetFn(clampedT));
            if (targetValue <= baseline0) return 0;
            if (targetValue >= baseline1) return 1;
            let lo = 0;
            let hi = 1;
            for (let iter = 0; iter < 40; iter++) {
                const mid = (lo + hi) / 2;
                const measured = measuredEvaluator(mid);
                if (!Number.isFinite(measured)) {
                    break;
                }
                if (measured < targetValue) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            return clamp01(hi);
        };
    };

    const inverseEvaluator = buildInverseEvaluator(1);
    const rawSamples = new Array(256);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        rawSamples[i] = inverseEvaluator(t);
    }
    rawSamples[0] = 0;
    rawSamples[255] = 1;

    const monotonicSamples = enforceMonotonicSamples(rawSamples);
    const previewSamples = monotonicSamples.slice();

    const measurementCorrections = (() => {
      const tolerancePercent = 1;
      const arrowClampPercent = 8;
      const evalFn = (() => {
        if (helper && typeof helper.evaluate === 'function') {
          return (t) => helper.evaluate(clamp01(t));
        }
        if (helper && typeof helper.createEvaluator === 'function') {
          const generated = helper.createEvaluator(1);
          if (typeof generated === 'function') {
            return (t) => generated(clamp01(t));
          }
        }
        return (t) => clamp01(t);
      })();

      const corrections = [];
      for (let index = 0; index < originalDataPoints.length; index += 1) {
        const point = originalDataPoints[index];
        if (!point) continue;
        const inputPercent = Math.max(0, Math.min(100, Number(point.input) || 0));
        const inputNormalized = clamp01(inputPercent / 100);
        const correctedValue = evalFn(inputNormalized);
        const correctedNormalized = Number.isFinite(correctedValue) ? clamp01(correctedValue) : inputNormalized;
        const measuredSourceNormalized = Number.isFinite(measuredSourceNormalizedList[index])
          ? measuredSourceNormalizedList[index]
          : inputNormalized;
        const targetNormalized = clamp01(targetFn(inputNormalized));
        const baseDeltaNormalized = targetNormalized - measuredSourceNormalized;
        const baseDeltaPercent = baseDeltaNormalized * 100;
        const baseMagnitudePercent = Math.abs(baseDeltaPercent);
        const withinToleranceBase = baseMagnitudePercent <= (tolerancePercent + 1e-9);
        const action = withinToleranceBase ? 'within' : (baseDeltaPercent > 0 ? 'darken' : 'lighten');
        const clampedMagnitude = Math.min(arrowClampPercent, baseMagnitudePercent);
        const normalizedMagnitude = arrowClampPercent > 0 ? clampedMagnitude / arrowClampPercent : 0;
        const direction = withinToleranceBase ? 0 : (baseDeltaPercent > 0 ? 1 : -1);
        corrections.push({
          index,
          inputPercent,
          inputNormalized,
          lab: Number(point.lab) || null,
          measuredSourceNormalized,
          measuredSourcePercent: measuredSourceNormalized * 100,
          measuredNormalized: correctedNormalized,
          correctedNormalized,
          correctedPercent: correctedNormalized * 100,
          measuredPercent: correctedNormalized * 100,
          targetNormalized,
          targetPercent: targetNormalized * 100,
          deltaNormalized: baseDeltaNormalized,
          deltaPercent: baseDeltaPercent,
          baseDeltaNormalized,
          baseDeltaPercent,
          baseMagnitudePercent,
          clampedMagnitudePercent: clampedMagnitude,
          normalizedMagnitude,
          tolerancePercent,
          arrowClampPercent,
          maxArrowPercent: arrowClampPercent,
          action,
          withinTolerance: withinToleranceBase,
          direction,
          isEndpoint: index === 0 || index === (originalDataPoints.length - 1)
        });
      }
      return corrections;
    })();

    // smoothingPercent already captured above for helper configuration

    return {
      valid: true,
      domainMin: 0,
      domainMax: 1,
      samples: previewSamples.slice(),
      rawSamples: monotonicSamples.slice(),
      baseSamples: monotonicSamples.slice(),
      previewSamples: previewSamples.slice(),
      previewSmoothingPercent: smoothingPercent,
      originalData: originalDataPoints,
      measurementCorrections,
      format: 'LAB Data',
      filename: filename || 'lab_measurements.txt',
      sourceSpace: DataSpace.SPACE.PRINTER,
      measurementIntent: 'positive',
      edited: false,
      getSmoothingControlPoints(smoothingPercent) {
        const sp = Math.max(0, Math.min(600, Number(smoothingPercent) || 0));
        const widen = mapSmoothingPercentToWiden(sp);
        const widenedInverse = buildInverseEvaluator(widen);
        const dyn = new Array(256);
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            dyn[i] = widenedInverse(t);
        }
        const monotonicDyn = enforceMonotonicSamples(dyn);
        const controlPointCount = Math.max(3, 21 - Math.floor(sp / 10));
        const cpY = [];
        const cpX = [];
        for (let i = 0; i < controlPointCount; i++) {
            const x = i / (controlPointCount - 1 || 1);
            const idx = Math.round(x * 255);
            cpX.push(x);
            cpY.push(monotonicDyn[idx]);
        }
        return {
            samples: cpY,
            xCoords: cpX,
            controlPointCount,
            needsDualTransformation: false
        };
      }
    };
  } catch (error) {
    console.error('Error parsing LAB data:', error);
    return {
      valid: false,
      error: error.message,
      format: 'LAB Data',
      filename
    };
  }
}

export function rebuildLabSamplesFromOriginal(originalDataPoints, options = {}) {
    const dataPoints = Array.isArray(originalDataPoints)
        ? originalDataPoints.map((point) => ({ input: point.input, lab: point.lab }))
        : [];

    if (dataPoints.length < 2) {
        return null;
    }

    dataPoints.sort((a, b) => a.input - b.input);

    const normalizationMode = options.normalizationMode || getLabNormalizationMode();

    const helperOptions = {
      neighbors: LAB_TUNING.get('K_NEIGHBORS', 6),
      sigmaFloor: LAB_TUNING.get('SIGMA_FLOOR', 0.02),
      sigmaCeil: LAB_TUNING.get('SIGMA_CEIL', 0.15),
      sigmaAlpha: LAB_TUNING.get('SIGMA_ALPHA', 3.0),
      normalizationMode,
      ...options
    };

    if (!Number.isFinite(helperOptions.widenFactor)) {
      if (options.useBaselineWidenFactor) {
        helperOptions.widenFactor = 1;
      } else {
        helperOptions.widenFactor = getLabWidenFactor();
      }
    }

    const helper = buildInkInterpolatorFromMeasurements(dataPoints, helperOptions);

    const targetFn = (t) => clamp01(getTargetRelAt(t));

    const buildInverseEvaluator = (widenFactor) => {
        const measuredEvaluator = typeof widenFactor === 'number'
            ? helper.createEvaluator(Math.max(0.1, widenFactor))
            : helper.createEvaluator();
        const baseline0 = measuredEvaluator(0);
        const baseline1 = measuredEvaluator(1);
        return (t) => {
            const clampedT = clamp01(t);
            const targetValue = clamp01(targetFn(clampedT));
            if (targetValue <= baseline0) return 0;
            if (targetValue >= baseline1) return 1;
            let lo = 0;
            let hi = 1;
            for (let iter = 0; iter < 40; iter++) {
                const mid = (lo + hi) / 2;
                const measured = measuredEvaluator(mid);
                if (!Number.isFinite(measured)) break;
                if (measured < targetValue) lo = mid;
                else hi = mid;
            }
            return clamp01(hi);
        };
    };

    const inverseEvaluator = buildInverseEvaluator(options.widenFactor);
    const samples = new Array(256);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        samples[i] = inverseEvaluator(t);
    }
    samples[0] = 0;
    samples[255] = 1;

    return enforceMonotonicSamples(samples);
}

export function applyDefaultLabSmoothingToEntry(entry, options = {}) {
  if (!entry || typeof entry !== 'object') return entry;

  const format = String(entry.format || '').toLowerCase();
  const isMeasurement = format.includes('lab') || format.includes('cgats') || format.includes('manual');
  if (!isMeasurement) return entry;

  if (!Array.isArray(entry.originalData) || entry.originalData.length < 2) {
    return entry;
  }

  const { useBaselineWidenFactor: _ignoredBaselineFlag, ...optionOverrides } = options;
  const normalizationMode = optionOverrides.normalizationMode || getLabNormalizationMode();

  const baselineOptions = {
    ...optionOverrides,
    normalizationMode
  };

  if (!Number.isFinite(optionOverrides.widenFactor)) {
    baselineOptions.useBaselineWidenFactor = true;
  }

  const rawSamples = rebuildLabSamplesFromOriginal(entry.originalData, {
    ...baselineOptions,
    skipDefaultSmoothing: true
  }) || null;

  const baseSamples = rebuildLabSamplesFromOriginal(entry.originalData, baselineOptions) || rawSamples;

  const smoothingPercent = getLabSmoothingPercent();
  const hasSmoothing = Number.isFinite(smoothingPercent) && smoothingPercent > 0;
  const previewWiden = hasSmoothing ? mapSmoothingPercentToWiden(smoothingPercent) : 1;

  const previewSamples = rebuildLabSamplesFromOriginal(entry.originalData, {
    ...optionOverrides,
    normalizationMode,
    widenFactor: previewWiden
  }) || baseSamples;

  if (rawSamples) {
    entry.rawSamples = rawSamples.slice();
  }

  if (baseSamples) {
    entry.baseSamples = baseSamples.slice();
  }

  if (previewSamples) {
    entry.previewSamples = previewSamples.slice();
    entry.samples = hasSmoothing ? previewSamples.slice() : baseSamples ? baseSamples.slice() : previewSamples.slice();
    if (!Array.isArray(entry.originalSamples)) {
      entry.originalSamples = previewSamples.slice();
    }
  } else if (baseSamples) {
    entry.samples = baseSamples.slice();
  }

  entry.previewSmoothingPercent = getLabSmoothingPercent();
  entry.domainMin = 0;
  entry.domainMax = 1;
  entry.sourceSpace = DataSpace.SPACE.PRINTER;
  return entry;
}

export function debugRebuildFromEntry(entry) {
  if (!entry || !Array.isArray(entry.originalData)) {
    return null;
  }

  const raw = entry.rawSamples
    ? entry.rawSamples.slice()
    : rebuildLabSamplesFromOriginal(entry.originalData, { skipDefaultSmoothing: true }) || [];
  const smoothed = entry.previewSamples
    ? entry.previewSamples.slice()
    : rebuildLabSamplesFromOriginal(entry.originalData, { skipDefaultSmoothing: false }) || [];

  return {
    raw,
    smoothed,
    rawFirst: raw.slice(0, 16),
    smoothedFirst: smoothed.slice(0, 16)
  };
}

export function extractLabOnlyData(dataPoints) {
  return (Array.isArray(dataPoints) ? dataPoints : []).filter((point) => {
    return Number.isFinite(point?.lab) &&
      point.lab >= 0 &&
      point.lab <= 100 &&
      Number.isFinite(point?.input) &&
      point.input >= 0 &&
      point.input <= 100;
  });
}

registerDebugNamespace('lab', {
  LAB_TUNING,
  parseLabData,
  getTargetRelAt,
  cieDensityFromLstar,
  getLabSmoothingDebug,
  rebuildLabSamplesFromOriginal,
  debugRebuildFromEntry,
  debugLabRebuildFromEntry: debugRebuildFromEntry
}, {
  exposeOnWindow: true,
  windowAliases: [
    'LAB_TUNING',
    'parseLabData',
    'getTargetRelAt',
    'cieDensityFromLstar',
    'rebuildLabSamplesFromOriginal',
    'debugLabRebuildFromEntry'
  ]
});
