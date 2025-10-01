import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('make256 pipeline helpers', () => {
  let context;
  let buildBaseCurve, applyPerChannelLinearizationStep, applyGlobalLinearizationStep, applyAutoEndpointAdjustments, autoLimitsFeatureFlag;

  beforeEach(() => {
    const quadgenPath = path.join(__dirname, '..', 'quadgen.html');
    const source = fs.readFileSync(quadgenPath, 'utf8');

    function extractSection(startToken, endToken) {
      const start = source.indexOf(startToken);
      if (start === -1) throw new Error(`Token ${startToken} not found`);
      const end = source.indexOf(endToken, start);
      if (end === -1) throw new Error(`Token ${endToken} not found`);
      return source.slice(start, end);
    }

    const headerBlock = `const N = 256;
const TOTAL = 65535;
const DENOM = N - 1;
const DEBUG_LOGS = false;`;
    const helpersBlock = extractSection('function buildBaseCurve', 'function applyAutoEndpointRolloff');

    context = {
      console,
      Math,
      Array,
      Number,
      Date,
      document: {
        getElementById: () => ({}),
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ style: {} })
      },
      window: { _autoLimitState: {} },
      elements: {
        curveSmoothingMethod: { value: 'pchip' },
        autoWhiteLimitToggle: { checked: false },
        autoBlackLimitToggle: { checked: false }
      },
      perChannelLinearization: {},
      perChannelEnabled: {},
      linearizationApplied: false,
      linearizationData: null,
      getGlobalLinearizationInterpolationType: () => 'pchip',
      ensurePrinterSpaceData: data => data,
      normalizeLinearizationEntry: data => data,
      apply1DLUT: () => { throw new Error('apply1DLUT stub not replaced'); },
      applyAutoEndpointRolloff: () => { throw new Error('applyAutoEndpointRolloff stub not replaced'); },
      isSmartCurve: () => false
    };
    vm.createContext(context);
    vm.runInContext(`${headerBlock}\n${helpersBlock}`, context);

    buildBaseCurve = context.buildBaseCurve;
    applyPerChannelLinearizationStep = context.applyPerChannelLinearizationStep;
    applyGlobalLinearizationStep = context.applyGlobalLinearizationStep;
    applyAutoEndpointAdjustments = context.applyAutoEndpointAdjustments;
    autoLimitsFeatureFlag = vm.runInContext('typeof AUTO_LIMITS_ENABLED !== "undefined" ? AUTO_LIMITS_ENABLED : undefined', context);
  });

  it('buildBaseCurve returns linear ramp when no data', () => {
    const result = buildBaseCurve(65535, 'K', false);
    expect(result.shortCircuit).toBe(false);
    expect(result.values.length).toBe(256);
    expect(result.values.slice(0, 3)).toEqual([0, 257, 514]);
  });

  it('buildBaseCurve short-circuits when loaded curve is zeroed', () => {
    context.window.loadedQuadData = { curves: { K: [0, 0, 0] } };
    const result = buildBaseCurve(65535, 'K', false);
    expect(result.shortCircuit).toBe(true);
    expect(result.values).toEqual(new Array(256).fill(0));
    delete context.window.loadedQuadData;
  });

  it('applyPerChannelLinearizationStep invokes apply1DLUT only when enabled', () => {
    let called = 0;
    context.apply1DLUT = () => { called++; return ['applied']; };
    context.perChannelLinearization.K = { domainMin: 0, domainMax: 1 };
    context.perChannelEnabled.K = true;
    const out = applyPerChannelLinearizationStep([1, 2, 3], { channelName: 'K', endValue: 65535, interpolationType: 'pchip', smoothingPercent: 0, smartApplied: false });
    expect(called).toBe(1);
    expect(out).toEqual(['applied']);

    called = 0;
    context.perChannelEnabled.K = false;
    const out2 = applyPerChannelLinearizationStep([1, 2, 3], { channelName: 'K', endValue: 65535, interpolationType: 'pchip', smoothingPercent: 0, smartApplied: false });
    expect(called).toBe(0);
    expect(out2).toEqual([1, 2, 3]);
  });

  it('applyGlobalLinearizationStep respects skip conditions', () => {
    let called = 0;
    context.linearizationApplied = true;
    context.linearizationData = { domainMin: 0, domainMax: 1 };
    context.apply1DLUT = () => { called++; return ['global']; };
    const result = applyGlobalLinearizationStep([5, 6], { channelName: 'K', endValue: 65535, applyLinearization: true, interpolationType: 'pchip', smoothingPercent: 0, smartApplied: false });
    expect(called).toBe(1);
    expect(result).toEqual(['global']);

    called = 0;
    context.window.loadedQuadData = { keyPointsMeta: { K: { bakedGlobal: true } } };
    const skipped = applyGlobalLinearizationStep([5, 6], { channelName: 'K', endValue: 65535, applyLinearization: true, interpolationType: 'pchip', smoothingPercent: 0, smartApplied: false });
    expect(called).toBe(0);
    expect(skipped).toEqual([5, 6]);
    delete context.window.loadedQuadData;
  });

  it('applyAutoEndpointAdjustments honors auto limit availability flag', () => {
    let called = 0;
    context.elements.autoWhiteLimitToggle.checked = true;
    context.applyAutoEndpointRolloff = (values) => { called++; return values.map(v => v + 1); };
    const out = applyAutoEndpointAdjustments([0, 1], 65535, 'K', false);
    if (autoLimitsFeatureFlag) {
      expect(called).toBe(1);
      expect(out).toEqual([1, 2]);
    } else {
      expect(called).toBe(0);
      expect(out).toEqual([0, 1]);
    }
    context.elements.autoWhiteLimitToggle.checked = false;
  });
});