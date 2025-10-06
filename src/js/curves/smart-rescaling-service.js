const INPUT_MIN = 0;
const INPUT_MAX = 100;
const OUTPUT_MIN = 0;
const OUTPUT_MAX = 100;
const DUPLICATE_TOLERANCE = 0.01;
const SCALE_EPSILON = 1e-6;
const SHIFT_WARNING_THRESHOLD = 5;
const AUTO_FLAG_SHIFT_THRESHOLD = 1;
const FLOAT_TOLERANCE = 1e-4;

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function isUsablePoint(point) {
  return point && Number.isFinite(point.input) && Number.isFinite(point.output);
}

function clonePoint(point) {
  return { input: Number(point.input), output: Number(point.output) };
}

function enforceStrictlyIncreasingInputs(points) {
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].input <= points[i - 1].input) {
      const bumped = Math.min(INPUT_MAX, points[i - 1].input + DUPLICATE_TOLERANCE);
      points[i] = { ...points[i], input: bumped };
    }
  }
  return points;
}

function enforceMonotonicOutputs(points) {
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].output < points[i - 1].output) {
      points[i] = { ...points[i], output: points[i - 1].output };
    }
  }
  return points;
}

export function normalizeKeyPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const sanitized = points
    .filter(isUsablePoint)
    .map((point) => ({
      input: clamp(point.input, INPUT_MIN, INPUT_MAX),
      output: clamp(point.output, OUTPUT_MIN, OUTPUT_MAX)
    }))
    .sort((a, b) => {
      if (a.input === b.input) {
        return a.output - b.output;
      }
      return a.input - b.input;
    });

  if (sanitized.length === 0) {
    return [];
  }

  const deduped = [];
  for (const point of sanitized) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(point.input - last.input) <= DUPLICATE_TOLERANCE) {
      const mergedOutput = Math.max(last.output, point.output);
      deduped[deduped.length - 1] = {
        input: Number(last.input.toFixed(6)),
        output: clamp(mergedOutput, OUTPUT_MIN, OUTPUT_MAX)
      };
      continue;
    }
    deduped.push(point);
  }

  if (deduped.length === 0) {
    return [];
  }

  enforceStrictlyIncreasingInputs(deduped);
  enforceMonotonicOutputs(deduped);

  return deduped.map((point) => ({
    input: Number(point.input.toFixed(6)),
    output: Number(point.output.toFixed(6))
  }));
}

export function reconcileBakedMetadata(meta, scaleFactor) {
  const base = meta && typeof meta === 'object' ? { ...meta } : {};
  const numericFactor = Number(scaleFactor);

  if (!Number.isFinite(numericFactor) || numericFactor <= 0) {
    return base;
  }

  if (Math.abs(numericFactor - 1) <= SCALE_EPSILON) {
    return base;
  }

  if ('bakedGlobal' in base) {
    base.bakedGlobal = Boolean(base.bakedGlobal);
  }

  const endpointShiftPercent = Math.abs(numericFactor - 1) * 100;
  if (endpointShiftPercent - AUTO_FLAG_SHIFT_THRESHOLD > FLOAT_TOLERANCE) {
    if ('bakedAutoWhite' in base) {
      delete base.bakedAutoWhite;
    }
    if ('bakedAutoBlack' in base) {
      delete base.bakedAutoBlack;
    }
    if ('bakedAutoLimit' in base) {
      base.bakedAutoLimit = false;
    }
  }

  return base;
}

export function rescaleKeyPointsForInkLimit(channelName, fromPercent, toPercent, options = {}) {
  const result = {
    success: false,
    channelName,
    points: [],
    metadata: {},
    warnings: [],
    scaleFactor: null
  };

  const { points, metadata = {}, mode = 'preserveAbsolute' } = options;

  if (!channelName || typeof channelName !== 'string') {
    return { ...result, error: 'channelName required' };
  }

  if (!Array.isArray(points) || points.length < 2) {
    return { ...result, error: 'At least two key points are required' };
  }

  const from = Number(fromPercent);
  const to = Number(toPercent);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to < 0) {
    return { ...result, error: 'Invalid percent values supplied to rescale' };
  }

  if (from === 0) {
    return { ...result, error: 'Cannot rescale when previous percent is zero' };
  }

  const baseNormalized = normalizeKeyPoints(points);
  if (baseNormalized.length < 2) {
    return { ...result, error: 'Normalized key points must contain at least two entries' };
  }

  const scaleFactor = to === 0 ? 0 : to / from;
  result.scaleFactor = scaleFactor;

  const warnings = [];
  let workingPoints;

  if (mode === 'preserveRelative') {
    workingPoints = baseNormalized.map(clonePoint);
  } else {
    const scaled = baseNormalized.map(({ input, output }) => {
      if (scaleFactor === 0) {
        return { input, output: 0 };
      }
      return {
        input,
        output: output * scaleFactor
      };
    });

    const normalizedScaled = normalizeKeyPoints(scaled);

    if (normalizedScaled.length < 2) {
      return { ...result, error: 'Rescaled key points collapsed below minimum count' };
    }

    let maxShift = 0;
    for (let i = 0; i < Math.min(baseNormalized.length, normalizedScaled.length); i += 1) {
      const shift = Math.abs(normalizedScaled[i].output - baseNormalized[i].output);
      if (shift > maxShift) {
        maxShift = shift;
      }
    }

    if (scaleFactor === 0) {
      warnings.push(`Channel ${channelName} scaled to zero percent ink limit.`);
    } else if (maxShift > SHIFT_WARNING_THRESHOLD) {
      warnings.push(`Channel ${channelName} points shifted by ${maxShift.toFixed(2)}%.`);
    }

    workingPoints = normalizedScaled;
  }

  const reconciledMeta = reconcileBakedMetadata(metadata, scaleFactor);

  return {
    success: true,
    channelName,
    points: workingPoints,
    metadata: reconciledMeta,
    warnings,
    scaleFactor
  };
}

export const __TEST_ONLY__ = {
  DUPLICATE_TOLERANCE,
  SCALE_EPSILON,
  SHIFT_WARNING_THRESHOLD,
  AUTO_FLAG_SHIFT_THRESHOLD,
  FLOAT_TOLERANCE
};
