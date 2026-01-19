// quadGEN State Management
// Application state, printer configurations, and DOM element management

import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getLegacyStateBridge } from '../legacy/state-bridge.js';
import { getCorrectionMethod } from './correction-method.js';
import { classifyCurve, CurveShapeClassification } from '../data/curve-shape-detector.js';
import { ensureBellShiftContainer, syncBellShiftFromMeta, clearBellShiftEntry } from './bell-shift-state.js';

const legacyBridge = getLegacyStateBridge();

if (typeof window !== 'undefined') {
    if (typeof window.__USE_SCALING_COORDINATOR === 'undefined') {
        window.__USE_SCALING_COORDINATOR = false;
    }

    if (typeof window.__USE_SCALING_STATE === 'undefined') {
        window.__USE_SCALING_STATE = true;
    }
}

/**
 * Printer configurations for different Epson models
 */
export const PRINTERS = {
    P400: { name: "Epson P400", channels: ["K","C","M","Y","LC","LM"] },
    P800: { name: "Epson P600-P800", channels: ["K","C","M","Y","LC","LM","LK","LLK"] },
    "3880-7880": { name: "Epson 3880-7880", channels: ["K","C","M","Y","LC","LM","LK","LLK"] },
    "x800-x890": { name: "Epson x800-x890", channels: ["K","C","M","Y","LC","LM","LK","LLK"] },
    "x900": { name: "Epson x900", channels: ["K","C","M","Y","LC","LM","LK","LLK","OR","GR"] },
    "P4-6-8000": { name: "Epson P4-6-8000", channels: ["K","C","M","Y","LC","LM","LK","LLK"] },
    "P5-7-9000": { name: "Epson P5-7-9000", channels: ["K","C","M","Y","LC","LM","LK","LLK","OR","GR"] },
    P700P900: { name: "Epson P700-P900", channels: ["K","C","M","Y","LC","LM","LK","LLK","V","MK"] }
};

/**
 * Ink channel colors for UI visualization
 */
export const INK_COLORS = {
    K: "#111111",    // Black
    C: "#00AEEF",    // Cyan
    M: "#EC008C",    // Magenta
    Y: "#FFF200",    // Yellow
    LC: "#8FD3FF",   // Light Cyan
    LM: "#FF9AD5",   // Light Magenta
    LK: "#777777",   // Light Black
    LLK: "#BBBBBB",  // Light Light Black
    OR: "#FF7F00",   // Orange
    GR: "#00A651",   // Green
    V: "#7F00FF",    // Violet
    MK: "#000000"    // Matte Black
};

/**
 * Maximum value for QuadToneRIP (16-bit)
 */
export const TOTAL = 65535;

/**
 * DOM elements cache for efficient access
 * Note: Elements are cached after DOM is ready
 */
export const elements = {
    // Core UI elements
    rows: null,
    printerSelect: null,
    channelInfo: null,
    printerDescription: null,
    downloadBtn: null,
    previewFull: null,
    status: null,

    // Chart elements
    inkChart: null,
    chartCursorTooltip: null,
    chartZoomInBtn: null,
    chartZoomOutBtn: null,
    snapshotFlagOverlay: null,

    // File and input controls
    filenameInput: null,
    linearizationFile: null,
    scaleAllInput: null,
    loadQuadBtn: null,
    quadFile: null,
    referenceQuadFile: null,
    loadReferenceQuadBtn: null,

    // Disabled channels compact view
    disabledChannelsCompact: null,
    disabledChannelsRow: null,

    // Linearization controls
    globalLinearizationBtn: null,
    globalLinearizationHint: null,
    globalLinearizationToggle: null,

    // Auto limit controls
    autoWhiteLimitToggle: null,
    autoBlackLimitToggle: null,
    autoLimitDebugPanel: null,
    autoLimitInputLimitProximity: null,
    autoLimitInputSlopeFactor: null,
    autoLimitInputSustain: null,
    autoLimitInputMinWidth: null,
    autoLimitInputBlackShoulder: null,
    autoLimitInputWhiteToe: null,
    autoLimitInputFallback: null,
    autoLimitApplyBtn: null,
    autoLimitRecalcBtn: null,
    autoLimitResetBtn: null,

    // Curve controls
    curveSmoothingMethod: null,
    catmullTension: null,
    catmullTensionContainer: null,
    smoothingSlider: null,
   smoothingValue: null,
   smoothingWarning: null,
   kpSimplifierContainer: null,
    correctionGainSlider: null,
    correctionGainInput: null,
    correctionGainValue: null,

    // Intent tuning controls
    intentTuningPanel: null,
    tuningInterpolationSelect: null,
    tuningSmoothingPercent: null,
    tuningSmoothingLabel: null,
    tuningSmoothingAlgorithm: null,
    tuningPostPasses: null,
    tuningPostPercent: null,
    tuningPostLabel: null,
    tuningPostAlgorithm: null,
    tuningNeighbors: null,
    tuningSigmaFloor: null,
    tuningApplyBtn: null,
    tuningRestoreBtn: null,

    // Edit mode controls
    editModeToggle: null,
    editModeToggleBtn: null,
    editModeLabel: null,
    editChannelSelect: null,
    editChannelPrev: null,
    editChannelNext: null,
    editKeyPointsContainer: null,
    editPanelBody: null,
    editChannelState: null,
    editPointIndex: null,
    editPointLeft: null,
    editPointRight: null,
    editXYInput: null,
    editDeleteBtn: null,
    editRecomputeBtn: null,
    editNudgeXPos: null,
    editNudgeXNeg: null,
    editNudgeYUp: null,
    editNudgeYDown: null,
    editSmoothingSlider: null,
    editSmoothingValue: null,
    editMaxPoints: null,
    editMaxError: null,
    editDisabledHint: null,
    editBellShiftContainer: null,
    editBellShiftInput: null,
    editBellShiftDec: null,
    editBellShiftInc: null,
    editBellWidthContainer: null,
    bellWidthLeftInput: null,
    bellWidthRightInput: null,
    bellWidthLeftDec: null,
    bellWidthLeftInc: null,
    bellWidthRightDec: null,
    bellWidthRightInc: null,
    bellWidthLinkToggle: null,
    bellWidthResetBtn: null,

    // Chat/AI elements
    chatMessages: null,
    chatInput: null,
    sendChatBtn: null,
    clearChatBtn: null,
    labTechIcon: null,
    sendMessageBtnCompact: null,
    aiInputCompact: null,

    // AI/Smart Curves elements
    aiChevron: null,
    aiCompactBar: null,
    aiContent: null,
    aiInput: null,
    aiInputCompact: null,
    aiLabelToggle: null,
    aiShowStatusToggle: null,
    aiStatus: null,
    aiStatusIcon: null,
    aiToggle: null,

    // Intent/Tuning elements
    applyIntentBtn: null,
    applyIntentToQuadBtn: null,
    intentModal: null,
    intentContent: null,
    intentPresetSelect: null,
    intentImportBtn: null,
    intentImportFile: null,
    intentPasteArea: null,
    cancelIntentBtn: null,
    resetIntentBtn: null,
    closeIntentModal: null,
    contrastIntentSelect: null,
    intentTuningPanel: null,
    tuningApplyBtn: null,
    tuningRestoreBtn: null,

    // Auto limit detailed controls
    autoLimitApplyBtn: null,
    autoLimitRecalcBtn: null,
    autoLimitResetBtn: null,
    autoLimitInputLimitProximity: null,
    autoLimitInputSlopeFactor: null,
    autoLimitInputSustain: null,
    autoLimitInputMinWidth: null,
    autoLimitInputBlackShoulder: null,
    autoLimitInputWhiteToe: null,
    autoLimitInputFallback: null,

    // Help system elements
    helpBtn: null,
    helpPopup: null,
    helpContent: null,
    closeHelpBtn: null,
    helpTabWorkflow: null,
    helpTabReadme: null,
    helpTabHistory: null,
    helpTabGlossary: null,
    editModeHelpBtn: null,
    editModeHelpPopup: null,
    globalCorrectionHelpBtn: null,
    globalCorrectionHelpPopup: null,
    closeGlobalCorrectionHelpBtn: null,
    intentHelpBtn: null,
    intentHelpPopup: null,
    closeIntentHelpBtn: null,
    intentHelpContent: null,

    // Undo/Redo elements
    undoBtn: null,
    redoBtn: null,

    // Global linearization elements
    globalLinearizationBtn: null,
    globalLinearizationDetails: null,
    globalLinearizationFilename: null,
    globalLinearizationInfo: null,
    revertGlobalToMeasurementBtn: null,
    labDensityToggle: null,
    labSmoothingSlider: null,
    labSmoothingValue: null,
    plotSmoothingSlider: null,
    plotSmoothingValue: null,

    // Version and session elements
    appVersion: null,
    helpAppVersion: null,
    sessionStatus: null,
    usageCounter: null,
    pageTitle: null,

    // Theme and settings
    themeToggle: null,

    // Options modal elements
    optionsBtn: null,
    optionsModal: null,
    optionsContent: null,
    closeOptionsBtn: null,
    correctionMethodRadios: null,
    smartPointDragToggle: null,
    correctionOverlayToggle: null,
    labSpotMarkersToggle: null,
    lightBlockingOverlayToggle: null,
    inkLoadOverlayToggle: null,
    inkLoadThresholdInput: null,
    compositeWeightingSelect: null,
    compositeDebugToggle: null,
    autoRaiseInkToggle: null,
    redistributionSmoothingToggle: null,

    // L* modal elements
    lstarModal: null,
    manualLstarBtn: null,
    addLstarInput: null,
    removeLstarInput: null,
    lstarInputs: null,
    lstarCountInput: null,
    lstarValidation: null,
    generateFromLstar: null,
    cancelLstar: null,
    closeLstarModal: null,
    saveLstarTxt: null,
    manualLstarDensityToggle: null,

    // Notes elements
    notesToggle: null,
    notesChevron: null,
    notesContent: null,
    userNotes: null
};

/**
 * Initialize DOM elements cache
 * Should be called after DOM is ready
 */
export function initializeElements() {
    // Core UI elements
    elements.rows = document.getElementById('rows');
    elements.printerSelect = document.getElementById('printerSelect');
    elements.channelInfo = document.getElementById('channelInfo');
    elements.printerDescription = document.getElementById('printerDescription');
    elements.downloadBtn = document.getElementById('downloadBtn');
    elements.previewFull = document.getElementById('previewFull');
    elements.status = document.getElementById('status');

    // Chart elements
    elements.inkChart = document.getElementById('inkChart');
    elements.snapshotFlagOverlay = document.getElementById('snapshotFlagOverlay');
    elements.chartCursorTooltip = document.getElementById('chartCursorTooltip');
    elements.chartZoomInBtn = document.getElementById('chartZoomInBtn');
    elements.chartZoomOutBtn = document.getElementById('chartZoomOutBtn');

    // File and input controls
    elements.filenameInput = document.getElementById('filenameInput');
    elements.linearizationFile = document.getElementById('linearizationFile');
    elements.scaleAllInput = document.getElementById('scaleAllInput');
    elements.loadQuadBtn = document.getElementById('loadQuadBtn');
    elements.quadFile = document.getElementById('quadFile');
    elements.referenceQuadFile = document.getElementById('referenceQuadFile');
    elements.loadReferenceQuadBtn = document.getElementById('loadReferenceQuadBtn');

    // Disabled channels compact view
    elements.disabledChannelsCompact = document.getElementById('disabledChannelsCompact');
    elements.disabledChannelsRow = document.getElementById('disabledChannelsRow');

    // Linearization controls
    elements.globalLinearizationBtn = document.getElementById('globalLinearizationBtn');
    elements.globalLinearizationHint = document.getElementById('globalLinearizationHint');
    elements.globalLinearizationToggle = document.getElementById('globalLinearizationToggle');
    elements.labDensityToggle = document.getElementById('labDensityModeToggle');
    elements.labSmoothingSlider = document.getElementById('labSmoothingPercentSlider');
    elements.labSmoothingValue = document.getElementById('labSmoothingPercentValue');
    elements.plotSmoothingSlider = document.getElementById('plotSmoothingPercentSlider');
    elements.plotSmoothingValue = document.getElementById('plotSmoothingPercentValue');

    // Auto limit controls
    elements.autoWhiteLimitToggle = document.getElementById('autoWhiteLimitToggle');
    elements.autoBlackLimitToggle = document.getElementById('autoBlackLimitToggle');
    elements.autoLimitDebugPanel = document.getElementById('autoLimitDebugPanel');

    // Chat/AI elements
    elements.chatMessages = document.getElementById('chatMessages');
    elements.chatInput = document.getElementById('chatInput');
    elements.sendChatBtn = document.getElementById('sendChatBtn');
    elements.clearChatBtn = document.getElementById('clearChatBtn');
    elements.labTechIcon = document.getElementById('labTechIcon');
    elements.sendMessageBtnCompact = document.getElementById('sendMessageBtnCompact');
    elements.aiInputCompact = document.getElementById('aiInputCompact');

    // AI/Smart Curves elements
    elements.aiChevron = document.getElementById('aiChevron');
    elements.aiCompactBar = document.getElementById('aiCompactBar');
    elements.aiContent = document.getElementById('aiContent');
    elements.aiInput = document.getElementById('aiInput');
    elements.aiInputCompact = document.getElementById('aiInputCompact');
    elements.aiLabelToggle = document.getElementById('aiLabelToggle');
    elements.aiShowStatusToggle = document.getElementById('aiShowStatusToggle');
    elements.aiStatus = document.getElementById('aiStatus');
    elements.aiStatusIcon = document.getElementById('aiStatusIcon');
    elements.aiToggle = document.getElementById('aiToggle');

    // Intent/Tuning elements
    elements.applyIntentBtn = document.getElementById('applyIntentBtn');
    elements.applyIntentToQuadBtn = document.getElementById('applyIntentToQuadBtn');
    elements.intentModal = document.getElementById('intentModal');
    elements.intentContent = document.getElementById('intentContent');
    elements.intentPresetSelect = document.getElementById('intentPresetSelect');
    elements.intentImportBtn = document.getElementById('intentImportBtn');
    elements.intentImportFile = document.getElementById('intentImportFile');
    elements.intentPasteArea = document.getElementById('intentPasteArea');
    elements.cancelIntentBtn = document.getElementById('cancelIntentBtn');
    elements.resetIntentBtn = document.getElementById('resetIntentBtn');
    elements.closeIntentModal = document.getElementById('closeIntentModal');
    elements.contrastIntentSelect = document.getElementById('contrastIntentSelect');
    elements.intentTuningPanel = document.getElementById('intentTuningPanel');
    elements.tuningApplyBtn = document.getElementById('tuningApplyBtn');
    elements.tuningRestoreBtn = document.getElementById('tuningRestoreBtn');

    // Auto limit detailed controls
    elements.autoLimitApplyBtn = document.getElementById('autoLimitApplyBtn');
    elements.autoLimitRecalcBtn = document.getElementById('autoLimitRecalcBtn');
    elements.autoLimitResetBtn = document.getElementById('autoLimitResetBtn');
    elements.autoLimitInputLimitProximity = document.getElementById('autoLimitInputLimitProximity');
    elements.autoLimitInputSlopeFactor = document.getElementById('autoLimitInputSlopeFactor');
    elements.autoLimitInputSustain = document.getElementById('autoLimitInputSustain');
    elements.autoLimitInputMinWidth = document.getElementById('autoLimitInputMinWidth');
    elements.autoLimitInputBlackShoulder = document.getElementById('autoLimitInputBlackShoulder');
    elements.autoLimitInputWhiteToe = document.getElementById('autoLimitInputWhiteToe');
    elements.autoLimitInputFallback = document.getElementById('autoLimitInputFallback');

    // Edit mode controls
    elements.editModeToggle = document.getElementById('editModeToggle');
    elements.editModeToggleBtn = document.getElementById('editModeToggleBtn');
    elements.editModeLabel = document.getElementById('editModeLabel');
    elements.editChannelSelect = document.getElementById('editChannelSelect');
    elements.editChannelPrev = document.getElementById('editChannelPrev');
    elements.editChannelNext = document.getElementById('editChannelNext');
    elements.editPanelBody = document.getElementById('editPanelBody');
    elements.editChannelState = document.getElementById('editChannelState');
    elements.editPointIndex = document.getElementById('editPointIndex');
    elements.editPointLeft = document.getElementById('editPointLeft');
    elements.editPointRight = document.getElementById('editPointRight');
    elements.editXYInput = document.getElementById('editXYInput');
    elements.editDeleteBtn = document.getElementById('editDeleteBtn');
    elements.editRecomputeBtn = document.getElementById('editRecomputeBtn');
    elements.editNudgeXPos = document.getElementById('editNudgeXPos');
    elements.editNudgeXNeg = document.getElementById('editNudgeXNeg');
    elements.editNudgeYUp = document.getElementById('editNudgeYUp');
    elements.editNudgeYDown = document.getElementById('editNudgeYDown');
    elements.editSmoothingSlider = document.getElementById('editSmoothingSlider');
    elements.editSmoothingValue = document.getElementById('editSmoothingValue');
    elements.editMaxPoints = document.getElementById('editMaxPoints');
    elements.editMaxError = document.getElementById('editMaxError');
    elements.editDisabledHint = document.getElementById('editDisabledHint');
    elements.editBellShiftContainer = document.getElementById('editBellShiftContainer');
    elements.editBellShiftInput = document.getElementById('editBellShiftInput');
    elements.editBellShiftDec = document.getElementById('editBellShiftDec');
    elements.editBellShiftInc = document.getElementById('editBellShiftInc');
    elements.editBellWidthContainer = document.getElementById('editBellWidthContainer');
    elements.bellWidthLeftInput = document.getElementById('bellWidthLeftInput');
    elements.bellWidthRightInput = document.getElementById('bellWidthRightInput');
    elements.bellWidthLeftDec = document.getElementById('bellWidthLeftDec');
    elements.bellWidthLeftInc = document.getElementById('bellWidthLeftInc');
    elements.bellWidthRightDec = document.getElementById('bellWidthRightDec');
    elements.bellWidthRightInc = document.getElementById('bellWidthRightInc');
    elements.bellWidthLinkToggle = document.getElementById('bellWidthLinkToggle');
    elements.bellWidthResetBtn = document.getElementById('bellWidthResetBtn');

    // Help system elements
    elements.helpBtn = document.getElementById('helpBtn');
    elements.helpPopup = document.getElementById('helpPopup');
    elements.helpContent = document.getElementById('helpContent');
    elements.closeHelpBtn = document.getElementById('closeHelpBtn');
    elements.helpTabWorkflow = document.getElementById('helpTabWorkflow');
    elements.helpTabReadme = document.getElementById('helpTabReadme');
    elements.helpTabHistory = document.getElementById('helpTabHistory');
    elements.helpTabGlossary = document.getElementById('helpTabGlossary');
    elements.editModeHelpBtn = document.getElementById('editModeHelpBtn');
    elements.editModeHelpPopup = document.getElementById('editModeHelpPopup');
    elements.globalCorrectionHelpBtn = document.getElementById('globalCorrectionHelpBtn');
    elements.globalCorrectionHelpPopup = document.getElementById('globalCorrectionHelpPopup');
    elements.closeGlobalCorrectionHelpBtn = document.getElementById('closeGlobalCorrectionHelpBtn');
    elements.intentHelpBtn = document.getElementById('intentHelpBtn');
    elements.intentHelpPopup = document.getElementById('intentHelpPopup');
    elements.closeIntentHelpBtn = document.getElementById('closeIntentHelpBtn');
    elements.intentHelpContent = document.getElementById('intentHelpContent');

    // Undo/Redo elements
    elements.undoBtn = document.getElementById('undoBtn');
    elements.redoBtn = document.getElementById('redoBtn');

    // Global linearization elements (globalLinearizationBtn assigned earlier in Linearization controls)
    elements.globalLinearizationDetails = document.getElementById('globalLinearizationDetails');
    elements.globalLinearizationFilename = document.getElementById('globalLinearizationFilename');
    elements.globalLinearizationInfo = document.getElementById('globalLinearizationInfo');
    elements.revertGlobalToMeasurementBtn = document.getElementById('revertGlobalToMeasurementBtn');

    // Version and session elements
    elements.appVersion = document.getElementById('appVersion');
    elements.helpAppVersion = document.getElementById('helpAppVersion');
    elements.sessionStatus = document.getElementById('sessionStatus');
    elements.usageCounter = document.getElementById('usageCounter');
    elements.pageTitle = document.getElementById('pageTitle');

    // Theme and settings
    elements.themeToggle = document.getElementById('themeToggle');
    elements.optionsBtn = document.getElementById('optionsBtn');
    elements.optionsModal = document.getElementById('optionsModal');
    elements.optionsContent = document.getElementById('optionsContent');
    elements.closeOptionsBtn = document.getElementById('closeOptionsBtn');
    elements.correctionMethodRadios = Array.from(document.querySelectorAll('input[name="correctionMethod"]'));
    elements.correctionGainSlider = document.getElementById('correctionGainSlider');
    elements.correctionGainInput = document.getElementById('correctionGainInput');
    elements.correctionGainValue = document.getElementById('correctionGainValue');
    elements.smartPointDragToggle = document.getElementById('smartPointDragToggle');
    elements.correctionOverlayToggle = document.getElementById('correctionOverlayToggle');
    elements.labSpotMarkersToggle = document.getElementById('labSpotMarkersToggle');
    elements.lightBlockingOverlayToggle = document.getElementById('lightBlockingOverlayToggle');
    elements.inkLoadOverlayToggle = document.getElementById('inkLoadOverlayToggle');
    elements.inkLoadThresholdInput = document.getElementById('inkLoadThresholdInput');
    elements.compositeWeightingSelect = document.getElementById('compositeWeightingSelect');
    elements.compositeDebugToggle = document.getElementById('compositeDebugToggle');
    elements.autoRaiseInkToggle = document.getElementById('autoRaiseInkToggle');
    elements.redistributionSmoothingToggle = document.getElementById('redistributionSmoothingToggle');

    // L* modal elements
    elements.lstarModal = document.getElementById('lstarModal');
    elements.manualLstarBtn = document.getElementById('manualLstarBtn');
    elements.addLstarInput = document.getElementById('addLstarInput');
    elements.removeLstarInput = document.getElementById('removeLstarInput');
    elements.lstarInputs = document.getElementById('lstarInputs');
    elements.lstarCountInput = document.getElementById('lstarCountInput');
    elements.lstarValidation = document.getElementById('lstarValidation');
    elements.generateFromLstar = document.getElementById('generateFromLstar');
    elements.cancelLstar = document.getElementById('cancelLstar');
    elements.closeLstarModal = document.getElementById('closeLstarModal');
    elements.saveLstarTxt = document.getElementById('saveLstarTxt');
    elements.manualLstarDensityToggle = document.getElementById('manualLstarDensityToggle');

    // Notes elements
    elements.notesToggle = document.getElementById('notesToggle');
    elements.notesChevron = document.getElementById('notesChevron');
    elements.notesContent = document.getElementById('notesContent');
    elements.userNotes = document.getElementById('userNotes');

    // Curve smoothing controls (previously missing)
    elements.curveSmoothingMethod = document.getElementById('curveSmoothingMethod');
    elements.catmullTension = document.getElementById('catmullTension');
    elements.catmullTensionContainer = document.getElementById('catmullTensionContainer');
    elements.smoothingSlider = document.getElementById('smoothingSlider');
    elements.smoothingValue = document.getElementById('smoothingValue');
    elements.smoothingWarning = document.getElementById('smoothingWarning');
    elements.kpSimplifierContainer = document.getElementById('kpSimplifierContainer');

    // Edit mode key points container (previously missing)
    elements.editKeyPointsContainer = document.getElementById('editKeyPointsContainer');

    // Intent tuning detailed controls (previously missing)
    elements.tuningInterpolationSelect = document.getElementById('tuningInterpolationSelect');
    elements.tuningSmoothingPercent = document.getElementById('tuningSmoothingPercent');
    elements.tuningSmoothingLabel = document.getElementById('tuningSmoothingLabel');
    elements.tuningSmoothingAlgorithm = document.getElementById('tuningSmoothingAlgorithm');
    elements.tuningPostPasses = document.getElementById('tuningPostPasses');
    elements.tuningPostPercent = document.getElementById('tuningPostPercent');
    elements.tuningPostLabel = document.getElementById('tuningPostLabel');
    elements.tuningPostAlgorithm = document.getElementById('tuningPostAlgorithm');
    elements.tuningNeighbors = document.getElementById('tuningNeighbors');
    elements.tuningSigmaFloor = document.getElementById('tuningSigmaFloor');

    if (typeof window !== 'undefined') {
        window.elements = elements;
    }

    console.log('✅ DOM elements initialized');
}

/**
 * Get the currently selected printer configuration
 * @returns {Object} Printer configuration object
 */
export function getCurrentPrinter() {
    const printerSelect = elements.printerSelect || document.getElementById('printerSelect');
    if (!printerSelect) {
        return PRINTERS.P700P900; // Default fallback
    }
    return PRINTERS[printerSelect.value] || PRINTERS.P700P900;
}

/**
 * Get current application state
 * @returns {Object} Current state with success flag and data
 */
export function getCurrentState() {
    try {
        const currentPrinter = getCurrentPrinter();
        const channels = {};

        // Collect channel data from UI if available
        if (elements.rows) {
            const rows = Array.from(elements.rows.children).filter(tr => tr.id !== 'noChannelsRow');

            rows.forEach(row => {
                const channelName = row.querySelector('td span span:nth-child(2)')?.textContent?.trim();
                const percentInput = row.querySelector('.percent-input');
                const endInput = row.querySelector('.end-input');

                if (channelName) {
                    channels[channelName] = {
                        percentage: percentInput ? parseFloat(percentInput.value) || 0 : 0,
                        endValue: endInput ? parseInt(endInput.value) || 0 : 0,
                        enabled: (percentInput ? parseFloat(percentInput.value) || 0 : 0) > 0
                    };
                }
            });
        }

        return {
            success: true,
            data: {
                printer: currentPrinter,
                channels: channels,
                filename: elements.filenameInput?.value || 'untitled.quad'
            }
        };
    } catch (error) {
        console.warn('Error getting current state:', error);
        return {
            success: false,
            message: error.message,
            data: {
                printer: PRINTERS.P700P900,
                channels: {},
                filename: 'untitled.quad'
            }
        };
    }
}

/**
 * Application state store for loaded data
 */
const loadedQuadListeners = new Set();
const editModeListeners = new Set();

export const appState = {
    loadedQuadData: null,
    linearizationData: null,
    linearizationApplied: false,
    perChannelLinearization: {},
    referenceQuadData: null,

    // Chart state
    chartZoomIndex: 9, // Default to 100% zoom (index 9 in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    overlayAutoToggledOff: false,
    showCorrectionOverlay: true,
    showLabSpotMarkers: false,
    showLightBlockingOverlay: false,
    showInkLoadOverlay: false,
    inkLoadThreshold: 25,
    plotSmoothingPercent: 0,
    correctionMethod: getCorrectionMethod(),
    correctionGain: 1,

    // Edit mode state
    editMode: false,
    selectedChannel: null,

    // Debug state
    debugLogs: false,
    debugAI: false
};

function refreshChannelShapeMeta(data, channelName = null) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    if (!data.channelShapeMeta || typeof data.channelShapeMeta !== 'object') {
        data.channelShapeMeta = {};
    }
    ensureBellShiftContainer(data);

    const decorateMeta = (channel, result) => {
        const enriched = syncBellShiftFromMeta(data, channel, result);
        if (enriched?.shift) {
            const normalized = {
                ...enriched.shift,
                shiftedApexInputPercent: Number.isFinite(enriched.shift.latestInputPercent)
                    ? enriched.shift.latestInputPercent
                    : enriched.shift.baselineInputPercent,
                shiftedApexOutputPercent: Number.isFinite(enriched.shift.latestOutputPercent)
                    ? enriched.shift.latestOutputPercent
                    : enriched.shift.baselineOutputPercent
            };
            result.bellShift = normalized;
            result.bellWidthScale = enriched.widthScale || null;
        } else {
            result.bellShift = null;
            result.bellWidthScale = null;
        }
        return result;
    };

    const curves = data.curves && typeof data.curves === 'object' ? data.curves : {};
    if (channelName) {
        const curve = curves[channelName];
        const classified = classifyCurve(Array.isArray(curve) ? curve : []);
        data.channelShapeMeta[channelName] = decorateMeta(channelName, classified);
        return data.channelShapeMeta[channelName];
    }
    Object.keys(curves).forEach((channel) => {
        const curve = curves[channel];
        const classified = classifyCurve(Array.isArray(curve) ? curve : []);
        data.channelShapeMeta[channel] = decorateMeta(channel, classified);
    });
    Object.keys(data.channelShapeMeta).forEach((channel) => {
        if (!Object.prototype.hasOwnProperty.call(curves, channel)) {
            delete data.channelShapeMeta[channel];
            clearBellShiftEntry(data, channel);
        }
    });
    return data.channelShapeMeta;
}

try {
    if (typeof localStorage !== 'undefined') {
        if (localStorage.getItem('quadgen.showLabSpotMarkers') === '1') {
            appState.showLabSpotMarkers = true;
        }
        if (localStorage.getItem('quadgen.correctionGain') != null) {
            const storedGain = Number(localStorage.getItem('quadgen.correctionGain'));
            if (Number.isFinite(storedGain)) {
                appState.correctionGain = Math.max(0, Math.min(1, storedGain));
            }
        }
        const inkLoadEnabled = localStorage.getItem('quadgen.inkLoadOverlayEnabled.v1');
        if (inkLoadEnabled === 'true') {
            appState.showInkLoadOverlay = true;
        } else if (inkLoadEnabled === 'false') {
            appState.showInkLoadOverlay = false;
        }
        const storedInkLoadThreshold = localStorage.getItem('quadgen.inkLoadThreshold.v1');
        if (storedInkLoadThreshold != null) {
            const numeric = Number(storedInkLoadThreshold);
            if (Number.isFinite(numeric)) {
                const clamped = Math.max(10, Math.min(400, Math.round(numeric)));
                appState.inkLoadThreshold = clamped;
            }
        }
    }
} catch (error) {
    // Ignore storage access issues (private mode, etc.)
}

/**
 * Set loaded quad data
 * @param {Object} quadData - Loaded quad file data
 */
export function setLoadedQuadData(quadData) {
    const previous = appState.loadedQuadData;
    if (quadData && typeof quadData === 'object') {
        if (!quadData.curves) quadData.curves = {};
        if (!quadData.sources) quadData.sources = {};
        if (!quadData.normalizeToEndChannels || typeof quadData.normalizeToEndChannels !== 'object') {
            quadData.normalizeToEndChannels = {};
        }
        if (!quadData.baselineEnd || typeof quadData.baselineEnd !== 'object') {
            quadData.baselineEnd = {};
        }
        if (!quadData.rebasedCurves || typeof quadData.rebasedCurves !== 'object') {
            quadData.rebasedCurves = {};
            Object.keys(quadData.curves).forEach((channelName) => {
                const curve = quadData.curves?.[channelName];
                if (Array.isArray(curve)) {
                    quadData.rebasedCurves[channelName] = curve.slice();
                }
            });
        }

        if (!quadData.rebasedSources || typeof quadData.rebasedSources !== 'object') {
            quadData.rebasedSources = {};
            Object.keys(quadData.curves).forEach((channelName) => {
                const curve = quadData.curves?.[channelName];
                if (Array.isArray(curve)) {
                    quadData.rebasedSources[channelName] = curve.slice();
                }
            });
        }

        if (!quadData.plotBaseCurves || typeof quadData.plotBaseCurves !== 'object') {
            quadData.plotBaseCurves = {};
            Object.keys(quadData.curves || {}).forEach((channelName) => {
                const curve = quadData.curves?.[channelName];
                if (Array.isArray(curve)) {
                    quadData.plotBaseCurves[channelName] = curve.slice();
                }
            });
        }
        if (!quadData.plotBaseCurvesBaseline || typeof quadData.plotBaseCurvesBaseline !== 'object') {
            quadData.plotBaseCurvesBaseline = {};
        }
        const baselineStore = quadData.plotBaseCurvesBaseline;
        const baselineSource = (quadData.plotBaseCurves && typeof quadData.plotBaseCurves === 'object')
            ? quadData.plotBaseCurves
            : quadData.curves;
        if (baselineSource && typeof baselineSource === 'object') {
            Object.entries(baselineSource).forEach(([channelName, curve]) => {
                if (!baselineStore[channelName] && Array.isArray(curve)) {
                    baselineStore[channelName] = curve.slice();
                }
            });
        }
        if (!quadData._originalBaselineEnd || typeof quadData._originalBaselineEnd !== 'object') {
            quadData._originalBaselineEnd = {};
            if (quadData.baselineEnd && typeof quadData.baselineEnd === 'object') {
                Object.keys(quadData.baselineEnd).forEach((channelName) => {
                    quadData._originalBaselineEnd[channelName] = quadData.baselineEnd[channelName];
                });
            }
        }
        ensureBellShiftContainer(quadData);
        refreshChannelShapeMeta(quadData);
    }
    appState.loadedQuadData = quadData || null;
    syncWindowLoadedQuadData();
    notifyLoadedQuadListeners(previous, appState.loadedQuadData);
}

/**
 * Get loaded quad data
 * @returns {Object|null} Loaded quad data or null
 */
export function getLoadedQuadData() {
    if (appState.loadedQuadData) {
        refreshChannelShapeMeta(appState.loadedQuadData);
    }
    return appState.loadedQuadData;
}

export function getChannelShapeMeta(channelName = null) {
    const data = getLoadedQuadData();
    if (!data) {
        return channelName ? null : {};
    }
    const meta = refreshChannelShapeMeta(data, channelName || undefined);
    if (channelName) {
        return meta || null;
    }
    return { ...(meta || {}) };
}

export function ensureLoadedQuadData(initialValue = { curves: {}, sources: {}, normalizeToEndChannels: {} }) {
    if (!appState.loadedQuadData) {
        appState.loadedQuadData = typeof initialValue === 'function' ? initialValue() : { ...initialValue };
        if (!appState.loadedQuadData.curves) appState.loadedQuadData.curves = {};
        if (!appState.loadedQuadData.sources) appState.loadedQuadData.sources = {};
        if (!appState.loadedQuadData.normalizeToEndChannels || typeof appState.loadedQuadData.normalizeToEndChannels !== 'object') {
            appState.loadedQuadData.normalizeToEndChannels = {};
        }
        if (!appState.loadedQuadData.baselineEnd || typeof appState.loadedQuadData.baselineEnd !== 'object') {
            appState.loadedQuadData.baselineEnd = {};
        }
        if (!appState.loadedQuadData.rebasedCurves || typeof appState.loadedQuadData.rebasedCurves !== 'object') {
            appState.loadedQuadData.rebasedCurves = {};
        }
        if (!appState.loadedQuadData.rebasedSources || typeof appState.loadedQuadData.rebasedSources !== 'object') {
            appState.loadedQuadData.rebasedSources = {};
        }
        if (!appState.loadedQuadData.channelShapeMeta || typeof appState.loadedQuadData.channelShapeMeta !== 'object') {
            appState.loadedQuadData.channelShapeMeta = {};
        }
        if (!appState.loadedQuadData.bellCurveShift || typeof appState.loadedQuadData.bellCurveShift !== 'object') {
            appState.loadedQuadData.bellCurveShift = {};
        }
        refreshChannelShapeMeta(appState.loadedQuadData);
        syncWindowLoadedQuadData();
        notifyLoadedQuadListeners(null, appState.loadedQuadData);
    }
    return appState.loadedQuadData;
}

/**
 * Check if channel should normalize curve to End value.
 *
 * Default behavior (as of bell curve support):
 * - BELL curves: return false (preserve bell shape, don't stretch to End)
 * - All other curves: return true (normalize to End for consistent output)
 *
 * Can be overridden per-channel via data.normalizeToEndChannels map.
 *
 * @param {string} channelName - Channel to check
 * @returns {boolean} True if channel should normalize to End
 */
export function isChannelNormalizedToEnd(channelName) {
    if (!channelName) return false;
    const data = appState.loadedQuadData;
    if (!data) return false;

    const map = data.normalizeToEndChannels || {};
    if (Object.prototype.hasOwnProperty.call(map, channelName)) {
        return !!map[channelName];
    }

    const meta = (data.channelShapeMeta && data.channelShapeMeta[channelName])
        || refreshChannelShapeMeta(data, channelName);
    if (meta?.classification === CurveShapeClassification.BELL) {
        return false;
    }
    return true;
}

export function subscribeLoadedQuadData(callback) {
    if (typeof callback !== 'function') return () => {};
    loadedQuadListeners.add(callback);
    return () => {
        loadedQuadListeners.delete(callback);
    };
}

export function getEditModeFlag() {
    return !!appState.editMode;
}

export function setEditModeFlag(value) {
    const previous = !!appState.editMode;
    const next = !!value;
    if (previous === next) {
        syncWindowEditModeFlag();
        return appState.editMode;
    }
    appState.editMode = next;
    syncWindowEditModeFlag();
    notifyEditModeListeners(previous, next);
    return appState.editMode;
}

export function subscribeEditModeFlag(callback) {
    if (typeof callback !== 'function') return () => {};
    editModeListeners.add(callback);
    return () => {
        editModeListeners.delete(callback);
    };
}

/**
 * Reference quad data management
 */
export function getReferenceQuadData() {
    return appState.referenceQuadData;
}

export function setReferenceQuadData(data) {
    if (data && typeof data === 'object') {
        appState.referenceQuadData = {
            filename: data.filename || '',
            channels: Array.isArray(data.channels) ? data.channels.slice() : [],
            curves: data.curves && typeof data.curves === 'object'
                ? Object.fromEntries(
                    Object.entries(data.curves).map(([ch, curve]) => [
                        ch,
                        Array.isArray(curve) ? curve.slice() : []
                    ])
                  )
                : {}
        };
    } else {
        appState.referenceQuadData = null;
    }
}

export function clearReferenceQuadData() {
    const clearedFilename = appState.referenceQuadData?.filename;
    appState.referenceQuadData = null;
    return clearedFilename;
}

export function isReferenceQuadLoaded() {
    return !!appState.referenceQuadData;
}

export function hasReferenceCurve(channelName) {
    if (!appState.referenceQuadData) return false;
    const curve = appState.referenceQuadData.curves?.[channelName];
    return Array.isArray(curve) && curve.length > 0;
}

/**
 * Update application state
 * @param {Object} updates - Partial state updates
 */
export function updateAppState(updates) {
    Object.assign(appState, updates);
}

/**
 * Get application state
 * @returns {Object} Current application state
 */
export function getAppState() {
    return { ...appState };
}

export function getPlotSmoothingPercent() {
    return Number.isFinite(appState.plotSmoothingPercent)
        ? appState.plotSmoothingPercent
        : 0;
}

export function setPlotSmoothingPercent(percent) {
    const numeric = Number(percent);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(600, Math.round(numeric))) : 0;
    appState.plotSmoothingPercent = clamped;
    return clamped;
}

export function getCorrectionGain() {
    const value = Number(appState.correctionGain);
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.max(0, Math.min(1, value));
}

export function getCorrectionGainPercent() {
    return Math.round(getCorrectionGain() * 100);
}

export function setCorrectionGain(normalizedValue, options = {}) {
    const numeric = Number(normalizedValue);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
    const previous = getCorrectionGain();
    if (Math.abs(previous - clamped) <= 0.0005) {
        return previous;
    }
    appState.correctionGain = clamped;
    const { persist = true } = options || {};
    if (persist) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('quadgen.correctionGain', String(clamped));
            }
        } catch (error) {
            console.warn('Failed to persist correction gain:', error);
        }
    }
    return clamped;
}

/**
 * Reset application state to defaults
 */
export function resetAppState() {
    // Core data state
    appState.loadedQuadData = null;
    appState.linearizationData = null;
    appState.linearizationApplied = false;
    appState.perChannelLinearization = {};
    appState.perChannelEnabled = {};

    // Chart/UI state
    appState.chartZoomIndex = 0;
    appState.overlayAutoToggledOff = false;
    appState.showCorrectionOverlay = true;
    appState.showLabSpotMarkers = false;
    appState.showLightBlockingOverlay = false;
    appState.showInkLoadOverlay = false;
    appState.inkLoadThreshold = 25;

    // Edit mode state
    appState.editMode = false;
    appState.selectedChannel = null;

    // Correction state
    appState.correctionMethod = getCorrectionMethod();
    appState.correctionGain = 1;

    // Scaling state
    appState.scaleAllPercent = 100;
    appState.scaleBaselineEnds = null;

    // Sync legacy bridges
    syncWindowLoadedQuadData();
    notifyLoadedQuadListeners(null, null);

    // Clear LinearizationState singleton (if available)
    try {
        const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
        if (globalScope.LinearizationState?.clear) {
            globalScope.LinearizationState.clear();
        }
    } catch (err) {
        // Silently ignore if not available
    }

    // Invalidate curve cache (if available)
    try {
        const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
        if (typeof globalScope.invalidateMake256Cache === 'function') {
            globalScope.invalidateMake256Cache();
        }
    } catch (err) {
        // Silently ignore if not available
    }

    // Clear history (if available)
    try {
        const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
        if (typeof globalScope.clearHistory === 'function') {
            globalScope.clearHistory();
        }
    } catch (err) {
        // Silently ignore if not available
    }

    console.log('Application state reset');
}

function syncWindowLoadedQuadData() {
    legacyBridge.setLoadedQuadData(appState.loadedQuadData);
}

function notifyLoadedQuadListeners(previous, current) {
    const prevSnapshot = previous ? deepClone(previous) : null;
    const currSnapshot = current ? deepClone(current) : null;
    loadedQuadListeners.forEach((callback) => {
        try {
            callback(currSnapshot, prevSnapshot);
        } catch (error) {
            console.warn('Error in loadedQuadData listener:', error);
        }
    });
}

function syncWindowEditModeFlag() {
    legacyBridge.setEditModeFlag(appState.editMode === true);
}

function notifyEditModeListeners(previous, current) {
    editModeListeners.forEach((callback) => {
        try {
            callback(current, previous);
        } catch (error) {
            console.warn('Error in editMode listener:', error);
        }
    });
}

function deepClone(value) {
    if (!value) return value;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (err) {
            // Fallback to JSON route below
        }
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (err) {
        return Array.isArray(value) ? value.slice() : { ...value };
    }
}

const legacyLoadedQuadData = legacyBridge.getLoadedQuadData();
if (legacyLoadedQuadData && !appState.loadedQuadData) {
    appState.loadedQuadData = legacyLoadedQuadData;
    refreshChannelShapeMeta(appState.loadedQuadData);
}

const legacyEditModeFlag = legacyBridge.getEditModeFlag();
if (legacyEditModeFlag !== null) {
    appState.editMode = legacyEditModeFlag;
}

registerDebugNamespace('coreState', {
    getLoadedQuadData,
    setLoadedQuadData,
    subscribeLoadedQuadData,
    ensureLoadedQuadData,
    getChannelShapeMeta,
    getEditModeFlag,
    setEditModeFlag,
    subscribeEditModeFlag,
    getAppState,
    updateAppState,
    resetAppState
});

legacyBridge.registerHelpers({
    getLoadedQuadData,
    setLoadedQuadData,
    subscribeLoadedQuadData,
    getEditModeFlag,
    setEditModeFlag,
    subscribeEditModeFlag,
    getChannelShapeMeta
});

if (typeof window !== 'undefined') {
    try {
        window.getChannelShapeMeta = getChannelShapeMeta;
    } catch (err) {
        // ignore global assignment failure
    }
}

syncWindowLoadedQuadData();
syncWindowEditModeFlag();
