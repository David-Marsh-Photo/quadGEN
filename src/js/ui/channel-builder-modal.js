// Channel Builder Wizard Modal UI
// Four-tab wizard: Reference K → Add Channel → Preview → Apply

import {
    computeChannelCalibration,
    computeDensityProfile,
    computeKReduction,
    validateMeasurements,
    validateTotalInk
} from '../core/channel-builder.js';

import {
    getSession,
    hasActiveSession,
    clearSession,
    startNewSession,
    setReferenceK,
    getReferenceK,
    hasReferenceK,
    setReferenceKFromMeasurements,
    loadReferenceKFromQuad,
    addSecondaryChannel,
    updateSecondaryChannelComputed,
    removeSecondaryChannel,
    getSecondaryChannels,
    setKReduction,
    getKReduction,
    getCurrentStep,
    setCurrentStep,
    getOptions,
    updateOptions,
    subscribeSessionChanges,
    getAllChannelsForValidation
} from '../core/channel-builder-state.js';

import { getLoadedQuadData } from '../core/state.js';
import { setSolverChannelDensity } from '../core/channel-densities.js';
import { addStatusMessage } from './status-messages.js';
import {
    createLstarRowMarkup,
    validateLstarRows,
    measuredPairsToChannelBuilderFormat
} from './lstar-entry-utils.js';

// ============================================================================
// Modal State
// ============================================================================

let modalElement = null;
let isInitialized = false;
let unsubscribe = null;

// Tab elements
const TAB_IDS = ['channelBuilderTabK', 'channelBuilderTabAdd', 'channelBuilderTabPreview', 'channelBuilderTabApply'];
const PANEL_IDS = ['channelBuilderPanelK', 'channelBuilderPanelAdd', 'channelBuilderPanelPreview', 'channelBuilderPanelApply'];

// Row entry configuration
const CB_MIN_ROWS = 3;
const CB_MAX_ROWS = 15;
const CB_DEFAULT_ROWS = 7;
const CB_TARGET_LSTAR_FLOOR = 20;

// Track current row counts for K and Channel panels
let kRowCount = CB_DEFAULT_ROWS;
let chRowCount = CB_DEFAULT_ROWS;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the channel builder modal
 */
export function initChannelBuilderModal() {
    if (isInitialized) return;

    modalElement = document.getElementById('channelBuilderModal');
    if (!modalElement) {
        console.warn('[ChannelBuilder] Modal element not found');
        return;
    }

    // Set up event listeners
    setupEventListeners();

    // Subscribe to state changes
    unsubscribe = subscribeSessionChanges(handleSessionChange);

    isInitialized = true;
    console.log('[ChannelBuilder] Modal initialized');
}

/**
 * Set up event listeners for the modal
 */
function setupEventListeners() {
    // Close button
    const closeBtn = document.getElementById('closeChannelBuilderModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    // Backdrop click to close
    modalElement?.addEventListener('click', (e) => {
        if (e.target === modalElement) {
            closeModal();
        }
    });

    // Tab navigation
    TAB_IDS.forEach((tabId, index) => {
        const tab = document.getElementById(tabId);
        if (tab) {
            tab.addEventListener('click', () => setCurrentStep(index));
        }
    });

    // Reference K panel
    setupReferenceKPanel();

    // Add Channel panel
    setupAddChannelPanel();

    // Preview panel
    setupPreviewPanel();

    // Apply panel
    setupApplyPanel();

    // Navigation buttons
    document.getElementById('channelBuilderNextBtn')?.addEventListener('click', handleNext);
    document.getElementById('channelBuilderPrevBtn')?.addEventListener('click', handlePrev);
    document.getElementById('channelBuilderClearBtn')?.addEventListener('click', handleClear);
}

// ============================================================================
// Modal Open/Close
// ============================================================================

/**
 * Open the channel builder modal
 */
export function openChannelBuilderModal() {
    if (!isInitialized) {
        initChannelBuilderModal();
    }

    if (!modalElement) {
        console.warn('[ChannelBuilder] Modal not available');
        return;
    }

    // Preserve options before potentially starting a new session
    const savedOptions = getOptions();

    // Initialize session if needed
    if (!hasActiveSession()) {
        startNewSession();
        // Restore UI preferences that should persist across sessions
        updateOptions({
            entryMode: savedOptions.entryMode,
            manualRowCount: savedOptions.manualRowCount
        });
    }

    // Restore row count from persisted state
    const options = getOptions();
    if (options.manualRowCount && options.manualRowCount >= CB_MIN_ROWS && options.manualRowCount <= CB_MAX_ROWS) {
        kRowCount = options.manualRowCount;
        chRowCount = options.manualRowCount;
    }

    // Update UI to current state
    updateUI();

    // Show modal
    modalElement.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

/**
 * Close the channel builder modal
 */
export function closeModal() {
    if (modalElement) {
        modalElement.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// ============================================================================
// Tab Navigation
// ============================================================================

/**
 * Update tabs to reflect current step
 */
function updateTabs() {
    const currentStep = getCurrentStep();

    TAB_IDS.forEach((tabId, index) => {
        const tab = document.getElementById(tabId);
        if (!tab) return;

        if (index === currentStep) {
            tab.classList.add('border-green-600', 'text-gray-800');
            tab.classList.remove('border-transparent', 'text-gray-500');
        } else {
            tab.classList.remove('border-green-600', 'text-gray-800');
            tab.classList.add('border-transparent', 'text-gray-500');
        }
    });

    PANEL_IDS.forEach((panelId, index) => {
        const panel = document.getElementById(panelId);
        if (!panel) return;

        if (index === currentStep) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    });

    // Update navigation buttons
    const prevBtn = document.getElementById('channelBuilderPrevBtn');
    const nextBtn = document.getElementById('channelBuilderNextBtn');

    if (prevBtn) {
        prevBtn.disabled = currentStep === 0;
        prevBtn.classList.toggle('opacity-50', currentStep === 0);
    }

    if (nextBtn) {
        if (currentStep === 3) {
            nextBtn.textContent = 'Apply & Close';
        } else {
            nextBtn.textContent = 'Next';
        }
    }
}

function handleNext() {
    const currentStep = getCurrentStep();
    if (currentStep === 3) {
        // Apply changes
        applyChanges();
        closeModal();
    } else {
        setCurrentStep(currentStep + 1);
    }
}

function handlePrev() {
    const currentStep = getCurrentStep();
    if (currentStep > 0) {
        setCurrentStep(currentStep - 1);
    }
}

function handleClear() {
    if (confirm('Clear all channel builder data and start fresh?')) {
        clearSession();
        startNewSession();
        updateUI();
        addStatusMessage('Channel builder session cleared');
    }
}

// ============================================================================
// Reference K Panel
// ============================================================================

function setupReferenceKPanel() {
    // Load from loaded quad
    const loadFromQuadBtn = document.getElementById('cbLoadKFromQuad');
    if (loadFromQuadBtn) {
        loadFromQuadBtn.addEventListener('click', () => {
            const quadData = getLoadedQuadData();
            if (!quadData?.curves?.K) {
                addStatusMessage('No K curve loaded. Load a .quad file first.');
                return;
            }
            loadReferenceKFromQuad(quadData);
            addStatusMessage('Reference K loaded from quad file');
            updateReferenceKDisplay();
        });
    }

    // Parse pasted L* data
    const parseKMeasurementsBtn = document.getElementById('cbParseKMeasurements');
    if (parseKMeasurementsBtn) {
        parseKMeasurementsBtn.addEventListener('click', parseKMeasurements);
    }

    // Set up entry mode toggle and row entry
    setupEntryModeListeners('K');
}

function parseKMeasurements() {
    const measurements = getMeasurementsFromEntry('K', 'cbKMeasurementsInput');

    if (!measurements) {
        // Validation failed in manual mode - error already shown
        return;
    }

    if (measurements.length === 0) {
        addStatusMessage('Enter L* measurements first');
        return;
    }

    if (measurements.length < 3) {
        addStatusMessage('Need at least 3 measurement points');
        return;
    }

    // Get K ink limit from input
    const inkLimitInput = document.getElementById('cbKInkLimit');
    const inkLimit = parseFloat(inkLimitInput?.value) || 33;

    if (inkLimit <= 0 || inkLimit > 100) {
        addStatusMessage('K ink limit must be between 1 and 100%');
        return;
    }

    // Use the new unified workflow: ink limit + measurements generates linear ramp
    const success = setReferenceKFromMeasurements(inkLimit, measurements, computeDensityProfile);

    if (success) {
        const refK = getReferenceK();
        addStatusMessage(`Reference K set: ink limit ${inkLimit}%, dMax = ${refK.dMax?.toFixed(3) || 'N/A'}`);
        updateReferenceKDisplay();
    } else {
        addStatusMessage('Failed to set reference K. Check measurements.');
    }
}

function updateReferenceKDisplay() {
    const refK = getReferenceK();
    const display = document.getElementById('cbKStatus');

    if (!display) return;

    // Sync ink limit input whenever refK has an inkLimit (regardless of dMax)
    const inkLimitInput = document.getElementById('cbKInkLimit');
    if (inkLimitInput && refK?.inkLimit != null) {
        inkLimitInput.value = refK.inkLimit;
    }

    if (refK && refK.dMax !== null) {
        const inkLimitStr = refK.inkLimit != null ? `${refK.inkLimit}%` : 'N/A';
        display.innerHTML = `
            <div class="p-3 bg-green-50 border border-green-200 rounded text-sm">
                <div class="font-semibold text-green-800">Reference K Set</div>
                <div class="text-green-700 mt-1">
                    Ink Limit: <span class="font-mono">${inkLimitStr}</span>
                    &nbsp;|&nbsp;
                    dMax: <span class="font-mono">${refK.dMax.toFixed(3)}</span>
                    &nbsp;|&nbsp;
                    Points: ${refK.measurements?.length || 0}
                    ${refK.curve ? ' | Linear ramp generated' : ''}
                </div>
            </div>
        `;
    } else if (refK?.curve) {
        const inkLimitStr = refK.inkLimit != null ? `${refK.inkLimit}%` : 'N/A';
        display.innerHTML = `
            <div class="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                <div class="font-semibold text-yellow-800">K Curve Imported</div>
                <div class="text-yellow-700 mt-1">
                    Ink Limit: ${inkLimitStr}
                    &nbsp;|&nbsp;
                    Enter L* measurements to compute dMax
                </div>
            </div>
        `;
    } else {
        display.innerHTML = `
            <div class="p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
                No reference K set. Enter ink limit and L* measurements above.
            </div>
        `;
    }
}

// ============================================================================
// Add Channel Panel
// ============================================================================

function setupAddChannelPanel() {
    // Channel select
    const channelSelect = document.getElementById('cbChannelSelect');
    if (channelSelect) {
        // Populate with available channels (excluding K)
        const channels = ['C', 'M', 'Y', 'LC', 'LM', 'LK', 'LLK', 'OR', 'GR', 'V'];
        channelSelect.innerHTML = channels.map(ch =>
            `<option value="${ch}">${ch}</option>`
        ).join('');
    }

    // Add channel button
    const addBtn = document.getElementById('cbAddChannelBtn');
    if (addBtn) {
        addBtn.addEventListener('click', handleAddChannel);
    }

    // Set up entry mode toggle and row entry
    setupEntryModeListeners('Ch');
}

function handleAddChannel() {
    const channelSelect = document.getElementById('cbChannelSelect');
    const inkLimitInput = document.getElementById('cbInkLimit');

    if (!channelSelect || !inkLimitInput) return;

    const channelName = channelSelect.value;
    const inkLimit = parseFloat(inkLimitInput.value) || 100;

    const measurements = getMeasurementsFromEntry('Ch', 'cbChannelMeasurementsInput');

    if (!measurements) {
        // Validation failed in manual mode - error already shown
        return;
    }

    if (measurements.length === 0) {
        addStatusMessage('Enter L* measurements for the channel');
        return;
    }

    // Validate
    const validation = validateMeasurements(measurements);
    if (!validation.valid) {
        addStatusMessage('Validation errors: ' + validation.errors.join('; '));
        return;
    }

    if (validation.warnings.length > 0) {
        console.warn('[ChannelBuilder] Warnings:', validation.warnings);
    }

    // Get reference K
    const refK = getReferenceK();
    if (!refK || refK.dMax === null) {
        addStatusMessage('Set reference K first');
        return;
    }

    // Compute calibration
    const options = getOptions();
    const result = computeChannelCalibration(refK, {
        name: channelName,
        inkLimit,
        measurements
    }, {
        ...options,
        existingSecondaries: getSecondaryChannels().map(ch => ({
            curve: ch.computed?.curve,
            endPercent: ch.computed?.end
        })).filter(ch => ch.curve)
    });

    // Add to session
    addSecondaryChannel({
        name: channelName,
        inkLimit,
        measurements,
        computed: {
            dMax: result.dMax,
            apex: result.recommendedApex,
            widthFactor: result.recommendedWidth,
            end: result.recommendedEnd,
            role: result.role,
            curve: result.curve
        }
    });

    // Update K reduction
    if (refK.curve) {
        const secondaries = getSecondaryChannels().map(ch => ({
            curve: ch.computed?.curve,
            endPercent: ch.computed?.end
        })).filter(ch => ch.curve);

        // Find midtone peak for K reduction
        let midtonePeak = 50;
        const midtone = getSecondaryChannels().find(ch => ch.computed?.role === 'midtone');
        if (midtone) {
            midtonePeak = midtone.computed.apex;
        }

        const kReduction = computeKReduction(secondaries, refK.curve, midtonePeak, options);
        setKReduction({
            curve: kReduction.kCurve,
            startIndex: kReduction.startIndex,
            midtonePeakPercent: midtonePeak
        });
    }

    addStatusMessage(`Added ${channelName}: apex ${result.recommendedApex.toFixed(1)}%, end ${result.recommendedEnd.toFixed(1)}%`);

    // Clear input - clear both paste textarea and re-render row entry
    const textarea = document.getElementById('cbChannelMeasurementsInput');
    if (textarea) textarea.value = '';
    renderRowEntryTable('Ch');

    updateAddChannelDisplay();
}

function updateAddChannelDisplay() {
    const listEl = document.getElementById('cbChannelList');
    if (!listEl) return;

    const channels = getSecondaryChannels();

    if (channels.length === 0) {
        listEl.innerHTML = '<div class="text-gray-500 text-sm">No channels added yet</div>';
        return;
    }

    listEl.innerHTML = channels.map(ch => `
        <div class="flex items-center justify-between p-2 bg-gray-50 rounded border" data-channel="${ch.name}">
            <div>
                <span class="font-semibold">${ch.name}</span>
                <span class="text-gray-500 text-sm ml-2">
                    ${ch.computed ? `Apex: ${ch.computed.apex.toFixed(1)}% | End: ${ch.computed.end.toFixed(1)}% | ${ch.computed.role}` : 'Not computed'}
                </span>
            </div>
            <button class="text-red-500 hover:text-red-700 text-sm cb-remove-channel" data-channel="${ch.name}">
                Remove
            </button>
        </div>
    `).join('');

    // Add remove handlers
    listEl.querySelectorAll('.cb-remove-channel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const name = e.target.dataset.channel;
            removeSecondaryChannel(name);

            // Recompute K reduction with remaining channels
            const refK = getReferenceK();
            const remainingChannels = getSecondaryChannels();
            if (refK?.curve && remainingChannels.length > 0) {
                const secondaries = remainingChannels.map(ch => ({
                    curve: ch.computed?.curve,
                    endPercent: ch.computed?.end
                })).filter(ch => ch.curve);

                // Find midtone peak for K reduction
                let midtonePeak = 50;
                const midtone = remainingChannels.find(ch => ch.computed?.role === 'midtone');
                if (midtone) {
                    midtonePeak = midtone.computed.apex;
                }

                const options = getOptions();
                const kReduction = computeKReduction(secondaries, refK.curve, midtonePeak, options);
                setKReduction({
                    curve: kReduction.kCurve,
                    startIndex: kReduction.startIndex,
                    midtonePeakPercent: midtonePeak
                });
            } else {
                // Clear K reduction if no channels remain
                setKReduction(null);
            }

            updateAddChannelDisplay();
            addStatusMessage(`Removed ${name}`);
        });
    });
}

// ============================================================================
// Preview Panel
// ============================================================================

function setupPreviewPanel() {
    // Adjustment sliders would go here
    // For now, just show computed values
}

function updatePreviewDisplay() {
    const container = document.getElementById('cbPreviewContent');
    if (!container) return;

    const channels = getSecondaryChannels();
    const kReduction = getKReduction();
    const refK = getReferenceK();

    let html = '<div class="space-y-4">';

    // K reduction info
    if (kReduction) {
        const startPercent = (kReduction.startIndex / 255 * 100).toFixed(1);
        html += `
            <div class="p-3 bg-gray-100 rounded">
                <div class="font-semibold">K Carve-Out</div>
                <div class="text-sm text-gray-600 mt-1">
                    K starts at: ${startPercent}% | Midtone anchor: ${kReduction.midtonePeakPercent.toFixed(1)}%
                </div>
            </div>
        `;
    }

    // Channel summary
    html += '<div class="font-semibold">Channel Summary</div>';

    if (refK) {
        html += `
            <div class="p-2 bg-gray-50 rounded border-l-4 border-gray-400">
                <span class="font-semibold">K</span>
                <span class="text-gray-500 text-sm ml-2">
                    Reference dMax: ${refK.dMax?.toFixed(3) || 'N/A'}
                    ${kReduction ? ' | Carved out' : ''}
                </span>
            </div>
        `;
    }

    channels.forEach(ch => {
        const roleColor = ch.computed?.role === 'highlight' ? 'blue' :
                          ch.computed?.role === 'midtone' ? 'green' : 'orange';
        html += `
            <div class="p-2 bg-gray-50 rounded border-l-4 border-${roleColor}-400">
                <span class="font-semibold">${ch.name}</span>
                <span class="text-gray-500 text-sm ml-2">
                    ${ch.computed ? `Apex: ${ch.computed.apex.toFixed(1)}% | End: ${ch.computed.end.toFixed(1)}% | ${ch.computed.role}` : 'Not computed'}
                </span>
            </div>
        `;
    });

    // Total ink validation
    const allChannels = getAllChannelsForValidation();
    if (allChannels.length > 0) {
        const warnings = validateTotalInk(allChannels, 50, 100);
        if (warnings.length > 0) {
            html += `
                <div class="p-3 bg-yellow-50 border border-yellow-200 rounded mt-4">
                    <div class="font-semibold text-yellow-800">Total Ink Warnings</div>
                    <ul class="text-sm text-yellow-700 mt-1 list-disc list-inside">
                        ${warnings.slice(0, 5).map(w => `<li>${w}</li>`).join('')}
                        ${warnings.length > 5 ? `<li>...and ${warnings.length - 5} more</li>` : ''}
                    </ul>
                </div>
            `;
        } else {
            html += `
                <div class="p-3 bg-green-50 border border-green-200 rounded mt-4">
                    <div class="text-green-700 text-sm">Total ink within limits</div>
                </div>
            `;
        }
    }

    html += '</div>';
    container.innerHTML = html;
}

// ============================================================================
// Apply Panel
// ============================================================================

function setupApplyPanel() {
    // Summary before applying
}

function updateApplyDisplay() {
    const container = document.getElementById('cbApplyContent');
    if (!container) return;

    const channels = getSecondaryChannels();
    const kReduction = getKReduction();

    let html = '<div class="space-y-4">';

    html += `
        <div class="p-4 bg-gray-50 rounded border">
            <div class="font-semibold mb-2">Changes to Apply</div>
            <ul class="text-sm text-gray-700 space-y-1">
    `;

    if (kReduction) {
        html += '<li>K curve will be carved out where secondaries provide coverage</li>';
    }

    channels.forEach(ch => {
        if (ch.computed?.curve) {
            html += `<li>${ch.name}: Bell curve at ${ch.computed.apex.toFixed(1)}%, End ${ch.computed.end.toFixed(1)}%</li>`;
        }
    });

    html += `
            </ul>
        </div>
        <div class="text-sm text-gray-500">
            Click "Apply & Close" to apply these changes to the current quad.
        </div>
    `;

    html += '</div>';
    container.innerHTML = html;
}

// ============================================================================
// Apply Changes to Quad
// ============================================================================

function applyChanges() {
    const quadData = getLoadedQuadData();
    if (!quadData) {
        addStatusMessage('No quad data loaded');
        return;
    }

    const channels = getSecondaryChannels();
    const kReduction = getKReduction();

    // Apply K reduction
    if (kReduction?.curve && quadData.curves.K) {
        quadData.curves.K = kReduction.curve.slice();
        // Update baseline if needed
        if (quadData.baselineEnd) {
            quadData.baselineEnd.K = Math.max(...kReduction.curve);
        }
    }

    // Apply secondary channel curves
    channels.forEach(ch => {
        if (ch.computed?.curve) {
            quadData.curves[ch.name] = ch.computed.curve.slice();
            if (quadData.baselineEnd) {
                quadData.baselineEnd[ch.name] = Math.max(...ch.computed.curve);
            }
        }
    });

    // Push computed dMax values to channel density store
    // This enables accurate light-blocking overlay visualization
    const refK = getReferenceK();
    if (refK?.dMax != null) {
        setSolverChannelDensity('K', refK.dMax);
    }
    channels.forEach(ch => {
        if (ch.computed?.dMax != null) {
            setSolverChannelDensity(ch.name, ch.computed.dMax);
        }
    });

    // Trigger chart update
    if (typeof window.updateChartFromData === 'function') {
        window.updateChartFromData();
    }

    addStatusMessage(`Applied ${channels.length} channel${channels.length !== 1 ? 's' : ''} + K carve-out`);
}

// ============================================================================
// State Change Handler
// ============================================================================

function handleSessionChange(session) {
    updateUI();
}

function updateUI() {
    updateTabs();
    updateReferenceKDisplay();
    updateAddChannelDisplay();
    updatePreviewDisplay();
    updateApplyDisplay();
}

// ============================================================================
// Entry Mode Handling
// ============================================================================

/**
 * Toggle entry mode between paste and manual for a specific panel
 * @param {string} prefix - 'K' or 'Ch'
 * @param {'paste'|'manual'} mode - Entry mode
 */
function toggleEntryMode(prefix, mode) {
    const pasteEl = document.getElementById(`cb${prefix}EntryPaste`);
    const manualEl = document.getElementById(`cb${prefix}EntryManual`);
    const pasteBtn = document.getElementById(`cb${prefix}EntryModePaste`);
    const manualBtn = document.getElementById(`cb${prefix}EntryModeManual`);

    if (mode === 'paste') {
        pasteEl?.classList.remove('hidden');
        manualEl?.classList.add('hidden');
        pasteBtn?.classList.add('border-green-600', 'text-gray-800');
        pasteBtn?.classList.remove('border-transparent', 'text-gray-500');
        manualBtn?.classList.remove('border-green-600', 'text-gray-800');
        manualBtn?.classList.add('border-transparent', 'text-gray-500');
    } else {
        pasteEl?.classList.add('hidden');
        manualEl?.classList.remove('hidden');
        pasteBtn?.classList.remove('border-green-600', 'text-gray-800');
        pasteBtn?.classList.add('border-transparent', 'text-gray-500');
        manualBtn?.classList.add('border-green-600', 'text-gray-800');
        manualBtn?.classList.remove('border-transparent', 'text-gray-500');
        // Render rows if switching to manual mode
        renderRowEntryTable(prefix);
    }

    // Update options state
    updateOptions({ entryMode: mode });
}

/**
 * Render row entry table for a panel
 * @param {string} prefix - 'K' or 'Ch'
 */
function renderRowEntryTable(prefix) {
    const container = document.getElementById(`cb${prefix}EntryRows`);
    const countEl = document.getElementById(`cb${prefix}RowCount`);
    if (!container) return;

    const rowCount = prefix === 'K' ? kRowCount : chRowCount;
    if (countEl) countEl.textContent = rowCount;

    container.innerHTML = '';
    for (let i = 0; i < rowCount; i++) {
        container.insertAdjacentHTML('beforeend', createLstarRowMarkup(i, {
            total: rowCount,
            targetLstarFloor: CB_TARGET_LSTAR_FLOOR,
            compact: true,
            xInputClass: `cb${prefix}-measured-x`,
            lInputClass: `cb${prefix}-lstar-input`
        }));
    }

    // Add input listeners for validation
    container.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => validateRowEntry(prefix));
    });

    validateRowEntry(prefix);
}

/**
 * Validate row entry inputs and update UI
 * @param {string} prefix - 'K' or 'Ch'
 */
function validateRowEntry(prefix) {
    const container = document.getElementById(`cb${prefix}EntryRows`);
    const validationEl = document.getElementById(`cb${prefix}Validation`);
    if (!container) return;

    const result = validateLstarRows(container, {
        minRows: CB_MIN_ROWS,
        targetLstarFloor: CB_TARGET_LSTAR_FLOOR,
        xInputClass: `cb${prefix}-measured-x`,
        lInputClass: `cb${prefix}-lstar-input`
    });

    if (validationEl) {
        if (!result.valid && result.errors.length > 0) {
            validationEl.textContent = result.errors[0];
            validationEl.classList.remove('hidden');
        } else {
            validationEl.classList.add('hidden');
        }
    }

    return result;
}

/**
 * Add a row to the entry table
 * @param {string} prefix - 'K' or 'Ch'
 */
function addEntryRow(prefix) {
    if (prefix === 'K') {
        if (kRowCount >= CB_MAX_ROWS) return;
        kRowCount++;
    } else {
        if (chRowCount >= CB_MAX_ROWS) return;
        chRowCount++;
    }
    renderRowEntryTable(prefix);
    updateOptions({ manualRowCount: prefix === 'K' ? kRowCount : chRowCount });
}

/**
 * Remove a row from the entry table
 * @param {string} prefix - 'K' or 'Ch'
 */
function removeEntryRow(prefix) {
    if (prefix === 'K') {
        if (kRowCount <= CB_MIN_ROWS) return;
        kRowCount--;
    } else {
        if (chRowCount <= CB_MIN_ROWS) return;
        chRowCount--;
    }
    renderRowEntryTable(prefix);
    updateOptions({ manualRowCount: prefix === 'K' ? kRowCount : chRowCount });
}

/**
 * Get measurements from current entry mode
 * @param {string} prefix - 'K' or 'Ch'
 * @param {string} textareaId - ID of textarea for paste mode
 * @returns {Array|null} Measurements array or null if validation fails
 */
function getMeasurementsFromEntry(prefix, textareaId) {
    // Check which mode is actually active by looking at the UI state
    const manualEl = document.getElementById(`cb${prefix}EntryManual`);
    const isManualMode = manualEl && !manualEl.classList.contains('hidden');

    if (!isManualMode) {
        // Paste mode
        const textarea = document.getElementById(textareaId);
        return parseMeasurementText(textarea?.value || '');
    }

    // Manual row entry mode
    const validation = validateRowEntry(prefix);
    if (!validation || !validation.valid) {
        return null;
    }
    return measuredPairsToChannelBuilderFormat(validation.measuredPairs);
}

/**
 * Set up entry mode event listeners for a panel
 * @param {string} prefix - 'K' or 'Ch'
 */
function setupEntryModeListeners(prefix) {
    const pasteBtn = document.getElementById(`cb${prefix}EntryModePaste`);
    const manualBtn = document.getElementById(`cb${prefix}EntryModeManual`);
    const addRowBtn = document.getElementById(`cb${prefix}AddRow`);
    const removeRowBtn = document.getElementById(`cb${prefix}RemoveRow`);

    pasteBtn?.addEventListener('click', () => toggleEntryMode(prefix, 'paste'));
    manualBtn?.addEventListener('click', () => toggleEntryMode(prefix, 'manual'));
    addRowBtn?.addEventListener('click', () => addEntryRow(prefix));
    removeRowBtn?.addEventListener('click', () => removeEntryRow(prefix));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse measurement text (tab or comma separated)
 * Expects format: input%, L* (or just L* values with auto % assignment)
 */
function parseMeasurementText(text) {
    const lines = text.trim().split(/[\r\n]+/);
    const measurements = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;

        // Try to parse as "input, lstar" or "input\tlstar"
        const parts = line.split(/[,\t]+/).map(p => p.trim());

        if (parts.length >= 2) {
            const input = parseFloat(parts[0]);
            const lstar = parseFloat(parts[1]);
            if (!isNaN(input) && !isNaN(lstar)) {
                measurements.push({ input, lstar });
                continue;
            }
        }

        // Try single value (just L*)
        const lstar = parseFloat(parts[0]);
        if (!isNaN(lstar)) {
            // Auto-assign input based on line position
            const input = (i / Math.max(1, lines.length - 1)) * 100;
            measurements.push({ input, lstar });
        }
    }

    // Sort by input
    measurements.sort((a, b) => a.input - b.input);

    return measurements;
}

// ============================================================================
// Exports
// ============================================================================

export default {
    initChannelBuilderModal,
    openChannelBuilderModal,
    closeModal
};

// Global access for toolbar button
if (typeof window !== 'undefined') {
    window.openChannelBuilderModal = openChannelBuilderModal;
}
