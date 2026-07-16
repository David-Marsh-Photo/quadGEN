import { createPCHIPSpline } from '../math/interpolation.js';
import { cieDensityFromLstar } from '../utils/lab-math.js';
import {
  getLabNormalizationMode,
  LAB_NORMALIZATION_MODES,
  getLabWidenFactor
} from '../core/lab-settings.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const IDENTITY_ALIGNMENT_THRESHOLD = 0.015;
const HIGHLIGHT_TAPER_MAX_INPUT = 0.15;

function blendHighlightWiden(pos, widenFactor) {
  if (!Number.isFinite(widenFactor) || widenFactor <= 1) {
    return 1;
  }
  const clampedPos = Math.max(0, Math.min(HIGHLIGHT_TAPER_MAX_INPUT, pos));
  if (clampedPos === HIGHLIGHT_TAPER_MAX_INPUT) {
    return widenFactor;
  }
  const t = HIGHLIGHT_TAPER_MAX_INPUT > 0 ? clampedPos / HIGHLIGHT_TAPER_MAX_INPUT : 1;
  // Smoothstep easing keeps transition gentle
  const eased = t * t * (3 - 2 * t);
  return 1 + (widenFactor - 1) * eased;
}

export function buildInkInterpolatorFromMeasurements(points, options = {}) {
  const sorted = [...points].sort((a, b) => a.input - b.input);
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
  let measuredInk;

  if (normalizationMode === LAB_NORMALIZATION_MODES.LSTAR) {
    const maxLab = Math.max(...sorted.map(point => point.lab));
    const minLab = Math.min(...sorted.map(point => point.lab));
    const span = Math.max(1e-6, maxLab - minLab);
    measuredInk = sorted.map(point => clamp01((maxLab - point.lab) / span));
  } else {
    const densityValues = sorted.map(point => cieDensityFromLstar(point.lab));
    const minDensity = Math.min(...densityValues);
    const maxDensity = Math.max(...densityValues);
    const span = Math.max(1e-6, maxDensity - minDensity);
    measuredInk = densityValues.map((value) => clamp01((value - minDensity) / span));
  }
  const positions = sorted.map(point => clamp01(point.input / 100));

  const identityDeviation = measuredInk.reduce((max, value, index) => {
    const deviation = Math.abs(value - (positions[index] ?? 0));
    return deviation > max ? deviation : max;
  }, 0);
  const treatAsIdentity = identityDeviation <= IDENTITY_ALIGNMENT_THRESHOLD;

  const smoothingBypass = skipDefaultSmoothing || treatAsIdentity;
  const baseWidenFactor = configuredWidenFactor
    || (smoothingBypass ? 1 : getLabWidenFactor());

  const neighbors = options.neighbors ?? 6;
  const sigmaFloor = options.sigmaFloor ?? 0.02;
  const sigmaCeil = options.sigmaCeil ?? 0.15;
  const sigmaAlpha = options.sigmaAlpha ?? 3.0;

  function buildPaddedKernel() {
    if (positions.length < 2) {
      return {
        positions: positions.slice(),
        values: measuredInk.slice()
      };
    }

    const paddedPositions = positions.slice();
    const paddedValues = measuredInk.slice();

    const spacingEstimate = (() => {
      let total = 0;
      let count = 0;
      for (let i = 1; i < positions.length; i += 1) {
        const delta = Math.abs(positions[i] - positions[i - 1]);
        if (delta > 0) {
          total += delta;
          count += 1;
        }
      }
      return count > 0 ? total / count : 0.05;
    })();

    const paddingSpan = sigmaCeil * 3; // cover ±3σ for the widest kernel
    const paddingSamples = Math.max(
      3,
      Math.ceil(paddingSpan / Math.max(spacingEstimate, 1e-6))
    );

    const extendSide = (direction) => {
      const idxA = direction > 0 ? positions.length - 1 : 0;
      const idxB = direction > 0 ? positions.length - 2 : 1;
      const spacing = Math.max(
        Math.abs(positions[idxA] - positions[idxB]),
        1e-6
      );
      const slope =
        (measuredInk[idxA] - measuredInk[idxB]) /
        Math.max(spacing, 1e-6);

      for (let step = 1; step <= paddingSamples; step += 1) {
        const offset = spacing * step * direction;
        const pos = positions[idxA] + offset;
        const val = clamp01(measuredInk[idxA] + slope * offset);
        if (direction > 0) {
          paddedPositions.push(pos);
          paddedValues.push(val);
        } else {
          paddedPositions.unshift(pos);
          paddedValues.unshift(val);
        }
      }
    };

    extendSide(-1);
    extendSide(1);

    return { positions: paddedPositions, values: paddedValues };
  }

  const paddedKernel = buildPaddedKernel();

  function localSigmaAt(t, sigmaPositions) {
    const n = sigmaPositions.length;
    if (n <= 1) return sigmaCeil;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sigmaPositions[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const distances = [];
    let left = lo - 1;
    let right = lo;
    while ((left >= 0 || right < n) && distances.length < neighbors) {
      const dl = left >= 0 ? Math.abs(t - sigmaPositions[left]) : Infinity;
      const dr = right < n ? Math.abs(t - sigmaPositions[right]) : Infinity;
      if (dl <= dr) {
        if (Number.isFinite(dl)) distances.push(dl);
        left -= 1;
      } else {
        if (Number.isFinite(dr)) distances.push(dr);
        right += 1;
      }
    }
    if (!distances.length) return sigmaCeil;
    distances.sort((a, b) => a - b);
    const midIdx = distances.length >> 1;
    const median = distances.length % 2 === 0
      ? 0.5 * (distances[midIdx - 1] + distances[midIdx])
      : distances[midIdx];
    return Math.min(sigmaCeil, Math.max(sigmaFloor, sigmaAlpha * median));
  }

  function smoothPoints(widenFactor = 1) {
    if (smoothingBypass) {
      const direct = measuredInk.slice();
      const epsilon = 1 / 4096;
      if (direct.length) {
        direct[0] = clamp01(measuredInk[0]);
        for (let i = 1; i < direct.length; i += 1) {
          if (direct[i] <= direct[i - 1]) {
            direct[i] = clamp01(direct[i - 1] + epsilon);
          }
        }
        const last = direct.length - 1;
        direct[last] = Math.max(direct[last], clamp01(measuredInk[measuredInk.length - 1]));
      }
      return direct;
    }

    const smoothed = measuredInk.map((value, idx) => {
      const pos = positions[idx];
      const highlightAdjusted = blendHighlightWiden(pos, widenFactor);
      const sigma = Math.min(
        sigmaCeil,
        Math.max(
          sigmaFloor,
          localSigmaAt(pos, paddedKernel.positions) * highlightAdjusted
        )
      );
      const denom = Math.max(1e-9, 2 * sigma * sigma);
      let numerator = 0;
      let weightSum = 0;
      for (let j = 0; j < paddedKernel.positions.length; j++) {
        const dist = Math.abs(pos - paddedKernel.positions[j]);
        const weight = Math.exp(-(dist * dist) / denom);
        numerator += paddedKernel.values[j] * weight;
        weightSum += weight;
      }
      const baseValue = weightSum > 0 ? numerator / weightSum : paddedKernel.values[idx];
      return clamp01(baseValue);
    });

    const epsilon = 1 / 4096;
    if (smoothed.length) {
      smoothed[0] = clamp01(measuredInk[0]);
      for (let i = 1; i < smoothed.length; i++) {
        if (smoothed[i] <= smoothed[i - 1]) {
          smoothed[i] = clamp01(smoothed[i - 1] + epsilon);
        }
      }
      const last = smoothed.length - 1;
      smoothed[last] = Math.max(smoothed[last], clamp01(measuredInk[measuredInk.length - 1]));
    }
    return smoothed;
  }

  function createSpline(widenFactor = baseWidenFactor) {
    const effectiveWiden = Math.max(0.1, Number.isFinite(widenFactor) ? widenFactor : baseWidenFactor);
    const smoothed = smoothPoints(effectiveWiden);
    const xsPercent = positions.map(p => p * 100);
    return createPCHIPSpline(xsPercent, smoothed);
  }

  const baseSpline = createSpline(baseWidenFactor);

  const toEvaluator = (spline) => (t) => clamp01(spline(clamp01(t) * 100));

  return {
    evaluate: toEvaluator(baseSpline),
    createEvaluator(widenFactor = baseWidenFactor) {
      return toEvaluator(createSpline(widenFactor));
    },
    positions: positions.slice()
  };
}
