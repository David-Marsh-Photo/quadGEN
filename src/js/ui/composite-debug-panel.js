// Composite debug overlay panel
// Renders composite redistribution diagnostics when the debug flag is enabled.

import {
    subscribeCompositeDebugState,
    getCompositeDebugState,
    selectCompositeDebugSnapshot,
    stepCompositeDebugSelection
} from '../core/composite-debug.js';
import { INK_COLORS } from '../core/state.js';

const isBrowser = typeof window !== 'undefined';
const TOTAL_16BIT = 65535;

let panelRoot = null;
let modeEl = null;
let maximaEl = null;
let weightsEl = null;
let momentumEl = null;
let momentumRowEl = null;
let modeRowEl = null;
let coverageEl = null;
let coverageRowEl = null;
let selectedEl = null;
let smoothingBadgeEl = null;
let targetEl = null;
let measurementEl = null;
let deltaEl = null;
let totalsEl = null;
let channelsEl = null;
let snapshotInput = null;
let prevBtn = null;
let nextBtn = null;
let orderedChannelNames = null;
let flagsSectionEl = null;
let flagsListEl = null;

let unsubscribe = null;
let lastStateId = null;
let panelInitScheduled = false;
let resizeListenerAttached = false;
let resizeHandler = null;

function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.dataset) {
        Object.entries(options.dataset).forEach(([key, value]) => {
            el.dataset[key] = value;
        });
    }
    if (options.text) {
        el.textContent = options.text;
    }
    if (options.id) {
        el.id = options.id;
    }
    return el;
}

function formatPercent(value, digits = 1) {
    if (!Number.isFinite(value)) return '—';
    return `${value.toFixed(digits)}%`;
}

function formatNormalizedPercent(value, digits = 1) {
    if (!Number.isFinite(value)) return '—';
    return `${(value * 100).toFixed(digits)}%`;
}

function formatInkValue(raw) {
    if (!Number.isFinite(raw) || raw < 0) return '—';
    const pct = (raw / TOTAL_16BIT) * 100;
    return formatPercent(Math.max(0, Math.min(100, pct)), 1);
}

function formatInkSum(value) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 100000) {
        return `${Math.round(value / 1000)}k`;
    }
    if (abs >= 10000) {
        return `${(value / 1000).toFixed(1)}k`;
    }
    return Math.round(value).toString();
}

function formatFloat(value, digits = 3) {
    if (!Number.isFinite(value)) return '—';
    return value.toFixed(digits);
}

function formatMomentumDisplay(value) {
    if (!Number.isFinite(value)) return '—';
    const clamped = Math.max(0, Math.min(100, value * 100));
    return formatPercent(clamped, 1);
}

function formatSigned(value, digits = 3, suffix = '') {
    if (!Number.isFinite(value) || Math.abs(value) < 1e-6) {
        return `±0${suffix}`;
    }
    const fixed = value.toFixed(digits);
    return `${value >= 0 ? '+' : ''}${fixed}${suffix}`;
}

function positionPanel(panel) {
    if (!panel || !panel.parentElement) {
        return;
    }
    const column = panel.parentElement;
    const editBody = document.getElementById('editPanelBody');
    if (!editBody) {
        panel.style.top = '12px';
        return;
    }
    let node = editBody;
    let offsetTop = 0;
    while (node && node !== column && node instanceof HTMLElement) {
        offsetTop += node.offsetTop || 0;
        node = node.offsetParent;
    }
    if (node === column) {
        const clamped = Math.max(0, offsetTop - 8);
        panel.style.top = `${clamped}px`;
    } else {
        panel.style.top = '12px';
    }
}

function ensurePanel() {
    if (!isBrowser || panelRoot) {
        return panelRoot;
    }

    const column = document.querySelector('[data-linearization-column]');
    if (!column) {
        return null;
    }
    if (getComputedStyle(column).position === 'static') {
        column.style.position = 'relative';
    }

    const currentPosition = getComputedStyle(column).position;
    if (currentPosition === 'static') {
        column.style.position = 'relative';
    }

    panelRoot = createElement('div', {
        className: 'absolute inset-x-2 z-30 rounded-xl border border-slate-600 bg-slate-900/95 text-slate-100 shadow-2xl backdrop-blur-sm px-4 py-3 space-y-3 hidden',
        id: 'compositeDebugPanel'
    });
    panelRoot.setAttribute('role', 'region');
    panelRoot.setAttribute('aria-label', 'Composite correction debug information');

    const header = createElement('div', { className: 'flex items-center justify-between gap-3 text-sm font-semibold text-slate-50' });
    header.appendChild(createElement('span', { text: 'Composite Debug' }));
    selectedEl = createElement('span', { dataset: { debugSelected: '' }, text: '—', className: 'text-slate-300 font-medium' });
    header.appendChild(selectedEl);
    smoothingBadgeEl = createElement('span', {
        dataset: { debugSmoothingBadge: '' },
        className: 'hidden rounded-full border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100 shadow-sm',
        text: 'Smoothing window active'
    });
    header.appendChild(smoothingBadgeEl);

    const summary = createElement('div', { className: 'space-y-1.5 text-[13px] text-slate-100' });
    const modeRow = createElement('div', { className: 'flex items-start gap-2 text-slate-200', dataset: { debugMode: '' } });
    modeRow.appendChild(createElement('span', { className: 'shrink-0 text-slate-300 font-medium', text: 'Mode' }));
    modeEl = createElement('span', { className: 'flex-1 text-slate-50 font-semibold' });
    modeEl.textContent = '—';
    modeRow.appendChild(modeEl);
    modeRowEl = modeRow;

    const maximaRow = createElement('div', { className: 'flex items-start gap-2' });
    maximaRow.appendChild(createElement('span', { className: 'shrink-0 text-slate-300 font-medium', text: 'Maxima' }));
    maximaEl = createElement('span', { dataset: { debugMaxima: '' }, className: 'flex-1 text-slate-50 font-semibold' });
    maximaEl.textContent = '—';
    maximaRow.appendChild(maximaEl);

    const weightsRow = createElement('div', { className: 'flex items-start gap-2' });
    weightsRow.appendChild(createElement('span', { className: 'shrink-0 text-slate-300 font-medium', text: 'Weights' }));
    weightsEl = createElement('span', { dataset: { debugWeights: '' }, className: 'flex-1 text-slate-50 font-semibold' });
    weightsEl.textContent = '—';
    weightsRow.appendChild(weightsEl);

    const momentumRow = createElement('div', { className: 'flex items-start gap-2', dataset: { debugMomentum: '' } });
    momentumRow.appendChild(createElement('span', { className: 'shrink-0 text-slate-300 font-medium', text: 'Momentum' }));
    momentumEl = createElement('span', { className: 'flex-1 text-slate-50 font-semibold' });
    momentumEl.textContent = '—';
    momentumRow.appendChild(momentumEl);
    momentumRowEl = momentumRow;

    const coverageRow = createElement('div', { className: 'flex items-start gap-2', dataset: { debugCoverage: '' } });
    coverageRow.appendChild(createElement('span', { className: 'shrink-0 text-slate-300 font-medium', text: 'Coverage' }));
    coverageEl = createElement('span', { className: 'flex-1 text-slate-50 font-semibold' });
    coverageEl.textContent = '—';
    coverageRow.appendChild(coverageEl);
    coverageRowEl = coverageRow;

    summary.append(modeRow, maximaRow, weightsRow, momentumRow, coverageRow);

    const controls = createElement('div', { className: 'flex items-center gap-2 pt-1' });
    prevBtn = createElement('button', {
        id: 'compositeDebugPrev',
        className: 'px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold transition-colors',
        text: '◀'
    });
    snapshotInput = createElement('input', {
        id: 'compositeDebugSnapshotInput',
        className: 'flex-1 border border-slate-600 rounded-md px-2 py-1 bg-slate-900 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400',
    });
    snapshotInput.type = 'number';
    snapshotInput.min = '0';
    snapshotInput.max = '255';
    snapshotInput.step = '1';
    snapshotInput.value = '';
    nextBtn = createElement('button', {
        id: 'compositeDebugNext',
        className: 'px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold transition-colors',
        text: '▶'
    });

    controls.append(prevBtn, snapshotInput, nextBtn);

    flagsSectionEl = createElement('div', {
        dataset: { debugFlags: '' },
        className: 'space-y-1 text-[12px] text-rose-100'
    });
    const flagsHeader = createElement('div', {
        className: 'flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-rose-200'
    });
    flagsHeader.appendChild(createElement('span', { text: 'Flagged snapshots' }));
    flagsSectionEl.appendChild(flagsHeader);
    flagsListEl = createElement('div', { className: 'flex flex-wrap gap-1.5' });
    const noFlagsLabel = createElement('span', {
        className: 'text-rose-200/70 italic',
        text: 'No flagged snapshots'
    });
    noFlagsLabel.dataset.emptyFlag = 'true';
    flagsListEl.appendChild(noFlagsLabel);
    flagsSectionEl.appendChild(flagsListEl);

    const snapshotInfo = createElement('div', { className: 'space-y-1 text-[13px] text-slate-200' });
    totalsEl = createElement('div', { className: 'font-semibold tracking-wide' });
    totalsEl.textContent = 'Ink —';
    targetEl = createElement('div', { dataset: { debugTarget: '' }, className: 'font-medium' });
    targetEl.textContent = 'Target Δρ —';
    measurementEl = createElement('div', { dataset: { debugMeasurement: '' }, className: 'font-medium' });
    measurementEl.textContent = 'Measured ρ —';
    deltaEl = createElement('div', { dataset: { debugDelta: '' }, className: 'text-sm text-slate-300 font-medium' });
    deltaEl.textContent = 'Δρ —';
    snapshotInfo.append(totalsEl, targetEl, measurementEl, deltaEl);

    channelsEl = createElement('div', { dataset: { debugChannels: '' }, className: 'divide-y divide-slate-700 pt-2 text-[13px]' });

    panelRoot.append(header, summary, controls, flagsSectionEl, snapshotInfo, channelsEl);
    column.appendChild(panelRoot);
    positionPanel(panelRoot);

    attachStepper(prevBtn, -1);
    attachStepper(nextBtn, 1);

    snapshotInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const value = Number(snapshotInput.value);
            if (Number.isFinite(value)) {
                selectCompositeDebugSnapshot(Math.max(0, Math.min(255, Math.round(value))));
            }
        }
    });
    snapshotInput.addEventListener('blur', () => {
        const state = getCompositeDebugState();
        const current = Number.isInteger(state.selection?.index) ? state.selection.index : '';
        snapshotInput.value = current === '' ? '' : String(current);
    });

    if (!resizeListenerAttached) {
        resizeListenerAttached = true;
        resizeHandler = () => {
            if (panelRoot) {
                positionPanel(panelRoot);
            }
        };
        window.addEventListener('resize', resizeHandler, { passive: true });
    }

    return panelRoot;
}

function attachStepper(button, delta) {
    if (!button || button.dataset.stepperAttached === 'true') {
        return;
    }
    button.dataset.stepperAttached = 'true';

    const initialDelay = 400;
    const repeatDelay = 120;
    let holdTimeout = null;
    let repeatInterval = null;
    let holdTriggered = false;

    const clearTimers = () => {
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = null;
        }
        if (repeatInterval) {
            clearInterval(repeatInterval);
            repeatInterval = null;
        }
    };

    const startHold = () => {
        clearTimers();
        holdTriggered = false;
        if (!isBrowser) return;
        holdTimeout = window.setTimeout(() => {
            holdTriggered = true;
            stepCompositeDebugSelection(delta);
            repeatInterval = window.setInterval(() => {
                stepCompositeDebugSelection(delta);
            }, repeatDelay);
        }, initialDelay);
    };

    const stopHold = (resetFlag = false) => {
        clearTimers();
        if (resetFlag) {
            holdTriggered = false;
        }
    };

    const handlePointerDown = (event) => {
        if (button.disabled) {
            return;
        }
        if (event.button != null && event.button !== 0) {
            return;
        }
        startHold();
    };

    const supportsPointer = typeof window !== 'undefined' && typeof window.PointerEvent !== 'undefined';
    if (supportsPointer) {
        button.addEventListener('pointerdown', handlePointerDown);
        button.addEventListener('pointerup', () => stopHold(false));
        button.addEventListener('pointerleave', () => stopHold(true));
        button.addEventListener('pointercancel', () => stopHold(true));
    } else {
        button.addEventListener('mousedown', handlePointerDown);
        button.addEventListener('mouseup', () => stopHold(false));
        button.addEventListener('mouseleave', () => stopHold(true));
    }

    button.addEventListener('blur', () => stopHold(true));
    button.addEventListener('contextmenu', () => stopHold(true));

    button.addEventListener('click', (event) => {
        if (holdTriggered) {
            event.preventDefault();
            event.stopPropagation();
            holdTriggered = false;
            return;
        }
        stepCompositeDebugSelection(delta);
    });
}

function getEnabledChannelSet() {
    if (!isBrowser) {
        return null;
    }
    const rows = document.querySelectorAll('tr[data-channel]');
    const enabled = new Set();
    rows.forEach((row) => {
        const channel = row.getAttribute('data-channel');
        if (!channel) return;
        const percentInput = row.querySelector('.percent-input');
        const percentAttr = percentInput?.value ?? percentInput?.getAttribute?.('data-base-percent');
        const percent = Number.parseFloat(String(percentAttr ?? '0').replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(percent) && percent > 0) {
            enabled.add(channel);
        }
    });
    return enabled;
}

function renderSummary(summary) {
    if (!maximaEl || !weightsEl) return;

    if (!summary) {
        orderedChannelNames = null;
        if (modeEl) modeEl.textContent = '—';
        maximaEl.textContent = '—';
        weightsEl.textContent = '—';
        if (momentumEl) momentumEl.textContent = '—';
        if (momentumRowEl) momentumRowEl.classList.add('opacity-60');
        if (coverageEl) coverageEl.textContent = '—';
        if (coverageRowEl) {
            coverageRowEl.classList.add('opacity-60');
            coverageRowEl.classList.remove('text-amber-200');
            coverageRowEl.removeAttribute('title');
        }
        return;
    }

    if (Array.isArray(summary.channelNames) && summary.channelNames.length) {
        orderedChannelNames = summary.channelNames.slice();
    } else if (summary.ladderOrderIndex && typeof summary.ladderOrderIndex === 'object') {
        orderedChannelNames = Object.entries(summary.ladderOrderIndex)
            .filter((entry) => entry && typeof entry[0] === 'string' && Number.isFinite(entry[1]))
            .sort((a, b) => a[1] - b[1])
            .map(([name]) => name);
        if (!orderedChannelNames.length) {
            orderedChannelNames = null;
        }
    } else {
        orderedChannelNames = null;
    }

    if (modeEl) {
        const modeLabels = {
            equal: 'Equal',
            isolated: 'Isolated',
            normalized: 'Normalized',
            momentum: 'Momentum'
        };
        const currentMode = typeof summary.weightingMode === 'string'
            ? summary.weightingMode.toLowerCase()
            : '';
        modeEl.textContent = modeLabels[currentMode] || '—';
    }

    const enabledChannels = getEnabledChannelSet();
    const maximaEntries = Object.entries(summary.channelMaxima || {}).filter(([name]) => {
        if (!enabledChannels || !enabledChannels.size) return true;
        return enabledChannels.has(name);
    });
    maximaEntries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    maximaEl.textContent = maximaEntries.length
        ? maximaEntries.map(([name, value]) => `${name} ${formatInkValue(value)}`).join(', ')
        : '—';

    const weightEntries = Object.entries(summary.densityWeights || {});
    weightEntries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    weightsEl.textContent = weightEntries.length
        ? weightEntries.map(([name, value]) => `${name} ${formatFloat(value, 3)}`).join(', ')
        : '—';

    if (momentumEl) {
        const momentumEntries = Object.entries(summary.momentumPeaks || {});
        momentumEntries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
        const showMomentum = (summary.weightingMode || '').toLowerCase() === 'momentum' && momentumEntries.length > 0;
        if (momentumRowEl) {
            momentumRowEl.classList.toggle('opacity-60', !showMomentum);
        }
        momentumEl.textContent = showMomentum
            ? momentumEntries.map(([name, value]) => `${name} ${formatMomentumDisplay(value || 0)}`).join(', ')
            : '—';
        if (momentumRowEl && showMomentum && summary.momentumWindow != null && summary.momentumSigma != null) {
            momentumRowEl.title = `Gaussian window ±${summary.momentumWindow} • σ=${formatFloat(summary.momentumSigma, 2)}`;
        } else if (momentumRowEl) {
            momentumRowEl.removeAttribute('title');
        }
    }

    if (coverageEl) {
        if (summary.perSampleCeilingEnabled !== true) {
            coverageEl.textContent = 'Disabled';
            if (coverageRowEl) {
                coverageRowEl.classList.add('opacity-60');
                coverageRowEl.classList.remove('text-amber-200');
                coverageRowEl.removeAttribute('title');
            }
        } else {
            const coverageEntries = Object.entries(summary.coverageSummary || {}).filter(([name]) => {
                if (!enabledChannels || !enabledChannels.size) return true;
                return enabledChannels.has(name);
            });
            coverageEntries.sort((a, b) => (Number(b[1]?.maxNormalized) || 0) - (Number(a[1]?.maxNormalized) || 0));
            const parts = coverageEntries.map(([name, entry]) => {
                const normalized = Number(entry?.maxNormalized);
                const clampCount = Array.isArray(entry?.clampedSamples)
                    ? entry.clampedSamples.length
                    : Number(entry?.overflow) || 0;
                const clampLabel = clampCount > 0 ? `×${clampCount}` : 'ok';
                return `${name} ${formatNormalizedPercent(Number.isFinite(normalized) ? normalized : 0, 1)} ${clampLabel}`;
            });
            coverageEl.textContent = parts.length ? parts.join(', ') : '—';
            if (coverageRowEl) {
                const hasClamps = coverageEntries.some(([_, entry]) => {
                    const clampCount = Array.isArray(entry?.clampedSamples)
                        ? entry.clampedSamples.length
                        : Number(entry?.overflow) || 0;
                    return clampCount > 0;
                });
                coverageRowEl.classList.toggle('opacity-60', !parts.length);
                coverageRowEl.classList.toggle('text-amber-200', hasClamps);
                if (hasClamps) {
                    const details = [];
                    coverageEntries.forEach(([name, entry]) => {
                        const samples = Array.isArray(entry?.clampedSamples) ? entry.clampedSamples : [];
                        if (!samples.length) return;
                        const sampleDetails = samples.slice(0, 3).map((sample) => {
                            const pct = Number.isFinite(sample.inputPercent)
                                ? `${sample.inputPercent.toFixed(1)}%`
                                : (Number.isInteger(sample.index) ? `sample ${sample.index}` : 'sample');
                            if (Number.isFinite(sample.overflowNormalized) && sample.overflowNormalized > 0) {
                                return `${pct} (+${(sample.overflowNormalized * 100).toFixed(2)}%)`;
                            }
                            return pct;
                        });
                        details.push(`${name}: ${sampleDetails.join(', ')}`);
                    });
                    coverageRowEl.title = details.join('\n');
                } else {
                    coverageRowEl.removeAttribute('title');
                }
            }
        }
    }
}

function formatFlagTooltipEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }
    const lines = [];
    if (Number.isFinite(entry.percent)) {
        lines.push(`Input ${entry.percent.toFixed(1)}%`);
    }
    if (Array.isArray(entry.details) && entry.details.length) {
        const detailParts = entry.details
            .map((detail) => {
                if (!detail || typeof detail.channel !== 'string' || !detail.channel) {
                    return null;
                }
                if (Number.isFinite(detail.delta)) {
                    const magnitude = Math.abs(detail.delta).toFixed(1);
                    const sign = detail.delta >= 0 ? '+' : '−';
                    return `${detail.channel}: ${sign}${magnitude}%`;
                }
                if (Number.isFinite(detail.magnitude)) {
                    const magnitude = Math.abs(detail.magnitude).toFixed(1);
                    const sign = detail.direction === 'drop' ? '−' : '+';
                    return `${detail.channel}: ${sign}${magnitude}%`;
                }
                return detail.channel;
            })
            .filter(Boolean);
        if (detailParts.length) {
            lines.push(`Channels: ${detailParts.join(', ')}`);
        }
    } else if (Array.isArray(entry.channels) && entry.channels.length) {
        lines.push(`Channels: ${entry.channels.join(', ')}`);
    }
    if (Number.isFinite(entry.magnitude)) {
        const label = entry.kind === 'drop' ? 'Drop' : 'Rise';
        lines.push(`${label} ${entry.magnitude.toFixed(1)}%`);
    }
    if (Number.isFinite(entry.threshold)) {
        lines.push(`Threshold ≥ ${entry.threshold.toFixed(1)}%`);
    }
    return lines.join('\n');
}

function renderFlags(state) {
    if (!flagsSectionEl || !flagsListEl) {
        return;
    }
    const flags = state?.flags && typeof state.flags === 'object' ? state.flags : {};
    const snapshots = Array.isArray(state?.snapshots) ? state.snapshots : [];
    const selectionIndex = Number.isInteger(state?.selection?.index) ? state.selection.index : null;

    const entries = Object.entries(flags).map(([key, info]) => {
        if (!info || typeof info !== 'object') {
            return null;
        }
        const index = Number.parseInt(key, 10);
        if (!Number.isInteger(index)) {
            return null;
        }
        const snapshot = snapshots[index] && snapshots[index]?.index === index
            ? snapshots[index]
            : snapshots.find((entry) => entry && entry.index === index) || null;
        const percent = Number.isFinite(info.inputPercent)
            ? info.inputPercent
            : (snapshot && Number.isFinite(snapshot.inputPercent) ? snapshot.inputPercent : null);
        return {
            index,
            kind: info.kind === 'drop' ? 'drop' : 'rise',
            magnitude: Number.isFinite(info.magnitude) ? info.magnitude : null,
            threshold: Number.isFinite(info.threshold) ? info.threshold : null,
            percent,
            channels: Array.isArray(info.channels) ? info.channels.slice() : [],
            details: Array.isArray(info.details) ? info.details.map((detail) => ({ ...detail })) : []
        };
    }).filter(Boolean);

    entries.sort((a, b) => a.index - b.index);

    flagsListEl.innerHTML = '';
    if (!entries.length) {
        flagsSectionEl.classList.add('opacity-60');
        const empty = createElement('span', {
            className: 'text-rose-200/70 italic',
            text: 'No flagged snapshots'
        });
        flagsListEl.appendChild(empty);
        return;
    }

    flagsSectionEl.classList.remove('opacity-60');

    entries.forEach((entry) => {
        const button = createElement('button', {
            className: 'rounded-full border border-rose-400/70 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 transition-colors flex items-center gap-1'
        });
        button.dataset.flagIndex = String(entry.index);
        const arrow = entry.kind === 'drop' ? '↓' : '↑';
        const magnitudeLabel = Number.isFinite(entry.magnitude) ? `${entry.magnitude.toFixed(1)}%` : '';
        button.textContent = `🚩 #${entry.index} ${arrow} ${magnitudeLabel}`.trim();
        if (selectionIndex === entry.index) {
            button.classList.add('ring-2', 'ring-rose-300');
        }
        const tooltip = formatFlagTooltipEntry(entry);
        if (tooltip) {
            button.title = tooltip;
        }
        button.addEventListener('click', () => selectCompositeDebugSnapshot(entry.index));
        flagsListEl.appendChild(button);
    });
}

function renderSnapshot(state) {
    if (!panelRoot) return;
    const selectionIndex = Number.isInteger(state.selection?.index) ? state.selection.index : null;
    const snapshot = Number.isInteger(selectionIndex) ? state.snapshots?.[selectionIndex] : null;

    if (!selectedEl || !snapshotInput || !targetEl || !measurementEl || !deltaEl || !channelsEl || !totalsEl) {
        return;
    }

    if (!snapshot) {
        selectedEl.textContent = '—';
        snapshotInput.value = '';
        targetEl.textContent = 'Target ρ —';
        measurementEl.textContent = 'Measured ρ —';
        deltaEl.textContent = 'Δρ —';
        totalsEl.textContent = 'Ink —';
        channelsEl.innerHTML = '<div class="py-1 text-gray-500 dark:text-gray-400">Select a snapshot to view channel details.</div>';
        if (smoothingBadgeEl) {
            smoothingBadgeEl.classList.add('hidden');
        }
        return;
    }

    selectedEl.textContent = `#${snapshot.index} (${formatPercent(snapshot.inputPercent ?? 0, 1)})`;
    if (state.flags && state.flags[selectionIndex]) {
        selectedEl.textContent += ' 🚩';
    }
    snapshotInput.value = String(snapshot.index);

    targetEl.textContent = `Target ρ ${formatFloat(snapshot.targetDensity ?? NaN, 4)}`;
    measurementEl.textContent = `Measured ρ ${snapshot.measurementDensity != null ? formatFloat(snapshot.measurementDensity, 4) : '—'}`;
    deltaEl.textContent = `Δρ ${formatSigned(snapshot.deltaDensity ?? 0, 4)}`;

    const baselineInk = snapshot.baselineInk ?? NaN;
    const correctedInk = snapshot.correctedInk ?? NaN;
    const deltaInk = snapshot.inkDelta ?? NaN;
    const deltaDisplay = Number.isFinite(deltaInk)
        ? `${deltaInk >= 0 ? '+' : ''}${formatInkSum(Math.abs(deltaInk))}`
        : '—';
    totalsEl.textContent = `Ink Σ ${formatInkSum(baselineInk)} → ${formatInkSum(correctedInk)} (${deltaDisplay})`;

    const entryMap = new Map(Object.entries(snapshot.perChannel || {}));
    let orderedNames = [];
    if (orderedChannelNames && orderedChannelNames.length) {
        orderedNames = orderedChannelNames.filter((name) => entryMap.has(name));
    } else if (state.summary?.ladderOrderIndex && typeof state.summary.ladderOrderIndex === 'object') {
        orderedNames = Object.entries(state.summary.ladderOrderIndex)
            .filter(([name, index]) => entryMap.has(name) && Number.isFinite(index))
            .sort((a, b) => a[1] - b[1])
            .map(([name]) => name);
    }
    const remaining = Array.from(entryMap.keys()).filter((name) => !orderedNames.includes(name));
    if (!orderedNames.length && remaining.length) {
        remaining.sort();
    }
    orderedNames = orderedNames.concat(remaining);
    const entries = orderedNames.map((name) => [name, entryMap.get(name)]);

    if (smoothingBadgeEl) {
        let showSmoothing = false;
        if (Array.isArray(snapshot.smoothingWindows) && snapshot.smoothingWindows.length) {
            showSmoothing = true;
        } else if (Array.isArray(state.summary?.smoothingWindows) && Number.isInteger(snapshot.index)) {
            showSmoothing = state.summary.smoothingWindows.some((entry) => {
                if (!entry || typeof entry !== 'object') return false;
                const start = Number(entry.startIndex);
                const end = Number(entry.endIndex);
                if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
                return snapshot.index >= start && snapshot.index <= end;
            });
        }
        if (!showSmoothing && state.summary?.coverageSummary) {
            showSmoothing = Object.values(state.summary.coverageSummary).some((entry) => {
                if (!entry || typeof entry !== 'object') return false;
                const overflow = Number(entry.overflow);
                return Number.isFinite(overflow) && overflow > 0;
            });
        }
        smoothingBadgeEl.classList.toggle('hidden', !showSmoothing);
    }

    if (!entries.length) {
        channelsEl.innerHTML = '<div class="py-1 text-gray-500 dark:text-gray-400">No channel data available.</div>';
        return;
    }

    const fragments = document.createDocumentFragment();
    entries.slice(0, 8).forEach(([name, info]) => {
        const row = createElement('div', { className: 'py-2 flex items-start justify-between gap-3' });
        const labelWrapper = createElement('div', { className: 'flex items-center gap-2 text-sm font-semibold text-slate-50' });
        const chip = createElement('span', { className: 'inline-block w-3.5 h-3.5 rounded-full shadow-sm ring-2 ring-slate-900/30' });
        const channelColor = INK_COLORS?.[name] || '#94a3b8';
        chip.style.backgroundColor = channelColor;
        const label = createElement('span', { className: 'tracking-wide uppercase', text: name });
        labelWrapper.append(chip, label);

        const detail = createElement('div', { className: 'text-right text-slate-100 space-y-1 leading-4' });
        const formatNorm = (value, digits = 2) => (Number.isFinite(value) ? formatNormalizedPercent(value, digits) : '—');
        const normalizedBefore = Number.isFinite(info?.normalizedBefore) ? info.normalizedBefore : null;
        const normalizedAfter = Number.isFinite(info?.normalizedAfter) ? info.normalizedAfter : null;
        const normalizedDelta = Number.isFinite(info?.normalizedDelta) ? info.normalizedDelta : null;

        const percentLine = createElement('div', { className: 'text-[13px] font-semibold' });
        percentLine.textContent = `${formatNorm(normalizedBefore, 1)} → ${formatNorm(normalizedAfter, 1)} (${formatSigned((normalizedDelta ?? 0) * 100, 2, '%')})`;
        detail.appendChild(percentLine);

        const shareValue = Number.isFinite(info?.shareAfter)
            ? info.shareAfter
            : (Number.isFinite(info?.shareBefore) ? info.shareBefore : null);
        if (shareValue != null) {
            const shareLine = createElement('div', {
                className: 'text-xs text-slate-300 font-medium',
                text: `Share ${formatNorm(shareValue, 1)}`
            });
            detail.appendChild(shareLine);
        }

        if (Number.isFinite(info?.momentum)) {
            const momentumLine = createElement('div', {
                className: 'text-xs text-sky-300 font-medium',
                text: `Momentum ${formatMomentumDisplay(info.momentum)}`
            });
            detail.appendChild(momentumLine);
        }

        const deltaLine = createElement('div', {
            className: 'text-xs font-semibold text-emerald-300',
            text: `Δρ ${formatSigned(info?.densityContributionDelta ?? 0, 4)}`
        });
        detail.appendChild(deltaLine);

        const floorVal = Number.isFinite(info?.coverageFloorNormalized) ? info.coverageFloorNormalized : null;
        const layerVal = Number.isFinite(info?.layerNormalized) ? info.layerNormalized : null;
        const allowedVal = Number.isFinite(info?.allowedNormalized) ? info.allowedNormalized : null;
        if (floorVal != null || layerVal != null || allowedVal != null) {
            const coverageLine = createElement('div', {
                className: 'text-xs text-slate-400 font-medium',
                text: `Coverage floor ${formatNorm(floorVal, 2)} • Layer ${formatNorm(layerVal, 2)} • Allowed ${formatNorm(allowedVal, 2)}`
            });
            detail.appendChild(coverageLine);
        }

        const capacityBefore = Number.isFinite(info?.capacityBeforeNormalized) ? info.capacityBeforeNormalized : null;
        const capacityAfter = Number.isFinite(info?.capacityAfterNormalized) ? info.capacityAfterNormalized : null;
        const effectiveCapacity = Number.isFinite(info?.effectiveHeadroomNormalized)
            ? info.effectiveHeadroomNormalized
            : (Number.isFinite(info?.effectiveHeadroomAfter) ? info.effectiveHeadroomAfter : null);
        if (capacityBefore != null || capacityAfter != null || effectiveCapacity != null) {
            const capacityLine = createElement('div', {
                className: 'text-xs text-slate-400 font-medium',
                text: `Capacity ${formatNorm(capacityBefore, 2)} → ${formatNorm(capacityAfter, 2)} • Effective ${formatNorm(effectiveCapacity, 2)}`
            });
            detail.appendChild(capacityLine);
        }

        const reserveState = typeof info?.reserveState === 'string' ? info.reserveState : null;
        const reserveBase = Number.isFinite(info?.frontReserveBase) ? info.frontReserveBase : null;
        const reserveApplied = Number.isFinite(info?.frontReserveApplied) ? info.frontReserveApplied : null;
        const reserveAllowance = Number.isFinite(info?.reserveAllowanceRemaining)
            ? info.reserveAllowanceRemaining
            : (Number.isFinite(info?.reserveAllowanceNormalized) ? info.reserveAllowanceNormalized : null);
        const reserveRelease = Number.isFinite(info?.reserveReleaseScale) ? info.reserveReleaseScale : null;
        if (reserveState || reserveBase != null || reserveApplied != null || reserveAllowance != null || reserveRelease != null) {
            const reserveParts = [];
            reserveParts.push(`State ${reserveState || '—'}`);
            reserveParts.push(`Base ${formatNorm(reserveBase, 2)}`);
            reserveParts.push(`Applied ${formatNorm(reserveApplied, 2)}`);
            reserveParts.push(`Allowance ${formatNorm(reserveAllowance, 2)}`);
            if (reserveRelease != null) {
                reserveParts.push(`Release ${formatPercent(reserveRelease * 100, 1)}`);
            }
            const reserveLine = createElement('div', {
                className: 'text-xs text-slate-400 font-medium',
                text: reserveParts.join(' • ')
            });
            detail.appendChild(reserveLine);
        }

        const blendParts = [];
        if (Number.isFinite(info?.blendCapNormalized)) {
            const blendProgress = Number.isFinite(info?.blendProgress) && Number.isFinite(info?.blendWindow)
                ? ` (${info.blendProgress}/${info.blendWindow})`
                : '';
            blendParts.push(`Blend cap ${formatNorm(info.blendCapNormalized, 2)}${blendProgress}`);
        }
        if (Number.isFinite(info?.blendAppliedNormalized)) {
            blendParts.push(`Blend applied ${formatNorm(info.blendAppliedNormalized, 2)}`);
        }
        if (Number.isFinite(info?.shadowBlendCapNormalized)) {
            const shadowProgress = Number.isFinite(info?.shadowBlendProgress) && Number.isFinite(info?.shadowBlendWindow)
                ? ` (${info.shadowBlendProgress}/${info.shadowBlendWindow})`
                : '';
            const shadowApplied = Number.isFinite(info?.shadowBlendAppliedNormalized)
                ? ` applied ${formatNorm(info.shadowBlendAppliedNormalized, 2)}`
                : '';
            const sourceChannel = typeof info?.shadowBlendFromChannel === 'string' && info.shadowBlendFromChannel
                ? ` from ${info.shadowBlendFromChannel}`
                : '';
            blendParts.push(`Shadow cap ${formatNorm(info.shadowBlendCapNormalized, 2)}${shadowProgress}${shadowApplied}${sourceChannel}`);
        }
        if (blendParts.length) {
            const blendLine = createElement('div', {
                className: 'text-xs text-indigo-300 font-medium',
                text: blendParts.join(' • ')
            });
            detail.appendChild(blendLine);
        }

        row.append(labelWrapper, detail);
        fragments.appendChild(row);
    });
    channelsEl.innerHTML = '';
    channelsEl.appendChild(fragments);
}

function renderState(state) {
    if (!panelRoot) return;

    if (!state.enabled || !state.summary) {
        panelRoot.classList.add('hidden');
        return;
    }

    panelRoot.classList.remove('hidden');
    positionPanel(panelRoot);

    renderSummary(state.summary);
    renderFlags(state);
    lastStateId = state.sessionId;

    renderSnapshot(state);
}

export function initializeCompositeDebugPanel() {
    if (!isBrowser) return;
    const panel = ensurePanel();
    if (!panel) {
        if (!panelInitScheduled) {
            panelInitScheduled = true;
            setTimeout(() => {
                panelInitScheduled = false;
                initializeCompositeDebugPanel();
            }, 100);
        }
        return;
    }
    if (unsubscribe) {
        unsubscribe();
    }
    unsubscribe = subscribeCompositeDebugState(renderState);
    renderState(getCompositeDebugState());
}

export function teardownCompositeDebugPanel() {
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    if (resizeListenerAttached && resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeListenerAttached = false;
        resizeHandler = null;
    }
    if (panelRoot && panelRoot.parentNode) {
        panelRoot.parentNode.removeChild(panelRoot);
    }
    panelRoot = null;
    modeEl = null;
    maximaEl = null;
    weightsEl = null;
    momentumEl = null;
    momentumRowEl = null;
    modeRowEl = null;
    selectedEl = null;
    targetEl = null;
    measurementEl = null;
    deltaEl = null;
    totalsEl = null;
    channelsEl = null;
    snapshotInput = null;
    prevBtn = null;
    nextBtn = null;
    lastStateId = null;
    panelInitScheduled = false;
    orderedChannelNames = null;
}
