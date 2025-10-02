import { registerDebugNamespace } from '../utils/debug-registry.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

// quadGEN Core Configuration
// Extracted configuration objects and constants

// LAB Tuning Configuration
export const LAB_TUNING = {
  overrides: null,
  setOverrides(overrides) {
    if (overrides && typeof overrides === 'object') {
      const sanitized = {};
      const neighbor = Number(overrides.K_NEIGHBORS);
      if (Number.isFinite(neighbor) && neighbor > 0) sanitized.K_NEIGHBORS = Math.max(1, Math.round(neighbor));
      const sigmaFloor = Number(overrides.SIGMA_FLOOR);
      if (Number.isFinite(sigmaFloor) && sigmaFloor > 0) sanitized.SIGMA_FLOOR = sigmaFloor;
      const sigmaCeil = Number(overrides.SIGMA_CEIL);
      if (Number.isFinite(sigmaCeil) && sigmaCeil > 0) sanitized.SIGMA_CEIL = sigmaCeil;
      const sigmaAlpha = Number(overrides.SIGMA_ALPHA);
      if (Number.isFinite(sigmaAlpha) && sigmaAlpha > 0) sanitized.SIGMA_ALPHA = sigmaAlpha;
      this.overrides = Object.keys(sanitized).length ? sanitized : null;
    } else {
      this.overrides = null;
    }
  },
  get(key, fallback) {
    const value = this.overrides && this.overrides[key];
    if (Number.isFinite(value)) return value;
    return fallback;
  },
  exportOverrides() {
    return this.overrides ? { ...this.overrides } : null;
  }
};

// Initialize LAB tuning with defaults
LAB_TUNING.setOverrides({ K_NEIGHBORS: 2, SIGMA_FLOOR: 0.036, SIGMA_CEIL: 0.15, SIGMA_ALPHA: 2.0 });

// Auto Limit Configuration
export const AUTO_LIMIT_DEFAULTS = Object.freeze({
  limitProximityPct: 3,
  // Tuned for easier white-toe detection on long zero plateaus
  slopeAbsolutePct: 0.45,
  sustainSamples: 3,
  minWidthPct: 8,
  blackShoulderScanStartPct: 80,
  whiteToeScanEndPct: 22,
  fallbackPlateauPct: 3
});

export const AUTO_LIMITS_ENABLED = false; // Temporarily disable auto white/black limit rolloff UI + logic

export const AUTO_LIMIT_CONFIG = {
  overrides: null,
  getDefault(key) {
    return AUTO_LIMIT_DEFAULTS[key];
  },
  getNumber(key) {
    if (this.overrides && typeof this.overrides[key] === 'number') {
      return this.overrides[key];
    }
    return this.getDefault(key);
  },
  setOverrides(overrides) {
    if (overrides && typeof overrides === 'object') {
      const sanitized = {};
      Object.keys(AUTO_LIMIT_DEFAULTS).forEach(key => {
        const value = Number(overrides[key]);
        if (Number.isFinite(value) && value >= 0) {
          sanitized[key] = value;
        }
      });

      // Legacy support mapping
      const legacyMap = {
        'limitProximity': 'limitProximityPct',
        'slopeAbsolute': 'slopeAbsolutePct',
        'minWidth': 'minWidthPct',
        'blackShoulderScanStart': 'blackShoulderScanStartPct',
        'whiteToeScanEnd': 'whiteToeScanEndPct',
        'fallbackPlateau': 'fallbackPlateauPct'
      };

      Object.entries(legacyMap).forEach(([oldKey, newKey]) => {
        if (overrides[oldKey] !== undefined && sanitized[newKey] === undefined) {
          const value = Number(overrides[oldKey]);
          if (Number.isFinite(value) && value >= 0) {
            sanitized[newKey] = value;
          }
        }
      });

      this.overrides = Object.keys(sanitized).length ? sanitized : null;
    } else {
      this.overrides = null;
    }
  },
  exportOverrides() {
    return this.overrides ? { ...this.overrides } : null;
  },
  exportAll() {
    const values = {};
    Object.keys(AUTO_LIMIT_DEFAULTS).forEach(key => {
      values[key] = this.getNumber(key);
    });
    return values;
  },
  importFromLegacy(data) {
    if (data && typeof data === 'object') {
      this.setOverrides(data);
    }
  }
};

// Intent Tuning Storage
export const INTENT_TUNING_STORAGE_KEY = 'quadgen.debugIntentTuning';

export function storeIntentTuningFlag(flag) {
  try {
    if (flag) localStorage.setItem(INTENT_TUNING_STORAGE_KEY, '1');
    else localStorage.removeItem(INTENT_TUNING_STORAGE_KEY);
  } catch (err) {}
}

export function loadIntentTuningFlag() {
  try { return localStorage.getItem(INTENT_TUNING_STORAGE_KEY) === '1'; }
  catch (err) { return false; }
}

// Initialize debug intent tuning
export const DEBUG_INTENT_TUNING = (() => {
  if (typeof globalScope.DEBUG_INTENT_TUNING === 'boolean') {
    storeIntentTuningFlag(globalScope.DEBUG_INTENT_TUNING);
    return globalScope.DEBUG_INTENT_TUNING;
  }
  return loadIntentTuningFlag();
})();

export function setIntentTuningDebug(flag) {
  const next = !!flag;
  storeIntentTuningFlag(next);
  globalScope.DEBUG_INTENT_TUNING = next;
  if (globalScope.location && typeof globalScope.location.reload === 'function') {
    try {
      globalScope.location.reload();
    } catch (err) {
      console.warn('Intent debug reload failed:', err);
    }
  }
}

globalScope.DEBUG_INTENT_TUNING = DEBUG_INTENT_TUNING;

// Helper functions needed by contrast presets
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function gammaMap(t, gamma) {
  return clamp01(Math.pow(clamp01(t), gamma));
}

function schlickGain(t, gain) {
  const p = clamp01(gain);
  if (p === 0.5) return clamp01(t);
  return clamp01(
    p > 0.5
      ? ((clamp01(t) - 1) * (2 * p - 1)) / (clamp01(t) * (2 * p - 1) - p + 1)
      : (clamp01(t) * p) / (1 - clamp01(t) + clamp01(t) * p)
  );
}

function filmicSoftShoulder(t, gain, shoulder) {
  const y = schlickGain(clamp01(t), clamp01(gain));
  const y2 = 1 - Math.pow(1 - y, 1 + clamp01(shoulder));
  return clamp01(y2);
}

// Compile a monotone intent function from anchor points [[t,d_rel]...]
function compileIntentFromPoints(points) {
  try {
    const pts = (points || []).filter(p => Array.isArray(p) && p.length >= 2).map(([t, y]) => [clamp01(+t), clamp01(+y)]);
    if (pts.length < 2) return (t) => clamp01(t);
    if (pts[0][0] !== 0) pts.unshift([0, 0]);
    if (pts[pts.length - 1][0] !== 1) pts.push([1, 1]);
    pts.sort((a, b) => a[0] - b[0]);

    // Build interpolated function
    return function(t) {
      const input = clamp01(t);
      if (input <= pts[0][0]) return pts[0][1];
      if (input >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];

      // Find bracketing points
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        if (input >= x0 && input <= x1) {
          const alpha = x1 === x0 ? 0 : (input - x0) / (x1 - x0);
          return clamp01(y0 + alpha * (y1 - y0));
        }
      }

      return clamp01(input); // Fallback
    };
  } catch (err) {
    return (t) => clamp01(t);
  }
}

registerDebugNamespace('intentDebug', {
  DEBUG_INTENT_TUNING,
  setIntentTuningDebug,
  storeIntentTuningFlag,
  loadIntentTuningFlag
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: ['setIntentTuningDebug']
});

// Centralized contrast intent preset definitions
export const CONTRAST_INTENT_PRESETS = {
  'linear': {
    id: 'linear',
    label: 'Linear',
    description: 'Neutral contrast. No curve adjustment with 1:1 input-to-output mapping for unmodified tonal reproduction.',
    params: {},
    curveFunction: (t) => clamp01(t),
    displayOrder: 1
  },
  'soft': {
    id: 'soft',
    label: 'Gamma 0.85',
    description: 'Lowers contrast. Gentle highlight compression that brightens shadows while preserving detail in bright areas. Ideal for maintaining shadow detail in high-contrast images.',
    params: { gamma: 0.85 },
    curveFunction: (t) => gammaMap(t, 0.85),
    displayOrder: 2
  },
  'hard': {
    id: 'hard',
    label: 'Gamma 1.2',
    description: 'Increases contrast. Mild shadow compression that darkens shadows while maintaining highlight detail. Useful for adding contrast to flat images.',
    params: { gamma: 1.20 },
    curveFunction: (t) => gammaMap(t, 1.20),
    displayOrder: 3
  },
  'gamma16': {
    id: 'gamma16',
    label: 'Gamma 1.6',
    description: 'Increases contrast. Moderate shadow compression providing balanced contrast enhancement between mild and strong gamma curves. Good for print workflows requiring moderate contrast.',
    params: { gamma: 1.6 },
    curveFunction: (t) => gammaMap(t, 1.6),
    displayOrder: 4
  },
  'gamma18': {
    id: 'gamma18',
    label: 'Gamma 1.8',
    description: 'Increases contrast. Strong shadow compression that darkens shadows significantly while preserving highlight detail. Useful for dramatic tonal effects.',
    params: { gamma: 1.8 },
    curveFunction: (t) => gammaMap(t, 1.8),
    displayOrder: 5
  },
  'gamma20': {
    id: 'gamma20',
    label: 'Gamma 2.0',
    description: 'Increases contrast. High contrast with pronounced shadow compression providing substantial tonal separation. Good for high-impact printing applications.',
    params: { gamma: 2.0 },
    curveFunction: (t) => gammaMap(t, 2.0),
    displayOrder: 6
  },
  'gamma22': {
    id: 'gamma22',
    label: 'Gamma 2.2',
    description: 'Increases contrast. Standard sRGB gamma correction providing traditional monitor-like contrast curve with substantial shadow compression. Common for display calibration.',
    params: { gamma: 2.2 },
    curveFunction: (t) => gammaMap(t, 2.2),
    displayOrder: 7
  },
  'filmic': {
    id: 'filmic',
    label: 'Filmic (soft shoulder)',
    description: 'Preserves contrast. Soft shoulder roll-off protects highlights from clipping while maintaining midtone contrast. Mimics film-like highlight handling for smooth tonal transitions.',
    params: { filmicGain: 0.55, shoulder: 0.35 },
    curveFunction: (t) => filmicSoftShoulder(t, 0.55, 0.35),
    displayOrder: 8
  },
  'popsgloss': {
    id: 'popsgloss',
    label: 'PoPS Gloss Curve',
    description: 'Increases contrast. Prints on Paper Studios system gloss curve with gentle shadow compression and smooth highlight preservation. Optimized for photographic paper simulation.',
    params: {
      keyPoints: [
        {x: 0, y: 0},
        {x: 10/255, y: 4/255},
        {x: 40/255, y: 30/255},
        {x: 125/255, y: 123/255},
        {x: 192/255, y: 193/255},
        {x: 223/255, y: 223/255},
        {x: 1, y: 1}
      ]
    },
    curveFunction: (t) => compileIntentFromPoints([
      [0, 0],
      [10/255, 4/255],
      [40/255, 30/255],
      [125/255, 123/255],
      [192/255, 193/255],
      [223/255, 223/255],
      [1, 1]
    ])(t),
    displayOrder: 9
  },
  'popsmatte': {
    id: 'popsmatte',
    label: 'PoPS Matte Curve',
    description: 'Increases contrast. Prints on Paper Studios system matte curve with more aggressive shadow compression than gloss variant. Designed for matte paper characteristics.',
    params: {
      keyPoints: [
        {x: 0, y: 0},
        {x: 10/255, y: 3/255},
        {x: 28/255, y: 14/255},
        {x: 55/255, y: 37/255},
        {x: 90/255, y: 79/255},
        {x: 170/255, y: 174/255},
        {x: 1, y: 1}
      ]
    },
    curveFunction: (t) => compileIntentFromPoints([
      [0, 0],
      [10/255, 3/255],
      [28/255, 14/255],
      [55/255, 37/255],
      [90/255, 79/255],
      [170/255, 174/255],
      [1, 1]
    ])(t),
    displayOrder: 10
  },
  'popsuncoated': {
    id: 'popsuncoated',
    label: 'PoPS Uncoated / Alt Process',
    description: 'Increases contrast. Prints on Paper Studios system curve optimized for uncoated papers and alternative photographic processes. Features strong shadow compression with smooth highlight transitions.',
    params: {
      keyPoints: [
        {x: 0, y: 0},
        {x: 28/255, y: 9/255},
        {x: 66/255, y: 44/255},
        {x: 112/255, y: 100/255},
        {x: 164/255, y: 168/255},
        {x: 221/255, y: 223/255},
        {x: 1, y: 1}
      ]
    },
    curveFunction: (t) => compileIntentFromPoints([
      [0, 0],
      [28/255, 9/255],
      [66/255, 44/255],
      [112/255, 100/255],
      [164/255, 168/255],
      [221/255, 223/255],
      [1, 1]
    ])(t),
    displayOrder: 11
  },
  'popsuncoatedsofter': {
    id: 'popsuncoatedsofter',
    label: 'PoPS Uncoated / Alt Process (softer)',
    description: 'Increases contrast. Prints on Paper Studios system softer variant for uncoated papers and alternative processes. Less aggressive shadow compression than the standard uncoated curve.',
    params: {
      keyPoints: [
        {x: 0, y: 0},
        {x: 28/255, y: 12/255},
        {x: 66/255, y: 47/255},
        {x: 112/255, y: 100/255},
        {x: 164/255, y: 168/255},
        {x: 221/255, y: 223/255},
        {x: 1, y: 1}
      ]
    },
    curveFunction: (t) => compileIntentFromPoints([
      [0, 0],
      [28/255, 12/255],
      [66/255, 47/255],
      [112/255, 100/255],
      [164/255, 168/255],
      [221/255, 223/255],
      [1, 1]
    ])(t),
    displayOrder: 12
  }
};
