#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createExtractor(source) {
  function extractBlock(token) {
    const start = source.indexOf(token);
    if (start === -1) throw new Error(`Token ${token} not found in quadgen.html`);
    let i = start;
    let parenDepth = 0;
    let foundBrace = false;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') { if (parenDepth > 0) parenDepth--; }
      else if (ch === '{' && parenDepth === 0) { foundBrace = true; break; }
    }
    if (!foundBrace) throw new Error(`Opening brace not found for token ${token}`);
    let depth = 0;
    let end = i;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end++; break; }
      }
    }
    while (end < source.length && source[end] !== ';' && source[end] !== '\n') end++;
    if (end < source.length) end++;
    return source.slice(start, end);
  }

  function extractSection(startToken, endToken) {
    const start = source.indexOf(startToken);
    if (start === -1) throw new Error(`Token ${startToken} not found in quadgen.html`);
    const end = source.indexOf(endToken, start);
    if (end === -1) throw new Error(`Token ${endToken} not found in quadgen.html`);
    return source.slice(start, end);
  }

  function extractLine(token) {
    const start = source.indexOf(token);
    if (start === -1) throw new Error(`Token ${token} not found in quadgen.html`);
    const end = source.indexOf('\n', start);
    return source.slice(start, end === -1 ? source.length : end);
  }

  return { extractBlock, extractSection, extractLine };
}

function createIntentHarness(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..', '..');
  const quadgenPath = options.quadgenPath || path.join(rootDir, 'quadgen.html');
  const labPath = options.linearLabPath || path.join(rootDir, 'testdata', 'linear_reference_lab.txt');

  const source = fs.readFileSync(quadgenPath, 'utf8');
  const { extractBlock, extractSection, extractLine } = createExtractor(source);

  const headerBlock = 'const N = 256; const TOTAL = 65535; const DENOM = N - 1; let DEBUG_LOGS = false;';
  const clampLine = extractLine('const clamp01');
  const dataSpaceBlock = extractBlock('const DataSpace =');
  const createCubicBlock = extractBlock('function createCubicSpline');
  const createCatmullBlock = extractBlock('function createCatmullRomSpline');
  const createPchipBlock = extractBlock('function createPCHIPSpline');
  const schlickBlock = extractBlock('function schlickBias');
  const schlickGainBlock = extractBlock('function schlickGain');
  const gammaMapBlock = extractBlock('function gammaMap');
  const filmicBlock = extractBlock('function filmicSoftShoulder');
  const popsBlock = extractBlock('function popsCompatStandard');
  const compilePointsBlock = extractBlock('function compileIntentFromPoints');
  const buildTargetBlock = extractBlock('function buildTargetFnFromSamples');
  const getTargetBlock = extractBlock('function getTargetRelAt');
  const contrastPresetsSection = extractSection('const CONTRAST_INTENT_PRESETS =', 'function getPreset');
  const getPresetBlock = extractBlock('function getPreset');
  const cieSection = extractSection('function lstarToY_CIE', 'function parseLabData');
  const parseLabBlock = extractBlock('function parseLabData');
  const buildLabBlock = extractBlock('function buildLabLinearizationFromOriginal');
  const normalizeBlock = extractBlock('function normalizeLinearizationEntry');
  const ensureBlock = extractBlock('function ensurePrinterSpaceData');
  const curveSimplificationBlock = extractBlock('const CurveSimplification =');
  const globalInterpolationBlock = extractBlock('function getGlobalLinearizationInterpolationType');
  const apply1DLUTBlock = extractBlock('function apply1DLUT');
  const applySmoothingSequenceBlock = extractBlock('function applySmoothingSequence');
  const buildBaseCurveBlock = extractBlock('function buildBaseCurve');
  const medianBlock = extractBlock('function median');

  const harnessConsole = {
    log: () => {},
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
  };

  const sandbox = {
    console: harnessConsole,
    Math,
    Array,
    Number,
    Date,
    JSON,
    RegExp,
    parseFloat,
    parseInt,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: {
      _autoLimitState: {},
      loadedQuadData: { curves: {}, baselineEnd: {}, keyPointsMeta: {} }
    },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {} })
    },
    elements: {
      curveSmoothingMethod: { value: 'pchip' },
      simplificationMethod: { value: 'smoothing-splines' },
      autoWhiteLimitToggle: { checked: false },
      autoBlackLimitToggle: { checked: false },
      catmullTension: { value: '50' }
    },
    CurveSimplification: {},
    getSelectedSimplificationMethod() {
      return this.elements?.simplificationMethod?.value || 'smoothing-splines';
    },
    isSmartCurve: () => false,
    updatePreview: () => {},
    persistContrastIntent: () => {},
    localStorage: {
      setItem: () => {},
      getItem: () => null,
      removeItem: () => {}
    },
    navigator: { userAgent: 'intent-harness' },
    LAB_TUNING: {
      overrides: null,
      setOverrides(overrides) {
        if (overrides && typeof overrides === 'object') {
          const sanitized = {};
          const neighbor = Number(overrides.K_NEIGHBORS);
          if (Number.isFinite(neighbor) && neighbor > 0) sanitized.K_NEIGHBORS = Math.max(1, Math.round(neighbor));
          const sigmaFloor = Number(overrides.SIGMA_FLOOR);
          if (Number.isFinite(sigmaFloor) && sigmaFloor > 0) sanitized.SIGMA_FLOOR = sigmaFloor;
          const sigmaCeil = Number(overrides.SIGMA_CEIL);
          if (Number.isFinite(sigmaCeil) && sigmaCeil > 0) sanitized.SIGMA_CEIL = sigmaCeil;
          const sigmaAlpha = Number(overrides.SIGMA_ALPHA);
          if (Number.isFinite(sigmaAlpha) && sigmaAlpha > 0) sanitized.SIGMA_ALPHA = sigmaAlpha;
          this.overrides = Object.keys(sanitized).length ? sanitized : null;
        } else {
          this.overrides = null;
        }
      },
      get(key, fallback) {
        const value = this.overrides && this.overrides[key];
        if (Number.isFinite(value)) return value;
        return fallback;
      },
      exportOverrides() {
        return this.overrides ? { ...this.overrides } : null;
      }
    }
  };

  vm.createContext(sandbox);

  const setupSnippets = [
    headerBlock,
    clampLine,
    dataSpaceBlock,
    createCubicBlock,
    createCatmullBlock,
    createPchipBlock,
    schlickBlock,
    schlickGainBlock,
    gammaMapBlock,
    filmicBlock,
    popsBlock,
    compilePointsBlock,
    buildTargetBlock,
    'var _intentCache = { id: null, targetFn: null };',
    getTargetBlock,
    contrastPresetsSection,
    getPresetBlock,
    "const DEFAULT_INTENT = { id: 'linear', name: 'Linear', source: 'preset', params: (getPreset('linear')?.params) || {} };",
    'var contrastIntent = DEFAULT_INTENT;',
    'var perChannelLinearization = {};',
    'var perChannelEnabled = {};',
    'var linearizationApplied = false;',
    'var linearizationData = null;',
    cieSection,
    parseLabBlock,
    normalizeBlock,
    ensureBlock,
    curveSimplificationBlock,
    globalInterpolationBlock,
    apply1DLUTBlock,
    applySmoothingSequenceBlock,
    buildBaseCurveBlock,
    medianBlock
  ];

  setupSnippets.forEach((code, index) => {
    try {
      vm.runInContext(code, sandbox);
    } catch (err) {
      console.error(`Intent harness failed to evaluate snippet #${index}`);
      throw err;
    }
  });

  sandbox.CurveSimplification = vm.runInContext('CurveSimplification', sandbox);

  let currentLabOverrideKey = null;

  function renderLabBuilderSource(overrides = {}) {
    const defaults = {
      K_NEIGHBORS: 2,
      SIGMA_FLOOR: 0.036,
      SIGMA_CEIL: 0.15,
      SIGMA_ALPHA: 2.0
    };
    const constants = { ...defaults, ...overrides };
    const blockPattern = /const\s+K_NEIGHBORS[\s\S]*?const\s+SIGMA_ALPHA\s*=\s*[^;]+;/;
    const replacement = `const K_NEIGHBORS = ${constants.K_NEIGHBORS};\n      const SIGMA_FLOOR = ${constants.SIGMA_FLOOR};\n      const SIGMA_CEIL = ${constants.SIGMA_CEIL};\n      const SIGMA_ALPHA = ${constants.SIGMA_ALPHA};`;
    return buildLabBlock.replace(blockPattern, replacement);
  }

  function setLabOverrides(overrides = null) {
    const key = JSON.stringify(overrides || {});
    if (key === currentLabOverrideKey) return;
    try { sandbox.LAB_TUNING.setOverrides(overrides); } catch {}
    const code = renderLabBuilderSource(overrides || {});
    vm.runInContext(code, sandbox);
    currentLabOverrideKey = key;
  }

  setLabOverrides(options.labOverrides || null);

  const TOTAL = sandbox.TOTAL || 65535;

  const linearLabText = fs.readFileSync(labPath, 'utf8');
  const parsedLab = sandbox.parseLabData(linearLabText, path.basename(labPath));
  const normalizedLab = sandbox.normalizeLinearizationEntry(parsedLab);
  const originalData = normalizedLab.originalData.map(point => ({ input: point.input, lab: point.lab }));

  function setIntent(id, preset) {
    const payload = {
      id,
      name: preset?.label || preset?.name || id,
      source: 'preset',
      params: preset?.params || {}
    };
    vm.runInContext(`contrastIntent = ${JSON.stringify(payload)}; _intentCache = { id: null, targetFn: null };`, sandbox);
  }

  function clonePreset(intentId) {
    const json = vm.runInContext(`JSON.stringify(CONTRAST_INTENT_PRESETS[${JSON.stringify(intentId)}])`, sandbox);
    return JSON.parse(json);
  }

  function rebuildLinearization(label) {
    const rebuilt = sandbox.buildLabLinearizationFromOriginal(originalData);
    rebuilt.filename = label || 'linear_reference_lab.txt';
    return sandbox.normalizeLinearizationEntry(rebuilt);
  }

  function applyPostSmoothing(curve, options) {
    const passes = options.postPasses || 0;
    const percent = options.postPercent || 0;
    if (!passes || percent <= 0) return curve;

    const algorithm = options.postAlgorithm || options.smoothingAlgorithm || 'smoothing-splines';
    let normalized = curve.map(value => value / TOTAL);
    for (let i = 0; i < passes; i++) {
      const reduced = sandbox.CurveSimplification.applySmoothingReduction(normalized, percent, algorithm);
      const targetFn = sandbox.buildTargetFnFromSamples(reduced);
      normalized = Array.from({ length: 256 }, (_, idx) => targetFn(idx / 255));
    }
    return normalized.map(v => Math.round(Math.max(0, Math.min(1, v)) * TOTAL));
  }

  function computeIntentDelta(intentId, options) {
    const preset = clonePreset(intentId);
    setIntent(intentId, preset);

    sandbox.window._autoLimitState = {};
    sandbox.linearizationData = rebuildLinearization('linear_reference_lab.txt');
    sandbox.linearizationApplied = true;
    sandbox.perChannelLinearization = {};
    sandbox.perChannelEnabled = {};

    sandbox.elements.curveSmoothingMethod.value = options.interpolationType || 'pchip';
    if (sandbox.elements.simplificationMethod) {
      sandbox.elements.simplificationMethod.value = options.smoothingAlgorithm === 'none'
        ? 'smoothing-splines'
        : (options.smoothingAlgorithm || 'smoothing-splines');
    }

    const base = sandbox.buildBaseCurve(TOTAL, 'K', false).values.slice();
    const smoothingPercent = options.smoothingAlgorithm === 'none' ? 0 : (options.smoothingPercent || 0);

    const curve = sandbox.apply1DLUT(
      base,
      sandbox.linearizationData,
      sandbox.linearizationData.domainMin || 0,
      sandbox.linearizationData.domainMax || 1,
      TOTAL,
      options.interpolationType || 'pchip',
      smoothingPercent
    );

    const postProcessed = applyPostSmoothing(curve, options);

    const deltas = postProcessed.map((value, index) => {
      const normalized = value / TOTAL;
      const target = sandbox.getTargetRelAt(index / 255);
      return Math.abs(normalized - target);
    });

    const maxDelta = Math.max(...deltas);
    const meanDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    const autoMetaSize = Object.keys(sandbox.window._autoLimitState || {}).length;

    return { id: intentId, maxDelta, meanDelta, autoMetaSize };
  }

  function sweepPresets(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'labOverrides')) {
      setLabOverrides(options.labOverrides);
    }
    const config = {
      interpolationType: options.interpolationType || 'pchip',
      smoothingPercent: options.smoothingPercent || 0,
      smoothingAlgorithm: options.smoothingAlgorithm || (options.smoothingPercent ? 'smoothing-splines' : 'none'),
      postPasses: options.postPasses || 0,
      postPercent: options.postPercent || 0,
      postAlgorithm: options.postAlgorithm || options.smoothingAlgorithm
    };

    const presetIds = JSON.parse(vm.runInContext('JSON.stringify(Object.keys(CONTRAST_INTENT_PRESETS))', sandbox));
    const results = presetIds.map(id => computeIntentDelta(id, config));
    const overallMaxDelta = Math.max(...results.map(r => r.maxDelta));
    const averageMeanDelta = results.reduce((sum, r) => sum + r.meanDelta, 0) / results.length;

    return {
      config,
      results,
      summary: {
        overallMaxDelta,
        averageMeanDelta
      },
      labOverrides: JSON.parse(currentLabOverrideKey || '{}')
    };
  }

  return {
    sweepPresets,
    sandbox,
    originalData,
    setLabOverrides,
    getLabOverrides: () => JSON.parse(currentLabOverrideKey || '{}')
  };
}

module.exports = {
  createIntentHarness
};
