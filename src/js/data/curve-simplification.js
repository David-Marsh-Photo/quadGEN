// Curve simplification utilities (legacy parity)

import { clamp01, createPCHIPSpline } from '../math/interpolation.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers, getLegacyScope } from '../legacy/legacy-helpers.js';

function logDebug(label, payload) {
  if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
    console.log(label, payload);
  }
}

export const CurveSimplification = {
  uniformSampling(samples, reductionPercent) {
    if (!Array.isArray(samples)) return [];
    if (reductionPercent === 0 || samples.length <= 3) return samples;

    const keepRatio = 1.0 - (reductionPercent / 100);
    const targetCount = Math.max(3, Math.round(samples.length * keepRatio));
    const step = (samples.length - 1) / (targetCount - 1);

    logDebug('🔍 Uniform Sampling DEBUG:', {
      originalPoints: samples.length,
      reductionPercent,
      keepRatio,
      targetCount,
      step
    });

    const reducedSamples = [];
    for (let i = 0; i < targetCount; i++) {
      const index = Math.round(i * step);
      reducedSamples.push(samples[index]);
    }

    logDebug('✅ Uniform Sampling Result:', `${samples.length} → ${reducedSamples.length} points`);
    return reducedSamples;
  },

  smoothingSplines(samples, reductionPercent) {
    if (!Array.isArray(samples)) return [];
    if (reductionPercent === 0 || samples.length <= 3) return samples;

    const n = samples.length;
    const keepRatio = 1.0 - (reductionPercent / 100);
    const targetCount = Math.max(3, Math.round(n * keepRatio));

    const x = [];
    const y = [];
    for (let i = 0; i < n; i++) {
      x.push(i / (n - 1));
      y.push(samples[i]);
    }

    const dataRange = Math.max(...y) - Math.min(...y);
    const lambda = Math.pow(reductionPercent / 100, 2) * dataRange * 0.1;

    logDebug('🔍 Smoothing Splines DEBUG:', {
      originalPoints: samples.length,
      reductionPercent,
      keepRatio,
      targetCount,
      dataRange,
      lambda
    });

    const spline = this._buildSmoothingSpline(x, y, lambda);

    const reducedSamples = [];
    for (let i = 0; i < targetCount; i++) {
      const t = i / (targetCount - 1);
      const value = this._evaluateSmoothingSpline(spline, x, y, t);
      reducedSamples.push(value);
    }

    logDebug('✅ Smoothing Splines Result:', `${samples.length} → ${reducedSamples.length} points`);
    return reducedSamples;
  },

  _buildSmoothingSpline(x, y, lambda) {
    const n = x.length;
    if (n < 4) return { x, y, c: new Array(n).fill(0) };

    const h = [];
    for (let i = 0; i < n - 1; i++) {
      h[i] = x[i + 1] - x[i];
    }

    const A = new Array(n).fill(null).map(() => new Array(n).fill(0));
    const b = new Array(n).fill(0);

    A[0][0] = 1 + lambda;
    A[n - 1][n - 1] = 1 + lambda;
    b[0] = y[0];
    b[n - 1] = y[n - 1];

    for (let i = 1; i < n - 1; i++) {
      const hi_1 = h[i - 1];
      const hi = h[i];

      A[i][i] = 1;
      b[i] = y[i];

      if (lambda > 0) {
        A[i][i] += lambda * (2 / (hi_1 + hi));
        if (i > 1) A[i][i - 1] = -lambda / (hi_1 + hi);
        if (i < n - 2) A[i][i + 1] = -lambda / (hi_1 + hi);
      }
    }

    const c = this._solveTridiagonal(A, b);
    return { x, y, c };
  },

  _evaluateSmoothingSpline(spline, x, y, t) {
    const { x: sx, y: sy, c } = spline;
    const n = sx.length;

    t = Math.max(0, Math.min(1, t));

    let i = 0;
    while (i < n - 1 && sx[i + 1] < t) i++;
    if (i >= n - 1) return sy[n - 1];

    const h = sx[i + 1] - sx[i];
    const dt = t - sx[i];
    const ratio = h > 0 ? dt / h : 0;

    const y0 = sy[i];
    const y1 = sy[i + 1];
    const c0 = c[i];
    const c1 = c[i + 1];

    const t2 = ratio * ratio;
    const t3 = t2 * ratio;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + ratio;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * y0 + h10 * h * c0 + h01 * y1 + h11 * h * c1;
  },

  _solveTridiagonal(A, b) {
    const n = A.length;
    const x = new Array(n).fill(0);

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][i]) < 1e-12) continue;
        const factor = A[j][i] / A[i][i];
        for (let k = i; k < n; k++) {
          A[j][k] -= factor * A[i][k];
        }
        b[j] -= factor * b[i];
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      x[i] = b[i];
      for (let j = i + 1; j < n; j++) {
        x[i] -= A[i][j] * x[j];
      }
      if (Math.abs(A[i][i]) > 1e-12) {
        x[i] /= A[i][i];
      }
    }

    return x;
  },

  applySmoothingReduction(samples, reductionPercent, algorithm = 'smoothing-splines') {
    if (reductionPercent === 0) return samples;

    switch (algorithm) {
      case 'smoothing-splines':
        return this.smoothingSplines(samples, reductionPercent);
      case 'uniform':
        return this.uniformSampling(samples, reductionPercent);
      default:
        return this.smoothingSplines(samples, reductionPercent);
    }
  }
};

export function buildTargetFnFromSamples(samples) {
  try {
    const list = Array.isArray(samples) ? samples.slice() : [];
    const n = list.length;
    if (n < 2) {
      return (t) => clamp01(t);
    }

    const xs = new Array(n);
    const ys = list.map((value) => clamp01(Number(value) || 0));
    for (let i = 0; i < n; i++) {
      xs[i] = n === 1 ? 0 : i / (n - 1);
    }

    const pchip = createPCHIPSpline(xs, ys);
    return (t) => clamp01(pchip(clamp01(t)));
  } catch (error) {
    console.warn('buildTargetFnFromSamples fallback to linear:', error);
    return (t) => clamp01(t);
  }
}

export function applySmoothingSequence(samples, percent, algorithm = 'smoothing-splines') {
  if (!Array.isArray(samples) || !samples.length) {
    return Array.isArray(samples) ? samples.slice() : [];
  }

  const pct = Math.max(0, Number(percent) || 0);
  if (pct <= 0) return samples.slice();

  try {
    const normalized = samples.map((value) => clamp01(Number(value) || 0));
    const reduced = CurveSimplification.applySmoothingReduction(normalized, pct, algorithm);
    const fn = buildTargetFnFromSamples(reduced);

    const dense = new Array(samples.length);
    const denom = dense.length - 1;
    for (let i = 0; i < dense.length; i++) {
      const t = denom > 0 ? (i / denom) : 0;
      dense[i] = clamp01(fn(t));
    }

    dense[0] = 0;
    dense[dense.length - 1] = 1;
    return dense;
  } catch (error) {
    console.warn('Intent tuning smoothing failed:', error);
    return samples.slice();
  }
}

export function normalizeSmoothingAlgorithm(id) {
  switch (id) {
    case 'uniform':
      return 'uniform';
    case 'smoothing-splines':
    default:
      return 'smoothing-splines';
  }
}

const legacyScope = getLegacyScope();
legacyScope.CurveSimplification = legacyScope.CurveSimplification || CurveSimplification;

registerLegacyHelpers({
  CurveSimplification
});

registerDebugNamespace('curveSimplification', {
  CurveSimplification
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: ['CurveSimplification']
});
