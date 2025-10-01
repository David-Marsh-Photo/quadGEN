// quadGEN Intent System
// Handles contrast intent dropdown population and initialization

import { CONTRAST_INTENT_PRESETS } from '../core/config.js';
import { elements, getLoadedQuadData, getAppState } from '../core/state.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { getLegacyIntentBridge } from '../legacy/intent-bridge.js';

const legacyBridge = getLegacyIntentBridge();

/**
 * Get preset definition by ID
 * @param {string} presetId - Preset ID
 * @returns {Object|null} Preset definition or null
 */
export function getPreset(presetId) {
  return CONTRAST_INTENT_PRESETS[presetId] || null;
}

/**
 * Get all presets sorted by display order
 * @returns {Array} Array of preset objects
 */
export function getAllPresets() {
  return Object.values(CONTRAST_INTENT_PRESETS)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Generate HTML options for preset dropdown
 * @returns {string} HTML option elements
 */
export function generatePresetDropdownHTML() {
  const presets = getAllPresets();
  return presets.map(preset =>
    `<option value="${preset.id}">${preset.label}</option>`
  ).join('\n');
}

/**
 * Initialize preset dropdowns from central definitions
 */
export function initializePresetDropdowns() {
  try {
    // Main Intent dropdown
    const mainSelect = elements.contrastIntentSelect;
    if (mainSelect) {
      const presetHTML = generatePresetDropdownHTML();
      const existingOptions = mainSelect.innerHTML;

      // Insert preset options before existing custom options
      const beforeCustom = existingOptions.indexOf('<!-- Preset options will be populated dynamically');
      const afterComment = existingOptions.indexOf('-->') + 3;
      const customOptions = existingOptions.substring(afterComment);
      mainSelect.innerHTML = presetHTML + customOptions;
    }

    // Modal preset dropdown
    const modalSelect = elements.intentPresetSelect;
    if (modalSelect) {
      modalSelect.innerHTML = generatePresetDropdownHTML();
    }

    console.log('✅ Intent dropdown presets populated:', getAllPresets().length, 'presets');
  } catch (e) {
    console.error('Failed to initialize preset dropdowns:', e);
  }
}

/**
 * Check if any linearization is available that would benefit from intent application
 * @returns {boolean} True if linearization data is available
 */
export function hasAnyLinearization() {
  try {
    // Check modular LinearizationState
    if (LinearizationState?.hasAnyLinearization) {
      return LinearizationState.hasAnyLinearization();
    }

    const legacyFlags = legacyBridge.getLegacyLinearizationFlags();
    const { hasGlobal, hasPerEnabled } = legacyFlags;
    return hasGlobal || hasPerEnabled;

    return false;
  } catch (err) {
    console.warn('Error checking linearization state:', err);
    return false;
  }
}

/**
 * Check if intent can be applied to loaded quad data
 * @returns {boolean} True if intent can be remapped to loaded quad
 */
export function canApplyIntentRemap() {
  try {
    const delegate = legacyBridge.getRemapDelegate();
    if (delegate && delegate !== canApplyIntentRemap) {
      return delegate();
    }

    const hasQuad = legacyBridge.hasLegacyQuadLoaded() || !!(getLoadedQuadData()?.curves);
    const globalData = LinearizationState?.getGlobalData ? LinearizationState.getGlobalData() : null;
    const globalApplied = LinearizationState ? !!LinearizationState.globalApplied : false;
    const legacyFlags = legacyBridge.getLegacyLinearizationFlags();
    const hasLegacyMeasurement = legacyFlags.hasGlobal;
    const measurementActive = (!!globalData && globalApplied) || hasLegacyMeasurement;

    return hasQuad && !measurementActive;
  } catch (err) {
    console.warn('Error checking intent remap capability:', err);
    return false;
  }
}

/**
 * Update Intent dropdown enabled/disabled state based on linearization availability
 * Matches the legacy system behavior exactly
 */
export function updateIntentDropdownState() {
  if (!elements.contrastIntentSelect) return;

  const hasLinearization = hasAnyLinearization();
  const allowRemap = canApplyIntentRemap();
  const enableControls = hasLinearization || allowRemap;

  // Update dropdown state
  if (enableControls) {
    elements.contrastIntentSelect.disabled = false;
    elements.contrastIntentSelect.removeAttribute('disabled');
  } else {
    elements.contrastIntentSelect.disabled = true;
    elements.contrastIntentSelect.setAttribute('disabled', '');
  }

  // Find the Intent label
  const intentLabel = document.querySelector('label[for="contrastIntentSelect"]');

  // Update visual styling to indicate disabled state
  if (enableControls) {
    elements.contrastIntentSelect.style.opacity = '1';
    elements.contrastIntentSelect.style.cursor = 'pointer';
    if (intentLabel) intentLabel.style.opacity = '1';
  } else {
    elements.contrastIntentSelect.style.opacity = '0.5';
    elements.contrastIntentSelect.style.cursor = 'not-allowed';
    if (intentLabel) intentLabel.style.opacity = '0.5';
  }

  // Update Apply Intent button state if it exists
  const remapBtn = elements.applyIntentToQuadBtn;
  if (remapBtn) {
    // Apply Intent button is only enabled when we can remap to loaded quad
    if (allowRemap) {
      remapBtn.disabled = false;
      remapBtn.style.opacity = '1';
      remapBtn.style.cursor = 'pointer';
    } else {
      remapBtn.disabled = true;
      remapBtn.style.opacity = '0.5';
      remapBtn.style.cursor = 'not-allowed';
    }

    const legacyFlags = legacyBridge.getLegacyLinearizationFlags();
    const hasQuad = !!(getLoadedQuadData()?.curves) || legacyBridge.hasLegacyQuadLoaded();
    const globalData = LinearizationState?.getGlobalData ? LinearizationState.getGlobalData() : null;
    const globalMeasurementActive = !!globalData && !!LinearizationState?.globalApplied;
    const measurementActive = globalMeasurementActive || legacyFlags.hasGlobal;
    const activeIntent = getAppState()?.contrastIntent?.name || legacyBridge.getLegacyIntentName();
    const tooltip = allowRemap
      ? `Bake ${activeIntent} intent into the loaded curve`
      : (hasQuad
          ? 'Disable or remove global measurement data (LAB/CGATS/TI3) to enable intent remap'
          : 'Load a .quad to enable intent remap');
    remapBtn.setAttribute('title', tooltip);
  }

  console.log('🎯 Intent dropdown state updated:', {
    hasLinearization,
    allowRemap,
    enableControls,
    dropdownDisabled: elements.contrastIntentSelect.disabled
  });
}

/**
 * Initialize the intent system
 */
export function initializeIntentSystem() {
  // Expose functions globally for compatibility
  legacyBridge.registerIntentHelpers({
    CONTRAST_INTENT_PRESETS,
    generatePresetDropdownHTML,
    initializePresetDropdowns,
    getAllPresets,
    getPreset,
    hasAnyLinearization,
    canApplyIntentRemap,
    updateIntentDropdownState
  });

  // Initialize dropdowns
  initializePresetDropdowns();

  // Set initial dropdown state (should be disabled by default)
  updateIntentDropdownState();

  console.log('✅ Intent system initialized');
}
