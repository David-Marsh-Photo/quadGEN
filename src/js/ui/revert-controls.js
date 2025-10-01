// Revert button enable/disable logic

import { elements, getCurrentPrinter, ensureLoadedQuadData, getLoadedQuadData } from '../core/state.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { registerRevertButtonsHandler, triggerInkChartUpdate } from './ui-hooks.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers } from '../legacy/legacy-helpers.js';
import { ControlPoints } from '../curves/smart-curves.js';
import { persistSmartPoints, reinitializeChannelSmartCurves } from './edit-mode.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

function isMeasurementData(entry) {
  if (!entry) return false;
  const format = String(entry.format || '').toUpperCase();
  if (!format.includes('LAB') && !format.includes('MANUAL')) return false;
  return Array.isArray(entry.originalData) && entry.originalData.length > 0;
}

function pointsMatch(seedPoints, currentPoints, tolerance = 1e-4) {
  if (!Array.isArray(seedPoints) || !Array.isArray(currentPoints)) return false;
  if (seedPoints.length !== currentPoints.length) return false;
  for (let i = 0; i < seedPoints.length; i += 1) {
    const seed = seedPoints[i];
    const cur = currentPoints[i];
    if (!cur) return false;
    if (Math.abs(seed.input - cur.input) > tolerance) return false;
    if (Math.abs(seed.output - cur.output) > tolerance) return false;
  }
  return true;
}

function resolveChannelState(channelName, channelMeta) {
  const meta = channelMeta || {};
  const seedPoints = Array.isArray(meta.measurementSeed?.points) ? meta.measurementSeed.points : null;
  const currentPoints = ControlPoints.get(channelName)?.points || null;
  const hasSeed = Array.isArray(seedPoints) && seedPoints.length >= 2;
  const seedMatches = hasSeed && Array.isArray(currentPoints)
    ? pointsMatch(seedPoints, currentPoints)
    : false;
  const hasSmartTouchedFlag = Object.prototype.hasOwnProperty.call(meta, 'smartTouched');
  const smartTouched = !!meta.smartTouched;

  let touched = false;
  if (hasSmartTouchedFlag) {
    touched = smartTouched;
  } else if (hasSeed) {
    touched = !seedMatches;
  } else {
    touched = smartTouched;
  }

  return {
    smartTouched,
    hasSmartTouchedFlag,
    hasSeed,
    seedMatches,
    touched,
    pointCount: Array.isArray(currentPoints) ? currentPoints.length : null
  };
}

function cleanupChannelMeta(channelName) {
  const data = ensureLoadedQuadData(() => ({ keyPointsMeta: {} }));
  data.keyPointsMeta = data.keyPointsMeta || {};
  const meta = data.keyPointsMeta[channelName];
  if (!meta) return;

  if (meta.smartTouched) {
    meta.smartTouched = false;
  }
  if (meta.bakedGlobal) {
    delete meta.bakedGlobal;
  }
}

export function resetChannelSmartPointsToMeasurement(channelName, options = {}) {
  const {
    skipUiRefresh = true,
    forceReinitialize = true
  } = options;

  const data = ensureLoadedQuadData(() => ({ keyPointsMeta: {} }));
  data.keyPointsMeta = data.keyPointsMeta || {};
  const meta = data.keyPointsMeta[channelName] || {};
  const measurementSeed = meta.measurementSeed;
  const interpolation = meta.interpolationType || 'smooth';

  let restoredFromSeed = false;

  if (measurementSeed && Array.isArray(measurementSeed.points) && measurementSeed.points.length >= 2) {
    try {
      persistSmartPoints(channelName, measurementSeed.points, interpolation, {
        measurementSeed,
        smartTouched: false,
        skipUiRefresh
      });
      if (skipUiRefresh) {
        try {
          triggerInkChartUpdate();
        } catch (refreshError) {
          console.warn(`[revert-controls] Chart refresh failed after seeding ${channelName}:`, refreshError);
        }
      }
      restoredFromSeed = true;
    } catch (error) {
      console.warn(`[revert-controls] Failed to persist measurement seed for ${channelName}:`, error);
    }
  }

  if (!restoredFromSeed && forceReinitialize) {
    try {
      reinitializeChannelSmartCurves(channelName, { forceIfEditModeEnabling: true });
    } catch (error) {
      console.warn(`[revert-controls] Failed to reinitialize Smart points for ${channelName}:`, error);
    }
  }

  cleanupChannelMeta(channelName);

  try {
    const perEntry = LinearizationState?.getPerChannelData?.(channelName);
    if (perEntry && typeof LinearizationState.setPerChannelData === 'function') {
      LinearizationState.setPerChannelData(channelName, perEntry, true);
    }
  } catch (error) {
    console.warn(`[revert-controls] Failed to re-enable measurement state for ${channelName}:`, error);
  }

  return {
    channel: channelName,
    restoredFromSeed
  };
}

export function resetSmartPointsForChannels(channelNames, options = {}) {
  if (!Array.isArray(channelNames)) return { seeded: [], reinitialized: [] };
  const seeded = [];
  const reinitialized = [];

  channelNames.forEach((channelName) => {
    const result = resetChannelSmartPointsToMeasurement(channelName, options);
    if (result?.restoredFromSeed) {
      seeded.push(channelName);
    } else {
      reinitialized.push(channelName);
    }
  });

  return { seeded, reinitialized };
}

export function computeGlobalRevertState() {
  const loadedData = getLoadedQuadData();
  const globalData = LinearizationState.getGlobalData();
  const globalApplied = !!LinearizationState.globalApplied;
  const isMeasurement = globalApplied && isMeasurementData(globalData);
  const wasEdited = !!globalData?.edited;
  const channels = getCurrentPrinter()?.channels || [];
  const metaMap = loadedData?.keyPointsMeta || {};

  const channelStates = {};
  let hasSmartEdits = false;

  if (isMeasurement) {
    channels.forEach((ch) => {
      const state = resolveChannelState(ch, metaMap?.[ch]);
      channelStates[ch] = state;
      if (state.touched) {
        hasSmartEdits = true;
      }
    });
  }

  return {
    isMeasurement,
    wasEdited,
    hasSmartEdits,
    channelStates,
    globalData
  };
}

export function updateRevertButtonsState() {
  let channelStates = null;
  try {
    const globalState = computeGlobalRevertState();
    const { isMeasurement, wasEdited, hasSmartEdits, channelStates: stateMap } = globalState;
    channelStates = stateMap;
    const globalBtn = document.getElementById('revertGlobalToMeasurementBtn');
    if (globalBtn) {
      const shouldEnable = isMeasurement && (hasSmartEdits || wasEdited);
      if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[REVERT CONTROLS] Global button state', JSON.stringify({
          isMeasurement,
          wasEdited,
          hasSmartEdits,
          shouldEnable,
          smartTouchedMap: channelStates
        }));
      }
      if (shouldEnable) {
        globalBtn.disabled = false;
        globalBtn.removeAttribute('disabled');
      } else {
        globalBtn.disabled = true;
        globalBtn.setAttribute('disabled', 'disabled');
      }
    }
  } catch (error) {
    console.warn('[revert-controls] global revert toggle error:', error);
  }

  try {
    const rows = Array.from(elements.rows?.children || []);
    rows.forEach((row) => {
      const channel = row?.getAttribute?.('data-channel');
      if (!channel) return;
      const button = row.querySelector('.per-channel-revert');
      if (!button) return;

      const perEntry = LinearizationState.getPerChannelData(channel);
      const hasMeasurement = !!(perEntry && isMeasurementData(perEntry));
      const meta = getLoadedQuadData()?.keyPointsMeta?.[channel];
      const channelState = channelStates?.[channel];
      const touched = channelState ? channelState.touched : !!meta?.smartTouched;
      const hasEdits = touched;
      const enabled = hasMeasurement && hasEdits;
      button.disabled = !enabled;
      if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && channel === 'MK') {
        console.log('[DEBUG BUTTON]', { channel, hasMeasurement, hasEdits, enabled, touched, metaSmart: meta?.smartTouched });
      }
      if (enabled) {
        button.classList.remove('invisible');
        button.title = hasMeasurement
          ? `Revert ${channel} to measurement source`
          : `Clear Smart (restore loaded .quad)`;
      } else {
        button.classList.add('invisible');
      }
    });
  } catch (error) {
    console.warn('[revert-controls] per-channel revert toggle error:', error);
  }
}

registerRevertButtonsHandler(updateRevertButtonsState);

registerLegacyHelpers({ updateRevertButtonsState, computeGlobalRevertState });

registerDebugNamespace('revertControls', {
  updateRevertButtonsState,
  computeGlobalRevertState,
  resetChannelSmartPointsToMeasurement,
  resetSmartPointsForChannels
}, {
  exposeOnWindow: typeof window !== 'undefined',
  windowAliases: [
    'updateRevertButtonsState',
    'computeGlobalRevertState',
    'resetChannelSmartPointsToMeasurement',
    'resetSmartPointsForChannels'
  ]
});
