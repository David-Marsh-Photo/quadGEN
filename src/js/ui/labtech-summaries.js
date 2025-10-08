// Lab Tech correction summaries for quadGEN
// Generates delta vs target and per-channel ink change summaries for the Lab Tech console.

import { TOTAL, elements, getCurrentPrinter } from '../core/state.js';
import { getStateManager } from '../core/state-manager.js';
import { make256 } from '../core/processing-pipeline.js';
import { isChannelNormalizedToEnd } from '../core/state.js';
import { LinearizationState, normalizeLinearizationEntry } from '../data/linearization-utils.js';
import { getTargetRelAt } from '../data/lab-parser.js';
import { createPCHIPSpline, createCubicSpline, createCatmullRomSpline, clamp01 } from '../math/interpolation.js';
import { statusMessages } from './status-messages.js';
import { isDensityNormalizationEnabled } from '../core/lab-settings.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;

const LINE_SAMPLE_COUNT = 256;
const CLAMP_THRESHOLD_PERCENT = 0.25; // detect touches within ±0.25% of limit

function createInterpolator(type, xCoords, samples) {
  if (type === 'pchip') {
    return createPCHIPSpline(xCoords, samples);
  }
  if (type === 'catmull') {
    const tension = Number(elements?.catmullTension?.value ?? 50) / 100;
    return createCatmullRomSpline(xCoords, samples, tension);
  }
  return createCubicSpline(xCoords, samples);
}

function buildGlobalDeltaSummary() {
  const globalData = LinearizationState.getGlobalData();
  const globalApplied = LinearizationState.globalApplied;

  if (!globalApplied || !globalData) return '';

  const formatToken = String(globalData.format || '').toUpperCase();
  const isMeasurement = formatToken.includes('LAB') || formatToken.includes('MANUAL');
  if (!isMeasurement) return '';

  try {
    const normalized = normalizeLinearizationEntry(globalData);
    let samples = Array.isArray(normalized.samples) ? normalized.samples.slice() : null;
    let xCoords = null;

    const smoothingSliders = elements?.tuningSmoothingPercent;
    const smoothingPercent = smoothingSliders ? Number(smoothingSliders.value) || 0 : 0;

    if (typeof globalData.getSmoothingControlPoints === 'function') {
      const control = globalData.getSmoothingControlPoints(smoothingPercent) || {};
      if (Array.isArray(control.samples) && control.samples.length >= 2) {
        samples = control.samples.slice();
        if (Array.isArray(control.xCoords) && control.xCoords.length === samples.length) {
          xCoords = control.xCoords.slice();
        }
      }
    }

    if (!Array.isArray(samples) || samples.length < 2) {
      return '';
    }

    const K = samples.length;
    if (!xCoords || xCoords.length !== K) {
      xCoords = Array.from({ length: K }, (_, i) => i / (K - 1));
    }

    const interpolationType = elements?.curveSmoothingMethod?.value || 'cubic';
    const interp = createInterpolator(interpolationType, xCoords, samples);

    let minDelta = Infinity;
    let maxDelta = -Infinity;
    let minIdx = 0;
    let maxIdx = 0;
    let zeroAt = null;

    let prevDiff = null;

    for (let i = 0; i < LINE_SAMPLE_COUNT; i++) {
      const t = i / (LINE_SAMPLE_COUNT - 1);
      const rel = clamp01(interp(t));
      const target = clamp01(getTargetRelAt(t));
      const diff = (rel - target) * 100;

      if (diff < minDelta) {
        minDelta = diff;
        minIdx = i;
      }
      if (diff > maxDelta) {
        maxDelta = diff;
        maxIdx = i;
      }

      if (prevDiff !== null) {
        if ((prevDiff < 0 && diff > 0) || (prevDiff > 0 && diff < 0) || diff === 0) {
          if (diff === 0) {
            zeroAt = t;
          } else {
            const denom = diff - prevDiff;
            const alpha = Math.abs(denom) > 1e-12 ? -prevDiff / denom : 0;
            zeroAt = ((i - 1) + clamp01(alpha)) / (LINE_SAMPLE_COUNT - 1);
          }
          prevDiff = diff;
          break;
        }
      }

      prevDiff = diff;
    }

    const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    const changeKind = (v) => (v > 0 ? 'add ink' : v < 0 ? 'reduce ink' : 'no change');

    const maxLabel = `${fmtPct(maxDelta)} (${changeKind(maxDelta)}) @ ${(maxIdx / (LINE_SAMPLE_COUNT - 1) * 100).toFixed(1)}% input`;
    const minLabel = `${fmtPct(minDelta)} (${changeKind(minDelta)}) @ ${(minIdx / (LINE_SAMPLE_COUNT - 1) * 100).toFixed(1)}% input`;
    const zeroLabel = zeroAt != null ? `, zero ≈ ${(zeroAt * 100).toFixed(1)}% input` : '';
    const intentName = elements?.contrastIntentSelect?.selectedOptions?.[0]?.textContent?.trim()
      || globalScope?.contrastIntent?.name
      || 'Linear';

    return `Δ vs target (${intentName}): ${maxLabel}, ${minLabel}${zeroLabel}`;
  } catch (err) {
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
      console.warn('[LabTechSummary] Failed to build global delta summary:', err);
    }
    return '';
  }
}

function buildChannelChangeSummary(clampMessages) {
  const printer = getCurrentPrinter();
  const channels = printer?.channels || [];
  if (!channels.length) return '';

  const manager = getStateManager?.();
  const parts = [];

  channels.forEach((channelName) => {
    try {
      let endValue = 0;
      if (manager && typeof manager.get === 'function') {
        const stored = manager.get(`printer.channelValues.${channelName}.endValue`);
        if (typeof stored === 'number') endValue = stored;
      }
      if (!endValue && elements?.rows) {
        const row = elements.rows.querySelector(`tr[data-channel="${channelName}"]`);
        if (row) {
          const endInput = row.querySelector('.end-input');
          if (endInput) {
            endValue = parseInt(endInput.value, 10) || 0;
          }
        }
      }

      if (!endValue) return;

      const normalizeToEnd = isChannelNormalizedToEnd(channelName);
      const before = make256(endValue, channelName, false, { normalizeToEnd });
      const after = make256(endValue, channelName, true, { normalizeToEnd });

      if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return;

      let minChange = Infinity;
      let maxChange = -Infinity;

      for (let i = 0; i < after.length; i++) {
        const diff = ((after[i] - before[i]) / TOTAL) * 100;
        if (diff < minChange) minChange = diff;
        if (diff > maxChange) maxChange = diff;
      }

      const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
      parts.push(`${channelName}:${fmt(maxChange)}/${fmt(minChange)}`);

      const limitPercent = (endValue / TOTAL) * 100;
      const maxAbs = Math.max(Math.abs(maxChange), Math.abs(minChange));
      const nearLimit = Math.abs(limitPercent - Math.abs(maxAbs)) <= CLAMP_THRESHOLD_PERCENT;
      if (nearLimit) {
        clampMessages.push(
          `${channelName} hit its ${limitPercent.toFixed(1)}% limit; diff ≈ ${fmt(maxChange)} (raise End before recalibrating)`
        );
      }
    } catch (err) {
      if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.warn('[LabTechSummary] Failed to compute channel change for', channelName, err);
      }
    }
  });

  if (!parts.length) return '';
  return `Channel changes (max/min vs original): ${parts.join('; ')}`;
}

export function postLinearizationSummary() {
  const lines = [];
  const densityModeActive = typeof isDensityNormalizationEnabled === 'function' && isDensityNormalizationEnabled();
  if (densityModeActive) {
    lines.push('Normalization: log-density mode active — exported .quad comments include this note.');
  }
  const globalLine = buildGlobalDeltaSummary();
  if (globalLine) lines.push(globalLine);
  const clampMessages = [];
  const channelLine = buildChannelChangeSummary(clampMessages);
  if (channelLine) lines.push(channelLine);
  clampMessages.forEach((msg) => lines.push(`⚠️ ${msg}`));

  if (!lines.length) return;

  lines.forEach((line) => {
    statusMessages.addChatMessage('system', line);
  });
}

// Legacy compatibility helper used by AI actions
if (typeof globalScope !== 'undefined') {
  globalScope.postGlobalDeltaChatSummary = () => {
    try {
      postLinearizationSummary();
    } catch (err) {
      if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.warn('[LabTechSummary] Legacy summary invocation failed:', err);
      }
    }
  };
}
