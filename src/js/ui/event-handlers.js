// quadGEN UI Event Handlers
// Centralized event handler management for UI interactions

import { elements, getCurrentPrinter, setLoadedQuadData, getLoadedQuadData, ensureLoadedQuadData, getAppState, updateAppState, TOTAL } from '../core/state.js';
import { getStateManager } from '../core/state-manager.js';
import { sanitizeFilename, debounce, formatScalePercent } from './ui-utils.js';
import { generateFilename, downloadFile, readFileAsText } from '../files/file-operations.js';
import { InputValidator } from '../core/validation.js';
import { parseQuadFile, parseLinearizationFile } from '../parsers/file-parsers.js';
import { updateInkChart, stepChartZoom } from './chart-manager.js';
import { getCurrentScale, updateScaleBaselineForChannel as updateScaleBaselineForChannelCore, validateScalingStateSync } from '../core/scaling-utils.js';
import { SCALING_STATE_FLAG_EVENT } from '../core/scaling-constants.js';
import scalingCoordinator from '../core/scaling-coordinator.js';
import { updateCompactChannelsList, updateChannelCompactState, updateNoChannelsMessage } from './compact-channels.js';
import { registerChannelRow, getChannelRow } from './channel-registry.js';
import { updateProcessingDetail, updateSessionStatus } from './graph-status.js';
import { LinearizationState, normalizeLinearizationEntry, getEditedDisplayName, getBasePointCountLabel } from '../data/linearization-utils.js';
import { ControlPoints, extractAdaptiveKeyPointsFromValues, KP_SIMPLIFY, isSmartCurve, rescaleSmartCurveForInkLimit } from '../curves/smart-curves.js';
import { isEditModeEnabled, setEditMode, populateChannelDropdown, refreshSmartCurvesFromMeasurements, reinitializeChannelSmartCurves, persistSmartPoints, setGlobalBakedState } from './edit-mode.js';
import { getTargetRelAt } from '../data/lab-parser.js';
import { postLinearizationSummary } from './labtech-summaries.js';
import { updatePreview } from './quad-preview.js';
import { getPreset, canApplyIntentRemap, updateIntentDropdownState } from './intent-system.js';
import { getHistoryManager } from '../core/history-manager.js';
import { clamp01, createPCHIPSpline } from '../math/interpolation.js';
import {
    updateRevertButtonsState,
    computeGlobalRevertState,
    resetSmartPointsForChannels,
    resetChannelSmartPointsToMeasurement
} from './revert-controls.js';
import { showStatus } from './status-service.js';
import { initializeHelpSystem } from './help-system.js';
import { setPrinter, registerChannelRowSetup, syncPrinterForQuadData } from './printer-manager.js';
import { make256 } from '../core/processing-pipeline.js';
import { getLabNormalizationMode, setLabNormalizationMode, isDensityNormalizationEnabled, subscribeLabNormalizationMode, LAB_NORMALIZATION_MODES } from '../core/lab-settings.js';
import { rebuildLabSamplesFromOriginal } from '../data/lab-parser.js';
import { isLabLinearizationData } from '../data/lab-legacy-bypass.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = typeof document !== 'undefined';

let unsubscribeScalingStateInput = null;
let unsubscribeLabNormalizationMode = null;
let scalingStateFlagListenerAttached = false;
let lastScalingStateValue = null;
let scaleHandlerRetryCount = 0;
const SCALE_HANDLER_MAX_RETRIES = 5;

function syncScaleInputFromStateValue(value) {
    if (!elements.scaleAllInput) return;

    const numeric = Number(value);
    const fallback = getCurrentScale();
    const target = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    const formatted = formatScalePercent(target);

    if (elements.scaleAllInput.value !== formatted) {
        elements.scaleAllInput.value = formatted;
    }

    lastScalingStateValue = target;
}

function configureScalingStateSubscription() {
    if (!elements.scaleAllInput) {
        return;
    }

    if (unsubscribeScalingStateInput) {
        try {
            unsubscribeScalingStateInput();
        } catch (err) {
            console.warn('Failed to remove scaling state subscription', err);
        }
        unsubscribeScalingStateInput = null;
        if (isBrowser) {
            globalScope.__scalingStateSubscribed = false;
        }
    }

    const enabled = !!(isBrowser && globalScope.__USE_SCALING_STATE);
    if (!enabled) {
        lastScalingStateValue = null;
        syncScaleInputFromStateValue(getCurrentScale());
        return;
    }

    let stateManager;
    try {
        stateManager = getStateManager();
    } catch (error) {
        console.warn('Scaling state manager unavailable:', error);
        return;
    }

    if (!stateManager || typeof stateManager.subscribe !== 'function') {
        return;
    }

    try {
        syncScaleInputFromStateValue(stateManager.get('scaling.globalPercent'));
    } catch (readError) {
        console.warn('Unable to read scaling.globalPercent from state', readError);
    }

    unsubscribeScalingStateInput = stateManager.subscribe(['scaling.globalPercent'], (_, newValue) => {
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('🔁 [SCALE STATE] scaling.globalPercent changed', newValue);
        }
        if (!elements.scaleAllInput) return;

        if (lastScalingStateValue != null) {
            const numeric = Number(newValue);
            if (Number.isFinite(numeric) && Math.abs(numeric - lastScalingStateValue) < 1e-6) {
                return;
            }
        }

        syncScaleInputFromStateValue(newValue);
    });

    if (isBrowser) {
        globalScope.__scalingStateSubscribed = true;
    }

    try {
        validateScalingStateSync({ reason: 'subscription:resync', throwOnMismatch: false });
    } catch (validationError) {
        console.warn('Scaling state validation failed after subscription resync', validationError);
    }
}

function setRevertInProgress(active) {
    if (!isBrowser) return;
    globalScope.__quadRevertInProgress = !!active;
    const root = document.body;
    if (root) {
        root.classList.toggle('revert-in-progress', !!active);
    }
}

function getPerChannelMaps() {
    const appState = getAppState();
    return {
        linearization: { ...(appState.perChannelLinearization || {}) },
        enabled: { ...(appState.perChannelEnabled || {}) },
        filenames: { ...(appState.perChannelFilenames || {}) }
    };
}

function syncPerChannelAppState(channelName, data) {
    try {
        const next = { ...(getAppState().perChannelLinearization || {}) };
        if (data) next[channelName] = data;
        else delete next[channelName];
        updateAppState({ perChannelLinearization: next });
    } catch (err) {
        console.warn('Unable to sync per-channel state', err);
    }
}

const debouncedPreviewUpdate = debounce(() => {
    updatePreview();
}, 300);

function syncLabNormalizationCheckboxes(mode = getLabNormalizationMode()) {
    const isDensity = mode === LAB_NORMALIZATION_MODES.DENSITY;
    if (elements.labDensityToggle) {
        elements.labDensityToggle.checked = isDensity;
        elements.labDensityToggle.setAttribute('aria-checked', String(isDensity));
    }
    if (elements.manualLstarDensityToggle) {
        elements.manualLstarDensityToggle.checked = isDensity;
        elements.manualLstarDensityToggle.setAttribute('aria-checked', String(isDensity));
    }
}

function rebuildLabEntryForNormalization(entry) {
    if (!entry || !Array.isArray(entry.originalData) || entry.originalData.length < 2) {
        return entry;
    }

    const mode = getLabNormalizationMode();
    const baseSamples = rebuildLabSamplesFromOriginal(entry.originalData, {
        normalizationMode: mode,
        skipDefaultSmoothing: true
    }) || entry.baseSamples || entry.samples;

    const smoothingPercent = Number(entry.previewSmoothingPercent);
    const hasSmoothing = Number.isFinite(smoothingPercent) && smoothingPercent > 0;
    const widen = hasSmoothing ? 1 + (smoothingPercent / 100) : 1;
    const previewSamples = hasSmoothing
        ? rebuildLabSamplesFromOriginal(entry.originalData, {
            normalizationMode: mode,
            widenFactor: widen
        }) || baseSamples.slice()
        : baseSamples.slice();

    const updated = {
        ...entry,
        samples: baseSamples.slice(),
        baseSamples: baseSamples.slice(),
        rawSamples: baseSamples.slice(),
        previewSamples: previewSamples.slice()
    };

    if (!Array.isArray(updated.originalSamples)) {
        updated.originalSamples = previewSamples.slice();
    }

    return updated;
}

function refreshLinearizationDataForNormalization() {
    const mode = getLabNormalizationMode();
    const printer = getCurrentPrinter();
    const channels = printer?.channels || [];
    const updatedChannels = [];

    const globalData = LinearizationState.getGlobalData();
    if (globalData && isLabLinearizationData(globalData)) {
        const previousBakedMeta = typeof LinearizationState.getGlobalBakedMeta === 'function'
            ? LinearizationState.getGlobalBakedMeta()
            : null;
        const updatedEntry = rebuildLabEntryForNormalization(globalData);
        LinearizationState.setGlobalData(updatedEntry, LinearizationState.globalApplied);
        if (previousBakedMeta && typeof LinearizationState.setGlobalBakedMeta === 'function') {
            LinearizationState.setGlobalBakedMeta(previousBakedMeta);
        }
        updateAppState({
            linearizationData: updatedEntry,
            linearizationApplied: LinearizationState.globalApplied
        });

        if (elements.globalLinearizationBtn) {
            const countLabel = getBasePointCountLabel(updatedEntry);
            elements.globalLinearizationBtn.setAttribute('data-tooltip', `Loaded: ${updatedEntry.filename || 'LAB Data'} (${countLabel})`);
        }
        if (elements.globalLinearizationDetails) {
            const countLabel = getBasePointCountLabel(updatedEntry);
            const formatToken = String(updatedEntry.format || '')
                .split(' ')
                .filter(Boolean)
                .shift() || '';
            const formatLabel = formatToken ? formatToken.toUpperCase() : '';
            const detailParts = [];
            if (countLabel) detailParts.push(countLabel);
            if (formatLabel) detailParts.push(`(${formatLabel})`);
            elements.globalLinearizationDetails.textContent = detailParts.length
                ? ` - ${detailParts.join(' ')}`
                : '';
        }

        updatedChannels.push(...channels);
    }

    channels.forEach((channelName) => {
        const entry = LinearizationState.getPerChannelData(channelName);
        if (entry && isLabLinearizationData(entry)) {
            const updatedEntry = rebuildLabEntryForNormalization(entry);
            const enabled = LinearizationState.isPerChannelEnabled(channelName);
            LinearizationState.setPerChannelData(channelName, updatedEntry, enabled);
            syncPerChannelAppState(channelName, updatedEntry);
            if (!updatedChannels.includes(channelName)) {
                updatedChannels.push(channelName);
            }
        }
    });

    if (updatedChannels.length > 0) {
        if (typeof LinearizationState.setGlobalBakedMeta === 'function') {
            try {
                LinearizationState.setGlobalBakedMeta(null);
            } catch (err) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[LabNormalization] Failed to clear global baked meta:', err);
                }
            }
        }

        try {
            const loadedData = getLoadedQuadData?.();
            if (loadedData && loadedData.keyPointsMeta) {
                updatedChannels.forEach((channelName) => {
                    const meta = loadedData.keyPointsMeta[channelName];
                    if (meta && meta.bakedGlobal) {
                        delete meta.bakedGlobal;
                    }
                });
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to scrub baked metadata:', err);
            }
        }

        rebaseChannelsToCorrectedCurves(updatedChannels, {
            source: 'labNormalizationChange',
            useOriginalBaseline: true
        });
        updateInkChart();
        updateSessionStatus();
        try {
            postLinearizationSummary();
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[LabNormalization] Failed to post summary:', err);
            }
        }
    }

    const isDensity = mode === LAB_NORMALIZATION_MODES.DENSITY;
    const modeLabel = isDensity ? 'log-density (optical)' : 'perceptual L*';
    const extraNote = isDensity ? ' — .quad exports note optical-density mode.' : '';
    showStatus(`Linearization normalization set to ${modeLabel}${extraNote}`);
}

function initializeLabNormalizationHandlers() {
    syncLabNormalizationCheckboxes();

    if (elements.labDensityToggle) {
        elements.labDensityToggle.addEventListener('change', (event) => {
            const mode = event.target.checked ? LAB_NORMALIZATION_MODES.DENSITY : LAB_NORMALIZATION_MODES.LSTAR;
            setLabNormalizationMode(mode);
        });
    }

    if (elements.manualLstarDensityToggle) {
        elements.manualLstarDensityToggle.addEventListener('change', (event) => {
            const mode = event.target.checked ? LAB_NORMALIZATION_MODES.DENSITY : LAB_NORMALIZATION_MODES.LSTAR;
            setLabNormalizationMode(mode);
        });
    }

    if (unsubscribeLabNormalizationMode) {
        unsubscribeLabNormalizationMode();
        unsubscribeLabNormalizationMode = null;
    }

    unsubscribeLabNormalizationMode = subscribeLabNormalizationMode((mode) => {
        syncLabNormalizationCheckboxes(mode);
        refreshLinearizationDataForNormalization();
    });
}

/**
 * Initialize all UI event handlers
 * Should be called after DOM is ready and elements are initialized
 */
export function initializeEventHandlers() {
    console.log('🎛️ Initializing UI event handlers...');

    if (typeof window !== 'undefined') {
        scalingCoordinator.setEnabled(!!window.__USE_SCALING_COORDINATOR);
    }

    // Core UI handlers
    initializeUndoRedoHandlers();
    initializeDownloadHandlers();
    initializeKeyboardShortcuts();
    initializePrinterHandlers();
    initializeFilenameHandlers();
    initializeScaleHandlers();
    initializeChartHandlers();
    initializeChannelRowHandlers();
    initializeFileHandlers();
    initializeContrastIntentHandlers();
    initializeEditModeHandlers();
    initializeHelpSystem();
    initializeLabNormalizationHandlers();

    console.log('✅ UI event handlers initialized');
}

/**
 * Initialize undo/redo button handlers
 */
function initializeUndoRedoHandlers() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            // Note: CurveHistory will be available from extracted modules
            if (typeof CurveHistory !== 'undefined') {
                const result = CurveHistory.undo();
                if (!result.success) {
                    showStatus(`Undo failed: ${result.message}`);
                }
            } else {
                console.warn('CurveHistory not available - undo functionality requires history module');
            }
        });
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            if (typeof CurveHistory !== 'undefined') {
                const result = CurveHistory.redo();
                if (!result.success) {
                    showStatus(`Redo failed: ${result.message}`);
                }
            } else {
                console.warn('CurveHistory not available - redo functionality requires history module');
            }
        });
    }
}

/**
 * Initialize download button handlers
 */
function initializeDownloadHandlers() {
    if (!elements.downloadBtn) return;

    elements.downloadBtn.addEventListener('click', () => {
        try {
            // Note: buildFile will be available from extracted modules
            if (typeof buildFile === 'undefined') {
                console.warn('buildFile not available - download functionality requires file building module');
                showStatus('Download functionality not yet available in modular build');
                return;
            }

            const text = buildFile();
            const p = getCurrentPrinter();

            // Get custom filename or use default
            let filename;
            const customName = elements.filenameInput?.value?.trim() || '';

            if (customName) {
                // Remove .quad extension if user added it, then sanitize
                const cleanName = customName.replace(/\.quad$/, '');
                const sanitizedName = sanitizeFilename(cleanName);

                // If sanitization removed everything, fall back to default
                if (!sanitizedName) {
                    const defaultBase = sanitizeFilename(p.name.replace(/\s+/g, '')) || 'quadGEN';
                    filename = defaultBase + "_linear.quad";
                    showStatus("Invalid filename, using default");
                } else {
                    filename = sanitizedName + '.quad';

                    // Show warning if filename was changed
                    if (sanitizedName !== cleanName) {
                        showStatus(`Filename sanitized: ${filename}`);
                    }
                }
            } else {
                // Use default naming (sanitized printer name)
                const defaultBase = sanitizeFilename(p.name.replace(/\s+/g, '')) || 'quadGEN';
                filename = defaultBase + "_linear.quad";
            }

            // Download the file
            downloadFile(text, filename, 'text/plain;charset=utf-8');
            showStatus(`Downloaded ${filename}`);

        } catch (error) {
            console.error('Download error:', error);
            showStatus("Error downloading file");
        }
    });
}

/**
 * Initialize keyboard shortcuts
 */
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    if (elements.downloadBtn) {
                        elements.downloadBtn.click();
                    }
                    break;
                case 'r':
                    e.preventDefault();
                    if (typeof updatePreview !== 'undefined') {
                        updatePreview();
                    }
                    break;
            }
        }
    });
}

/**
 * Initialize printer selection handlers
 */
function initializePrinterHandlers() {
    if (!elements.printerSelect) return;

    elements.printerSelect.addEventListener('change', (e) => {
        setPrinter(e.target.value);
    });
}

/**
 * Initialize filename input handlers with real-time validation
 */
function initializeFilenameHandlers() {
    if (!elements.filenameInput) return;

    elements.filenameInput.addEventListener('input', (e) => {
        const input = e.target;
        const value = input.value.trim();

        // Mark as user-edited if they've typed something different from auto-generated
        if (value !== generateFilename()) {
            input.dataset.userEdited = 'true';
        } else {
            delete input.dataset.userEdited;
        }

        if (value) {
            const cleanName = value.replace(/\.quad$/, '');
            const sanitized = sanitizeFilename(cleanName);
            const hasInvalidChars = sanitized !== cleanName;

            // Visual feedback for invalid characters
            input.classList.toggle('border-yellow-300', hasInvalidChars);
            input.classList.toggle('bg-yellow-50', hasInvalidChars);
            input.classList.toggle('border-gray-300', !hasInvalidChars);
            input.classList.toggle('bg-white', !hasInvalidChars);

            if (hasInvalidChars) {
                input.title = `Will be saved as: ${sanitized}.quad`;
            } else {
                input.title = '';
            }
        } else {
            input.classList.remove('border-yellow-300', 'bg-yellow-50');
            input.classList.add('border-gray-300', 'bg-white');
            input.title = '';
        }
    });
}

/**
 * Initialize global scale input handlers
 */
function initializeScaleHandlers() {
    if (!elements.scaleAllInput && isBrowser) {
        elements.scaleAllInput = document.getElementById('scaleAllInput');
    }

    if (!elements.scaleAllInput) {
        if (isBrowser && scaleHandlerRetryCount < SCALE_HANDLER_MAX_RETRIES) {
            scaleHandlerRetryCount += 1;
            globalScope.setTimeout(() => {
                initializeScaleHandlers();
            }, 50 * scaleHandlerRetryCount);
        } else {
            console.warn('Scale handlers unable to locate #scaleAllInput element. Dual-read subscription not initialized.');
        }
        return;
    }

    scaleHandlerRetryCount = 0;

    if (isBrowser && !scalingStateFlagListenerAttached) {
        globalScope.addEventListener(SCALING_STATE_FLAG_EVENT, () => {
            console.log('🔁 [SCALE STATE] flag event received', globalScope.__USE_SCALING_STATE);
            configureScalingStateSubscription();
        });
        scalingStateFlagListenerAttached = true;
        globalScope.__scalingStateListenerReady = true;
    }

    configureScalingStateSubscription();

    const MIN_SCALE = 1;
    const MAX_SCALE = 1000;

    // Debounce rapid scale changes to prevent chart update race conditions
    let scaleDebounceTimeout = null;

    const commitScaleAll = (raw, immediate = false) => {
        console.log(`🔍 [SCALE DEBUG] commitScaleAll called:`, {
            raw,
            immediate,
            timestamp: Date.now(),
            callStack: new Error().stack.split('\n').slice(1, 4)
        });

        if (!elements.scaleAllInput) {
            console.log(`🔍 [SCALE DEBUG] No scaleAllInput element found`);
            return;
        }

        let parsed = parseFloat(raw);
        console.log(`🔍 [SCALE DEBUG] Parsed value:`, { raw, parsed });

        if (!Number.isFinite(parsed)) {
            console.warn('🔍 [SCALE DEBUG] Invalid scale value:', raw);
            elements.scaleAllInput.value = '100';
            return;
        }

        // Clamp to valid range
        const beforeClamp = parsed;
        parsed = Math.max(MIN_SCALE, Math.min(MAX_SCALE, parsed));
        console.log(`🔍 [SCALE DEBUG] After clamping:`, { beforeClamp, afterClamp: parsed });

        // Always clear any pending debounced update
        if (scaleDebounceTimeout) {
            console.log(`🔍 [SCALE DEBUG] Clearing existing debounce timeout:`, scaleDebounceTimeout);
            clearTimeout(scaleDebounceTimeout);
            scaleDebounceTimeout = null;
        }

        // Critical: Only scale if there's actually a change (like legacy system)
        const currentScale = getCurrentScale();
        const needsChange = Math.abs(parsed - currentScale) > 0.0001;

        console.log(`🔍 [SCALE DEBUG] Change detection:`, {
            parsed,
            currentScale,
            difference: Math.abs(parsed - currentScale),
            needsChange,
            threshold: 0.0001
        });

        if (!needsChange) {
            // No change needed - just update the input display
            console.log(`🔍 [SCALE DEBUG] No change needed - updating input only`);
            elements.scaleAllInput.value = parsed.toString();
            return;
        }

        elements.scaleAllInput.value = parsed.toString();
        console.log(`🔍 [SCALE DEBUG] Input value updated to:`, parsed.toString());

        const handleCoordinatorError = (error) => {
            console.error('Scaling coordinator error:', error);
            if (elements.scaleAllInput) {
                elements.scaleAllInput.value = formatScalePercent(getCurrentScale());
            }
        };

        if (immediate) {
            console.log(`🔍 [SCALE DEBUG] Executing immediate scaling via coordinator (${parsed})`);
            scalingCoordinator
                .scale(parsed, 'ui', { priority: 'high', metadata: { trigger: 'commitScaleAllImmediate' } })
                .then(() => refreshEffectiveInkDisplays())
                .catch(handleCoordinatorError);
        } else {
            console.log(`🔍 [SCALE DEBUG] Setting up debounced coordinator scaling for:`, parsed);
            scaleDebounceTimeout = setTimeout(() => {
                console.log(`🔍 [SCALE DEBUG] Executing debounced coordinator scaling (${parsed})`);
                scalingCoordinator
                    .scale(parsed, 'ui', { metadata: { trigger: 'commitScaleAllDebounce' } })
                    .then(() => refreshEffectiveInkDisplays())
                    .catch(handleCoordinatorError);
            }, 100);
            console.log(`🔍 [SCALE DEBUG] Coordinator debounce timeout set:`, scaleDebounceTimeout);
        }
    };

    // Focus handler: select all text
    elements.scaleAllInput.addEventListener('focus', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input FOCUS event`);
        if (elements.scaleAllInput) {
            elements.scaleAllInput.select();
        }
    });

    // Blur handler: commit changes (but not if Enter was just pressed)
    let enterJustPressed = false;
    elements.scaleAllInput.addEventListener('blur', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input BLUR event:`, {
            value: e.target.value,
            enterJustPressed,
            timestamp: Date.now()
        });

        if (enterJustPressed) {
            console.log(`🔍 [EVENT DEBUG] Skipping blur processing - Enter was just pressed`);
            enterJustPressed = false; // Reset flag
            return; // Skip blur processing after Enter
        }

        console.log(`🔍 [EVENT DEBUG] Processing blur - calling commitScaleAll("${e.target.value}", false)`);
        commitScaleAll(e.target.value);
    });

    // Keydown handler: Enhanced handling like original
    elements.scaleAllInput.addEventListener('keydown', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input KEYDOWN event:`, {
            key: e.key,
            value: e.target.value,
            timestamp: Date.now()
        });

        if (e.key === 'Enter') {
            console.log(`🔍 [EVENT DEBUG] Enter key pressed - preventing default and setting enterJustPressed flag`);
            e.preventDefault();
            enterJustPressed = true; // Set flag to prevent blur handler
            console.log(`🔍 [EVENT DEBUG] Calling commitScaleAll("${e.target.value}", true) for Enter`);
            commitScaleAll(e.target.value, true); // immediate = true
            console.log(`🔍 [EVENT DEBUG] Calling blur() after Enter processing`);
            e.target.blur();
        } else if (e.key === 'Escape') {
            console.log(`🔍 [EVENT DEBUG] Escape key pressed - resetting to current scale`);
            e.preventDefault();
            // Reset to current stored value
            const currentScale = getCurrentScale();
            console.log(`🔍 [EVENT DEBUG] Resetting to current scale:`, currentScale);
            elements.scaleAllInput.value = currentScale.toString();
            e.target.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
            console.log(`🔍 [EVENT DEBUG] Arrow/Page key pressed:`, e.key);
            // Clear any pending debounced update to prevent conflicts
            if (scaleDebounceTimeout) {
                console.log(`🔍 [EVENT DEBUG] Clearing existing debounce timeout for arrow key`);
                clearTimeout(scaleDebounceTimeout);
                scaleDebounceTimeout = null;
            }
            // Allow default increment/decrement, then commit the new value on the next frame
            console.log(`🔍 [EVENT DEBUG] Setting up next-frame commit for arrow key`);
            setTimeout(() => {
                console.log(`🔍 [EVENT DEBUG] Executing next-frame commit for arrow key - value:`, elements.scaleAllInput.value);
                commitScaleAll(elements.scaleAllInput.value);
            }, 0);
        }
    });

    // Input handler: Real-time scaling with simple debounce
    let inputDebounceTimer = null;

    elements.scaleAllInput.addEventListener('input', (e) => {
        console.log(`🔍 [EVENT DEBUG] Scale input INPUT event:`, {
            value: e.target.value,
            inputType: e.inputType,
            timestamp: Date.now()
        });

        const value = parseFloat(e.target.value);
        const isValid = Number.isFinite(value) && value >= MIN_SCALE && value <= MAX_SCALE;

        console.log(`🔍 [EVENT DEBUG] Input validation:`, { value, isValid, minScale: MIN_SCALE, maxScale: MAX_SCALE });

        // Visual feedback
        e.target.classList.toggle('border-red-300', !isValid);
        e.target.classList.toggle('border-gray-300', isValid);

        // Real-time scaling with debounce
        if (isValid) {
            if (inputDebounceTimer) {
                clearTimeout(inputDebounceTimer);
            }

            inputDebounceTimer = setTimeout(() => {
                console.log(`🔍 [EVENT DEBUG] Debounced input scaling - value:`, value);

                scalingCoordinator
                    .scale(value, 'ui-input', { metadata: { trigger: 'inputDebounce' } })
                    .catch((error) => {
                        console.error('Scaling coordinator input error:', error);
                        if (elements.scaleAllInput) {
                            elements.scaleAllInput.value = formatScalePercent(getCurrentScale());
                        }
                    });
            }, 150); // 150ms debounce
        }

        console.log(`🔍 [EVENT DEBUG] Input event - real-time scaling ${isValid ? 'enabled' : 'disabled'}`);
    });
}

/**
 * Initialize chart interaction handlers
 */
function initializeChartHandlers() {
    // Chart zoom handlers
    if (elements.chartZoomInBtn) {
        elements.chartZoomInBtn.addEventListener('click', () => {
            stepChartZoom(1); // Zoom in
        });
    }

    if (elements.chartZoomOutBtn) {
        elements.chartZoomOutBtn.addEventListener('click', () => {
            stepChartZoom(-1); // Zoom out
        });
    }

    // AI label toggle
    if (elements.aiLabelToggle) {
        elements.aiLabelToggle.addEventListener('change', () => {
            if (typeof updateChartLabels !== 'undefined') {
                updateChartLabels();
            }
        });
    }
}

/**
 * Initialize channel row input handlers
 * This handles the dynamic channel percentage and end value inputs
 */
function initializeChannelRowHandlers() {
    if (!elements.rows) return;

    // Use event delegation for dynamically created channel rows
    elements.rows.addEventListener('input', (e) => {
        const target = e.target;

        if (target.classList.contains('percent-input')) {
            handlePercentInput(target);
        } else if (target.classList.contains('end-input')) {
            handleEndInput(target);
        }
    });

    elements.rows.addEventListener('change', (e) => {
        const target = e.target;

        if (target.classList.contains('percent-input')) {
            handlePercentInput(target);
        } else if (target.classList.contains('end-input')) {
            handleEndInput(target);
        }
    });

    // Custom event for when channels are changed
    elements.rows.addEventListener('channelsChanged', () => {
        if (typeof updatePreview !== 'undefined') {
            updatePreview();
        }
    });
}

function getBasePercentFromInput(input) {
    if (!input) return 0;
    const data = input.getAttribute('data-base-percent');
    return InputValidator.clampPercent(data !== null ? data : input.value);
}

function getBaseEndFromInput(input) {
    if (!input) return 0;
    const data = input.getAttribute('data-base-end');
    return InputValidator.clampEnd(data !== null ? data : input.value);
}

function setBasePercentOnInput(input, value) {
    if (!input) return;
    const clamped = InputValidator.clampPercent(value);
    input.setAttribute('data-base-percent', String(clamped));
}

function setBaseEndOnInput(input, value) {
    if (!input) return;
    const clamped = InputValidator.clampEnd(value);
    input.setAttribute('data-base-end', String(clamped));
}

function getRowBaselines(row) {
    if (!row) return { percent: 0, end: 0 };
    const percentInput = row.querySelector('.percent-input');
    const endInput = row.querySelector('.end-input');
    return {
        percent: getBasePercentFromInput(percentInput),
        end: getBaseEndFromInput(endInput)
    };
}

function ensureOriginalInkSnapshot(row, channelName) {
    if (!row || !channelName) return;

    const percentInput = row.querySelector('.percent-input');
    const endInput = row.querySelector('.end-input');

    const percentValue = percentInput ? InputValidator.clampPercent(percentInput.value) : 0;
    const endValue = endInput ? InputValidator.clampEnd(endInput.value) : 0;

    if (!row.dataset.originalPercent) {
        row.dataset.originalPercent = String(percentValue);
    }
    if (!row.dataset.originalEnd) {
        row.dataset.originalEnd = String(endValue);
    }

    if (typeof getStateManager === 'function') {
        try {
            const manager = getStateManager();
            const existing = manager?.get(`printer.channelOriginalValues.${channelName}`);
            if (!existing) {
                manager.set(
                    `printer.channelOriginalValues.${channelName}`,
                    { percent: percentValue, end: endValue },
                    { skipHistory: true, allowDuringRestore: true }
                );
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[INK SNAPSHOT] Unable to persist original values for', channelName, err);
            }
        }
    }
}

function refreshEffectiveInkDisplays() {
    if (!elements.rows) return;
    const rows = elements.rows.querySelectorAll('tr.channel-row[data-channel]');
    rows.forEach((row) => {
        const channelName = row.getAttribute('data-channel');
        if (!channelName) return;
        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        if (!percentInput || !endInput) return;

        ensureOriginalInkSnapshot(row, channelName);

        const basePercent = getBasePercentFromInput(percentInput);
        const baseEnd = getBaseEndFromInput(endInput);

        if (baseEnd <= 0 || basePercent <= 0) {
            const clampedPercent = InputValidator.clampPercent(basePercent);
            const clampedEnd = InputValidator.clampEnd(baseEnd);
            percentInput.value = clampedPercent.toFixed(1);
            endInput.value = String(clampedEnd);
            setBasePercentOnInput(percentInput, clampedPercent);
            setBaseEndOnInput(endInput, clampedEnd);
            return;
        }

        try {
            const curveValues = make256(baseEnd, channelName, true);
            const peakValue = Math.max(...curveValues);
            const effectiveEnd = InputValidator.clampEnd(Math.round(peakValue));
            const effectivePercent = InputValidator.computePercentFromEnd(effectiveEnd);

            percentInput.value = effectivePercent.toFixed(1);
            endInput.value = String(effectiveEnd);

            setBasePercentOnInput(percentInput, effectivePercent);
            setBaseEndOnInput(endInput, effectiveEnd);

            try {
                const loadedData = ensureLoadedQuadData(() => ({ curves: {}, baselineEnd: {}, sources: {}, keyPoints: {}, keyPointsMeta: {}, rebasedCurves: {}, rebasedSources: {} }));
                if (loadedData) {
                    loadedData.curves = loadedData.curves || {};
                    loadedData.curves[channelName] = Array.isArray(curveValues) ? curveValues.slice() : curveValues;

                    loadedData.baselineEnd = loadedData.baselineEnd || {};
                    loadedData.baselineEnd[channelName] = effectiveEnd;

                    loadedData.rebasedCurves = loadedData.rebasedCurves || {};
                    loadedData.rebasedCurves[channelName] = Array.isArray(curveValues) ? curveValues.slice() : [];

                    loadedData.rebasedSources = loadedData.rebasedSources || {};
                    if (!Array.isArray(loadedData.rebasedSources[channelName]) || !loadedData.rebasedSources[channelName].length) {
                        loadedData.rebasedSources[channelName] = Array.isArray(curveValues) ? curveValues.slice() : [];
                    }
                }
            } catch (stateErr) {
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.warn('[INK DISPLAY] Unable to update loadedData baselines for', channelName, stateErr);
                }
            }

            if (typeof getStateManager === 'function') {
                try {
                    const manager = getStateManager();
                    manager.setChannelValue(channelName, 'percentage', Number(effectivePercent));
                    manager.setChannelValue(channelName, 'endValue', effectiveEnd);
                    manager.setChannelEnabled(channelName, effectiveEnd > 0);
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.warn('[INK DISPLAY] Failed to sync state for', channelName, err);
                    }
                }
            }
        } catch (err) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.warn('[INK DISPLAY] Failed to compute effective ink for', channelName, err);
            }
        }
    });
}

function rebaseChannelsToCorrectedCurves(channelNames = [], options = {}) {
    if (!Array.isArray(channelNames) || channelNames.length === 0) {
        return;
    }

    const loadedData = ensureLoadedQuadData(() => ({ curves: {}, baselineEnd: {}, sources: {}, keyPoints: {}, keyPointsMeta: {}, rebasedCurves: {}, rebasedSources: {} }));
    if (!loadedData.rebasedCurves) {
        loadedData.rebasedCurves = {};
    }
    if (!loadedData.rebasedSources) {
        loadedData.rebasedSources = {};
    }
    if (!loadedData.baselineEnd) {
        loadedData.baselineEnd = {};
    }

    const manager = typeof getStateManager === 'function' ? getStateManager() : null;
    const rebased = [];
    const updateQueue = [];

    const isGlobalSource = options.source === 'globalLoad' || options.source === 'globalToggle';
    const useOriginalBaseline = !!options.useOriginalBaseline;

    channelNames.forEach((channelName) => {
        const row = getChannelRow(channelName);
        if (!row) return;

        const percentInput = row.querySelector('.percent-input');
        const endInput = row.querySelector('.end-input');
        if (!percentInput || !endInput) return;

        const currentEnd = InputValidator.clampEnd(endInput.getAttribute('data-base-end') ?? endInput.value);

        const preferOriginalBaseline = useOriginalBaseline && Array.isArray(loadedData?.originalCurves?.[channelName]);
        const make256Options = preferOriginalBaseline
            ? { preferOriginalBaseline: true, forceSmartApplied: false }
            : undefined;

        let curve = make256(currentEnd, channelName, true, make256Options);
        let effectiveEnd = Array.isArray(curve) && curve.length ? Math.max(...curve) : 0;

        const effectivePercent = InputValidator.computePercentFromEnd(effectiveEnd);

        const finalCurve = Array.isArray(curve) ? curve.slice() : [];

        loadedData.curves[channelName] = finalCurve.slice();
        loadedData.rebasedCurves[channelName] = finalCurve.slice();
        loadedData.rebasedSources[channelName] = finalCurve.slice();
        loadedData.baselineEnd[channelName] = effectiveEnd;

        rebased.push(channelName);

        updateQueue.push({
            channelName,
            row,
            percentInput,
            endInput,
            effectivePercent,
            effectiveEnd,
            perChannelToggle: row.querySelector('.per-channel-toggle'),
            perChannelDataEntry: options.source === 'perChannelLoad'
                ? LinearizationState.getPerChannelData?.(channelName)
                : null
        });

        if (options.source === 'perChannelLoad') {
            try {
                const entry = LinearizationState.getPerChannelData?.(channelName);
                if (entry) {
                    LinearizationState.setPerChannelData(channelName, entry, false);
                }
            } catch (err) {
                console.warn('[INK REBASE] Failed to disable per-channel data after rebase:', channelName, err);
            }

        }
    });

    if (!rebased.length) {
        return;
    }

    updateQueue.forEach((entry) => {
        const {
            channelName,
            row,
            percentInput,
            endInput,
            effectivePercent,
            effectiveEnd,
            perChannelToggle,
            perChannelDataEntry
        } = entry;

        percentInput.value = effectivePercent.toFixed(1);
        percentInput.setAttribute('data-base-percent', String(effectivePercent));
        InputValidator.clearValidationStyling(percentInput);

        endInput.value = String(effectiveEnd);
        endInput.setAttribute('data-base-end', String(effectiveEnd));
        InputValidator.clearValidationStyling(endInput);

        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            row.refreshDisplayFn();
        }

        if (manager) {
            try {
                manager.setChannelValue(channelName, 'percentage', effectivePercent);
                manager.setChannelValue(channelName, 'endValue', effectiveEnd);
                manager.setChannelEnabled(channelName, effectiveEnd > 0);
            } catch (stateErr) {
                console.warn('[INK REBASE] Failed to sync state manager for', channelName, stateErr);
            }
        }

        updateScaleBaselineForChannelCore(channelName);

        if (options.source === 'perChannelLoad') {
            if (perChannelDataEntry) {
                try {
                    perChannelDataEntry.edited = false;
                } catch (err) { /* ignore */ }
            }
            if (perChannelToggle) {
                perChannelToggle.checked = false;
                perChannelToggle.disabled = true;
                perChannelToggle.setAttribute('data-baked', 'true');
                perChannelToggle.title = 'Per-channel correction baked into baseline. Undo or revert to modify.';
            }
        }
    });

    if (isEditModeEnabled()) {
        try {
            refreshSmartCurvesFromMeasurements();
        } catch (err) {
            console.warn('[INK REBASE] Failed to refresh Smart curves after rebase:', err);
        }
    }

    rebased.forEach((channelName) => {
        try {
            updateProcessingDetail(channelName);
        } catch (err) {
            console.warn('Processing detail refresh failed for', channelName, err);
        }
    });

    try { updateInkChart(); } catch (err) { console.warn('[INK REBASE] Chart update failed:', err); }

    if (typeof debouncedPreviewUpdate === 'function') {
        debouncedPreviewUpdate();
    }

    try { updateSessionStatus(); } catch (err) { console.warn('[INK REBASE] Session status update failed:', err); }

    if (isGlobalSource) {
        try {
            const globalData = LinearizationState.getGlobalData?.();
            if (globalData) {
                globalData.applied = true;
            }
            LinearizationState.globalApplied = true;
            if (manager) {
                manager.set('linearization.global.applied', true, { skipHistory: true, allowDuringRestore: true });
            }
        } catch (err) {
            console.warn('[INK REBASE] Failed to ensure global applied state after rebase:', err);
        }
    }
}

function restoreChannelsToRebasedSources(channelNames = [], options = {}) {
    if (!Array.isArray(channelNames) || channelNames.length === 0) {
        return [];
    }

    const { skipRefresh = false } = typeof options === 'object' && options !== null ? options : {};

    const loadedData = ensureLoadedQuadData(() => ({
        curves: {},
        baselineEnd: {},
        sources: {},
        keyPoints: {},
        keyPointsMeta: {},
        rebasedCurves: {},
        rebasedSources: {}
    }));

    if (!loadedData.rebasedSources) {
        return [];
    }

    const manager = typeof getStateManager === 'function' ? getStateManager() : null;
    const restoredChannels = [];

    channelNames.forEach((channelName) => {
        const sourceCurve = Array.isArray(loadedData.rebasedSources?.[channelName])
            ? loadedData.rebasedSources[channelName]
            : null;
        if (!Array.isArray(sourceCurve) || sourceCurve.length === 0) {
            return;
        }

        const clonedCurve = sourceCurve.slice();
        const effectiveEnd = clonedCurve.length ? Math.max(...clonedCurve) : 0;
        const effectivePercent = InputValidator.computePercentFromEnd(effectiveEnd);

        const row = getChannelRow(channelName);
        if (row) {
            const percentInput = row.querySelector('.percent-input');
            const endInput = row.querySelector('.end-input');

            if (percentInput) {
                percentInput.value = effectivePercent.toFixed(1);
                percentInput.setAttribute('data-base-percent', String(effectivePercent));
                InputValidator.clearValidationStyling(percentInput);
            }

            if (endInput) {
                endInput.value = String(effectiveEnd);
                endInput.setAttribute('data-base-end', String(effectiveEnd));
                InputValidator.clearValidationStyling(endInput);
            }

            if (!skipRefresh && row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
                try {
                    row.refreshDisplayFn();
                } catch (err) {
                    console.warn('[INK RESTORE] Failed to refresh row display for', channelName, err);
                }
            }
        }

        loadedData.curves[channelName] = clonedCurve.slice();
        loadedData.rebasedCurves[channelName] = clonedCurve.slice();
        loadedData.baselineEnd[channelName] = effectiveEnd;

        if (manager) {
            try {
                manager.setChannelValue(channelName, 'percentage', effectivePercent);
                manager.setChannelValue(channelName, 'endValue', effectiveEnd);
                manager.setChannelEnabled(channelName, effectiveEnd > 0);
            } catch (err) {
                console.warn('[INK RESTORE] Failed to sync state manager for', channelName, err);
            }
        }

        updateScaleBaselineForChannelCore(channelName);
        restoredChannels.push(channelName);
    });

    return restoredChannels;
}

function isDefaultSmartRamp(points) {
    if (!Array.isArray(points) || points.length !== 2) {
        return false;
    }
    const [p0, p1] = points;
    const nearZero = (value) => Math.abs(Number(value) || 0) <= 0.0001;
    const nearHundred = (value) => Math.abs((Number(value) || 0) - 100) <= 0.0001;
    return nearZero(p0?.input) && nearZero(p0?.output) && nearHundred(p1?.input) && nearHundred(p1?.output);
}

function preserveQuadCurveForInkLimit(channelName, newEndValue) {
    if (!channelName || !Number.isFinite(newEndValue)) {
        return;
    }

    const loadedData = getLoadedQuadData();
    if (!loadedData) {
        return;
    }

    const reference = Array.isArray(loadedData.rebasedCurves?.[channelName])
        ? loadedData.rebasedCurves[channelName]
        : loadedData.curves?.[channelName];
    const fallbackOriginal = loadedData.originalCurves?.[channelName];
    const baselineSourceCurve = Array.isArray(reference) && reference.length ? reference : fallbackOriginal;

    if (!Array.isArray(baselineSourceCurve) || baselineSourceCurve.length === 0) {
        return;
    }

    const baselineSource = loadedData.baselineEnd?.[channelName];
    const baselineEnd = Number.isFinite(baselineSource) && baselineSource > 0
        ? baselineSource
        : Math.max(...baselineSourceCurve);
    if (!baselineEnd || baselineEnd <= 0) {
        return;
    }

    const ratio = newEndValue <= 0 ? 0 : newEndValue / baselineEnd;
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[INK LIMIT preserve] scaling', {
            channelName,
            baselineEnd,
            newEndValue,
            maxBaseline: Math.max(...baselineSourceCurve)
        });
    }
    const scaledCurve = baselineSourceCurve.map((value) => {
        if (!Number.isFinite(value)) return 0;
        const scaled = ratio * value;
        if (!Number.isFinite(scaled)) return 0;
        return Math.max(0, Math.min(TOTAL, Math.round(scaled)));
    });

    if (!loadedData.curves) {
        loadedData.curves = {};
    }
    loadedData.curves[channelName] = scaledCurve;
    if (!loadedData.rebasedCurves) {
        loadedData.rebasedCurves = {};
    }
    loadedData.rebasedCurves[channelName] = scaledCurve.slice();
    if (!loadedData.baselineEnd) {
        loadedData.baselineEnd = {};
    }
    loadedData.baselineEnd[channelName] = newEndValue;

    const keyPoints = loadedData.keyPoints?.[channelName];
    const sourceTag = loadedData.sources?.[channelName];
    if (sourceTag === 'smart' && isDefaultSmartRamp(keyPoints)) {
        if (loadedData.keyPoints) {
            delete loadedData.keyPoints[channelName];
        }
        if (loadedData.keyPointsMeta) {
            delete loadedData.keyPointsMeta[channelName];
        }
        if (loadedData.sources) {
            delete loadedData.sources[channelName];
        }
    }
}

/**
 * Handle percentage input changes with validation
 * @param {HTMLInputElement} input - The percentage input element
 */
function handlePercentInput(input) {
    const validatedPercent = InputValidator.validatePercentInput(input);

    const row = input.closest('tr');
    const channelName = row?.getAttribute('data-channel');

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[INK LIMIT percentInput]', {
            channelName,
            validatedPercent,
            rawValue: input?.value
        });
    }

    if (globalScope) {
        globalScope.__percentDebug = globalScope.__percentDebug || [];
        globalScope.__percentDebug.push({ stage: 'validated', channelName, value: validatedPercent });
    }

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log(`[INPUT DEBUG] handlePercentInput called for ${channelName}, value: ${validatedPercent}`);
    }

    let previousPercent = null;
    let previousEnd = null;
    if (row) {
        const baselines = getRowBaselines(row);
        previousPercent = baselines.percent;
        previousEnd = baselines.end;
    }

    let manager = null;
    if (channelName) {
        try {
            manager = getStateManager?.() ?? null;
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log(`[INPUT DEBUG] State manager exists: ${!!manager}`);
            }
            if (manager) {
                manager.setChannelValue(channelName, 'percentage', validatedPercent);
            }
        } catch (err) {
            console.warn('Failed to route percentage through state manager:', err);
        }
    }

    // Find corresponding end input and update it
    let newEndValue = null;
    if (row) {
        const endInput = row.querySelector('.end-input');
        if (endInput) {
            newEndValue = InputValidator.computeEndFromPercent(validatedPercent);
            setBaseEndOnInput(endInput, newEndValue);
            endInput.value = newEndValue;
            InputValidator.clearValidationStyling(endInput);

            if (channelName && manager) {
                try {
                    manager.setChannelValue(channelName, 'endValue', newEndValue);
                } catch (err) {
                    console.warn('Failed to sync end value with state manager:', err);
                }
            }
        }

        setBasePercentOnInput(input, validatedPercent);
        if (globalScope) {
            globalScope.__percentDebug.push({ stage: 'setBasePercent', channelName, value: validatedPercent });
        }

        // Update scale baseline for global scale integration
        const rowChannelName = row.getAttribute('data-channel');
        if (rowChannelName) {
            updateScaleBaselineForChannelCore(rowChannelName);
        }

        // Call the row's refreshDisplay function (critical for scaling display logic)
        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            row.refreshDisplayFn();
        }
    }

    if (channelName && manager) {
        try {
            manager.setChannelEnabled(channelName, validatedPercent > 0);
        } catch (err) {
            console.warn('Failed to sync channel enabled state with state manager:', err);
        }
    }

    const previousPercentForRescale = Number.isFinite(previousPercent)
        ? previousPercent
        : (previousEnd !== null ? InputValidator.computePercentFromEnd(previousEnd) : null);
    if (
        channelName &&
        Number.isFinite(previousPercentForRescale) &&
        previousPercentForRescale > 0 &&
        validatedPercent > 0 &&
        Math.abs(previousPercentForRescale - validatedPercent) > 1e-6
    ) {
        rescaleSmartCurveForInkLimit(channelName, previousPercentForRescale, validatedPercent, {
            mode: 'preserveRelative',
            historyExtras: { triggeredBy: 'percentInput' }
        });
    }

    if (channelName && Number.isFinite(newEndValue)) {
        try {
            preserveQuadCurveForInkLimit(channelName, newEndValue);
        } catch (err) {
            console.warn('[INK LIMIT] preserveQuadCurveForInkLimit failed:', err);
        }
    }

    const currentScalePercent = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
    if (Number.isFinite(currentScalePercent) && Math.abs(currentScalePercent - 100) > 1e-6) {
        scalingCoordinator
            .scale(currentScalePercent, 'ui-resync', {
                metadata: {
                    trigger: 'percentInputResync',
                    skipHistory: true
                }
            })
            .catch((err) => {
                console.warn('[SCALE] Coordinator resync after percent edit failed:', err);
            });
    }

    refreshEffectiveInkDisplays();

    // Trigger preview update and chart update
    if (typeof debouncedPreviewUpdate !== 'undefined') {
        debouncedPreviewUpdate();
    }

    // Trigger chart update for immediate visual feedback
    updateInkChart();

    // Update edit mode channel dropdown when channel states change
    setTimeout(() => {
        try {
            populateChannelDropdown();
        } catch (err) {
            console.warn('[EDIT MODE] Channel dropdown update failed:', err);
        }
    }, 0);
}

/**
 * Handle end value input changes with validation
 * @param {HTMLInputElement} input - The end value input element
 */
function handleEndInput(input) {
    const validatedEnd = InputValidator.validateEndInput(input);

    const row = input.closest('tr');
    const channelName = row?.getAttribute('data-channel');

    const baselines = row ? getRowBaselines(row) : { percent: null, end: null };
    let previousPercent = baselines.percent;
    let previousEnd = baselines.end;

    let manager = null;
    if (channelName) {
        try {
            manager = getStateManager?.() ?? null;
            if (manager) {
                manager.setChannelValue(channelName, 'endValue', validatedEnd);
            }
        } catch (err) {
            console.warn('Failed to route end value through state manager:', err);
        }
    }

    let newPercentValue = null;

    // Find corresponding percent input and update it
    if (row) {
        const percentInput = row.querySelector('.percent-input');
        if (percentInput) {
            newPercentValue = InputValidator.computePercentFromEnd(validatedEnd);
            setBasePercentOnInput(percentInput, newPercentValue);
            if (globalScope) {
                globalScope.__percentDebug.push({ stage: 'syncPercent', channelName, value: newPercentValue });
            }
            percentInput.value = newPercentValue.toFixed(1);
            InputValidator.clearValidationStyling(percentInput);

            if (channelName && manager) {
                try {
                    manager.setChannelValue(channelName, 'percentage', Number(newPercentValue));
                } catch (err) {
                    console.warn('Failed to sync percentage with state manager:', err);
                }
            }
        }

        setBaseEndOnInput(input, validatedEnd);

        // Update scale baseline for global scale integration
        const rowChannelName = row.getAttribute('data-channel');
        if (rowChannelName) {
            updateScaleBaselineForChannelCore(rowChannelName);
        }

        // Call the row's refreshDisplay function (critical for scaling display logic)
        if (row.refreshDisplayFn && typeof row.refreshDisplayFn === 'function') {
            row.refreshDisplayFn();
        }
    }

    if (channelName && manager) {
        try {
            manager.setChannelEnabled(channelName, validatedEnd > 0);
        } catch (err) {
            console.warn('Failed to sync channel enabled state with state manager (end input):', err);
        }
    }

    const previousPercentForRescale = Number.isFinite(previousPercent)
        ? previousPercent
        : (previousEnd !== null ? InputValidator.computePercentFromEnd(previousEnd) : null);
    if (
        channelName &&
        Number.isFinite(previousPercentForRescale) &&
        previousPercentForRescale > 0 &&
        Number.isFinite(newPercentValue) &&
        newPercentValue > 0 &&
        Math.abs(previousPercentForRescale - newPercentValue) > 1e-6
    ) {
        rescaleSmartCurveForInkLimit(channelName, previousPercentForRescale, newPercentValue, {
            mode: 'preserveRelative',
            historyExtras: { triggeredBy: 'endInput' }
        });
    }

    if (channelName && Number.isFinite(validatedEnd)) {
        try {
            preserveQuadCurveForInkLimit(channelName, validatedEnd);
        } catch (err) {
            console.warn('[INK LIMIT] preserveQuadCurveForInkLimit failed:', err);
        }
    }

    const currentScalePercent = typeof getCurrentScale === 'function' ? getCurrentScale() : 100;
    if (Number.isFinite(currentScalePercent) && Math.abs(currentScalePercent - 100) > 1e-6) {
        scalingCoordinator
            .scale(currentScalePercent, 'ui-resync', {
                metadata: {
                    trigger: 'endInputResync',
                    skipHistory: true
                }
            })
            .catch((err) => {
                console.warn('[SCALE] Coordinator resync after end edit failed:', err);
            });
    }

    refreshEffectiveInkDisplays();

    // Trigger preview update and chart update
    if (typeof debouncedPreviewUpdate !== 'undefined') {
        debouncedPreviewUpdate();
    }

    // Trigger chart update for immediate visual feedback
    updateInkChart();

    // Update edit mode channel dropdown when channel states change
    setTimeout(() => {
        try {
            populateChannelDropdown();
        } catch (err) {
            console.warn('[EDIT MODE] Channel dropdown update failed:', err);
        }
    }, 0);
}

/**
 * Auto-limit toggle handlers
 * Initialize handlers for auto white/black limit toggles
 */
export function initializeAutoLimitHandlers() {
    // Auto white limit toggle
    if (elements.autoWhiteLimitToggle) {
        elements.autoWhiteLimitToggle.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;

            try {
                localStorage.setItem('autoWhiteLimitV1', enabled ? '1' : '0');
            } catch (err) {
                console.warn('Could not save auto white limit preference:', err);
            }

            showStatus(enabled ? 'Auto white limit enabled' : 'Auto white limit disabled');

            // Update processing details and preview
            try {
                const channels = getCurrentPrinter()?.channels || [];
                channels.forEach(ch => {
                    if (typeof updateProcessingDetail !== 'undefined') {
                        updateProcessingDetail(ch);
                    }
                });
            } catch (err) {
                console.warn('Error updating processing details:', err);
            }

            if (typeof updateSessionStatus !== 'undefined') {
                updateSessionStatus();
            }

            if (typeof debouncedPreviewUpdate !== 'undefined') {
                debouncedPreviewUpdate();
            }
        });
    }

    // Auto black limit toggle
    if (elements.autoBlackLimitToggle) {
        elements.autoBlackLimitToggle.addEventListener('change', (e) => {
            const enabled = !!e.target.checked;

            try {
                localStorage.setItem('autoBlackLimitV1', enabled ? '1' : '0');
            } catch (err) {
                console.warn('Could not save auto black limit preference:', err);
            }

            showStatus(enabled ? 'Auto black limit enabled' : 'Auto black limit disabled');

            // Update processing details and preview
            try {
                const channels = getCurrentPrinter()?.channels || [];
                channels.forEach(ch => {
                    if (typeof updateProcessingDetail !== 'undefined') {
                        updateProcessingDetail(ch);
                    }
                });
            } catch (err) {
                console.warn('Error updating processing details:', err);
            }

            if (typeof updateSessionStatus !== 'undefined') {
                updateSessionStatus();
            }

            if (typeof debouncedPreviewUpdate !== 'undefined') {
                debouncedPreviewUpdate();
            }
        });
    }
}

/**
 * Initialize file loading handlers
 * Handles .quad file loading and processing
 */
function initializeFileHandlers() {
    try {
        console.log('📁 Initializing file handlers...');

        // Load .quad file button click handler
        if (elements.loadQuadBtn) {
            elements.loadQuadBtn.addEventListener('click', () => {
                console.log('📁 Load .quad button clicked');
                if (elements.quadFile) {
                    elements.quadFile.click();
                } else {
                    console.warn('quadFile element not found');
                }
            });
        } else {
            console.warn('loadQuadBtn element not found');
        }

        // Load .quad file change handler
        if (elements.quadFile) {
            elements.quadFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    console.log('📁 Processing .quad file:', file.name);

                    // Check file type
                    if (!file.name.toLowerCase().endsWith('.quad')) {
                        console.error('Please select a .quad file');
                        return;
                    }

                    // Read file content
                    const content = await readFileAsText(file);
                    console.log('📁 File content read, length:', content.length);

                    // Parse .quad file
                    const parsed = parseQuadFile(content);
                    console.log('📁 Parsed result:', parsed);

                    if (!parsed.valid) {
                        console.error(`Error parsing .quad file: ${parsed.error}`);
                        return;
                    }

                    // Clear active measurement data so intent remap can enable after load
                    LinearizationState.clear();
                    updateAppState({
                        linearizationData: null,
                        linearizationApplied: false,
                        perChannelLinearization: {}
                    });
                    if (isBrowser) {
                        globalScope.linearizationData = null;
                        globalScope.linearizationApplied = false;
                        globalScope.perChannelLinearization = {};
                        globalScope.perChannelEnabled = {};
                        globalScope.perChannelFilenames = {};
                    }

                    // Enrich parsed data with filename and immutable originals
                    const enriched = {
                        ...parsed,
                        filename: file.name
                    };

                    const channelList = Array.isArray(enriched.channels) && enriched.channels.length
                        ? enriched.channels
                        : Object.keys(enriched.curves || {});

                    const originalCurves = {};
                    channelList.forEach((channelName) => {
                        const curve = enriched.curves?.[channelName];
                        if (Array.isArray(curve)) {
                            originalCurves[channelName] = curve.slice();
                        }
                    });
                    enriched.originalCurves = originalCurves;
                    if (!enriched.baselineEnd) {
                        enriched.baselineEnd = {};
                        channelList.forEach((channelName) => {
                            const curve = enriched.curves?.[channelName];
                            if (Array.isArray(curve) && curve.length) {
                                enriched.baselineEnd[channelName] = Math.max(...curve);
                            }
                        });
                    }

                    // Store parsed data in global state
                    setLoadedQuadData(enriched);
                    console.log('📁 Stored .quad data in global state');

                    // Synchronize printer/channel UI with loaded data
                    syncPrinterForQuadData(enriched, { silent: false });

                    console.log('✅ .quad file loaded and applied successfully');

                } catch (error) {
                    console.error('Error loading .quad file:', error);
                }

                // Clear the file input for next use
                e.target.value = '';
            });
        } else {
            console.warn('quadFile element not found');
        }

        // Global linearization button click handler
        if (elements.globalLinearizationBtn) {
            elements.globalLinearizationBtn.addEventListener('click', () => {
                console.log('📁 Global linearization button clicked');
                if (elements.linearizationFile) {
                    elements.linearizationFile.click();
                } else {
                    console.warn('linearizationFile element not found');
                }
            });
        } else {
            console.warn('globalLinearizationBtn element not found');
        }

        const applyGlobalLinearizationToggle = (enabled) => {
            const globalData = LinearizationState.getGlobalData();
            if (!globalData) {
                if (elements.globalLinearizationToggle) {
                    elements.globalLinearizationToggle.checked = false;
                    elements.globalLinearizationToggle.setAttribute('aria-checked', 'false');
                }
                showStatus('Load a global correction before enabling the toggle.');
                return;
            }

            if (LinearizationState.isGlobalBaked?.() && !enabled) {
                if (elements.globalLinearizationToggle) {
                    elements.globalLinearizationToggle.checked = true;
                    elements.globalLinearizationToggle.setAttribute('aria-checked', 'true');
                }
                showStatus('Global correction is baked into Smart curves. Undo or revert to disable.');
                return;
            }

            const applied = !!enabled;
            LinearizationState.globalApplied = applied;
            globalData.applied = applied;

            if (isBrowser) {
                globalScope.linearizationApplied = applied;
                globalScope.linearizationData = { ...globalData };
            }

            try {
                const manager = getStateManager?.();
                if (manager) {
                    manager.set('linearization.global.applied', applied);
                    manager.set('linearization.global.enabled', applied);
                    manager.set('linearization.global.data', globalData);
                }
            } catch (err) {
                console.warn('Failed to sync global linearization state manager flags:', err);
            }

            try {
                updateAppState({
                    linearizationApplied: applied,
                    linearizationData: { ...globalData }
                });
            } catch (err) {
                console.warn('Failed to update app state for global linearization:', err);
            }

            if (elements.globalLinearizationToggle) {
                elements.globalLinearizationToggle.checked = applied;
                elements.globalLinearizationToggle.setAttribute('aria-checked', String(applied));
            }

            if (applied && isEditModeEnabled()) {
                try {
                    refreshSmartCurvesFromMeasurements();
                } catch (err) {
                    console.warn('Failed to refresh Smart curves after global toggle:', err);
                }
            }

            if (applied) {
                const printer = getCurrentPrinter();
                const channels = printer?.channels || [];
                const globalData = LinearizationState.getGlobalData?.();
                rebaseChannelsToCorrectedCurves(channels, {
                    source: 'globalToggle',
                    filename: globalData?.filename || null
                });
            }

            try {
                updateInkChart();
                if (typeof updatePreview !== 'undefined') {
                    updatePreview();
                }

                const printer = getCurrentPrinter();
                const channels = printer?.channels || [];
                channels.forEach((ch) => {
                    try {
                        updateProcessingDetail(ch);
                    } catch (err) {
                        console.warn(`Failed to refresh processing detail for ${ch}:`, err);
                    }
                });

                updateSessionStatus();
            } catch (err) {
                console.warn('Failed to refresh UI after global toggle:', err);
            }

            try {
                updateRevertButtonsState();
            } catch (err) {
                console.warn('Failed to update revert buttons after global toggle:', err);
            }

            showStatus(applied ? 'Global correction enabled' : 'Global correction disabled');
        };

        // Global linearization file input change handler
        if (elements.linearizationFile) {
            elements.linearizationFile.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    console.log('📁 Processing global linearization file:', file.name);

                    // Read file content based on file type
                    const extension = file.name.toLowerCase().split('.').pop();
                    let fileInput;
                    if (extension === 'acv') {
                        fileInput = await file.arrayBuffer();
                    } else {
                        fileInput = await file.text();
                    }

                    // Parse the linearization file
                    const parsed = await parseLinearizationFile(fileInput, file.name);

                    if (parsed && parsed.samples) {
                        console.log('✅ Global linearization file loaded:', file.name);

                        if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                            CurveHistory.captureState('Before: Load Global Linearization');
                        }

                        // Store in LinearizationState (modular system)
                        const normalized = normalizeLinearizationEntry(parsed);
                        normalized.filename = file.name;

                        // Use LinearizationState for modular system
                        LinearizationState.setGlobalData(normalized, true);
                        setGlobalBakedState(null, { skipHistory: true });
                        updateAppState({ linearizationData: normalized, linearizationApplied: true });

                        if (isEditModeEnabled()) {
                            refreshSmartCurvesFromMeasurements();
                        }

                        // Also store in legacy window variables for compatibility
                        if (isBrowser) {
                            globalScope.linearizationData = normalized;
                            globalScope.linearizationApplied = true;
                        }

                        // Update the filename display element for status bar
                        if (elements.globalLinearizationFilename) {
                            elements.globalLinearizationFilename.textContent = file.name;
                        }

                        if (elements.globalLinearizationDetails) {
                            const countLabel = getBasePointCountLabel(normalized);
                            const formatToken = String(normalized.format || '')
                                .split(' ')
                                .filter(Boolean)
                                .shift() || '';
                            const formatLabel = formatToken ? formatToken.toUpperCase() : '';
                            const detailParts = [];
                            if (countLabel) detailParts.push(countLabel);
                            if (formatLabel) detailParts.push(`(${formatLabel})`);
                            elements.globalLinearizationDetails.textContent = detailParts.length
                                ? ` - ${detailParts.join(' ')}`
                                : '';
                        }

                        if (elements.globalLinearizationBtn) {
                            const countLabel = getBasePointCountLabel(normalized);
                            elements.globalLinearizationBtn.setAttribute('data-tooltip', `Loaded: ${file.name} (${countLabel})`);
                        }

                        if (elements.globalLinearizationToggle) {
                            elements.globalLinearizationToggle.disabled = false;
                            elements.globalLinearizationToggle.checked = true;
                            elements.globalLinearizationToggle.setAttribute('aria-checked', 'true');
                        }

                        if (elements.globalLinearizationInfo) {
                            elements.globalLinearizationInfo.classList.remove('hidden');
                        }

                        if (elements.globalLinearizationHint) {
                            elements.globalLinearizationHint.classList.add('hidden');
                        }

                        // Note: Revert button state is managed by updateRevertButtonsState()
                        try { updateRevertButtonsState(); } catch (err) { /* ignore */ }

                        if (typeof globalScope.updateInterpolationControls === 'function') {
                            try { globalScope.updateInterpolationControls(); } catch (err) { /* ignore */ }
                        }

                        // Update chart to reflect changes
                        updateInkChart();

                        // Update session status to show the loaded file
                        if (typeof updateSessionStatus === 'function') {
                            updateSessionStatus();
                        }

                        try {
                            postLinearizationSummary();
                        } catch (summaryErr) {
                            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                                console.warn('[LabTechSummary] Failed to post summary after global load:', summaryErr);
                            }
                        }

                        console.log('✅ Global linearization applied successfully');

                        const countLabel = getBasePointCountLabel(normalized);
                        showStatus(`Loaded global correction: ${file.name} (${countLabel})`);

                        applyGlobalLinearizationToggle(true);

                        if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                            CurveHistory.captureState('After: Load Global Linearization (rebased)');
                        }

                    } else {
                        throw new Error('Failed to parse linearization data');
                    }

                } catch (error) {
                    console.error('Error loading global linearization file:', error);
                    // TODO: Add user-visible error message
                }

                // Clear the file input for next use
                e.target.value = '';
            });
        } else {
            console.warn('linearizationFile element not found');
        }

        if (elements.globalLinearizationToggle) {
            const toggle = elements.globalLinearizationToggle;
            toggle.addEventListener('change', () => {
                applyGlobalLinearizationToggle(toggle.checked);
            });

            const initialApplied = !!(LinearizationState.getGlobalData() && LinearizationState.globalApplied);
            toggle.checked = initialApplied;
            toggle.setAttribute('aria-checked', String(initialApplied));
        } else {
            console.warn('globalLinearizationToggle element not found');
        }

        // Global Revert Button Handler
        if (elements.revertGlobalToMeasurementBtn) {
            elements.revertGlobalToMeasurementBtn.addEventListener('click', () => {
                // Guard: only perform revert when there's something to revert (Smart Curves exist OR data was edited)
                try {
                    const revertState = computeGlobalRevertState();
                    const { isMeasurement, hasSmartEdits, wasEdited, isBaked, globalData } = revertState;
                    const fmt = String(globalData?.format || '').toUpperCase();
                    const hasOriginal = Array.isArray(globalData?.originalData);
                    const isEnabled = LinearizationState.isGlobalEnabled();
                    const shouldRevert = !isBaked && isMeasurement && (hasSmartEdits || wasEdited);

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log(`[DEBUG REVERT] Button clicked: fmt="${fmt}", hasData=${!!globalData}, applied=${isEnabled}, hasOriginal=${hasOriginal}, isMeasurement=${isMeasurement}, hasSmartEdits=${hasSmartEdits}, wasEdited=${wasEdited}, isBaked=${isBaked}, shouldRevert=${shouldRevert}`);
                    }

                    if (!shouldRevert) {
                        if (isBaked) {
                            showStatus('Global correction already baked into Smart curves. Use undo to restore measurement.');
                        }
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[DEBUG REVERT] Guard check failed - nothing to revert');
                        }
                        return;
                    }
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[DEBUG REVERT] Guard check error:', err);
                    }
                    return;
                }

                const savedSel = (isEditModeEnabled() && typeof EDIT !== 'undefined' && EDIT && EDIT.selectedChannel)
                    ? EDIT.selectedChannel
                    : null;

                try {
                    if (typeof CurveHistory !== 'undefined') {
                        CurveHistory.captureState('Before: Revert Global to Measurement');
                    }
                } catch (err) {
                    console.warn('Failed to capture history state:', err);
                }

                const printer = getCurrentPrinter();
                const channels = printer?.channels || [];
                const smartRestoreSummary = resetSmartPointsForChannels(channels, {
                    skipUiRefresh: true,
                    forceReinitialize: true
                });

                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[DEBUG REVERT] Smart points restored during global revert', smartRestoreSummary);
                }

                const restoredChannels = restoreChannelsToRebasedSources(channels);

                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    console.log('[DEBUG REVERT] Baselines restored for channels', restoredChannels);
                }

                const globalBtnRef = document.getElementById('revertGlobalToMeasurementBtn');
                if (globalBtnRef) {
                    globalBtnRef.disabled = true;
                    globalBtnRef.setAttribute('disabled', 'disabled');
                }

                // Mark global measurement as clean again
                if (globalData) {
                    globalData.edited = false;
                }

                // Keep linearization state/applied flags in sync for modular + legacy consumers
                if (globalData) {
                    LinearizationState.setGlobalData(globalData, true);
                    updateAppState({ linearizationData: globalData, linearizationApplied: true });
                    if (isBrowser) {
                        globalScope.linearizationData = globalData;
                        globalScope.linearizationApplied = true;
                    }
                    setGlobalBakedState(null);
                }

                try {
                    // Update UI
                    updateInkChart();
                    if (typeof updatePreview !== 'undefined') {
                        updatePreview();
                    }

                    channels.forEach((ch) => {
                        try {
                            updateProcessingDetail(ch);
                        } catch (err) {
                            console.warn(`Failed to update processing detail for ${ch}:`, err);
                        }
                    });

                    if (typeof updateSessionStatus !== 'undefined') {
                        updateSessionStatus();
                    }
                } catch (uiErr) {
                    console.warn('Failed to refresh UI before revert state sync:', uiErr);
                }

                try {
                    updateRevertButtonsState();
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log('[DEBUG REVERT] Post-reset revert button state refreshed');
                    }

                    try {
                        const finalState = computeGlobalRevertState();
                        const shouldEnableFinal = !finalState.isBaked && finalState.isMeasurement && (finalState.hasSmartEdits || finalState.wasEdited);
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[DEBUG REVERT] Final global revert state', finalState);
                        }
                        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                            console.log('[DEBUG REVERT] Final revert state applied', finalState);
                        }
                        if (!shouldEnableFinal) {
                            const globalBtn = document.getElementById('revertGlobalToMeasurementBtn');
                            if (globalBtn) {
                                globalBtn.disabled = true;
                                globalBtn.setAttribute('disabled', 'disabled');
                            }
                        }
                    } catch (stateErr) {
                        console.warn('Failed to enforce final revert button state:', stateErr);
                    }
                } catch (err) {
                    console.warn('Failed to update revert button states:', err);
                }

                try {
                    showStatus('Reverted to measurement (global)');
                } catch (err) {
                    console.warn('Failed to show status after revert:', err);
                }

                // Restore Edit Mode selection
                try {
                    if (savedSel && isEditModeEnabled()) {
                        const row = Array.from(elements.rows.children).find(tr => tr.getAttribute('data-channel') === savedSel);
                        const endVal = row ? InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0) : 0;
                        if (endVal > 0) {
                            if (elements.editChannelSelect) elements.editChannelSelect.value = savedSel;
                            if (typeof EDIT !== 'undefined') EDIT.selectedChannel = savedSel;
                            if (typeof edit_refreshState === 'function') edit_refreshState();
                            updateInkChart();
                        }
                    }
                } catch (err) {
                    console.warn('Failed to restore Edit Mode selection:', err);
                }

            });

            console.log('✅ Global revert button handler initialized');
        } else {
            console.warn('revertGlobalToMeasurementBtn element not found');
        }

        console.log('✅ File handlers initialized');

    } catch (error) {
        console.error('Error initializing file handlers:', error);
    }
}

/**
 * Initialize contrast intent dropdown handlers
 */
function initializeContrastIntentHandlers() {
    const scheduleIntentApply = (fn) => {
        if (typeof globalScope.requestAnimationFrame === 'function') {
            globalScope.requestAnimationFrame(() => globalScope.requestAnimationFrame(fn));
        } else {
            setTimeout(fn, 0);
        }
    };

    // Initialize contrast intent state
    ensureContrastIntentDefault();

    // Expose setContrastIntent globally for compatibility
    if (isBrowser) {
        globalScope.setContrastIntent = setContrastIntent;
    }

    // Contrast intent dropdown change handler
    if (elements.contrastIntentSelect) {
        elements.contrastIntentSelect.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            console.log('🎯 Contrast intent changed to:', selectedId);

            if (selectedId === 'enter_custom') {
                // Handle custom intent modal (not implemented yet)
                console.log('🎯 Custom intent modal not yet implemented');
                // Reset dropdown to current intent
                const currentId = getAppState().contrastIntent?.id || 'linear';
                elements.contrastIntentSelect.value = currentId;
                return;
            }

            // Apply preset intent
            const preset = getPreset(selectedId);
            if (preset) {
                scheduleIntentApply(() => setContrastIntent(preset.id, preset.params, 'preset'));
            } else {
                console.warn('Unknown intent preset:', selectedId);
            }
        });

        console.log('✅ Contrast intent dropdown handler initialized');
    } else {
        console.warn('Contrast intent dropdown not found');
    }

    if (elements.applyIntentToQuadBtn) {
        elements.applyIntentToQuadBtn.addEventListener('click', () => {
            applyIntentToLoadedCurve();
        });
    }
}

/**
 * Apply the active contrast intent to the loaded .quad curves
 * Mirrors legacy applyIntentToLoadedCurve behavior
 */
function applyIntentToLoadedCurve() {
    if (!canApplyIntentRemap()) {
        const hasQuad = !!(getLoadedQuadData()?.curves);
        const measurementActive = !!(LinearizationState?.getGlobalData?.() && LinearizationState.globalApplied);

        if (!hasQuad) {
            showStatus('Load a .quad before remapping intent');
        } else if (measurementActive) {
            showStatus('Disable or remove global measurement data (LAB/CGATS/TI3) before remapping intent');
        } else {
            showStatus('Intent remap is currently unavailable');
        }
        return;
    }

    const loadedData = getLoadedQuadData();
    if (!loadedData || !loadedData.curves) {
        showStatus('No curve data available for intent remap');
        return;
    }

    const channelList = Array.isArray(loadedData.channels) && loadedData.channels.length
        ? [...loadedData.channels]
        : Object.keys(loadedData.curves);

    if (!channelList.length) {
        showStatus('No channels available for intent remap');
        return;
    }

    const intent = getAppState().contrastIntent || { id: 'linear', name: 'Linear' };
    const intentId = String(intent.id || 'linear');
    const intentName = intent.name || 'Linear';
    const restoringLinear = intentId === 'linear';

    const actions = [];
    const updatedChannels = [];
    const total = TOTAL;
    const history = getHistoryManager?.() ?? null;
    const previousBatchFlag = history ? history.isBatchOperation : false;
    if (history) {
        history.isBatchOperation = true;
    }

    try {
        for (const channelName of channelList) {
            const existingCurve = loadedData.curves[channelName];
            if (!Array.isArray(existingCurve) || existingCurve.length === 0) continue;

            const length = existingCurve.length;
            const denom = Math.max(1, length - 1);
            const oldCurve = existingCurve.slice();

            const oldKeyPointsRaw = loadedData.keyPoints?.[channelName] || null;
            const oldKeyPoints = oldKeyPointsRaw ? oldKeyPointsRaw.map(p => ({ input: p.input, output: p.output })) : null;
            const oldInterpolation = loadedData.keyPointsMeta?.[channelName]?.interpolationType || null;
            const oldSource = loadedData.sources?.[channelName];

            let newCurve;
            const originalCurveForChannel = Array.isArray(loadedData.originalCurves?.[channelName])
                ? loadedData.originalCurves[channelName]
                : null;

            if (restoringLinear) {
                const originalCurve = originalCurveForChannel;
                if (!Array.isArray(originalCurve) || originalCurve.length !== length) {
                    console.warn('Intent remap: missing original curve for', channelName);
                    continue;
                }

                const row = getChannelRow(channelName);
                const endInput = row?.querySelector('.end-input');
                const currentEnd = endInput ? InputValidator.clampEnd(endInput.value) : total;
                const baselineEnd = loadedData.baselineEnd?.[channelName] ?? Math.max(...originalCurve, 0);
                const scale = baselineEnd > 0 ? (currentEnd / baselineEnd) : 0;

                newCurve = originalCurve.map((value) => {
                    const scaled = Math.round(value * scale);
                    return Math.max(0, Math.min(total, Number.isFinite(scaled) ? scaled : 0));
                });

                if (newCurve.length) {
                    newCurve[0] = Math.max(0, Math.min(total, Math.round(originalCurve[0] * scale)));
                    newCurve[length - 1] = Math.max(0, Math.min(total, Math.round(originalCurve[length - 1] * scale)));
                }

                try {
                    if (loadedData.keyPoints?.[channelName]) delete loadedData.keyPoints[channelName];
                    if (loadedData.keyPointsMeta?.[channelName]) delete loadedData.keyPointsMeta[channelName];
                    if (loadedData.sources?.[channelName]) delete loadedData.sources[channelName];
                } catch (err) {
                    console.warn('Intent remap: failed clearing Smart metadata for', channelName, err);
                }
            } else {
                const baselineCurve = (Array.isArray(originalCurveForChannel) && originalCurveForChannel.length === length)
                    ? originalCurveForChannel
                    : existingCurve;

                const xs = new Array(length);
                const ys = new Array(length);
                for (let i = 0; i < length; i++) {
                    xs[i] = denom === 0 ? 0 : i / denom;
                    ys[i] = clamp01(baselineCurve[i] / total);
                }

                let sampler = null;
                try {
                    sampler = createPCHIPSpline(xs, ys);
                } catch (err) {
                    console.warn('Intent remap: PCHIP creation failed for', channelName, err);
                }

                const sample = (t) => {
                    const tt = clamp01(t);
                    if (sampler) {
                        try {
                            const val = sampler(tt);
                            if (Number.isFinite(val)) {
                                return clamp01(val);
                            }
                        } catch (err) {
                            console.warn('Intent remap: sampler error for', channelName, err);
                        }
                    }

                    if (tt <= 0) return ys[0];
                    if (tt >= 1) return ys[length - 1];
                    const pos = tt * denom;
                    const i0 = Math.floor(pos);
                    const i1 = Math.min(length - 1, i0 + 1);
                    const frac = pos - i0;
                    return clamp01(ys[i0] + frac * (ys[i1] - ys[i0]));
                };

                newCurve = new Array(length);
                for (let i = 0; i < length; i++) {
                    const inputT = denom === 0 ? 0 : i / denom;
                    const target = clamp01(getTargetRelAt(inputT));
                    const drive = sample(target);
                    newCurve[i] = Math.round(clamp01(drive) * total);
                }

                if (newCurve.length) {
                    newCurve[0] = Math.max(0, Math.min(total, newCurve[0]));
                    newCurve[length - 1] = Math.max(0, Math.min(total, newCurve[length - 1]));
                }

                try {
                    const adaptivePoints = extractAdaptiveKeyPointsFromValues(newCurve, {
                        maxErrorPercent: KP_SIMPLIFY.maxErrorPercent,
                        maxPoints: KP_SIMPLIFY.maxPoints
                    });
                    ControlPoints.persist(channelName, adaptivePoints, oldInterpolation || 'smooth');
                    const meta = loadedData.keyPointsMeta?.[channelName];
                    if (meta && meta.bakedGlobal) {
                        delete meta.bakedGlobal;
                    }
                } catch (err) {
                    console.warn('Intent remap: failed to persist key points for', channelName, err);
                }
            }

            loadedData.curves[channelName] = newCurve;

            let newKeyPoints = null;
            let newInterpolation = null;
            if (!restoringLinear && loadedData.keyPoints?.[channelName]) {
                newKeyPoints = loadedData.keyPoints[channelName].map(p => ({ input: p.input, output: p.output }));
                newInterpolation = loadedData.keyPointsMeta?.[channelName]?.interpolationType || oldInterpolation || 'smooth';
            }

            actions.push({
                channelName,
                type: 'curve',
                oldValue: oldCurve,
                newValue: newCurve.slice(),
                oldKeyPoints,
                newKeyPoints,
                oldInterpolation,
                newInterpolation,
                oldSource,
                newSource: loadedData.sources?.[channelName] ?? oldSource,
                clearKeyPoints: restoringLinear,
                linearRestore: restoringLinear
            });

            updatedChannels.push(channelName);
        }
    } catch (error) {
        if (history) {
            history.isBatchOperation = previousBatchFlag;
        }
        console.error('Intent remap failed:', error);
        showStatus(error?.message ? `Intent remap failed: ${error.message}` : 'Intent remap failed');
        return;
    }

    if (history) {
        history.isBatchOperation = previousBatchFlag;
    }

    if (!actions.length) {
        showStatus('No eligible channel data to remap intent');
        return;
    }

    const description = restoringLinear ? 'Intent remap → Linear (restore original)' : `Intent remap → ${intentName}`;
    if (history?.recordBatchAction) {
        history.recordBatchAction(description, actions);
    }

    try {
        if (typeof updatePreview === 'function') {
            updatePreview();
        } else updatePreview();
    } catch (err) {
        console.warn('Intent remap: failed to update preview', err);
    }

    try { updateInkChart(); } catch (err) { console.warn('Intent remap: chart update failed', err); }
    try { updateCompactChannelsList(); } catch (err) { console.warn('Intent remap: compact list update failed', err); }
    try {
        updatedChannels.forEach((channelName) => {
            try { updateProcessingDetail(channelName); } catch (err) { console.warn('Intent remap: processing detail update failed for', channelName, err); }
        });
    } catch (err) {
        console.warn('Intent remap: processing detail batch update failed', err);
    }

    try { updateSessionStatus(); } catch (err) { console.warn('Intent remap: session status update failed', err); }
    updateIntentDropdownState();

    const statusIntent = restoringLinear ? 'Linear' : intentName;
    showStatus(`Applied ${statusIntent} intent to ${updatedChannels.length} channel${updatedChannels.length === 1 ? '' : 's'}`);
}

if (isBrowser) {
    globalScope.applyIntentToLoadedCurve = applyIntentToLoadedCurve;
}

/**
 * Update channel rows with data from loaded .quad file
 * @param {Object} quadData - Parsed .quad file data
 */
/**
 * Setup virtual checkbox mechanism for a channel row
 * This creates the virtual checkbox that enables/disables channels
 * @param {HTMLElement} tr - Channel row element
 */
export function setupChannelRow(tr) {
    const percentInput = tr.querySelector('.percent-input');
    const endInput = tr.querySelector('.end-input');
    const disabledTag = tr.querySelector('[data-disabled]');
    const processingLabel = tr.querySelector('.processing-label');
    const channelName = tr.dataset.channel;

    ensureOriginalInkSnapshot(tr, channelName);

    if (processingLabel) {
        processingLabel.textContent = '→ Linear ramp';
        processingLabel.setAttribute('title', 'Linear ramp');
        console.log('[status] seeded default label', channelName);
    } else {
        console.log('[status] no processing label found during setup', channelName);
    }

    const perChannelBtn = tr.querySelector('.per-channel-btn');
    const perChannelFile = tr.querySelector('.per-channel-file');
    const perChannelToggle = tr.querySelector('.per-channel-toggle');
    const perChannelRevert = tr.querySelector('.per-channel-revert');

    const { linearization: perChannelLinearizationMap, enabled: perChannelEnabledMap, filenames: perChannelFilenamesMap } = getPerChannelMaps();

    let existingPerChannelData = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName) || null;
    if (existingPerChannelData) {
        perChannelLinearizationMap[channelName] = existingPerChannelData;
        if (!perChannelFilenamesMap[channelName]) {
            perChannelFilenamesMap[channelName] = existingPerChannelData.filename || null;
        }
        const initialEnabled = perChannelEnabledMap[channelName];
        const enabledState = typeof initialEnabled === 'boolean' ? initialEnabled : LinearizationState.isPerChannelEnabled(channelName);
        perChannelEnabledMap[channelName] = enabledState !== false;
        LinearizationState.setPerChannelData(channelName, existingPerChannelData, perChannelEnabledMap[channelName]);
        syncPerChannelAppState(channelName, existingPerChannelData);
    } else {
        perChannelEnabledMap[channelName] = false;
    }

    const hasSmartCurveActive = () => (typeof isSmartCurve === 'function' && isSmartCurve(channelName));

    const refreshPerChannelDisplay = () => {
        const data = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName) || null;
        if (data && perChannelLinearizationMap[channelName] !== data) {
            perChannelLinearizationMap[channelName] = data;
        }
        if (perChannelBtn) {
            if (data) {
                const displayName = getEditedDisplayName(perChannelFilenamesMap[channelName] || data.filename || 'unknown file', !!data.edited);
                perChannelBtn.setAttribute('data-tooltip', `Loaded: ${displayName}`);
            } else {
                perChannelBtn.setAttribute('data-tooltip', 'Load LUT.cube, LABdata.txt, or .acv curve files');
            }
        }
        const hasMeasurement = !!data;
        const smartTag = getLoadedQuadData()?.sources?.[channelName] || null;
        const hasSmart = hasSmartCurveActive() || smartTag === 'smart';

        if (hasMeasurement) {
            tr.removeAttribute('data-allow-toggle');
        }

        const allowToggleFlag = tr.getAttribute('data-allow-toggle') === 'true';
        const shouldAllowToggle = hasMeasurement || hasSmart || allowToggleFlag;

        if (perChannelToggle) {
            const isEnabled = hasMeasurement && (perChannelEnabledMap[channelName] !== false);
            perChannelToggle.disabled = !shouldAllowToggle;
            perChannelToggle.checked = hasMeasurement && isEnabled;
        }
        if (perChannelRevert) {
            perChannelRevert.disabled = !hasMeasurement && !hasSmart;
            if (hasMeasurement) {
                perChannelRevert.title = `Revert ${channelName} to measurement`;
            } else if (hasSmart) {
                perChannelRevert.title = `Clear Smart on ${channelName}`;
            } else {
                perChannelRevert.title = 'No measurement loaded';
            }
            perChannelRevert.classList.toggle('invisible', perChannelRevert.disabled);

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS && channelName === 'MK') {
                console.log('[DEBUG REFRESH] MK button state', {
                    hasMeasurement,
                    hasSmart,
                    disabled: perChannelRevert.disabled
                });
            }
        }
    };

    const handlePerChannelFileLoad = async (file) => {
        if (!file || !perChannelBtn) return;

        try {
            if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                // Capture current channel state for debugging
                if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                    const row = document.querySelector(`[data-channel="${channelName}"]`);
                    const percentInput = row?.querySelector('.percent-input');
                    const checkbox = row?._virtualCheckbox;
                    console.log(`[UNDO DEBUG] Before snapshot for ${channelName}:`, {
                        percent: percentInput?.value,
                        enabled: checkbox?.checked
                    });
                }
                CurveHistory.captureState(`Before: Load Per-Channel Linearization (${channelName})`);
            }

            const extension = file.name.toLowerCase().split('.').pop();
            const fileInput = extension === 'acv' ? await file.arrayBuffer() : await file.text();
            const parsed = await parseLinearizationFile(fileInput, file.name);
            const normalized = normalizeLinearizationEntry(parsed);
            normalized.edited = false;

            perChannelLinearizationMap[channelName] = normalized;
            perChannelEnabledMap[channelName] = true;
            perChannelFilenamesMap[channelName] = file.name;
            existingPerChannelData = normalized;

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[per-channel] parsed 1D LUT', channelName, {
                    format: normalized.format,
                    sampleCount: Array.isArray(normalized.samples) ? normalized.samples.length : 'n/a',
                    first: normalized.samples?.[0],
                    mid: normalized.samples?.[Math.floor((normalized.samples?.length || 1) / 2)],
                    last: normalized.samples?.[normalized.samples?.length - 1]
                });
            }

            LinearizationState.setPerChannelData(channelName, normalized, true);
            syncPerChannelAppState(channelName, normalized);

            if (perChannelToggle) {
                perChannelToggle.disabled = false;
                perChannelToggle.checked = true;
            }

            rebaseChannelsToCorrectedCurves([channelName], { source: 'perChannelLoad' });

            if (typeof updateInterpolationControls === 'function') {
                try { updateInterpolationControls(); } catch (err) { /* ignore */ }
            } else if (typeof globalScope.updateInterpolationControls === 'function') {
                try { globalScope.updateInterpolationControls(); } catch (err) { /* ignore */ }
            }

            const formatLabel = getBasePointCountLabel(normalized) || `${Array.isArray(normalized.samples) ? normalized.samples.length : 0} points`;
            const fmtLower = String(normalized.format || '').toLowerCase();
            let methodNote = '';
            if (fmtLower.includes('lab') || fmtLower.includes('manual')) {
                methodNote = ' (CIE density; Gaussian-weighted reconstruction with PCHIP interpolation)';
            }

            if (normalized.is3DLUT) {
                const count = Array.isArray(normalized.samples) ? normalized.samples.length : 0;
                const sizeSuffix = normalized.lutSize ? ` (${normalized.lutSize}³ grid)` : '';
                showStatus(`Loaded 3D LUT and extracted ${count} neutral axis points for ${channelName}${sizeSuffix}`);
            } else {
                showStatus(`Loaded per-channel correction for ${channelName}: ${formatLabel}${methodNote}`);
            }

            refreshPerChannelDisplay();
            updateProcessingDetail(channelName);
            updateInkChart();
            debouncedPreviewUpdate();

            // Reinitialize Smart Curves if edit mode is active
            if (typeof globalScope.reinitializeChannelSmartCurves === 'function') {
                try {
                    globalScope.reinitializeChannelSmartCurves(channelName);
                } catch (err) {
                    console.warn('[per-channel] Failed to reinitialize Smart Curves for', channelName, err);
                }
            }

            updateSessionStatus();
            updateRevertButtonsState();

            // Capture "After:" snapshot to pair with "Before:" for proper undo/redo
            if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                try {
                    CurveHistory.captureState(`After: Load Per-Channel Linearization (${channelName})`);
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.warn('[per-channel] Failed to capture After snapshot:', err);
                    }
                }
            }
        } catch (error) {
            console.error('Per-channel linearization file error:', error);
            showStatus(`Error loading ${channelName} linearization: ${error.message}`);
            delete perChannelLinearizationMap[channelName];
            delete perChannelFilenamesMap[channelName];
            perChannelEnabledMap[channelName] = false;
            existingPerChannelData = null;
            LinearizationState.clearPerChannel(channelName);
            syncPerChannelAppState(channelName, null);
            if (perChannelToggle) {
                perChannelToggle.disabled = true;
                perChannelToggle.checked = false;
            }
            refreshPerChannelDisplay();
            updateProcessingDetail(channelName);
            updateInkChart();
            refreshEffectiveInkDisplays();
        } finally {
            if (perChannelFile) {
                perChannelFile.value = '';
            }
        }
    };

    if (perChannelBtn) {
        perChannelBtn.addEventListener('click', () => {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[per-channel] load click', channelName, { hasInput: !!perChannelFile });
            }
            if (perChannelFile) {
                try {
                    perChannelFile.value = '';
                } catch (err) {
                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) console.warn('[per-channel] unable to reset file input', err);
                }
                perChannelFile.click();
            } else {
                showStatus(`Unable to open file picker for ${channelName} (input missing)`);
            }
        });
    }

    if (perChannelFile) {
        perChannelFile.addEventListener('change', (event) => {
            const file = event.target?.files?.[0];
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[per-channel] file selected', channelName, { hasFile: !!file, name: file?.name });
            }
            if (file) {
                handlePerChannelFileLoad(file);
            }
        });
    }

    if (perChannelToggle) {
        perChannelToggle.addEventListener('change', (event) => {
            const data = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName);
            if (!data) {
                perChannelToggle.checked = false;
                return;
            }

            const enabled = !!event.target.checked;
            perChannelEnabledMap[channelName] = enabled;
            LinearizationState.setPerChannelData(channelName, data, enabled);
            syncPerChannelAppState(channelName, data);

            showStatus(enabled ? `Enabled per-channel linearization for ${channelName}` : `Disabled per-channel linearization for ${channelName}`);

            refreshPerChannelDisplay();
            updateProcessingDetail(channelName);
            updateInkChart();
            debouncedPreviewUpdate();
            updateRevertButtonsState();
        });
    }

    if (perChannelRevert) {
        perChannelRevert.addEventListener('click', () => {
            const savedSel = (isEditModeEnabled() && typeof EDIT !== 'undefined' && EDIT && EDIT.selectedChannel)
                ? EDIT.selectedChannel
                : null;

            const measurement = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName) || null;
            const hasMeasurement = !!measurement;
            const hasSmart = hasSmartCurveActive();

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[DEBUG REVERT] Per-channel revert click', {
                    channelName,
                    hasMeasurement,
                    hasSmart,
                    measurementLabel: measurement?.filename || measurement?.format || null,
                    linearizationEnabled: LinearizationState.isPerChannelEnabled(channelName)
                });
            }

            if (!hasMeasurement && !hasSmart) {
                showStatus(`No per-channel measurement to revert for ${channelName}`);
                return;
            }

            setRevertInProgress(true);

            try {
                if (typeof CurveHistory !== 'undefined' && CurveHistory && typeof CurveHistory.captureState === 'function') {
                    CurveHistory.captureState(`Before: Revert ${channelName} to Measurement`);
                }

                const manager = typeof getStateManager === 'function' ? getStateManager() : null;
                const loadedData = ensureLoadedQuadData(() => ({ curves: {}, sources: {}, keyPoints: {}, keyPointsMeta: {}, baselineEnd: {}, rebasedCurves: {}, rebasedSources: {} }));
                let restoredBaselines = [];

                if (hasMeasurement) {
                    restoredBaselines = restoreChannelsToRebasedSources([channelName]);

                    tr.removeAttribute('data-allow-toggle');
                    try { measurement.edited = false; } catch (err) {}
                    perChannelEnabledMap[channelName] = true;
                    LinearizationState.setPerChannelData(channelName, measurement, true);
                    syncPerChannelAppState(channelName, measurement);
                    existingPerChannelData = measurement;

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log(`[DEBUG REVERT] Restoring Smart points for ${channelName}`);
                    }

                    const restoreResult = resetChannelSmartPointsToMeasurement(channelName, {
                        skipUiRefresh: true,
                        forceReinitialize: true
                    });

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        const refreshed = ControlPoints.get(channelName)?.points?.length || null;
                        console.log(`[DEBUG REVERT] Post-restore state for ${channelName}`, {
                            restoredFromSeed: restoreResult?.restoredFromSeed,
                            pointCount: refreshed,
                            rebasedBaselineRestored: restoredBaselines.includes(channelName)
                        });
                    }
                } else {
                    tr.setAttribute('data-allow-toggle', 'true');
                    perChannelEnabledMap[channelName] = false;
                    delete perChannelLinearizationMap[channelName];
                    delete perChannelFilenamesMap[channelName];
                    LinearizationState.clearPerChannel(channelName);
                    syncPerChannelAppState(channelName, null);
                    existingPerChannelData = null;

                    let restored = false;
                    const originalCurve = loadedData?.originalCurves?.[channelName];
                    if (Array.isArray(originalCurve) && originalCurve.length) {
                        const originalEnd = Math.max(...originalCurve);
                        const originalPercent = InputValidator.computePercentFromEnd(originalEnd);
                        const percentInput = tr.querySelector('.percent-input');
                        const endInput = tr.querySelector('.end-input');

                        if (percentInput) {
                            percentInput.value = originalPercent.toFixed(1);
                            percentInput.setAttribute('data-base-percent', String(originalPercent));
                            InputValidator.clearValidationStyling(percentInput);
                        }

                        if (endInput) {
                            endInput.value = String(originalEnd);
                            endInput.setAttribute('data-base-end', String(originalEnd));
                            InputValidator.clearValidationStyling(endInput);
                        }

                        if (manager) {
                            try {
                                manager.setChannelValue(channelName, 'percentage', originalPercent);
                                manager.setChannelValue(channelName, 'endValue', originalEnd);
                                manager.setChannelEnabled(channelName, originalEnd > 0);
                            } catch (err) {
                                console.warn('[DEBUG REVERT] Failed to sync state manager for original restore on', channelName, err);
                            }
                        }

                        loadedData.curves = loadedData.curves || {};
                        loadedData.curves[channelName] = originalCurve.slice();
                        loadedData.rebasedCurves = loadedData.rebasedCurves || {};
                        loadedData.rebasedCurves[channelName] = originalCurve.slice();

                        if (loadedData.rebasedSources && loadedData.rebasedSources[channelName]) {
                            delete loadedData.rebasedSources[channelName];
                        }

                        loadedData.baselineEnd = loadedData.baselineEnd || {};
                        loadedData.baselineEnd[channelName] = originalEnd;

                        updateScaleBaselineForChannelCore(channelName);
                        restored = true;
                    } else {
                        if (loadedData.curves?.[channelName]) delete loadedData.curves[channelName];
                        if (loadedData.rebasedCurves?.[channelName]) delete loadedData.rebasedCurves[channelName];
                        if (loadedData.baselineEnd?.[channelName]) delete loadedData.baselineEnd[channelName];
                        if (loadedData.rebasedSources?.[channelName]) delete loadedData.rebasedSources[channelName];
                    }

                    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                        console.log(`[DEBUG REVERT] Cleared per-channel measurement for ${channelName}`, { restored });
                    }
                }

                refreshPerChannelDisplay();

                if (perChannelToggle) {
                    perChannelToggle.disabled = false;
                    perChannelToggle.checked = hasMeasurement;
                }

                showStatus(hasMeasurement
                    ? `Reverted ${channelName} to measurement`
                    : `Cleared Smart on ${channelName} (restored loaded .quad)`);

                if (tr.refreshDisplayFn) {
                    try { tr.refreshDisplayFn(); } catch (err) {}
                }

                updateProcessingDetail(channelName);
                debouncedPreviewUpdate();
                updateInkChart();

                if (typeof updateInterpolationControls === 'function') {
                    try { updateInterpolationControls(); } catch (err) {}
                } else if (typeof globalScope.updateInterpolationControls === 'function') {
                    try { globalScope.updateInterpolationControls(); } catch (err) {}
                }

                updateRevertButtonsState();
                updateSessionStatus();

                try {
                    if (savedSel && isEditModeEnabled()) {
                        const row = Array.from(elements.rows.children).find(tr => tr.getAttribute('data-channel') === savedSel);
                        const endVal = row ? InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0) : 0;
                        if (endVal > 0) {
                            if (elements.editChannelSelect) elements.editChannelSelect.value = savedSel;
                            EDIT.selectedChannel = savedSel;
                            edit_refreshState();
                            updateInkChart();
                        }
                    }
                } catch (err) {}
            } finally {
                setRevertInProgress(false);
                try {
                    updateRevertButtonsState();
                } catch (err) {
                    console.warn('[revert-global] final button refresh failed:', err);
                }
            }
        });
    }

    refreshPerChannelDisplay();

    // Create virtual checkbox object since physical checkbox is removed
    // Chips section now handles enable/disable, but we need compatibility with existing logic
    const enableCheckbox = {
        checked: !tr.hasAttribute('data-user-disabled'),
        addEventListener: function(event, handler) {
            // Store the handler for later use by chips
            tr._checkboxChangeHandler = handler;
        },
        dispatchEvent: function(event) {
            if (tr._checkboxChangeHandler && event.type === 'change') {
                tr._checkboxChangeHandler();
            }
        }
    };

    // Store virtual checkbox on tr for chips access
    tr._virtualCheckbox = enableCheckbox;

    registerChannelRow(channelName, tr);

    // Store original values for restoration when re-enabling
    const originalPercent = parseFloat((percentInput?.getAttribute('data-base-percent') ?? percentInput?.value) || 0);
    const originalEnd = parseFloat((endInput?.getAttribute('data-base-end') ?? endInput?.value) || 0);

    // Store original values on the row element
    tr._originalPercent = originalPercent;
    tr._originalEnd = originalEnd;

    // Set up change handler for virtual checkbox
    enableCheckbox.addEventListener('change', () => {
        if (enableCheckbox.checked) {
            // Enable channel
            tr.removeAttribute('data-user-disabled');
            if (disabledTag) {
                disabledTag.classList.add('invisible');
            }

            // Restore original values if they were stored, otherwise use reasonable defaults
            if (percentInput) {
                if (tr._originalPercent > 0) {
                    setBasePercentOnInput(percentInput, tr._originalPercent);
                    percentInput.value = tr._originalPercent.toString();
                } else {
                    setBasePercentOnInput(percentInput, 100);
                    percentInput.value = '100';
                }
            }
            if (endInput) {
                if (tr._originalEnd > 0) {
                    setBaseEndOnInput(endInput, tr._originalEnd);
                    endInput.value = tr._originalEnd.toString();
                } else {
                    const newEndValue = Math.round((parseFloat(percentInput?.value || 100) / 100) * 65535);
                    setBaseEndOnInput(endInput, newEndValue);
                    endInput.value = newEndValue.toString();
                }
            }
        } else {
            // Disable channel - but first save current values as the new "original" values
            tr._originalPercent = parseFloat((percentInput?.getAttribute('data-base-percent') ?? percentInput?.value) || 0);
            tr._originalEnd = parseFloat((endInput?.getAttribute('data-base-end') ?? endInput?.value) || 0);

            tr.setAttribute('data-user-disabled', 'true');
            if (disabledTag) {
                disabledTag.classList.remove('invisible');
            }

            // Set values to zero
            if (percentInput) {
                setBasePercentOnInput(percentInput, 0);
                percentInput.value = '0';
            }
            if (endInput) {
                setBaseEndOnInput(endInput, 0);
                endInput.value = '0';
            }
        }

        // Update chart after change
        if (typeof updateInkChart === 'function') {
            updateInkChart();
        }

        // Update compact channels list
        updateCompactChannelsList();

        // Update "No channels enabled" message state
        updateNoChannelsMessage();

        // Call refreshDisplay to update channel visibility after value changes
        if (tr.refreshDisplayFn && typeof tr.refreshDisplayFn === 'function') {
            tr.refreshDisplayFn();
        }
    });

    // Create the refreshDisplay function (critical for global scale integration)
    function refreshDisplay() {
        const endVal = InputValidator.clampEnd(endInput.value);
        endInput.value = String(endVal);

        const isUserDisabled = tr.hasAttribute('data-user-disabled');
        const isAtZero = endVal === 0;
        const percentValue = InputValidator.clampPercent(percentInput.value);

        // Show disabled label if channel is at 0 (either user-disabled or set to 0%)
        if (disabledTag) {
            disabledTag.classList.toggle('invisible', !isAtZero);
        }

        // Handle ultra-compact layout for disabled channels
        if (isAtZero) {
            tr.setAttribute('data-compact', 'true');
            tr.style.display = 'none';
        } else {
            tr.setAttribute('data-compact', 'false');
            tr.style.display = '';
        }
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[compact] refresh', channelName, { isAtZero, attr: tr.getAttribute('data-compact') });
        }
        updateCompactChannelsList();

        // Update "No channels enabled" message state
        updateNoChannelsMessage();

        // Update checkbox state based on channel status
        enableCheckbox.checked = !isAtZero;

        if (typeof updateProcessingDetail === 'function') {
            try {
                updateProcessingDetail(tr.dataset.channel);
            } catch (err) {
                console.warn('Failed to refresh processing detail:', err);
            }
        }
    }

    // Store refreshDisplay function on the tr element for access from scaling functions
    tr.refreshDisplayFn = refreshDisplay;

    // Set initial state based on current values
    const currentPercent = parseFloat(percentInput?.value || 0);
    const currentEnd = parseFloat(endInput?.value || 0);

    if (currentPercent > 0 || currentEnd > 0) {
        enableCheckbox.checked = true;
        tr.removeAttribute('data-user-disabled');
        if (disabledTag) {
            disabledTag.classList.add('invisible');
        }
    } else {
        enableCheckbox.checked = false;
        tr.setAttribute('data-user-disabled', 'true');
        if (disabledTag) {
            disabledTag.classList.remove('invisible');
        }
    }

    // CRITICAL: Sync initial channel values to state manager for proper undo/redo
    // Without this, the state manager has empty values and snapshots will be wrong
    try {
        const manager = getStateManager?.() ?? null;
        if (manager && channelName) {
            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log(`[INIT DEBUG] Syncing initial values for ${channelName}: percent=${currentPercent}, end=${currentEnd}`);
            }
            manager.setChannelValue(channelName, 'percentage', currentPercent);
            manager.setChannelValue(channelName, 'endValue', currentEnd);
            manager.setChannelEnabled(channelName, currentPercent > 0 || currentEnd > 0);
        }
    } catch (err) {
        console.warn(`Failed to sync initial channel values for ${channelName}:`, err);
    }

    // Initial refresh to set up display state
    refreshDisplay();
    refreshPerChannelDisplay();
}

registerChannelRowSetup(setupChannelRow);


/**
 * Initialize edit mode button handlers
 * Handles the edit mode toggle button functionality
 */
function initializeEditModeHandlers() {
    const editModeToggleBtn = elements.editModeToggleBtn;

    if (editModeToggleBtn) {
        editModeToggleBtn.addEventListener('click', () => {
            const currentState = isEditModeEnabled();
            setEditMode(!currentState, { recordHistory: true });
        });

        console.log('✅ Edit mode toggle button handler initialized');
    } else {
        console.warn('Edit mode toggle button not found');
    }

    // Initialize edit mode help button
    const editModeHelpBtn = document.getElementById('editModeHelpBtn');
    const editModeHelpPopup = document.getElementById('editModeHelpPopup');
    const closeEditModeHelpBtn = document.getElementById('closeEditModeHelpBtn');

    if (editModeHelpBtn && editModeHelpPopup) {
        editModeHelpBtn.addEventListener('click', () => {
            editModeHelpPopup.classList.remove('hidden');
        });
    }

    if (closeEditModeHelpBtn && editModeHelpPopup) {
        closeEditModeHelpBtn.addEventListener('click', () => {
            editModeHelpPopup.classList.add('hidden');
        });

        // Also close on backdrop click
        editModeHelpPopup.addEventListener('click', (e) => {
            if (e.target === editModeHelpPopup) {
                editModeHelpPopup.classList.add('hidden');
            }
        });
    }

    // Start with edit mode disabled by default
    setEditMode(false, { recordHistory: false });
    console.log('🔄 Edit mode initialized to OFF state');
}

/**
 * Remove all event listeners (cleanup function)
 * This can be used when reinitializing or cleaning up
 */
export function removeEventHandlers() {
    // Note: This is a placeholder for cleanup functionality
    // In practice, we would track listeners and remove them here
    console.log('🧹 Event handlers cleanup requested (placeholder)');
}
function ensureContrastIntentDefault() {
    const preset = getPreset('linear');
    const defaultIntent = {
        id: 'linear',
        name: preset?.label || 'Linear',
        params: preset?.params || {},
        source: 'preset'
    };

    const state = getAppState();
    if (!state.contrastIntent) {
        updateAppState({ contrastIntent: defaultIntent });
    }

    if (isBrowser && !globalScope.contrastIntent) {
        globalScope.contrastIntent = defaultIntent;
    }
}

function setContrastIntent(id, params = {}, source = 'preset') {
    const preset = getPreset(id) || {};
    const mergedParams = { ...(preset.params || {}), ...params };
    const intent = {
        id,
        name: preset.label || id,
        params: mergedParams,
        source
    };

    updateAppState({ contrastIntent: intent });
    if (isBrowser) {
        globalScope.contrastIntent = intent;
    }

    if (typeof updateIntentDropdownState === 'function') {
        updateIntentDropdownState();
    }

    if (typeof updateSessionStatus === 'function') {
        updateSessionStatus();
    }

    updateInkChart();
    debouncedPreviewUpdate();
}
