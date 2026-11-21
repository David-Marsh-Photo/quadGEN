import { createPCHIPSpline } from '../math/interpolation.js';
import { cieDensityFromLstar } from '../utils/lab-math.js';
import {
  getLabNormalizationMode,
  LAB_NORMALIZATION_MODES,
  getLabWidenFactor
} from '../core/lab-settings.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const IDENTITY_ALIGNMENT_THRESHOLD = 0.015;
const MONOTONIC_EPSILON = 1 / 4096;
// The fitted response may sit this many standard deviations of reading noise
// away from a reading before it has to bend toward it. Across the 41 measurement
// files in data/ and testdata/, ±1.5σ landed corrections within a median 1.2 L*
// of the readings while bending less than the old Gaussian window; ±1σ bent as
// much as the old window and ±2σ gave up more accuracy. The slider widens it.
const NOISE_BAND_SIGMAS = 1.5;
// Floor for the per-reading noise estimate, in L* (about a spectrophotometer's
// repeatability), so clean or synthetic data still gets a small band.
const MIN_READING_NOISE_LSTAR = 0.25;
// Noise is estimated from a reading's neighbours only when they span at most
// this much input (21- and 25-patch layouts span 10%); sparser targets use the floor.
const MAX_NOISE_NEIGHBOUR_SPAN_PERCENT = 10.5;

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Averages repeated readings of the same patch input.
function averageRepeats(sorted) {
  const groups = [];
  sorted.forEach((point) => {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.input - point.input) < 1e-9) {
      last.readings.push(point.lab);
    } else {
      groups.push({ input: point.input, readings: [point.lab] });
    }
  });
  return groups.map(({ input, readings }) => ({
    input,
    readings,
    count: readings.length,
    lab: readings.reduce((sum, value) => sum + value, 0) / readings.length
  }));
}

// Noise of a single reading, in L*. Repeated patches give it directly (pooled
// standard deviation). Otherwise each reading is compared with the straight line
// through its neighbours and a robust spread of those differences is used
// (Gasser, Sroka & Jennen-Steinmetz, 1986).
function estimateReadingNoise(groups) {
  let sumSquares = 0;
  let degreesOfFreedom = 0;
  groups.forEach((group) => {
    if (group.count < 2) return;
    group.readings.forEach((value) => { sumSquares += (value - group.lab) ** 2; });
    degreesOfFreedom += group.count - 1;
  });
  if (degreesOfFreedom >= 2) {
    return Math.max(MIN_READING_NOISE_LSTAR, Math.sqrt(sumSquares / degreesOfFreedom));
  }

  // Only closely spaced neighbours: across wider gaps real curvature would be
  // mistaken for noise (a 5-patch target's S-shape reads as ~6 L* of "noise").
  const residuals = [];
  for (let i = 1; i < groups.length - 1; i += 1) {
    const before = groups[i - 1];
    const after = groups[i + 1];
    const span = after.input - before.input;
    if (!(span > 0) || span > MAX_NOISE_NEIGHBOUR_SPAN_PERCENT) continue;
    const w = (groups[i].input - before.input) / span;
    const expected = before.lab + w * (after.lab - before.lab);
    residuals.push((groups[i].lab - expected) / Math.sqrt(1 + w * w + (1 - w) ** 2));
  }
  if (residuals.length < 5) return MIN_READING_NOISE_LSTAR;
  const center = median(residuals);
  const spread = median(residuals.map((value) => Math.abs(value - center))) / 0.6745;
  return Math.max(MIN_READING_NOISE_LSTAR, spread);
}

// Pool-adjacent-violators: the closest weighted sequence that never increases,
// so a darker patch never reads lighter than the one before it.
function fitNonIncreasing(values, weights) {
  const blocks = [];
  values.forEach((value, i) => {
    blocks.push({ mean: value, weight: weights[i], size: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].mean < blocks[blocks.length - 1].mean) {
      const top = blocks.pop();
      const previous = blocks[blocks.length - 1];
      const weight = previous.weight + top.weight;
      previous.mean = (previous.mean * previous.weight + top.mean * top.weight) / weight;
      previous.weight = weight;
      previous.size += top.size;
    }
  });
  const fitted = [];
  blocks.forEach((block) => {
    for (let k = 0; k < block.size; k += 1) fitted.push(block.mean);
  });
  return fitted;
}

// Shortest path between the pinned end values that stays within [lower, upper]
// at every position (a taut string). It bends only where the band forces it, so
// it is the straightest curve the readings allow, and it never decreases when a
// non-decreasing path fits inside the band.
function tautString(xs, lower, upper) {
  const n = xs.length;
  const fitted = new Array(n);
  fitted[0] = lower[0];
  const drawLine = (from, to, endValue) => {
    for (let k = from + 1; k <= to; k += 1) {
      const t = (xs[k] - xs[from]) / (xs[to] - xs[from]);
      fitted[k] = fitted[from] + t * (endValue - fitted[from]);
    }
  };

  let anchor = 0;
  while (anchor < n - 1) {
    let minSlope = -Infinity;
    let maxSlope = Infinity;
    let minIndex = anchor;
    let maxIndex = anchor;
    for (let j = anchor + 1; j < n; j += 1) {
      const dx = xs[j] - xs[anchor];
      const lowSlope = (lower[j] - fitted[anchor]) / dx;
      const highSlope = (upper[j] - fitted[anchor]) / dx;
      if (lowSlope > maxSlope) {
        drawLine(anchor, maxIndex, upper[maxIndex]);
        anchor = maxIndex;
        break;
      }
      if (highSlope < minSlope) {
        drawLine(anchor, minIndex, lower[minIndex]);
        anchor = minIndex;
        break;
      }
      if (lowSlope > minSlope) { minSlope = lowSlope; minIndex = j; }
      if (highSlope < maxSlope) { maxSlope = highSlope; maxIndex = j; }
      if (j === n - 1) {
        drawLine(anchor, j, lower[j]);
        anchor = j;
      }
    }
  }
  return fitted;
}

function enforceRising(values, finalFloor = 0) {
  if (!values.length) return values;
  values[0] = clamp01(values[0]);
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] <= values[i - 1]) {
      values[i] = clamp01(values[i - 1] + MONOTONIC_EPSILON);
    }
  }
  const last = values.length - 1;
  values[last] = Math.max(values[last], clamp01(finalFloor));
  return values;
}

export function buildInkInterpolatorFromMeasurements(points, options = {}) {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point?.input) && Number.isFinite(point?.lab))
    .sort((a, b) => a.input - b.input);
  if (!sorted.length) {
    const identity = (t) => clamp01(t);
    return {
      evaluate: identity,
      createEvaluator: () => identity,
      positions: []
    };
  }

  const normalizationMode = options.normalizationMode || getLabNormalizationMode();
  const skipDefaultSmoothing = options.skipDefaultSmoothing === true;
  const configuredWidenFactor = Number.isFinite(options.widenFactor)
    ? Math.max(0.1, Number(options.widenFactor))
    : null;

  const groups = averageRepeats(sorted);
  const labs = groups.map((group) => group.lab);

  // Maps an L* reading to normalized ink (0 at the lightest reading, 1 at the
  // darkest), linear in L* or in CIE density. Not clamped, so band edges can
  // sit slightly outside [0, 1].
  const toInk = (() => {
    if (normalizationMode === LAB_NORMALIZATION_MODES.LSTAR) {
      const maxLab = Math.max(...labs);
      const span = Math.max(1e-6, maxLab - Math.min(...labs));
      return (lab) => (maxLab - lab) / span;
    }
    const density = (lab) => cieDensityFromLstar(Math.max(0, Math.min(100, lab)));
    const densities = labs.map(density);
    const minDensity = Math.min(...densities);
    const span = Math.max(1e-6, Math.max(...densities) - minDensity);
    return (lab) => (density(lab) - minDensity) / span;
  })();

  const measuredInk = labs.map((lab) => clamp01(toInk(lab)));
  const positions = groups.map((group) => clamp01(group.input / 100));

  const identityDeviation = measuredInk.reduce((max, value, index) => {
    const deviation = Math.abs(value - (positions[index] ?? 0));
    return deviation > max ? deviation : max;
  }, 0);
  const treatAsIdentity = identityDeviation <= IDENTITY_ALIGNMENT_THRESHOLD;

  const smoothingBypass = skipDefaultSmoothing || treatAsIdentity || groups.length < 3;
  const baseWidenFactor = configuredWidenFactor
    || (smoothingBypass ? 1 : getLabWidenFactor());

  const readingNoise = estimateReadingNoise(groups);
  const fittedLab = fitNonIncreasing(labs, groups.map((group) => group.count));

  // Smoothing is bounded by measurement noise instead of an averaging window:
  // the response is the straightest curve within ±1.5σ of every (averaged)
  // reading, where σ comes from repeats or neighbouring readings. The slider's
  // widen factor scales the band. End patches stay as read.
  function smoothPoints(widenFactor = 1) {
    if (smoothingBypass) {
      return enforceRising(measuredInk.slice(), measuredInk[measuredInk.length - 1]);
    }

    const last = groups.length - 1;
    const lower = [];
    const upper = [];
    groups.forEach((group, i) => {
      const isEnd = i === 0 || i === last;
      const band = isEnd ? 0 : (NOISE_BAND_SIGMAS * readingNoise * widenFactor) / Math.sqrt(group.count);
      lower.push(toInk(fittedLab[i] + band));
      upper.push(toInk(fittedLab[i] - band));
    });

    const fitted = tautString(positions, lower, upper);
    const start = fitted[0];
    const range = fitted[last] - start;
    const normalized = fitted.map((value) => (range > 1e-9 ? clamp01((value - start) / range) : 0));
    return enforceRising(normalized);
  }

  function createSpline(widenFactor = baseWidenFactor) {
    const effectiveWiden = Math.max(0.1, Number.isFinite(widenFactor) ? widenFactor : baseWidenFactor);
    const smoothed = smoothPoints(effectiveWiden);
    const xsPercent = positions.map((p) => p * 100);
    return createPCHIPSpline(xsPercent, smoothed);
  }

  const baseSpline = createSpline(baseWidenFactor);

  const toEvaluator = (spline) => (t) => clamp01(spline(clamp01(t) * 100));

  return {
    evaluate: toEvaluator(baseSpline),
    createEvaluator(widenFactor = baseWidenFactor) {
      return toEvaluator(createSpline(widenFactor));
    },
    positions: positions.slice(),
    // Allowed distance from each single reading at widen ×1, in L*.
    noiseBand: NOISE_BAND_SIGMAS * readingNoise
  };
}
