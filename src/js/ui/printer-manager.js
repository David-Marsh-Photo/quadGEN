// Printer Manager
// Centralizes printer selection, channel row construction, and related UI updates.

import { PRINTERS, INK_COLORS, elements } from '../core/state.js';
import { InputValidator } from '../core/validation.js';
import { resetChannelRegistry, registerChannelRow } from './channel-registry.js';
import { updateNoChannelsMessage, updateCompactChannelsList } from './compact-channels.js';
import { updateProcessingDetail, updateSessionStatus } from './graph-status.js';
import { updateInkChart } from './chart-manager.js';
import { updatePreview } from './quad-preview.js';
import { updateFilename } from '../files/file-operations.js';
import { getStateManager } from '../core/state-manager.js';
import { findMatchingPrinter } from '../data/quad-parser.js';
import { updateIntentDropdownState } from './intent-system.js';
import { showStatus } from './status-service.js';
import { initializeChannelLocks } from '../core/channel-locks.js';
import { initializeChannelDensitiesForPrinter, getResolvedChannelDensity, formatDensityValue } from '../core/channel-densities.js';

let channelRowSetupCallback = null;

function reportStatus(message) {
    if (!message) return;
    showStatus(message);
}

const LOCK_ICON_UNLOCKED = `
    <svg class="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5.5" y="11" width="13" height="9.5" rx="2"></rect>
        <path d="M16 11V8.5a4 4 0 00-7.5-2"></path>
    </svg>`;

const LOCK_ICON_LOCKED = `
    <svg class="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5.5" y="11" width="13" height="9.5" rx="2"></rect>
        <path d="M16 11V8a4 4 0 00-8 0v3"></path>
        <path d="M12 15v2.5"></path>
    </svg>`;

function formatPercentDisplay(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 0.05) {
        return String(rounded);
    }
    return Number(value.toFixed(1)).toString();
}

function resolveDensityAttributes(channelName, densityState) {
    const resolved = densityState && typeof densityState === 'object'
        ? densityState
        : getResolvedChannelDensity(channelName);
    const value = Number.isFinite(resolved?.value) ? resolved.value : null;
    const source = resolved?.source || (value !== null ? 'default' : 'unset');
    const display = value !== null ? formatDensityValue(value) : '';
    return { value, source, display };
}

function buildChannelRow(channelName, percent, endValue, densityState) {
    const row = document.createElement('tr');
    row.className = 'border-t border-gray-200 channel-row';
    row.setAttribute('data-channel', channelName);
    const density = resolveDensityAttributes(channelName, densityState);
    const densityValueAttr = density.display || '';
    const densitySourceAttr = density.source || 'unset';

    row.innerHTML = `
        <td class="p-0 text-center" style="width:0;"></td>
        <td class="px-1 pt-2 pb-1 font-medium align-middle text-left" style="width: 100px;">
            <span class="flex items-center gap-2 w-full">
                <button type="button" class="channel-lock-btn px-1.5 py-1 text-xs rounded border border-gray-300 text-gray-600 bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 flex-shrink-0" data-channel="${channelName}" data-tooltip="Lock to prevent edits" aria-pressed="false" aria-label="Toggle ink limit lock for ${channelName}">${LOCK_ICON_UNLOCKED.trim()}</button>
                <span class="inline-block w-3.5 h-3.5 rounded-sm border border-black/10 flex-shrink-0" style="background-color: ${INK_COLORS[channelName] || '#000'}"></span>
                <span class="w-8 channel-name">${channelName}</span>
                <span class="text-xs text-gray-500 invisible" data-disabled>(disabled)</span>
            </span>
        </td>
        <td class="px-1 pt-2 pb-1 text-center" style="width: 250px;">
            <div class="inline-flex items-center gap-2">
                <input type="file" class="per-channel-file hidden" accept=".cube,.txt,.cgats,.cgats17,.ti3,.acv">
                <button class="per-channel-btn px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors font-bold" data-tooltip="Load LUT.cube, LABdata.txt, or .acv curve files">Load file</button>
                <button class="per-channel-revert px-2 py-1 text-xs bg-slate-600 hover:bg-slate-700 text-white rounded transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed invisible" title="Revert / Clear Smart" disabled>Revert</button>
                <label class="slider-toggle" title="Enable/disable per-channel linearization">
                    <input type="checkbox" class="per-channel-toggle" disabled>
                    <span class="slider"></span>
                </label>
            </div>
        </td>
        <td class="px-1 pt-2 pb-1 align-middle text-left">
            <span class="processing-label italic font-normal text-xs text-gray-600" data-channel="${channelName}">→ Linear ramp</span>
        </td>
        <td class="pr-0 pt-2 pb-1 text-right" style="width:120px;">
            <div class="flex items-center justify-end gap-1">
                <input type="number" step="1" min="0" max="100" value="${percent}" data-base-percent="${percent}" class="percent-input w-16 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right">
            </div>
        </td>
        <td class="pl-0 pt-2 pb-1 text-right" style="width:120px;">
            <input type="number" step="1" min="0" max="65535" value="${endValue}" data-base-end="${endValue}" class="end-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right">
        </td>
        <td class="pl-0 pr-2 pt-2 pb-1 text-right" style="width:150px;">
            <div class="flex flex-col items-end gap-1">
                <input type="number" step="0.001" min="0" max="2" value="${densityValueAttr}" class="density-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-xs text-right" data-channel="${channelName}" data-density-source="${densitySourceAttr}" placeholder="—">
                <span class="density-coverage-indicator text-xs text-gray-500 text-right hidden" data-coverage-indicator></span>
            </div>
        </td>
    `;

    return row;
}

function buildPlaceholderRow() {
    const row = document.createElement('tr');
    row.id = 'noChannelsRow';
    row.className = 'hidden border-t border-gray-200';
    row.innerHTML = `
        <td class="p-0 text-center" style="width:0;"></td>
        <td class="px-1 pt-2 pb-1 font-medium" style="width: 100px;">
            <span class="inline-flex items-center gap-2 invisible">
                <span class="inline-block w-3.5 h-3.5 rounded-sm border border-black/10"></span>
                <span class="w-8 channel-name">XX</span>
                <span class="text-xs text-gray-500 invisible">(disabled)</span>
            </span>
            <div class="text-center text-gray-500 italic" style="margin-top: -24px;">No channels enabled</div>
        </td>
        <td class="px-1 pt-2 pb-1 text-center" style="width: 250px;">
            <div class="inline-flex items-center gap-2 invisible">
                <input type="file" class="hidden per-channel-file">
                <button class="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors font-bold">📁 Load</button>
                <span class="text-xs text-gray-500">No file</span>
            </div>
        </td>
        <td class="px-1 pt-2 pb-1 text-left">
            <span class="text-xs text-gray-500 invisible">—</span>
        </td>
        <td class="pr-0 pt-2 pb-1 text-right" style="width:120px;">
            <input type="number" step="1" min="0" max="100" value="100" data-base-percent="100" class="percent-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right invisible" disabled>
        </td>
        <td class="pl-0 pt-2 pb-1 text-right" style="width:120px;">
            <input type="number" step="1" min="0" max="65535" value="65535" data-base-end="65535" class="end-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right invisible" disabled>
        </td>
        <td class="pl-0 pr-2 pt-2 pb-1 text-right" style="width:150px;">
            <div class="flex flex-col items-end gap-1">
                <input type="number" step="0.001" min="0" max="2" value="" class="density-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-xs text-right invisible" disabled>
                <span class="density-coverage-indicator text-xs text-gray-500 text-right hidden" data-coverage-indicator></span>
            </div>
        </td>
    `;
    return row;
}

function updateChannelLegend(printer) {
    if (!elements.channelInfo) return;
    const legend = printer.channels.map((channel) => {
        const color = INK_COLORS[channel] || '#000000';
        return `<span class="inline-flex items-center mr-1"><span style="color:${color}; margin-right:0px;">■</span><strong>${channel}</strong></span>`;
    }).join('');
    elements.channelInfo.innerHTML = legend ? `Channels: ${legend}` : '';
    if (elements.printerDescription) {
        elements.printerDescription.textContent = '';
    }
}

function applyInitialValues(channelName, overrides, primaryChannel) {
    const override = overrides?.[channelName] || {};
    let percent;
    if (typeof override.percent === 'number' && Number.isFinite(override.percent)) {
        percent = InputValidator.clampPercent(override.percent);
    }
    let endValue;
    if (typeof override.endValue === 'number' && Number.isFinite(override.endValue)) {
        endValue = InputValidator.clampEnd(override.endValue);
    }

    if (percent === undefined && endValue !== undefined) {
        percent = InputValidator.clampPercent(InputValidator.computePercentFromEnd(endValue));
    }
    if (endValue === undefined && percent !== undefined) {
        endValue = InputValidator.computeEndFromPercent(percent);
    }

    if (percent === undefined) {
        percent = channelName === primaryChannel ? 100 : 0;
    }
    if (endValue === undefined) {
        endValue = InputValidator.computeEndFromPercent(percent);
    }

    return {
        percent: InputValidator.clampPercent(percent),
        endValue: InputValidator.clampEnd(endValue)
    };
}

export function registerChannelRowSetup(callback) {
    channelRowSetupCallback = typeof callback === 'function' ? callback : null;
}

function setupChannelRows(root) {
    if (!channelRowSetupCallback || !root) return;
    const rows = root.querySelectorAll('tr.channel-row[data-channel]');
    rows.forEach((row) => channelRowSetupCallback(row));
}

export function setPrinter(model, options = {}) {
    if (typeof document === 'undefined') return;
    const printerId = PRINTERS[model] ? model : 'P700P900';
    const printer = PRINTERS[printerId];
    const overrides = options.channelOverrides || {};

    if (options.updateSelect !== false && elements.printerSelect) {
        elements.printerSelect.value = printerId;
    }

    try {
        const stateManager = getStateManager();
        if (stateManager) {
            stateManager.setPrinter(printerId, overrides);
        }
    } catch (err) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[printer-manager] Unable to update state manager:', err);
        }
    }

    if (!elements.rows) {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.warn('[printer-manager] rows element not found');
        }
        return;
    }

    resetChannelRegistry();
    elements.rows.innerHTML = '';

    const fragment = document.createDocumentFragment();
    const primaryChannel = printer.channels.includes('MK')
        ? 'MK'
        : (printer.channels.includes('K') ? 'K' : printer.channels[0]);

    const lockDefaults = {};
    initializeChannelDensitiesForPrinter(printer.channels);

    printer.channels.forEach((channelName) => {
        const { percent, endValue } = applyInitialValues(channelName, overrides, primaryChannel);
        lockDefaults[channelName] = {
            percentLimit: percent,
            endValue
        };
        const densityState = getResolvedChannelDensity(channelName);
        const row = buildChannelRow(channelName, percent, endValue, densityState);
        fragment.appendChild(row);
        registerChannelRow(channelName, row);
    });

    fragment.appendChild(buildPlaceholderRow());
    elements.rows.appendChild(fragment);

    initializeChannelLocks(lockDefaults);
    applyOverrideDisplays(overrides);

    setupChannelRows(elements.rows);
    updateChannelLegend(printer);
    updateNoChannelsMessage();
    updateCompactChannelsList();

    printer.channels.forEach((channelName) => {
        try { updateProcessingDetail(channelName); } catch (err) { /* ignore */ }
    });

    try { updateSessionStatus(); } catch (err) { /* ignore */ }
    try { updateInkChart(); } catch (err) { /* ignore */ }
    try { updatePreview(); } catch (err) { /* ignore */ }
    try { updateFilename(); } catch (err) { /* ignore */ }
    try { updateIntentDropdownState(); } catch (err) { /* ignore */ }

    if (!options.silent) {
        const reason = options.reason === 'quadLoad'
            ? `Loaded ${options.filename || 'quad file'} - switched to ${printer.name}`
            : `Switched to ${printer.name}`;
        reportStatus(reason);
    }
}

export function initializePrinterUI() {
    const initialModel = elements.printerSelect?.value || 'P700P900';
    if (elements.printerSelect) {
        elements.printerSelect.value = initialModel;
    }
    setPrinter(initialModel, { updateSelect: false, silent: true, force: true });
}

function applyOverrideDisplays(overrides = {}) {
    if (!elements.rows || !overrides || typeof overrides !== 'object') {
        return;
    }
    Object.entries(overrides).forEach(([channelName, override]) => {
        const row = elements.rows.querySelector(`tr.channel-row[data-channel="${channelName}"]`);
        if (!row) return;
        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        if (!percentInput || !endInput) return;
        const endValue = InputValidator.clampEnd(
            Number.isFinite(override?.endValue) ? override.endValue : endInput.value
        );
        const percentValue = InputValidator.computePercentFromEnd(endValue);
        percentInput.value = formatPercentDisplay(percentValue);
        percentInput.setAttribute('data-base-percent', String(percentValue));
        endInput.value = String(endValue);
        endInput.setAttribute('data-base-end', String(endValue));
    });
}

export function syncPrinterForQuadData(quadData, options = {}) {
    if (!quadData || !Array.isArray(quadData.channels)) {
        return;
    }

    const overrides = {};
    quadData.channels.forEach((channelName, index) => {
        const endValue = InputValidator.clampEnd(quadData.values?.[index] ?? 0);
        overrides[channelName] = {
            endValue,
            percent: InputValidator.computePercentFromEnd(endValue)
        };
    });

    const matchingPrinter = findMatchingPrinter(quadData.channels, PRINTERS) || (elements.printerSelect?.value || 'P700P900');
    const silent = options.silent ?? false;

    setPrinter(matchingPrinter, {
        channelOverrides: overrides,
        preserveLoadedData: true,
        updateSelect: true,
        reason: 'quadLoad',
        filename: quadData.filename,
        silent
    });
    applyOverrideDisplays(overrides);
    const scheduleReapply = () => applyOverrideDisplays(overrides);
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            scheduleReapply();
            requestAnimationFrame(scheduleReapply);
        });
    } else {
        setTimeout(scheduleReapply, 0);
        setTimeout(scheduleReapply, 50);
    }
}
