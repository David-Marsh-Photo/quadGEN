// quadGEN Main Entry Point
// Build system entry - imports CSS and initializes application


// Import core modules (start of modular extraction)
import {
    APP_VERSION,
    APP_DISPLAY_VERSION,
    DEBUG_LOGS
} from './js/core/version.js';

// Import configuration
import {
    LAB_TUNING,
    AUTO_LIMIT_DEFAULTS,
    CONTRAST_INTENT_PRESETS
} from './js/core/config.js';

// Import mathematical functions
import {
    clamp01,
    createPCHIPSpline,
    createCubicSpline,
    gammaMap
} from './js/math/interpolation.js';

// Import UI components
import {
    normalizeDisplayMax,
    clampPercentForDisplay,
    mapPercentToY,
    mapPercentToX,
    getChartColors,
    createChartGeometry,
    drawChartGrid
} from './js/ui/chart-utils.js';

import {
    initializeEventHandlers,
    initializeAutoLimitHandlers,
    removeEventHandlers
} from './js/ui/event-handlers.js';

import {
    initializeEditMode,
    isEditModeEnabled,
    setEditMode
} from './js/ui/edit-mode.js';

import {
    updateCompactChannelsList
} from './js/ui/compact-channels.js';

import {
    initializeChart,
    updateInkChart,
    getChartZoomPercent,
    setChartZoomPercent,
    stepChartZoom,
    getChartCoordinates,
    setChartZoomIndex,
    getChartZoomIndex,
    CHART_ZOOM_LEVELS
} from './js/ui/chart-manager.js';

import {
    initializePreview,
    updatePreview,
    buildFile as buildQuadPreview
} from './js/ui/quad-preview.js';

import { initializeManualLstar } from './js/ui/manual-lstar.js';

import {
    initializeTheme
} from './js/ui/theme-manager.js';

import {
    initializeIntentSystem
} from './js/ui/intent-system.js';

import './js/ui/labtech-summaries.js';

import {
    drawChartAxes,
    drawCurve,
    renderChartFrame
} from './js/ui/chart-renderer.js';

import {
    debounce,
    formatScalePercent,
    sanitizeFilename,
    clampPercent,
    isValidNumber,
    safeParseNumber
} from './js/ui/ui-utils.js';

import {
    updateNoChannelsMessage
} from './js/ui/compact-channels.js';

import {
    initializePrinterUI
} from './js/ui/printer-manager.js';

// NOTE: File parsers now consolidated in file-parsers.js module

// Import data processing utilities
import {
    CURVE_RESOLUTION,
    AUTO_LIMIT_CONFIG,
    DataSpace,
    lerp,
    clamp,
    createLinearRamp,
    scaleValues,
    normalizeToMax,
    resampleArray,
    validateCurveData,
    createEmptyCurve
} from './js/data/processing-utils.js';

// Import Smart Curves system
import {
    KP_SIMPLIFY,
    ControlPolicy,
    ControlPoints,
    isSmartCurve,
    isSmartCurveSourceTag,
    generateCurveFromKeyPoints,
    extractAdaptiveKeyPointsFromValues,
    rescaleSmartCurveForInkLimit,
    validateKeyPoints,
    createDefaultKeyPoints,
    normalizeSmartSourcesInLoadedData,
    simplifySmartKeyPointsFromCurve
} from './js/curves/smart-curves.js';

// Import Linearization utilities
import {
    LinearizationState,
    normalizeLinearizationEntry,
    applyLinearizationExtras,
    ensurePrinterSpaceData,
    getGlobalLinearizationInterpolationType,
    createLinearizationData,
    validateLinearizationData,
    markLinearizationEdited,
    getEditedDisplayName,
    getBasePointCountLabel,
    cloneLinearizationData
} from './js/data/linearization-utils.js';

// Import Core Processing Pipeline
import {
    PROCESSING_CONSTANTS,
    AutoEndpointRolloff,
    buildBaseCurve,
    applyPerChannelLinearizationStep,
    applyGlobalLinearizationStep,
    applyAutoEndpointAdjustments,
    make256,
    apply1DLUT,
    buildFile
} from './js/core/processing-pipeline.js';

// Import File Format Parsers
import {
    parseQuadFile,
    parseACVFile,
    parseCube1D,
    parseCube3D,
    parseCgatsNumber,
    parseCGATS17,
    parseLabData,
    parseLinearizationFile,
    parseManualLstarData,
    parseIntentPaste,
    validateFileFormat,
    validateQuadFile
} from './js/parsers/file-parsers.js';

// Import AI integration
import {
    QuadGenActions,
    createQuadGenActions
} from './js/ai/ai-actions.js';

import {
    AI_CONFIG,
    CLAUDE_FUNCTIONS,
    getAIProviderConfig,
    validateAIFunctionCall
} from './js/ai/ai-config.js';

// Import scaling utilities
import {
    applyGlobalScale,
    scaleChannelEndsByPercent,
    updateScaleBaselineForChannel,
    resetGlobalScale,
    getCurrentScale
} from './js/core/scaling-utils.js';

// Import Chat Interface
import {
    ChatInterface,
    getChatInterface,
    sendChatMessage,
    shouldShowAssistantStatus,
    initializeChatInterface
} from './js/ai/chat-interface.js';

// Import Chat UI
import {
    ChatUI,
    chatUI
} from './js/ui/chat-ui.js';

// Import Status Messages
import {
    StatusMessages,
    statusMessages,
    addChatMessage,
    addStatusMessage,
    addErrorMessage,
    addSuccessMessage,
    addWarningMessage,
    addProcessingMessage,
    addConnectionMessage,
    addApiKeyStatus,
    addChannelOperationMessage,
    clearChatMessages
} from './js/ui/status-messages.js';

import { registerDebugNamespace, getDebugRegistry } from './js/utils/debug-registry.js';
import { getWindow } from './js/utils/browser-env.js';

const windowRef = getWindow();
const legacyUpdatePreview = typeof windowRef?.updatePreview === 'function'
    ? windowRef.updatePreview.bind(windowRef)
    : null;
// Import Graph Status
import {
    GraphStatus,
    graphStatus,
    updateSessionStatus,
    updateProcessingDetail,
    addGraphStatusMessage
} from './js/ui/graph-status.js';

// Import state management
import {
    PRINTERS,
    INK_COLORS,
    TOTAL,
    elements,
    initializeElements,
    getCurrentPrinter,
    getCurrentState,
    appState,
    setLoadedQuadData,
    getLoadedQuadData,
    updateAppState,
    getAppState,
    resetAppState
} from './js/core/state.js';

import {
    InputValidator
} from './js/core/validation.js';

// Import centralized state management
import {
    QuadGenStateManager,
    getStateManager,
    getAppState as getNewAppState,
    getState,
    setState,
    batchUpdateState,
    subscribeToState
} from './js/core/state-manager.js';

// Import history management (undo/redo)
import {
    HistoryManager,
    getHistoryManager,
    recordChannelAction,
    recordUIAction,
    recordBatchAction,
    captureState,
    undo,
    redo,
    clearHistory
} from './js/core/history-manager.js';

// Import file operations
import {
    SAMPLE_DATA,
    downloadFile,
    generateFilename,
    updateFilename,
    getIntentFilenameTag,
    getPresetDefaults,
    buildQuadFile,
    generateAndDownloadQuadFile,
    downloadSampleLabData,
    downloadSampleCubeFile,
    readFileAsText,
    validateFile,
    handleFileInput
} from './js/files/file-operations.js';

// Import state synchronization system
import { setupStateSynchronization } from './js/core/event-sync.js';

console.log(`quadGEN ${APP_DISPLAY_VERSION} - Modular build system initialized`);

// Note: The extracted JavaScript will be gradually integrated as modules
// Major progress: Core modules (math, data, UI, AI) are now extracted and working

// Test extracted modules functionality
function testExtractedModules() {
    console.log('🧪 Testing extracted modules...');

    // Test mathematical functions
    console.log('📊 Testing math functions:');
    console.log('  clamp01(1.5) =', clamp01(1.5)); // Should be 1
    console.log('  clamp01(-0.5) =', clamp01(-0.5)); // Should be 0
    console.log('  gammaMap(0.5, 2.0) =', gammaMap(0.5, 2.0)); // Should be ~0.25

    // Test PCHIP interpolation
    const testX = [0, 0.5, 1];
    const testY = [0, 0.8, 1];
    const pchipFunc = createPCHIPSpline(testX, testY);
    console.log('  PCHIP(0.25) =', pchipFunc(0.25));

    // Test configuration objects
    console.log('🔧 Testing configuration:');
    console.log('  LAB_TUNING.get("K_NEIGHBORS", 5) =', LAB_TUNING.get('K_NEIGHBORS', 5));
    console.log('  AUTO_LIMIT_DEFAULTS.limitProximityPct =', AUTO_LIMIT_DEFAULTS.limitProximityPct);
    console.log('  CONTRAST_INTENT_PRESETS.linear.label =', CONTRAST_INTENT_PRESETS.linear.label);

    // NOTE: LAB functions now consolidated in file-parsers.js module

    // Test chart utilities
    console.log('📊 Testing chart utilities:');
    console.log('  normalizeDisplayMax({ displayMax: 150 }) =', normalizeDisplayMax({ displayMax: 150 }));
    console.log('  normalizeDisplayMax({}) =', normalizeDisplayMax({})); // Should return 100

    const testGeom = createChartGeometry({ width: 800, height: 600 }, 100);
    console.log('  createChartGeometry sample =', {
        chartWidth: testGeom.chartWidth,
        chartHeight: testGeom.chartHeight,
        displayMax: testGeom.displayMax
    });

    console.log('  mapPercentToY(50, testGeom) =', mapPercentToY(50, testGeom));
    console.log('  mapPercentToX(50, testGeom) =', mapPercentToX(50, testGeom));

    // Test UI utilities
    console.log('🔧 Testing UI utilities:');
    console.log('  clamp01(1.5) =', clamp01(1.5)); // Should be 1
    console.log('  clamp01(-0.5) =', clamp01(-0.5)); // Should be 0
    console.log('  clampPercent(150) =', clampPercent(150)); // Should be 100
    console.log('  formatScalePercent(123.456) =', formatScalePercent(123.456));
    console.log('  formatScalePercent(100) =', formatScalePercent(100));
    console.log('  sanitizeFilename("test file:name?.txt") =', sanitizeFilename("test file:name?.txt"));
    console.log('  isValidNumber(42) =', isValidNumber(42)); // Should be true
    console.log('  isValidNumber(NaN) =', isValidNumber(NaN)); // Should be false
    console.log('  safeParseNumber("42.5") =', safeParseNumber("42.5"));
    console.log('  safeParseNumber("invalid", 10) =', safeParseNumber("invalid", 10));

    // Test debounce function (simple test)
    const debouncedLog = debounce((msg) => console.log('  Debounced:', msg), 100);
    debouncedLog('Test debounce function');

    // Test AI integration modules
    console.log('🤖 Testing AI integration:');

    // Test AI configuration
    const aiConfig = getAIProviderConfig();
    console.log('  AI Provider Config =', {
        provider: aiConfig.provider,
        model: aiConfig.model,
        debug: aiConfig.debug
    });

    console.log('  CLAUDE_FUNCTIONS count =', CLAUDE_FUNCTIONS.length);
    console.log('  Sample function =', CLAUDE_FUNCTIONS[0]?.name);

    // Test QuadGenActions
    const quadActions = createQuadGenActions();
    console.log('  QuadGenActions created =', !!quadActions);

    // Test a simple action
    const testResult = quadActions.setChannelValue('K', 75);
    console.log('  Test action result =', testResult.success, '-', testResult.message);

    // Test Chat Interface
    const chatInterface = getChatInterface();
    console.log('  getChatInterface() =', !!chatInterface);

    // Test chat message handling
    chatInterface.addMessage('system', 'Test system message');
    console.log('  addMessage test =', chatInterface.getHistory().length > 0);

    // Test assistant status function
    console.log('  shouldShowAssistantStatus() =', shouldShowAssistantStatus());

    // Test API key validation (async test)
    chatInterface.validateApiKey('test-key-12345').then(apiValidation => {
        console.log('  validateApiKey() =', {
            valid: apiValidation.valid,
            message: apiValidation.message
        });
    }).catch(error => {
        console.log('  validateApiKey error =', error.message);
    });

    // Test function validation
    const validationTest = validateAIFunctionCall('set_channel_value', { channelName: 'K', percentage: 50 });
    console.log('  Function validation test =', validationTest.success);

    const validationFailTest = validateAIFunctionCall('set_channel_value', { channelName: 'K' }); // Missing percentage
    console.log('  Function validation fail test =', validationFailTest.success, '-', validationFailTest.message);

    // Test state management modules
    console.log('📊 Testing state management:');

    // Test printer configurations
    console.log('  PRINTERS.P700P900.name =', PRINTERS.P700P900.name);
    console.log('  PRINTERS.P700P900.channels =', PRINTERS.P700P900.channels.slice(0, 4), '...');
    console.log('  INK_COLORS.K =', INK_COLORS.K);
    console.log('  TOTAL constant =', TOTAL);

    // Test getCurrentPrinter (will use fallback since DOM not ready)
    const currentPrinter = getCurrentPrinter();
    console.log('  getCurrentPrinter() =', currentPrinter.name);

    // Test validation functions
    console.log('🔍 Testing validation:');
    console.log('  InputValidator.clampPercent(150) =', InputValidator.clampPercent(150)); // Should be 100
    console.log('  InputValidator.clampPercent(-10) =', InputValidator.clampPercent(-10)); // Should be 0
    console.log('  InputValidator.clampEnd(70000) =', InputValidator.clampEnd(70000)); // Should be 65535
    console.log('  InputValidator.computeEndFromPercent(50) =', InputValidator.computeEndFromPercent(50)); // Should be ~32767
    console.log('  InputValidator.computePercentFromEnd(32767) =', InputValidator.computePercentFromEnd(32767)); // Should be ~50

    // Test application state
    console.log('🏪 Testing application state:');
    const initialState = getAppState();
    console.log('  Initial state keys =', Object.keys(initialState));

    updateAppState({ debugLogs: true, chartZoomIndex: 2 });
    const updatedState = getAppState();
    console.log('  Updated state debugLogs =', updatedState.debugLogs);
    console.log('  Updated state chartZoomIndex =', updatedState.chartZoomIndex);

    // Reset state
    resetAppState();
    const resetState = getAppState();
    console.log('  Reset state debugLogs =', resetState.debugLogs);

    // Test file operations
    console.log('📁 Testing file operations:');

    // Test filename generation
    const autoFilename = generateFilename();
    console.log('  generateFilename() =', autoFilename);

    // Test file validation
    const mockFile = { name: 'test.quad', size: 1024 };
    const validationResult = validateFile(mockFile);
    console.log('  validateFile(test.quad) =', validationResult.valid);

    const invalidFile = { name: 'test.exe', size: 1024 };
    const invalidResult = validateFile(invalidFile);
    console.log('  validateFile(test.exe) =', invalidResult.valid, '-', invalidResult.message);

    // Test sample data
    console.log('  SAMPLE_DATA.colorMuse length =', SAMPLE_DATA.colorMuse.split('\n').length, 'lines');
    console.log('  SAMPLE_DATA.gammaCube length =', SAMPLE_DATA.gammaCube.split('\n').length, 'lines');

    // Test quad file generation (placeholder)
    const quadContent = buildQuadFile();
    console.log('  buildQuadFile() length =', quadContent.length, 'characters');

    // Test event handlers
    console.log('🎛️ Testing event handlers:');
    console.log('  initializeEventHandlers function =', typeof initializeEventHandlers);
    console.log('  initializeAutoLimitHandlers function =', typeof initializeAutoLimitHandlers);
    console.log('  removeEventHandlers function =', typeof removeEventHandlers);

    // Test chart manager
    console.log('📊 Testing chart manager:');
    console.log('  initializeChart function =', typeof initializeChart);
    console.log('  updateInkChart function =', typeof updateInkChart);
    console.log('  getChartZoomPercent function =', typeof getChartZoomPercent);
    console.log('  setChartZoomPercent function =', typeof setChartZoomPercent);
    console.log('  stepChartZoom function =', typeof stepChartZoom);
    console.log('  getChartCoordinates function =', typeof getChartCoordinates);

    // Test processing utilities
    console.log('⚙️ Testing processing utilities:');
    console.log('  CURVE_RESOLUTION =', CURVE_RESOLUTION);
    console.log('  AUTO_LIMIT_CONFIG.getNumber("limitProximityPct") =', AUTO_LIMIT_CONFIG.getNumber('limitProximityPct'));
    console.log('  DataSpace.SPACE.PRINTER =', DataSpace.SPACE.PRINTER);
    console.log('  lerp(0, 100, 0.5) =', lerp(0, 100, 0.5));
    console.log('  clamp(150, 0, 100) =', clamp(150, 0, 100));

    // Test array operations
    const testRamp = createLinearRamp(5, 0, 100);
    console.log('  createLinearRamp(5, 0, 100) =', testRamp);

    const scaledRamp = scaleValues(testRamp, 0.5);
    console.log('  scaleValues(testRamp, 0.5) =', scaledRamp);

    const curveValidationResult = validateCurveData(testRamp, { expectedLength: 5, maxValue: 100 });
    console.log('  validateCurveData(testRamp) =', curveValidationResult.valid, '-', curveValidationResult.message);

    const emptyCurve = createEmptyCurve(3);
    console.log('  createEmptyCurve(3) =', emptyCurve);

    // Test Smart Curves system
    console.log('🎯 Testing Smart Curves system:');
    console.log('  KP_SIMPLIFY.maxErrorPercent =', KP_SIMPLIFY.maxErrorPercent);
    console.log('  ControlPolicy.minGap =', ControlPolicy.minGap);
    console.log('  isSmartCurveSourceTag("smart") =', isSmartCurveSourceTag('smart'));
    console.log('  isSmartCurveSourceTag("ai") =', isSmartCurveSourceTag('ai'));
    console.log('  isSmartCurveSourceTag("manual") =', isSmartCurveSourceTag('manual'));

    // Test key points operations
    const testKeyPoints = [
        { input: 0, output: 0 },
        { input: 50, output: 75 },
        { input: 100, output: 100 }
    ];

    const keyPointValidation = validateKeyPoints(testKeyPoints);
    console.log('  validateKeyPoints(testKeyPoints) =', keyPointValidation.valid, '-', keyPointValidation.message);

    const normalizedPoints = ControlPoints.normalize(testKeyPoints);
    console.log('  ControlPoints.normalize(testKeyPoints) =', normalizedPoints);

    const sampledY = ControlPoints.sampleY(normalizedPoints, 'smooth', 25);
    console.log('  ControlPoints.sampleY(points, "smooth", 25) =', sampledY.toFixed(2));

    const generatedCurve = generateCurveFromKeyPoints(testKeyPoints, 'smooth', 5);
    console.log('  generateCurveFromKeyPoints(testKeyPoints, "smooth", 5) =', generatedCurve.map(v => v.toFixed(1)));

    const defaultPoints = createDefaultKeyPoints();
    console.log('  createDefaultKeyPoints() =', defaultPoints);

    // Test Linearization utilities
    console.log('🎚️ Testing Linearization utilities:');
    console.log('  LinearizationState.hasAnyLinearization() =', LinearizationState.hasAnyLinearization());

    // Test linearization data creation
    const testSamples = [0, 0.25, 0.5, 0.75, 1.0];
    const linearizationData = createLinearizationData(testSamples, {
        filename: 'test.txt',
        description: 'Test linearization'
    });
    console.log('  createLinearizationData() created =', !!linearizationData);

    const linearizationValidation = validateLinearizationData(linearizationData);
    console.log('  validateLinearizationData() =', linearizationValidation.valid, '-', linearizationValidation.message);

    // Test state management
    LinearizationState.setGlobalData(linearizationData, true);
    console.log('  LinearizationState after setGlobalData =', LinearizationState.hasAnyLinearization());

    LinearizationState.setPerChannelData('K', linearizationData, true);
    console.log('  LinearizationState.isPerChannelEnabled("K") =', LinearizationState.isPerChannelEnabled('K'));

    const editedName = getEditedDisplayName('test.txt', true);
    console.log('  getEditedDisplayName("test.txt", true) =', editedName);

    const pointCount = getBasePointCountLabel(linearizationData);
    console.log('  getBasePointCountLabel() =', pointCount);

    // Test cloning
    const clonedData = cloneLinearizationData(linearizationData);
    console.log('  cloneLinearizationData() created =', !!clonedData && clonedData !== linearizationData);

    // Test Core Processing Pipeline
    console.log('⚙️ Testing Core Processing Pipeline:');
    console.log('  PROCESSING_CONSTANTS.CURVE_RESOLUTION =', PROCESSING_CONSTANTS.CURVE_RESOLUTION);
    console.log('  PROCESSING_CONSTANTS.TOTAL =', PROCESSING_CONSTANTS.TOTAL);

    // Test auto endpoint rolloff
    console.log('  AutoEndpointRolloff.shouldApply("white") =', AutoEndpointRolloff.shouldApply('white'));
    console.log('  AutoEndpointRolloff.shouldApply("black") =', AutoEndpointRolloff.shouldApply('black'));

    // Test base curve building
    const baseCurveResult = buildBaseCurve(32768, 'K', false);
    console.log('  buildBaseCurve(32768, "K", false) =', {
        shortCircuit: baseCurveResult.shortCircuit,
        valuesLength: baseCurveResult.values.length,
        firstValue: baseCurveResult.values[0],
        lastValue: baseCurveResult.values[baseCurveResult.values.length - 1]
    });

    // Test make256 function
    const curve256 = make256(32768, 'K', false);
    console.log('  make256(32768, "K", false) =', {
        length: curve256.length,
        firstValue: curve256[0],
        midValue: curve256[128],
        lastValue: curve256[255]
    });

    // Test apply1DLUT function
    const testCurve = [0, 16384, 32768, 49152, 65535];
    const lutResult = apply1DLUT(testCurve, null, 0, 1, 65535, 'cubic', 0);
    console.log('  apply1DLUT() placeholder =', {
        inputLength: testCurve.length,
        outputLength: lutResult.length,
        unchanged: JSON.stringify(testCurve) === JSON.stringify(lutResult)
    });

    // Test buildFile function (basic structure)
    const fileContent = buildFile();
    const isValidQuadFormat = fileContent.includes('## QuadToneRIP') && fileContent.includes('# Printer:');
    console.log('  buildFile() generates valid format =', isValidQuadFormat);

    // Test File Format Parsers
    console.log('📄 Testing File Format Parsers:');

    // Test parseQuadFile
    const testQuadContent = '## QuadToneRIP K,C,M,Y\n# Test quad file\n0\n100\n200\n300';
    const quadResult = parseQuadFile(testQuadContent);
    console.log('  parseQuadFile() =', {
        valid: quadResult.valid,
        channels: quadResult.channels?.length || 0,
        hasCurves: !!quadResult.curves
    });

    // Test validateQuadFile
    const quadValidationResult = validateQuadFile(testQuadContent);
    console.log('  validateQuadFile() =', {
        valid: quadValidationResult.valid,
        channels: quadValidationResult.channels?.length || 0
    });


    // Test parseCgatsNumber
    console.log('  parseCgatsNumber("123.45") =', parseCgatsNumber('123.45'));
    console.log('  parseCgatsNumber("N/A") =', parseCgatsNumber('N/A'));

    // Test validateFileFormat
    const quadValidation = validateFileFormat(testQuadContent, 'test.quad');
    console.log('  validateFileFormat("test.quad") =', {
        valid: quadValidation.valid,
        format: quadValidation.format,
        parser: quadValidation.parser
    });

    const cgatsValidation = validateFileFormat('CGATS.17\nBEGIN_DATA\nEND_DATA', 'test.ti3');
    console.log('  validateFileFormat("test.ti3") =', {
        valid: cgatsValidation.valid,
        format: cgatsValidation.format,
        parser: cgatsValidation.parser
    });

    // Test parseIntentPaste
    const intentResult = parseIntentPaste('make the curve brighter in the highlights');
    console.log('  parseIntentPaste() =', {
        ok: intentResult.ok,
        detected: intentResult.detected
    });

    // Test parseLabData
    const labContent = '0 100\n50 50\n100 0';
    const labResult = parseLabData(labContent, 'test.txt');
    console.log('  parseLabData() =', {
        valid: labResult.valid,
        measurements: labResult.measurements?.length || 0
    });

    // Test CUBE parsers
    const cube1DContent = 'LUT_1D_SIZE 256\n0.0\n0.5\n1.0';
    const cube1DResult = parseCube1D(cube1DContent);
    console.log('  parseCube1D() =', {
        valid: cube1DResult.valid,
        samples: cube1DResult.samples?.length || 0
    });

    const cube3DContent = 'LUT_3D_SIZE 17\n0.0 0.0 0.0\n0.5 0.5 0.5\n1.0 1.0 1.0';
    const cube3DResult = parseCube3D(cube3DContent);
    console.log('  parseCube3D() =', {
        valid: cube3DResult.valid,
        samples: cube3DResult.samples?.length || 0
    });

    // Test Centralized State Management
    console.log('🏪 Testing Centralized State Management:');

    const stateManager = getStateManager();
    console.log('  getStateManager() created =', !!stateManager);

    // Test basic get/set operations
    stateManager.set('app.debugLogs', true);
    console.log('  setState debugLogs =', stateManager.get('app.debugLogs'));

    // Test batch updates
    stateManager.batch({
        'app.chartZoomIndex': 5,
        'ui.statusMessage': 'Testing batch update',
        'printer.currentModel': 'P400'
    });
    console.log('  batchUpdate printer model =', stateManager.get('printer.currentModel'));
    console.log('  batchUpdate chart zoom =', stateManager.get('app.chartZoomIndex'));

    // Test convenience methods
    const testCurrentPrinter = stateManager.getCurrentPrinter();
    console.log('  getCurrentPrinter() =', testCurrentPrinter.name);

    stateManager.setChannelValue('K', 'percentage', 85);
    console.log('  setChannelValue K percentage =', stateManager.getChannelValue('K', 'percentage'));

    stateManager.setChannelEnabled('K', true);
    console.log('  setChannelEnabled K =', stateManager.isChannelEnabled('K'));

    // Test linearization methods
    const testLinData = { samples: [0, 0.5, 1], sourceSpace: 'printer', filename: 'test.txt' };
    stateManager.setGlobalLinearization(testLinData, true);
    const globalLin = stateManager.getGlobalLinearization();
    console.log('  setGlobalLinearization =', !!globalLin.data && globalLin.applied);

    stateManager.setPerChannelLinearization('K', testLinData, true);
    console.log('  setPerChannelLinearization K =', !!stateManager.getPerChannelLinearization('K'));

    // Test state subscriptions
    let subscriptionTriggered = false;
    const unsubscribe = stateManager.subscribe(['app.debugLogs'], (path, newValue, oldValue) => {
        subscriptionTriggered = true;
    });
    stateManager.set('app.debugLogs', false);
    console.log('  state subscription triggered =', subscriptionTriggered);
    unsubscribe();

    // Test History Management
    console.log('🕐 Testing History Management (Undo/Redo):');

    const historyManager = getHistoryManager();
    console.log('  getHistoryManager() created =', !!historyManager);

    // Clear history to start fresh
    historyManager.clear();

    // Test channel action recording
    historyManager.recordChannelAction('K', 'percentage', 50, 75);
    console.log('  recordChannelAction =', historyManager.history.length === 1);

    // Test undo/redo
    const undoResult = historyManager.undo();
    console.log('  undo() success =', undoResult.success);
    console.log('  undo() message =', undoResult.message);

    const redoResult = historyManager.redo();
    console.log('  redo() success =', redoResult.success);
    console.log('  redo() message =', redoResult.message);

    // Test UI action recording
    historyManager.recordUIAction('editMode', false, true, 'Enter edit mode');
    console.log('  recordUIAction =', historyManager.history.length === 2);

    // Test batch action recording
    historyManager.recordBatchAction('Scale all channels', [
        { channelName: 'K', type: 'percentage', oldValue: 75, newValue: 90 },
        { channelName: 'C', type: 'percentage', oldValue: 60, newValue: 72 }
    ]);
    console.log('  recordBatchAction =', historyManager.history.length === 3);

    // Test state snapshot capture
    historyManager.captureState('Test state capture');
    console.log('  captureState =', historyManager.history.length === 4);

    // Test history debug info
    const historyDebug = historyManager.getDebugInfo();
    console.log('  getDebugInfo() historyLength =', historyDebug.historyLength);
    console.log('  getDebugInfo() recentActions =', historyDebug.recentActions.length);

    // Test convenience functions
    recordChannelAction('C', 'endValue', 32000, 40000);
    console.log('  convenience recordChannelAction =', historyManager.history.length === 5);

    const convenienceUndo = undo();
    console.log('  convenience undo() success =', convenienceUndo.success);

    const convenienceRedo = redo();
    console.log('  convenience redo() success =', convenienceRedo.success);

    // Test state manager debugging
    stateManager.setDebugging(true);
    stateManager.set('app.testValue', 'debug test');
    const debugInfo = stateManager.getDebugInfo();
    console.log('  state debugging enabled =', debugInfo.snapshots.length > 0);
    stateManager.setDebugging(false);

    // Test state reset
    const beforeReset = stateManager.get('app.chartZoomIndex');
    stateManager.reset(['app.chartZoomIndex']);
    const afterReset = stateManager.get('app.chartZoomIndex');
    console.log('  state reset specific path =', beforeReset !== afterReset);

    // Test global exports via debug registry/window
    const win = getWindow();
    console.log('  window.QuadGenStateManager =', typeof win?.QuadGenStateManager);
    console.log('  window.HistoryManager =', typeof win?.HistoryManager);
    console.log('  window.CurveHistory (legacy) =', typeof win?.CurveHistory);

    // Clean up test state
    LinearizationState.clear();
    historyManager.clear();
    stateManager.reset();

    console.log('✅ Module testing complete!');
}


/**
 * Initialize the quadGEN application
 * Sets up modular components and core functionality
 */
function initializeApplication() {
    console.log(`🚀 Initializing quadGEN ${APP_VERSION}`);

    if (DEBUG_LOGS) {
        testExtractedModules();
    }

    document.title = `quadGEN ${APP_DISPLAY_VERSION}`;
    const appVersionElement = document.getElementById('appVersion');
    if (appVersionElement) {
        appVersionElement.textContent = APP_DISPLAY_VERSION;
    }

    initializeElements();
    initializeEventHandlers();
    initializeAutoLimitHandlers();
    initializeManualLstar();
    initializeEditMode();
    initializeChart();
    setupStateSynchronization();
    initializePrinterUI();
    updateCompactChannelsList();

    setTimeout(() => {
        console.log('🔍 Debug chart initialization:');
        console.log('  elements.inkChart =', !!elements.inkChart);
        console.log('  elements.rows =', !!elements.rows);
        console.log('  elements.rows.children.length =', elements.rows?.children?.length || 0);

        if (elements.rows?.children?.length > 0) {
            console.log('  Sample row data-channel =', elements.rows.children[0].getAttribute('data-channel'));
            const firstRow = elements.rows.children[0];
            const percentInput = firstRow.querySelector('.percent-input');
            const endInput = firstRow.querySelector('.end-input');
            console.log('  First row percent =', percentInput?.value);
            console.log('  First row end =', endInput?.value);
        }

        updateInkChart();
        console.log('📊 Chart update called');
    }, 0);

    const quadActions = createQuadGenActions();
    const aiConfig = getAIProviderConfig();
    console.log(`🤖 AI Provider: ${aiConfig.provider} (${aiConfig.model})`);

    initializeChatInterface();
    initializePreview();
    initializeTheme();
    initializeIntentSystem();

    console.log('🎨 Initializing Chat UI components...');
    chatUI.initialize();

    const currentPrinter = getCurrentPrinter();
    console.log(`🖨️ Printer: ${currentPrinter.name} (${currentPrinter.channels.length} channels)`);

    const updatePreviewCompat = (options = {}) => {
        try {
            if (legacyUpdatePreview) {
                legacyUpdatePreview(options);
            } else {
                updatePreview(options);
            }

            if (typeof updateSessionStatus === 'function') {
                updateSessionStatus();
            }

            if (graphStatus?.updateSessionStatus) {
                graphStatus.updateSessionStatus();
            }
        } catch (error) {
            console.error('Preview update error:', error);
            addErrorMessage('Error updating preview');
        }
    };

    const updateSessionStatusCompat = () => {
        if (typeof updateSessionStatus === 'function') {
            updateSessionStatus();
        }
    };

    const updateProcessingDetailCompat = (channelName) => {
        if (typeof updateProcessingDetail === 'function') {
            updateProcessingDetail(channelName);
        }
    };

    const debugEditModeCompat = () => {
        const editNamespace = getDebugRegistry().editMode || {};
        console.log('=== EDIT MODE DEBUG ===');
        console.log('isEditModeEnabled exists:', typeof editNamespace.isEditModeEnabled);
        console.log('Edit mode enabled:', editNamespace.isEditModeEnabled ? editNamespace.isEditModeEnabled() : 'N/A');
        console.log('EDIT state:', editNamespace.EDIT);
        console.log('Selected channel:', editNamespace.EDIT?.selectedChannel);
        console.log('Selected ordinal:', editNamespace.EDIT?.selectedOrdinal);
    };

    const testEditModeCompat = () => {
        console.log('🔧 Activating edit mode...');
        setEditMode(true);
        const editNamespace = getDebugRegistry().editMode;
        if (editNamespace?.EDIT) {
            editNamespace.EDIT.selectedChannel = 'MK';
            editNamespace.EDIT.selectedOrdinal = 1;
            console.log('✅ MK channel selected for editing');
        }
        updateInkChart();
        console.log('✅ Chart updated');
    };

    const testRecomputeCompat = () => {
        console.log('🔄 Testing recompute...');
        const editNamespace = getDebugRegistry().editMode;
        const selectedChannel = editNamespace?.EDIT?.selectedChannel;
        if (selectedChannel) {
            console.log(`Recomputing for channel: ${selectedChannel}`);
            const result = simplifySmartKeyPointsFromCurve(selectedChannel);
            console.log('Recompute result:', result);
            updateInkChart();
            console.log('✅ Chart updated');
        } else {
            console.error('❌ Recompute not available or no selected channel');
        }
    };

    const testMKCompat = () => {
        console.log('🧪 Setting up MK channel for testing...');

        const mkRow = Array.from(elements?.rows?.children || [])
            .find(row => row.getAttribute('data-channel') === 'MK');

        if (mkRow) {
            const percentInput = mkRow.querySelector('.percent-input');
            const endInput = mkRow.querySelector('.end-input');

            if (percentInput) {
                percentInput.value = '100';
                percentInput.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('✅ MK percent set to 100');
            }

            if (endInput) {
                endInput.value = '65535';
                endInput.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('✅ MK end set to 65535');
            }
        } else {
            console.warn('MK channel row not found');
        }

        setEditMode(true);
        const editNamespace = getDebugRegistry().editMode;
        if (editNamespace?.EDIT) {
            editNamespace.EDIT.selectedChannel = 'MK';
            editNamespace.EDIT.selectedOrdinal = 1;
            console.log('✅ MK selected as editing channel');
        }

        updateInkChart();
        console.log('✅ Chart updated');
        console.log('🧪 MK test setup complete! Try: __quadDebug.compat.testRecompute()');
    };

    const fileOperationsCompat = {
        downloadFile,
        generateFilename,
        updateFilename,
        getIntentFilenameTag,
        getPresetDefaults,
        generateAndDownloadQuadFile,
        downloadSampleLabData,
        downloadSampleCubeFile,
        SAMPLE_DATA
    };

    const stateManagerCompat = {
        QuadGenStateManager,
        getStateManager,
        getState,
        setState,
        batchUpdateState,
        subscribeToState
    };

    const historyManagerCompat = {
        HistoryManager,
        getHistoryManager,
        recordChannelAction,
        recordUIAction,
        recordBatchAction,
        captureState,
        undo,
        redo,
        clearHistory
    };

    const eventHandlersCompat = {
        initializeEventHandlers,
        initializeAutoLimitHandlers,
        removeEventHandlers
    };

    const chartManagerCompat = {
        initializeChart,
        updateInkChart,
        getChartZoomPercent,
        setChartZoomPercent,
        stepChartZoom,
        getChartCoordinates,
        setChartZoomIndex,
        getChartZoomIndex
    };

    const processingUtilsCompat = {
        CURVE_RESOLUTION,
        AUTO_LIMIT_CONFIG,
        DataSpace,
        lerp,
        clamp,
        createLinearRamp,
        scaleValues,
        normalizeToMax,
        resampleArray,
        validateCurveData,
        createEmptyCurve
    };

    const smartCurvesCompat = {
        KP_SIMPLIFY,
        ControlPolicy,
        ControlPoints,
        isSmartCurve,
        isSmartCurveSourceTag,
        generateCurveFromKeyPoints,
        extractAdaptiveKeyPointsFromValues,
        rescaleSmartCurveForInkLimit,
        validateKeyPoints,
        createDefaultKeyPoints,
        normalizeSmartSourcesInLoadedData,
        simplifySmartKeyPointsFromCurve
    };

    const linearizationUtilsCompat = {
        LinearizationState,
        normalizeLinearizationEntry,
        applyLinearizationExtras,
        ensurePrinterSpaceData,
        getGlobalLinearizationInterpolationType,
        createLinearizationData,
        validateLinearizationData,
        markLinearizationEdited,
        getEditedDisplayName,
        getBasePointCountLabel,
        cloneLinearizationData
    };

    const processingPipelineCompat = {
        PROCESSING_CONSTANTS,
        AutoEndpointRolloff,
        buildBaseCurve,
        applyPerChannelLinearizationStep,
        applyGlobalLinearizationStep,
        applyAutoEndpointAdjustments,
        make256,
        apply1DLUT,
        buildFile
    };

    const fileParsersCompat = {
        parseQuadFile,
        parseACVFile,
        parseCube1D,
        parseCube3D,
        parseCgatsNumber,
        parseCGATS17,
        parseLabData,
        parseLinearizationFile,
        parseManualLstarData,
        parseIntentPaste,
        validateFileFormat,
        validateQuadFile
    };

    const chatInterfaceCompat = {
        ChatInterface,
        getChatInterface,
        sendChatMessage,
        shouldShowAssistantStatus,
        initializeChatInterface
    };

    const chatUICompat = {
        ChatUI,
        chatUI
    };

    const statusMessagesCompat = {
        StatusMessages,
        statusMessages,
        addChatMessage,
        addStatusMessage,
        addErrorMessage,
        addSuccessMessage,
        addWarningMessage,
        addProcessingMessage,
        addConnectionMessage,
        addApiKeyStatus,
        addChannelOperationMessage,
        clearChatMessages
    };

    const compatExports = {
        quadGenActions: quadActions,
        aiConfig,
        PRINTERS,
        INK_COLORS,
        InputValidator,
        elements,
        fileOperations: fileOperationsCompat,
        generateFilename,
        updateFilename,
        getIntentFilenameTag,
        getPresetDefaults,
        stateManager: stateManagerCompat,
        historyManager: historyManagerCompat,
        eventHandlers: eventHandlersCompat,
        chartManager: chartManagerCompat,
        CHART_ZOOM_LEVELS,
        processingUtils: processingUtilsCompat,
        smartCurves: smartCurvesCompat,
        linearizationUtils: linearizationUtilsCompat,
        processingPipeline: processingPipelineCompat,
        fileParsers: fileParsersCompat,
        chatInterface: chatInterfaceCompat,
        chatUI: chatUICompat,
        statusMessages: statusMessagesCompat,
        graphStatus,
        updatePreview: updatePreviewCompat,
        updateSessionStatus: updateSessionStatusCompat,
        updateProcessingDetail: updateProcessingDetailCompat,
        updateProcessingDetailForce: updateProcessingDetailCompat,
        debugEditMode: debugEditModeCompat,
        testEditMode: testEditModeCompat,
        testRecompute: testRecomputeCompat,
        testMK: testMKCompat
    };

    const compatAliases = Object.keys(compatExports);

    registerDebugNamespace('compat', compatExports, {
        exposeOnWindow: true,
        windowAliases: compatAliases
    });

    if (windowRef && !Object.getOwnPropertyDescriptor(windowRef, 'chartZoomIndex')) {
        Object.defineProperty(windowRef, 'chartZoomIndex', {
            configurable: true,
            get: () => getAppState().chartZoomIndex,
            set: (value) => updateAppState({ chartZoomIndex: value })
        });
    }

    if (DEBUG_LOGS) {
        showBuildModeIndicator();
    }

    console.log('✅ quadGEN modular initialization complete');
    console.log('🔧 Legacy helpers available via __quadDebug.compat.*');
    console.log('  __quadDebug.compat.debugEditMode() - Show current edit mode state');
    console.log('  __quadDebug.compat.testEditMode() - Activate edit mode');
    console.log('  __quadDebug.compat.testRecompute() - Recompute Smart key points');
    console.log('  __quadDebug.compat.testMK() - Prime MK channel for testing');

    addStatusMessage(`Switched to ${currentPrinter.name}`);
}
/**
 * Show build mode indicator for development
 */
function showBuildModeIndicator() {
    const indicator = document.createElement('div');
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #4CAF50;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-family: monospace;
        z-index: 9999;
        opacity: 0.7;
    `;
    indicator.textContent = 'MODULAR BUILD';
    document.body.appendChild(indicator);

    setTimeout(() => {
        if (indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
        }
    }, 3000);
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApplication);
