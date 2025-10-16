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
import {
  setLoadedQuadData,
  ensureLoadedQuadData
} from '../../src/js/core/state.js';

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

describe('Composite redistribution double-apply regression', () => {
  beforeEach(() => {
    LinearizationState.clear();
    setLoadedQuadData(null);
    ensureLoadedQuadData();
  });

  it('does not reapply global LAB after composite redistribution finalizes', () => {
    const quad = parseQuadFile('data/TRIFORCE_V4.quad');
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');
    const labEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt');

    LinearizationState.setGlobalData(labEntry, true);

    const endValues = {};
    Object.keys(quad.curves).forEach((channelName) => {
      const series = quad.curves[channelName];
      if (Array.isArray(series)) {
        endValues[channelName] = Math.max(...series);
      }
    });

    setLoadedQuadData({
      curves: quad.curves,
      baselineEnd: { ...endValues },
      sources: {},
      normalizeToEndChannels: {}
    });
    const loadedData = ensureLoadedQuadData();

    const compositeChannels = ['K', 'LK'];
    const sessionStarted = beginCompositeLabRedistribution({
      channelNames: compositeChannels,
      endValues,
      labEntry,
      interpolationType: 'cubic',
      smoothingPercent: 0
    });

    expect(sessionStarted).toBe(true);

    compositeChannels.forEach((channelName) => {
      const endValue = endValues[channelName];
      expect(endValue).toBeGreaterThan(0);
      const baseline = make256(endValue, channelName, true);
      expect(Array.isArray(baseline)).toBe(true);
      loadedData.plotBaseCurves[channelName] = baseline.slice();
    });

    const compositeResult = finalizeCompositeLabRedistribution();
    expect(compositeResult?.curves).toBeTruthy();

    const stateCorrected = LinearizationState.getGlobalCorrectedCurves?.();
    expect(stateCorrected, 'composite finalize should capture corrected curve snapshot').toBeTruthy();

    compositeChannels.forEach((channelName) => {
      const adjusted = compositeResult.curves[channelName];
      expect(Array.isArray(adjusted)).toBe(true);
      loadedData.curves[channelName] = adjusted.slice();
      loadedData.rebasedCurves[channelName] = adjusted.slice();
      loadedData.baselineEnd[channelName] = Math.max(...adjusted);
    });

    compositeChannels.forEach((channelName) => {
      const bakedMeta = LinearizationState.getGlobalBakedMeta?.();
      expect(bakedMeta, 'composite finalize should record global baked metadata').toBeTruthy();
      if (bakedMeta && Array.isArray(bakedMeta.channels)) {
        expect(bakedMeta.channels).toContain(channelName);
      }
      if (stateCorrected && stateCorrected[channelName]) {
        expect(stateCorrected[channelName]).toStrictEqual(compositeResult.curves[channelName]);
      }
      const endValue = loadedData.baselineEnd[channelName];
      expect(endValue).toBeGreaterThanOrEqual(0);
      const regenerated = make256(endValue, channelName, true);
      expect(regenerated).toStrictEqual(compositeResult.curves[channelName]);
    });
  });
});
