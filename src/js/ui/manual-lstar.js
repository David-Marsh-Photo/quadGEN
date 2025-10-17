// Manual L* entry parity module
// Ports legacy quadgen.html behavior into the modular build

import { elements, appState, updateAppState, getLoadedQuadData } from '../core/state.js';
import { LinearizationState, normalizeLinearizationEntry, getBasePointCountLabel } from '../data/linearization-utils.js';
import { DataSpace } from '../data/processing-utils.js';
import { updatePreview } from './quad-preview.js';
import { postLinearizationSummary } from './labtech-summaries.js';
import { updateFilename, downloadFile } from '../files/file-operations.js';
import { triggerRevertButtonsUpdate } from './ui-hooks.js';
import { showStatus } from './status-service.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { invokeLegacyHelper } from '../legacy/legacy-helpers.js';
import { getLegacyLinearizationBridge } from '../legacy/linearization-bridge.js';
import { getLabNormalizationMode, setLabNormalizationMode, isDensityNormalizationEnabled, LAB_NORMALIZATION_MODES } from '../core/lab-settings.js';
import { parseManualLstarData as coreParseManualLstarData } from '../parsers/file-parsers.js';
import { maybeAutoRaiseInkLimits } from '../core/auto-raise-on-import.js';

const MIN_ROWS = 5;
const MAX_ROWS = 50;
const TARGET_LSTAR_FLOOR = 20;
const LSTAR_LAYOUT_STORAGE_KEY = 'quadgen.manualLstarLayout';

let lstarInputCount = MIN_ROWS;
let lastLstarValues = [];
let storedPatchPercents = [];

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

function clampPatchPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function loadStoredLayout() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  let raw = null;
  try {
    raw = window.localStorage.getItem(LSTAR_LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const rawPercents = Array.isArray(parsed.patchPercents) ? parsed.patchPercents : [];
    const sanitizedPercents = rawPercents
      .map(clampPatchPercent)
      .filter((value) => value !== null);

    if (!sanitizedPercents.length) return null;

    let patchCount = Number(parsed.patchCount);
    if (!Number.isFinite(patchCount) || patchCount <= 0) {
      patchCount = sanitizedPercents.length;
    }
    patchCount = Math.round(patchCount);
    patchCount = Math.max(MIN_ROWS, Math.min(MAX_ROWS, patchCount));
    patchCount = Math.min(patchCount, sanitizedPercents.length);
    if (patchCount < MIN_ROWS) return null;

    const candidate = sanitizedPercents.slice(0, patchCount);
    if (!isStrictlyIncreasing(candidate)) return null;

    return { patchCount, patchPercents: candidate };
  } catch {
    return null;
  }
}

function persistLayout(patchCount, patchPercents) {
  const countNumber = Number(patchCount);
  if (!Number.isFinite(countNumber) || countNumber < MIN_ROWS) {
    return;
  }
  const count = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(countNumber)));
  const sanitizedPercents = Array.isArray(patchPercents)
    ? patchPercents.map(clampPatchPercent).filter((value) => value !== null)
    : [];

  if (sanitizedPercents.length < count) {
    return;
  }
  const candidate = sanitizedPercents.slice(0, count);
  if (!isStrictlyIncreasing(candidate)) {
    return;
  }

  storedPatchPercents = candidate;

  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LSTAR_LAYOUT_STORAGE_KEY, JSON.stringify({
      patchCount: count,
      patchPercents: candidate
    }));
  } catch {
    // ignore storage failures
  }
}

function restoreLayoutFromStorage() {
  const layout = loadStoredLayout();
  if (!layout) {
    storedPatchPercents = [];
    return null;
  }
  lstarInputCount = layout.patchCount;
  storedPatchPercents = layout.patchPercents.slice();
  syncCountInputs();
  toggleRemoveButtons();
  return layout;
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
  restoreLayoutFromStorage();
  updateRows();
  if (elements.manualLstarDensityToggle) {
    const isDensity = isDensityNormalizationEnabled();
    elements.manualLstarDensityToggle.checked = isDensity;
    elements.manualLstarDensityToggle.setAttribute('aria-checked', String(isDensity));
  }
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
  if (!Array.isArray(storedPatchPercents)) {
    storedPatchPercents = [];
  }
  storedPatchPercents = storedPatchPercents.slice(0, lstarInputCount);
  const patchSource = Array.isArray(options.savedPatchPercents)
    ? options.savedPatchPercents
    : storedPatchPercents;
  const patchPercents = patchSource.slice(0, lstarInputCount);

  for (let i = 0; i < lstarInputCount; i++) {
    const value = savedValues[i] || '';
    const patchValue = Number.isFinite(patchPercents[i]) ? patchPercents[i] : undefined;
    container.insertAdjacentHTML('beforeend', createRowMarkup(i, value, patchValue));
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
  storedPatchPercents = storedPatchPercents.slice(0, lstarInputCount);
  updateRows();
}

function removeRow() {
  if (lstarInputCount <= MIN_ROWS) return;
  lstarInputCount -= 1;
  lastLstarValues = lastLstarValues.slice(0, lstarInputCount);
  storedPatchPercents = storedPatchPercents.slice(0, lstarInputCount);
  updateRows();
}

function handleCountInput(event) {
  const nextValue = parseInt(event.target.value, 10);
  if (Number.isFinite(nextValue) && nextValue >= MIN_ROWS && nextValue <= MAX_ROWS) {
    lstarInputCount = nextValue;
    storedPatchPercents = storedPatchPercents.slice(0, lstarInputCount);
    updateRows();
  }
}

function applyManualLinearization(validation) {
  const normalizationMode = getLabNormalizationMode();
  const correctionData = parseManualLstarData(validation, { normalizationMode });
  correctionData.filename = `Manual-L-${validation.values.length}pts`;
  const normalized = normalizeLinearizationEntry(correctionData, DataSpace.SPACE.PRINTER);

  try {
    const baselineData = getLoadedQuadData?.();
    const cloneMap = (map) => {
      if (!map || typeof map !== 'object') {
        return null;
      }
      const clone = {};
      let hasAny = false;
      Object.entries(map).forEach(([channelName, curve]) => {
        if (Array.isArray(curve)) {
          clone[channelName] = curve.slice();
          hasAny = true;
        }
      });
      return hasAny ? clone : null;
    };
    const baselineSnapshot = cloneMap(baselineData?.plotBaseCurvesBaseline)
      || cloneMap(baselineData?._plotSmoothingOriginalCurves)
      || cloneMap(baselineData?.curves);

    if (baselineSnapshot) {
      LinearizationState.setGlobalBaselineCurves(baselineSnapshot);
    }
  } catch (snapshotErr) {
    console.warn('[Manual L*] Failed to capture baseline snapshot:', snapshotErr);
  }

  LinearizationState.setGlobalData(normalized, true);
  if (typeof window !== 'undefined' && typeof window.__quadSetGlobalBakedState === 'function') {
    window.__quadSetGlobalBakedState(null, { skipHistory: true });
  }
  updateAppState({ linearizationData: normalized, linearizationApplied: true });
  legacyLinearizationBridge.setGlobalState(normalized, true);

  appState.linearizationData = normalized;
  appState.linearizationApplied = true;

  maybeAutoRaiseInkLimits(normalized, {
    scope: 'global',
    label: 'manual L* correction',
    source: 'manual-lstar'
  });

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

  try {
    postLinearizationSummary();
  } catch (summaryErr) {
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
      console.warn('[LabTechSummary] Failed to post summary after manual L* apply:', summaryErr);
    }
  }

  const patchPercents = Array.isArray(validation.measuredPairs)
    ? validation.measuredPairs.map((pair) => clampPatchPercent(pair.x)).filter((value) => value !== null)
    : [];
  persistLayout(validation.values.length, patchPercents);

  hideModal();

  const modeLabel = normalizationMode === LAB_NORMALIZATION_MODES.DENSITY
    ? 'CIE density (log)'
    : 'CIE L* (perceptual)';
  showStatus(`Applied manual L* correction curve (${getBasePointCountLabel(correctionData)}) (${modeLabel}; Gaussian-weighted reconstruction with PCHIP interpolation)`);
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

  const patchPercents = measuredPairs.map((pair) => clampPatchPercent(pair.x)).filter((value) => value !== null);
  persistLayout(validation.values.length, patchPercents);
}

export function parseManualLstarData(validation) {
  return coreParseManualLstarData(validation, { normalizationMode: getLabNormalizationMode() });
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
  if (elements.manualLstarDensityToggle) {
    elements.manualLstarDensityToggle.addEventListener('change', (event) => {
      const mode = event.target.checked ? LAB_NORMALIZATION_MODES.DENSITY : LAB_NORMALIZATION_MODES.LSTAR;
      setLabNormalizationMode(mode);
    });
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
    toggleRemoveButtons,
    restoreLayoutFromStorage,
    loadStoredLayout,
    persistLayout
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
