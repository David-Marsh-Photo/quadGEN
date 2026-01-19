// quadGEN Mathematical Functions - Interpolation and Splines
// Extracted from original monolithic file

// Basic mathematical utilities
export const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function schlickBias(t, b) {
  const k = (1/Math.max(1e-6, b) - 2);
  return t / (k * (1 - t) + 1);
}

export function schlickGain(t, g) {
  if (t < 0.5) return 0.5 * schlickBias(t*2, 1-g);
  return 1 - 0.5 * schlickBias(2 - 2*t, 1-g);
}

export function gammaMap(t, gamma) {
  const g = Math.max(0.01, Number(gamma)||1.0);
  return Math.pow(clamp01(t), g);
}

export function filmicSoftShoulder(t, gain, shoulder) {
  const y = schlickGain(clamp01(t), clamp01(gain));
  const y2 = 1 - Math.pow(1 - y, 1 + clamp01(shoulder));
  return clamp01(y2);
}

export function popsCompatStandard(t) {
  const y = schlickGain(clamp01(t), 0.55);
  const shoulder = 0.15;
  const y2 = 1 - Math.pow(1 - y, 1 + shoulder);
  return clamp01(y2);
}

/**
 * Binary search to find the interval index for a value in a sorted array.
 * Returns index i such that x[i] <= t < x[i+1] (or boundary indices for edge cases).
 * O(log n) instead of O(n) linear search.
 * @param {number[]} x - Sorted array of x values
 * @param {number} t - Value to find interval for
 * @returns {number} Index of the interval
 */
function findIntervalBinary(x, t) {
  const n = x.length;
  if (n < 2) return 0;
  if (t <= x[0]) return 0;
  if (t >= x[n - 1]) return n - 2;

  let lo = 0;
  let hi = n - 1;

  // Binary search for the interval containing t
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1; // Integer division by 2
    if (x[mid] <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

/**
 * Cubic spline interpolation
 * @param {number[]} x - input points (typically 0, 1, 2, ..., n-1)
 * @param {number[]} y - output values at each point
 * @returns {function} interpolation function that takes a value and returns interpolated result
 */
export function createCubicSpline(x, y) {
  const n = x.length;
  if (n < 2) return (t) => y[0] || 0;

  // Use clamped cubic spline with estimated end derivatives for more curvature
  const h = new Array(n - 1);
  const alpha = new Array(n);
  const l = new Array(n);
  const mu = new Array(n);
  const z = new Array(n);
  const c = new Array(n);
  const b = new Array(n);
  const d = new Array(n);

  // Step 1: Calculate h
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
  }

  // Step 2: Set up alpha with clamped boundary conditions
  // Estimate end derivatives to allow more curvature
  const firstDerivative = (y[1] - y[0]) / h[0];
  const lastDerivative = (y[n-1] - y[n-2]) / h[n-2];

  alpha[0] = 3 * ((y[1] - y[0]) / h[0] - firstDerivative);
  alpha[n-1] = 3 * (lastDerivative - (y[n-1] - y[n-2]) / h[n-2]);

  for (let i = 1; i < n - 1; i++) {
    alpha[i] = (3 / h[i]) * (y[i + 1] - y[i]) - (3 / h[i - 1]) * (y[i] - y[i - 1]);
  }

  // Step 3: Solve tridiagonal system with clamped conditions
  l[0] = 2 * h[0];
  mu[0] = 0.5;
  z[0] = alpha[0] / l[0];

  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }

  l[n - 1] = h[n - 2] * (2 - mu[n - 2]);
  z[n - 1] = (alpha[n - 1] - h[n - 2] * z[n - 2]) / l[n - 1];
  c[n - 1] = z[n - 1];

  // Step 4: Back substitution
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (y[j + 1] - y[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }

  // Return interpolation function
  return (t) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];

    // Find interval using binary search (O(log n) instead of O(n))
    const i = findIntervalBinary(x, t);

    // Evaluate cubic polynomial - clamped cubic spline interpolation
    const dt = t - x[i];
    return y[i] + b[i] * dt + c[i] * dt * dt + d[i] * dt * dt * dt;
  };
}

/**
 * Catmull-Rom spline interpolation
 * @param {number[]} x - input points (typically 0, 1, 2, ..., n-1)
 * @param {number[]} y - output values at each point
 * @param {number} tension - tension parameter (0.0 to 1.0)
 * @returns {function} interpolation function that takes a value and returns interpolated result
 */
export function createCatmullRomSpline(x, y, tension = 0.5) {
  const n = x.length;
  if (n < 2) return (t) => y[0] || 0;

  return (t) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];

    // Find interval using binary search (O(log n) instead of O(n))
    const i = findIntervalBinary(x, t);

    // Get the four control points (with boundary handling)
    const p0 = y[Math.max(0, i - 1)];
    const p1 = y[i];
    const p2 = y[Math.min(n - 1, i + 1)];
    const p3 = y[Math.min(n - 1, i + 2)];

    // Normalize t to 0-1 within the segment
    const t_norm = (t - x[i]) / (x[i + 1] - x[i]);
    const t2 = t_norm * t_norm;
    const t3 = t2 * t_norm;

    // Parameterized Catmull-Rom basis functions with tension control
    // tension = 0.0: very tight (close to linear)
    // tension = 0.5: standard Catmull-Rom
    // tension = 1.0: very loose/curvy
    const q0 = -tension * t3 + 2 * tension * t2 - tension * t_norm;
    const q1 = (2 - tension) * t3 + (tension - 3) * t2 + 1;
    const q2 = (tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t_norm;
    const q3 = tension * t3 - tension * t2;

    // Catmull-Rom interpolation with adjustable tension
    return p0 * q0 + p1 * q1 + p2 * q2 + p3 * q3;
  };
}

/**
 * PCHIP (Piecewise Cubic Hermite Interpolating Polynomial) - Monotonic cubic spline
 * @param {number[]} x - input points (typically 0, 1, 2, ..., n-1)
 * @param {number[]} y - output values at each point
 * @returns {function} interpolation function that takes a value and returns interpolated result
 */
export function createPCHIPSpline(x, y) {
  const n = x.length;
  if (n < 2) return (t) => y[0] || 0;

  // Calculate slopes (derivatives) at each point
  const slopes = new Array(n);
  const h = new Array(n - 1);
  const delta = new Array(n - 1);

  // Calculate intervals and finite differences
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    delta[i] = (y[i + 1] - y[i]) / h[i];
  }

  // Calculate slopes using PCHIP method
  slopes[0] = delta[0]; // First point - use forward difference
  slopes[n - 1] = delta[n - 2]; // Last point - use backward difference

  for (let i = 1; i < n - 1; i++) {
    // Interior points - use monotonic slope calculation
    if (delta[i - 1] * delta[i] <= 0) {
      // Data changes direction - use zero slope to avoid overshooting
      slopes[i] = 0;
    } else {
      // Data is monotonic - use weighted harmonic mean for smooth monotonic interpolation
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  return (t) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];

    // Find interval using binary search (O(log n) instead of O(n))
    const i = findIntervalBinary(x, t);

    // Normalize t within the interval
    const dt = t - x[i];
    const h_i = h[i];
    const t_norm = dt / h_i;

    // Hermite basis functions
    const h00 = 2 * t_norm * t_norm * t_norm - 3 * t_norm * t_norm + 1;
    const h10 = t_norm * t_norm * t_norm - 2 * t_norm * t_norm + t_norm;
    const h01 = -2 * t_norm * t_norm * t_norm + 3 * t_norm * t_norm;
    const h11 = t_norm * t_norm * t_norm - t_norm * t_norm;

    // PCHIP interpolation formula
    return y[i] * h00 + h_i * slopes[i] * h10 + y[i + 1] * h01 + h_i * slopes[i + 1] * h11;
  };
}