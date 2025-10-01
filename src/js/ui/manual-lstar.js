// Manual L* entry parity module
// Ports legacy quadgen.html behavior into the modular build

import { elements, appState, updateAppState } from '../core/state.js';
import { LAB_TUNING } from '../core/config.js';
import { LinearizationState, normalizeLinearizationEntry, getBasePointCountLabel } from '../data/linearization-utils.js';
import { DataSpace } from '../data/processing-utils.js';
import { updatePreview } from './quad-preview.js';
import { updateFilename, downloadFile } from '../files/file-operations.js';
import { createPCHIPSpline } from '../math/interpolation.js';
import { triggerRevertButtonsUpdate } from './ui-hooks.js';
import { showStatus } from './status-service.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { invokeLegacyHelper } from '../legacy/legacy-helpers.js';
import { getLegacyLinearizationBridge } from '../legacy/linearization-bridge.js';

const MIN_ROWS = 5;
const MAX_ROWS = 50;
const TARGET_LSTAR_FLOOR = 20;

let lstarInputCount = MIN_ROWS;
let lastLstarValues = [];

const legacyLinearizationBridge = getLegacyLinearizationBridge();

function lstarToHex(value) {
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

function formatPatchPercent(index, total) {
  if (total <= 1) return '0.0';
  const pct = (index / (total - 1)) * 100;
  return pct.toFixed(1);
}

function createRowMarkup(index, value = '', patchValue) {
  const total = Math.max(2, lstarInputCount);
  const defaultX = patchValue !== undefined && patchValue !== null
    ? patchValue
    : Number(formatPatchPercent(index, total));
  const hasValue = value !== '' && !Number.isNaN(parseFloat(value));
  const measuredColor = hasValue ? lstarToHex(value) : '#ffffff';
  const targetBase = Math.max(TARGET_LSTAR_FLOOR, 100 - defaultX);
  const targetColor = lstarToHex(targetBase);
  const swatchStyle = hasValue
    ? `background-color: ${measuredColor};`
    : 'background-image: repeating-linear-gradient(45deg, #f3f4f6 0, #f3f4f6 2px, #ffffff 2px, #ffffff 4px); background-color: #ffffff; border-style: dashed;';
  const swatchInner = hasValue ? '' : '<span class="text-[10px] text-gray-500">—</span>';

  return `
    <tr>
      <td class="px-2 py-1 w-8 text-xs text-gray-500">${index + 1}.</td>
      <td class="px-2 py-1 w-24">
        <input type="number" class="lstar-measured-x w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500" value="${defaultX.toFixed(1)}" min="0" max="100" step="0.1" title="Patch % (0–100)">
      </td>
      <td class="px-2 py-1 w-24 text-center">
        <span class="inline-flex items-center justify-center gap-[2px]">
          <span class="lstar-target-swatch inline-flex items-center justify-center w-6 h-6 rounded border border-gray-300" style="background-color: ${targetColor};" title="Linear target preview (based on Patch %, min L* = 20)"></span>
          <span class="lstar-swatch inline-flex items-center justify-center w-6 h-6 rounded border border-gray-300" style="${swatchStyle}" title="Measured L* preview">${swatchInner}</span>
        </span>
      </td>
      <td class="px-2 py-1 w-24">
        <input type="number" class="lstar-input w-24 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500" placeholder="L*" min="0" max="100" step="0.1" value="${value}">
      </td>
    </tr>
  `;
}

function setModalScrollLock(enabled) {
  try {
    const method = enabled ? 'add' : 'remove';
    document.documentElement.classList[method]('overflow-hidden');
    document.body.classList[method]('overflow-hidden');
  } catch (err) {
    // ignore
  }
}

function showModal() {
  if (!elements.lstarModal) return;
  updateRows();
  elements.lstarModal.classList.remove('hidden');
  setModalScrollLock(true);
}

function hideModal() {
  if (!elements.lstarModal) return;
  elements.lstarModal.classList.add('hidden');
  setModalScrollLock(false);
}

function syncCountInputs() {
  if (elements.lstarCountInput) {
    elements.lstarCountInput.value = lstarInputCount;
  }
  const header = document.getElementById('lstarCountInputHeader');
  if (header) header.value = lstarInputCount;
}

function toggleRemoveButtons() {
  if (elements.removeLstarInput) {
    elements.removeLstarInput.disabled = lstarInputCount <= MIN_ROWS;
  }
  const headerRemove = document.getElementById('removeLstarInputHeader');
  if (headerRemove) headerRemove.disabled = lstarInputCount <= MIN_ROWS;
}

function updateRows(options = {}) {
  if (!elements.lstarInputs) return;

  const container = elements.lstarInputs;
  container.innerHTML = '';

  const savedValues = options.savedValues || lastLstarValues;
  for (let i = 0; i < lstarInputCount; i++) {
    const value = savedValues[i] || '';
    container.insertAdjacentHTML('beforeend', createRowMarkup(i, value));
  }

  syncCountInputs();
  toggleRemoveButtons();
  validateInputs();
}

function isStrictlyIncreasing(values) {
  for (let i = 1; i < values.length; i++) {
    if (!(values[i] > values[i - 1])) return false;
  }
  return true;
}

function updateMeasuredSwatch(row, value) {
  const swatch = row ? row.querySelector('.lstar-swatch') : null;
  if (!swatch) return;

  if (value === null) {
    swatch.style.backgroundColor = '#ffffff';
    swatch.style.backgroundImage = 'repeating-linear-gradient(45deg, #f3f4f6 0, #f3f4f6 2px, #ffffff 2px, #ffffff 4px)';
    swatch.style.borderStyle = 'dashed';
    swatch.innerHTML = '<span class="text-[10px] text-gray-500">—</span>';
    return;
  }

  swatch.style.backgroundImage = 'none';
  swatch.style.borderStyle = 'solid';
  swatch.style.backgroundColor = lstarToHex(value);
  swatch.innerHTML = '';
}

function validateInputs() {
  const result = {
    valid: true,
    values: [],
    measuredX: [],
    measuredPairs: []
  };

  if (!elements.lstarInputs) return result;

  const rows = Array.from(elements.lstarInputs.querySelectorAll('tr'));
  const xValues = [];
  let hasErrors = false;
  let message = '';

  rows.forEach((row, index) => {
    const xInput = row.querySelector('.lstar-measured-x');
    const lInput = row.querySelector('.lstar-input');

    const rawX = xInput ? parseFloat(xInput.value) : NaN;
    if (xInput) {
      if (Number.isFinite(rawX) && rawX >= 0 && rawX <= 100) {
        xValues[index] = rawX;
        xInput.style.borderColor = '#d1d5db';
        const target = Math.max(TARGET_LSTAR_FLOOR, 100 - rawX);
        const targetSwatch = row.querySelector('.lstar-target-swatch');
        if (targetSwatch) targetSwatch.style.backgroundColor = lstarToHex(target);
      } else {
        hasErrors = true;
        if (!message) message = 'All Patch % must be set (0–100)';
        xInput.style.borderColor = '#ef4444';
      }
    }

    if (!lInput) return;

    const trimmed = lInput.value.trim();
    if (!trimmed) {
      hasErrors = true;
      if (!message) message = 'All L* values must be set (0–100)';
      lInput.style.borderColor = '#d1d5db';
      updateMeasuredSwatch(row, null);
      return;
    }

    const lValue = parseFloat(trimmed);
    if (!Number.isFinite(lValue) || lValue < 0 || lValue > 100) {
      hasErrors = true;
      if (!message) message = 'L* values must be between 0 and 100';
      lInput.style.borderColor = '#d1d5db';
      updateMeasuredSwatch(row, null);
      return;
    }

    result.values.push({ index, value: lValue });
    result.measuredX[index] = xValues[index];
    lInput.style.borderColor = '#d1d5db';
    updateMeasuredSwatch(row, lValue);
  });

  if (result.values.length < MIN_ROWS) {
    hasErrors = true;
    if (!message) message = '';
  }

  if (result.values.length !== rows.length) {
    hasErrors = true;
    if (!message) message = 'All L* values must be set (0–100)';
  }

  const xComplete = result.measuredX.filter(v => Number.isFinite(v));
  if (xComplete.length !== rows.length) {
    hasErrors = true;
    if (!message) message = 'All Patch % must be set (0–100)';
  } else if (!isStrictlyIncreasing(xComplete)) {
    hasErrors = true;
    if (!message) message = 'Patch % must be strictly increasing (0→100)';
  }

  if (hasErrors) {
    if (elements.lstarValidation) {
      if (message) {
        elements.lstarValidation.textContent = message;
        if (message === 'All L* values must be set (0–100)') {
          elements.lstarValidation.classList.add('text-center');
        } else {
          elements.lstarValidation.classList.remove('text-center');
        }
        elements.lstarValidation.classList.remove('hidden');
      } else {
        elements.lstarValidation.classList.add('hidden');
        elements.lstarValidation.classList.remove('text-center');
      }
    }
    if (elements.generateFromLstar) elements.generateFromLstar.disabled = true;
  } else {
    if (elements.lstarValidation) {
      elements.lstarValidation.classList.add('hidden');
      elements.lstarValidation.classList.remove('text-center');
    }
    if (elements.generateFromLstar) elements.generateFromLstar.disabled = false;

    rows.forEach((row, idx) => {
      const l = result.values.find(v => v.index === idx)?.value;
      const xVal = result.measuredX[idx];
      if (Number.isFinite(l) && Number.isFinite(xVal)) {
        result.measuredPairs.push({ x: xVal, l });
      }
    });
  }

  result.valid = !hasErrors;
  return result;
}

function addRow() {
  if (lstarInputCount >= MAX_ROWS) return;
  lstarInputCount += 1;
  updateRows();
}

function removeRow() {
  if (lstarInputCount <= MIN_ROWS) return;
  lstarInputCount -= 1;
  lastLstarValues = lastLstarValues.slice(0, lstarInputCount);
  updateRows();
}

function handleCountInput(event) {
  const nextValue = parseInt(event.target.value, 10);
  if (Number.isFinite(nextValue) && nextValue >= MIN_ROWS && nextValue <= MAX_ROWS) {
    lstarInputCount = nextValue;
    updateRows();
  }
}

function applyManualLinearization(validation) {
  const correctionData = parseManualLstarData(validation);
  correctionData.filename = `Manual-L-${validation.values.length}pts`;
  const normalized = normalizeLinearizationEntry(correctionData, DataSpace.SPACE.PRINTER);

  LinearizationState.setGlobalData(normalized, true);
  updateAppState({ linearizationData: normalized, linearizationApplied: true });
  legacyLinearizationBridge.setGlobalState(normalized, true);

  appState.linearizationData = normalized;
  appState.linearizationApplied = true;

  if (elements.globalLinearizationBtn) {
    elements.globalLinearizationBtn.setAttribute('data-tooltip', `Loaded: Manual L* (${getBasePointCountLabel(correctionData)})`);
  }
  if (elements.globalLinearizationToggle) {
    elements.globalLinearizationToggle.disabled = false;
    elements.globalLinearizationToggle.checked = true;
    elements.globalLinearizationToggle.setAttribute('aria-checked', 'true');
  }
  if (elements.globalLinearizationInfo) {
    elements.globalLinearizationInfo.classList.remove('hidden');
  }
  if (elements.globalLinearizationFilename) {
    elements.globalLinearizationFilename.textContent = 'Manual L* Entry';
  }
  if (elements.globalLinearizationDetails) {
    elements.globalLinearizationDetails.textContent = ` (${getBasePointCountLabel(correctionData)})`;
  }
  if (elements.globalLinearizationHint) {
    elements.globalLinearizationHint.classList.add('hidden');
  }

  try { triggerRevertButtonsUpdate(); } catch (err) { /* ignore */ }

  invokeLegacyHelper('updateInterpolationControls');

  updatePreview();
  updateFilename();

  hideModal();

  showStatus(`Applied manual L* correction curve (${getBasePointCountLabel(correctionData)}) (CIE density; Gaussian-weighted reconstruction with PCHIP interpolation)`);
  invokeLegacyHelper('postGlobalDeltaChatSummary');

  const inputs = elements.lstarInputs ? Array.from(elements.lstarInputs.querySelectorAll('.lstar-input')) : [];
  lastLstarValues = inputs.map(input => input.value);
  lstarInputCount = validation.values.length;
}

function handleGenerateClick() {
  const validation = validateInputs();
  if (!validation.valid) return;
  try {
    applyManualLinearization(validation);
  } catch (error) {
    console.error('Error processing L* values:', error);
    showStatus(`Error processing L* values: ${error.message}`);
  }
}

function handleSaveClick() {
  const validation = validateInputs();
  if (!validation.valid) {
    if (elements.lstarValidation) {
      elements.lstarValidation.textContent = 'Please fix errors and complete all fields before saving .txt';
      elements.lstarValidation.classList.remove('hidden');
      elements.lstarValidation.classList.remove('text-center');
    }
    return;
  }

  const measuredPairs = validation.measuredPairs || [];
  const header = 'GRAY\tLAB_L\tLAB_A\tLAB_B\n';
  const lines = measuredPairs.map(pair => {
    const gray = Number(pair.x).toFixed(2);
    const lab = Number(pair.l).toFixed(2);
    return `${gray}\t${lab}\t0.00\t0.00`;
  });
  const content = header + lines.join('\n') + '\n';
  downloadFile(content, 'LAB-Data.txt', 'text/plain');
}

export function parseManualLstarData(validation) {
  const measuredPairs = Array.isArray(validation?.measuredPairs) ? validation.measuredPairs : [];
  if (measuredPairs.length < MIN_ROWS) {
    throw new Error('At least five L* measurements are required.');
  }

  const measuredXs = measuredPairs.map(pair => pair.x);
  const measuredL = measuredPairs.map(pair => pair.l);
  const maxLstar = measuredL.length ? Math.max(...measuredL) : 100;
  const minLstar = measuredL.length ? Math.min(...measuredL) : 0;
  const lstarSpan = Math.max(1e-6, maxLstar - minLstar);
  const measuredInk = measuredL.map(L => Math.max(0, Math.min(1, (maxLstar - L) / lstarSpan)));
  const maxInputValue = measuredXs.length ? Math.max(...measuredXs) : 0;
  const divisor = maxInputValue > 100 ? 255 : 100;
  const positions = measuredXs.map(value => Math.max(0, Math.min(divisor, value)) / divisor);
  const positionsOnly = positions.slice();
  const neighbors = LAB_TUNING.get('K_NEIGHBORS', 6);
  const sigmaFloor = LAB_TUNING.get('SIGMA_FLOOR', 0.02);
  const sigmaCeil = LAB_TUNING.get('SIGMA_CEIL', 0.15);
  const sigmaAlpha = LAB_TUNING.get('SIGMA_ALPHA', 3.0);

  function localSigmaAt(t) {
    const n = positionsOnly.length;
    if (n <= 1) return sigmaCeil;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (positionsOnly[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const distances = [];
    let left = lo - 1;
    let right = lo;
    while ((left >= 0 || right < n) && distances.length < neighbors) {
      const dl = left >= 0 ? Math.abs(t - positionsOnly[left]) : Infinity;
      const dr = right < n ? Math.abs(t - positionsOnly[right]) : Infinity;
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

  function interpolateMeasuredAt(t) {
    if (!positionsOnly.length) return 0;
    if (t <= positionsOnly[0]) return measuredInk[0];
    const last = positionsOnly.length - 1;
    if (t >= positionsOnly[last]) return measuredInk[last];
    for (let i = 0; i < last; i++) {
      const leftPos = positionsOnly[i];
      const rightPos = positionsOnly[i + 1];
      if (t >= leftPos && t <= rightPos) {
        const span = rightPos - leftPos || 1;
        const alpha = (t - leftPos) / span;
        const leftVal = measuredInk[i];
        const rightVal = measuredInk[i + 1];
        return leftVal + alpha * (rightVal - leftVal);
      }
    }
    return measuredInk[last];
  }

  function smoothMeasuredInkPoints(widenFactor = 1) {
    const smoothedPoints = measuredInk.map((value, idx) => {
      const pos = positionsOnly[idx];
      const sigma = Math.min(sigmaCeil, Math.max(sigmaFloor, localSigmaAt(pos) * widenFactor));
      const denom = Math.max(1e-9, 2 * sigma * sigma);
      let numerator = 0;
      let weightSum = 0;
      for (let j = 0; j < positionsOnly.length; j++) {
        const distance = Math.abs(pos - positionsOnly[j]);
        const weight = Math.exp(-(distance * distance) / denom);
        numerator += measuredInk[j] * weight;
        weightSum += weight;
      }
      const averaged = weightSum > 0 ? numerator / weightSum : measuredInk[idx];
      return Math.max(0, Math.min(1, averaged));
    });

    const epsilon = 1 / 4096;
    if (smoothedPoints.length) {
      smoothedPoints[0] = Math.max(0, Math.min(1, measuredInk[0]));
      smoothedPoints[smoothedPoints.length - 1] = Math.max(0, Math.min(1, measuredInk[measuredInk.length - 1]));
    }
    for (let i = 1; i < smoothedPoints.length; i++) {
      if (smoothedPoints[i] <= smoothedPoints[i - 1]) {
        smoothedPoints[i] = Math.min(1, smoothedPoints[i - 1] + epsilon);
      }
    }
    if (smoothedPoints.length >= 2) {
      const last = smoothedPoints.length - 1;
      smoothedPoints[last] = Math.max(smoothedPoints[last], smoothedPoints[last - 1]);
    }
    return smoothedPoints;
  }

  function buildInkInterpolator(widenFactor = 1) {
    const smoothedPoints = smoothMeasuredInkPoints(widenFactor);
    const xsPercent = positionsOnly.map(p => p * 100);
    const spline = createPCHIPSpline(xsPercent, smoothedPoints);
    return function evaluate(t) {
      const clampedT = Math.max(0, Math.min(1, t));
      const ink = spline(clampedT * 100);
      return Math.max(0, Math.min(1, ink));
    };
  }

  function buildInverseLUTFromInterpolator(evaluate) {
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) {
      const targetInk = i / 255;
      let lo = 0;
      let hi = 1;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        const value = evaluate(mid);
        if (value < targetInk) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      lut[i] = Math.max(0, Math.min(1, hi));
    }
    lut[0] = 0;
    lut[255] = 1;
    for (let i = 1; i < 256; i++) {
      if (lut[i] < lut[i - 1]) lut[i] = lut[i - 1];
    }
    return lut;
  }

  const evaluateInk = buildInkInterpolator(1);
  const samples = buildInverseLUTFromInterpolator(evaluateInk);

  function createSmoothedControlPoints(percent) {
    const clampPercent = Math.max(0, Math.min(90, Number(percent) || 0));
    const widen = 1 + clampPercent / 100;
    const evaluate = buildInkInterpolator(widen);
    const inverse = buildInverseLUTFromInterpolator(evaluate);
    const controlPointCount = Math.max(3, 21 - Math.floor(clampPercent / 10));
    const samplesOut = [];
    const xCoords = [];
    for (let i = 0; i < controlPointCount; i++) {
      const x = i / (controlPointCount - 1);
      const idx = Math.round(x * 255);
      xCoords.push(x);
      samplesOut.push(inverse[idx]);
    }
    return {
      samples: samplesOut,
      xCoords,
      controlPointCount,
      needsDualTransformation: false,
      influenceRadius: null
    };
  }

  return {
    domainMin: 0,
    domainMax: 1,
    samples,
    originalData: measuredPairs.map(pair => ({ input: pair.x, lab: pair.l })),
    format: 'Manual L* Entry',
    sourceSpace: DataSpace.SPACE.PRINTER,
    getSmoothingControlPoints: createSmoothedControlPoints
  };
}

function attachSharedHandlers() {
  if (elements.manualLstarBtn) {
    elements.manualLstarBtn.addEventListener('click', showModal);
  }
  if (elements.closeLstarModal) {
    elements.closeLstarModal.addEventListener('click', hideModal);
  }
  if (elements.cancelLstar) {
    elements.cancelLstar.addEventListener('click', hideModal);
  }
  if (elements.lstarModal) {
    elements.lstarModal.addEventListener('click', (event) => {
      if (event.target === elements.lstarModal) hideModal();
    });
  }
  if (elements.addLstarInput) {
    elements.addLstarInput.addEventListener('click', addRow);
  }
  if (elements.removeLstarInput) {
    elements.removeLstarInput.addEventListener('click', removeRow);
  }
  if (elements.lstarCountInput) {
    elements.lstarCountInput.addEventListener('input', handleCountInput);
  }
  const headerAdd = document.getElementById('addLstarInputHeader');
  if (headerAdd) headerAdd.addEventListener('click', addRow);
  const headerRemove = document.getElementById('removeLstarInputHeader');
  if (headerRemove) headerRemove.addEventListener('click', removeRow);
  const headerCount = document.getElementById('lstarCountInputHeader');
  if (headerCount) headerCount.addEventListener('input', handleCountInput);

  if (elements.lstarInputs) {
    elements.lstarInputs.addEventListener('input', () => validateInputs());
  }
  if (elements.generateFromLstar) {
    elements.generateFromLstar.addEventListener('click', handleGenerateClick);
  }
  if (elements.saveLstarTxt) {
    elements.saveLstarTxt.addEventListener('click', handleSaveClick);
  }
}

export function initializeManualLstar() {
  attachSharedHandlers();
  if (elements.generateFromLstar) {
    elements.generateFromLstar.disabled = true;
  }
  syncCountInputs();
  toggleRemoveButtons();
}

const manualLstarModule = {
  initializeManualLstar,
  parseManualLstarData,
  _internal: {
    validateInputs,
    updateRows,
    syncCountInputs,
    toggleRemoveButtons
  }
};

registerDebugNamespace('manualLstar', {
  initializeManualLstar,
  parseManualLstarData,
  showModal,
  hideModal,
  manualLstarModule,
  openManualLstarModal: showModal
}, {
  exposeOnWindow: true,
  windowAliases: ['parseManualLstarData', 'openManualLstarModal', 'manualLstarModule']
});
