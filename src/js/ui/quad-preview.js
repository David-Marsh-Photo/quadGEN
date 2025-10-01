// quadGEN Quad File Preview Module
// Handles generating and displaying .quad file previews with parity to legacy quadgen.html

import { elements, getCurrentPrinter, getAppState, INK_COLORS, updateAppState } from '../core/state.js';
import { APP_DISPLAY_VERSION } from '../core/version.js';
import { InputValidator } from '../core/validation.js';
import { LinearizationState, getEditedDisplayName, getBasePointCountLabel } from '../data/linearization-utils.js';
import { CONTRAST_INTENT_PRESETS } from '../core/config.js';
import { make256 } from '../core/processing-pipeline.js';
import { registerPreviewHandler, triggerRevertButtonsUpdate, triggerInkChartUpdate, triggerSessionStatusUpdate } from './ui-hooks.js';
import { updateFilename } from '../files/file-operations.js';
import { getChannelRows, getChannelRowMap } from './channel-registry.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

const MIN_PREVIEW_HEIGHT = 160;
const MAX_PREVIEW_HEIGHT = 640;
const NBSP = '\u00a0';

/**
 * Build a complete .quad file content from current application state
 * Mirrors legacy quadgen.html buildFile implementation
 * @returns {string} The .quad file content
 */
export function buildFile() {
  try {
    const printer = getCurrentPrinter();
    const lines = [
      `## QuadToneRIP ${printer.channels.join(',')}`,
      `# Printer: ${printer.name}`,
      `# quadGEN ${APP_DISPLAY_VERSION} by David Marsh`
    ];

    appendUserNotes(lines);
    appendLinearizationSummary(lines);
    lines.push('#');
    lines.push(...buildLimitsSummary());

    appendChannelCurves(lines, printer.channels);

    return `${lines.join('\n')}\n`;
  } catch (error) {
    console.error('Error building .quad file:', error);
    return buildDefaultQuadFile();
  }
}

function appendUserNotes(lines) {
  const notesValue = elements.userNotes?.value?.trim();
  if (!notesValue) return;

  lines.push('#');
  lines.push('# Notes:');
  notesValue.split('\n').forEach((line) => {
    const trimmed = line.trim();
    lines.push(trimmed ? `# ${trimmed}` : '#');
  });
}

function appendLinearizationSummary(lines) {
  const { data: globalData, applied: globalApplied } = getGlobalLinearization();
  const perChannelMap = getPerChannelLinearizationMap();
  const perChannelEntries = buildPerChannelSummary(perChannelMap);
  const hasGlobal = !!(globalData && globalApplied);
  const hasPerChannel = perChannelEntries.length > 0;

  if (!hasGlobal && !hasPerChannel) {
    return;
  }

  lines.push('#');
  lines.push('# Linearization Applied:');

  if (hasGlobal) {
    const filename = getEditedDisplayName(globalData.filename || 'unknown file', !!globalData.edited);
    const countLabel = getBasePointCountLabel(globalData);
    lines.push(`# - Global: ${filename} (${countLabel}, affects all channels)`);

    const intent = getContrastIntent();
    const { intentLine, tagLine } = describeContrastIntent(intent);
    if (intentLine) {
      lines.push(intentLine);
    }
    if (tagLine) {
      lines.push(tagLine);
    }
  }

  if (hasPerChannel) {
    lines.push('# - Per-channel:');
    perChannelEntries.forEach((entry) => {
      lines.push(`#   ${entry}`);
    });
  }
}

function buildPerChannelSummary(perChannelMap) {
  const entries = [];
  Object.keys(perChannelMap).forEach((channel) => {
    const data = perChannelMap[channel];
    if (!isPerChannelLinearizationEnabled(channel)) {
      return;
    }
    const baseName = getPerChannelFilename(channel, data);
    const displayName = getEditedDisplayName(baseName, !!data?.edited);
    const countLabel = getBasePointCountLabel(data);
    const measuredSuffix = data?.measurementIntent ? ` (measured: ${data.measurementIntent})` : '';
    entries.push(`${channel}: ${displayName} (${countLabel})${measuredSuffix}`);
  });
  return entries;
}

function buildLimitsSummary() {
  const summary = ['# Limits summary:'];
  const rows = getChannelRows();

  rows.forEach((row) => {
    const label = row.querySelector('td span span:nth-child(2)')?.textContent?.trim() || row.getAttribute('data-channel') || 'Channel';
    const endInput = row.querySelector('.end-input');
    const endValue = InputValidator.clampEnd(endInput ? endInput.value : 0);
    const percent = InputValidator.computePercentFromEnd(endValue);

    if (endValue === 0) {
      summary.push(`#   ${label}: disabled`);
    } else {
      const isWhole = Math.abs(percent - Math.round(percent)) < 1e-9;
      const formatted = isWhole ? String(Math.round(percent)) : percent.toFixed(2);
      summary.push(`#   ${label}: = ${formatted}%`);
    }
  });

  return summary;
}

function appendChannelCurves(lines, channelOrder) {
  const rowMap = getChannelRowMap();

  channelOrder.forEach((channelName) => {
    const row = rowMap.get(channelName);
    const endInput = row?.querySelector('.end-input');
    const endValue = InputValidator.clampEnd(endInput ? endInput.value : 0);
    const curveValues = make256(endValue, channelName, true);

    lines.push(`# ${channelName} curve`);
    lines.push(...curveValues.map(String));
  });
}

function getGlobalLinearization() {
  try {
    if (LinearizationState && typeof LinearizationState.getGlobalData === 'function') {
      const data = LinearizationState.getGlobalData();
      if (data) {
        return { data, applied: !!LinearizationState.globalApplied };
      }
    }
  } catch (error) {
    console.warn('Unable to read LinearizationState global data:', error);
  }

  try {
    const state = getAppState();
    if (state.linearizationData) {
      return { data: state.linearizationData, applied: !!state.linearizationApplied };
    }
  } catch (error) {
    console.warn('Unable to read appState global linearization:', error);
  }

  if (isBrowser) {
    return {
      data: globalScope.linearizationData || null,
      applied: !!globalScope.linearizationApplied
    };
  }

  return { data: null, applied: false };
}

function getPerChannelLinearizationMap() {
  const merged = {};

  try {
    const stateMap = LinearizationState?.perChannelData;
    if (stateMap) {
      Object.keys(stateMap).forEach((channel) => {
        if (!merged[channel]) {
          merged[channel] = stateMap[channel];
        }
      });
    }
  } catch (error) {
    console.warn('Unable to read LinearizationState per-channel data:', error);
  }

  try {
    const state = getAppState();
    const perChannel = state.perChannelLinearization || {};
    Object.keys(perChannel).forEach((channel) => {
      if (!merged[channel]) {
        merged[channel] = perChannel[channel];
      }
    });
  } catch (error) {
    console.warn('Unable to read appState per-channel linearization:', error);
  }

  if (isBrowser && globalScope.perChannelLinearization) {
    Object.keys(globalScope.perChannelLinearization).forEach((channel) => {
      if (!merged[channel]) {
        merged[channel] = globalScope.perChannelLinearization[channel];
      }
    });
  }

  return merged;
}

function isPerChannelLinearizationEnabled(channelName) {
  try {
    if (LinearizationState && typeof LinearizationState.isPerChannelEnabled === 'function') {
      const result = LinearizationState.isPerChannelEnabled(channelName);
      if (typeof result === 'boolean') {
        return result;
      }
    }
  } catch (error) {
    console.warn('Unable to read per-channel enable state from LinearizationState:', error);
  }

  try {
    const state = getAppState();
    if (state.perChannelEnabled && channelName in state.perChannelEnabled) {
      return !!state.perChannelEnabled[channelName];
    }
  } catch (error) {
    console.warn('Unable to read appState per-channel enabled map:', error);
  }

  if (isBrowser && globalScope.perChannelEnabled) {
    return !!globalScope.perChannelEnabled[channelName];
  }

  return false;
}

function getPerChannelFilename(channelName, data) {
  if (isBrowser && globalScope.perChannelFilenames && globalScope.perChannelFilenames[channelName]) {
    return globalScope.perChannelFilenames[channelName];
  }
  if (data?.filename) {
    return data.filename;
  }
  return 'unknown file';
}

function getContrastIntent() {
  if (isBrowser && globalScope.contrastIntent) {
    return globalScope.contrastIntent;
  }
  try {
    const state = getAppState();
    if (state.contrastIntent) {
      return state.contrastIntent;
    }
  } catch (error) {
    console.warn('Unable to read contrast intent from appState:', error);
  }
  return null;
}

function describeContrastIntent(intent) {
  const id = String(intent?.id || 'linear');
  const params = intent?.params || {};
  const name = intent?.name;
  let label;

  if (id === 'linear') {
    label = 'Linear';
  } else if (id === 'soft' || id === 'hard' || id === 'custom_gamma') {
    const gamma = Number(params.gamma ?? getPresetDefaults(id, 'gamma') ?? 1.0);
    const gammaText = Number.isFinite(gamma) ? gamma.toFixed(2) : '1.00';
    label = `Gamma ${gammaText}`;
  } else if (id === 'filmic' || id === 'custom_filmic') {
    const gain = Number(params.filmicGain ?? params.gain ?? 0.55);
    const shoulder = Number(params.shoulder ?? 0.35);
    const gainText = Number.isFinite(gain) ? gain.toFixed(2) : '0.55';
    const shoulderText = Number.isFinite(shoulder) ? shoulder.toFixed(2) : '0.35';
    label = `Filmic (gain ${gainText}, shoulder ${shoulderText})`;
  } else if (id === 'pops_standard') {
    label = 'POPS\u2011Compat (Standard)';
  } else if (id === 'custom_points') {
    label = 'Custom';
  } else if (name) {
    label = name;
  } else {
    label = id;
  }

  const intentLine = `#   Intent: ${label}`;
  const tagLine = `#   Intent tag: ${computeIntentFilenameTag(id, params)}`;
  return { intentLine, tagLine };
}

function computeIntentFilenameTag(id, params) {
  if (id === 'linear') return 'LIN';
  if (id === 'soft' || id === 'hard' || id === 'custom_gamma') {
    const gamma = Number(params.gamma ?? getPresetDefaults(id, 'gamma') ?? 1.0);
    if (!Number.isFinite(gamma) || gamma <= 0) {
      return 'G100';
    }
    const rounded = Math.round(gamma * 100);
    return `G${String(rounded).padStart(3, '0')}`;
  }
  if (id === 'filmic' || id === 'custom_filmic') return 'FILM';
  if (id === 'pops_standard') return 'POPS';
  if (id === 'custom_points') return 'CUST';
  return 'LIN';
}

function getPresetDefaults(presetId, param) {
  const preset = CONTRAST_INTENT_PRESETS?.[presetId];
  if (!preset || !preset.params) return null;
  return preset.params[param];
}

function buildDefaultQuadFile() {
  const ramp = generateLinearRamp();
  const lines = [
    '## QuadToneRIP K',
    '# Printer: Unknown',
    `# quadGEN ${APP_DISPLAY_VERSION} by David Marsh`,
    '#',
    '# Limits summary:',
    '#   K: = 100%',
    '# K curve',
    ...ramp.map(String)
  ];
  return `${lines.join('\n')}\n`;
}

function generateLinearRamp() {
  const ramp = [];
  for (let i = 0; i < 256; i += 1) {
    ramp.push(Math.round((i / 255) * 65535));
  }
  return ramp;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#39;';
      default: return char;
    }
  });
}

function hexToRgb(hex) {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const value = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
  const num = parseInt(value, 16);
  if (Number.isNaN(num) || value.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function srgbToLinear(component) {
  const c = component / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function pickGutterTextColor(hex) {
  try {
    const luminance = relativeLuminance(hex);
    const contrastWhite = (1 + 0.05) / (luminance + 0.05);
    const contrastBlack = (luminance + 0.05) / 0.05;
    return contrastBlack >= contrastWhite ? '#111827' : '#ffffff';
  } catch (error) {
    return '#111827';
  }
}

function buildChannelStyle(channelName, cache) {
  const bg = INK_COLORS[channelName] || '#666666';
  const fg = cache[channelName] || (cache[channelName] = pickGutterTextColor(bg));
  return ` style="--ln-bg: ${bg}; --ln-fg: ${fg};"`;
}

export function highlightQuad(fileText) {
  try {
    const lines = String(fileText || '').split('\n');
    let currentChannel = null;
    let channelLineIndex = -1;
    const fgCache = Object.create(null);

    return lines.map((rawLine, index) => {
      const trimmed = rawLine.trim();
      let inner;
      let dataChannel = null;

      if (trimmed.length === 0) {
        inner = NBSP;
      } else if (/^##\s/.test(trimmed)) {
        inner = `<span class="quad-meta">${escapeHTML(rawLine)}</span>`;
      } else if (/^#(?=\s|$)/.test(trimmed)) {
        const match = trimmed.match(/^#\s+([A-Za-z]{1,3})\s+curve$/);
        if (match) {
          currentChannel = match[1];
          channelLineIndex = -1;
        }
        inner = `<span class="quad-comment">${escapeHTML(rawLine)}</span>`;
      } else if (/^\d+$/.test(trimmed)) {
        const classes = ['quad-number'];
        if (currentChannel) {
          dataChannel = currentChannel;
          channelLineIndex += 1;
          const nextLine = (lines[index + 1] || '').trim();
          const isFirst = channelLineIndex === 0;
          const isLast = !nextLine || /^#(?=\s|$)/.test(nextLine);
          if (isLast) {
            currentChannel = null;
            channelLineIndex = -1;
          }
          if (isFirst || isLast) {
            classes.push('quad-emph');
          }
        }
        inner = `<span class="${classes.join(' ')}">${escapeHTML(rawLine)}</span>`;
      } else {
        inner = `<span class="quad-error">${escapeHTML(rawLine)}</span>`;
      }

      const attr = dataChannel ? ` data-ch="${dataChannel}"` : '';
      const styleVars = dataChannel ? buildChannelStyle(dataChannel, fgCache) : '';
      return `<span class="quad-line"${attr}${styleVars}>${inner}</span>`;
    }).join('');
  } catch (error) {
    return escapeHTML(String(fileText || ''));
  }
}

function adjustLineNumberWidth(fileText) {
  if (!elements.previewFull) return;
  try {
    const totalLines = (fileText.match(/\n/g) || []).length + 1;
    const digits = String(Math.max(1, totalLines)).length;
    elements.previewFull.style.setProperty('--lnw', `calc(${digits}ch + 2ch)`);
    elements.previewFull.style.setProperty('--lngap', '1ch');
  } catch (error) {
    console.warn('Error adjusting preview line number gutter:', error);
  }
}

function ensurePreviewCopyHandler() {
  const el = elements.previewFull;
  if (!el || el.dataset.copyHandlerAttached === 'true') return;

  el.addEventListener('copy', (event) => {
    try {
      const raw = el.dataset.raw || el.textContent || '';
      event.clipboardData.setData('text/plain', raw);
      event.preventDefault();
    } catch (error) {
      console.warn('Preview copy handler error:', error);
    }
  });

  el.dataset.copyHandlerAttached = 'true';
}

export function updatePreview(options = {}) {
  requestAnimationFrame(() => {
    try {
      const fileText = buildFile();
      if (!elements.previewFull) {
        return;
      }

      if (elements.previewFull.dataset.raw !== fileText) {
        elements.previewFull.dataset.raw = fileText;
        elements.previewFull.innerHTML = highlightQuad(fileText);
        adjustLineNumberWidth(fileText);
      }

      ensurePreviewCopyHandler();

      if (!options.onlyNotes) {
        triggerInkChartUpdate();
        if (typeof updateFilename === 'function') {
          updateFilename();
        }
        triggerSessionStatusUpdate();
      }

      try { triggerRevertButtonsUpdate(); } catch (err) { /* ignore */ }
    } catch (error) {
      console.error('Preview update error:', error);
      showStatus();
    }
  });
}

registerPreviewHandler(updatePreview);

function initializePreviewResizer() {
  const resizer = document.getElementById('previewResizer');
  const previewFull = elements.previewFull;
  if (!resizer || !previewFull) {
    return;
  }

  const getHeight = () => {
    const computed = isBrowser ? globalScope.getComputedStyle(previewFull).maxHeight : `${MAX_PREVIEW_HEIGHT}px`;
    const parsed = parseInt(computed, 10);
    return Number.isFinite(parsed) ? parsed : previewFull.clientHeight;
  };

  const setHeight = (value) => {
    const clamped = Math.max(MIN_PREVIEW_HEIGHT, Math.min(MAX_PREVIEW_HEIGHT, value));
    previewFull.style.maxHeight = `${clamped}px`;
  };

  let startY = 0;
  let startHeight = 0;
  let active = false;

  const onMouseDown = (event) => {
    active = true;
    startY = event.clientY;
    startHeight = getHeight();
    document.body.classList.add('select-none');
    if (isBrowser) {
      globalScope.addEventListener('mousemove', onMouseMove);
      globalScope.addEventListener('mouseup', onMouseUp);
    }
    event.preventDefault();
  };

  const onMouseMove = (event) => {
    if (!active) return;
    const delta = event.clientY - startY;
    setHeight(startHeight + delta);
  };

  const onMouseUp = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove('select-none');
    if (isBrowser) {
      globalScope.removeEventListener('mousemove', onMouseMove);
      globalScope.removeEventListener('mouseup', onMouseUp);
    }
  };

  const onTouchStart = (event) => {
    if (event.touches.length !== 1) return;
    active = true;
    startY = event.touches[0].clientY;
    startHeight = getHeight();
    document.body.classList.add('select-none');
    if (isBrowser) {
      globalScope.addEventListener('touchmove', onTouchMove, { passive: false });
      globalScope.addEventListener('touchend', onTouchEnd);
    }
    event.preventDefault();
  };

  const onTouchMove = (event) => {
    if (!active || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - startY;
    setHeight(startHeight + delta);
    event.preventDefault();
  };

  const onTouchEnd = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove('select-none');
    if (isBrowser) {
      globalScope.removeEventListener('touchmove', onTouchMove);
      globalScope.removeEventListener('touchend', onTouchEnd);
    }
  };

  resizer.addEventListener('mousedown', onMouseDown);
  resizer.addEventListener('touchstart', onTouchStart, { passive: false });
}

export function initializePreview() {
  updatePreview();

  if (elements.userNotes) {
    let notesTimeout = null;
    elements.userNotes.addEventListener('input', () => {
      clearTimeout(notesTimeout);
      notesTimeout = setTimeout(() => {
        updatePreview({ onlyNotes: true });
      }, 200);
    });
  }

  initializePreviewResizer();
  ensurePreviewCopyHandler();
}

if (isBrowser) {
  globalScope.buildFile = buildFile;
  globalScope.updatePreview = updatePreview;
  globalScope.highlightQuad = highlightQuad;
}
