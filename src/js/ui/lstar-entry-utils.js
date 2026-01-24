// Shared L* entry utilities
// Used by both manual-lstar.js and channel-builder-modal.js

/**
 * Convert L* value (0-100) to hex color string
 * @param {number} value - L* value
 * @returns {string} Hex color (#rrggbb)
 */
export function lstarToHex(value) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const L = clamp(Number(value), 0, 100);
  let Y;
  if (L > 8) {
    const f = (L + 16) / 116;
    Y = f * f * f;
  } else {
    Y = L / 903.3;
  }
  let s = Y <= 0.0031308 ? 12.92 * Y : 1.055 * Math.pow(Y, 1 / 2.4) - 0.055;
  s = clamp(s, 0, 1);
  const channel = Math.round(s * 255).toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

/**
 * Format default patch percent for a given index
 * @param {number} index - Row index (0-based)
 * @param {number} total - Total number of rows
 * @returns {string} Formatted percentage string
 */
export function formatPatchPercent(index, total) {
  if (total <= 1) return '0.0';
  const pct = (index / (total - 1)) * 100;
  return pct.toFixed(1);
}

/**
 * Clamp and validate patch percent value
 * @param {*} value - Input value
 * @returns {number|null} Clamped value or null if invalid
 */
export function clampPatchPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

/**
 * Check if values array is strictly increasing
 * @param {number[]} values - Array of numbers
 * @returns {boolean} True if strictly increasing
 */
export function isStrictlyIncreasing(values) {
  for (let i = 1; i < values.length; i++) {
    if (!(values[i] > values[i - 1])) return false;
  }
  return true;
}

/**
 * Create HTML markup for an L* entry row
 * @param {number} index - Row index (0-based)
 * @param {Object} options - Configuration options
 * @param {string} [options.value=''] - Pre-filled L* value
 * @param {number} [options.patchValue] - Pre-filled patch percent
 * @param {number} [options.total=11] - Total number of rows
 * @param {number} [options.targetLstarFloor=20] - Minimum target L*
 * @param {boolean} [options.compact=false] - Use compact styling
 * @param {string} [options.xInputClass='lstar-measured-x'] - Class for X input
 * @param {string} [options.lInputClass='lstar-input'] - Class for L* input
 * @returns {string} HTML string
 */
export function createLstarRowMarkup(index, options = {}) {
  const {
    value = '',
    patchValue,
    total = 11,
    targetLstarFloor = 20,
    compact = false,
    xInputClass = 'lstar-measured-x',
    lInputClass = 'lstar-input'
  } = options;

  const safeTotal = Math.max(2, total);
  const defaultX = patchValue !== undefined && patchValue !== null
    ? patchValue
    : Number(formatPatchPercent(index, safeTotal));
  const hasValue = value !== '' && !Number.isNaN(parseFloat(value));
  const measuredColor = hasValue ? lstarToHex(value) : '#ffffff';
  const targetBase = Math.max(targetLstarFloor, 100 - defaultX);
  const targetColor = lstarToHex(targetBase);

  const swatchStyle = hasValue
    ? `background-color: ${measuredColor};`
    : 'background-image: repeating-linear-gradient(45deg, #f3f4f6 0, #f3f4f6 2px, #ffffff 2px, #ffffff 4px); background-color: #ffffff; border-style: dashed;';
  const swatchInner = hasValue ? '' : '<span class="text-[10px] text-gray-500">-</span>';

  const padding = compact ? 'px-1 py-0.5' : 'px-2 py-1';
  const inputWidth = compact ? 'w-16' : 'w-20';
  const lInputWidth = compact ? 'w-16' : 'w-24';

  return `
    <tr>
      <td class="${padding} w-8 text-xs text-gray-500">${index + 1}.</td>
      <td class="${padding}">
        <input type="number" class="${xInputClass} ${inputWidth} px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500" value="${defaultX.toFixed(1)}" min="0" max="100" step="0.1" title="Patch % (0-100)">
      </td>
      <td class="${padding} text-center">
        <span class="inline-flex items-center justify-center gap-[2px]">
          <span class="lstar-target-swatch inline-flex items-center justify-center w-5 h-5 rounded border border-gray-300" style="background-color: ${targetColor};" title="Linear target preview (based on Patch %, min L* = ${targetLstarFloor})"></span>
          <span class="lstar-swatch inline-flex items-center justify-center w-5 h-5 rounded border border-gray-300" style="${swatchStyle}" title="Measured L* preview">${swatchInner}</span>
        </span>
      </td>
      <td class="${padding}">
        <input type="number" class="${lInputClass} ${lInputWidth} px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500" placeholder="L*" min="0" max="100" step="0.1" value="${value}">
      </td>
    </tr>
  `;
}

/**
 * Update a measured swatch element based on L* value
 * @param {HTMLElement} row - Row element containing the swatch
 * @param {number|null} value - L* value or null to show empty state
 */
export function updateMeasuredSwatch(row, value) {
  const swatch = row ? row.querySelector('.lstar-swatch') : null;
  if (!swatch) return;

  if (value === null) {
    swatch.style.backgroundColor = '#ffffff';
    swatch.style.backgroundImage = 'repeating-linear-gradient(45deg, #f3f4f6 0, #f3f4f6 2px, #ffffff 2px, #ffffff 4px)';
    swatch.style.borderStyle = 'dashed';
    swatch.innerHTML = '<span class="text-[10px] text-gray-500">-</span>';
    return;
  }

  swatch.style.backgroundImage = 'none';
  swatch.style.borderStyle = 'solid';
  swatch.style.backgroundColor = lstarToHex(value);
  swatch.innerHTML = '';
}

/**
 * Update a target swatch element based on patch percent
 * @param {HTMLElement} row - Row element containing the swatch
 * @param {number} patchPercent - Patch percent (0-100)
 * @param {number} [targetLstarFloor=20] - Minimum target L*
 */
export function updateTargetSwatch(row, patchPercent, targetLstarFloor = 20) {
  const swatch = row ? row.querySelector('.lstar-target-swatch') : null;
  if (!swatch) return;

  const target = Math.max(targetLstarFloor, 100 - patchPercent);
  swatch.style.backgroundColor = lstarToHex(target);
}

/**
 * Validate L* entry rows
 * @param {HTMLElement} container - Container element with rows
 * @param {Object} options - Validation options
 * @param {number} [options.minRows=5] - Minimum required rows
 * @param {number} [options.targetLstarFloor=20] - Minimum target L*
 * @param {string} [options.xInputClass='lstar-measured-x'] - Class for X input
 * @param {string} [options.lInputClass='lstar-input'] - Class for L* input
 * @returns {Object} { valid: boolean, values: Array, measuredX: Array, measuredPairs: Array, errors: string[] }
 */
export function validateLstarRows(container, options = {}) {
  const {
    minRows = 5,
    targetLstarFloor = 20,
    xInputClass = 'lstar-measured-x',
    lInputClass = 'lstar-input'
  } = options;

  const result = {
    valid: true,
    values: [],
    measuredX: [],
    measuredPairs: [],
    errors: []
  };

  if (!container) {
    result.valid = false;
    result.errors.push('Container not found');
    return result;
  }

  const rows = Array.from(container.querySelectorAll('tr'));

  // Handle empty container
  if (rows.length === 0) {
    result.valid = false;
    result.errors.push('No measurement rows found');
    return result;
  }

  const xValues = [];

  rows.forEach((row, index) => {
    const xInput = row.querySelector(`.${xInputClass}`);
    const lInput = row.querySelector(`.${lInputClass}`);

    const rawX = xInput ? parseFloat(xInput.value) : NaN;
    if (xInput) {
      if (Number.isFinite(rawX) && rawX >= 0 && rawX <= 100) {
        xValues[index] = rawX;
        xInput.style.borderColor = '#d1d5db';
        updateTargetSwatch(row, rawX, targetLstarFloor);
      } else {
        result.valid = false;
        if (!result.errors.includes('All Patch % must be set (0-100)')) {
          result.errors.push('All Patch % must be set (0-100)');
        }
        xInput.style.borderColor = '#ef4444';
      }
    }

    if (!lInput) return;

    const trimmed = lInput.value.trim();
    if (!trimmed) {
      result.valid = false;
      if (!result.errors.includes('All L* values must be set (0-100)')) {
        result.errors.push('All L* values must be set (0-100)');
      }
      lInput.style.borderColor = '#d1d5db';
      updateMeasuredSwatch(row, null);
      return;
    }

    const lValue = parseFloat(trimmed);
    if (!Number.isFinite(lValue) || lValue < 0 || lValue > 100) {
      result.valid = false;
      if (!result.errors.includes('L* values must be between 0 and 100')) {
        result.errors.push('L* values must be between 0 and 100');
      }
      lInput.style.borderColor = '#d1d5db';
      updateMeasuredSwatch(row, null);
      return;
    }

    result.values.push({ index, value: lValue });
    result.measuredX[index] = xValues[index];
    lInput.style.borderColor = '#d1d5db';
    updateMeasuredSwatch(row, lValue);
  });

  // Check minimum rows
  if (result.values.length < minRows) {
    result.valid = false;
    if (!result.errors.some(e => e.includes('values must be set'))) {
      result.errors.push(`Need at least ${minRows} measurement points`);
    }
  }

  // Check if all rows have values
  if (result.values.length !== rows.length) {
    result.valid = false;
    if (!result.errors.includes('All L* values must be set (0-100)')) {
      result.errors.push('All L* values must be set (0-100)');
    }
  }

  // Check X values completeness and monotonicity
  const xComplete = result.measuredX.filter(v => Number.isFinite(v));
  if (xComplete.length !== rows.length) {
    result.valid = false;
    if (!result.errors.includes('All Patch % must be set (0-100)')) {
      result.errors.push('All Patch % must be set (0-100)');
    }
  } else if (!isStrictlyIncreasing(xComplete)) {
    result.valid = false;
    if (!result.errors.includes('Patch % must be strictly increasing (0->100)')) {
      result.errors.push('Patch % must be strictly increasing (0->100)');
    }
  }

  // Build measured pairs if valid
  if (result.valid) {
    rows.forEach((row, idx) => {
      const l = result.values.find(v => v.index === idx)?.value;
      const xVal = result.measuredX[idx];
      if (Number.isFinite(l) && Number.isFinite(xVal)) {
        result.measuredPairs.push({ x: xVal, l });
      }
    });
  }

  return result;
}

/**
 * Convert measured pairs to Channel Builder format
 * @param {Array<{x: number, l: number}>} pairs - Measured pairs
 * @returns {Array<{input: number, lstar: number}>} Channel builder format
 */
export function measuredPairsToChannelBuilderFormat(pairs) {
  return pairs.map(p => ({ input: p.x, lstar: p.l }));
}

/**
 * Get current L* values from rows
 * @param {HTMLElement} container - Container element with rows
 * @param {string} [lInputClass='lstar-input'] - Class for L* input
 * @returns {string[]} Array of L* values as strings
 */
export function getLstarValuesFromRows(container, lInputClass = 'lstar-input') {
  if (!container) return [];
  const inputs = Array.from(container.querySelectorAll(`.${lInputClass}`));
  return inputs.map(input => input.value);
}

/**
 * Get current patch percent values from rows
 * @param {HTMLElement} container - Container element with rows
 * @param {string} [xInputClass='lstar-measured-x'] - Class for X input
 * @returns {number[]} Array of patch percent values
 */
export function getPatchPercentsFromRows(container, xInputClass = 'lstar-measured-x') {
  if (!container) return [];
  const inputs = Array.from(container.querySelectorAll(`.${xInputClass}`));
  return inputs.map(input => {
    const val = parseFloat(input.value);
    return Number.isFinite(val) ? val : 0;
  });
}
