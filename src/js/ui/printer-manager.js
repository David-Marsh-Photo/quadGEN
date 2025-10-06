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

let channelRowSetupCallback = null;

function reportStatus(message) {
    if (!message) return;
    showStatus(message);
}

function buildChannelRow(channelName, percent, endValue) {
    const row = document.createElement('tr');
    row.className = 'border-t border-gray-200 channel-row';
    row.setAttribute('data-channel', channelName);

    row.innerHTML = `
        <td class="p-0 text-center" style="width:0;"></td>
        <td class="px-1 pt-2 pb-1 font-medium align-middle text-left" style="width: 100px;">
            <span class="flex items-center gap-2 w-full">
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
        <td class="pr-0 pt-2 pb-1 text-right align-top" style="width:120px;">
            <div class="flex flex-col items-end gap-0.5">
                <input type="number" step="1" min="0" max="100" value="${percent}" class="percent-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right">
                <div class="text-[10px] text-slate-500 leading-tight hidden" data-effective-percent></div>
            </div>
        </td>
        <td class="pl-0 pt-2 pb-1 text-right align-top" style="width:120px;">
            <div class="flex flex-col items-end gap-0.5">
                <input type="number" step="1" min="0" max="65535" value="${endValue}" class="end-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right">
                <div class="text-[10px] text-slate-500 leading-tight hidden" data-effective-end></div>
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
            <div class="flex flex-col items-end gap-0.5">
                <input type="number" step="1" min="0" max="100" value="100" class="percent-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right invisible" disabled>
                <div class="text-[10px] text-slate-500 leading-tight hidden" data-effective-percent></div>
            </div>
        </td>
        <td class="pl-0 pt-2 pb-1 text-right" style="width:120px;">
            <div class="flex flex-col items-end gap-0.5">
                <input type="number" step="1" min="0" max="65535" value="65535" class="end-input w-20 m-0 rounded-lg border border-gray-300 px-2 py-1 text-right invisible" disabled>
                <div class="text-[10px] text-slate-500 leading-tight hidden" data-effective-end></div>
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
            stateManager.setPrinter(printerId);
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

    printer.channels.forEach((channelName) => {
        const { percent, endValue } = applyInitialValues(channelName, overrides, primaryChannel);
        const row = buildChannelRow(channelName, percent, endValue);
        fragment.appendChild(row);
        registerChannelRow(channelName, row);
    });

    fragment.appendChild(buildPlaceholderRow());
    elements.rows.appendChild(fragment);

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
}
