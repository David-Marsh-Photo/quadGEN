// quadGEN CGATS.17 parser
// Ported from legacy quadgen.html implementation

import { DataSpace } from './processing-utils.js';
import {
  LAB_TUNING,
  getTargetRelAt,
  parseCgatsNumber,
  tokenizeCgatsLine
} from './lab-parser.js';
import { anchorSamplesToUnitRange, enforceMonotonicSamples } from './linearization-utils.js';
import { buildInkInterpolatorFromMeasurements } from './lab-utils.js';
import { getLabNormalizationMode } from '../core/lab-settings.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers } from '../legacy/legacy-helpers.js';

const CHANNEL_ZERO_TOLERANCE = 2.5;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function normalizeChannelValue(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) <= CHANNEL_ZERO_TOLERANCE ? 0 : value;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function stringOrNull(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeKey(key) {
  return (key || '').trim().toUpperCase();
}

function headerValueFromTokens(tokens) {
  return tokens.slice(1).join(' ').trim();
}

function spectralNmFromField(canonical) {
  if (!canonical) return null;
  const stripped = canonical.replace(/[^A-Z0-9]/g, '');
  const match = stripped.match(/(?:SPEC|SPECTRAL|NM)(\d{3})$/);
  if (!match) return null;
  const nm = parseInt(match[1], 10);
  return Number.isFinite(nm) ? nm : null;
}

function pickHeader(headerValues, ...keys) {
  for (const key of keys) {
    if (headerValues[key] !== undefined && headerValues[key] !== '') {
      return headerValues[key];
    }
  }
  return null;
}

function extractKOnlyData(dataPoints) {
  const filtered = dataPoints.filter((point) => {
    return !point.labOnly && point.cmykC === 0 && point.cmykM === 0 && point.cmykY === 0;
  });

  return filtered.map((point) => ({
    input: Number.isFinite(point.derivedInput) ? point.derivedInput : point.cmykK,
    labL: point.labL
  }));
}

function extractCompositeGrayscale(dataPoints) {
  if (!dataPoints.length) return [];

  const CHROMA_THRESHOLD = 4.5;
  const CHANNEL_TOLERANCE = 1.5;

  const neutralCandidates = dataPoints.filter((point) => {
    const hasChromaticity = Number.isFinite(point.labA) && Number.isFinite(point.labB);
    if (hasChromaticity) {
      return Math.abs(point.labA) <= CHROMA_THRESHOLD && Math.abs(point.labB) <= CHROMA_THRESHOLD;
    }

    return Math.abs(point.cmykC - point.cmykM) <= CHANNEL_TOLERANCE &&
      Math.abs(point.cmykM - point.cmykY) <= CHANNEL_TOLERANCE;
  });

  const candidates = neutralCandidates.length >= 3 ? neutralCandidates : dataPoints;

  const totals = candidates
    .map((point) => Number.isFinite(point.totalInk) ? point.totalInk : NaN)
    .filter((value) => Number.isFinite(value));

  if (!totals.length) return [];

  const maxTotal = Math.max(...totals);
  if (!(maxTotal > 0)) return [];

  const deduped = new Map();

  for (const point of candidates) {
    if (!Number.isFinite(point.totalInk)) continue;
    const normalized = (point.totalInk / maxTotal) * 100;
    const clamped = Math.max(0, Math.min(100, normalized));
    if (!Number.isFinite(clamped)) continue;

    const key = clamped.toFixed(4);
    const chroma = Math.abs(point.labA || 0) + Math.abs(point.labB || 0);

    if (deduped.has(key)) {
      const existing = deduped.get(key);
      if (chroma < existing.chroma) {
        deduped.set(key, { input: clamped, labL: point.labL, chroma });
      }
    } else {
      deduped.set(key, { input: clamped, labL: point.labL, chroma });
    }
  }

  const result = Array.from(deduped.values())
    .filter((entry) => Number.isFinite(entry.labL))
    .sort((a, b) => a.input - b.input)
    .map(({ input, labL }) => ({ input, labL }));

  return result.length >= 3 ? result : [];
}

function extractLabOnlyData(dataPoints) {
  const derived = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const point = dataPoints[i];
    if (!Number.isFinite(point.labL)) continue;
    if (Number.isFinite(point.derivedInput)) {
      derived.push({ input: point.derivedInput, labL: point.labL });
    }
  }

  if (derived.length >= 3) {
    derived.sort((a, b) => a.input - b.input);
    return derived;
  }

  if (dataPoints.length >= 3) {
    const fallback = [];
    const denom = Math.max(1, dataPoints.length - 1);
    for (let i = 0; i < dataPoints.length; i++) {
      const point = dataPoints[i];
      if (!Number.isFinite(point.labL)) continue;
      const position = (i / denom) * 100;
      fallback.push({ input: position, labL: point.labL });
    }
    if (fallback.length >= 3) return fallback;
  }

  return [];
}

export function parseCGATS17(fileContent, filename, options = {}) {
  const lines = fileContent.split(/\r?\n/);
  const formatFields = [];
  const spectralColumns = [];
  let spectralColumnsSorted = [];
  const headerValues = {};
  const dataPoints = [];
  const measurementPatches = [];

  let inDataFormat = false;
  let inData = false;
  let declaredFieldCount = null;
  let declaredSetCount = null;
  let rowCounter = 0;

  const pushFormatField = (name) => {
    const canonical = normalizeKey(name);
    const index = formatFields.length;
    formatFields.push({ name, canonical, index });
    const nm = spectralNmFromField(canonical);
    if (nm !== null) {
      spectralColumns.push({ name, canonical, index, nm });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const tokens = tokenizeCgatsLine(rawLine);
    if (!tokens.length) continue;
    const keyword = normalizeKey(tokens[0]);

    if (keyword === 'CGATS.17' || keyword === 'CTI3') {
      continue;
    }

    if (keyword === 'BEGIN_DATA_FORMAT') {
      inDataFormat = true;
      continue;
    }

    if (keyword === 'END_DATA_FORMAT') {
      inDataFormat = false;
      spectralColumnsSorted = spectralColumns.slice().sort((a, b) => {
        return a.nm - b.nm || a.index - b.index;
      });
      continue;
    }

    if (keyword === 'BEGIN_DATA') {
      if (!formatFields.length) {
        throw new Error('CGATS file missing data format definition before BEGIN_DATA');
      }
      inData = true;
      rowCounter = 0;
      continue;
    }

    if (keyword === 'END_DATA') {
      inData = false;
      break;
    }

    if (inDataFormat) {
      tokens.forEach(pushFormatField);
      continue;
    }

    if (inData) {
      const expectedFields = formatFields.length;
      if (expectedFields === 0) {
        throw new Error('CGATS file missing data format definition before data rows');
      }
      if (tokens.length < expectedFields) {
        throw new Error(`CGATS data row ${rowCounter + 1} has ${tokens.length} columns but expected ${expectedFields}`);
      }
      if (tokens.length > expectedFields) {
        throw new Error(`CGATS data row ${rowCounter + 1} has ${tokens.length} columns but expected ${expectedFields}`);
      }

      const valueByCanonical = Object.create(null);
      const rawRecord = {};
      for (let idx = 0; idx < expectedFields; idx++) {
        const field = formatFields[idx];
        const rawValue = tokens[idx] !== undefined ? tokens[idx] : '';
        rawRecord[field.name] = rawValue;
        valueByCanonical[field.canonical] = rawValue;
      }

      const sampleId = stringOrNull(valueByCanonical['SAMPLE_ID']);
      const sampleName = stringOrNull(valueByCanonical['SAMPLE_NAME']);

      const labLRaw = valueByCanonical['LAB_L'];
      const labARaw = valueByCanonical['LAB_A'];
      const labBRaw = valueByCanonical['LAB_B'];
      const labL = parseCgatsNumber(labLRaw);
      const labA = parseCgatsNumber(labARaw);
      const labB = parseCgatsNumber(labBRaw);

      const xyzX = parseCgatsNumber(valueByCanonical['XYZ_X']);
      const xyzY = parseCgatsNumber(valueByCanonical['XYZ_Y']);
      const xyzZ = parseCgatsNumber(valueByCanonical['XYZ_Z']);

      const cmykCValue = parseCgatsNumber(valueByCanonical['CMYK_C']);
      const cmykMValue = parseCgatsNumber(valueByCanonical['CMYK_M']);
      const cmykYValue = parseCgatsNumber(valueByCanonical['CMYK_Y']);
      const cmykKValue = parseCgatsNumber(valueByCanonical['CMYK_K']);

      let inputPercent = NaN;
      let inputSource = null;

      const inputPriority = [
        'CMYK_K', 'INPUT', 'GRAY_PERCENT', 'GRAY_%', 'GRAY',
        'PERCENT_INPUT', 'PCT_INPUT', 'PCT', 'TARGET', 'INTENT',
        'CHANNEL_K', 'DEVICE_K'
      ];

      for (const candidate of inputPriority) {
        if (valueByCanonical[candidate] !== undefined) {
          const parsed = parseCgatsNumber(valueByCanonical[candidate]);
          if (Number.isFinite(parsed)) {
            inputPercent = parsed;
            inputSource = candidate;
            break;
          }
        }
      }

      const rgbRValue = parseCgatsNumber(valueByCanonical['RGB_R']);
      const rgbGValue = parseCgatsNumber(valueByCanonical['RGB_G']);
      const rgbBValue = parseCgatsNumber(valueByCanonical['RGB_B']);

      if (!Number.isFinite(inputPercent) &&
          Number.isFinite(rgbRValue) &&
          Number.isFinite(rgbGValue) &&
          Number.isFinite(rgbBValue)) {
        const clamp255 = (v) => Math.max(0, Math.min(255, v));
        const avg = (clamp255(rgbRValue) + clamp255(rgbGValue) + clamp255(rgbBValue)) / 3;
        inputPercent = (1 - (avg / 255)) * 100;
        inputSource = 'RGB';
      }

      const normalizedInput = Number.isFinite(inputPercent) ? clampPercent(inputPercent) : NaN;
      const cmykCNormalized = normalizeChannelValue(cmykCValue);
      const cmykMNormalized = normalizeChannelValue(cmykMValue);
      const cmykYNormalized = normalizeChannelValue(cmykYValue);
      const derivedKRaw = Number.isFinite(cmykKValue) ? cmykKValue : (Number.isFinite(normalizedInput) ? normalizedInput : 0);
      const derivedK = clampPercent(derivedKRaw);
      const normalizedDerivedK = normalizeChannelValue(derivedK);
      const totalInk = Math.max(0, cmykCNormalized) +
        Math.max(0, cmykMNormalized) +
        Math.max(0, cmykYNormalized) +
        Math.max(0, normalizedDerivedK);

      if (Number.isFinite(labL) && labL >= 0 && labL <= 100) {
        dataPoints.push({
          labL,
          labA: Number.isFinite(labA) ? labA : null,
          labB: Number.isFinite(labB) ? labB : null,
          cmykK: derivedK,
          cmykC: cmykCNormalized,
          cmykM: cmykMNormalized,
          cmykY: cmykYNormalized,
          totalInk,
          derivedInput: Number.isFinite(normalizedInput) ? normalizedInput : NaN,
          inputSource,
          labOnly: !Number.isFinite(normalizedInput),
          sampleId,
          sampleName
        });
      }

      const device = {};
      if (Number.isFinite(cmykCValue) || Number.isFinite(cmykMValue) ||
          Number.isFinite(cmykYValue) || Number.isFinite(cmykKValue)) {
        device.cmyk = {
          c: Number.isFinite(cmykCValue) ? cmykCValue : null,
          m: Number.isFinite(cmykMValue) ? cmykMValue : null,
          y: Number.isFinite(cmykYValue) ? cmykYValue : null,
          k: Number.isFinite(cmykKValue)
            ? cmykKValue
            : (Number.isFinite(normalizedInput) ? normalizedInput : null)
        };
      }
      if (Number.isFinite(rgbRValue) || Number.isFinite(rgbGValue) || Number.isFinite(rgbBValue)) {
        device.rgb = {
          r: Number.isFinite(rgbRValue) ? rgbRValue : null,
          g: Number.isFinite(rgbGValue) ? rgbGValue : null,
          b: Number.isFinite(rgbBValue) ? rgbBValue : null
        };
      }
      const hasDevice = Object.keys(device).length > 0;

      let labEntry = null;
      if (Number.isFinite(labL)) {
        labEntry = {
          L: labL,
          a: Number.isFinite(labA) ? labA : null,
          b: Number.isFinite(labB) ? labB : null
        };
      }

      let xyzEntry = null;
      if (Number.isFinite(xyzX) || Number.isFinite(xyzY) || Number.isFinite(xyzZ)) {
        xyzEntry = {
          X: Number.isFinite(xyzX) ? xyzX : null,
          Y: Number.isFinite(xyzY) ? xyzY : null,
          Z: Number.isFinite(xyzZ) ? xyzZ : null
        };
      }

      let spectrum = null;
      if (spectralColumnsSorted.length) {
        const nm = [];
        const values = [];
        for (const column of spectralColumnsSorted) {
          nm.push(column.nm);
          const columnValue = tokens[column.index];
          const parsed = parseCgatsNumber(columnValue);
          values.push(Number.isFinite(parsed) ? parsed : null);
        }
        const finiteSpectral = values.some((v) => Number.isFinite(v));
        if (finiteSpectral) {
          spectrum = { nm, values };
        }
      }

      measurementPatches.push({
        ordinal: rowCounter + 1,
        id: sampleId,
        name: sampleName || sampleId,
        device: hasDevice ? device : null,
        lab: labEntry,
        xyz: xyzEntry,
        spectrum,
        derivedInput: Number.isFinite(normalizedInput) ? normalizedInput : null,
        inputSource: inputSource || null,
        raw: rawRecord
      });

      rowCounter++;
      continue;
    }

    const value = headerValueFromTokens(tokens);
    headerValues[keyword] = value;
    if (keyword === 'NUMBER_OF_FIELDS') {
      const parsed = parseInt(tokens[1], 10);
      if (Number.isFinite(parsed)) declaredFieldCount = parsed;
    } else if (keyword === 'NUMBER_OF_SETS') {
      const parsed = parseInt(tokens[1], 10);
      if (Number.isFinite(parsed)) declaredSetCount = parsed;
    }
  }

  if (!spectralColumnsSorted.length && spectralColumns.length) {
    spectralColumnsSorted = spectralColumns.slice().sort((a, b) => a.nm - b.nm || a.index - b.index);
  }

  if (!dataPoints.length) {
    throw new Error('No valid measurement data found in CGATS file');
  }

  if (declaredFieldCount !== null && declaredFieldCount !== formatFields.length) {
    throw new Error(`CGATS field count mismatch: NUMBER_OF_FIELDS declares ${declaredFieldCount} but parsed ${formatFields.length}`);
  }

  if (declaredSetCount !== null && declaredSetCount !== measurementPatches.length) {
    throw new Error(`CGATS row count mismatch: NUMBER_OF_SETS declares ${declaredSetCount} but found ${measurementPatches.length}`);
  }

  const spectralBandsDeclared = parseInt(headerValues['SPECTRAL_BANDS'], 10);
  const spectralStartDeclared = parseCgatsNumber(headerValues['SPECTRAL_START_NM']);
  const spectralEndDeclared = parseCgatsNumber(headerValues['SPECTRAL_END_NM']);

  if (Number.isFinite(spectralBandsDeclared) && spectralColumnsSorted.length && spectralColumnsSorted.length !== spectralBandsDeclared) {
    throw new Error(`CGATS spectral metadata mismatch: SPECTRAL_BANDS declares ${spectralBandsDeclared} but found ${spectralColumnsSorted.length}`);
  }

  if (spectralColumnsSorted.length) {
    const actualStart = spectralColumnsSorted[0].nm;
    const actualEnd = spectralColumnsSorted[spectralColumnsSorted.length - 1].nm;
    const tolerance = 1;
    if (Number.isFinite(spectralStartDeclared) && Math.abs(actualStart - spectralStartDeclared) > tolerance) {
      throw new Error(`CGATS spectral metadata mismatch: SPECTRAL_START_NM=${spectralStartDeclared} but first spectral column is ${actualStart}`);
    }
    if (Number.isFinite(spectralEndDeclared) && Math.abs(actualEnd - spectralEndDeclared) > tolerance) {
      throw new Error(`CGATS spectral metadata mismatch: SPECTRAL_END_NM=${spectralEndDeclared} but last spectral column is ${actualEnd}`);
    }
  }

  const rawHeader = {};
  Object.keys(headerValues).forEach((key) => {
    rawHeader[key] = headerValues[key];
  });

  const measurementMeta = {
    originator: pickHeader(headerValues, 'ORIGINATOR'),
    created: pickHeader(headerValues, 'CREATED'),
    descriptor: pickHeader(headerValues, 'DESCRIPTOR'),
    instrument: pickHeader(headerValues, 'INSTRUMENT', 'INSTRUMENTATION'),
    illuminant: pickHeader(headerValues, 'ILLUMINANT', 'ILLUMINATION_NAME', 'ILLUMINANT_NAME'),
    observer: pickHeader(headerValues, 'OBSERVER', 'OBSERVER_ANGLE', 'OBSERVER_NAME'),
    geometry: pickHeader(headerValues, 'MEASUREMENT_GEOMETRY', 'GEOMETRY'),
    aperture: pickHeader(headerValues, 'MEASUREMENT_APERTURE', 'APERTURE'),
    backing: pickHeader(headerValues, 'MEASUREMENT_BACKING', 'BACKING'),
    spectral: spectralColumnsSorted.length ? {
      declaredBands: Number.isFinite(spectralBandsDeclared) ? spectralBandsDeclared : null,
      declaredStartNm: Number.isFinite(spectralStartDeclared) ? spectralStartDeclared : null,
      declaredEndNm: Number.isFinite(spectralEndDeclared) ? spectralEndDeclared : null,
      actualBands: spectralColumnsSorted.length,
      actualStartNm: spectralColumnsSorted.length ? spectralColumnsSorted[0].nm : null,
      actualEndNm: spectralColumnsSorted.length ? spectralColumnsSorted[spectralColumnsSorted.length - 1].nm : null
    } : null,
    declaredSetCount,
    actualSetCount: measurementPatches.length
  };

  const measurementSet = {
    source: {
      filename: filename || null,
      format: 'CGATS.17'
    },
    schema: {
      fields: formatFields.map((field) => field.name),
      canonicalFields: formatFields.map((field) => field.canonical),
      numberOfFields: formatFields.length,
      declaredFieldCount,
      spectralColumns: spectralColumnsSorted.map((column) => ({
        name: column.name,
        nm: column.nm,
        index: column.index
      }))
    },
    meta: measurementMeta,
    patches: measurementPatches,
    raw: {
      header: rawHeader,
      text: fileContent
    }
  };

  let monochromeData = extractKOnlyData(dataPoints);
  let extractionMethod = 'K-only';

  if (monochromeData.length < 3) {
    const composite = extractCompositeGrayscale(dataPoints);
    if (composite.length >= 3) {
      monochromeData = composite;
      extractionMethod = 'composite';
    } else {
      const fallbackLab = extractLabOnlyData(dataPoints);
      if (fallbackLab.length >= 3) {
        monochromeData = fallbackLab;
        extractionMethod = 'LAB';
      }
    }

    if (monochromeData.length < 3) {
      throw new Error('CGATS file contains no suitable monochrome measurement data. Need minimum 3 points spanning 0-100% range.');
    }
  }

  const labPoints = monochromeData.map((point) => ({
    input: point.input,
    lab: point.labL
  }));

  labPoints.sort((a, b) => a.input - b.input);

  const originalDataPoints = labPoints.map((point) => ({
    input: Math.max(0, Math.min(100, Number(point.input))),
    lab: Math.max(0, Math.min(100, Number(point.lab)))
  }));

  const normalizationMode = options.normalizationMode || getLabNormalizationMode();

  const helper = buildInkInterpolatorFromMeasurements(originalDataPoints, {
    neighbors: LAB_TUNING.get('K_NEIGHBORS', 6),
    sigmaFloor: LAB_TUNING.get('SIGMA_FLOOR', 0.02),
    sigmaCeil: LAB_TUNING.get('SIGMA_CEIL', 0.15),
    sigmaAlpha: LAB_TUNING.get('SIGMA_ALPHA', 3.0),
    normalizationMode
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
  const samples = new Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    samples[i] = inverseEvaluator(t);
  }
  samples[0] = 0;
  samples[255] = 1;

  const monotonicSamples = enforceMonotonicSamples(samples);
  const anchoredSamples = anchorSamplesToUnitRange(monotonicSamples);

  return {
    valid: true,
    domainMin: 0,
    domainMax: 1,
    samples: anchoredSamples,
    originalData: originalDataPoints,
    format: `CGATS.17 (${extractionMethod})`,
    measurementSet,
    sourceSpace: DataSpace.SPACE.PRINTER,
    rawCgatsText: fileContent,
    filename: filename || 'measurements.cgats',
    measurementIntent: 'positive',
    edited: false,
    getSmoothingControlPoints(smoothingPercent) {
      const sp = Math.max(0, Math.min(90, Number(smoothingPercent) || 0));
      const widen = 1 + sp / 100;
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
}

registerLegacyHelpers({ parseCGATS17 });

registerDebugNamespace('cgatsParser', {
  parseCGATS17
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: ['parseCGATS17']
});
