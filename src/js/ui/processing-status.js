// quadGEN Processing Status System
// Channel processing detail labels and status display

import { elements, getCurrentPrinter, getLoadedQuadData, getChannelShapeMeta } from '../core/state.js';
import { ControlPoints } from '../curves/smart-curves.js';
import { LinearizationState, getEditedDisplayName, getBasePointCountLabel } from '../data/linearization-utils.js';
import { getAutoLimitState } from '../core/auto-limit-state.js';
import { registerProcessingDetailHandler, registerProcessingDetailAllHandler } from './ui-hooks.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers } from '../legacy/legacy-helpers.js';

/**
 * Helper function to get channel row element
 * @param {string} channelName - Channel name
 * @returns {HTMLElement|null} Channel row element
 */
function getChannelRow(channelName) {
    if (typeof document === 'undefined') return null;
    return document.querySelector(`tr[data-channel="${channelName}"]`);
}

function resolveBadgeIcon(classification) {
    switch (classification) {
        case 'bell':
            return { icon: '🔔', label: 'Bell curve' };
        case 'monotonic':
            return { icon: '📈', label: 'Monotonic rise' };
        case 'flat':
            return { icon: '➡️', label: 'Flat profile' };
        default:
            return { icon: '', label: 'Curve profile' };
    }
}

function updateChannelShapeBadge(channelName) {
    if (typeof document === 'undefined') return;
    const row = getChannelRow(channelName);
    const badge = row?.querySelector('[data-channel-shape]');
    if (!badge) return;
    const meta = getChannelShapeMeta(channelName);
    if (!meta || !meta.classification || meta.classification === 'unknown') {
        badge.classList.add('hidden');
        badge.removeAttribute('data-shape-type');
        badge.removeAttribute('title');
        return;
    }

    const { icon, label } = resolveBadgeIcon(meta.classification);
    if (!icon) {
        badge.classList.add('hidden');
        return;
    }
    const apexPercent = typeof meta.peakInputPercent === 'number'
        ? `${meta.peakInputPercent.toFixed(1)}% input`
        : '—';
    const confidencePercent = Number.isFinite(meta.confidence)
        ? `${(meta.confidence * 100).toFixed(0)}% confidence`
        : null;
    const tooltipSegments = [
        label,
        `Apex ${apexPercent}`,
        confidencePercent
    ].filter(Boolean);

    badge.textContent = icon;
    badge.setAttribute('title', tooltipSegments.join(' • '));
    badge.setAttribute('aria-label', tooltipSegments[0] || label);
    badge.setAttribute('role', 'img');
    badge.dataset.shapeType = meta.classification;
    badge.classList.remove('hidden');
}

/**
 * Helper function to determine if Smart Curve is effectively applied
 * (ignores tag if curve matches original .quad)
 * @param {string} channelName - Channel name
 * @returns {boolean} True if Smart Curve is effectively applied
 */
function isSmartEffective(channelName) {
    try {
        const loadedData = getLoadedQuadData();
        const tag = loadedData?.sources?.[channelName];
        let smart = (tag === 'smart' || tag === 'ai');
        if (smart) {
            const curv = loadedData?.curves?.[channelName];
            const orig = loadedData?.originalCurves?.[channelName];
            if (Array.isArray(curv) && Array.isArray(orig) && curv.length === orig.length) {
                const same = curv.every((v, i) => v === orig[i]);
                if (same) smart = false;
            }
        }
        return smart;
    } catch (err) {
        return false;
    }
}

/**
 * Update processing detail label for a channel
 * This shows what processing steps are active for each channel
 * @param {string} channelName - Channel name
 */
export function updateProcessingDetail(channelName) {
    try {
        const row = getChannelRow(channelName);
        const processingLabel = row ? row.querySelector('.processing-label') : null;
        if (!processingLabel) return;

        const segmentsApplied = [];
        const loadedData = getLoadedQuadData();

        // Check for Smart Curve vs loaded .quad
        const hasSmartCurve = !!(loadedData &&
            loadedData.curves &&
            loadedData.curves[channelName] &&
            isSmartEffective(channelName));

        // Get per-channel linearization data
        const perChannelData = LinearizationState.getPerChannelData(channelName);
        const perChannelEnabled = LinearizationState.isPerChannelEnabled(channelName);
        const perIsDisabled = !!(perChannelData && !perChannelEnabled);

        // Consolidated display: Smart Curve with disabled per-channel source
        if (hasSmartCurve && perChannelData && perIsDisabled) {
            const baseName = perChannelData.filename || 'unknown file';
            const dispName = getEditedDisplayName(baseName, !!perChannelData.edited);
            const smartPts = ControlPoints.get(channelName)?.points;
            const smartCount = Array.isArray(smartPts) ? smartPts.length : null;
            const countLabel = smartCount ? `${smartCount} key points` : getBasePointCountLabel(perChannelData);
            const text = `${dispName} (${countLabel})`;
            processingLabel.textContent = text;
            processingLabel.setAttribute('title', text);
            return; // Don't list separate Smart/per-channel lines
        }

        // Base curve segment (Smart vs loaded .quad)
        if (loadedData && loadedData.curves && loadedData.curves[channelName]) {
            const isSmart = isSmartEffective(channelName);
            if (isSmart) {
                const kp = ControlPoints.get(channelName)?.points;
                const kpLabel = Array.isArray(kp) ? ` (${kp.length} key points)` : '';
                segmentsApplied.push(`Smart Curve${kpLabel}`);
            } else {
                const baseFile = loadedData.filename || 'loaded .quad';
                segmentsApplied.push(`${baseFile}`);
            }
        }

        // Per-channel linearization segment
        if (perChannelData) {
            const format = perChannelData.format || 'curve data';
            const baseName = perChannelData.filename || 'unknown file';
            const dispName = getEditedDisplayName(baseName, !!perChannelData.edited);
            const countLabel = getBasePointCountLabel(perChannelData);
            if (perChannelEnabled) {
                segmentsApplied.push(`channel: ${format} • ${dispName} (${countLabel})`);
            }
        }

        // Global linearization segment
        const globalData = LinearizationState.getGlobalData();
        const globalApplied = LinearizationState.globalApplied;
        const bakedMeta = typeof LinearizationState.getGlobalBakedMeta === 'function'
            ? LinearizationState.getGlobalBakedMeta()
            : null;
        if (globalData && Array.isArray(globalData.samples)) {
            const format = globalData.format || 'linearization';
            const baseName = (bakedMeta?.filename) || globalData.filename || 'unknown file';
            const dispName = getEditedDisplayName(baseName, !!globalData.edited);
            const countLabel = getBasePointCountLabel(globalData);
            if (globalApplied) {
                segmentsApplied.push(`Global: ${format} • ${dispName} (${countLabel})`);
            } else if (bakedMeta) {
                segmentsApplied.push(`Global (baked): ${format} • ${dispName} (${countLabel})`);
            }
        } else if (bakedMeta && bakedMeta.filename) {
            segmentsApplied.push(`Global (baked): ${bakedMeta.filename}`);
        }

        // Auto endpoint rolloff annotation (if enabled and detected)
        try {
            const autoWhiteOn = !!elements?.autoWhiteLimitToggle?.checked;
            const autoBlackOn = !!elements?.autoBlackLimitToggle?.checked;
            const autoLimitState = getAutoLimitState();
            const meta = autoLimitState?.[channelName];
            if ((autoWhiteOn || autoBlackOn) && meta) {
                const parts = [];
                if (autoBlackOn && meta.black && isFinite(meta.black.widthPercent)) {
                    parts.push(`B ${meta.black.widthPercent.toFixed(1)}%`);
                }
                if (autoWhiteOn && meta.white && isFinite(meta.white.widthPercent)) {
                    parts.push(`W ${meta.white.widthPercent.toFixed(1)}%`);
                }
                if (parts.length) {
                    segmentsApplied.push(`Auto limit: ${parts.join(', ')}`);
                }
            }
        } catch (err) {
            // Auto limit processing may not be available
        }

        // Build display text
        if (segmentsApplied.length === 0) {
            processingLabel.textContent = '→ Linear ramp';
            processingLabel.setAttribute('title', 'Linear ramp');
        } else {
            // Show segments, clean tooltip without decoration
            const cleanText = segmentsApplied.join(' • ');
            const displayText = `→ ${cleanText}`;
            processingLabel.textContent = displayText;
            processingLabel.setAttribute('title', cleanText);
        }

        updateChannelShapeBadge(channelName);

    } catch (error) {
        console.warn(`Error updating processing detail for ${channelName}:`, error);
    }
}

/**
 * Update processing details for all channels
 */
export function updateAllProcessingDetails() {
    try {
        const printer = getCurrentPrinter();
        if (printer && printer.channels) {
            printer.channels.forEach(channelName => {
                updateProcessingDetail(channelName);
            });
        }
    } catch (error) {
        console.warn('Error updating all processing details:', error);
    }
}

registerProcessingDetailHandler(updateProcessingDetail);
registerProcessingDetailAllHandler(updateAllProcessingDetails);

/**
 * Initialize processing status system
 */
export function initializeProcessingStatus() {
    console.log('📊 Initializing processing status system...');

    // Update all channel processing details on startup
    updateAllProcessingDetails();

    console.log('✅ Processing status system initialized');
}

registerLegacyHelpers({
    updateProcessingDetail,
    updateAllProcessingDetails,
    initializeProcessingStatus
});

registerDebugNamespace('processingStatus', {
    updateProcessingDetail,
    updateAllProcessingDetails,
    initializeProcessingStatus
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['updateProcessingDetail', 'updateAllProcessingDetails']
});
