// quadGEN Graph Status Messages Module
// Handles the session status displayed at the top of the graph window
// Replicates updateSessionStatus functionality from quadgen.html

import { elements, getLoadedQuadData, getAppState } from '../core/state.js';
import { statusMessages } from './status-messages.js';
import { ControlPoints } from '../curves/smart-curves.js';
import { LinearizationState, getEditedDisplayName, getBasePointCountLabel } from '../data/linearization-utils.js';
import { getChannelRow } from './channel-registry.js';
import { getAutoLimitState } from '../core/auto-limit-state.js';
import { registerSessionStatusHandler, triggerInkChartUpdate } from './ui-hooks.js';

const hasDocumentObject = typeof document !== 'undefined';
const canQueryDocument = hasDocumentObject && typeof document.getElementById === 'function';
const canCreateDomNodes = hasDocumentObject && typeof document.createElement === 'function';
const globalScope = typeof window !== 'undefined' ? window : globalThis;
const isBrowser = hasDocumentObject;
const CHART_ZOOM_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function createVirtualSessionStatusElement() {
    return {
        id: 'sessionStatus',
        className: 'virtual-session-status',
        style: {},
        innerHTML: '\u00A0',
        textContent: '\u00A0',
        setAttribute: () => {}
    };
}

/**
 * Graph Status Manager
 * Manages the session status display at the top of the graph
 * Shows quad file, global corrections, intent, and zoom information
 */
export class GraphStatus {
    constructor() {
        this.sessionStatusElement = null;
        this.processingLabels = new Map(); // Track processing labels by channel
        this.isInitialized = false;
        this.lastStatusBaseLine = null;
        this.lastZoomPercent = 100;
    }

    /**
     * Initialize the graph status system
     */
    initialize() {
        if (this.isInitialized) return;

        console.log('🎯 Graph Status system initializing...');

        if (!canQueryDocument) {
            console.log('⚠️ Document APIs unavailable; using virtual session status element for tests/headless runs.');
            this.sessionStatusElement = createVirtualSessionStatusElement();
            if (elements && !elements.sessionStatus) {
                elements.sessionStatus = this.sessionStatusElement;
            }
            this.isInitialized = true;
            return;
        }

        // Find the session status element or create it if needed
        this.sessionStatusElement = document.getElementById('sessionStatus');

        if (!this.sessionStatusElement) {
            console.log('🔍 Session status element not found, creating it...');
            this.createSessionStatusElement();
        } else {
            console.log('✅ Found existing session status element:', this.sessionStatusElement);
            console.log('Element styles:', {
                display: this.sessionStatusElement.style.display,
                visibility: this.sessionStatusElement.style.visibility,
                position: this.sessionStatusElement.style.position,
                className: this.sessionStatusElement.className,
                textContent: this.sessionStatusElement.textContent
            });

            // Element found - let CSS classes control positioning
            console.log('🎯 Using existing session status element with proper styling');
        }

        // Update elements state reference
        if (elements && !elements.sessionStatus) {
            elements.sessionStatus = this.sessionStatusElement;
        }

        this.isInitialized = true;
        console.log('🎯 Graph Status system initialized');

        // Show initial status
        this.updateSessionStatus();

    }

    /**
     * Create the session status element if it doesn't exist
     */
    createSessionStatusElement() {
        console.log('🔍 Attempting to create session status element...');

        if (!canCreateDomNodes) {
            console.log('⚠️ document.createElement unavailable; creating virtual session status element');
            this.sessionStatusElement = createVirtualSessionStatusElement();
            return;
        }

        // For now, let's create a simple visible status element at the top of the page
        // that we can see working, then worry about perfect positioning later
        const statusContainer = document.createElement('div');
        statusContainer.id = 'graphStatusContainer';
        statusContainer.className = 'fixed top-1 right-4 z-50 bg-white bg-opacity-90 px-2 py-1 rounded shadow-sm';
        statusContainer.style.fontSize = '11px';
        statusContainer.style.fontFamily = 'monospace';
        statusContainer.style.border = 'none';

        this.sessionStatusElement = document.createElement('span');
        this.sessionStatusElement.id = 'sessionStatus';
        this.sessionStatusElement.className = 'text-gray-700';
        this.sessionStatusElement.innerHTML = '&nbsp;'; // Non-breaking space for initial state

        statusContainer.appendChild(this.sessionStatusElement);

        // Add it to the body so it's always visible
        if (document.body && typeof document.body.appendChild === 'function') {
            document.body.appendChild(statusContainer);
        }

        console.log('📊 Created session status element at top of page (visible fallback)', {
            element: this.sessionStatusElement,
            container: statusContainer
        });

        // Also try to find the proper graph location for future improvement
        const selectors = [
            '#inkChart',
            '.chart-container',
            '#chartContainer',
            '[id*="chart"]',
            '[class*="chart"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                console.log(`🎯 Found potential graph container: ${selector}`, element);
                // In the future, we could move the status element here
                break;
            }
        }
    }

    /**
     * Update session status display
     * Replicates updateSessionStatus() function from quadgen.html lines 13183-13220
     */
    updateSessionStatus() {
        if (!this.sessionStatusElement) {
            console.log('⚠️ Session status element not found, cannot update status');
            return;
        }

        console.log('🔄 Updating session status...');

        try {
            // Get quad file name
            const loaded = getLoadedQuadData();
            const quadName = loaded && loaded.filename ? loaded.filename : 'none';

            // Get global linearization name
            let globalName = 'none';
            try {
                const globalData = LinearizationState?.getGlobalData?.() || null;
                const globalApplied = LinearizationState?.globalApplied;
                if (globalData && globalApplied) {
                    globalName = elements.globalLinearizationFilename?.textContent ||
                                 globalData.filename || 'data';
                } else {
                    const appState = getAppState();
                    if (appState.linearizationApplied && appState.linearizationData) {
                        globalName = appState.linearizationData.filename || 'data';
                    }
                }
                const bakedMeta = LinearizationState?.getGlobalBakedMeta?.();
                if (bakedMeta) {
                    const bakedLabel = bakedMeta.filename || globalName || 'correction';
                    globalName = `*BAKED* ${bakedLabel}`;
                }
            } catch (err) {}

            // Build intent label (only show when non-linear)
            const stateIntent = (() => {
                try {
                    const state = getAppState();
                    if (state.contrastIntent) return state.contrastIntent;
                } catch (err) {}
                return null;
            })();
            const contrastIntent = stateIntent || (isBrowser ? globalScope.contrastIntent : {}) || {};
            const id = String(contrastIntent.id || 'linear');
            const name = contrastIntent.name || 'Linear';
            const params = contrastIntent.params || {};

            let extra = '';
            if (id === 'soft') extra = ' (γ≈0.85)';
            else if (id === 'hard') extra = ' (γ≈1.20)';
            else if (id === 'custom_gamma') {
                const gamma = params.gamma ?? 1;
                extra = ` (γ=${Number(gamma).toFixed ? Number(gamma).toFixed(2) : gamma})`;
            }
            else if (id === 'filmic' || id === 'custom_filmic') {
                const gain = Number(params.filmicGain ?? params.gain ?? 0.55);
                const shoulder = Number(params.shoulder ?? 0.35);
                extra = ` (gain ${isFinite(gain) ? gain.toFixed(2) : '0.55'}, shoulder ${isFinite(shoulder) ? shoulder.toFixed(2) : '0.35'})`;
            }
            const intentLabel = `${name}${extra}`;

            // Build status parts
            const parts = [];
            if (quadName && quadName !== 'none') parts.push(`Quad: ${quadName}`);
            if (globalName && globalName !== 'none') parts.push(`Global: ${globalName}`);

            // Include Intent only when non-linear
            if (id !== 'linear') {
                parts.push(`Intent: ${intentLabel}`);
            }

            const baseLine = parts.join(' • ');

            // Add zoom level if not 100%
            const zoomPercent = this.getChartZoomPercent();
            let zoomLabel = null;
            if (zoomPercent && zoomPercent !== 100) {
                zoomLabel = `Zoom: ${zoomPercent}% max`;
                parts.push(zoomLabel);
            }

            // Update display
            const line = parts.join(' • ');
            this.sessionStatusElement.textContent = line || '\u00A0'; // Non-breaking space when empty


            console.log('📊 Session status updated:', {
                line: line || '(empty)',
                parts,
                quadName,
                globalName,
                intentId: id,
                zoomPercent: this.getChartZoomPercent()
            });

            // Also log to status messages for Lab Tech visibility
            if (line && line !== '\u00A0') {
                const zoomChangedOnly = baseLine === this.lastStatusBaseLine && zoomPercent !== this.lastZoomPercent;
                if (!zoomChangedOnly) {
                    statusMessages.addStatusMessage(`Graph: ${line}`, 2000); // 2 second throttle
                    console.log('💬 Added graph status to Lab Tech chat:', line);
                } else {
                    console.log('💬 Skipped Lab Tech status message (zoom-only change).');
                }
            }

            // Trigger chart update to show the new session status
            triggerInkChartUpdate();

            this.lastStatusBaseLine = baseLine;
            this.lastZoomPercent = zoomPercent;

        } catch (err) {
            console.warn('Error updating session status:', err);
        }
    }

    /**
     * Get current chart zoom percentage
     * Fallback implementation - should be connected to actual zoom system
     */
    getChartZoomPercent() {
        try {
            const state = getAppState();
            const idx = Number.isFinite(state.chartZoomIndex) ? state.chartZoomIndex : CHART_ZOOM_LEVELS.length - 1;
            return CHART_ZOOM_LEVELS[idx] || 100;
        } catch (err) {
            return 100;
        }
    }

    /**
     * Update processing detail for a channel
     * Replicates the per-channel processing labels shown in the UI
     * @param {string} channelName - Channel name (K, C, M, Y, etc.)
     */


    updateProcessingDetail(channelName) {
        try {
            if (!channelName) return;

            const row = getChannelRow(channelName);
            if (!row) { console.log('[status] missing row', channelName); return; }

            const processingLabel = row.querySelector('.processing-label');
            if (!processingLabel) { console.log('[status] missing label', channelName); return; }

            this.processingLabels.set(channelName, processingLabel);
            console.log('[status] seeded label', channelName);

            // Default state matches legacy: show linear ramp until data proves otherwise
            processingLabel.textContent = '→ Linear ramp';
            processingLabel.setAttribute('title', '→ Linear ramp');

            const loadedData = getLoadedQuadData() || {};
            const curves = loadedData.curves || {};
            const originalCurves = loadedData.originalCurves || {};
            const sources = loadedData.sources || {};
            const keyPointsMeta = (loadedData.keyPointsMeta || {})[channelName] || {};
            const bakedMetaState = typeof LinearizationState.getGlobalBakedMeta === 'function'
                ? LinearizationState.getGlobalBakedMeta()
                : null;
            const isBakedGlobal = !!(keyPointsMeta.bakedGlobal || bakedMetaState);
            const bakedFilename = keyPointsMeta.bakedFilename || bakedMetaState?.filename || null;

            const perInfo = resolvePerChannelLinearization(channelName);
            const globalInfo = resolveGlobalLinearization();

            const segmentsApplied = [];

            const curveValues = curves[channelName];
            const hasCurve = Array.isArray(curveValues);
            let hasSmartCurve = false;
            const sourceTag = sources ? sources[channelName] : null;
            if (sourceTag === 'smart' || sourceTag === 'ai') {
                hasSmartCurve = true;
                const original = originalCurves ? originalCurves[channelName] : null;
                if (arraysEqual(curveValues, original)) {
                    hasSmartCurve = false;
                }
            }

            const smartPointSet = ControlPoints.get(channelName)?.points || null;
            const smartCount = Array.isArray(smartPointSet) ? smartPointSet.length : null;

            const perDisabled = perInfo.data && !perInfo.enabled;
            if (hasSmartCurve && perInfo.data && perDisabled) {
                const displayName = getEditedDisplayName(perInfo.filename || perInfo.data.filename || 'unknown file', perInfo.edited);
                const countLabel = smartCount ? `${smartCount} key points` : getBasePointCountLabel(perInfo.data);
                const segments = [];
                if (isBakedGlobal) {
                    const bakedName = bakedFilename || perInfo.data?.filename || displayName || 'correction';
                    const bakedSegment = smartCount
                        ? `*BAKED* ${bakedName} (${smartCount} key points)`
                        : `*BAKED* ${bakedName}`;
                    segments.push(bakedSegment);
                }
                segments.push(`${displayName} (${countLabel})`);
                const text = segments.join(' • ');
                processingLabel.textContent = text;
                processingLabel.setAttribute('title', text);
                return;
            }

            if (hasCurve) {
                if (hasSmartCurve) {
                    if (isBakedGlobal) {
                        const bakedName = bakedFilename || globalInfo.data?.filename || 'correction';
                        segmentsApplied.push(`*BAKED* ${bakedName}`);
                    }
                    const suffix = smartCount && smartCount > 0 ? ` (${smartCount} key points)` : '';
                    segmentsApplied.push(`Smart Curve${suffix}`);
                } else {
                    const baseFile = loadedData.filename || 'loaded .quad';
                    segmentsApplied.push(baseFile);
                }
            }

            if (perInfo.data && perInfo.enabled) {
                const format = perInfo.data.format || 'curve data';
                const displayName = getEditedDisplayName(perInfo.filename || perInfo.data.filename || 'unknown file', perInfo.edited);
                const countLabel = getBasePointCountLabel(perInfo.data);
                segmentsApplied.push(`channel: ${format} • ${displayName} (${countLabel})`);
            }

            if (globalInfo.data && globalInfo.applied) {
                const format = globalInfo.data.format || 'linearization';
                const displayName = getEditedDisplayName(globalInfo.data.filename || 'unknown file', !!globalInfo.data.edited);
                const countLabel = getBasePointCountLabel(globalInfo.data);
                segmentsApplied.push(`Global: ${format} • ${displayName} (${countLabel})`);
            } else if (globalInfo.data && isBakedGlobal) {
                const format = globalInfo.data.format || 'linearization';
                const displayName = getEditedDisplayName(bakedFilename || globalInfo.data.filename || 'unknown file', !!globalInfo.data.edited);
                const countLabel = getBasePointCountLabel(globalInfo.data);
                segmentsApplied.push(`Global (baked): ${format} • ${displayName} (${countLabel})`);
            }

            const autoSegment = buildAutoLimitSegment(channelName);
            if (autoSegment) {
                segmentsApplied.push(autoSegment);
            }

            if (segmentsApplied.length === 0) {
                processingLabel.textContent = '→ Linear ramp';
                processingLabel.setAttribute('title', 'Linear ramp');
                return;
            }

            const tooltip = segmentsApplied.join(' | ');
            if (segmentsApplied.length > 1) {
                segmentsApplied[0] = `${segmentsApplied[0]} ↴`;
            }

            if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
                console.log('[status] processing segments', channelName, segmentsApplied);
            }

            const html = segmentsApplied
                .map(segment => `<span>${escapeHTML(segment)}</span>`)
                .join('<br>');

            processingLabel.innerHTML = html;
            processingLabel.setAttribute('title', tooltip);
        } catch (err) {
            console.warn(`Error updating processing detail for ${channelName}:`, err);
        }
    }

    /**
     * Add a graph-specific status message
     * Shows temporarily on the graph itself, then fades back to session status
     * @param {string} message - Status message
     * @param {number} duration - How long to show the message (ms, default 2000)
     */
    addGraphStatusMessage(message, duration = 2000) {
        if (!this.sessionStatusElement) return;

        // Store the current session status
        const originalContent = this.sessionStatusElement.textContent;
        const originalColor = this.sessionStatusElement.style.color || '';
        const originalBackground = this.sessionStatusElement.style.backgroundColor || '';

        // Show the temporary message with different styling
        this.sessionStatusElement.textContent = message;
        this.sessionStatusElement.style.color = '#059669'; // Green text
        this.sessionStatusElement.style.backgroundColor = '#ecfdf5'; // Light green background
        this.sessionStatusElement.style.fontWeight = 'bold';

        console.log(`📊 Showing graph message: "${message}" for ${duration}ms`);

        // Trigger chart update to show the temporary message
        triggerInkChartUpdate();

        // Restore original content after the duration
        setTimeout(() => {
            this.sessionStatusElement.textContent = originalContent;
            this.sessionStatusElement.style.color = originalColor;
            this.sessionStatusElement.style.backgroundColor = originalBackground;
            this.sessionStatusElement.style.fontWeight = 'bold'; // Keep bold
            console.log('📊 Restored original session status content');

            // Trigger chart update to clear the temporary message
            triggerInkChartUpdate();
        }, duration);

        // Also send to Lab Tech console
        statusMessages.addStatusMessage(`📊 ${message}`, 1000);
    }

    /**
     * Clear session status
     */
    clearSessionStatus() {
        if (this.sessionStatusElement) {
            this.sessionStatusElement.textContent = '\u00A0';
        }
    }

    /**
     * Connect to global functions for compatibility
     * Makes this system available to the existing codebase
     */
    connectGlobalFunctions() {
        // Make updateSessionStatus available globally
        if (isBrowser) {
            globalScope.updateSessionStatus = () => this.updateSessionStatus();
            globalScope.updateProcessingDetail = (channelName) => this.updateProcessingDetail(channelName);
            globalScope.updateProcessingDetailForce = (channelName) => this.updateProcessingDetail(channelName);

            // Provide graph status reference
            globalScope.graphStatus = this;
        }
    }
}


function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function escapeHTML(value) {
    if (value == null) return '';
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function resolveGlobalLinearization() {
    const result = { data: null, applied: false };
    try {
        const data = typeof LinearizationState.getGlobalData === 'function' ? LinearizationState.getGlobalData() : null;
        if (data) {
            result.data = data;
            result.applied = !!LinearizationState.globalApplied;
        }
    } catch (err) {}

    if (!result.data) {
        try {
            const state = getAppState();
            if (state?.linearizationData) {
                result.data = state.linearizationData;
                result.applied = !!state.linearizationApplied;
            }
        } catch (err) {}
    }

    if (!result.data && isBrowser) {
        result.data = globalScope.linearizationData || null;
        result.applied = !!globalScope.linearizationApplied;
    }

    return result;
}

function resolvePerChannelLinearization(channelName) {
    const result = { data: null, enabled: false, filename: null, edited: false };

    try {
        const data = typeof LinearizationState.getPerChannelData === 'function' ? LinearizationState.getPerChannelData(channelName) : null;
        if (data) {
            result.data = data;
            result.enabled = typeof LinearizationState.isPerChannelEnabled === 'function' ? LinearizationState.isPerChannelEnabled(channelName) : !!data.enabled;
        }
    } catch (err) {}

    if (!result.data) {
        try {
            const state = getAppState();
            const perMap = state?.perChannelLinearization || {};
            if (perMap && perMap[channelName]) {
                result.data = perMap[channelName];
                if (typeof perMap[channelName]?.enabled === 'boolean') {
                    result.enabled = perMap[channelName].enabled;
                }
            }
        } catch (err) {}
    }

    if (!result.data && isBrowser && globalScope.perChannelLinearization) {
        const data = globalScope.perChannelLinearization[channelName];
        if (data) {
            result.data = data;
            if (typeof data.enabled === 'boolean') {
                result.enabled = data.enabled;
            }
        }
    }

    if (isBrowser && globalScope.perChannelEnabled && globalScope.perChannelEnabled[channelName] != null) {
        result.enabled = !!globalScope.perChannelEnabled[channelName];
    }

    if (!result.data) {
        return result;
    }

    if (typeof result.data.enabled === 'boolean' && !result.enabled) {
        result.enabled = result.data.enabled;
    }

    result.edited = !!result.data.edited;
    result.filename = result.data.filename || null;

    if (!result.filename && isBrowser && globalScope.perChannelFilenames) {
        result.filename = globalScope.perChannelFilenames[channelName] || null;
    }

    return result;
}

function buildAutoLimitSegment(channelName) {
    try {
        const autoWhiteOn = !!elements?.autoWhiteLimitToggle?.checked;
        const autoBlackOn = !!elements?.autoBlackLimitToggle?.checked;
        if (!autoWhiteOn && !autoBlackOn) return null;
        const meta = getAutoLimitState()?.[channelName];
        if (!meta) return null;
        const parts = [];
        if (autoBlackOn && meta.black && Number.isFinite(meta.black.widthPercent)) {
            parts.push(`B ${meta.black.widthPercent.toFixed(1)}%`);
        }
        if (autoWhiteOn && meta.white && Number.isFinite(meta.white.widthPercent)) {
            parts.push(`W ${meta.white.widthPercent.toFixed(1)}%`);
        }
        if (!parts.length) return null;
        return `Auto limit: ${parts.join(', ')}`;
    } catch (err) {
        return null;
    }
}
// Create singleton instance
export const graphStatus = new GraphStatus();

// Initialize automatically when module loads
if (!hasDocumentObject) {
    graphStatus.initialize();
    graphStatus.connectGlobalFunctions();
} else if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
        graphStatus.initialize();
        graphStatus.connectGlobalFunctions();
    });
} else {
    graphStatus.initialize();
    graphStatus.connectGlobalFunctions();
}

// Export convenience functions
export function updateSessionStatus() {
    graphStatus.updateSessionStatus();
}

registerSessionStatusHandler(updateSessionStatus);

export function updateProcessingDetail(channelName) {
    graphStatus.updateProcessingDetail(channelName);
}

export function addGraphStatusMessage(message) {
    graphStatus.addGraphStatusMessage(message);
}
