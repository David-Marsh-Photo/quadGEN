import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { parseLabData } from '../../src/js/data/lab-parser.js';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';
import {
  beginCompositeLabRedistribution,
  finalizeCompositeLabRedistribution,
  make256
} from '../../src/js/core/processing-pipeline.js';
import { setLoadedQuadData, ensureLoadedQuadData } from '../../src/js/core/state.js';
import {
  resetCompositeDebugState,
  setCompositeDebugEnabled,
  getCompositeDebugState,
  getCompositeDebugSnapshot
} from '../../src/js/core/composite-debug.js';

const CURVE_RESOLUTION = 256;

function parseQuadFile(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const headerLine = lines.find((line) => line.startsWith('## QuadToneRIP '));
  if (!headerLine) {
    throw new Error(`Quad header missing in ${relativePath}`);
  }
  const channels = headerLine.replace('## QuadToneRIP ', '').trim().split(',');
  const curves = {};
  channels.forEach((name) => {
    curves[name] = new Array(CURVE_RESOLUTION);
  });

  let currentChannel = null;
  let pointer = 0;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      const maybeChannel = trimmed.replace(/^#+/, '').trim();
      if (maybeChannel.endsWith('curve')) {
        const [name] = maybeChannel.split(/\s+/);
        if (Object.prototype.hasOwnProperty.call(curves, name)) {
          currentChannel = name;
          pointer = 0;
        } else {
          currentChannel = null;
        }
      }
      return;
    }
    if (/^-?\d+$/.test(trimmed) && currentChannel) {
      if (pointer < CURVE_RESOLUTION) {
        curves[currentChannel][pointer] = parseInt(trimmed, 10) || 0;
        pointer += 1;
      }
    }
  });

  channels.forEach((name) => {
    const series = curves[name];
    if (!Array.isArray(series)) return;
    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
      if (typeof series[i] !== 'number') {
        series[i] = 0;
      }
    }
  });

  return { channels, curves };
}

describe('Composite debug instrumentation', () => {
  beforeEach(() => {
    resetCompositeDebugState();
    setCompositeDebugEnabled(false);
    LinearizationState.clear();
    setLoadedQuadData(null);
    ensureLoadedQuadData();
  });

  it('captures summary data and per-sample deltas when enabled', () => {
    const quad = parseQuadFile('data/TRIFORCE_V4.quad');
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');
    const labEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt');

    LinearizationState.setGlobalData(labEntry, true);

    const channelNames = ['K', 'LK', 'C'];
    const endValues = {};
    channelNames.forEach((channelName) => {
      const curve = quad.curves[channelName];
      expect(Array.isArray(curve)).toBe(true);
      endValues[channelName] = Math.max(...curve);
    });

    setLoadedQuadData({
      curves: quad.curves,
      baselineEnd: { ...endValues },
      sources: {},
      normalizeToEndChannels: {}
    });
    const loadedData = ensureLoadedQuadData();

    setCompositeDebugEnabled(true);

    const sessionStarted = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      interpolationType: 'cubic',
      smoothingPercent: 0
    });
    expect(sessionStarted).toBe(true);

    channelNames.forEach((channelName) => {
      const endValue = endValues[channelName];
      const base = make256(endValue, channelName, true);
      expect(Array.isArray(base)).toBe(true);
      loadedData.plotBaseCurves[channelName] = base.slice();
    });

    const compositeResult = finalizeCompositeLabRedistribution();
    expect(compositeResult?.curves).toBeTruthy();

    const debugState = getCompositeDebugState();
    expect(debugState.enabled).toBe(true);
    expect(debugState.summary).toBeTruthy();
    expect(Object.keys(debugState.summary.channelMaxima || {})).toContain('K');
    expect(Object.keys(debugState.summary.densityWeights || {})).toContain('LK');

    expect(debugState.summary?.coverageSummary).toBeTruthy();

    const snapshot = getCompositeDebugSnapshot(242);
    expect(snapshot, 'snapshot for index 242 available').toBeTruthy();
    expect(snapshot?.perChannel?.K).toBeTruthy();

    if (snapshot) {
      const perChannelEntries = Object.values(snapshot.perChannel ?? {});
      const contributionDeltas = perChannelEntries.map(
        (entry) => (typeof entry?.densityContributionDelta === 'number' ? entry.densityContributionDelta : 0)
      );
      if (Math.abs(snapshot.deltaDensity || 0) > 1e-4) {
        const hasContribution = contributionDeltas.some((delta) => Math.abs(delta) > 1e-6);
        const ladderSelections = Array.isArray(snapshot.ladderSelection) ? snapshot.ladderSelection.length : 0;
        if (ladderSelections > 0) {
          expect(hasContribution).toBe(true);
        }
        const contributionSum = contributionDeltas.reduce((acc, delta) => acc + delta, 0);
        const valueDeltaSum = perChannelEntries.reduce(
          (acc, entry) => acc + (typeof entry?.valueDelta === 'number' ? entry.valueDelta : 0),
          0
        );
        expect(Math.abs(valueDeltaSum - snapshot.inkDelta)).toBeLessThan(1);
      }
    }
  });

  it('does not retain instrumentation when disabled', () => {
    const quad = parseQuadFile('data/TRIFORCE_V4.quad');
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');
    const labEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt');

    LinearizationState.setGlobalData(labEntry, true);

    const channelNames = ['K', 'LK', 'C'];
    const endValues = {};
    channelNames.forEach((channelName) => {
      const curve = quad.curves[channelName];
      expect(Array.isArray(curve)).toBe(true);
      endValues[channelName] = Math.max(...curve);
    });

    setLoadedQuadData({
      curves: quad.curves,
      baselineEnd: { ...endValues },
      sources: {},
      normalizeToEndChannels: {}
    });
    const loadedData = ensureLoadedQuadData();

    const sessionStarted = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      interpolationType: 'cubic',
      smoothingPercent: 0
    });
    expect(sessionStarted).toBe(true);

    channelNames.forEach((channelName) => {
      const endValue = endValues[channelName];
      const base = make256(endValue, channelName, true);
      expect(Array.isArray(base)).toBe(true);
      loadedData.plotBaseCurves[channelName] = base.slice();
    });

    finalizeCompositeLabRedistribution();

    const debugState = getCompositeDebugState();
    expect(debugState.enabled).toBe(false);
    expect(debugState.summary).toBeTruthy();
    expect(Array.isArray(debugState.snapshots)).toBe(true);
    expect(debugState.snapshots.length).toBeGreaterThan(0);
  });
});
